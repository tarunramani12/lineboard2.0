-- Schedule (planning document section 15).
-- A project has schedules. A schedule is a block of shoot days (name, start and end date). Each shoot day has
-- a date, a location and notes. Scenes are placed on shoot days by scene id (a scene is on one day per schedule).
-- Cast can be marked unavailable on dates.
--
-- Who may do what, enforced here:
--   * Anyone with view access to Schedule reads everything.
--   * Editors of Schedule (edit level for their team, plus HOD or an edit grant, and the owner and admins) change it.
--   * By default Production and the AD team (Direction) edit Schedule and Call sheets. The owner changes this in Team and access.
--   * Cast unavailability is edited by Schedule editors and by the Cast and crew editors of that row's team.

-- Defaults for new projects: Production and the AD team edit Schedule and Call sheets; everyone views them.
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
  foreach dept in array depts loop
    insert into teams (project_id, name, is_ad_team) values (pid, dept, dept = 'Direction')
      returning id into tid;
    foreach sec in array enum_range(null::section_key) loop
      insert into team_section_access (team_id, section, level) values (tid, sec,
        case when sec in ('schedule', 'call_sheets') and dept in ('Direction', 'Production') then 'edit'::access_level
             when sec in ('schedule', 'call_sheets', 'cast_crew') then 'view'::access_level
             else 'none'::access_level end);
    end loop;
  end loop;
  insert into scene_access (member_id, mode) values (mid, 'all');
  insert into script_versions (project_id, version_no, note) values (pid, 1, 'First draft');
  return pid;
end $$;
revoke execute on function create_project(text) from public, anon;
grant execute on function create_project(text) to authenticated;

-- Existing projects: the same defaults for Direction and Production where Schedule or Call sheets still sit at view.
update team_section_access a set level = 'edit'
from teams t
where a.team_id = t.id and t.name in ('Direction', 'Production') and a.section in ('schedule', 'call_sheets') and a.level = 'view';

create table schedules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  start_date date not null,
  end_date date not null,
  notes text not null default '' check (length(notes) <= 500),
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date and end_date - start_date <= 400)
);
create index on schedules (project_id);

create table shoot_days (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  schedule_id uuid not null references schedules (id) on delete cascade,
  day_date date not null,
  location text not null default '' check (length(location) <= 200),
  notes text not null default '' check (length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_id, day_date)
);
create index on shoot_days (project_id);

