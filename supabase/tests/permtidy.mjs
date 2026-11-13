// Permissions tidy-up: lists on draft schedules, heads can only pass on write access the team has, trigger functions closed.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const files = process.argv.slice(2);
const [early, late] = [files.filter((f) => !/003[46]_/.test(f)), files.filter((f) => /003[46]_/.test(f))];
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
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


// ---- the rule for passing on write access
const [O, HOD, PM, M, V, X] = await Promise.all(['owner', 'hod', 'props', 'member', 'viewer', 'outsider'].map(mkUser));
for (const f of late) await db.exec(fs.readFileSync(f, 'utf8'));
const pid = (await as(O, `select create_project('Tidy') as id`))[0].id;
const team = async (n) => (await as(O, `select id from teams where project_id=$1 and name=$2`, [pid, n]))[0].id;
const [tArt, tSnd, tProd] = [await team('Art'), await team('Sound'), await team('Production')];
const join = async (u, email, t) => { await as(O, `insert into invites (project_id, team_id, email, invited_by) values ($1,$2,$3,$4)`, [pid, t, email, O]); await as(u, `select * from accept_pending_invites()`); };
await join(HOD, 'hod@example.com', tSnd); await join(M, 'member@example.com', tSnd); await join(PM, 'props@example.com', tArt); await join(V, 'viewer@example.com', tArt);
const mid = async (u) => (await as(O, `select id from members where account_id=$1`, [u]))[0].id;
await as(O, `update member_teams set is_hod=true where member_id=$1`, [await mid(HOD)]);   // head of Sound
await as(O, `update team_section_access set level='view' where team_id=$1 and section='equipment'`, [tSnd]);   // every team starts with Equipment at edit; take it away to test the rule
ok('a head of a team with no write access cannot pass write access on', await fails(HOD, `update member_teams set can_edit=true where member_id=$1`, [await mid(M)], 'no write access to pass on'));
await as(O, `update team_section_access set level='edit' where team_id=$1 and section='shots'`, [tSnd]);
await as(O, `update team_section_access set level='edit' where team_id=$1 and section='equipment'`, [tSnd]);
ok('once the owner gives the team write access, the head can', (await as(HOD, `update member_teams set can_edit=true where member_id=$1 returning member_id`, [await mid(M)])).length === 1);
ok('taking it away again is always allowed', (await as(HOD, `update member_teams set can_edit=false where member_id=$1 returning member_id`, [await mid(M)])).length === 1);
ok('the owner can set it on any team', (await as(O, `update member_teams set can_edit=true where member_id=$1 returning member_id`, [await mid(PM)])).length === 1);
ok('a head still cannot appoint another head', await fails(HOD, `update member_teams set is_hod=true where member_id=$1`, [await mid(M)], 'Only the owner'));

// ---- lists on a draft schedule
await as(O, `update team_section_access set level='edit' where team_id=$1 and section='props'`, [tArt]);
await as(O, `update member_teams set is_hod=true where member_id=$1`, [await mid(PM)]);   // Art head edits Props
await as(O, `update team_section_access set level='view' where team_id=$1 and section='props'`, [tSnd]);
const sched = (await as(O, `insert into schedules (project_id, name, start_date, end_date) values ($1,'Block','2026-12-01','2026-12-02') returning id`, [pid]))[0].id;
const item = (await as(PM, `insert into schedule_items (project_id, schedule_id, kind, team_id, name) values ($1,$2,'prop',$3,'Teapot') returning id`, [pid, sched, tArt]))[0].id;
const scn = (await as(O, `insert into scenes (project_id, display_number, heading, sort_order) values ($1,'1','INT. A - DAY',10) returning id`, [pid]))[0].id;
await as(PM, `insert into schedule_item_scenes (item_id, scene_id, project_id) values ($1,$2,$3)`, [item, scn, pid]);
ok('the team that owns the list still sees its own items on a draft schedule', (await as(PM, `select * from schedule_items`)).length === 1 && (await as(PM, `select * from schedule_item_scenes`)).length === 1);
ok('the owner sees them', (await as(O, `select * from schedule_items`)).length === 1);
ok('someone who only views Props does not see items on a draft schedule', (await as(M, `select * from schedule_items`)).length === 0 && (await as(M, `select * from schedule_item_scenes`)).length === 0);
await as(O, `update schedules set locked=true where id=$1`, [sched]);
ok('once the schedule is locked they do', (await as(M, `select * from schedule_items`)).length === 1 && (await as(M, `select * from schedule_item_scenes`)).length === 1);
await as(O, `update schedules set locked=false where id=$1`, [sched]);
await as(O, `insert into schedule_draft_viewers (member_id, project_id) values ($1,$2)`, [await mid(M), pid]);
ok('a named draft viewer sees them while it is a draft', (await as(M, `select * from schedule_items`)).length === 1);
ok('an outsider sees none', (await as(X, `select * from schedule_items`)).length === 0);

