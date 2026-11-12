-- Props and Equipment (planning document section 14). Two sections, one shape of data.
-- Each schedule has its own prop list and its own equipment list (rows of schedule_items, kind 'prop' or 'equipment').
-- Who may do what, enforced here:
--   * Reading follows the section: view access to Props reads props, view access to Equipment reads equipment.
--   * Every item belongs to one team. Only that team's editors (edit level on that section, plus HOD or an edit grant)
--     change or delete it. Only the owner and admins move an item to another team.
--   * Cost lives in a separate record that only the owner, admins and the Production team can read or write.
-- An item's linked scenes are optional and point to scenes by id.

create type item_kind as enum ('prop', 'equipment');
create type item_status as enum ('needed', 'confirmed', 'ready', 'returned');

create function item_section(k item_kind) returns section_key
language sql immutable as $$ select case k when 'prop' then 'props'::section_key else 'equipment'::section_key end $$;

create table schedule_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  schedule_id uuid not null references schedules (id) on delete cascade,
  kind item_kind not null,
  team_id uuid not null references teams (id),
  name text not null check (length(trim(name)) between 1 and 120),
  quantity integer not null default 1 check (quantity between 1 and 9999),
  category text not null default '' check (length(category) <= 60),
  status item_status not null default 'needed',
  supplier text not null default '' check (length(supplier) <= 120),
  notes text not null default '' check (length(notes) <= 500),
  created_by uuid references profiles (id) on delete set null,
  updated_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on schedule_items (schedule_id);
create index on schedule_items (project_id);

create table schedule_item_scenes (
  item_id uuid not null references schedule_items (id) on delete cascade,
  scene_id uuid not null references scenes (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  primary key (item_id, scene_id)
);
create index on schedule_item_scenes (project_id);

create table schedule_item_costs (
  item_id uuid primary key references schedule_items (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null default 'EUR' check (length(currency) between 1 and 3),
  note text not null default '' check (length(note) <= 200)
);
create index on schedule_item_costs (project_id);

create function item_kind_of(iid uuid) returns item_kind
language sql stable security definer set search_path = public as $$ select kind from schedule_items where id = iid $$;
create function item_team_of(iid uuid) returns uuid
language sql stable security definer set search_path = public as $$ select team_id from schedule_items where id = iid $$;
create function item_project_of(iid uuid) returns uuid
language sql stable security definer set search_path = public as $$ select project_id from schedule_items where id = iid $$;

-- Cost is for the owner, admins and anyone on the Production team.
create function can_see_costs(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_owner_or_admin(pid) or exists (
    select 1 from members m
    join member_teams mt on mt.member_id = m.id
    join teams t on t.id = mt.team_id and t.name = 'Production'
    where m.project_id = pid and m.account_id = auth.uid())
$$;

alter table schedule_items enable row level security;
alter table schedule_item_scenes enable row level security;
alter table schedule_item_costs enable row level security;
revoke all on schedule_items, schedule_item_scenes, schedule_item_costs from anon, authenticated;
grant select, insert, update, delete on schedule_items, schedule_item_scenes, schedule_item_costs to authenticated;

create policy items_read on schedule_items for select to authenticated using (can_view_section(project_id, item_section(kind)));
create policy items_insert on schedule_items for insert to authenticated
  with check (can_edit_section(project_id, item_section(kind), team_id) and team_project(team_id) = project_id);
create policy items_update on schedule_items for update to authenticated
  using (can_edit_section(project_id, item_section(kind), team_id))
  with check (can_edit_section(project_id, item_section(kind), team_id));
create policy items_delete on schedule_items for delete to authenticated
  using (can_edit_section(project_id, item_section(kind), team_id));

create policy itemscenes_read on schedule_item_scenes for select to authenticated
  using (can_view_section(project_id, item_section(item_kind_of(item_id))));
create policy itemscenes_insert on schedule_item_scenes for insert to authenticated
  with check (project_id = item_project_of(item_id)
    and can_edit_section(project_id, item_section(item_kind_of(item_id)), item_team_of(item_id)));
create policy itemscenes_delete on schedule_item_scenes for delete to authenticated
  using (can_edit_section(project_id, item_section(item_kind_of(item_id)), item_team_of(item_id)));

create policy itemcost_read on schedule_item_costs for select to authenticated using (can_see_costs(project_id));
create policy itemcost_insert on schedule_item_costs for insert to authenticated
  with check (can_see_costs(project_id) and project_id = item_project_of(item_id)
    and can_edit_section(project_id, item_section(item_kind_of(item_id)), null));
create policy itemcost_update on schedule_item_costs for update to authenticated
  using (can_see_costs(project_id) and can_edit_section(project_id, item_section(item_kind_of(item_id)), null))
  with check (can_see_costs(project_id) and can_edit_section(project_id, item_section(item_kind_of(item_id)), null));
create policy itemcost_delete on schedule_item_costs for delete to authenticated
  using (can_see_costs(project_id) and can_edit_section(project_id, item_section(item_kind_of(item_id)), null));

create function guard_schedule_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from schedules s where s.id = new.schedule_id and s.project_id = new.project_id) then
      raise exception 'That schedule is not in this project.';
    end if;
    new.created_by := auth.uid(); new.created_at := now();
  else
    if new.id <> old.id or new.project_id <> old.project_id or new.schedule_id <> old.schedule_id or new.kind <> old.kind
       or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'An item stays in its schedule and its list.';
    end if;
    if new.team_id <> old.team_id and not is_owner_or_admin(old.project_id) then
      raise exception 'Only the owner or an admin can move an item to another team.';
    end if;
  end if;
  new.updated_by := auth.uid(); new.updated_at := now();
  return new;
end $$;
create trigger guard_schedule_item before insert or update on schedule_items for each row execute function guard_schedule_item();

create function guard_item_scene() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from scenes s where s.id = new.scene_id and s.project_id = new.project_id) then
    raise exception 'That scene is not in this project.';
  end if;
  return new;
end $$;
create trigger guard_item_scene before insert on schedule_item_scenes for each row execute function guard_item_scene();

revoke execute on function guard_schedule_item(), guard_item_scene(), item_kind_of(uuid), item_team_of(uuid), item_project_of(uuid), can_see_costs(uuid), item_section(item_kind)
  from public, anon, authenticated;
grant execute on function item_kind_of(uuid), item_team_of(uuid), item_project_of(uuid), can_see_costs(uuid), item_section(item_kind) to authenticated;
