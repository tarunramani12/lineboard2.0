-- Locations, step 2 of 2 (run 0038 first). Scouting, locking, availability and costs for film locations.
-- Who may do what, enforced here:
--   * Reading follows the section (view access to Locations). Defaults: Production and Direction edit, every other team views.
--   * Anyone who edits the section (edit level on Locations, plus HOD or an edit grant, or the owner and admins) changes any
--     location. Locations are shared work between Production and Direction, so a row has no owning team.
--   * Contact person (name, phone, email) is a separate record: owner, admins, Production and Direction only.
--   * Cost lines are a separate record: owner, admins and the Production team only, for reading and writing.
--   * Status 'locked' means agreed. To lock, the agreement must be ticked and at least one cost line must exist
--     (a free location gets a line of kind "No charge" with amount 0). A locked location is frozen except for its notes
--     and its status; its costs, photos, availability and scene links stay editable. A locked location is never deleted.
--   * Photos and their drawings count toward the project's picture limit together with the storyboard and moodboard.
-- New projects get a 500 MB picture limit (existing projects keep theirs).

alter table projects alter column image_cap_mb set default 500;

create table locations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  kind text not null default '' check (length(kind) <= 60),
  int_ext text not null default '' check (int_ext in ('', 'INT', 'EXT', 'INT/EXT')),
  status text not null default 'idea' check (status in ('idea', 'shortlisted', 'scouted', 'locked', 'rejected')),
  address text not null default '' check (length(address) <= 300),
  lat numeric(9, 6) check (lat between -90 and 90),
  lng numeric(9, 6) check (lng between -180 and 180),
  parking text not null default '' check (length(parking) <= 500),
  access_restrictions text not null default '' check (length(access_restrictions) <= 500),
  hospital text not null default '' check (length(hospital) <= 300),
  permit_required boolean not null default false,
  permit_status text not null default 'none' check (permit_status in ('none', 'to_apply', 'applied', 'approved')),
  permit_no text not null default '' check (length(permit_no) <= 60),
  agreement_signed boolean not null default false,
  notes text not null default '' check (length(notes) <= 3000),
  links jsonb not null default '[]' check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 20),
  locked_by uuid references profiles (id) on delete set null,
  locked_at timestamptz,
  created_by uuid references profiles (id) on delete set null,
  updated_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((lat is null) = (lng is null))
);
create index on locations (project_id);

