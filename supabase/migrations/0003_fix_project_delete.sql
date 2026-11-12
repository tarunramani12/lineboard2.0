-- Fix: deleting a project removed its member rows one by one, and the "owner cannot be removed"
-- safeguard blocked it. The safeguard now applies only while the project still exists.
create or replace function guard_members() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    -- The whole project is being deleted: its members go with it.
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
    if new.role is distinct from old.role then
      if old.role = 'owner' or new.role = 'owner' then
        raise exception 'Ownership changes only by transfer.';
      end if;
      if not is_owner(old.project_id) then raise exception 'Only the owner can change admins.'; end if;
    end if;
  end if;
  return new;
end $$;
