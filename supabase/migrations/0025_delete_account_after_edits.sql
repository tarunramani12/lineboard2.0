-- Deleting an account failed for anyone who had edited a row (cast and crew, shots, breakdown, schedule, call sheets).
-- The database empties "created by" and "updated by" when the person goes, but the row guards either refused that change
-- or stamped the person's own id back, which no longer exists. Raising the system switch and clearing the signed-in identity
-- just before the delete lets the columns go empty, which is what we want. Nothing else changes: owners still have to transfer or delete projects first.
create or replace function delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if exists (select 1 from projects where owner_id = me) then
    raise exception 'You own a project. Transfer it to another member or delete it first.';
  end if;
  perform set_config('lineboard.system', 'on', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  delete from auth.users where id = me;
end $$;
revoke execute on function delete_my_account() from public, anon;
grant execute on function delete_my_account() to authenticated;

-- The cast and crew guard refused the emptying of "created by". Emptying it (and only that) is allowed now.
create or replace function guard_cast_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if system_switch_on() then if tg_op = 'DELETE' then return old; end if; return new; end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_at := now();
    if new.auto then raise exception 'Use Detect cast to add cast from the script.'; end if;
  else
    if new.id <> old.id or new.project_id <> old.project_id
       or (new.created_by is distinct from old.created_by and new.created_by is not null)
       or new.created_at <> old.created_at or new.auto <> old.auto then
      raise exception 'A row''s project never changes.';
    end if;
    if new.team_id <> old.team_id and not is_owner_or_admin(old.project_id) then
      raise exception 'Only the owner or an admin can move a row to another team.';
    end if;
  end if;
  if new.account_id is not null then
    if not exists (select 1 from members where project_id = new.project_id and account_id = new.account_id) then
      raise exception 'That person is not on this project.';
    end if;
    new.from_account := true;
  end if;
  new.updated_by := auth.uid(); new.updated_at := now();
  return new;
end $$;
revoke execute on function guard_cast_row() from public, anon, authenticated;
