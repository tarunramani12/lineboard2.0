-- Schedule lock (owner decision).
--   * A schedule can be locked by anyone who edits the Schedule (Production and Direction by default, the owner and admins).
--     Locked means finished and shared: nothing in it changes until it is unlocked. A locked schedule cannot be deleted.
--   * Ordinary cast and crew (anyone who can view the Schedule section but cannot edit it) see ONLY locked schedules.
--     Unlocked schedules are drafts. Drafts are seen by the owner and admins, by the people who edit the Schedule, and by
--     the individual people the owner names (schedule_draft_viewers).
--   * A shoot day that already has a published call sheet stays readable by people who can view call sheets, so the call
--     sheet still opens.
--   * Defaults: the Cast and crew list is no longer open to every team. Production and Direction keep it; the owner
--     opens it for others in Team and access.

alter table schedules add column locked boolean not null default false;
alter table schedules add column locked_by uuid references profiles (id) on delete set null;
alter table schedules add column locked_at timestamptz;

-- ---- who may see drafts, person by person
create table schedule_draft_viewers (
  member_id uuid primary key references members (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  granted_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on schedule_draft_viewers (project_id);
alter table schedule_draft_viewers enable row level security;
revoke all on schedule_draft_viewers from anon, authenticated;
grant select, insert, delete on schedule_draft_viewers to authenticated;
create policy sdv_read on schedule_draft_viewers for select to authenticated
  using (is_owner_or_admin(project_id) or exists (select 1 from members m where m.id = member_id and m.account_id = auth.uid()));
create policy sdv_insert on schedule_draft_viewers for insert to authenticated with check (is_owner_or_admin(project_id));
create policy sdv_delete on schedule_draft_viewers for delete to authenticated using (is_owner_or_admin(project_id));

create function guard_draft_viewer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from members m where m.id = new.member_id and m.project_id = new.project_id) then
    raise exception 'That person is not on this project.';
  end if;
  if auth.uid() is not null and exists (select 1 from profiles where id = auth.uid()) then new.granted_by := auth.uid(); end if;
  return new;
end $$;
create trigger guard_draft_viewer before insert on schedule_draft_viewers for each row execute function guard_draft_viewer();

-- May the caller see unlocked (draft) schedules?
create function can_see_schedule_drafts(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_owner_or_admin(pid)
    or can_edit_section(pid, 'schedule', null)
    or exists (select 1 from schedule_draft_viewers v join members m on m.id = v.member_id
               where v.project_id = pid and m.account_id = auth.uid())
$$;
revoke execute on function can_see_schedule_drafts(uuid) from public, anon;
grant execute on function can_see_schedule_drafts(uuid) to authenticated;

-- ---- reading: locked schedules for everyone with Schedule view, drafts only for those allowed
drop policy sch_read on schedules;
create policy sch_read on schedules for select to authenticated
  using (can_view_section(project_id, 'schedule') and (locked or can_see_schedule_drafts(project_id)));

drop policy day_read on shoot_days;
create policy day_read on shoot_days for select to authenticated
  using ((can_view_section(project_id, 'schedule')
          and (can_see_schedule_drafts(project_id) or exists (select 1 from schedules s where s.id = schedule_id and s.locked)))
         or (can_view_section(project_id, 'call_sheets') and exists (select 1 from call_sheets c where c.day_id = shoot_days.id and c.rev_no > 0)));

drop policy ss_read on schedule_scenes;
create policy ss_read on schedule_scenes for select to authenticated
  using (can_view_section(project_id, 'schedule')
         and (can_see_schedule_drafts(project_id) or exists (select 1 from schedules s where s.id = schedule_id and s.locked)));

drop policy sshots_read on schedule_shots;
create policy sshots_read on schedule_shots for select to authenticated
  using (can_view_section(project_id, 'schedule')
         and (can_see_schedule_drafts(project_id) or exists (select 1 from schedules s where s.id = schedule_id and s.locked)));

-- ---- locking: a locked schedule does not change
create or replace function guard_schedule() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_at := now();
    new.locked := false; new.locked_by := null; new.locked_at := null;
  else
    if new.id <> old.id or new.project_id <> old.project_id then raise exception 'A schedule always stays in its project.'; end if;
    if old.locked and new.locked then raise exception 'schedule_locked'; end if;
    if new.locked and not old.locked then
      new.locked_at := now();
      if auth.uid() is not null and exists (select 1 from profiles where id = auth.uid()) then new.locked_by := auth.uid(); end if;
    elsif not new.locked then
      new.locked_at := null; new.locked_by := null;
    end if;
    if exists (select 1 from shoot_days d where d.schedule_id = new.id and (d.day_date < new.start_date or d.day_date > new.end_date)) then
      raise exception 'Some shoot days fall outside these dates. Move or delete them first.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create function guard_schedule_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- the project itself being deleted removes its schedules too; only a direct delete of a locked schedule is refused
  if old.locked and exists (select 1 from projects p where p.id = old.project_id) then raise exception 'schedule_locked'; end if;
  return old;
end $$;
create trigger guard_schedule_delete before delete on schedules for each row execute function guard_schedule_delete();

create function guard_schedule_locked() returns trigger
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  sid := case when tg_op = 'DELETE' then old.schedule_id else new.schedule_id end;
  if exists (select 1 from schedules s where s.id = sid and s.locked) then raise exception 'schedule_locked'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger guard_days_locked before insert or update or delete on shoot_days for each row execute function guard_schedule_locked();
create trigger guard_sscenes_locked before insert or update or delete on schedule_scenes for each row execute function guard_schedule_locked();
create trigger guard_sshots_locked before insert or update or delete on schedule_shots for each row execute function guard_schedule_locked();

-- ---- defaults: the Cast and crew list is for Production and Direction unless the owner opens it
update team_section_access a set level = 'none'::access_level
from teams t
where t.id = a.team_id and a.section = 'cast_crew' and a.level = 'view' and not t.is_ad_team and t.name <> 'Production';

create or replace function create_project(project_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid; mid uuid; tid uuid; dept text; sec section_key;
  depts text[] := array['Direction', 'Production', 'Camera', 'Lighting and grip', 'Sound',
    'Art', 'Costume', 'Makeup and hair', 'VFX', 'Post'];
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  insert into projects (name, owner_id) values (trim(project_name), auth.uid()) returning id into pid;
  insert into members (project_id, account_id, role) values (pid, auth.uid(), 'owner') returning id into mid;
  perform set_config('lineboard.aspect', 'on', true);   -- this function sets the owner teams below
  foreach dept in array depts loop
    insert into teams (project_id, name, is_ad_team) values (pid, dept, dept = 'Direction')
      returning id into tid;
    if dept = 'Camera' then update projects set bible_format_team = tid where id = pid; end if;
    if dept = 'Direction' then update projects set bible_mood_team = tid where id = pid; end if;
    foreach sec in array enum_range(null::section_key) loop
      insert into team_section_access (team_id, section, level) values (tid, sec,
        case when sec = 'bible' and dept in ('Direction', 'Camera') then 'edit'::access_level
             when sec = 'bible' then 'view'::access_level
             when sec in ('schedule', 'call_sheets') and dept in ('Direction', 'Production') then 'edit'::access_level
             when sec in ('schedule', 'call_sheets') then 'view'::access_level
             when sec = 'cast_crew' and dept in ('Direction', 'Production') then 'view'::access_level
             else 'none'::access_level end);
    end loop;
  end loop;
  insert into scene_access (member_id, mode) values (mid, 'all');
  insert into script_versions (project_id, version_no, note) values (pid, 1, 'First draft');
  return pid;
end $$;
revoke execute on function create_project(text) from public, anon;
grant execute on function create_project(text) to authenticated;
