-- Script text (planning document section 8).
-- A scene's action and dialogue live in one row per scene (typed elements as JSON), so the existing
-- per-scene read rule (can_read_scene_text) protects exactly that scene's words. Number, heading and
-- status stay on the scenes table, where every project member can see them.
--
-- Editing is locked per scene. Nobody writes to these tables directly: the three functions below
-- take, keep and release the lock, and save the text only for the person holding it.

create table scene_text (
  scene_id uuid primary key references scenes (id) on delete cascade,
  -- [{ "kind": "action" | "character" | "dialogue" | "parenthetical" | "transition", "text": "..." }]
  elements jsonb not null default '[]'::jsonb check (jsonb_typeof(elements) = 'array'),
  rev integer not null default 0,
  updated_by uuid references profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- One row per scene being edited. A lock that is not renewed runs out after two minutes.
create table scene_locks (
  scene_id uuid primary key references scenes (id) on delete cascade,
  holder uuid not null references profiles (id) on delete cascade,
  expires_at timestamptz not null
);

alter table scene_text enable row level security;
alter table scene_locks enable row level security;

create policy scene_text_read on scene_text for select to authenticated
  using (can_read_scene_text(scene_id));

-- Everyone on the project may see who is editing which scene (scenes are only visible to members).
create policy scene_locks_read on scene_locks for select to authenticated
  using (exists (select 1 from scenes s where s.id = scene_id));

revoke all on scene_text, scene_locks from anon, authenticated;
grant select on scene_text, scene_locks to authenticated;

-- Take or renew the lock on a scene. Returns who holds it; "mine" says whether that is the caller.
create function acquire_scene_lock(sid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
  l scene_locks;
  nm text;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select project_id into pid from scenes where id = sid;
  if pid is null then raise exception 'scene_not_found'; end if;
  if not (can_edit_section(pid, 'script', null) and can_read_scene_text(sid)) then
    raise exception 'You cannot edit this scene.';
  end if;
  insert into scene_locks (scene_id, holder, expires_at)
    values (sid, auth.uid(), now() + interval '2 minutes')
  on conflict (scene_id) do update
    set holder = excluded.holder, expires_at = excluded.expires_at
    where scene_locks.holder = auth.uid() or scene_locks.expires_at < now();
  select * into l from scene_locks where scene_id = sid;
  select display_name into nm from profiles where id = l.holder;
  return jsonb_build_object('mine', l.holder = auth.uid(), 'holder', l.holder, 'name', nm, 'expires_at', l.expires_at);
end $$;

create function release_scene_lock(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from scene_locks where scene_id = sid and holder = auth.uid();
end $$;

-- Save the scene's heading and text. Only the lock holder, and only if nobody saved in between.
create function save_scene_text(sid uuid, new_heading text, new_elements jsonb, expected_rev integer)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  cur integer;
  nxt integer;
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
  select rev into cur from scene_text where scene_id = sid;
  if coalesce(cur, 0) <> expected_rev then raise exception 'rev_conflict'; end if;
  nxt := coalesce(cur, 0) + 1;
  update scenes set heading = trim(coalesce(new_heading, '')) where id = sid;
  insert into scene_text (scene_id, elements, rev, updated_by, updated_at)
    values (sid, new_elements, nxt, auth.uid(), now())
  on conflict (scene_id) do update
    set elements = excluded.elements, rev = excluded.rev, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  -- keep the lock alive after a save
  update scene_locks set expires_at = now() + interval '2 minutes' where scene_id = sid;
  return nxt;
end $$;

revoke execute on function acquire_scene_lock(uuid), release_scene_lock(uuid),
  save_scene_text(uuid, text, jsonb, integer) from public, anon;
grant execute on function acquire_scene_lock(uuid), release_scene_lock(uuid),
  save_scene_text(uuid, text, jsonb, integer) to authenticated;
