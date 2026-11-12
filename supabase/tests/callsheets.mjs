import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;`);
for (const f of process.argv.slice(2)) await db.exec(fs.readFileSync(f, 'utf8'));
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); };
async function as(uid, sql, p = []) { await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`); await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [uid ?? '']); try { return (await db.query(sql, p)).rows } finally { await db.exec('reset role') } }
const fails = async (u, sql, p = []) => { try { await as(u, sql, p); return false } catch { return true } };
const mk = async (n) => (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1,$2) returning id`, [`${n}@example.com`, JSON.stringify({ display_name: n })])).rows[0].id;
const [O, AD, AD2, CAM, X] = await Promise.all(['owner', 'ad', 'ad2', 'cam', 'outsider'].map(mk));
const pid = (await as(O, `select create_project('Sheets') id`))[0].id;
const team = async (n) => (await as(O, `select id from teams where project_id=$1 and name=$2`, [pid, n]))[0].id;
const [tDir, tCam] = [await team('Direction'), await team('Camera')];
const join = async (u, e, t) => { await as(O, `insert into invites (project_id, team_id, email, invited_by) values ($1,$2,$3,$4)`, [pid, t, e, O]); await as(u, `select * from accept_pending_invites()`); };
await join(AD, 'ad@example.com', tDir); await join(AD2, 'ad2@example.com', tDir); await join(CAM, 'cam@example.com', tCam);
await db.query(`update member_teams set can_edit=true where member_id=(select id from members where account_id=$1)`, [AD]);
const sid = (await as(O, `insert into schedules (project_id, name, start_date, end_date) values ($1,'S','2026-03-02','2026-03-06') returning id`, [pid]))[0].id;
const day = async (d) => (await as(O, `insert into shoot_days (project_id, schedule_id, day_date) values ($1,$2,$3) returning id`, [pid, sid, d]))[0].id;
const [d1, d2, d3] = [await day('2026-03-02'), await day('2026-03-03'), await day('2026-03-04')];

ok('the AD editor starts a call sheet', (await as(AD, `insert into call_sheets (project_id, day_id) values ($1,$2) returning id`, [pid, d1])).length === 1);
const cs = (await as(AD, `select id from call_sheets where day_id=$1`, [d1]))[0].id;
ok('and its draft', (await as(AD, `insert into call_sheet_drafts (sheet_id, project_id, general_call, hospital, notes) values ($1,$2,'07:00','City Hospital','Park behind the cafe') returning sheet_id`, [cs, pid])).length === 1);
ok('a member without an edit grant cannot start one', await fails(AD2, `insert into call_sheets (project_id, day_id) values ($1,$2)`, [pid, d2]));
ok('a view-only team cannot', await fails(CAM, `insert into call_sheets (project_id, day_id) values ($1,$2)`, [pid, d2]));
ok('an outsider cannot', await fails(X, `insert into call_sheets (project_id, day_id) values ($1,$2)`, [pid, d2]));
ok('one sheet per day', await fails(AD, `insert into call_sheets (project_id, day_id) values ($1,$2)`, [pid, d1]));
ok('a client cannot start a sheet already published', await (async () => { const r = await as(AD, `insert into call_sheets (project_id, day_id, rev_no) values ($1,$2,5) returning rev_no`, [pid, d2]); await as(AD, `delete from call_sheets where day_id=$1`, [d2]); return r[0].rev_no === 0; })());
ok('a bad general call is refused', await fails(AD, `update call_sheet_drafts set general_call='7am' where sheet_id=$1`, [cs]));
ok('the editor changes the draft', (await as(AD, `update call_sheet_drafts set general_call='06:30' where sheet_id=$1 returning sheet_id`, [cs])).length === 1);

// before publishing
ok('a viewer sees no draft sheet', (await as(CAM, `select * from call_sheets`)).length === 0);
ok('nor its draft details', (await as(CAM, `select * from call_sheet_drafts`)).length === 0);
ok('an editor and the owner see the draft', (await as(AD, `select * from call_sheets`)).length === 1 && (await as(O, `select * from call_sheets`)).length === 1);
const snap = (extra = {}) => JSON.stringify({ v: 1, general_call: '06:30', hospital: 'City Hospital', ...extra });
ok('a viewer cannot publish', await fails(CAM, `select publish_call_sheet($1,$2::jsonb)`, [cs, snap()]));
ok('a non-grant member cannot publish', await fails(AD2, `select publish_call_sheet($1,$2::jsonb)`, [cs, snap()]));
ok('a snapshot that is not an object is refused', await fails(AD, `select publish_call_sheet($1,'[1,2]'::jsonb)`, [cs]));
ok('the first publish is revision 1', (await as(AD, `select publish_call_sheet($1,$2::jsonb,'First issue') n`, [cs, snap()]))[0].n === 1);
ok('the second is revision 2', (await as(O, `select publish_call_sheet($1,$2::jsonb,'Moved the call') n`, [cs, snap({ general_call: '07:30' })]))[0].n === 2);
const sheet = (await db.query(`select rev_no, published_by from call_sheets where id=$1`, [cs])).rows[0];
ok('the sheet records the latest revision and who published it', sheet.rev_no === 2 && sheet.published_by === O);

// after publishing
ok('a viewer now sees the sheet', (await as(CAM, `select * from call_sheets`)).length === 1);
const revs = await as(CAM, `select rev_no, snapshot, note from call_sheet_revisions order by rev_no`);
ok('and every revision with what was published', revs.length === 2 && revs[1].snapshot.general_call === '07:30' && revs[0].note === 'First issue');
ok('but still not the working draft', (await as(CAM, `select * from call_sheet_drafts`)).length === 0);
ok('an outsider sees nothing', (await as(X, `select * from call_sheets`)).length === 0 && (await as(X, `select * from call_sheet_revisions`)).length === 0);
ok('nobody writes a revision directly', await fails(AD, `insert into call_sheet_revisions (sheet_id, project_id, rev_no, snapshot) values ($1,$2,9,'{}')`, [cs, pid]) && await fails(O, `insert into call_sheet_revisions (sheet_id, project_id, rev_no, snapshot) values ($1,$2,9,'{}')`, [cs, pid]));
ok('nobody edits or deletes one', await fails(AD, `update call_sheet_revisions set note='x'`) && (await as(O, `delete from call_sheet_revisions returning id`).catch(() => [])).length === 0);
ok('nobody changes the revision number directly', await fails(AD, `update call_sheets set rev_no=7 where id=$1`, [cs]));
ok('a published sheet cannot be deleted', (await as(AD, `delete from call_sheets where id=$1 returning id`, [cs])).length === 0);
ok('a draft sheet can be deleted by an editor', await (async () => { await as(AD, `insert into call_sheets (project_id, day_id) values ($1,$2)`, [pid, d3]); return (await as(AD, `delete from call_sheets where day_id=$1 returning id`, [d3])).length === 1; })());
ok('an editor cannot delete a shoot day with a published sheet', await fails(O, `select 1`) === false && (await (async () => { await db.query(`update team_section_access set level='edit' where section='schedule' and team_id=$1`, [tDir]); try { await as(AD, `delete from shoot_days where id=$1`, [d1]); return false; } catch (e) { return String(e.message).includes('published call sheet'); } })()));
ok('the owner can', (await as(O, `delete from shoot_days where id=$1 returning id`, [d1])).length === 1);
ok('and its sheet, drafts and revisions go with it', (await db.query(`select 1 from call_sheets`)).rows.length === 0 && (await db.query(`select 1 from call_sheet_revisions`)).rows.length === 0);
ok('deleting a project with published sheets works', await (async () => { const p2 = (await as(O, `select create_project('Gone') id`))[0].id; const s2 = (await as(O, `insert into schedules (project_id, name, start_date, end_date) values ($1,'S','2026-01-01','2026-01-02') returning id`, [p2]))[0].id; const dd = (await as(O, `insert into shoot_days (project_id, schedule_id, day_date) values ($1,$2,'2026-01-01') returning id`, [p2, s2]))[0].id; const c2 = (await as(O, `insert into call_sheets (project_id, day_id) values ($1,$2) returning id`, [p2, dd]))[0].id; await as(O, `select publish_call_sheet($1,'{"v":1}'::jsonb)`, [c2]); return (await as(O, `delete from projects where id=$1 returning id`, [p2])).length === 1; })());
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