create table schedule_scenes (
  schedule_id uuid not null references schedules (id) on delete cascade,
  scene_id uuid not null references scenes (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  day_id uuid not null references shoot_days (id) on delete cascade,
  sort_order integer not null default 0,
  primary key (schedule_id, scene_id)
);
create index on schedule_scenes (day_id);
create index on schedule_scenes (project_id);

create table cast_unavailable (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  row_id uuid not null references cast_crew_rows (id) on delete cascade,
  on_date date not null,
  note text not null default '' check (length(note) <= 200),
  unique (row_id, on_date)
);
create index on cast_unavailable (project_id);

alter table schedules enable row level security;
alter table shoot_days enable row level security;
alter table schedule_scenes enable row level security;
alter table cast_unavailable enable row level security;
revoke all on schedules, shoot_days, schedule_scenes, cast_unavailable from anon, authenticated;
grant select, insert, update, delete on schedules, shoot_days, schedule_scenes, cast_unavailable to authenticated;

create policy sch_read on schedules for select to authenticated using (can_view_section(project_id, 'schedule'));
create policy sch_insert on schedules for insert to authenticated with check (can_edit_section(project_id, 'schedule', null));
create policy sch_update on schedules for update to authenticated
  using (can_edit_section(project_id, 'schedule', null)) with check (can_edit_section(project_id, 'schedule', null));
create policy sch_delete on schedules for delete to authenticated using (can_edit_section(project_id, 'schedule', null));

create policy day_read on shoot_days for select to authenticated using (can_view_section(project_id, 'schedule'));
create policy day_insert on shoot_days for insert to authenticated with check (can_edit_section(project_id, 'schedule', null));
create policy day_update on shoot_days for update to authenticated
  using (can_edit_section(project_id, 'schedule', null)) with check (can_edit_section(project_id, 'schedule', null));
create policy day_delete on shoot_days for delete to authenticated using (can_edit_section(project_id, 'schedule', null));

create policy ss_read on schedule_scenes for select to authenticated using (can_view_section(project_id, 'schedule'));
create policy ss_insert on schedule_scenes for insert to authenticated with check (can_edit_section(project_id, 'schedule', null));
create policy ss_update on schedule_scenes for update to authenticated
  using (can_edit_section(project_id, 'schedule', null)) with check (can_edit_section(project_id, 'schedule', null));
create policy ss_delete on schedule_scenes for delete to authenticated using (can_edit_section(project_id, 'schedule', null));

create policy un_read on cast_unavailable for select to authenticated
  using (can_view_section(project_id, 'schedule') or can_view_section(project_id, 'cast_crew'));
create policy un_insert on cast_unavailable for insert to authenticated
  with check (project_id = (select project_id from cast_crew_rows where id = row_id)
    and (can_edit_section(project_id, 'schedule', null) or can_edit_section(project_id, 'cast_crew', cast_row_team(row_id))));
create policy un_update on cast_unavailable for update to authenticated
  using (can_edit_section(project_id, 'schedule', null) or can_edit_section(project_id, 'cast_crew', cast_row_team(row_id)))
  with check (can_edit_section(project_id, 'schedule', null) or can_edit_section(project_id, 'cast_crew', cast_row_team(row_id)));
create policy un_delete on cast_unavailable for delete to authenticated
  using (can_edit_section(project_id, 'schedule', null) or can_edit_section(project_id, 'cast_crew', cast_row_team(row_id)));

create function guard_schedule() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_at := now();
  else
    if new.id <> old.id or new.project_id <> old.project_id then raise exception 'A schedule always stays in its project.'; end if;
    if exists (select 1 from shoot_days d where d.schedule_id = new.id and (d.day_date < new.start_date or d.day_date > new.end_date)) then
      raise exception 'Some shoot days fall outside these dates. Move or delete them first.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger guard_schedule before insert or update on schedules for each row execute function guard_schedule();

create function guard_shoot_day() returns trigger
language plpgsql security definer set search_path = public as $$
declare s schedules;
begin
  select * into s from schedules where id = new.schedule_id;
  if not found or s.project_id <> new.project_id then raise exception 'That schedule is not in this project.'; end if;
  if tg_op = 'UPDATE' and (new.schedule_id <> old.schedule_id or new.project_id <> old.project_id) then
    raise exception 'A shoot day always stays in its schedule.';
  end if;
  if new.day_date < s.start_date or new.day_date > s.end_date then
    raise exception 'That date is outside the schedule.';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger guard_shoot_day before insert or update on shoot_days for each row execute function guard_shoot_day();

create function guard_schedule_scene() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from shoot_days d where d.id = new.day_id and d.schedule_id = new.schedule_id and d.project_id = new.project_id) then
    raise exception 'That shoot day is not in this schedule.';
  end if;
  if not exists (select 1 from scenes s where s.id = new.scene_id and s.project_id = new.project_id and s.status = 'active') then
    raise exception 'Only active scenes of this project can be scheduled.';
  end if;
  if tg_op = 'UPDATE' and (new.scene_id <> old.scene_id or new.schedule_id <> old.schedule_id or new.project_id <> old.project_id) then
    raise exception 'A scheduled scene keeps its scene and schedule.';
  end if;
  return new;
end $$;
create trigger guard_schedule_scene before insert or update on schedule_scenes for each row execute function guard_schedule_scene();

revoke execute on function guard_schedule(), guard_shoot_day(), guard_schedule_scene() from public, anon, authenticated;
