-- Project bible defaults (owner decision): the Direction team (the AD team) edits; every other team reads.
-- Replaces the 0027 defaults (Direction and Camera edit, others no access). The owner can still change any team in Team and access.

-- Projects made while 0027 was in place: other teams move from "none" or "edit" to "view"; Direction keeps edit.
update team_section_access a
set level = 'view'::access_level
from teams t
where t.id = a.team_id and a.section = 'bible' and not t.is_ad_team and a.level in ('none', 'edit');

-- New projects (the 0027 version of create_project with the new Project bible defaults).
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
        case when sec = 'bible' and dept = 'Direction' then 'edit'::access_level
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
