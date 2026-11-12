-- Breakdown (planning document section 13).
-- One form per scene: location, story date, synopsis and notes (breakdown_scenes), and a list of elements
-- (breakdown_items) in nine categories. Both point to the scene by id, so a script revision never breaks them.
--
-- Who may change what, enforced here and not only in the screen:
--   * Everyone with view access to Breakdown reads all of it.
--   * Every element belongs to one team. Only that team's editors (edit level on Breakdown, plus HOD or an edit grant) change or delete it.
--   * Only the owner and admins move an element to another team.
--   * The scene form (location, story date, synopsis, notes) is shared: any editor of Breakdown can fill it in.
--   * A quantity is at least 1, except for equipment, where 0 means the item is listed but not counted.

create type breakdown_category as enum
  ('cast', 'crew', 'extras', 'props', 'equipment', 'wardrobe', 'hair_makeup', 'sound', 'special_effects');

create table breakdown_scenes (
  scene_id uuid primary key references scenes (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  location text not null default '' check (length(location) <= 200),
  story_date text not null default '' check (length(story_date) <= 100),
  synopsis text not null default '' check (length(synopsis) <= 1000),
  notes text not null default '' check (length(notes) <= 3000),
  updated_by uuid references profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index on breakdown_scenes (project_id);

create table breakdown_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  scene_id uuid not null references scenes (id) on delete cascade,
  team_id uuid not null references teams (id),
  category breakdown_category not null,
  name text not null check (length(trim(name)) between 1 and 120),
  quantity integer not null default 1 check (quantity between 0 and 999 and (category = 'equipment' or quantity >= 1)),
  notes text not null default '' check (length(notes) <= 500),
  ref_team_id uuid references teams (id) on delete set null,   -- crew only: the whole department
  created_by uuid references profiles (id) on delete set null,
  updated_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ref_team_id is null or category = 'crew')
);
create index on breakdown_items (scene_id);
create index on breakdown_items (project_id);

alter table breakdown_scenes enable row level security;
alter table breakdown_items enable row level security;
revoke all on breakdown_scenes, breakdown_items from anon, authenticated;
grant select, insert, update on breakdown_scenes to authenticated;
grant select, insert, update, delete on breakdown_items to authenticated;

create policy bscenes_read on breakdown_scenes for select to authenticated
  using (can_view_section(project_id, 'breakdown'));
create policy bscenes_insert on breakdown_scenes for insert to authenticated
  with check (can_edit_section(project_id, 'breakdown', null) and project_id = scene_project(scene_id));
create policy bscenes_update on breakdown_scenes for update to authenticated
  using (can_edit_section(project_id, 'breakdown', null))
  with check (can_edit_section(project_id, 'breakdown', null));

create policy bitems_read on breakdown_items for select to authenticated
  using (can_view_section(project_id, 'breakdown'));
create policy bitems_insert on breakdown_items for insert to authenticated
  with check (
    can_edit_section(project_id, 'breakdown', team_id)
    and project_id = scene_project(scene_id)
    and team_project(team_id) = project_id
    and (ref_team_id is null or team_project(ref_team_id) = project_id));
create policy bitems_update on breakdown_items for update to authenticated
  using (can_edit_section(project_id, 'breakdown', team_id))
  with check (can_edit_section(project_id, 'breakdown', team_id));
create policy bitems_delete on breakdown_items for delete to authenticated
  using (can_edit_section(project_id, 'breakdown', team_id));

create function guard_breakdown_scene() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.scene_id <> old.scene_id or new.project_id <> old.project_id) then
    raise exception 'A breakdown form always stays with its scene.';
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
create trigger guard_breakdown_scene before insert or update on breakdown_scenes
  for each row execute function guard_breakdown_scene();

create function guard_breakdown_item() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_at := now();
  else
    if new.id <> old.id or new.project_id <> old.project_id or new.scene_id <> old.scene_id or new.category <> old.category
       or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'An element''s scene and kind never change.';
    end if;
    if new.team_id <> old.team_id and not is_owner_or_admin(old.project_id) then
      raise exception 'Only the owner or an admin can move an element to another team.';
    end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
create trigger guard_breakdown_item before insert or update on breakdown_items
  for each row execute function guard_breakdown_item();

revoke execute on function guard_breakdown_scene(), guard_breakdown_item() from public, anon, authenticated;
