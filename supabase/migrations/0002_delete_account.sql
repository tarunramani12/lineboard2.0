-- Account deletion (planning document section 7).
-- Blocked while the account owns a project. Otherwise the login and name are removed and the
-- person's rows stay on the project, shown as "Former member" (members.account_id becomes null).
create function delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if exists (select 1 from projects where owner_id = auth.uid()) then
    raise exception 'You own a project. Transfer it to another member or delete it first.';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke execute on function delete_my_account() from public, anon;
grant execute on function delete_my_account() to authenticated;
