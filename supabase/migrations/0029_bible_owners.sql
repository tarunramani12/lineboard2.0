-- Project bible: who owns which part (owner decision).
--   * Format (aspect ratio, frame rate and the other facts of the film): owned by the Camera team. The DoP (head of
--     department) and the people the DoP allows (an edit grant) change it.
--   * Moodboard: owned by the Direction team (the AD team), by its head of department and the people they allow.
--   * Everyone else reads. The owner and admins always edit and can hand either part to another team.
-- Each part is owned by one team, stored on the project. Editing still needs that team's edit level for the Project bible
-- plus HOD or an edit grant (can_edit_section), exactly as shots do.

alter table projects add column bible_format_team uuid references teams (id) on delete set null;
alter table projects add column bible_mood_team uuid references teams (id) on delete set null;

-- Existing projects: Camera owns the format (by name), the AD team owns the moodboard.
update projects p set bible_format_team = (select t.id from teams t where t.project_id = p.id and t.name = 'Camera' order by t.created_at limit 1);
update projects p set bible_mood_team = (select t.id from teams t where t.project_id = p.id and t.is_ad_team order by t.created_at limit 1);
-- The Camera team needs the edit level on the Project bible to edit its part; Direction already has it.
update team_section_access a set level = 'edit'::access_level
from teams t where t.id = a.team_id and a.section = 'bible' and t.name = 'Camera' and a.level = 'view';

-- May the caller edit this part ('format' or 'mood') of the Project bible?
create function can_edit_bible_area(pid uuid, area text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare owner_team uuid;
begin
  if is_owner_or_admin(pid) then return true; end if;
  select case when area = 'format' then bible_format_team when area = 'mood' then bible_mood_team end into owner_team from projects where id = pid;
  if owner_team is null then return false; end if;
  return can_edit_section(pid, 'bible', owner_team);
end $$;
revoke execute on function can_edit_bible_area(uuid, text) from public, anon;
grant execute on function can_edit_bible_area(uuid, text) to authenticated;

-- Policies: the Format table follows the 'format' owner, moodboard cards and files follow the 'mood' owner.
drop policy bible_insert on project_bible;
drop policy bible_update on project_bible;
create policy bible_insert on project_bible for insert to authenticated with check (can_edit_bible_area(project_id, 'format'));
create policy bible_update on project_bible for update to authenticated
  using (can_edit_bible_area(project_id, 'format')) with check (can_edit_bible_area(project_id, 'format'));

drop policy mood_insert on moodboard_items;
drop policy mood_update on moodboard_items;
drop policy mood_delete on moodboard_items;
create policy mood_insert on moodboard_items for insert to authenticated with check (can_edit_bible_area(project_id, 'mood'));
create policy mood_update on moodboard_items for update to authenticated
  using (can_edit_bible_area(project_id, 'mood')) with check (can_edit_bible_area(project_id, 'mood'));
create policy mood_delete on moodboard_items for delete to authenticated using (can_edit_bible_area(project_id, 'mood'));

create or replace function can_edit_bible_path(file_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare parts text[];
begin
  parts := string_to_array(file_name, '/');
  if array_length(parts, 1) < 2 then return false; end if;
  return can_edit_bible_area(parts[1]::uuid, 'mood');
exception when others then
  return false;
end $$;

-- The aspect ratio is part of the format.
create or replace function set_aspect_ratio(pid uuid, ratio text) returns void
language plpgsql security definer set search_path = public as $$
declare w numeric; h numeric;
begin
  if not can_edit_bible_area(pid, 'format') then raise exception 'You cannot change the format of this project.'; end if;
  if ratio is null or ratio !~ '^[0-9]{1,2}(\.[0-9]{1,3})?:[0-9]{1,2}(\.[0-9]{1,3})?$' then raise exception 'bad_ratio'; end if;
  w := split_part(ratio, ':', 1)::numeric; h := split_part(ratio, ':', 2)::numeric;
  if w <= 0 or h <= 0 or w / h > 4 or h / w > 4 then raise exception 'bad_ratio'; end if;
  perform set_config('lineboard.aspect', 'on', true);
  update projects set aspect_ratio = ratio where id = pid;
end $$;

-- Handing a part to another team: owner and admins only.
create function set_bible_owner(pid uuid, area text, team_in uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_or_admin(pid) then raise exception 'Only the owner or an admin can choose who owns this.'; end if;
  if area not in ('format', 'mood') then raise exception 'bad_area'; end if;
  if team_in is not null and team_project(team_in) is distinct from pid then raise exception 'That team is not on this project.'; end if;
  perform set_config('lineboard.aspect', 'on', true);
  if area = 'format' then update projects set bible_format_team = team_in where id = pid;
  else update projects set bible_mood_team = team_in where id = pid; end if;
end $$;
revoke execute on function set_bible_owner(uuid, text, uuid) from public, anon;
grant execute on function set_bible_owner(uuid, text, uuid) to authenticated;

-- The owner columns, like the aspect ratio, change only through the function above.
create or replace function guard_project_aspect() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.aspect_ratio is distinct from old.aspect_ratio or new.bible_format_team is distinct from old.bible_format_team or new.bible_mood_team is distinct from old.bible_mood_team)
     and coalesce(current_setting('lineboard.aspect', true), '') <> 'on' and auth.uid() is not null
     and not (new.bible_format_team is distinct from old.bible_format_team and new.bible_format_team is null and not exists (select 1 from teams where id = old.bible_format_team))
     and not (new.bible_mood_team is distinct from old.bible_mood_team and new.bible_mood_team is null and not exists (select 1 from teams where id = old.bible_mood_team)) then
    raise exception 'Change the aspect ratio and the owners in the Project bible.';
  end if;
  return new;
end $$;

-- New projects: Camera owns the format, the AD team owns the moodboard; both have the edit level, everyone else views.
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
