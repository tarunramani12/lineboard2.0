-- Email from {id}@lineboard.app (plan: Stage 2).
-- 1. Each project can choose a sending id, a display name and a reply address.
-- 2. email_outbox is a queue. Triggers add rows for join requests and their answers. The Edge Function send-email
--    (service role only) claims rows, sends them through Resend and reports back. Daily caps keep us inside the free plan.
-- Nobody can write to the outbox directly; the owner and admins can read their own project's rows.

alter table projects
  add column mail_id text,
  add column mail_name text not null default '' check (length(mail_name) <= 60),
  add column reply_to text not null default '' check (length(reply_to) <= 200),
  add column mail_id_changed_at timestamptz,
  add column email_paused boolean not null default false;   -- set by the system or LineBoard staff, not by owners

create unique index projects_mail_id_key on projects (mail_id) where mail_id is not null;
alter table projects add constraint projects_mail_id_format
  check (mail_id is null or mail_id ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$');

-- Names nobody may take: role addresses and well-known brands.
create function mail_id_reserved(candidate text) returns boolean
language sql immutable as $$
  select replace(candidate, '-', '') = any (array[
    'support','admin','administrator','help','billing','noreply','donotreply','security','postmaster','abuse','hostmaster',
    'webmaster','info','contact','sales','team','staff','official','root','mail','email','privacy','legal','press','jobs',
    'lineboard','lineboardapp','netflix','disney','amazon','apple','google','microsoft','paypal','stripe','meta','facebook',
    'instagram','youtube','warner','warnerbros','universal','paramount','sony','hbo','bbc','hulu','spotify','tesla'
  ])
$$;

-- The sending columns change only through set_mail_identity (which raises the system switch) or by LineBoard staff in the database.
create function guard_project_mail() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.mail_id is distinct from old.mail_id or new.mail_name is distinct from old.mail_name or new.reply_to is distinct from old.reply_to
      or new.mail_id_changed_at is distinct from old.mail_id_changed_at or new.email_paused is distinct from old.email_paused)
     and coalesce(current_setting('lineboard.system', true), '') <> 'on' and auth.uid() is not null then
    raise exception 'Change the sending identity in the email settings.';
  end if;
  return new;
end $$;
create trigger guard_project_mail before update on projects for each row execute function guard_project_mail();

-- Only the owner changes the sending identity. The id itself can change once every 7 days.
create function set_mail_identity(pid uuid, new_id text, new_name text, new_reply text) returns void
language plpgsql security definer set search_path = public as $$
declare p projects; mid text := nullif(lower(trim(coalesce(new_id, ''))), '');
begin
  select * into p from projects where id = pid for update;
  if not found then raise exception 'project_not_found'; end if;
  if p.owner_id is distinct from auth.uid() then raise exception 'not_allowed'; end if;
  if mid is not null then
    if mid !~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' then raise exception 'mail_id_format'; end if;
    if mail_id_reserved(mid) then raise exception 'mail_id_reserved'; end if;
    if mid is distinct from p.mail_id then
      if exists (select 1 from projects where mail_id = mid and id <> pid) then raise exception 'mail_id_taken'; end if;
      if p.mail_id is not null and p.mail_id_changed_at > now() - interval '7 days' then raise exception 'mail_id_changed_recently'; end if;
    end if;
  end if;
  if coalesce(trim(new_reply), '') <> '' and trim(new_reply) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'reply_format'; end if;
  perform set_config('lineboard.system', 'on', true);
  update projects set
    mail_id = mid,
    mail_name = left(trim(coalesce(new_name, '')), 60),
    reply_to = left(trim(coalesce(new_reply, '')), 200),
    mail_id_changed_at = case when mid is distinct from p.mail_id then now() else p.mail_id_changed_at end
  where id = pid;
  perform set_config('lineboard.system', 'off', true);
end $$;