create table location_contacts (
  location_id uuid primary key references locations (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  name text not null default '' check (length(name) <= 120),
  role text not null default '' check (length(role) <= 80),
  phone text not null default '' check (length(phone) <= 40),
  email text not null default '' check (length(email) <= 200)
);
create index on location_contacts (project_id);

create table location_costs (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  kind text not null default 'Location fee' check (length(trim(kind)) between 1 and 60),
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  currency text not null default 'EUR' check (length(currency) between 1 and 3),
  quantity numeric(8, 2) not null default 1 check (quantity > 0),
  status text not null default 'quoted' check (status in ('quoted', 'agreed', 'invoiced', 'paid')),
  due_date date,
  paid_date date,
  note text not null default '' check (length(note) <= 200),
  created_by uuid references profiles (id) on delete set null,
  updated_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on location_costs (location_id);
create index on location_costs (project_id);

create table location_scenes (
  location_id uuid not null references locations (id) on delete cascade,
  scene_id uuid not null references scenes (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  rank text not null default 'first' check (rank in ('first', 'alternate')),
  primary key (location_id, scene_id)
);
create index on location_scenes (project_id);
create index on location_scenes (scene_id);
-- a scene has one first-choice location (any number of alternates)
create unique index location_scenes_one_first on location_scenes (scene_id) where rank = 'first';

create table location_availability (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  kind text not null default 'unavailable' check (kind in ('available', 'unavailable', 'booked')),
  day_id uuid references shoot_days (id) on delete set null,
  note text not null default '' check (length(note) <= 200),
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index on location_availability (location_id);
create index on location_availability (project_id);

create table location_photos (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  path text not null,
  bytes integer not null default 0 check (bytes >= 0),
  caption text not null default '' check (length(caption) <= 200),
  position integer not null default 0,
  -- pen strokes drawn over the photo, points relative to the photo (0 to 1); the photo file itself is never changed
  strokes jsonb not null default '[]' check (jsonb_typeof(strokes) = 'array' and jsonb_array_length(strokes) <= 400),
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on location_photos (location_id, position);
create index on location_photos (project_id);

alter table shoot_days add column location_id uuid references locations (id) on delete set null;

-- ---- helpers
create function location_project_of(lid uuid) returns uuid
language sql stable security definer set search_path = public as $$ select project_id from locations where id = lid $$;
create function location_status_of(lid uuid) returns text
language sql stable security definer set search_path = public as $$ select status from locations where id = lid $$;

-- Contact people: owner, admins, and anyone on the Production or Direction team.
create function can_see_location_contacts(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_owner_or_admin(pid) or exists (
    select 1 from members m
    join member_teams mt on mt.member_id = m.id
    join teams t on t.id = mt.team_id and t.role_tag in ('production', 'direction')
    where m.project_id = pid and m.account_id = auth.uid())
$$;

alter table locations enable row level security;
alter table location_contacts enable row level security;
alter table location_costs enable row level security;
alter table location_scenes enable row level security;
alter table location_availability enable row level security;
alter table location_photos enable row level security;
revoke all on locations, location_contacts, location_costs, location_scenes, location_availability, location_photos from anon, authenticated;
grant select, insert, update, delete on locations, location_contacts, location_costs, location_scenes, location_availability, location_photos to authenticated;

create policy loc_read on locations for select to authenticated using (can_view_section(project_id, 'locations'));
create policy loc_insert on locations for insert to authenticated with check (can_edit_section(project_id, 'locations', null));
create policy loc_update on locations for update to authenticated
  using (can_edit_section(project_id, 'locations', null)) with check (can_edit_section(project_id, 'locations', null));
create policy loc_delete on locations for delete to authenticated
  using (can_edit_section(project_id, 'locations', null) and status <> 'locked');

-- contacts
create policy locc_read on location_contacts for select to authenticated
  using (can_see_location_contacts(project_id) and can_view_section(project_id, 'locations'));
create policy locc_insert on location_contacts for insert to authenticated
  with check (can_see_location_contacts(project_id) and project_id = location_project_of(location_id)
    and can_edit_section(project_id, 'locations', null));
create policy locc_update on location_contacts for update to authenticated
  using (can_see_location_contacts(project_id) and can_edit_section(project_id, 'locations', null))
  with check (can_see_location_contacts(project_id) and can_edit_section(project_id, 'locations', null));
create policy locc_delete on location_contacts for delete to authenticated
  using (can_see_location_contacts(project_id) and can_edit_section(project_id, 'locations', null));

-- costs (owner, admins, Production)
create policy lcost_read on location_costs for select to authenticated using (can_see_costs(project_id) and can_view_section(project_id, 'locations'));
create policy lcost_insert on location_costs for insert to authenticated
  with check (can_see_costs(project_id) and project_id = location_project_of(location_id) and can_edit_section(project_id, 'locations', null));
create policy lcost_update on location_costs for update to authenticated
  using (can_see_costs(project_id) and can_edit_section(project_id, 'locations', null))
  with check (can_see_costs(project_id) and can_edit_section(project_id, 'locations', null));
create policy lcost_delete on location_costs for delete to authenticated
  using (can_see_costs(project_id) and can_edit_section(project_id, 'locations', null));

-- scenes, availability, photos: read with the section, write with the owning team's editors
create policy locs_read on location_scenes for select to authenticated using (can_view_section(project_id, 'locations'));
create policy locs_insert on location_scenes for insert to authenticated
  with check (project_id = location_project_of(location_id) and can_edit_section(project_id, 'locations', null));
create policy locs_update on location_scenes for update to authenticated
  using (can_edit_section(project_id, 'locations', null))
  with check (can_edit_section(project_id, 'locations', null));
create policy locs_delete on location_scenes for delete to authenticated
  using (can_edit_section(project_id, 'locations', null));

create policy loca_read on location_availability for select to authenticated using (can_view_section(project_id, 'locations'));
create policy loca_insert on location_availability for insert to authenticated
  with check (project_id = location_project_of(location_id) and can_edit_section(project_id, 'locations', null));
create policy loca_update on location_availability for update to authenticated
  using (can_edit_section(project_id, 'locations', null))
  with check (can_edit_section(project_id, 'locations', null));
create policy loca_delete on location_availability for delete to authenticated
  using (can_edit_section(project_id, 'locations', null));

create policy locp_read on location_photos for select to authenticated using (can_view_section(project_id, 'locations'));
create policy locp_insert on location_photos for insert to authenticated
  with check (project_id = location_project_of(location_id) and can_edit_section(project_id, 'locations', null));
create policy locp_update on location_photos for update to authenticated
  using (can_edit_section(project_id, 'locations', null))
  with check (can_edit_section(project_id, 'locations', null));
create policy locp_delete on location_photos for delete to authenticated
  using (can_edit_section(project_id, 'locations', null));

-- ---- guards
create function guard_location() returns trigger
language plpgsql security definer set search_path = public as $$
declare frozen text[] := array['notes', 'status', 'updated_at', 'updated_by', 'locked_by', 'locked_at'];
begin
  if tg_op = 'INSERT' then
    if new.status = 'locked' then raise exception 'A new location cannot start locked.'; end if;
    new.locked_by := null; new.locked_at := null;
    if exists (select 1 from profiles where id = auth.uid()) then new.created_by := auth.uid(); end if;
    new.created_at := now();
  else
    if new.id <> old.id or new.project_id <> old.project_id then raise exception 'A location stays in its project.'; end if;
    if old.status = 'locked' and (to_jsonb(new) - frozen) is distinct from (to_jsonb(old) - frozen) then
      raise exception 'This location is locked. Unlock it to change it.';
    end if;
    if new.status = 'locked' and old.status <> 'locked' then
      if not new.agreement_signed then raise exception 'Tick that the agreement is signed before locking this location.'; end if;
      if not exists (select 1 from location_costs c where c.location_id = new.id) then
        raise exception 'Add at least one cost line before locking this location. A free location gets a No charge line of 0.';
      end if;
      if exists (select 1 from profiles where id = auth.uid()) then new.locked_by := auth.uid(); end if;
      new.locked_at := now();
    elsif new.status <> 'locked' and old.status = 'locked' then
      new.locked_by := null; new.locked_at := null;
    else
      new.locked_by := old.locked_by; new.locked_at := old.locked_at;
    end if;
  end if;
  if exists (select 1 from profiles where id = auth.uid()) then new.updated_by := auth.uid(); end if;
  new.updated_at := now();
  return new;
end $$;
create trigger guard_location before insert or update on locations for each row execute function guard_location();

create function guard_location_cost() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.location_id <> old.location_id or new.project_id <> old.project_id) then
    raise exception 'A cost line stays with its location.';
  end if;
  if tg_op = 'INSERT' and exists (select 1 from profiles where id = auth.uid()) then new.created_by := auth.uid(); end if;
  if exists (select 1 from profiles where id = auth.uid()) then new.updated_by := auth.uid(); end if;
  new.updated_at := now();
  return new;
end $$;
create trigger guard_location_cost before insert or update on location_costs for each row execute function guard_location_cost();

-- A location that is locked keeps at least one cost line.
create function guard_location_cost_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- when the whole project or location is being deleted, its cost lines go with it
  if location_status_of(old.location_id) = 'locked'
     and exists (select 1 from projects p where p.id = old.project_id)
     and not exists (select 1 from location_costs c where c.location_id = old.location_id and c.id <> old.id) then
    raise exception 'A locked location keeps at least one cost line. Unlock it first.';
  end if;
  return old;
end $$;
create trigger guard_location_cost_delete before delete on location_costs for each row execute function guard_location_cost_delete();

create function guard_location_scene() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from scenes s where s.id = new.scene_id and s.project_id = new.project_id) then
    raise exception 'That scene is not in this project.';
  end if;
  return new;
end $$;
create trigger guard_location_scene before insert on location_scenes for each row execute function guard_location_scene();

create function guard_location_availability() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.day_id is not null and not exists (select 1 from shoot_days d where d.id = new.day_id and d.project_id = new.project_id) then
    raise exception 'That shoot day is not in this project.';
  end if;
  return new;
end $$;
create trigger guard_location_availability before insert or update on location_availability for each row execute function guard_location_availability();

create function guard_day_location() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.location_id is not null and (tg_op = 'INSERT' or new.location_id is distinct from old.location_id)
     and location_project_of(new.location_id) is distinct from new.project_id then
    raise exception 'That location is not in this project.';
  end if;
  return new;
end $$;
create trigger guard_day_location before insert or update on shoot_days for each row execute function guard_day_location();

-- A photo's file lives under <project>/<location>/; the project size limit counts storyboard, moodboard and location pictures.
create function guard_location_photo() returns trigger
language plpgsql security definer set search_path = public as $$
declare used bigint; cap bigint;
begin
  if tg_op = 'UPDATE' and (new.location_id <> old.location_id or new.project_id <> old.project_id or new.path <> old.path) then
    raise exception 'A photo stays with its location.';
  end if;
  if new.path not like new.project_id::text || '/' || new.location_id::text || '/%' then raise exception 'bad_frame'; end if;
  if tg_op = 'INSERT' or new.bytes > old.bytes then
    select coalesce((select sum(bytes) from storyboard_frames where project_id = new.project_id), 0)
         + coalesce((select sum(bytes) from moodboard_items where project_id = new.project_id), 0)
         + coalesce((select sum(bytes) from location_photos where project_id = new.project_id and id <> new.id), 0)
      into used;
    select image_cap_mb::bigint * 1048576 into cap from projects where id = new.project_id;
    if used + new.bytes > cap then raise exception 'image_cap_reached'; end if;
  end if;
  if tg_op = 'INSERT' and exists (select 1 from profiles where id = auth.uid()) then new.created_by := auth.uid(); end if;
  new.updated_at := now();
  return new;
end $$;
create trigger guard_location_photo before insert or update on location_photos for each row execute function guard_location_photo();

-- Storyboard frames and moodboard cards now count location pictures too (the 0027 versions plus location_photos in the sum).
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
         + coalesce((select sum(bytes) from location_photos where project_id = new.project_id), 0)
      into used;
    select image_cap_mb::bigint * 1048576 into cap from projects where id = new.project_id;
    if used + new.bytes > cap then raise exception 'image_cap_reached'; end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

create or replace function guard_moodboard() returns trigger
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
         + coalesce((select sum(bytes) from location_photos where project_id = new.project_id), 0)
      into used;
    select image_cap_mb::bigint * 1048576 into cap from projects where id = new.project_id;
    if used + new.bytes > cap then raise exception 'image_cap_reached'; end if;
  end if;
  if tg_op = 'INSERT' and exists (select 1 from profiles where id = auth.uid()) then new.created_by := auth.uid(); end if;
  if exists (select 1 from profiles where id = auth.uid()) then new.updated_by := auth.uid(); end if;
  new.updated_at := now();
  return new;
end $$;

-- ---- the private picture bucket: <project id>/<location id>/<file>
create function can_edit_location_path(file_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare parts text[];
begin
  parts := string_to_array(file_name, '/');
  if array_length(parts, 1) < 3 then return false; end if;
  return can_edit_section(parts[1]::uuid, 'locations', null);
exception when others then
  return false;
end $$;
create function can_view_location_path(file_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare parts text[];
begin
  parts := string_to_array(file_name, '/');
  if array_length(parts, 1) < 3 then return false; end if;
  return can_view_section(parts[1]::uuid, 'locations');
exception when others then
  return false;
end $$;
revoke execute on function can_edit_location_path(text), can_view_location_path(text) from public, anon;
grant execute on function can_edit_location_path(text), can_view_location_path(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('locations', 'locations', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;
create policy locations_files_read on storage.objects for select to authenticated
  using (bucket_id = 'locations' and can_view_location_path(name));
create policy locations_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'locations' and can_edit_location_path(name));
create policy locations_files_update on storage.objects for update to authenticated
  using (bucket_id = 'locations' and can_edit_location_path(name))
  with check (bucket_id = 'locations' and can_edit_location_path(name));
create policy locations_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'locations' and can_edit_location_path(name));

-- ---- lock down the internals
revoke execute on function guard_location(), guard_location_cost(), guard_location_cost_delete(), guard_location_scene(),
  guard_location_availability(), guard_day_location(), guard_location_photo(), location_status_of(uuid)
  from public, anon, authenticated;
revoke execute on function location_project_of(uuid), can_see_location_contacts(uuid) from public, anon;
grant execute on function location_project_of(uuid), can_see_location_contacts(uuid) to authenticated;

-- ---- access: existing teams get Locations (Production and Direction edit, everyone else view)
insert into team_section_access (team_id, section, level)
  select t.id, 'locations'::section_key,
    case when t.role_tag in ('production', 'direction') then 'edit'::access_level else 'view'::access_level end
  from teams t
  on conflict (team_id, section) do nothing;

-- New projects (the 0037 version of create_project plus the Locations defaults).
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
  perform set_config('lineboard.aspect', 'on', true);   -- this function sets the owner teams below
  foreach dept in array depts loop
    insert into teams (project_id, name, is_ad_team, role_tag) values (pid, dept, dept = 'Direction',
      case dept when 'Direction' then 'direction' when 'Production' then 'production' when 'Camera' then 'camera' when 'Sound' then 'sound' when 'Art' then 'art' when 'VFX' then 'vfx' else null end)
      returning id into tid;
    if dept = 'Camera' then update projects set bible_format_team = tid where id = pid; end if;
    if dept = 'Direction' then update projects set bible_mood_team = tid where id = pid; end if;
    foreach sec in array enum_range(null::section_key) loop
      insert into team_section_access (team_id, section, level) values (tid, sec,
        case when sec = 'bible' and dept in ('Direction', 'Camera') then 'edit'::access_level
             when sec = 'bible' then 'view'::access_level
             when sec = 'equipment' then 'edit'::access_level
             when sec = 'locations' and dept in ('Direction', 'Production') then 'edit'::access_level
             when sec = 'locations' then 'view'::access_level
             when sec in ('schedule', 'call_sheets') and dept in ('Direction', 'Production') then 'edit'::access_level
             when sec in ('schedule', 'call_sheets') then 'view'::access_level
             when sec = 'cast_crew' and dept in ('Direction', 'Production') then 'view'::access_level
             else 'none'::access_level end);
    end loop;
  end loop;
  insert into scene_access (member_id, mode) values (mid, 'all');
  insert into script_versions (project_id, version_no, note) values (pid, 1, 'First draft');
  return pid;
end $$;
revoke execute on function create_project(text) from public, anon;
grant execute on function create_project(text) to authenticated;
