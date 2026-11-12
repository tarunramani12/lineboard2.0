-- Scene numbers are given when the owner locks the script, as in Final Draft, and after the lock
-- nothing is renumbered. Before the lock a scene has no number (display_number is null) and adding
-- or removing scenes has no numbering effect. After the lock a scene written between two others
-- takes a letter (2A, 2B), one added at the end takes the next whole number, and one added before
-- the first scene takes A1, B1. Text edits after the lock are tracked as revisions per scene
-- (Blue, Pink, ...), with the changed lines marked.

drop function if exists renumber_scenes(uuid);

alter table scenes alter column display_number drop not null;
alter table scenes drop constraint if exists scenes_display_number_check;
alter table scenes add constraint scenes_display_number_check
  check (display_number is null or length(trim(display_number)) > 0);

-- Revision in progress (0 = never locked) and the latest revision that changed each scene's text.
alter table projects add column revision_no integer not null default 0;
alter table scenes add column revised_in integer;

-- ---------------------------------------------------------------------------
-- The number a scene gets at a given place in the script, from the numbered scenes around it.
-- ---------------------------------------------------------------------------
create function next_scene_number(pid uuid, sid uuid, srt integer, made timestamptz) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  prev text; nxt text; base text; l text; m text; cand text; parts text[];
begin
  select display_number into prev from scenes
    where project_id = pid and id <> sid and display_number is not null and (sort_order, created_at, id) < (srt, made, sid)
    order by sort_order desc, created_at desc, id desc limit 1;
  select display_number into nxt from scenes
    where project_id = pid and id <> sid and display_number is not null and (sort_order, created_at, id) > (srt, made, sid)
    order by sort_order, created_at, id limit 1;

  if prev is null and nxt is null then return '1'; end if;

  -- after the last numbered scene: the next whole number
  if nxt is null then
    return (select coalesce(max((regexp_match(display_number, '^[0-9]+'))[1]::integer), 0) + 1
            from scenes where project_id = pid and id <> sid and display_number ~ '^[0-9]');
  end if;

  -- before the first numbered scene: A1, B1, ... (letters in front of the first scene's number)
  if prev is null then
    base := coalesce((regexp_match(nxt, '^[0-9]+'))[1], nxt);
    for i in 0..25 loop
      cand := chr(65 + i) || base;
      if not exists (select 1 from scenes where project_id = pid and display_number = cand) then return cand; end if;
    end loop;
    return 'A' || base || '-' || substr(sid::text, 1, 4);
  end if;

  -- between two numbered scenes: a letter after the previous scene's number
  parts := regexp_match(prev, '^([0-9]+)([A-Z]*)$');
  if parts is null then base := prev; l := ''; else base := parts[1]; l := parts[2]; end if;
  if l = '' then cand := 'A';
  elsif right(l, 1) = 'Z' then cand := l || 'A';
  else cand := left(l, length(l) - 1) || chr(ascii(right(l, 1)) + 1);
  end if;
  -- if the next scene is a lettered scene of the same number, stay in front of it (2A, 2AA, 2B)
  parts := regexp_match(nxt, '^([0-9]+)([A-Z]*)$');
  if parts is not null and parts[1] = base then
    m := parts[2];
    if m <> '' and (cand collate "C") >= (m collate "C") then cand := l || 'A'; end if;
  end if;
  while exists (select 1 from scenes where project_id = pid and display_number = base || cand) loop
    cand := cand || 'A';
  end loop;
  return base || cand;
end $$;

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------
-- Revision bookkeeping may change only inside the functions below, which set this switch.
create function revision_switch_on() returns boolean
language sql stable as $$ select coalesce(current_setting('lineboard.revision', true), '') = 'on' $$;

create or replace function guard_scenes() returns trigger
language plpgsql security definer set search_path = public as $$
declare locked boolean;
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.project_id <> old.project_id then
      raise exception 'A scene id and its project never change.';
    end if;
    if new.revised_in is distinct from old.revised_in and not revision_switch_on() then
      raise exception 'Revisions are recorded when the scene text is saved.';
    end if;
    select script_locked into locked from projects where id = old.project_id;
    -- a numbered scene keeps its number once the script is locked
    if locked and old.display_number is not null and new.display_number is distinct from old.display_number then
      raise exception 'The script is locked. Scene numbers cannot change. Unlock the script first.';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    select script_locked into locked from projects where id = old.project_id;
    -- numbered scenes are cut by marking them omitted; unnumbered ones can simply be removed
    if locked and old.display_number is not null then
      raise exception 'The script is locked. Mark the scene omitted instead of deleting it.';
    end if;
    return old;
  end if;
  return new;
end $$;

-- A scene added after the lock is numbered by its place in the script.
create function guard_scene_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.revised_in is not null and not revision_switch_on() then new.revised_in := null; end if;
  if new.display_number is null
     and exists (select 1 from projects where id = new.project_id and script_locked) then
    new.display_number := next_scene_number(new.project_id, new.id, new.sort_order, new.created_at);
  end if;
  return new;
end $$;
create trigger guard_scene_insert before insert on scenes
  for each row execute function guard_scene_insert();

create or replace function guard_projects() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id <> old.owner_id then raise exception 'Ownership changes only by transfer.'; end if;
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

-- ---------------------------------------------------------------------------
-- Lock the script: number the unnumbered scenes in script order, then freeze.
-- ---------------------------------------------------------------------------
create function lock_script(pid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not is_owner(pid) then raise exception 'Only the owner can lock or unlock the script.'; end if;
  if (select script_locked from projects where id = pid) then return; end if;
  for r in select id, sort_order, created_at from scenes
           where project_id = pid and display_number is null order by sort_order, created_at, id loop
    update scenes set display_number = next_scene_number(pid, r.id, r.sort_order, r.created_at) where id = r.id;
  end loop;
  perform set_config('lineboard.revision', 'on', true);
  -- the first lock starts revision 1 (Blue); a later lock continues the revision in progress
  update projects set script_locked = true, revision_no = greatest(revision_no, 1) where id = pid;
  perform set_config('lineboard.revision', '', true);
end $$;

-- Close the current revision round and begin the next (Blue -> Pink -> ...). Owner or admin, locked scripts only.
create function start_next_revision(pid uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not is_owner_or_admin(pid) then raise exception 'Only the owner or an admin can start a revision.'; end if;
  if not (select script_locked from projects where id = pid) then
    raise exception 'Revisions start once the script is locked.';
  end if;
  perform set_config('lineboard.revision', 'on', true);
  update projects set revision_no = revision_no + 1 where id = pid returning revision_no into n;
  perform set_config('lineboard.revision', '', true);
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Saving scene text now also records revisions after the lock.
-- A stored line is { kind, text, rev? }. Lines that already exist keep their mark. New or changed lines
-- get the revision in progress, but only while the script is locked. The client never sends marks.
-- ---------------------------------------------------------------------------
create or replace function save_scene_text(sid uuid, new_heading text, new_elements jsonb, expected_rev integer)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  cur integer;
  nxt integer;
  pid uuid;
  locked boolean;
  rno integer;
  old_elements jsonb;
  marked jsonb;
  changed boolean;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if jsonb_typeof(new_elements) is distinct from 'array' then raise exception 'bad_elements'; end if;
  if exists (
    select 1 from jsonb_array_elements(new_elements) e
    where jsonb_typeof(e) is distinct from 'object'
       or e->>'kind' is null or e->>'kind' not in ('action', 'character', 'dialogue', 'parenthetical', 'transition')
       or jsonb_typeof(e->'text') is distinct from 'string'
  ) then raise exception 'bad_elements'; end if;
  if not exists (select 1 from scene_locks
    where scene_id = sid and holder = auth.uid() and expires_at > now()) then
    raise exception 'lock_lost';
  end if;
  select rev, elements into cur, old_elements from scene_text where scene_id = sid;
  if coalesce(cur, 0) <> expected_rev then raise exception 'rev_conflict'; end if;
  nxt := coalesce(cur, 0) + 1;
  old_elements := coalesce(old_elements, '[]'::jsonb);

  select s.project_id into pid from scenes s where s.id = sid;
  select p.script_locked, p.revision_no into locked, rno from projects p where p.id = pid;

  -- match each new line with an old line of the same kind and text; unmatched lines are changes
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

  update scenes set heading = trim(coalesce(new_heading, '')) where id = sid;
  insert into scene_text (scene_id, elements, rev, updated_by, updated_at)
    values (sid, marked, nxt, auth.uid(), now())
  on conflict (scene_id) do update
    set elements = excluded.elements, rev = excluded.rev, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  if locked and changed then
    perform set_config('lineboard.revision', 'on', true);
    update scenes set revised_in = rno where id = sid;
    perform set_config('lineboard.revision', '', true);
  end if;
  update scene_locks set expires_at = now() + interval '2 minutes' where scene_id = sid;
  return nxt;
end $$;

revoke execute on function lock_script(uuid), start_next_revision(uuid), next_scene_number(uuid, uuid, integer, timestamptz)
  from public, anon;
grant execute on function lock_script(uuid), start_next_revision(uuid) to authenticated;