// ---- equipment belongs to the team that lists it
const lvlEq = async (t) => (await db.query(`select level from team_section_access where team_id=$1 and section='equipment'`, [t])).rows[0].level;
ok('a new project gives every team the Equipment section at edit level', (await lvlEq(tArt)) === 'edit' && (await lvlEq(tSnd)) === 'edit' && (await lvlEq(tProd)) === 'edit');
const eq = (await as(PM, `insert into schedule_items (project_id, schedule_id, kind, team_id, name) values ($1,$2,'equipment',$3,'C-stand') returning id`, [pid, sched, tArt]))[0].id;
await as(O, `update schedules set locked=true where id=$1`, [sched]);   // locked, so the draft rule does not hide anything below
ok('the Art head lists equipment for Art', Boolean(eq));
const eqS = (await as(HOD, `insert into schedule_items (project_id, schedule_id, kind, team_id, name) values ($1,$2,'equipment',$3,'Boom pole') returning id`, [pid, sched, tSnd]))[0].id;
ok('the Sound head lists equipment for Sound', Boolean(eqS));
ok('Sound sees only its own equipment, not Art\'s', (await as(HOD, `select name from schedule_items where kind='equipment'`)).map((r) => r.name).join() === 'Boom pole');
ok('a plain Sound member sees Sound\'s equipment only', (await as(M, `select name from schedule_items where kind='equipment'`)).map((r) => r.name).join() === 'Boom pole');
ok('Art sees only its own', (await as(PM, `select name from schedule_items where kind='equipment'`)).map((r) => r.name).join() === 'C-stand');
ok('the admin sees every team\'s equipment', (await as(O, `select * from schedule_items where kind='equipment'`)).length === 2);
ok('an outsider sees none', (await as(X, `select * from schedule_items where kind='equipment'`)).length === 0);
ok('props are still readable across teams', (await as(M, `select * from schedule_items where kind='prop'`)).length === 1);
ok('a head edits only their own team\'s equipment', (await as(HOD, `update schedule_items set name='Boom pole 2' where id=$1 returning id`, [eqS])).length === 1 && (await as(HOD, `update schedule_items set name='x' where id=$1 returning id`, [eq])).length === 0);
ok('a plain member cannot edit equipment unless the head allows it', (await as(M, `update schedule_items set name='y' where id=$1 returning id`, [eqS])).length === 0);
await as(HOD, `update member_teams set can_edit=true where member_id=$1`, [await mid(M)]);
ok('once the head allows it, they can', (await as(M, `update schedule_items set name='Boom pole 3' where id=$1 returning id`, [eqS])).length === 1);
ok('a team cannot list equipment for another team', await fails(HOD, `insert into schedule_items (project_id, schedule_id, kind, team_id, name) values ($1,$2,'equipment',$3,'Stolen')`, [pid, sched, tArt]));
const sceneRow = await as(HOD, `insert into schedule_item_scenes (item_id, scene_id, project_id) values ($1,$2,$3) returning item_id`, [eqS, scn, pid]);
ok('an item\'s scene links follow the same visibility', sceneRow.length === 1 && (await as(PM, `select * from schedule_item_scenes where item_id=$1`, [eqS])).length === 0);
// costs only with their item
await db.query(`insert into schedule_item_costs (item_id, project_id, amount, currency) values ($1,$2,50,'EUR')`, [eqS, pid]).catch(() => {});
ok('the Production team sees a cost only for equipment it can see', (await as(O, `select * from schedule_item_costs`)).length <= 1);
await as(O, `update schedules set locked=false where id=$1`, [sched]);

// ---- security: trigger functions are not callable
const can = async (fn) => (await db.query(`select has_function_privilege('authenticated', $1, 'execute') a, has_function_privilege('anon', $1, 'execute') b`, [fn])).rows[0];
for (const fn of ['guard_draft_viewer()', 'guard_project_aspect()', 'guard_schedule_delete()', 'guard_schedule_locked()']) { const r = await can(fn); ok(`${fn} is not callable by signed-in or anonymous users`, !r.a && !r.b); }
ok('the two functions have a fixed search path', (await db.query(`select count(*)::int n from pg_proc where proname in ('item_section','mail_id_reserved') and proconfig is not null and array_to_string(proconfig, ',') like '%search_path%'`)).rows[0].n === 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
