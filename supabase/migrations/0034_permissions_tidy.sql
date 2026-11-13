-- Permissions tidy-up after a full audit (policies, helper functions, triggers and the security advisor).
-- The rule behind the whole model: every team gets read-only access to the sections the owner opens for it; the head of
-- department (HoD) decides which of their people inherit write access, and only when the team itself has write access to
-- something; some fields belong to one team only.
--
-- 1. Props and equipment lists belong to a schedule. A draft (unlocked) schedule is hidden from people who only view the
--    Schedule, and so are the lists built on it, unless they edit those lists themselves or may see drafts.
-- 2. A head of department cannot hand out write access (can_edit) when their team has no write access to pass on.
-- 3. Security advisor: trigger functions are not callable through the API; two functions get a fixed search path.

-- ---- 1. lists on draft schedules
drop policy items_read on schedule_items;
create policy items_read on schedule_items for select to authenticated
  using (can_view_section(project_id, item_section(kind))
         and (can_see_schedule_drafts(project_id)
              or can_edit_section(project_id, item_section(kind), team_id)
              or exists (select 1 from schedules s where s.id = schedule_id and s.locked)));

drop policy itemscenes_read on schedule_item_scenes;
-- the item row policy above already decides which items the caller may see
create policy itemscenes_read on schedule_item_scenes for select to authenticated
  using (can_view_section(project_id, item_section(item_kind_of(item_id)))
         and exists (select 1 from schedule_items i where i.id = item_id));

-- ---- 2. the head of department can only pass on write access the team has
create or replace function guard_member_teams() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  pid := team_project(new.team_id);
  if not exists (select 1 from members where id = new.member_id and project_id = pid) then
    raise exception 'That person is not on this project.';
  end if;
  if tg_op = 'INSERT' or new.is_hod is distinct from old.is_hod then
    if new.is_hod and not is_owner_or_admin(pid) then
      raise exception 'Only the owner or an admin can appoint a head of department.';
    end if;
  end if;
  if new.can_edit and (tg_op = 'INSERT' or not old.can_edit) and auth.uid() is not null and not is_owner_or_admin(pid)
     and not exists (select 1 from team_section_access a where a.team_id = new.team_id and a.level = 'edit') then
    raise exception 'Your team has no write access to pass on. The owner decides which sections a team can edit.';
  end if;
  return new;
end $$;

-- ---- 3. security advisor
revoke execute on function guard_draft_viewer(), guard_project_aspect(), guard_schedule_delete(), guard_schedule_locked() from public, anon, authenticated;
alter function item_section(item_kind) set search_path = public;
alter function mail_id_reserved(text) set search_path = public;
