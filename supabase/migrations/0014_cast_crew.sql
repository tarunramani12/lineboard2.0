-- Cast and crew (planning document section 12).
-- One list per project. A row is a cast member or a crew member, owned by one team.
-- Who may do what, enforced here and not only in the screen:
--   * Everyone with view access to Cast and crew reads names, roles, teams and times.
--   * Phone and email live in a separate table that only the owner, admins and the AD team can read or change.
--   * A row's team editors change it. The owner and admins move a row to another team.
--   * Rows made by "detect cast" (auto) are locked: they cannot be deleted and their character cannot be renamed.
--   * A person with an account who joins with the same verified email as a row's email is linked to that row.
--   * When an account is deleted its rows stay as "Former member": name, email and phone are removed.

create type crew_kind as enum ('cast', 'crew');

create table cast_crew_rows (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  team_id uuid not null references teams (id),
  kind crew_kind not null default 'crew',
  name text not null default '' check (length(name) <= 120),
  role text not null default '' check (length(role) <= 120),         -- the character for cast, the job for crew
  department text not null default '' check (length(department) <= 60), -- free to extend: anyone who can add a person can add a department
  call_time text not null default '' check (call_time = '' or call_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  makeup_time text not null default '' check (makeup_time = '' or makeup_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  notes text not null default '' check (length(notes) <= 500),
  account_id uuid references profiles (id) on delete set null,
  from_account boolean not null default false,                      -- was linked to an account at some point
  auto boolean not null default false,                              -- found in the script's dialogue cues
  created_by uuid references profiles (id) on delete set null,
  updated_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (auto or from_account or length(trim(name)) > 0),
  check (not auto or kind = 'cast')
);
create index on cast_crew_rows (project_id);
create index on cast_crew_rows (account_id);

create table cast_crew_contacts (
  row_id uuid primary key references cast_crew_rows (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  phone text not null default '' check (length(phone) <= 40),
  email text not null default '' check (length(email) <= 200 and (email = '' or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'))
);
create index on cast_crew_contacts (project_id);

create function cast_row_team(rid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from cast_crew_rows where id = rid
$$;

-- Owner and admins, and AD-team members who can see Cast and crew, may handle contact details.
create function can_see_contacts(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_owner_or_admin(pid) or exists (
    select 1 from members m
    join member_teams mt on mt.member_id = m.id
    join teams t on t.id = mt.team_id and t.is_ad_team
    join team_section_access a on a.team_id = t.id and a.section = 'cast_crew'
    where m.project_id = pid and m.account_id = auth.uid() and a.level in ('view', 'edit'))
$$;

alter table cast_crew_rows enable row level security;
alter table cast_crew_contacts enable row level security;
revoke all on cast_crew_rows, cast_crew_contacts from anon, authenticated;
grant select, insert, update, delete on cast_crew_rows, cast_crew_contacts to authenticated;

create policy ccrows_read on cast_crew_rows for select to authenticated
  using (can_view_section(project_id, 'cast_crew'));
create policy ccrows_insert on cast_crew_rows for insert to authenticated
  with check (can_edit_section(project_id, 'cast_crew', team_id) and team_project(team_id) = project_id);
create policy ccrows_update on cast_crew_rows for update to authenticated
  using (can_edit_section(project_id, 'cast_crew', team_id))
  with check (can_edit_section(project_id, 'cast_crew', team_id));
create policy ccrows_delete on cast_crew_rows for delete to authenticated
  using (can_edit_section(project_id, 'cast_crew', team_id));

create policy cccontacts_read on cast_crew_contacts for select to authenticated
  using (can_see_contacts(project_id));
create policy cccontacts_write on cast_crew_contacts for insert to authenticated
  with check (can_see_contacts(project_id) and can_edit_section(project_id, 'cast_crew', cast_row_team(row_id)));
create policy cccontacts_update on cast_crew_contacts for update to authenticated
  using (can_see_contacts(project_id) and can_edit_section(project_id, 'cast_crew', cast_row_team(row_id)))
  with check (can_see_contacts(project_id) and can_edit_section(project_id, 'cast_crew', cast_row_team(row_id)));
create policy cccontacts_delete on cast_crew_contacts for delete to authenticated
  using (can_see_contacts(project_id) and can_edit_section(project_id, 'cast_crew', cast_row_team(row_id)));

create function system_switch_on() returns boolean
language sql stable set search_path = public as $$
  select coalesce(current_setting('lineboard.system', true), '') = 'on'
$$;

create function guard_cast_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if system_switch_on() then if tg_op = 'DELETE' then return old; end if; return new; end if;
  if tg_op = 'DELETE' then
    if old.auto then raise exception 'This cast row came from the script and cannot be deleted.'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_at := now();
    if new.auto then raise exception 'Use Detect cast to add cast from the script.'; end if;
  else
    if new.id <> old.id or new.project_id <> old.project_id or new.created_by is distinct from old.created_by
       or new.created_at <> old.created_at or new.auto <> old.auto then
      raise exception 'A row''s project never changes.';
    end if;
    if new.team_id <> old.team_id and not is_owner_or_admin(old.project_id) then
      raise exception 'Only the owner or an admin can move a row to another team.';
    end if;
    if old.auto and (new.role <> old.role or new.kind <> old.kind) then
      raise exception 'The character of a cast row from the script cannot be changed.';
    end if;
  end if;
  if new.account_id is not null then
    if not exists (select 1 from members where project_id = new.project_id and account_id = new.account_id) then
      raise exception 'That person is not on this project.';
    end if;
    new.from_account := true;
  end if;
  new.updated_by := auth.uid(); new.updated_at := now();
  return new;
end $$;
create trigger guard_cast_row before insert or update or delete on cast_crew_rows
  for each row execute function guard_cast_row();

-- A contact email that matches a project member's verified email links the row to that account.
create function link_row_by_contact() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid; acct uuid;
begin
  if new.email = '' then return new; end if;
  select project_id into pid from cast_crew_rows where id = new.row_id and account_id is null;
  if pid is null then return new; end if;
  select m.account_id into acct from members m join auth.users u on u.id = m.account_id
    where m.project_id = pid and lower(u.email) = lower(new.email) and u.email_confirmed_at is not null limit 1;
  if acct is not null then
    perform set_config('lineboard.system', 'on', true);
    update cast_crew_rows set account_id = acct, from_account = true where id = new.row_id;
    perform set_config('lineboard.system', 'off', true);
  end if;
  return new;
end $$;
create trigger link_row_by_contact after insert or update of email on cast_crew_contacts
  for each row execute function link_row_by_contact();

-- A person who joins with the same verified email as a row's email is linked to it.
create function link_rows_on_join() returns trigger
language plpgsql security definer set search_path = public as $$
declare mail text;
begin
  if new.account_id is null then return new; end if;
  select lower(email) into mail from auth.users where id = new.account_id and email_confirmed_at is not null;
  if mail is null then return new; end if;
  perform set_config('lineboard.system', 'on', true);
  update cast_crew_rows r set account_id = new.account_id, from_account = true
    from cast_crew_contacts c
    where c.row_id = r.id and r.project_id = new.project_id and r.account_id is null and lower(c.email) = mail;
  perform set_config('lineboard.system', 'off', true);
  return new;
end $$;
create trigger link_rows_on_join after insert on members
  for each row execute function link_rows_on_join();

-- Deleting an account leaves its rows as "Former member": no name, no email, no phone.
create function forget_account_rows() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('lineboard.system', 'on', true);
  delete from cast_crew_contacts where row_id in (select id from cast_crew_rows where account_id = old.id);
  update cast_crew_rows set name = '', from_account = true where account_id = old.id;
  perform set_config('lineboard.system', 'off', true);
  return old;
end $$;
create trigger forget_account_rows before delete on profiles
  for each row execute function forget_account_rows();

-- Detect cast: add a locked row for every speaking character in the active scenes that has none yet.
create function detect_cast(pid uuid, for_team uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not can_edit_section(pid, 'cast_crew', for_team) or team_project(for_team) <> pid then
    raise exception 'You cannot add to Cast and crew for that team.';
  end if;
  perform set_config('lineboard.system', 'on', true);
  with names as (
    select distinct on (upper(btrim(regexp_replace(regexp_replace(e ->> 'text', '\(.*?\)', '', 'g'), '\s+', ' ', 'g'))))
      initcap(lower(btrim(regexp_replace(regexp_replace(e ->> 'text', '\(.*?\)', '', 'g'), '\s+', ' ', 'g')))) as nm
    from scenes s
    join scene_text t on t.scene_id = s.id
    cross join lateral jsonb_array_elements(t.elements) e
    where s.project_id = pid and s.status = 'active' and e ->> 'kind' = 'character'
      and btrim(regexp_replace(regexp_replace(e ->> 'text', '\(.*?\)', '', 'g'), '\s+', ' ', 'g')) <> ''
  ), ins as (
    insert into cast_crew_rows (project_id, team_id, kind, role, auto, created_by, updated_by)
    select pid, for_team, 'cast', nm, true, auth.uid(), auth.uid() from names
    where not exists (select 1 from cast_crew_rows r where r.project_id = pid and r.kind = 'cast' and lower(r.role) = lower(nm))
    returning 1
  ) select count(*) into n from ins;
  perform set_config('lineboard.system', 'off', true);
  return n;
end $$;

revoke execute on function cast_row_team(uuid), can_see_contacts(uuid), guard_cast_row(), link_row_by_contact(), link_rows_on_join(), forget_account_rows(),
  system_switch_on(), detect_cast(uuid, uuid) from public, anon, authenticated;
grant execute on function detect_cast(uuid, uuid), cast_row_team(uuid), can_see_contacts(uuid) to authenticated;
