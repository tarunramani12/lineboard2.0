-- Fix for 0014: deleting a whole project failed when it held cast rows that came from the script,
-- because the row guard refused to delete them one by one. A row may now go when its project is going.
create or replace function guard_cast_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if system_switch_on() then if tg_op = 'DELETE' then return old; end if; return new; end if;
  if tg_op = 'DELETE' then
    if old.auto and exists (select 1 from projects where id = old.project_id) then
      raise exception 'This cast row came from the script and cannot be deleted.';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_at := now();
    if new.auto then raise exception 'Use Detect cast to add cast from the script.'; end if;
  else
    if new.id <> old.id or new.project_id <> old.project_id or new.created_by is distinct from old.created_by
       or new.created_at <> old.created_at or new.auto <> old.auto then
      raise exception 'A row''s project never changes.';
    end if;
    if new.team_id <> old.team_id and not is_owner_or_admin(old.project_id) then
      raise exception 'Only the owner or an admin can move a row to another team.';
    end if;
    if old.auto and (new.role <> old.role or new.kind <> old.kind) then
      raise exception 'The character of a cast row from the script cannot be changed.';
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
