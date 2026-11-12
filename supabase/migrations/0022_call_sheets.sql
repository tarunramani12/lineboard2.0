-- Call sheets (planning document section 16). One call sheet per shoot day.
-- Three tables keep drafts private and published sheets readable:
--   call_sheets          the index: which shoot day, the latest revision number, who published it and when
--   call_sheet_drafts    the working details (general call, nearest hospital, notes). Editors only.
--   call_sheet_revisions the published snapshots, numbered 1, 2, 3 ... Everyone with view access to Call sheets reads them.
-- Who may do what, enforced here:
--   * Editors of Call sheets (edit level for their team plus HOD or an edit grant, and the owner and admins) create, edit and publish.
--     By default that is Production and the AD team (Direction).
--   * Everyone with view access reads a sheet only after it is published, and only what was published.
--   * A revision is written only by publish_call_sheet, never by a direct insert, update or delete. Revision numbers never skip or repeat.
--   * A published sheet is not deleted. A shoot day that has one is deleted only by the owner or an admin.

create table call_sheets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  day_id uuid not null unique references shoot_days (id) on delete cascade,
  rev_no integer not null default 0 check (rev_no >= 0),
  published_at timestamptz,
  published_by uuid references profiles (id) on delete set null,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on call_sheets (project_id);

create table call_sheet_drafts (
  sheet_id uuid primary key references call_sheets (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  general_call text not null default '' check (general_call = '' or general_call ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  hospital text not null default '' check (length(hospital) <= 300),
  notes text not null default '' check (length(notes) <= 2000),
  updated_by uuid references profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index on call_sheet_drafts (project_id);

create table call_sheet_revisions (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references call_sheets (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  rev_no integer not null check (rev_no >= 1),
  snapshot jsonb not null,
  note text not null default '' check (length(note) <= 200),
  published_by uuid references profiles (id) on delete set null,
  published_at timestamptz not null default now(),
  unique (sheet_id, rev_no)
);
create index on call_sheet_revisions (project_id);

alter table call_sheets enable row level security;
alter table call_sheet_drafts enable row level security;
alter table call_sheet_revisions enable row level security;
revoke all on call_sheets, call_sheet_drafts, call_sheet_revisions from anon, authenticated;
grant select, insert, delete on call_sheets to authenticated;
grant select, insert, update, delete on call_sheet_drafts to authenticated;
grant select on call_sheet_revisions to authenticated;

create policy cs_read on call_sheets for select to authenticated
  using (can_view_section(project_id, 'call_sheets') and (rev_no > 0 or can_edit_section(project_id, 'call_sheets', null)));
create policy cs_insert on call_sheets for insert to authenticated
  with check (can_edit_section(project_id, 'call_sheets', null));
create policy cs_delete on call_sheets for delete to authenticated
  using (can_edit_section(project_id, 'call_sheets', null) and rev_no = 0);

create policy csd_read on call_sheet_drafts for select to authenticated using (can_edit_section(project_id, 'call_sheets', null));
create policy csd_insert on call_sheet_drafts for insert to authenticated with check (can_edit_section(project_id, 'call_sheets', null));
create policy csd_update on call_sheet_drafts for update to authenticated
  using (can_edit_section(project_id, 'call_sheets', null)) with check (can_edit_section(project_id, 'call_sheets', null));
create policy csd_delete on call_sheet_drafts for delete to authenticated using (can_edit_section(project_id, 'call_sheets', null));

create policy csr_read on call_sheet_revisions for select to authenticated using (can_view_section(project_id, 'call_sheets'));

create function guard_call_sheet() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from shoot_days d where d.id = new.day_id and d.project_id = new.project_id) then
      raise exception 'That shoot day is not in this project.';
    end if;
    new.rev_no := 0; new.published_at := null; new.published_by := null;
    new.created_by := auth.uid(); new.created_at := now();
    return new;
  end if;
  return old;
end $$;
create trigger guard_call_sheet before insert on call_sheets for each row execute function guard_call_sheet();

create function guard_call_sheet_draft() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from call_sheets c where c.id = new.sheet_id and c.project_id = new.project_id) then
    raise exception 'That call sheet is not in this project.';
  end if;
  if tg_op = 'UPDATE' and (new.sheet_id <> old.sheet_id or new.project_id <> old.project_id) then
    raise exception 'A draft stays with its call sheet.';
  end if;
  new.updated_by := auth.uid(); new.updated_at := now();
  return new;
end $$;
create trigger guard_call_sheet_draft before insert or update on call_sheet_drafts for each row execute function guard_call_sheet_draft();

-- Publish the next revision. The screen builds the snapshot (what everyone will read); the numbering is the database's.
create function publish_call_sheet(sid uuid, snap jsonb, note_in text default '') returns integer
language plpgsql security definer set search_path = public as $$
declare c call_sheets; n integer;
begin
  select * into c from call_sheets where id = sid for update;
  if not found then raise exception 'sheet_not_found'; end if;
  if not can_edit_section(c.project_id, 'call_sheets', null) then raise exception 'not_allowed'; end if;
  if snap is null or jsonb_typeof(snap) <> 'object' or pg_column_size(snap) > 300000 then raise exception 'bad_snapshot'; end if;
  n := c.rev_no + 1;
  insert into call_sheet_revisions (sheet_id, project_id, rev_no, snapshot, note, published_by)
    values (sid, c.project_id, n, snap, left(coalesce(note_in, ''), 200), auth.uid());
  update call_sheets set rev_no = n, published_at = now(), published_by = auth.uid() where id = sid;
  return n;
end $$;

-- A shoot day that has a published call sheet is deleted only by the owner or an admin.
create function guard_day_with_sheet() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from call_sheets c where c.day_id = old.id and c.rev_no > 0)
     and exists (select 1 from schedules s where s.id = old.schedule_id)
     and not is_owner_or_admin(old.project_id) then
    raise exception 'This shoot day has a published call sheet. Only the owner or an admin can delete it.';
  end if;
  return old;
end $$;
create trigger guard_day_with_sheet before delete on shoot_days for each row execute function guard_day_with_sheet();

revoke execute on function guard_call_sheet(), guard_call_sheet_draft(), publish_call_sheet(uuid, jsonb, text), guard_day_with_sheet() from public, anon, authenticated;
grant execute on function publish_call_sheet(uuid, jsonb, text) to authenticated;
