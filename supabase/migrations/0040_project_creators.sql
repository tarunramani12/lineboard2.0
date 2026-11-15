-- Who may create projects (temporary rule until payments and plans are decided).
--   * With the switch on, a project is created only by an account whose VERIFIED email is in project_creators.
--     Each row allows a number of projects (default 1); `created` counts projects ever made, so deleting a project does not give another.
--     `unlimited` rows (the owner's own emails) have no limit.
--   * The table has no policies: users cannot read or change it. The owner edits it in the Supabase Table Editor (or by SQL).
--   * Signing up, joining with a code, accepting an invite, being a member or admin and receiving a transferred project stay open to everyone.
--   * The switch is off here so existing tests keep passing; it is turned on for the live database after the owner's emails are added.
--   * New projects get a 350 MB picture limit (was 500). Existing projects keep their limit.

alter table projects alter column image_cap_mb set default 350;

create table app_settings (
  id boolean primary key default true check (id),
  project_creation_restricted boolean not null default false
);
insert into app_settings (id) values (true);
alter table app_settings enable row level security;
revoke all on app_settings from anon, authenticated;

create table project_creators (
  email text primary key,
  allowed integer not null default 1 check (allowed >= 0),
  unlimited boolean not null default false,
  created integer not null default 0 check (created >= 0),
  added_at timestamptz not null default now()
);
alter table project_creators enable row level security;
revoke all on project_creators from anon, authenticated;

create function tidy_creator_email() returns trigger
language plpgsql set search_path = public as $$
begin
  new.email := lower(btrim(new.email));
  if new.email = '' or position('@' in new.email) = 0 then raise exception 'That does not look like an email address.'; end if;
  return new;
end $$;
create trigger tidy_creator_email before insert or update on project_creators for each row execute function tidy_creator_email();

-- The caller's verified email, lower case ('' when none).
create function my_verified_email() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select lower(email) from auth.users where id = auth.uid() and email_confirmed_at is not null), '')
$$;

-- 'ok', 'not_invited' or 'projects_used'. The Projects page asks this so it never offers a button that fails.
create function can_create_project() returns text
language plpgsql stable security definer set search_path = public as $$
declare restricted boolean; pc project_creators;
begin
  if auth.uid() is null then return 'not_invited'; end if;
  select project_creation_restricted into restricted from app_settings where id;
  if not coalesce(restricted, false) then return 'ok'; end if;
  select * into pc from project_creators where email = my_verified_email();
  if not found then return 'not_invited'; end if;
  if pc.unlimited or pc.created < pc.allowed then return 'ok'; end if;
  return 'projects_used';
end $$;

revoke execute on function tidy_creator_email(), my_verified_email() from public, anon, authenticated;
revoke execute on function can_create_project() from public, anon;
grant execute on function can_create_project() to authenticated;

-- create_project: the 0039 version plus the permission check and the counter.
create or replace function create_project(project_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid; mid uuid; tid uuid; dept text; sec section_key; restricted boolean; pc project_creators;
  depts text[] := array['Direction', 'Production', 'Camera', 'Lighting and grip', 'Sound',
    'Art', 'Costume', 'Makeup and hair', 'VFX', 'Post'];
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select project_creation_restricted into restricted from app_settings where id;
  if coalesce(restricted, false) then
    select * into pc from project_creators where email = my_verified_email() for update;
    if not found then raise exception 'not_invited'; end if;
    if not pc.unlimited and pc.created >= pc.allowed then raise exception 'projects_used'; end if;
    update project_creators set created = created + 1 where email = pc.email;
  end if;
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
