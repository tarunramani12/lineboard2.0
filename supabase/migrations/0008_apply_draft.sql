-- Apply a new draft to a script that already has scenes (planning document section 9).
-- The browser matches the new draft's scenes to the existing ones and shows the owner the result.
-- Only when the owner approves does this function receive the plan, in final script order:
--   { "op": "update", "id": uuid, "heading": text, "elements": [...] }   matched scene: new heading and text
--   { "op": "insert", "number": text|null, "heading": text, "elements": [...] }   scene not in the old script
--   { "op": "keep",   "id": uuid }                                         untouched, only its place in the order
--   { "op": "omit",   "id": uuid }                                         cut from the new draft: marked omitted, keeps its number
--   { "op": "remove", "id": uuid }                                         unlocked scripts only: deleted
-- One transaction: either the whole plan applies or nothing does. Scene ids and numbers never change.
-- After the lock, changed lines are marked in the revision in progress, and changed scenes are tagged.

-- The marking rule used when saving a scene, reusable for whole drafts.
create function revise_elements(old_elements jsonb, new_elements jsonb, locked boolean, rno integer) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  marked jsonb;
  changed boolean;
begin
  old_elements := coalesce(old_elements, '[]'::jsonb);
  select coalesce(jsonb_agg(
           case
             when o.found then jsonb_strip_nulls(jsonb_build_object('kind', n.kind, 'text', n.txt, 'rev', o.rev))
             when locked then jsonb_build_object('kind', n.kind, 'text', n.txt, 'rev', rno)
             else jsonb_build_object('kind', n.kind, 'text', n.txt)
           end order by n.ord), '[]'::jsonb),
         coalesce(bool_or(o.found is null), false)
    into marked, changed
  from (
    select ord, e->>'kind' as kind, e->>'text' as txt
    from jsonb_array_elements(new_elements) with ordinality as t(e, ord)
  ) n
  left join lateral (
    select true as found, (x->>'rev')::integer as rev
    from jsonb_array_elements(old_elements) x
    where x->>'kind' = n.kind and x->>'text' = n.txt
    limit 1
  ) o on true;
  if jsonb_array_length(marked) <> jsonb_array_length(old_elements) then changed := true; end if;
  return jsonb_build_object('marked', marked, 'changed', changed);
end $$;

create function apply_draft(pid uuid, plan jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  locked boolean;
  rno integer;
  it jsonb;
  i integer := 0;
  sid uuid;
  op text;
  old_text jsonb;
  old_rev integer;
  old_heading text;
  r jsonb;
  els jsonb;
  c_upd integer := 0; c_ins integer := 0; c_omit integer := 0; c_rem integer := 0;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not is_owner(pid) then raise exception 'Only the owner can apply a new draft.'; end if;
  if jsonb_typeof(plan) is distinct from 'array' or jsonb_array_length(plan) = 0 then raise exception 'bad_plan'; end if;
  if jsonb_array_length(plan) > 4000 then raise exception 'import_too_large'; end if;
  select script_locked, revision_no into locked, rno from projects where id = pid;

  -- validate the whole plan before touching anything
  for it in select * from jsonb_array_elements(plan) loop
    op := it->>'op';
    if op is null or op not in ('update', 'insert', 'keep', 'omit', 'remove') then raise exception 'bad_plan'; end if;
    if op = 'remove' and locked then raise exception 'The script is locked. Cut scenes are marked omitted, not deleted.'; end if;
    if op in ('update', 'keep', 'omit', 'remove') then
      begin sid := (it->>'id')::uuid; exception when others then raise exception 'bad_plan'; end;
      if not exists (select 1 from scenes where id = sid and project_id = pid) then raise exception 'bad_plan'; end if;
      if exists (select 1 from scene_locks where scene_id = sid and holder <> auth.uid() and expires_at > now()) then
        raise exception 'scene_busy';
      end if;
    end if;
    if op in ('update', 'insert') then
      if jsonb_typeof(it->'heading') is distinct from 'string' or jsonb_typeof(it->'elements') is distinct from 'array' then
        raise exception 'bad_plan';
      end if;
      if exists (
        select 1 from jsonb_array_elements(it->'elements') e
        where jsonb_typeof(e) is distinct from 'object'
           or e->>'kind' is null or e->>'kind' not in ('action', 'character', 'dialogue', 'parenthetical', 'transition')
           or jsonb_typeof(e->'text') is distinct from 'string'
      ) then raise exception 'bad_plan'; end if;
    end if;
  end loop;

  -- phase 1: scenes that already exist (final place in the order, new text, omitted, removed)
  perform set_config('lineboard.revision', 'on', true);
  for it in select * from jsonb_array_elements(plan) loop
    i := i + 1;
    op := it->>'op';
    if op = 'insert' then continue; end if;
    sid := (it->>'id')::uuid;
    if op = 'remove' then
      delete from scenes where id = sid;
      c_rem := c_rem + 1;
      continue;
    end if;
    update scenes set sort_order = i * 10 where id = sid;
    if op = 'omit' then
      update scenes set status = 'omitted', revised_in = case when locked then rno else revised_in end where id = sid;
      c_omit := c_omit + 1;
    elsif op = 'update' then
      select heading into old_heading from scenes where id = sid;
      select elements, rev into old_text, old_rev from scene_text where scene_id = sid;
      r := revise_elements(old_text, it->'elements', locked, rno);
      els := r->'marked';
      update scenes set heading = trim(it->>'heading'), status = 'active' where id = sid;
      if old_text is null and jsonb_array_length(els) = 0 then
        null;
      else
        insert into scene_text (scene_id, elements, rev, updated_by, updated_at)
          values (sid, els, coalesce(old_rev, 0) + 1, auth.uid(), now())
        on conflict (scene_id) do update
          set elements = excluded.elements, rev = excluded.rev, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
      end if;
      if locked and ((r->>'changed')::boolean or old_heading is distinct from trim(it->>'heading')) then
        update scenes set revised_in = rno where id = sid;
      end if;
      c_upd := c_upd + 1;
    end if;
  end loop;

  -- phase 2: new scenes, in order, so each is numbered from the scenes around it
  i := 0;
  for it in select * from jsonb_array_elements(plan) loop
    i := i + 1;
    if it->>'op' <> 'insert' then continue; end if;
    r := revise_elements('[]'::jsonb, it->'elements', locked, rno);
    insert into scenes (project_id, display_number, heading, status, sort_order)
      values (pid, nullif(trim(coalesce(it->>'number', '')), ''), trim(it->>'heading'), 'active', i * 10)
      returning id into sid;
    if jsonb_array_length(r->'marked') > 0 then
      insert into scene_text (scene_id, elements, rev, updated_by) values (sid, r->'marked', 1, auth.uid());
    end if;
    if locked then update scenes set revised_in = rno where id = sid; end if;
    c_ins := c_ins + 1;
  end loop;
  perform set_config('lineboard.revision', '', true);

  update projects set draft_no = draft_no + 1 where id = pid;
  return jsonb_build_object('updated', c_upd, 'inserted', c_ins, 'omitted', c_omit, 'removed', c_rem);
end $$;

revoke execute on function revise_elements(jsonb, jsonb, boolean, integer), apply_draft(uuid, jsonb) from public, anon;
grant execute on function apply_draft(uuid, jsonb) to authenticated;
