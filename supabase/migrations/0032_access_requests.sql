-- Page access requests (owner decision).
-- A member who cannot open a page can ask for it. The head of department of one of their teams, or the owner and admins,
-- approve or decline, and choose what to give: read only (view) or read and write (edit). Approving gives that one person
-- a personal grant; it does not change their team's settings. A personal write grant lets the person edit that page for
-- their own team's rows (it counts like edit level plus an edit grant). A head of department can give at most what they
-- hold themselves: with read-only access they can only give read only, and with no access to the page they never see the
-- request, so it goes to the owner and admins. The owner and admins can give either level and take a grant away again. Pages are the section keys (Script, Shot list and storyboard, Breakdown, Cast and crew,
-- Props, Equipment, Schedule, Call sheets, Project bible).

create table member_section_grants (
  member_id uuid not null references members (id) on delete cascade,
  section section_key not null,
  level access_level not null default 'view' check (level in ('view', 'edit')),
  project_id uuid not null references projects (id) on delete cascade,
  granted_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (member_id, section)
);
create index on member_section_grants (project_id);
alter table member_section_grants enable row level security;
revoke all on member_section_grants from anon, authenticated;
grant select, delete on member_section_grants to authenticated;
create policy msg_read on member_section_grants for select to authenticated
  using (is_owner_or_admin(project_id) or exists (select 1 from members m where m.id = member_id and m.account_id = auth.uid()));
create policy msg_delete on member_section_grants for delete to authenticated using (is_owner_or_admin(project_id));

create table access_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  member_id uuid not null references members (id) on delete cascade,
  section section_key not null,
  asked access_level not null default 'view' check (asked in ('view', 'edit')),   -- what the member asked for; the approver decides
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  decided_by uuid references profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index access_requests_one_open on access_requests (member_id, section) where status = 'pending';
create index on access_requests (project_id, status);
alter table access_requests enable row level security;
revoke all on access_requests from anon, authenticated;
grant select on access_requests to authenticated;

-- What the caller holds on a page: 'edit', 'view' or 'none' (owner and admins hold edit).
create function my_section_level(pid uuid, sec section_key) returns access_level
language sql stable security definer set search_path = public as $$
  select case when can_edit_section(pid, sec, null) then 'edit'::access_level
              when can_view_section(pid, sec) then 'view'::access_level else 'none'::access_level end
$$;
revoke execute on function my_section_level(uuid, section_key) from public, anon;
grant execute on function my_section_level(uuid, section_key) to authenticated;

-- May the caller decide this member's request for this page? Owner and admins always. The head of one of the member's
-- teams only if the head has at least read-only access to that page themselves.
create function can_decide_access_for(mid uuid, sec section_key) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members m where m.id = mid and is_owner_or_admin(m.project_id))
      or (exists (select 1 from member_teams mt where mt.member_id = mid and is_hod_of(mt.team_id))
          and exists (select 1 from members m where m.id = mid and my_section_level(m.project_id, sec) <> 'none'))
$$;
revoke execute on function can_decide_access_for(uuid, section_key) from public, anon;
grant execute on function can_decide_access_for(uuid, section_key) to authenticated;

create policy ar_read on access_requests for select to authenticated
  using (exists (select 1 from members m where m.id = member_id and m.account_id = auth.uid()) or can_decide_access_for(member_id, section));

-- Section view now also counts personal grants.
create or replace function can_view_section(pid uuid, sec section_key) returns boolean
language sql stable security definer set search_path = public as $$
  select is_owner_or_admin(pid) or exists (
    select 1 from members m
    join member_teams mt on mt.member_id = m.id
    join team_section_access a on a.team_id = mt.team_id and a.section = sec
    where m.project_id = pid and m.account_id = auth.uid() and a.level in ('view', 'edit'))
  or exists (
    select 1 from member_section_grants g join members m on m.id = g.member_id
    where g.project_id = pid and g.section = sec and m.account_id = auth.uid())
$$;

-- Edit now also counts a personal write grant, for the person's own team rows (any team when none is named).
create or replace function can_edit_section(pid uuid, sec section_key, tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_owner_or_admin(pid) or exists (
    select 1 from members m
    join member_teams mt on mt.member_id = m.id
    join team_section_access a on a.team_id = mt.team_id and a.section = sec
    where m.project_id = pid and m.account_id = auth.uid()
      and a.level = 'edit' and (mt.is_hod or mt.can_edit)
      and (tid is null or mt.team_id = tid))
  or exists (
    select 1 from member_section_grants g join members m on m.id = g.member_id
    where g.project_id = pid and g.section = sec and g.level = 'edit' and m.account_id = auth.uid()
      and (tid is null or exists (select 1 from member_teams mt where mt.member_id = m.id and mt.team_id = tid)))
$$;

-- Ask for a page.
create function request_access(pid uuid, sec section_key, ask access_level default 'view') returns uuid
language plpgsql security definer set search_path = public as $$
declare mid uuid; rid uuid;
begin
  if ask not in ('view', 'edit') then raise exception 'bad_level'; end if;
  select id into mid from members where project_id = pid and account_id = auth.uid();
  if mid is null then raise exception 'You are not on this project.'; end if;
  if (ask = 'view' and can_view_section(pid, sec)) or (ask = 'edit' and can_edit_section(pid, sec, null)) then raise exception 'already_has_access'; end if;
  insert into access_requests (project_id, member_id, section, asked) values (pid, mid, sec, ask) returning id into rid;
  return rid;
exception when unique_violation then
  raise exception 'already_requested';
end $$;

create function withdraw_access_request(rid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update access_requests r set status = 'withdrawn', decided_at = now()
  where r.id = rid and r.status = 'pending' and exists (select 1 from members m where m.id = r.member_id and m.account_id = auth.uid());
  if not found then raise exception 'That request is not open.'; end if;
end $$;

create function decide_access_request(rid uuid, approve boolean, give access_level default 'view') returns void
language plpgsql security definer set search_path = public as $$
declare r access_requests; cap access_level;
begin
  select * into r from access_requests where id = rid and status = 'pending';
  if not found then raise exception 'That request is not open.'; end if;
  if give not in ('view', 'edit') then raise exception 'bad_level'; end if;
  if not can_decide_access_for(r.member_id, r.section) then raise exception 'Only the head of their team, the owner or an admin can decide this.'; end if;
  if approve and not is_owner_or_admin(r.project_id) then
    -- a head of department gives at most what they hold themselves
    cap := my_section_level(r.project_id, r.section);
    if give = 'edit' and cap <> 'edit' then raise exception 'level_too_high'; end if;
  end if;
  update access_requests set status = case when approve then 'approved' else 'declined' end, decided_by = auth.uid(), decided_at = now() where id = rid;
  if approve then
    insert into member_section_grants (member_id, section, level, project_id, granted_by) values (r.member_id, r.section, give, r.project_id, auth.uid())
      on conflict (member_id, section) do update set level = case when excluded.level = 'edit' or member_section_grants.level = 'edit' then 'edit'::access_level else 'view'::access_level end, granted_by = auth.uid();
  end if;
end $$;

revoke execute on function request_access(uuid, section_key, access_level), withdraw_access_request(uuid), decide_access_request(uuid, boolean, access_level) from public, anon;
grant execute on function request_access(uuid, section_key, access_level), withdraw_access_request(uuid), decide_access_request(uuid, boolean, access_level) to authenticated;
