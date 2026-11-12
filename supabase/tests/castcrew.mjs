// Transferring a project: who may, to whom, and what everyone can do afterwards.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

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
`);
for (const f of process.argv.slice(2)) await db.exec(fs.readFileSync(f, 'utf8'));


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

const [O, PROD, PROD2, AD, CAM, X] = await Promise.all(['owner', 'prod', 'prod2', 'ad', 'camera', 'outsider'].map(mkUser));
const pid = (await as(O, `select create_project('Crew') as id`))[0].id;
const team = async (n) => (await as(O, `select id from teams where project_id=$1 and name=$2`, [pid, n]))[0].id;
const [tProd, tDir, tCam] = [await team('Production'), await team('Direction'), await team('Camera')];
const join = async (u, email, t) => { await as(O, `insert into invites (project_id, team_id, email, invited_by) values ($1,$2,$3,$4)`, [pid, t, email, O]); await as(u, `select * from accept_pending_invites()`); };
await join(PROD, 'prod@example.com', tProd); await join(PROD2, 'prod2@example.com', tProd); await join(AD, 'ad@example.com', tDir); await join(CAM, 'camera@example.com', tCam);
const mid = async (u) => (await as(O, `select id from members where account_id=$1`, [u]))[0].id;
await as(O, `update team_section_access set level='edit' where section='cast_crew' and team_id in ($1,$2)`, [tProd, tDir]);
await as(O, `update team_section_access set level='view' where section='cast_crew' and team_id=$1`, [tCam]);
await as(O, `update member_teams set can_edit=true where member_id in ($1,$2)`, [await mid(PROD), await mid(AD)]);
// PROD2 is on Production without an edit grant; CAM only views

const row = (u, t, extra = `'crew','Sam','Gaffer'`) => as(u, `insert into cast_crew_rows (project_id, team_id, kind, name, role) values ($1,$2,${extra}) returning id`, [pid, t]);
// ---- rows
ok('an editor adds a row for their team', !(await fails(PROD, `insert into cast_crew_rows (project_id, team_id, name) values ($1,$2,'Sam')`, [pid, tProd])));
ok('a member without an edit grant cannot', await fails(PROD2, `insert into cast_crew_rows (project_id, team_id, name) values ($1,$2,'Sam')`, [pid, tProd]));
ok('cannot add for another team', await fails(PROD, `insert into cast_crew_rows (project_id, team_id, name) values ($1,$2,'Sam')`, [pid, tCam]));
ok('a view-only team cannot add', await fails(CAM, `insert into cast_crew_rows (project_id, team_id, name) values ($1,$2,'Sam')`, [pid, tCam]));
ok('an outsider cannot add', await fails(X, `insert into cast_crew_rows (project_id, team_id, name) values ($1,$2,'Sam')`, [pid, tProd]));
ok('a blank name is refused', await fails(PROD, `insert into cast_crew_rows (project_id, team_id, name) values ($1,$2,'  ')`, [pid, tProd]));
ok('a bad call time is refused', await fails(PROD, `insert into cast_crew_rows (project_id, team_id, name, call_time) values ($1,$2,'A','25:00')`, [pid, tProd]));
ok('a good call time is accepted', !(await fails(PROD, `insert into cast_crew_rows (project_id, team_id, name, call_time, makeup_time) values ($1,$2,'A','07:30','06:45')`, [pid, tProd])));
ok('nobody can create an auto row by hand', await fails(O, `insert into cast_crew_rows (project_id, team_id, kind, role, auto) values ($1,$2,'cast','Anna',true)`, [pid, tProd]));
const sam = (await as(PROD, `select id from cast_crew_rows where name='Sam'`))[0].id;
ok('everyone with view access reads names', (await as(CAM, `select * from cast_crew_rows`)).length >= 2 && (await as(O, `select * from cast_crew_rows`)).length >= 2);
ok('an outsider reads none', (await as(X, `select * from cast_crew_rows`)).length === 0);
ok('the owning team edits', (await as(PROD, `update cast_crew_rows set role='Best boy' where id=$1 returning id`, [sam])).length === 1);
ok('another team cannot edit', (await as(AD, `update cast_crew_rows set role='x' where id=$1 returning id`, [sam])).length === 0);
ok('a team editor cannot move a row', await fails(PROD, `update cast_crew_rows set team_id=$2 where id=$1`, [sam, tDir]));
ok('the owner can move a row', !(await fails(O, `update cast_crew_rows set team_id=$2 where id=$1`, [sam, tProd])));

ok('a department can be any text up to 60 characters', !(await fails(PROD, `insert into cast_crew_rows (project_id, team_id, name, department) values ($1,$2,'D','Stunts')`, [pid, tProd])));
ok('a department longer than 60 characters is refused', await fails(PROD, `insert into cast_crew_rows (project_id, team_id, name, department) values ($1,$2,'D',repeat('x',61))`, [pid, tProd]));

// ---- contacts
ok('the owner adds contact details', !(await fails(O, `insert into cast_crew_contacts (row_id, project_id, phone, email) values ($1,$2,'0123','sam@example.org')`, [sam, pid])));
ok('the AD team reads contacts', (await as(AD, `select * from cast_crew_contacts`)).length === 1);
ok('the owning team (not AD) cannot read contacts', (await as(PROD, `select * from cast_crew_contacts`)).length === 0);
ok('a view-only team cannot read contacts', (await as(CAM, `select * from cast_crew_contacts`)).length === 0);
ok('an outsider cannot read contacts', (await as(X, `select * from cast_crew_contacts`)).length === 0);
ok('the owning team cannot add contacts', await fails(PROD, `insert into cast_crew_contacts (row_id, project_id, phone) values ($1,$2,'1')`, [(await row(PROD, tProd))[0].id, pid]));
ok('an AD editor changes contacts only for rows they can edit (not Production rows)', (await as(AD, `update cast_crew_contacts set phone='999' where row_id=$1 returning row_id`, [sam])).length === 0);
const adRow = (await row(AD, tDir))[0].id;
ok('an AD editor adds contacts to their own row', !(await fails(AD, `insert into cast_crew_contacts (row_id, project_id, phone) values ($1,$2,'555')`, [adRow, pid])));
ok('a bad email is refused', await fails(O, `update cast_crew_contacts set email='nope' where row_id=$1`, [sam]));

// ---- linking by verified email
const [L] = await Promise.all(['late'].map(mkUser));
await as(O, `update cast_crew_contacts set email='late@example.com' where row_id=$1`, [sam]);
ok('a row is not linked before the person joins', (await as(O, `select account_id from cast_crew_rows where id=$1`, [sam]))[0].account_id === null);
await join(L, 'late@example.com', tCam);
const linked = (await as(O, `select account_id, from_account from cast_crew_rows where id=$1`, [sam]))[0];
ok('joining with the same verified email links the row', linked.account_id === L && linked.from_account === true);
// the other way round: an email added for someone already on the project
const camRow = (await row(O, tProd))[0].id;
await as(O, `insert into cast_crew_contacts (row_id, project_id, email) values ($1,$2,'camera@example.com')`, [camRow, pid]);
ok('adding the email of a member links the row at once', (await as(O, `select account_id from cast_crew_rows where id=$1`, [camRow]))[0].account_id === CAM);
ok('a row cannot be linked to someone outside the project', await fails(O, `update cast_crew_rows set account_id=$2 where id=$1`, [adRow, X]));

// ---- detect cast
const sc = (await as(O, `insert into scenes (project_id, display_number, heading, sort_order) values ($1,'1','INT. A - DAY',10) returning id`, [pid]))[0].id;
await db.query(`insert into scene_text (scene_id, elements) values ($1, $2::jsonb)`, [sc, JSON.stringify([
  { kind: 'character', text: 'ANNA' }, { kind: 'dialogue', text: 'Hi' }, { kind: 'character', text: 'BOB (V.O.)' }, { kind: 'character', text: 'ANNA (CONT\'D)' }])]);
ok('a view-only person cannot detect cast', await fails(CAM, `select detect_cast($1,$2)`, [pid, tCam]));
ok('an editor cannot detect for a team they do not edit', await fails(PROD, `select detect_cast($1,$2)`, [pid, tDir]));
ok('detect cast adds each speaker once', (await as(PROD, `select detect_cast($1,$2) n`, [pid, tProd]))[0].n === 2);
ok('running it again adds nothing', (await as(PROD, `select detect_cast($1,$2) n`, [pid, tProd]))[0].n === 0);
const anna = (await as(O, `select id, name, auto, kind from cast_crew_rows where role='Anna'`))[0];
await as(PROD, `select 1`);
ok('the row is an automatic cast row with no actor yet', anna.auto && anna.kind === 'cast' && anna.name === '');
ok('the actor can be filled in', (await as(PROD, `update cast_crew_rows set name='Maya Lin' where id=$1 returning id`, [anna.id])).length === 1);
ok('its character can be renamed', (await as(PROD, `update cast_crew_rows set role='Annie' where id=$1 returning id`, [anna.id])).length === 1);
ok('and it can be turned into a crew row', (await as(PROD, `update cast_crew_rows set kind='crew', role='Runner' where id=$1 returning id`, [anna.id])).length === 1);
ok('another team still cannot delete it', (await as(AD, `delete from cast_crew_rows where id=$1 returning id`, [anna.id])).length === 0);
ok('its own team can delete a row that came from the script', (await as(PROD, `delete from cast_crew_rows where id=$1 returning id`, [anna.id])).length === 1);
const tmp = (await row(PROD, tProd))[0].id;
ok('a manual row can be deleted by its team', (await as(PROD, `delete from cast_crew_rows where id=$1 returning id`, [tmp])).length === 1);
ok('another team cannot delete it', (await as(AD, `delete from cast_crew_rows where id=$1 returning id`, [sam])).length === 0);

// ---- former member
await as(O, `update cast_crew_rows set name='Cam Op' where id=$1`, [camRow]);
await as(L, `select 1`);
await db.query(`delete from auth.users where id=$1`, [CAM]);
const former = (await as(O, `select name, account_id, from_account from cast_crew_rows where id=$1`, [camRow]))[0];
ok('a deleted account leaves a Former member row with no name', former.name === '' && former.account_id === null && former.from_account === true);
ok('and its contact details are gone', (await as(O, `select * from cast_crew_contacts where row_id=$1`, [camRow])).length === 0);
ok('the team can reassign it to another member', (await as(O, `update cast_crew_rows set account_id=$2 where id=$1 returning id`, [camRow, AD])).length === 1);

// ---- deleting a project that holds automatic cast rows
const ppid = (await as(O, `select create_project('Delete me') id`))[0].id;
const ptm = (await as(O, `select id from teams where project_id=$1 and name='Production'`, [ppid]))[0].id;
const psc = (await as(O, `insert into scenes (project_id, display_number, heading, sort_order) values ($1,'1','INT. A - DAY',10) returning id`, [ppid]))[0].id;
await db.query(`insert into scene_text (scene_id, elements) values ($1, $2::jsonb)`, [psc, JSON.stringify([{ kind: 'character', text: 'ZED' }])]);
ok('a project with automatic cast rows has them', (await as(O, `select detect_cast($1,$2) n`, [ppid, ptm]))[0].n === 1);
ok('the whole project can still be deleted', (await as(O, `delete from projects where id=$1 returning id`, [ppid])).length === 1);
ok('and its cast rows go with it', (await as(O, `select 1 from cast_crew_rows where project_id=$1`, [ppid])).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