-- ---- the queue
create table email_outbox (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects (id) on delete cascade,
  kind text not null check (kind in ('join_request', 'join_decision', 'call_sheet', 'invite', 'test')),
  to_email text not null check (length(to_email) between 3 and 200),
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  next_try_at timestamptz not null default now(),
  last_error text not null default '',
  provider_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index on email_outbox (status, next_try_at);
create index on email_outbox (project_id, created_at desc);
alter table email_outbox enable row level security;
revoke all on email_outbox from anon, authenticated;
grant select on email_outbox to authenticated;
create policy outbox_read on email_outbox for select to authenticated using (project_id is not null and is_owner_or_admin(project_id));

-- Queue one email. Internal: only triggers and other functions call it.
create function queue_email(pid uuid, k text, to_addr text, data jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if to_addr is null or to_addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return; end if;
  insert into email_outbox (project_id, kind, to_email, payload) values (pid, k, lower(to_addr), coalesce(data, '{}'));
end $$;

-- A new join request goes to the head of the team, or to the owner and admins when the team has no head.
create function email_on_join_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; pname text; tname text; rname text; hod boolean;
begin
  select name into pname from projects where id = new.project_id;
  select name into tname from teams where id = new.team_id;
  select coalesce(nullif(display_name, ''), 'Someone') into rname from profiles where id = new.account_id;
  hod := exists (select 1 from member_teams where team_id = new.team_id and is_hod);
  for who in
    select u.email from auth.users u
    where u.id in (
      select m.account_id from members m
      where m.project_id = new.project_id
        and ((hod and exists (select 1 from member_teams mt where mt.member_id = m.id and mt.team_id = new.team_id and mt.is_hod))
          or (not hod and m.role in ('owner', 'admin'))))
      and u.id <> new.account_id
  loop
    perform queue_email(new.project_id, 'join_request', who,
      jsonb_build_object('project', pname, 'team', tname, 'person', rname, 'role', new.role));
  end loop;
  return new;
end $$;
create trigger join_request_email after insert on join_requests for each row execute function email_on_join_request();

-- The answer goes to the person who asked.
create function email_on_join_decision() returns trigger
language plpgsql security definer set search_path = public as $$
declare addr text; pname text; tname text;
begin
  if new.status in ('approved', 'declined') and old.status = 'pending' then
    select email into addr from auth.users where id = new.account_id;
    select name into pname from projects where id = new.project_id;
    select name into tname from teams where id = new.team_id;
    perform queue_email(new.project_id, 'join_decision', addr,
      jsonb_build_object('project', pname, 'team', tname, 'approved', new.status = 'approved'));
  end if;
  return new;
end $$;
create trigger join_decision_email after update on join_requests for each row execute function email_on_join_decision();

-- ---- sending side (service role only)
-- Caps: 40 a project and 80 in all per UTC day, under the Resend free plan (100 a day). Rows over a cap wait for tomorrow.
create function claim_outbox(batch integer default 10) returns setof email_outbox
language plpgsql security definer set search_path = public as $$
declare r email_outbox; per_project integer := 40; app_wide integer := 80; used_all integer; used_p integer; got integer := 0;
begin
  -- a row stuck in 'sending' for 10 minutes (function died) goes back in the queue
  update email_outbox set status = 'queued' where status = 'sending' and next_try_at < now() - interval '10 minutes';
  select count(*) into used_all from email_outbox where status in ('sent', 'sending') and coalesce(sent_at, next_try_at) >= date_trunc('day', now());
  for r in select * from email_outbox where status = 'queued' and next_try_at <= now() order by created_at limit greatest(batch, 1) * 5 for update skip locked
  loop
    exit when got >= batch or used_all >= app_wide;
    select count(*) into used_p from email_outbox
      where project_id is not distinct from r.project_id and status in ('sent', 'sending') and coalesce(sent_at, next_try_at) >= date_trunc('day', now());
    if used_p >= per_project or exists (select 1 from projects where id = r.project_id and email_paused) then
      update email_outbox set next_try_at = date_trunc('day', now()) + interval '1 day' where id = r.id;   -- try again tomorrow
      continue;
    end if;
    update email_outbox set status = 'sending', attempts = attempts + 1, next_try_at = now() where id = r.id returning * into r;
    used_all := used_all + 1; got := got + 1;
    return next r;
  end loop;
end $$;

create function finish_outbox(oid uuid, success boolean, provider text default null, err text default '') returns void
language plpgsql security definer set search_path = public as $$
declare r email_outbox;
begin
  select * into r from email_outbox where id = oid and status = 'sending' for update;
  if not found then return; end if;
  if success then
    update email_outbox set status = 'sent', sent_at = now(), provider_id = provider, last_error = '' where id = oid;
  elsif r.attempts >= 4 then
    update email_outbox set status = 'failed', last_error = left(coalesce(err, ''), 300) where id = oid;
  else
    update email_outbox set status = 'queued', next_try_at = now() + (interval '10 minutes' * r.attempts * r.attempts), last_error = left(coalesce(err, ''), 300) where id = oid;
  end if;
end $$;

revoke execute on function guard_project_mail() from public, anon, authenticated;
revoke execute on function queue_email(uuid, text, text, jsonb), email_on_join_request(), email_on_join_decision(),
  claim_outbox(integer), finish_outbox(uuid, boolean, text, text), set_mail_identity(uuid, text, text, text) from public, anon, authenticated;
grant execute on function set_mail_identity(uuid, text, text, text) to authenticated;
grant execute on function claim_outbox(integer), finish_outbox(uuid, boolean, text, text) to service_role;
