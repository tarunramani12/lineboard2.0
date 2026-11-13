-- Simpler roles (owner decision).
--   * The Admin (the person who created the project, shown as "Admin" in the app) invites people by email and chooses, per
--     invite, whether the person joins their team as head of department (HoD) or as a normal member.
--     A head of department cannot invite another head.
--   * Access requests: a normal member's request goes to the HoD of their team (an Admin can also decide it);
--     a HoD's own request goes to the Admins only.

alter table invites add column is_hod boolean not null default false;

create function guard_invite() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_hod and (tg_op = 'INSERT' or new.is_hod is distinct from old.is_hod) and not is_owner_or_admin(new.project_id) then
    raise exception 'Only an admin can invite someone as head of department.';
  end if;
  return new;
end $$;
revoke execute on function guard_invite() from public, anon, authenticated;
create trigger guard_invite before insert or update on invites for each row execute function guard_invite();

-- appointing a head stays an admin action; accepting an invite an admin made as "head" is that action carried out
create or replace function guard_member_teams() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  pid := team_project(new.team_id);
  if not exists (select 1 from members where id = new.member_id and project_id = pid) then
    raise exception 'That person is not on this project.';
  end if;
  if tg_op = 'INSERT' or new.is_hod is distinct from old.is_hod then
    if new.is_hod and not is_owner_or_admin(pid) and coalesce(current_setting('lineboard.invite', true), '') <> 'on' then
      raise exception 'Only the owner or an admin can appoint a head of department.';
    end if;
  end if;
  if new.can_edit and (tg_op = 'INSERT' or not old.can_edit) and auth.uid() is not null and not is_owner_or_admin(pid)
     and not new.is_hod
     and not exists (select 1 from team_section_access a where a.team_id = new.team_id and a.level = 'edit') then
    raise exception 'Your team has no write access to pass on. The owner decides which sections a team can edit.';
  end if;
  return new;
end $$;

create or replace function accept_pending_invites() returns setof uuid
language plpgsql security definer set search_path = public as $$
declare inv invites; mail text; mid uuid;
begin
  select lower(email) into mail from auth.users
    where id = auth.uid() and email_confirmed_at is not null;
  if mail is null then return; end if;
  for inv in select * from invites
      where email = mail and accepted_at is null and expires_at > now() loop
    insert into members (project_id, account_id, role, invited_by)
      values (inv.project_id, auth.uid(), 'member', inv.invited_by)
      on conflict (project_id, account_id) do nothing;
    select id into mid from members where project_id = inv.project_id and account_id = auth.uid();
    perform set_config('lineboard.invite', case when inv.is_hod then 'on' else 'off' end, true);
    insert into member_teams (member_id, team_id, is_hod) values (mid, inv.team_id, inv.is_hod)
      on conflict (member_id, team_id) do update set is_hod = member_teams.is_hod or excluded.is_hod;
    perform set_config('lineboard.invite', 'off', true);
    insert into scene_access (member_id, mode) values (mid, 'none') on conflict do nothing;
    update invites set accepted_at = now() where id = inv.id;
    return next inv.project_id;
  end loop;
end $$;
revoke execute on function accept_pending_invites() from public, anon;
grant execute on function accept_pending_invites() to authenticated;

-- a HoD's own request goes to the admins only; a member's goes to the HoD of their team (who holds at least read-only access to the page)
create or replace function can_decide_access_for(mid uuid, sec section_key) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members m where m.id = mid and is_owner_or_admin(m.project_id))
      or (not exists (select 1 from member_teams h where h.member_id = mid and h.is_hod)
          and exists (select 1 from member_teams mt where mt.member_id = mid and is_hod_of(mt.team_id))
          and exists (select 1 from members m where m.id = mid and my_section_level(m.project_id, sec) <> 'none'))
$$;
