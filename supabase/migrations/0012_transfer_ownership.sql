-- Transfer a project to another person.
-- Only the owner can do it, only to an admin of the same project who has an account (make the person an admin first).
-- The old owner becomes an admin. Ownership never changes by any other route: the triggers still refuse it unless
-- this function has switched the transfer on for its own transaction.

create function ownership_switch_on() returns boolean
language sql stable set search_path = public as $$
  select coalesce(current_setting('lineboard.transfer', true), '') = 'on'
$$;

create or replace function guard_members() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from projects where id = old.project_id) then return old; end if;
    if old.role = 'owner' then raise exception 'The owner cannot be removed.'; end if;
    if old.role = 'admin' and not is_owner(old.project_id) and old.account_id is distinct from auth.uid() then
      raise exception 'Only the owner can remove an admin.';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.project_id <> old.project_id or new.account_id is distinct from old.account_id
       and new.account_id is not null then
      raise exception 'A member row cannot be moved.';
    end if;
    if new.role is distinct from old.role and not ownership_switch_on() then
      if old.role = 'owner' or new.role = 'owner' then
        raise exception 'Ownership changes only by transfer.';
      end if;
      if not is_owner(old.project_id) then raise exception 'Only the owner can change admins.'; end if;
    end if;
  end if;
  return new;
end $$;

create or replace function guard_projects() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id <> old.owner_id and not ownership_switch_on() then
    raise exception 'Ownership changes only by transfer.';
  end if;
  if new.script_locked is distinct from old.script_locked and not is_owner(old.id) then
    raise exception 'Only the owner can lock or unlock the script.';
  end if;
  if new.script_locked and not old.script_locked
     and exists (select 1 from scenes where project_id = old.id and display_number is null) then
    raise exception 'Use Lock script: every scene is numbered when the script is locked.';
  end if;
  if new.revision_no is distinct from old.revision_no and not revision_switch_on() then
    raise exception 'The revision changes only by starting the next revision.';
  end if;
  return new;
end $$;

create function transfer_ownership(pid uuid, to_member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare target_account uuid; target_role project_role;
begin
  if not is_owner(pid) then raise exception 'Only the owner can transfer the project.'; end if;
  select account_id, role into target_account, target_role from members where id = to_member and project_id = pid;
  if not found then raise exception 'That person is not on this project.'; end if;
  if target_account is null then raise exception 'That person has no account any more.'; end if;
  if target_role <> 'admin' then raise exception 'Make the person an admin first, then transfer the project.'; end if;
  perform set_config('lineboard.transfer', 'on', true);
  update members set role = 'admin' where project_id = pid and role = 'owner';
  update members set role = 'owner' where id = to_member;
  update projects set owner_id = target_account where id = pid;
  perform set_config('lineboard.transfer', 'off', true);
end $$;

revoke execute on function transfer_ownership(uuid, uuid), ownership_switch_on() from public, anon;
grant execute on function transfer_ownership(uuid, uuid) to authenticated;
