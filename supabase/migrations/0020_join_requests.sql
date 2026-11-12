-- Joining with a code now needs approval (planning document section 7).
-- A person who enters a team's join code does not become a member. They choose the team they belong to (the code's
-- team is pre-selected) and send a request. The HOD of that team, or the owner or an admin, approves or declines it.
-- When a member is added to a team (approval or an accepted email invite) they are also added to Cast and crew.
-- The old redeem_join_code function, which added people at once, is removed so codes cannot skip the approval.

create type join_status as enum ('pending', 'approved', 'declined', 'withdrawn');

create table join_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  team_id uuid not null references teams (id) on delete cascade,
  account_id uuid not null references profiles (id) on delete cascade,
  code_id uuid references join_codes (id) on delete set null,
  role text not null default '' check (length(role) <= 120),
  status join_status not null default 'pending',
  decided_by uuid references profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index one_open_join_request on join_requests (project_id, account_id) where status = 'pending';
create index on join_requests (project_id);
create index on join_requests (account_id);
alter table join_requests enable row level security;
revoke all on join_requests from anon, authenticated;   -- reached only through the functions below

-- Shared check for a code. Errors stay specific: code_not_found, code_revoked, code_expired.
create function check_join_code(join_code text) returns join_codes
language plpgsql security definer set search_path = public as $$
declare c join_codes;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into c from join_codes where code = upper(trim(join_code));
  if not found then raise exception 'code_not_found'; end if;
  if c.revoked_at is not null then raise exception 'code_revoked'; end if;
  if c.expires_at < now() then raise exception 'code_expired'; end if;
  if exists (select 1 from members where project_id = team_project(c.team_id) and account_id = auth.uid()) then
    raise exception 'already_member';
  end if;
  return c;
end $$;

-- What the person sees after entering a code: the project name and the teams to choose from.
create function lookup_join_code(join_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c join_codes; pid uuid;
begin
  c := check_join_code(join_code);
  pid := team_project(c.team_id);
  return jsonb_build_object(
    'project_name', (select name from projects where id = pid),
    'team_id', c.team_id,
    'teams', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name)), '[]'::jsonb) from teams t where t.project_id = pid));
end $$;

create function request_to_join(join_code text, team_in uuid, role_in text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare c join_codes; pid uuid; rid uuid;
begin
  c := check_join_code(join_code);
  pid := team_project(c.team_id);
  if team_in is null or team_project(team_in) is distinct from pid then raise exception 'team_not_in_project'; end if;
  role_in := left(trim(coalesce(role_in, '')), 120);
  update join_requests set team_id = team_in, role = role_in, code_id = c.id, created_at = now()
    where project_id = pid and account_id = auth.uid() and status = 'pending' returning id into rid;
  if rid is null then
    insert into join_requests (project_id, team_id, account_id, code_id, role) values (pid, team_in, auth.uid(), c.id, role_in)
      returning id into rid;
  end if;
  return rid;
end $$;

-- The caller's own requests: waiting ones, and declined ones from the last two weeks.
create function my_join_requests() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'status', r.status, 'project_id', r.project_id, 'project_name', p.name, 'team_id', r.team_id, 'team_name', t.name,
    'role', r.role, 'created_at', r.created_at, 'decided_at', r.decided_at,
    'has_hod', exists (select 1 from member_teams h where h.team_id = r.team_id and h.is_hod)) order by r.created_at desc), '[]'::jsonb)
  from join_requests r join projects p on p.id = r.project_id join teams t on t.id = r.team_id
  where r.account_id = auth.uid() and (r.status = 'pending' or (r.status = 'declined' and r.decided_at > now() - interval '14 days'))
$$;

