-- Usage dashboard for the app owner (read only). Everything here is calculated from data the app already has.
--   * app_admins lists who may open the dashboard (verified email). It starts with the emails that are `unlimited` in project_creators
--     (the owner's own). Nobody can read or change the table from the app; edit it in the Supabase Table Editor.
--   * is_app_admin() says yes or no for the signed-in person (the app shows the link only when yes).
--   * app_overview(), app_projects() and app_people() refuse everyone else with the message not_allowed. They return other people's names
--     and emails, which is why the check is inside each function and not only in the screen.
--   * Nothing is written anywhere. No new tracking of people is added by this migration.

create table app_admins (
  email text primary key,
  added_at timestamptz not null default now()
);
alter table app_admins enable row level security;
revoke all on app_admins from anon, authenticated;
create trigger tidy_admin_email before insert or update on app_admins for each row execute function tidy_creator_email();
insert into app_admins (email) select email from project_creators where unlimited on conflict do nothing;

create function is_app_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_admins where email = my_verified_email())
$$;

create function require_app_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'not_allowed'; end if;
end $$;

-- Totals for the top of the dashboard, as one json object.
create function app_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform require_app_admin();
  select jsonb_build_object(
    'generated_at', now(),
    'accounts', (select count(*) from auth.users),
    'accounts_new_7d', (select count(*) from profiles where created_at > now() - interval '7 days'),
    'accounts_new_30d', (select count(*) from profiles where created_at > now() - interval '30 days'),
    'accounts_active_7d', (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
    'accounts_active_30d', (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'),
    'projects', (select count(*) from projects),
    'projects_active_30d', (select count(*) from projects where last_active_at > now() - interval '30 days'),
    'projects_read_only', (select count(*) from projects where status = 'read_only'),
    'projects_script_locked', (select count(*) from projects where script_locked),
    'owners', (select count(distinct owner_id) from projects),
    'admins', (select count(distinct account_id) from members where role = 'admin'),
    'memberships', (select count(*) from members),
    'people_in_projects', (select count(distinct account_id) from members),
    'avg_people_per_project', (select coalesce(round(avg(n), 1), 0) from (select count(*) n from members group by project_id) x),
    'max_people_in_a_project', (select coalesce(max(n), 0) from (select count(*) n from members group by project_id) x),
    'avg_projects_per_owner', (select coalesce(round(avg(n), 1), 0) from (select count(*) n from projects group by owner_id) x),
    'scenes', (select count(*) from scenes),
    'shots', (select count(*) from shots),
    'storyboard_frames', (select count(*) from storyboard_frames),
    'cast_crew_rows', (select count(*) from cast_crew_rows),
    'call_sheets', (select count(*) from call_sheets),
    'locations', (select count(*) from locations),
    'schedules', (select count(*) from schedules),
    'storage_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects),
    'storage_files', (select count(*) from storage.objects),
    'storage_by_bucket', (select coalesce(jsonb_object_agg(bucket_id, b), '{}'::jsonb) from
       (select bucket_id, coalesce(sum((metadata->>'size')::bigint), 0) b from storage.objects group by bucket_id) x),
    'emails_sent_30d', (select count(*) from email_outbox where status = 'sent' and created_at > now() - interval '30 days'),
    'emails_failed', (select count(*) from email_outbox where status = 'failed'),
    'emails_waiting', (select count(*) from email_outbox where status in ('queued', 'sending')),
    'join_requests_waiting', (select count(*) from join_requests where status = 'pending')
  ) into r;
  return r;
end $$;

-- One row per project.
create function app_projects() returns table (
  project_id uuid, name text, owner_name text, owner_email text, created_at timestamptz, last_active_at timestamptz,
  status text, script_locked boolean, people integer, admins integer, scenes integer, shots integer, frames integer,
  storage_bytes bigint, image_cap_mb integer)
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_app_admin();
  return query
  select p.id, p.name, coalesce(pr.display_name, ''), coalesce(u.email, ''), p.created_at, p.last_active_at, p.status, p.script_locked,
    (select count(*)::int from members m where m.project_id = p.id),
    (select count(*)::int from members m where m.project_id = p.id and m.role = 'admin'),
    (select count(*)::int from scenes s where s.project_id = p.id),
    (select count(*)::int from shots h where h.project_id = p.id),
    (select count(*)::int from storyboard_frames f where f.project_id = p.id),
    coalesce((select sum((o.metadata->>'size')::bigint) from storage.objects o where split_part(o.name, '/', 1) = p.id::text), 0)::bigint,
    p.image_cap_mb
  from projects p
  left join profiles pr on pr.id = p.owner_id
  left join auth.users u on u.id = p.owner_id
  order by p.last_active_at desc;
end $$;

-- One row per account.
create function app_people() returns table (
  account_id uuid, display_name text, email text, created_at timestamptz, last_sign_in_at timestamptz,
  projects_owned integer, projects_admin integer, projects_member integer, storage_bytes bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_app_admin();
  return query
  select u.id, coalesce(pr.display_name, ''), coalesce(u.email, ''), coalesce(pr.created_at, u.created_at), u.last_sign_in_at,
    (select count(*)::int from members m where m.account_id = u.id and m.role = 'owner'),
    (select count(*)::int from members m where m.account_id = u.id and m.role = 'admin'),
    (select count(*)::int from members m where m.account_id = u.id and m.role = 'member'),
    coalesce((select sum((o.metadata->>'size')::bigint) from storage.objects o
              where split_part(o.name, '/', 1) in (select p.id::text from projects p where p.owner_id = u.id)), 0)::bigint
  from auth.users u
  left join profiles pr on pr.id = u.id
  order by coalesce(pr.created_at, u.created_at) desc;
end $$;

revoke execute on function require_app_admin() from public, anon, authenticated;
revoke execute on function is_app_admin(), app_overview(), app_projects(), app_people() from public, anon;
grant execute on function is_app_admin(), app_overview(), app_projects(), app_people() to authenticated;
