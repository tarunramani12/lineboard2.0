-- Project bible, step 2 of 2 (run 0026 first).
-- One page for the facts and look of the film. Tab 1, Format: aspect ratio, frame rate, resolution, camera format,
-- delivery, target runtime, colour notes. Tab 2, Moodboard: picture cards and text cards with captions.
--
-- Who may do what (enforced here):
--   * The Project bible is a section like the others. Direction and Camera edit it by default; every other team has no
--     access until the owner gives it view or edit in Team and access.
--   * Editing needs edit level plus HOD or an edit grant (can_edit_section), as everywhere. Owner and admins always edit.
--   * The aspect ratio is also read by the Storyboard, so it lives on the project row, which every member reads.
--     It changes only through set_aspect_ratio, by someone who can edit the Project bible.
--   * Moodboard pictures count toward the project's image cap, together with the storyboard pictures.

-- Existing teams: Direction (the AD team) and Camera edit, everyone else has no access.
insert into team_section_access (team_id, section, level)
select t.id, 'bible'::section_key, case when t.is_ad_team or t.name = 'Camera' then 'edit'::access_level else 'none'::access_level end
from teams t
on conflict do nothing;

-- New projects get the same defaults (this is the 0019 version of create_project plus the Project bible).
create or replace function create_project(project_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid; mid uuid; tid uuid; dept text; sec section_key;
  depts text[] := array['Direction', 'Production', 'Camera', 'Lighting and grip', 'Sound',
    'Art', 'Costume', 'Makeup and hair', 'VFX', 'Post'];
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  insert into projects (name, owner_id) values (trim(project_name), auth.uid()) returning id into pid;
  insert into members (project_id, account_id, role) values (pid, auth.uid(), 'owner') returning id into mid;
  foreach dept in array depts loop
    insert into teams (project_id, name, is_ad_team) values (pid, dept, dept = 'Direction')
      returning id into tid;
    foreach sec in array enum_range(null::section_key) loop
      insert into team_section_access (team_id, section, level) values (tid, sec,
        case when sec = 'bible' and dept in ('Direction', 'Camera') then 'edit'::access_level
             when sec in ('schedule', 'call_sheets') and dept in ('Direction', 'Production') then 'edit'::access_level
             when sec in ('schedule', 'call_sheets', 'cast_crew') then 'view'::access_level
             else 'none'::access_level end);
    end loop;
  end loop;
  insert into scene_access (member_id, mode) values (mid, 'all');
  insert into script_versions (project_id, version_no, note) values (pid, 1, 'First draft');
  return pid;
end $$;
revoke execute on function create_project(text) from public, anon;
grant execute on function create_project(text) to authenticated;

-- ---- aspect ratio on the project (read by everyone on the project, changed only through the function below)
alter table projects add column aspect_ratio text not null default '16:9'
  check (aspect_ratio ~ '^[0-9]{1,2}(\.[0-9]{1,3})?:[0-9]{1,2}(\.[0-9]{1,3})?$');

create function guard_project_aspect() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.aspect_ratio is distinct from old.aspect_ratio
     and coalesce(current_setting('lineboard.aspect', true), '') <> 'on' and auth.uid() is not null then
    raise exception 'Change the aspect ratio in the Project bible.';
  end if;
  return new;
end $$;
create trigger guard_project_aspect before update on projects for each row execute function guard_project_aspect();

create function set_aspect_ratio(pid uuid, ratio text) returns void
language plpgsql security definer set search_path = public as $$
declare w numeric; h numeric;
begin
  if not can_edit_section(pid, 'bible', null) then raise exception 'You cannot change the format of this project.'; end if;
  if ratio is null or ratio !~ '^[0-9]{1,2}(\.[0-9]{1,3})?:[0-9]{1,2}(\.[0-9]{1,3})?$' then raise exception 'bad_ratio'; end if;
  w := split_part(ratio, ':', 1)::numeric; h := split_part(ratio, ':', 2)::numeric;
  if w <= 0 or h <= 0 or w / h > 4 or h / w > 4 then raise exception 'bad_ratio'; end if;
  perform set_config('lineboard.aspect', 'on', true);
  update projects set aspect_ratio = ratio where id = pid;
end $$;
revoke execute on function set_aspect_ratio(uuid, text) from public, anon;
grant execute on function set_aspect_ratio(uuid, text) to authenticated;

-- ---- Format tab
create table project_bible (
  project_id uuid primary key references projects (id) on delete cascade,
  frame_rate text not null default '24' check (length(frame_rate) <= 30),
  resolution text not null default '' check (length(resolution) <= 60),
  camera_format text not null default '' check (length(camera_format) <= 120),
  delivery text not null default '' check (length(delivery) <= 120),
  runtime_target text not null default '' check (length(runtime_target) <= 60),
  look_notes text not null default '' check (length(look_notes) <= 3000),
  notes text not null default '' check (length(notes) <= 5000),
  updated_by uuid references profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table project_bible enable row level security;
revoke all on project_bible from anon, authenticated;
grant select, insert, update on project_bible to authenticated;
create policy bible_read on project_bible for select to authenticated using (can_view_section(project_id, 'bible'));
create policy bible_insert on project_bible for insert to authenticated with check (can_edit_section(project_id, 'bible', null));
create policy bible_update on project_bible for update to authenticated
  using (can_edit_section(project_id, 'bible', null)) with check (can_edit_section(project_id, 'bible', null));

-- ---- Moodboard tab
create table moodboard_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  kind text not null check (kind in ('image', 'text')),
  image_path text,
  caption text not null default '' check (length(caption) <= 200),
  description text not null default '' check (length(description) <= 3000),
  position integer not null default 0,
  bytes integer not null default 0 check (bytes >= 0),
  created_by uuid references profiles (id) on delete set null,
  updated_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'image' and image_path is not null) or (kind = 'text' and image_path is null and bytes = 0))
);
create index on moodboard_items (project_id, position);
alter table moodboard_items enable row level security;
revoke all on moodboard_items from anon, authenticated;
grant select, insert, update, delete on moodboard_items to authenticated;
create policy mood_read on moodboard_items for select to authenticated using (can_view_section(project_id, 'bible'));
create policy mood_insert on moodboard_items for insert to authenticated with check (can_edit_section(project_id, 'bible', null));
create policy mood_update on moodboard_items for update to authenticated
  using (can_edit_section(project_id, 'bible', null)) with check (can_edit_section(project_id, 'bible', null));
