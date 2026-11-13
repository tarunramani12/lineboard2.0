-- Teams get a fixed role tag, so rules no longer depend on what a team is called.
-- Before: costs were visible to "the team named Production", VFX and Sound fields to "the teams named VFX and Sound",
-- and the Camera team was found by name for the Project bible. Renaming a team broke those rules.
-- Now: teams.role_tag (production, camera, direction, art, vfx, sound). One team per tag per project. The owner and admins
-- set it in Team and access; new projects tag the ready-made teams. Existing teams are tagged once, from their names today.

alter table teams add column role_tag text check (role_tag in ('production', 'camera', 'direction', 'art', 'vfx', 'sound'));
update teams set role_tag = case name when 'Production' then 'production' when 'Camera' then 'camera' when 'Direction' then 'direction'
  when 'Art' then 'art' when 'VFX' then 'vfx' when 'Sound' then 'sound' end
  where name in ('Production', 'Camera', 'Direction', 'Art', 'VFX', 'Sound');
create unique index teams_role_tag_unique on teams (project_id, role_tag) where role_tag is not null;

-- Cost is for the owner, admins and anyone on the team tagged production.
create or replace function can_see_costs(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_owner_or_admin(pid) or exists (
    select 1 from members m
    join member_teams mt on mt.member_id = m.id
    join teams t on t.id = mt.team_id and t.role_tag = 'production'
    where m.project_id = pid and m.account_id = auth.uid())
$$;

-- Can the caller edit shots as the team tagged vfx or sound? The argument is the tag, in any case ('VFX', 'Sound').
create or replace function can_edit_shots_as(pid uuid, team_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams t
    where t.project_id = pid and t.role_tag = lower(team_name) and can_edit_section(pid, 'shots', t.id))
$$;

-- New projects tag their ready-made teams (this is the 0036 version of create_project plus the tags).
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
    insert into teams (project_id, name, is_ad_team, role_tag) values (pid, dept, dept = 'Direction',
      case dept when 'Direction' then 'direction' when 'Production' then 'production' when 'Camera' then 'camera' when 'Sound' then 'sound' when 'Art' then 'art' when 'VFX' then 'vfx' else null end)
      returning id into tid;
    if dept = 'Camera' then update projects set bible_format_team = tid where id = pid; end if;
    if dept = 'Direction' then update projects set bible_mood_team = tid where id = pid; end if;
    foreach sec in array enum_range(null::section_key) loop
      insert into team_section_access (team_id, section, level) values (tid, sec,
        case when sec = 'bible' and dept in ('Direction', 'Camera') then 'edit'::access_level
             when sec = 'bible' then 'view'::access_level
             when sec = 'equipment' then 'edit'::access_level
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
