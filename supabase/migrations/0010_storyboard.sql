-- Storyboard (planning document section 11).
-- One frame per shot. A frame holds up to 4 photo layers (compressed in the browser, stored in the private
-- "storyboard" bucket) and a pen drawing (strokes, stored as small JSON). Marking a frame done flattens it
-- into one image (flat_path). Who may edit a frame follows the shot: the owning team's editors.
-- Everyone with view access to Shots can see frames. Files live at storyboard/<project id>/<shot id>/<file>.
-- A per-project size cap (default 200 MB, the owner can change it) is enforced on the frame rows.

alter table projects add column image_cap_mb integer not null default 200 check (image_cap_mb between 10 and 5000);

create function shot_project(sid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select project_id from shots where id = sid
$$;
create function shot_team(sid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from shots where id = sid
$$;

-- Can the caller edit the storyboard frame of the shot named in this file path?
create function can_edit_storyboard_path(file_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare parts text[]; pid uuid; sid uuid;
begin
  parts := string_to_array(file_name, '/');
  if array_length(parts, 1) < 3 then return false; end if;
  pid := parts[1]::uuid; sid := parts[2]::uuid;
  return shot_project(sid) = pid and can_edit_section(pid, 'shots', shot_team(sid));
exception when others then
  return false;
end $$;

create function can_view_storyboard_path(file_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare parts text[];
begin
  parts := string_to_array(file_name, '/');
  if array_length(parts, 1) < 3 then return false; end if;
  return can_view_section(parts[1]::uuid, 'shots');
exception when others then
  return false;
end $$;

create table storyboard_frames (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  shot_id uuid not null unique references shots (id) on delete cascade,
  -- [{ "path": text, "w": int, "h": int, "bytes": int, "opacity": 0..1, "visible": bool }]
  layers jsonb not null default '[]'::jsonb check (jsonb_typeof(layers) = 'array' and jsonb_array_length(layers) <= 4),
  -- [{ "color": text, "width": number, "points": [[x, y], ...] }] with x and y between 0 and 1
  strokes jsonb not null default '[]'::jsonb check (jsonb_typeof(strokes) = 'array' and jsonb_array_length(strokes) <= 600),
  flat_path text,
  done boolean not null default false,
  bytes integer not null default 0 check (bytes >= 0),
  updated_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on storyboard_frames (project_id);

alter table storyboard_frames enable row level security;
revoke all on storyboard_frames from anon, authenticated;
grant select, insert, update, delete on storyboard_frames to authenticated;

create policy frames_read on storyboard_frames for select to authenticated
  using (can_view_section(project_id, 'shots'));
create policy frames_insert on storyboard_frames for insert to authenticated
  with check (project_id = shot_project(shot_id) and can_edit_section(project_id, 'shots', shot_team(shot_id)));
create policy frames_update on storyboard_frames for update to authenticated
  using (can_edit_section(project_id, 'shots', shot_team(shot_id)))
  with check (project_id = shot_project(shot_id) and can_edit_section(project_id, 'shots', shot_team(shot_id)));
create policy frames_delete on storyboard_frames for delete to authenticated
  using (can_edit_section(project_id, 'shots', shot_team(shot_id)));

create function guard_frame() returns trigger
language plpgsql set search_path = public as $$
declare used bigint; cap bigint; l jsonb;
begin
  if tg_op = 'UPDATE' and (new.project_id <> old.project_id or new.shot_id <> old.shot_id) then
    raise exception 'A frame''s shot never changes.';
  end if;
  -- every file must sit under this project and this shot
  for l in select * from jsonb_array_elements(new.layers) loop
    if jsonb_typeof(l) is distinct from 'object' or (l->>'path') is null
       or (l->>'path') not like new.project_id::text || '/' || new.shot_id::text || '/%' then
      raise exception 'bad_frame';
    end if;
  end loop;
  if new.flat_path is not null and new.flat_path not like new.project_id::text || '/' || new.shot_id::text || '/%' then
    raise exception 'bad_frame';
  end if;
  -- the project's size cap: growth is refused once the cap is reached
  if tg_op = 'INSERT' or new.bytes > old.bytes then
    select coalesce(sum(bytes), 0) into used from storyboard_frames where project_id = new.project_id and id <> new.id;
    select image_cap_mb::bigint * 1048576 into cap from projects where id = new.project_id;
    if used + new.bytes > cap then raise exception 'image_cap_reached'; end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
create trigger guard_frame before insert or update on storyboard_frames
  for each row execute function guard_frame();

-- The private bucket and who may read and write its files.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('storyboard', 'storyboard', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;

create policy storyboard_files_read on storage.objects for select to authenticated
  using (bucket_id = 'storyboard' and can_view_storyboard_path(name));
create policy storyboard_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'storyboard' and can_edit_storyboard_path(name));
create policy storyboard_files_update on storage.objects for update to authenticated
  using (bucket_id = 'storyboard' and can_edit_storyboard_path(name))
  with check (bucket_id = 'storyboard' and can_edit_storyboard_path(name));
create policy storyboard_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'storyboard' and can_edit_storyboard_path(name));

revoke execute on function shot_project(uuid), shot_team(uuid), can_edit_storyboard_path(text), can_view_storyboard_path(text) from public, anon;
grant execute on function shot_project(uuid), shot_team(uuid), can_edit_storyboard_path(text), can_view_storyboard_path(text) to authenticated;