create policy mood_delete on moodboard_items for delete to authenticated using (can_edit_section(project_id, 'bible', null));

-- A picture and its row stay in one project; the project's size cap counts storyboard and moodboard pictures together.
create function guard_moodboard() returns trigger
language plpgsql set search_path = public as $$
declare used bigint; cap bigint;
begin
  if tg_op = 'UPDATE' and (new.project_id <> old.project_id or new.kind <> old.kind) then
    raise exception 'A moodboard card keeps its project and kind.';
  end if;
  if new.image_path is not null and new.image_path not like new.project_id::text || '/%' then raise exception 'bad_frame'; end if;
  if tg_op = 'INSERT' or new.bytes > old.bytes then
    select coalesce((select sum(bytes) from storyboard_frames where project_id = new.project_id), 0)
         + coalesce((select sum(bytes) from moodboard_items where project_id = new.project_id and id <> new.id), 0)
      into used;
    select image_cap_mb::bigint * 1048576 into cap from projects where id = new.project_id;
    if used + new.bytes > cap then raise exception 'image_cap_reached'; end if;
  end if;
  if tg_op = 'INSERT' and exists (select 1 from profiles where id = auth.uid()) then new.created_by := auth.uid(); end if;
  if exists (select 1 from profiles where id = auth.uid()) then new.updated_by := auth.uid(); end if;
  new.updated_at := now();
  return new;
end $$;
create trigger guard_moodboard before insert or update on moodboard_items for each row execute function guard_moodboard();

create function guard_bible() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from profiles where id = auth.uid()) then new.updated_by := auth.uid(); end if;
  new.updated_at := now();
  return new;
end $$;
create trigger guard_bible before insert or update on project_bible for each row execute function guard_bible();

-- Storyboard frames now share the cap with the moodboard (the 0010 version plus the moodboard in the sum).
create or replace function guard_frame() returns trigger
language plpgsql set search_path = public as $$
declare used bigint; cap bigint; l jsonb;
begin
  if tg_op = 'UPDATE' and (new.project_id <> old.project_id or new.shot_id <> old.shot_id) then
    raise exception 'A frame''s shot never changes.';
  end if;
  for l in select * from jsonb_array_elements(new.layers) loop
    if jsonb_typeof(l) is distinct from 'object' or (l->>'path') is null
       or (l->>'path') not like new.project_id::text || '/' || new.shot_id::text || '/%' then
      raise exception 'bad_frame';
    end if;
  end loop;
  if new.flat_path is not null and new.flat_path not like new.project_id::text || '/' || new.shot_id::text || '/%' then
    raise exception 'bad_frame';
  end if;
  if tg_op = 'INSERT' or new.bytes > old.bytes then
    select coalesce((select sum(bytes) from storyboard_frames where project_id = new.project_id and id <> new.id), 0)
         + coalesce((select sum(bytes) from moodboard_items where project_id = new.project_id), 0)
      into used;
    select image_cap_mb::bigint * 1048576 into cap from projects where id = new.project_id;
    if used + new.bytes > cap then raise exception 'image_cap_reached'; end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

-- ---- the private picture bucket: <project id>/<file>
create function can_edit_bible_path(file_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare parts text[];
begin
  parts := string_to_array(file_name, '/');
  if array_length(parts, 1) < 2 then return false; end if;
  return can_edit_section(parts[1]::uuid, 'bible', null);
exception when others then
  return false;
end $$;
create function can_view_bible_path(file_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare parts text[];
begin
  parts := string_to_array(file_name, '/');
  if array_length(parts, 1) < 2 then return false; end if;
  return can_view_section(parts[1]::uuid, 'bible');
exception when others then
  return false;
end $$;
revoke execute on function can_edit_bible_path(text), can_view_bible_path(text) from public, anon;
grant execute on function can_edit_bible_path(text), can_view_bible_path(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('moodboard', 'moodboard', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;
create policy moodboard_files_read on storage.objects for select to authenticated
  using (bucket_id = 'moodboard' and can_view_bible_path(name));
create policy moodboard_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'moodboard' and can_edit_bible_path(name));
create policy moodboard_files_update on storage.objects for update to authenticated
  using (bucket_id = 'moodboard' and can_edit_bible_path(name))
  with check (bucket_id = 'moodboard' and can_edit_bible_path(name));
create policy moodboard_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'moodboard' and can_edit_bible_path(name));
