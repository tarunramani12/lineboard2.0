-- LineBoard 2.0: base schema, permission rules (RLS) and functions.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Design: docs/base-design.md. Every permission is enforced here, not in the app.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type project_role as enum ('owner', 'admin', 'member');
create type section_key as enum (
  'script', 'shots', 'cast_crew', 'props_equipment', 'breakdown', 'schedule', 'call_sheets'
);
create type access_level as enum ('none', 'view', 'edit');
create type scene_status as enum ('active', 'omitted');
create type scene_access_mode as enum ('none', 'selected', 'all');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
-- Names only. Email lives in profile_private so co-members never see it.
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

create table profile_private (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  owner_id uuid not null references auth.users (id),
  status text not null default 'active' check (status in ('active', 'read_only')),
  script_locked boolean not null default false,
  draft_no integer not null default 0,
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  is_ad_team boolean not null default false,
  created_at timestamptz not null default now(),
  unique (project_id, name)
);

create table team_section_access (
  team_id uuid not null references teams (id) on delete cascade,
  section section_key not null,
  level access_level not null default 'none',
  primary key (team_id, section)
);

-- account_id becomes null when an account is deleted: the row stays as "Former member".
create table members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  account_id uuid references auth.users (id) on delete set null,
  role project_role not null default 'member',
  invited_by uuid references auth.users (id) on delete set null,
  joined_at timestamptz not null default now(),
  unique (project_id, account_id)
);
create unique index one_owner_per_project on members (project_id) where role = 'owner';

create table member_teams (
  member_id uuid not null references members (id) on delete cascade,
  team_id uuid not null references teams (id) on delete cascade,
  is_hod boolean not null default false,
  can_edit boolean not null default false, -- edit access granted by the HOD
  primary key (member_id, team_id)
);

create table invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  team_id uuid not null references teams (id) on delete cascade,
  email text not null check (email = lower(email)),
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index one_open_invite on invites (team_id, email) where accepted_at is null;

create table join_codes (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  code text not null unique
    default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '14 days',
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table script_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  version_no integer not null,
  note text,
  created_at timestamptz not null default now(),
  unique (project_id, version_no)
);

-- The scene is the permanent record. Its id never changes and is never reused.
create table scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  display_number text not null check (length(trim(display_number)) > 0),
  heading text not null default '',
  status scene_status not null default 'active',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (project_id, display_number)
);

-- Who may read scene text (action and dialogue, added with the Script feature).
create table scene_access (
  member_id uuid primary key references members (id) on delete cascade,
  mode scene_access_mode not null default 'none'
);
create table scene_access_scenes (
  member_id uuid not null references members (id) on delete cascade,
  scene_id uuid not null references scenes (id) on delete cascade,
  primary key (member_id, scene_id)
);

