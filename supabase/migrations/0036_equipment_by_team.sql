-- Equipment belongs to the team that lists it (owner decision).
--   * Every team has access to the Equipment section (edit level, so its head of department edits what the team lists).
--   * An equipment item carries the team that created it. A team sees only its own team's equipment; the Admin sees all.
--   * Props are unchanged (still readable across teams).
-- This also carries the draft-schedule rule from 0034 for the items policies, so the two stay together.

-- every existing team gets the Equipment section at edit level (its head edits; people the head allows)
update team_section_access set level = 'edit'::access_level where section = 'equipment';

-- is the caller in this team?
create function in_team(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from member_teams mt join members m on m.id = mt.member_id
                 where mt.team_id = tid and m.account_id = auth.uid())
$$;
revoke execute on function in_team(uuid) from public, anon;
grant execute on function in_team(uuid) to authenticated;

drop policy items_read on schedule_items;
create policy items_read on schedule_items for select to authenticated
  using (can_view_section(project_id, item_section(kind))
         and (kind <> 'equipment' or is_owner_or_admin(project_id) or in_team(team_id))
         and (can_see_schedule_drafts(project_id)
              or can_edit_section(project_id, item_section(kind), team_id)
              or exists (select 1 from schedules s where s.id = schedule_id and s.locked)));

drop policy itemscenes_read on schedule_item_scenes;
create policy itemscenes_read on schedule_item_scenes for select to authenticated
  using (can_view_section(project_id, item_section(item_kind_of(item_id)))
         and exists (select 1 from schedule_items i where i.id = item_id));

-- a cost is visible only together with the item it belongs to
drop policy itemcost_read on schedule_item_costs;
create policy itemcost_read on schedule_item_costs for select to authenticated
  using (can_see_costs(project_id) and exists (select 1 from schedule_items i where i.id = item_id));

-- new projects: every team has Equipment at edit level (this is the 0031 version of create_project plus that)
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
