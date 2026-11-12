-- Renumber the whole script 1, 2, 3 ... in script order. Only while the script is unlocked:
-- numbers are provisional until the owner locks it. Done in two steps because a scene number
-- must stay unique at every moment, so 2 -> 3 cannot run while another scene is still 3.
create function renumber_scenes(pid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not can_edit_section(pid, 'script', null) then raise exception 'You cannot edit this script.'; end if;
  if (select script_locked from projects where id = pid) then
    raise exception 'The script is locked, so scene numbers cannot change.';
  end if;
  update scenes set display_number = '~' || id::text where project_id = pid;
  update scenes s set display_number = n.rn::text
  from (select id, row_number() over (order by sort_order, created_at, id) as rn from scenes where project_id = pid) n
  where s.id = n.id;
end $$;

revoke execute on function renumber_scenes(uuid) from public, anon;
grant execute on function renumber_scenes(uuid) to authenticated;
