-- Import a script (planning document section 8). The browser reads the file and shows a review
-- screen; only when the owner confirms does this function receive the scenes. One call, one
-- transaction: either every scene arrives or none does.
--
-- scenes_in: [{ "number": text|null, "heading": text, "omitted": bool, "elements": [{kind, text}] }]
-- lock_after: lock the script right away (a production script that arrives with its own numbers).
--             Scenes without a number are numbered by lock_script, in script order.
-- Only the owner can import. A locked script cannot be imported into: new drafts need the
-- matching step (old scenes against new), which is built separately.
create function import_script(pid uuid, scenes_in jsonb, lock_after boolean default false) returns integer
language plpgsql security definer set search_path = public as $$
declare
  s jsonb;
  sid uuid;
  base integer;
  n integer := 0;
  num text;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not is_owner(pid) then raise exception 'Only the owner can import a script.'; end if;
  if jsonb_typeof(scenes_in) is distinct from 'array' then raise exception 'bad_import'; end if;
  if jsonb_array_length(scenes_in) = 0 then raise exception 'bad_import'; end if;
  if jsonb_array_length(scenes_in) > 2000 then raise exception 'import_too_large'; end if;
  if (select script_locked from projects where id = pid) then raise exception 'import_needs_matching'; end if;
  if exists (
    select 1 from jsonb_array_elements(scenes_in) x
    where jsonb_typeof(x) is distinct from 'object'
       or jsonb_typeof(x->'heading') is distinct from 'string'
       or jsonb_typeof(x->'elements') is distinct from 'array'
       or exists (
         select 1 from jsonb_array_elements(x->'elements') e
         where jsonb_typeof(e) is distinct from 'object'
            or e->>'kind' is null or e->>'kind' not in ('action', 'character', 'dialogue', 'parenthetical', 'transition')
            or jsonb_typeof(e->'text') is distinct from 'string')
  ) then raise exception 'bad_import'; end if;

  select coalesce(max(sort_order), 0) into base from scenes where project_id = pid;
  for s in select * from jsonb_array_elements(scenes_in) loop
    n := n + 1;
    num := nullif(trim(coalesce(s->>'number', '')), '');
    insert into scenes (project_id, display_number, heading, status, sort_order)
      values (pid, num, trim(s->>'heading'),
              case when coalesce((s->>'omitted')::boolean, false) then 'omitted'::scene_status else 'active'::scene_status end,
              base + n * 10)
      returning id into sid;
    if jsonb_array_length(s->'elements') > 0 then
      insert into scene_text (scene_id, elements, rev, updated_by) values (sid, s->'elements', 1, auth.uid());
    end if;
  end loop;
  if lock_after then perform lock_script(pid); end if;
  return n;
end $$;

revoke execute on function import_script(uuid, jsonb, boolean) from public, anon;
grant execute on function import_script(uuid, jsonb, boolean) to authenticated;
