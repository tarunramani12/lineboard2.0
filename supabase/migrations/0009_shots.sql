-- Shot list (planning document section 10).
-- A shot belongs to a scene (by id, so a script revision never breaks it) and to an owning team.
-- The shot number is not stored: it reads scene number, dash, place in the scene (42-1, 42-2).
--
-- Who may change what, enforced here and not only in the screen:
--   * The owning team's editors (edit level on Shots for that team, plus HOD or an edit grant) change everything except status.
--   * Status (planned, done, dropped) is changed only by AD-team members with an edit grant, and by the owner and admins.
--   * The VFX team and the Sound team may fill in their own field (VFX required, sound effects required) on shots they do not own.
--   * Everyone with view access to Shots reads every shot.

create type shot_status as enum ('planned', 'done', 'dropped');

create function scene_project(sid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select project_id from scenes where id = sid
$$;

-- AD-team members who hold an edit grant (HOD or can_edit) and can see the shot list, plus owner and admins.
create function can_change_shot_status(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_owner_or_admin(pid) or exists (
    select 1 from members m
    join member_teams mt on mt.member_id = m.id
    join teams t on t.id = mt.team_id and t.is_ad_team
    join team_section_access a on a.team_id = t.id and a.section = 'shots'
    where m.project_id = pid and m.account_id = auth.uid()
      and (mt.is_hod or mt.can_edit) and a.level in ('view', 'edit'))
$$;

-- Can the caller edit shots as the team with this name (VFX, Sound)? False when the team does not exist.
create function can_edit_shots_as(pid uuid, team_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams t
    where t.project_id = pid and t.name = team_name and can_edit_section(pid, 'shots', t.id))
$$;

create table shots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  scene_id uuid not null references scenes (id) on delete cascade,
  team_id uuid not null references teams (id),
  position integer not null default 10,
  status shot_status not null default 'planned',
  description text not null default '' check (length(description) <= 500),
  size text not null default '' check (length(size) <= 60),
  shot_type text not null default '' check (length(shot_type) <= 60),
  lens text not null default '' check (length(lens) <= 60),
  movement text not null default '' check (length(movement) <= 60),
  action text not null default '' check (length(action) <= 3000),
  cast_needed text not null default '' check (length(cast_needed) <= 500),
  crew_needed text not null default '' check (length(crew_needed) <= 500),
  vfx_required text not null default '' check (length(vfx_required) <= 1000),
  sound_required text not null default '' check (length(sound_required) <= 1000),
  special_effects text not null default '' check (length(special_effects) <= 1000),
  silent boolean not null default false,
  notes text not null default '' check (length(notes) <= 3000),
  created_by uuid references profiles (id) on delete set null,
  updated_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on shots (scene_id, position);
create index on shots (project_id);

alter table shots enable row level security;
revoke all on shots from anon, authenticated;
grant select, insert, update, delete on shots to authenticated;

create policy shots_read on shots for select to authenticated
  using (can_view_section(project_id, 'shots'));

create policy shots_insert on shots for insert to authenticated
  with check (
    can_edit_section(project_id, 'shots', team_id)
    and project_id = scene_project(scene_id)
    and team_project(team_id) = project_id);

-- The trigger below decides which columns each person may change.
create policy shots_update on shots for update to authenticated
  using (
    can_edit_section(project_id, 'shots', team_id)
    or can_edit_shots_as(project_id, 'VFX') or can_edit_shots_as(project_id, 'Sound')
    or can_change_shot_status(project_id))
  with check (can_view_section(project_id, 'shots'));

create policy shots_delete on shots for delete to authenticated
  using (can_edit_section(project_id, 'shots', team_id));

create function guard_shot_insert() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status <> 'planned' and not can_change_shot_status(new.project_id) then
    raise exception 'Only the AD team can change a shot''s status.';
  end if;
  new.created_by := auth.uid();
  new.updated_by := auth.uid();
  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;
create trigger guard_shot_insert before insert on shots
  for each row execute function guard_shot_insert();

create function guard_shot_update() returns trigger
language plpgsql set search_path = public as $$
declare owner_team boolean;
begin
  if new.id <> old.id or new.project_id <> old.project_id or new.scene_id <> old.scene_id
     or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'A shot''s scene and project never change.';
  end if;
  owner_team := can_edit_section(old.project_id, 'shots', old.team_id);
  if new.team_id <> old.team_id then
    if not (owner_team and can_edit_section(old.project_id, 'shots', new.team_id) and team_project(new.team_id) = old.project_id) then
      raise exception 'Only the owning team can hand a shot to another team you can edit for.';
    end if;
  end if;
  if new.status <> old.status and not can_change_shot_status(old.project_id) then
    raise exception 'Only the AD team can change a shot''s status.';
  end if;
  if new.vfx_required is distinct from old.vfx_required and not (owner_team or can_edit_shots_as(old.project_id, 'VFX')) then
    raise exception 'Only the owning team or the VFX team can change VFX required.';
  end if;
  if new.sound_required is distinct from old.sound_required and not (owner_team or can_edit_shots_as(old.project_id, 'Sound')) then
    raise exception 'Only the owning team or the Sound team can change sound effects required.';
  end if;
  if (new.position, new.description, new.size, new.shot_type, new.lens, new.movement, new.action, new.cast_needed,
      new.crew_needed, new.special_effects, new.silent, new.notes)
     is distinct from
     (old.position, old.description, old.size, old.shot_type, old.lens, old.movement, old.action, old.cast_needed,
      old.crew_needed, old.special_effects, old.silent, old.notes)
     and not owner_team then
    raise exception 'Only the owning team can change this shot.';
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
create trigger guard_shot_update before update on shots
  for each row execute function guard_shot_update();

revoke execute on function can_change_shot_status(uuid), can_edit_shots_as(uuid, text), scene_project(uuid) from public, anon;
grant execute on function can_change_shot_status(uuid), can_edit_shots_as(uuid, text), scene_project(uuid) to authenticated;
