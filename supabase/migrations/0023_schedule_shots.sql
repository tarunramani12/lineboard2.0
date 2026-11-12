-- Shots can be shot on different days than the rest of their scene.
-- A scene is placed on a day as before (schedule_scenes). A shot follows its scene unless it has a row here, which sends it to
-- another shoot day of the same schedule. Same permissions as the rest of Schedule: everyone with view access reads, editors write.

create table schedule_shots (
  schedule_id uuid not null references schedules (id) on delete cascade,
  shot_id uuid not null references shots (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  day_id uuid not null references shoot_days (id) on delete cascade,
  sort_order integer not null default 0,
  primary key (schedule_id, shot_id)
);
create index on schedule_shots (day_id);
create index on schedule_shots (project_id);

alter table schedule_shots enable row level security;
revoke all on schedule_shots from anon, authenticated;
grant select, insert, update, delete on schedule_shots to authenticated;

create policy sshots_read on schedule_shots for select to authenticated using (can_view_section(project_id, 'schedule'));
create policy sshots_insert on schedule_shots for insert to authenticated with check (can_edit_section(project_id, 'schedule', null));
create policy sshots_update on schedule_shots for update to authenticated
  using (can_edit_section(project_id, 'schedule', null)) with check (can_edit_section(project_id, 'schedule', null));
create policy sshots_delete on schedule_shots for delete to authenticated using (can_edit_section(project_id, 'schedule', null));

create function guard_schedule_shot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from shoot_days d where d.id = new.day_id and d.schedule_id = new.schedule_id and d.project_id = new.project_id) then
    raise exception 'That shoot day is not in this schedule.';
  end if;
  if not exists (select 1 from shots s join scenes c on c.id = s.scene_id
                 where s.id = new.shot_id and s.project_id = new.project_id and c.status = 'active') then
    raise exception 'Only shots of active scenes in this project can be scheduled.';
  end if;
  if tg_op = 'UPDATE' and (new.shot_id <> old.shot_id or new.schedule_id <> old.schedule_id or new.project_id <> old.project_id) then
    raise exception 'A scheduled shot keeps its shot and schedule.';
  end if;
  return new;
end $$;
create trigger guard_schedule_shot before insert or update on schedule_shots for each row execute function guard_schedule_shot();
revoke execute on function guard_schedule_shot() from public, anon, authenticated;
