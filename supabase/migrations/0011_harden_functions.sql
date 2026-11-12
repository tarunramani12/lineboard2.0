-- Two findings from the Supabase security check on migration 0006:
-- 1. guard_scene_insert is a trigger function. Triggers run it for every insert; nobody needs to call it
--    directly, so nobody can (it was open to everyone through the API).
-- 2. revision_switch_on had no fixed search path.
revoke execute on function guard_scene_insert() from public, anon, authenticated;

create or replace function revision_switch_on() returns boolean
language sql stable set search_path = public as $$
  select coalesce(current_setting('lineboard.revision', true), '') = 'on'
$$;