create index on members (account_id);
create index on member_teams (team_id);
create index on teams (project_id);
create index on scenes (project_id, sort_order);

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so policies stay short and never recurse)
-- ---------------------------------------------------------------------------
create function team_project(tid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select project_id from teams where id = tid
$$;

create function is_member(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where project_id = pid and account_id = auth.uid())
$$;

create function is_owner(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members
    where project_id = pid and account_id = auth.uid() and role = 'owner')
$$;

create function is_owner_or_admin(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members
    where project_id = pid and account_id = auth.uid() and role in ('owner', 'admin'))
$$;

create function is_hod_of(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from member_teams mt join members m on m.id = mt.member_id
    where mt.team_id = tid and mt.is_hod and m.account_id = auth.uid())
$$;

-- May the caller manage people in this team (owner, admin, or the team's HOD)?
create function can_manage_team(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_owner_or_admin(team_project(tid)) or is_hod_of(tid)
$$;

-- Can the caller see this section at all (any team of theirs allows view or edit)?
create function can_view_section(pid uuid, sec section_key) returns boolean
language sql stable security definer set search_path = public as $$
  select is_owner_or_admin(pid) or exists (
    select 1 from members m
    join member_teams mt on mt.member_id = m.id
    join team_section_access a on a.team_id = mt.team_id and a.section = sec
    where m.project_id = pid and m.account_id = auth.uid() and a.level in ('view', 'edit'))
$$;

-- Can the caller edit rows that belong to team tid in this section?
-- Needs: edit level for that team in the section, and HOD or HOD-granted edit access.
-- Pass tid = null to ask "can I edit this section for any team of mine?".
create function can_edit_section(pid uuid, sec section_key, tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_owner_or_admin(pid) or exists (
    select 1 from members m
    join member_teams mt on mt.member_id = m.id
    join team_section_access a on a.team_id = mt.team_id and a.section = sec
    where m.project_id = pid and m.account_id = auth.uid()
      and a.level = 'edit' and (mt.is_hod or mt.can_edit)
      and (tid is null or mt.team_id = tid))
$$;

-- May the caller read the text of this scene (used by the Script feature)?
create function can_read_scene_text(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from scenes s where s.id = sid and (
    is_owner_or_admin(s.project_id)
    or exists (
      select 1 from members m join scene_access sa on sa.member_id = m.id
      where m.project_id = s.project_id and m.account_id = auth.uid()
        and (sa.mode = 'all'
          or (sa.mode = 'selected' and exists (
            select 1 from scene_access_scenes x where x.member_id = m.id and x.scene_id = sid))))))
$$;

create function shares_project_with(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members a join members b on a.project_id = b.project_id
    where a.account_id = auth.uid() and b.account_id = uid)
$$;

-- ---------------------------------------------------------------------------
-- Guard triggers (rules that must hold for every request, from any client)
-- ---------------------------------------------------------------------------
-- Owner row is fixed; only the owner can make or remove an admin.
create function guard_members() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'owner' then raise exception 'The owner cannot be removed.'; end if;
    if old.role = 'admin' and not is_owner(old.project_id) and old.account_id is distinct from auth.uid() then
      raise exception 'Only the owner can remove an admin.';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.project_id <> old.project_id or new.account_id is distinct from old.account_id
       and new.account_id is not null then
      raise exception 'A member row cannot be moved.';
    end if;
    if new.role is distinct from old.role then
      if old.role = 'owner' or new.role = 'owner' then
        raise exception 'Ownership changes only by transfer.';
      end if;
      if not is_owner(old.project_id) then raise exception 'Only the owner can change admins.'; end if;
    end if;
  end if;
  return new;
end $$;
create trigger guard_members before update or delete on members
  for each row execute function guard_members();

-- Only owner/admin can appoint a HOD; a HOD can only grant edit access in their own team.
-- The member must belong to the same project as the team.
create function guard_member_teams() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  pid := team_project(new.team_id);
  if not exists (select 1 from members where id = new.member_id and project_id = pid) then
    raise exception 'That person is not on this project.';
  end if;
  if tg_op = 'INSERT' or new.is_hod is distinct from old.is_hod then
    if new.is_hod and not is_owner_or_admin(pid) then
      raise exception 'Only the owner or an admin can appoint a head of department.';
    end if;
  end if;
  return new;
end $$;
create trigger guard_member_teams before insert or update on member_teams
  for each row execute function guard_member_teams();

-- Scene rules: id and project never change. Locked script: numbers frozen, no deletes
-- (cut a scene by marking it omitted).
create function guard_scenes() returns trigger
language plpgsql security definer set search_path = public as $$
declare locked boolean;
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.project_id <> old.project_id then
      raise exception 'A scene id and its project never change.';
    end if;
    select script_locked into locked from projects where id = old.project_id;
    if locked and new.display_number <> old.display_number then
      raise exception 'The script is locked. Scene numbers cannot change. Unlock the script first.';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    select script_locked into locked from projects where id = old.project_id;
    if locked then
      raise exception 'The script is locked. Mark the scene omitted instead of deleting it.';
    end if;
    return old;
  end if;
  return new;
end $$;
create trigger guard_scenes before update or delete on scenes
  for each row execute function guard_scenes();

-- Only the owner locks or unlocks the script, and ownership never changes by plain update.
create function guard_projects() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id <> old.owner_id then raise exception 'Ownership changes only by transfer.'; end if;
  if new.script_locked is distinct from old.script_locked and not is_owner(old.id) then
    raise exception 'Only the owner can lock or unlock the script.';
  end if;
  return new;
end $$;
create trigger guard_projects before update on projects
  for each row execute function guard_projects();

-- ---------------------------------------------------------------------------
-- New account: create profile rows
-- ---------------------------------------------------------------------------
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  insert into profile_private (id, email) values (new.id, lower(new.email));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Functions the app calls
-- ---------------------------------------------------------------------------
-- Create a project: owner membership, ten default teams (Direction is flagged as the
-- AD team; the owner can change that), default section access, script version 1.
create function create_project(project_name text) returns uuid
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
        case when sec in ('schedule', 'call_sheets', 'cast_crew')
          then 'view'::access_level else 'none'::access_level end);
    end loop;
  end loop;
  insert into scene_access (member_id, mode) values (mid, 'all');
  insert into script_versions (project_id, version_no, note) values (pid, 1, 'First draft');
  return pid;
end $$;

-- Join with a code. Errors are specific: code_not_found, code_expired, code_revoked.
create function redeem_join_code(join_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c join_codes; pid uuid; mid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into c from join_codes where code = upper(trim(join_code));
  if not found then raise exception 'code_not_found'; end if;
  if c.revoked_at is not null then raise exception 'code_revoked'; end if;
  if c.expires_at < now() then raise exception 'code_expired'; end if;
  pid := team_project(c.team_id);
  insert into members (project_id, account_id, role) values (pid, auth.uid(), 'member')
    on conflict (project_id, account_id) do nothing;
  select id into mid from members where project_id = pid and account_id = auth.uid();
  insert into member_teams (member_id, team_id) values (mid, c.team_id) on conflict do nothing;
  insert into scene_access (member_id, mode) values (mid, 'none') on conflict do nothing;
  return pid;
end $$;

-- Accept every open invite addressed to the caller's verified email. Call after sign-in.
create function accept_pending_invites() returns setof uuid
language plpgsql security definer set search_path = public as $$
declare inv invites; mail text; mid uuid;
begin
  select lower(email) into mail from auth.users
    where id = auth.uid() and email_confirmed_at is not null;
  if mail is null then return; end if;
  for inv in select * from invites
      where email = mail and accepted_at is null and expires_at > now() loop
    insert into members (project_id, account_id, role, invited_by)
      values (inv.project_id, auth.uid(), 'member', inv.invited_by)
      on conflict (project_id, account_id) do nothing;
    select id into mid from members where project_id = inv.project_id and account_id = auth.uid();
    insert into member_teams (member_id, team_id) values (mid, inv.team_id) on conflict do nothing;
    insert into scene_access (member_id, mode) values (mid, 'none') on conflict do nothing;
    update invites set accepted_at = now() where id = inv.id;
    return next inv.project_id;
  end loop;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function create_project(text), redeem_join_code(text), accept_pending_invites()
  to authenticated;
grant execute on function team_project(uuid), is_member(uuid), is_owner(uuid),
  is_owner_or_admin(uuid), is_hod_of(uuid), can_manage_team(uuid),
  can_view_section(uuid, section_key), can_edit_section(uuid, section_key, uuid),
  can_read_scene_text(uuid), shares_project_with(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security: nothing is readable or writable unless a policy says so
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;
alter table profile_private enable row level security;
alter table projects enable row level security;
alter table teams enable row level security;
alter table team_section_access enable row level security;
alter table members enable row level security;
alter table member_teams enable row level security;
alter table invites enable row level security;
alter table join_codes enable row level security;
alter table script_versions enable row level security;
alter table scenes enable row level security;
alter table scene_access enable row level security;
alter table scene_access_scenes enable row level security;

-- Profiles: your own, and the names of people on your projects. Email: only your own.
create policy profiles_read on profiles for select to authenticated
  using (id = auth.uid() or shares_project_with(id));
create policy profiles_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy private_read on profile_private for select to authenticated
  using (id = auth.uid());

-- Projects (created only through create_project)
create policy projects_read on projects for select to authenticated using (is_member(id));
create policy projects_update on projects for update to authenticated
  using (is_owner_or_admin(id)) with check (is_owner_or_admin(id));
create policy projects_delete on projects for delete to authenticated using (is_owner(id));

-- Teams and their section access: members read, owner/admin change
create policy teams_read on teams for select to authenticated using (is_member(project_id));
create policy teams_write on teams for all to authenticated
  using (is_owner_or_admin(project_id)) with check (is_owner_or_admin(project_id));
create policy access_read on team_section_access for select to authenticated
  using (is_member(team_project(team_id)));
create policy access_write on team_section_access for all to authenticated
  using (is_owner_or_admin(team_project(team_id)))
  with check (is_owner_or_admin(team_project(team_id)));

-- Members: everyone on the project sees who is on it. Owner/admin manage; anyone can leave.
create policy members_read on members for select to authenticated using (is_member(project_id));
create policy members_update on members for update to authenticated
  using (is_owner_or_admin(project_id)) with check (is_owner_or_admin(project_id));
create policy members_delete on members for delete to authenticated
  using (is_owner_or_admin(project_id) or account_id = auth.uid());

-- Team membership: owner/admin and the team's HOD manage it (the trigger limits HOD appointment).
create policy mt_read on member_teams for select to authenticated
  using (is_member(team_project(team_id)));
create policy mt_write on member_teams for all to authenticated
  using (can_manage_team(team_id)) with check (can_manage_team(team_id));

-- Invites and join codes: owner/admin and the team's HOD
create policy invites_rw on invites for all to authenticated
  using (can_manage_team(team_id))
  with check (can_manage_team(team_id) and project_id = team_project(team_id));
create policy codes_rw on join_codes for all to authenticated
  using (can_manage_team(team_id)) with check (can_manage_team(team_id));

-- Script versions: members read, owner/admin write
create policy sv_read on script_versions for select to authenticated using (is_member(project_id));
create policy sv_write on script_versions for all to authenticated
  using (is_owner_or_admin(project_id)) with check (is_owner_or_admin(project_id));

-- Scenes: every member sees number, heading and status. Script editors change them.
create policy scenes_read on scenes for select to authenticated using (is_member(project_id));
create policy scenes_write on scenes for all to authenticated
  using (can_edit_section(project_id, 'script', null))
  with check (can_edit_section(project_id, 'script', null));

-- Script sharing: you see your own setting; owner/admin set it
create policy sa_read on scene_access for select to authenticated
  using (is_owner_or_admin((select project_id from members where id = member_id))
    or exists (select 1 from members m where m.id = member_id and m.account_id = auth.uid()));
create policy sa_write on scene_access for all to authenticated
  using (is_owner_or_admin((select project_id from members where id = member_id)))
  with check (is_owner_or_admin((select project_id from members where id = member_id)));
create policy sas_read on scene_access_scenes for select to authenticated
  using (is_owner_or_admin((select project_id from members where id = member_id))
    or exists (select 1 from members m where m.id = member_id and m.account_id = auth.uid()));
create policy sas_write on scene_access_scenes for all to authenticated
  using (is_owner_or_admin((select project_id from members where id = member_id)))
  with check (is_owner_or_admin((select project_id from members where id = member_id)));

-- Table privileges: signed-in users only, and only through the policies above.
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
