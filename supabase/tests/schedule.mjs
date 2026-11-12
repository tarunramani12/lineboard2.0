import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;`);
const files = process.argv.slice(2);
for (const f of files.slice(0, files.indexOf('--late') < 0 ? files.length : files.indexOf('--late'))) await db.exec(fs.readFileSync(f, 'utf8'));
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); };
async function as(uid, sql, p = []) { await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`); await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [uid ?? '']); try { return (await db.query(sql, p)).rows } finally { await db.exec('reset role') } }
const fails = async (u, sql, p = []) => { try { await as(u, sql, p); return false } catch { return true } };
const mk = async (n) => (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1,$2) returning id`, [`${n}@example.com`, JSON.stringify({ display_name: n })])).rows[0].id;
const [O, PROD, AD, CAM, X] = await Promise.all(['owner', 'prod', 'ad', 'camera', 'outsider'].map(mk));
const pid = (await as(O, `select create_project('Sched') id`))[0].id;
const team = async (n) => (await as(O, `select id from teams where project_id=$1 and name=$2`, [pid, n]))[0].id;
const [tProd, tDir, tCam] = [await team('Production'), await team('Direction'), await team('Camera')];
const join = async (u, e, t) => { await as(O, `insert into invites (project_id, team_id, email, invited_by) values ($1,$2,$3,$4)`, [pid, t, e, O]); await as(u, `select * from accept_pending_invites()`); };
await join(PROD, 'prod@example.com', tProd); await join(AD, 'ad@example.com', tDir); await join(CAM, 'camera@example.com', tCam);
const mid = async (u) => (await as(O, `select id from members where account_id=$1`, [u]))[0].id;
await as(O, `update member_teams set can_edit=true where member_id in ($1,$2)`, [await mid(PROD), await mid(AD)]);

// ---- defaults
const lv = async (t, s) => (await db.query(`select level from team_section_access where team_id=$1 and section=$2`, [t, s])).rows[0].level;
ok('Production edits Schedule and Call sheets by default', (await lv(tProd, 'schedule')) === 'edit' && (await lv(tProd, 'call_sheets')) === 'edit');
ok('the AD team (Direction) does too', (await lv(tDir, 'schedule')) === 'edit' && (await lv(tDir, 'call_sheets')) === 'edit');
ok('other teams only view them', (await lv(tCam, 'schedule')) === 'view' && (await lv(tCam, 'call_sheets')) === 'view');
ok('Cast and crew stays view for Production', (await lv(tProd, 'cast_crew')) === 'view');

// ---- schedules
const mkSch = (u, extra = `'Block 1','2026-03-02','2026-03-13'`) => as(u, `insert into schedules (project_id, name, start_date, end_date) values ($1,${extra}) returning id`, [pid]);
ok('Production creates a schedule', !(await fails(PROD, `insert into schedules (project_id, name, start_date, end_date) values ($1,'Block 1','2026-03-02','2026-03-13')`, [pid])));
ok('the AD team creates a schedule', !(await fails(AD, `insert into schedules (project_id, name, start_date, end_date) values ($1,'Block 2','2026-04-01','2026-04-10')`, [pid])));
ok('a view-only team cannot', await fails(CAM, `insert into schedules (project_id, name, start_date, end_date) values ($1,'x','2026-03-02','2026-03-13')`, [pid]));
ok('an outsider cannot', await fails(X, `insert into schedules (project_id, name, start_date, end_date) values ($1,'x','2026-03-02','2026-03-13')`, [pid]));
ok('a blank name is refused', await fails(O, `insert into schedules (project_id, name, start_date, end_date) values ($1,' ','2026-03-02','2026-03-13')`, [pid]));
ok('an end before the start is refused', await fails(O, `insert into schedules (project_id, name, start_date, end_date) values ($1,'Bad','2026-03-13','2026-03-02')`, [pid]));
ok('a view-only team reads schedules', (await as(CAM, `select * from schedules`)).length === 2);
ok('an outsider reads none', (await as(X, `select * from schedules`)).length === 0);
const sid = (await as(O, `select id from schedules where name='Block 1'`))[0].id;

// ---- days
const day = (u, d, loc = '') => as(u, `insert into shoot_days (project_id, schedule_id, day_date, location) values ($1,$2,$3,$4) returning id`, [pid, sid, d, loc]);
const d1 = (await day(PROD, '2026-03-02', 'Harbour'))[0].id; const d2 = (await day(AD, '2026-03-03'))[0].id;
ok('a day outside the schedule dates is refused', await fails(PROD, `insert into shoot_days (project_id, schedule_id, day_date) values ($1,$2,'2026-05-01')`, [pid, sid]));
ok('two days on one date are refused', await fails(PROD, `insert into shoot_days (project_id, schedule_id, day_date) values ($1,$2,'2026-03-02')`, [pid, sid]));
ok('a view-only team cannot add a day', await fails(CAM, `insert into shoot_days (project_id, schedule_id, day_date) values ($1,$2,'2026-03-04')`, [pid, sid]));
ok('narrowing the schedule past a day is refused', await fails(PROD, `update schedules set start_date='2026-03-03' where id=$1`, [sid]));
ok('widening is fine', !(await fails(PROD, `update schedules set end_date='2026-03-20' where id=$1`, [sid])));

// ---- scenes on days
const sc = async (n, status = 'active') => (await as(O, `insert into scenes (project_id, display_number, heading, sort_order, status) values ($1,$2,'INT. A - DAY',$3,$4) returning id`, [pid, n, Number(n) * 10, status]))[0].id;
const [s1, s2, s3] = [await sc('1'), await sc('2'), await sc('3', 'omitted')];
const place = (u, scene, day, ord = 0) => as(u, `insert into schedule_scenes (schedule_id, scene_id, project_id, day_id, sort_order) values ($1,$2,$3,$4,$5) returning scene_id`, [sid, scene, pid, day, ord]);
ok('an editor places a scene on a day', (await place(PROD, s1, d1)).length === 1);
ok('a scene is on one day per schedule', await fails(PROD, `insert into schedule_scenes (schedule_id, scene_id, project_id, day_id) values ($1,$2,$3,$4)`, [sid, s1, pid, d2]));
ok('an omitted scene cannot be scheduled', await fails(PROD, `insert into schedule_scenes (schedule_id, scene_id, project_id, day_id) values ($1,$2,$3,$4)`, [sid, s3, pid, d1]));
ok('a view-only team cannot place scenes', await fails(CAM, `insert into schedule_scenes (schedule_id, scene_id, project_id, day_id) values ($1,$2,$3,$4)`, [sid, s2, pid, d1]));
ok('a scene moves between days', (await as(AD, `update schedule_scenes set day_id=$2 where scene_id=$1 returning scene_id`, [s1, d2])).length === 1);
const sid2 = (await as(O, `select id from schedules where name='Block 2'`))[0].id;
ok('a day from another schedule is refused', await fails(PROD, `update schedule_scenes set day_id=(select id from shoot_days where schedule_id=$2 limit 1) where scene_id=$1`, [s1, sid2]));
ok('the same scene can be in two schedules', (await (async () => { const dd = (await as(O, `insert into shoot_days (project_id, schedule_id, day_date) values ($1,$2,'2026-04-02') returning id`, [pid, sid2]))[0].id; return as(O, `insert into schedule_scenes (schedule_id, scene_id, project_id, day_id) values ($1,$2,$3,$4) returning scene_id`, [sid2, s1, pid, dd]); })()).length === 1);
ok('deleting a day returns its scenes to unscheduled', (await (async () => { await as(AD, `delete from shoot_days where id=$1`, [d2]); return as(O, `select 1 from schedule_scenes where schedule_id=$1 and scene_id=$2`, [sid, s1]); })()).length === 0);

// ---- unavailability
const cast = (await as(O, `insert into cast_crew_rows (project_id, team_id, kind, name, role) values ($1,$2,'cast','Maya','Anna') returning id`, [pid, tProd]))[0].id;
const un = (u, d = '2026-03-05') => as(u, `insert into cast_unavailable (project_id, row_id, on_date) values ($1,$2,$3) returning id`, [pid, cast, d]);
ok('a Schedule editor marks cast unavailable', (await un(AD)).length === 1);
ok('the same date twice is refused', await fails(AD, `insert into cast_unavailable (project_id, row_id, on_date) values ($1,$2,'2026-03-05')`, [pid, cast]));
ok('a view-only team cannot', await fails(CAM, `insert into cast_unavailable (project_id, row_id, on_date) values ($1,$2,'2026-03-06')`, [pid, cast]));
ok('an outsider cannot read or write', (await as(X, `select * from cast_unavailable`)).length === 0 && await fails(X, `insert into cast_unavailable (project_id, row_id, on_date) values ($1,$2,'2026-03-06')`, [pid, cast]));
ok('a view-only team reads it', (await as(CAM, `select * from cast_unavailable`)).length === 1);
ok('a wrong project id is refused', await fails(O, `insert into cast_unavailable (project_id, row_id, on_date) values (gen_random_uuid(),$1,'2026-03-07')`, [cast]));

// ---- cascades
ok('deleting a schedule removes its days and placements', (await (async () => { await as(O, `delete from schedules where id=$1`, [sid]); return as(O, `select 1 from shoot_days where schedule_id=$1`, [sid]); })()).length === 0);
const p2 = (await as(O, `select create_project('Gone') id`))[0].id;
await as(O, `insert into schedules (project_id, name, start_date, end_date) values ($1,'S','2026-01-01','2026-01-05')`, [p2]);
ok('deleting a project with a schedule works', (await as(O, `delete from projects where id=$1 returning id`, [p2])).length === 1);
// ---- shots on their own days (0023)
const sched3 = (await as(O, `insert into schedules (project_id, name, start_date, end_date) values ($1,'Split','2026-05-01','2026-05-05') returning id`, [pid]))[0].id;
const [e1, e2] = [(await as(O, `insert into shoot_days (project_id, schedule_id, day_date) values ($1,$2,'2026-05-01') returning id`, [pid, sched3]))[0].id, (await as(O, `insert into shoot_days (project_id, schedule_id, day_date) values ($1,$2,'2026-05-02') returning id`, [pid, sched3]))[0].id];
const scA = (await as(O, `insert into scenes (project_id, display_number, heading, sort_order) values ($1,'7','INT. X - DAY',70) returning id`, [pid]))[0].id;
const shot = (await as(O, `insert into shots (project_id, scene_id, team_id, position) values ($1,$2,$3,10) returning id`, [pid, scA, tDir]))[0]?.id;
const place2 = (u, day, sh = shot) => as(u, `insert into schedule_shots (schedule_id, shot_id, project_id, day_id) values ($1,$2,$3,$4) returning shot_id`, [sched3, sh, pid, day]);
ok('an editor sends a shot to a day', (await place2(AD, e1)).length === 1);
ok('a shot is on one day per schedule', await fails(AD, `insert into schedule_shots (schedule_id, shot_id, project_id, day_id) values ($1,$2,$3,$4)`, [sched3, shot, pid, e2]));
ok('and moves to another day', (await as(PROD, `update schedule_shots set day_id=$2 where shot_id=$1 returning shot_id`, [shot, e2])).length === 1);
ok('a view-only team cannot place shots', await fails(CAM, `delete from schedule_shots where shot_id=$1`, [shot]) === false && (await as(CAM, `delete from schedule_shots where shot_id=$1 returning shot_id`, [shot])).length === 0);
ok('but reads them', (await as(CAM, `select * from schedule_shots`)).length === 1);
ok('a day from another schedule is refused', await fails(AD, `update schedule_shots set day_id=$2 where shot_id=$1`, [shot, d2]));
ok('a shot of an omitted scene is refused', await (async () => { const so = (await as(O, `insert into scenes (project_id, display_number, heading, sort_order, status) values ($1,'8','INT. Y - DAY',80,'omitted') returning id`, [pid]))[0].id; const sh2 = (await as(O, `insert into shots (project_id, scene_id, team_id, position) values ($1,$2,$3,10) returning id`, [pid, so, tDir]))[0].id; return fails(AD, `insert into schedule_shots (schedule_id, shot_id, project_id, day_id) values ($1,$2,$3,$4)`, [sched3, sh2, pid, e1]); })());
ok('deleting the shot removes its day placement', await (async () => { await as(O, `delete from shots where id=$1`, [shot]); return (await db.query(`select 1 from schedule_shots`)).rows.length === 0; })());

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
