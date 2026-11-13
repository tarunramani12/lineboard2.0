// Schedule lock: cast and crew see only locked schedules; drafts are for editors, owner, admins and people the owner names.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const files = process.argv.slice(2);
const [early, late] = [files.filter((f) => !/0031_/.test(f)), files.filter((f) => /0031_/.test(f))];
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text,
    email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`);
for (const f of early) await db.exec(fs.readFileSync(f, 'utf8'));

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); };
async function as(uid, sql, params = []) {
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
}
async function fails(uid, sql, params = [], match) {
  try { await as(uid, sql, params); return false; } catch (e) { return match ? String(e.message).includes(match) : true; }
}
const mkUser = async (name) => (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1,$2) returning id`,
  [`${name}@example.com`, JSON.stringify({ display_name: name })])).rows[0].id;


const [O, PR, M, V, X] = await Promise.all(['owner', 'prod', 'member', 'viewer', 'outsider'].map(mkUser));
// a project made before this migration: every team could open the Cast and crew list
const old = (await as(O, `select create_project('Before') as id`))[0].id;
for (const f of late) await db.exec(fs.readFileSync(f, 'utf8'));
const lvl = async (p, team, sec) => (await db.query(`select a.level from team_section_access a join teams t on t.id=a.team_id where t.project_id=$1 and t.name=$2 and a.section=$3`, [p, team, sec])).rows[0]?.level;
ok('an existing project: Production and Direction keep the Cast and crew list', (await lvl(old, 'Production', 'cast_crew')) === 'view' && (await lvl(old, 'Direction', 'cast_crew')) === 'view');
ok('an existing project: other teams no longer see it by default', (await lvl(old, 'Camera', 'cast_crew')) === 'none' && (await lvl(old, 'Sound', 'cast_crew')) === 'none');
ok('an existing project: every team still views the Schedule and Call sheets', (await lvl(old, 'Camera', 'schedule')) === 'view' && (await lvl(old, 'Sound', 'call_sheets')) === 'view');

const pid = (await as(O, `select create_project('Lock') as id`))[0].id;
ok('a new project: same defaults', (await lvl(pid, 'Camera', 'cast_crew')) === 'none' && (await lvl(pid, 'Production', 'cast_crew')) === 'view' && (await lvl(pid, 'Camera', 'schedule')) === 'view' && (await lvl(pid, 'Production', 'schedule')) === 'edit');
const team = async (n) => (await as(O, `select id from teams where project_id=$1 and name=$2`, [pid, n]))[0].id;
const [tProd, tSnd] = [await team('Production'), await team('Sound')];
const join = async (u, email, t) => { await as(O, `insert into invites (project_id, team_id, email, invited_by) values ($1,$2,$3,$4)`, [pid, t, email, O]); await as(u, `select * from accept_pending_invites()`); };
await join(PR, 'prod@example.com', tProd); await join(M, 'member@example.com', tSnd); await join(V, 'viewer@example.com', tSnd);
const mid = async (u) => (await as(O, `select id from members where account_id=$1`, [u]))[0].id;
await as(O, `update member_teams set is_hod=true where member_id=$1`, [await mid(PR)]);   // the production manager edits the schedule

// ---- a draft schedule
const scn = (await as(O, `insert into scenes (project_id, display_number, heading, sort_order) values ($1,'1','INT. A - DAY',10) returning id`, [pid]))[0].id;
const sched = (await as(PR, `insert into schedules (project_id, name, start_date, end_date) values ($1,'Block 1','2026-12-01','2026-12-03') returning id`, [pid]))[0].id;
const day = (await as(PR, `insert into shoot_days (project_id, schedule_id, day_date) values ($1,$2,'2026-12-01') returning id`, [pid, sched]))[0].id;
await as(PR, `insert into schedule_scenes (schedule_id, scene_id, project_id, day_id) values ($1,$2,$3,$4)`, [sched, scn, pid, day]);
ok('the Production editor sees the draft', (await as(PR, `select * from schedules`)).length === 1 && (await as(PR, `select * from shoot_days`)).length === 1);
ok('the owner sees the draft', (await as(O, `select * from schedules`)).length === 1);
ok('an ordinary member sees no draft schedule, days or scenes', (await as(M, `select * from schedules`)).length === 0 && (await as(M, `select * from shoot_days`)).length === 0 && (await as(M, `select * from schedule_scenes`)).length === 0);
ok('an outsider sees nothing', (await as(X, `select * from schedules`)).length === 0);
ok('a new schedule cannot be created already locked', (await as(PR, `insert into schedules (project_id, name, start_date, end_date, locked) values ($1,'Sneaky','2026-12-01','2026-12-02',true) returning locked`, [pid]))[0].locked === false);
await as(PR, `delete from schedules where name='Sneaky'`);