create function withdraw_join_request(rid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update join_requests set status = 'withdrawn', decided_at = now()
    where id = rid and account_id = auth.uid() and status = 'pending';
  if not found then raise exception 'request_not_found'; end if;
end $$;

-- Pending requests the caller may decide: the owner and admins see all, an HOD sees those for their own teams.
create function list_join_requests(pid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'team_id', r.team_id, 'team_name', t.name, 'role', r.role, 'created_at', r.created_at,
    'name', coalesce(nullif(trim(p.display_name), ''), 'No name'), 'email', u.email,
    'has_hod', exists (select 1 from member_teams h where h.team_id = r.team_id and h.is_hod)) order by r.created_at), '[]'::jsonb)
  from join_requests r
  join teams t on t.id = r.team_id join profiles p on p.id = r.account_id join auth.users u on u.id = r.account_id
  where r.project_id = pid and r.status = 'pending' and (is_owner_or_admin(pid) or is_hod_of(r.team_id))
$$;

-- Add a member to Cast and crew as a crew row for their team, unless they already have a row in the project.
create function add_member_to_cast_crew(mid uuid, tid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m members; mail text; nm text; rid uuid;
begin
  select * into m from members where id = mid;
  if not found or m.account_id is null or m.role = 'owner' then return; end if;
  if exists (select 1 from cast_crew_rows where project_id = m.project_id and account_id = m.account_id) then return; end if;
  select lower(email) into mail from auth.users where id = m.account_id;
  select coalesce(nullif(trim(display_name), ''), split_part(coalesce(mail, ''), '@', 1)) into nm from profiles where id = m.account_id;
  perform set_config('lineboard.system', 'on', true);
  insert into cast_crew_rows (project_id, team_id, kind, name, department, account_id, from_account, created_by, updated_by)
    values (m.project_id, tid, 'crew', coalesce(nm, ''), (select name from teams where id = tid), m.account_id, true, auth.uid(), auth.uid())
    returning id into rid;
  if mail is not null and mail ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    insert into cast_crew_contacts (row_id, project_id, email) values (rid, m.project_id, mail);
  end if;
  perform set_config('lineboard.system', 'off', true);
end $$;

create function member_team_to_cast_crew() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform add_member_to_cast_crew(new.member_id, new.team_id);
  return new;
end $$;
create trigger member_team_to_cast_crew after insert on member_teams
  for each row execute function member_team_to_cast_crew();

create function decide_join_request(rid uuid, approve boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare r join_requests; mid uuid;
begin
  select * into r from join_requests where id = rid and status = 'pending' for update;
  if not found then raise exception 'request_not_found'; end if;
  if not (is_owner_or_admin(r.project_id) or is_hod_of(r.team_id)) then raise exception 'not_allowed'; end if;
  if approve then
    insert into members (project_id, account_id, role, invited_by) values (r.project_id, r.account_id, 'member', auth.uid())
      on conflict (project_id, account_id) do nothing;
    select id into mid from members where project_id = r.project_id and account_id = r.account_id;
    insert into scene_access (member_id, mode) values (mid, 'none') on conflict do nothing;
    insert into member_teams (member_id, team_id) values (mid, r.team_id) on conflict do nothing;
    if r.role <> '' then
      perform set_config('lineboard.system', 'on', true);
      update cast_crew_rows set role = r.role where project_id = r.project_id and account_id = r.account_id and role = '';
      perform set_config('lineboard.system', 'off', true);
    end if;
    update join_requests set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = rid;
  else
    update join_requests set status = 'declined', decided_by = auth.uid(), decided_at = now() where id = rid;
  end if;
  return r.project_id;
end $$;

-- Members who joined before this change and have no Cast and crew row get one now.
select add_member_to_cast_crew(x.member_id, x.team_id)
from (select distinct on (mt.member_id) mt.member_id, mt.team_id from member_teams mt order by mt.member_id, mt.is_hod desc, mt.team_id) x;

-- The old door: joining at once with a code.
drop function redeem_join_code(text);

revoke execute on function check_join_code(text), lookup_join_code(text), request_to_join(text, uuid, text), my_join_requests(),
  withdraw_join_request(uuid), list_join_requests(uuid), add_member_to_cast_crew(uuid, uuid), member_team_to_cast_crew(),
  decide_join_request(uuid, boolean) from public, anon, authenticated;
grant execute on function lookup_join_code(text), request_to_join(text, uuid, text), my_join_requests(),
  withdraw_join_request(uuid), list_join_requests(uuid), decide_join_request(uuid, boolean) to authenticated;