// ---- locking
ok('an ordinary member cannot lock', (await as(M, `update schedules set locked=true where id=$1 returning id`, [sched])).length === 0);
ok('the Production editor locks the schedule', (await as(PR, `update schedules set locked=true where id=$1 returning locked_by`, [sched]))[0].locked_by === PR);
ok('who locked it and when is recorded', (await as(O, `select locked_at is not null a from schedules where id=$1`, [sched]))[0].a === true);
ok('an ordinary member now sees the locked schedule, its days and its scenes', (await as(M, `select * from schedules`)).length === 1 && (await as(M, `select * from shoot_days`)).length === 1 && (await as(M, `select * from schedule_scenes`)).length === 1);
ok('an outsider still sees nothing', (await as(X, `select * from schedules`)).length === 0 && (await as(X, `select * from shoot_days`)).length === 0);
ok('nobody can rename a locked schedule (not even the owner)', await fails(PR, `update schedules set name='New' where id=$1`, [sched], 'schedule_locked') && await fails(O, `update schedules set name='New' where id=$1`, [sched], 'schedule_locked'));
ok('nobody can add a shoot day to it', await fails(PR, `insert into shoot_days (project_id, schedule_id, day_date) values ($1,$2,'2026-12-02')`, [pid, sched], 'schedule_locked'));
ok('nobody can change a day', await fails(PR, `update shoot_days set location='Studio' where id=$1`, [day], 'schedule_locked'));
ok('nobody can move or remove a scene', await fails(PR, `delete from schedule_scenes where schedule_id=$1`, [sched], 'schedule_locked') && await fails(PR, `update schedule_scenes set sort_order=5 where schedule_id=$1`, [sched], 'schedule_locked'));
ok('a locked schedule cannot be deleted', await fails(PR, `delete from schedules where id=$1`, [sched], 'schedule_locked') && await fails(O, `delete from schedules where id=$1`, [sched], 'schedule_locked'));
ok('an ordinary member cannot unlock', (await as(M, `update schedules set locked=false where id=$1 returning id`, [sched])).length === 0);
ok('the editor unlocks it', (await as(PR, `update schedules set locked=false where id=$1 returning locked`, [sched]))[0].locked === false);
ok('unlocking clears the lock stamp', (await as(O, `select locked_by is null and locked_at is null a from schedules where id=$1`, [sched]))[0].a === true);
ok('the ordinary member no longer sees it', (await as(M, `select * from schedules`)).length === 0);
ok('and the editor can change it again', (await as(PR, `update schedules set name='Block 1b' where id=$1 returning id`, [sched])).length === 1);

// ---- the owner names people who may see drafts
ok('a Production editor cannot grant draft access', await fails(PR, `insert into schedule_draft_viewers (member_id, project_id) values ($1,$2)`, [await mid(V), pid]));
ok('an ordinary member cannot grant it either', await fails(M, `insert into schedule_draft_viewers (member_id, project_id) values ($1,$2)`, [await mid(M), pid]));
ok('a member from another project cannot be named', await fails(O, `insert into schedule_draft_viewers (member_id, project_id) values ($1,$2)`, [(await db.query(`select id from members where project_id=$1 limit 1`, [old])).rows[0].id, pid], 'not on this project'));
ok('the owner names the viewer', (await as(O, `insert into schedule_draft_viewers (member_id, project_id) values ($1,$2) returning member_id`, [await mid(V), pid])).length === 1);
ok('that person now sees the draft schedule, days and scenes', (await as(V, `select * from schedules`)).length === 1 && (await as(V, `select * from shoot_days`)).length === 1 && (await as(V, `select * from schedule_scenes`)).length === 1);
ok('but cannot change it', (await as(V, `update schedules set name='x' where id=$1 returning id`, [sched])).length === 0);
ok('the other member still sees no draft', (await as(M, `select * from schedules`)).length === 0);
ok('the named person can read their own grant, others cannot', (await as(V, `select * from schedule_draft_viewers`)).length === 1 && (await as(M, `select * from schedule_draft_viewers`)).length === 0 && (await as(O, `select * from schedule_draft_viewers`)).length === 1);
ok('the owner takes the access away', (await as(O, `delete from schedule_draft_viewers where member_id=$1 returning member_id`, [await mid(V)])).length === 1 && (await as(V, `select * from schedules`)).length === 0);

// ---- a published call sheet keeps its day readable
await db.query(`insert into call_sheets (project_id, day_id) values ($1,$2)`, [pid, day]);
await db.query(`update call_sheets set rev_no=1, published_at=now() where day_id=$1`, [day]);   // what publishing does
ok('a day with a published call sheet is readable by people who view call sheets, even in a draft schedule', (await as(M, `select * from shoot_days`)).length === 1);
ok('but the schedule itself and its scenes stay hidden', (await as(M, `select * from schedules`)).length === 0 && (await as(M, `select * from schedule_scenes`)).length === 0);

// ---- deleting a project with a locked schedule still works
await as(PR, `update schedules set locked=true where id=$1`, [sched]);
ok('the whole project can be deleted even with a locked schedule', (await as(O, `delete from projects where id=$1 returning id`, [pid])).length === 1
  && (await db.query(`select count(*)::int n from schedules where project_id=$1`, [pid])).rows[0].n === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
