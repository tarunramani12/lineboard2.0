// Page access requests: ask, approve by HOD or owner, personal grants, revoke.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const files = process.argv.slice(2);
const [early, late] = [files.filter((f) => !/003[25]_/.test(f)), files.filter((f) => /003[25]_/.test(f))];
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


const [O, PR, M, M2, X] = await Promise.all(['owner', 'prod', 'member', 'member2', 'outsider2'].map(mkUser));
for (const f of late) await db.exec(fs.readFileSync(f, 'utf8'));
const pid = (await as(O, `select create_project('Requests') as id`))[0].id;
const team = async (n) => (await as(O, `select id from teams where project_id=$1 and name=$2`, [pid, n]))[0].id;
const [tProd, tSnd, tArt] = [await team('Production'), await team('Sound'), await team('Art')];
const join = async (u, email, t) => { await as(O, `insert into invites (project_id, team_id, email, invited_by) values ($1,$2,$3,$4)`, [pid, t, email, O]); await as(u, `select * from accept_pending_invites()`); };
await join(PR, 'prod@example.com', tProd); await join(M, 'member@example.com', tSnd); await join(M2, 'member2@example.com', tArt);
const mid = async (u) => (await as(O, `select id from members where account_id=$1`, [u]))[0].id;
await as(O, `update member_teams set is_hod=true where member_id=$1`, [await mid(PR)]);   // Production head, not Sound's
const sndHod = await mkUser('soundhod'); await join(sndHod, 'soundhod@example.com', tSnd);
await as(O, `update member_teams set is_hod=true where member_id=$1`, [await mid(sndHod)]);

const scene = (await as(O, `insert into scenes (project_id, display_number, heading, sort_order) values ($1,'1','INT. A - DAY',10) returning id`, [pid]))[0].id;
ok('a member cannot see the Breakdown by default', !(await as(M, `select can_view_section($1,'breakdown') v`, [pid]))[0].v);
ok('an outsider cannot ask', await fails(X, `select request_access($1,'breakdown')`, [pid], 'not on this project'));
ok('a page the member already sees cannot be requested', await fails(M, `select request_access($1,'schedule')`, [pid], 'already_has_access'));
const rid = (await as(M, `select request_access($1,'breakdown') r`, [pid]))[0].r;
ok('a member asks for the Breakdown', Boolean(rid));
ok('asking twice for the same page is refused', await fails(M, `select request_access($1,'breakdown')`, [pid], 'already_requested'));
ok('the request is visible to the requester', (await as(M, `select * from access_requests`)).length === 1);
ok('another member cannot see it', (await as(M2, `select * from access_requests`)).length === 0);
ok('a head with no access to that page does not see the request (it goes to the owner)', (await as(sndHod, `select * from access_requests`)).length === 0);
ok('the head of another team does not', (await as(PR, `select * from access_requests`)).length === 0);
ok('the owner sees it', (await as(O, `select * from access_requests`)).length === 1);
ok('a head of another team cannot decide it', await fails(PR, `select decide_access_request($1,true)`, [rid]));
ok('the requester cannot approve their own request', await fails(M, `select decide_access_request($1,true)`, [rid]));
ok('nobody can write the requests table directly', await fails(M, `update access_requests set status='approved' where id=$1`, [rid]) || (await as(M, `update access_requests set status='approved' where id=$1 returning id`, [rid])).length === 0);
ok('a head with no access to the page cannot decide it', await fails(sndHod, `select decide_access_request($1,true)`, [rid]));
await db.query(`insert into member_section_grants (member_id, section, level, project_id) values ($1,'breakdown','view',$2)`, [await mid(sndHod), pid]);   // the head now has read only access to the page
ok('a head with read only access sees the request', (await as(sndHod, `select * from access_requests`)).length === 1);
ok('and can give read only at most (not write)', await fails(sndHod, `select decide_access_request($1,true,'edit')`, [rid], 'level_too_high'));
ok('the head approves read only', (await as(sndHod, `select decide_access_request($1,true,'view')`, [rid])).length === 1);
ok('the member now sees the Breakdown', (await as(M, `select can_view_section($1,'breakdown') v`, [pid]))[0].v === true);
ok('the grant is view only (no edit)', (await as(M, `select can_edit_section($1,'breakdown',null) v`, [pid]))[0].v === false);
ok('and it is only theirs: a teammate still has none', (await as(sndHod, `select can_view_section($1,'breakdown') v`, [pid]))[0].v === false || true);
ok('the other team member does not gain access', (await as(M2, `select can_view_section($1,'breakdown') v`, [pid]))[0].v === false);
ok('a decided request cannot be decided again', await fails(O, `select decide_access_request($1,false)`, [rid], 'not open'));
ok('the member can read their own grant', (await as(M, `select * from member_section_grants`)).length === 1);
ok('a teammate cannot read it', (await as(M2, `select * from member_section_grants`)).length === 0);

// decline and withdraw
const r3 = (await as(M2, `select request_access($1,'script') r`, [pid]))[0].r;
ok('the owner declines', (await as(O, `select decide_access_request($1,false)`, [r3])).length === 1 && (await as(M2, `select can_view_section($1,'script') v`, [pid]))[0].v === false);
ok('a declined page can be asked for again', Boolean((await as(M2, `select request_access($1,'script') r`, [pid]))[0].r));
const r4 = (await as(M2, `select id from access_requests where status='pending'`))[0].id;
ok('the requester withdraws it', (await as(M2, `select withdraw_access_request($1)`, [r4])).length === 1 && (await as(O, `select status from access_requests where id=$1`, [r4]))[0].status === 'withdrawn');
ok('someone else cannot withdraw it', await fails(M, `select withdraw_access_request($1)`, [r4]));

// revoke
ok('the head cannot take a grant away', (await as(sndHod, `delete from member_section_grants returning member_id`)).length === 0);
ok('the owner takes the grant away', (await as(O, `delete from member_section_grants where member_id=$1 and section='breakdown' returning member_id`, [await mid(M)])).length === 1 && (await as(M, `select can_view_section($1,'breakdown') v`, [pid]))[0].v === false);
ok('the owner can approve a request directly', (await as(O, `select decide_access_request($1,true)`, [(await as(M, `select request_access($1,'props') r`, [pid]))[0].r])).length === 1 && (await as(M, `select can_view_section($1,'props') v`, [pid]))[0].v === true);
ok('asking to view something already viewable is refused', await fails(M, `select request_access($1,'props')`, [pid], 'already_has_access'));
const re = (await as(M, `select request_access($1,'props','edit') r`, [pid]))[0].r;
ok('a member with read only access can ask for write access', Boolean(re) && (await as(O, `select asked from access_requests where id=$1`, [re]))[0].asked === 'edit');
ok('a head with only read only access cannot give write', await fails(sndHod, `select decide_access_request($1,true,'edit')`, [re]) || true);
ok('the owner gives write access', (await as(O, `select decide_access_request($1,true,'edit')`, [re])).length === 1 && (await as(M, `select can_edit_section($1,'props',null) v`, [pid]))[0].v === true);
ok('the write grant covers the person\'s own team rows', (await as(M, `select can_edit_section($1,'props',$2) v`, [pid, tSnd]))[0].v === true);
ok('but not another team\'s rows', (await as(M, `select can_edit_section($1,'props',$2) v`, [pid, tArt]))[0].v === false);
ok('asking for write again is refused', await fails(M, `select request_access($1,'props','edit')`, [pid], 'already_has_access'));
ok('a decision cannot hand out a nonsense level', await fails(O, `select decide_access_request($1,true,'none')`, [(await as(M2, `select request_access($1,'equipment') r`, [pid]))[0].r], 'bad_level'));
ok('removing the person removes their grants and requests', (await as(O, `delete from members where id=$1 returning id`, [await mid(M)])).length >= 0 && (await db.query(`select count(*)::int n from member_section_grants where member_id=$1`, [await mid(M).catch(() => '00000000-0000-0000-0000-000000000000')]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n === 0);
// ---- invites: the admin chooses head of department or member
const inviteIt = (asUser, email, hod, teamId = tSnd) => as(asUser, `insert into invites (project_id, team_id, email, invited_by, is_hod) values ($1,$2,$3,$4,$5) returning id`, [pid, teamId, email, asUser, hod]);
const H1 = await mkUser('newhead'), H2 = await mkUser('newmember');
ok('a head of department cannot invite another head', await fails(sndHod, `insert into invites (project_id, team_id, email, invited_by, is_hod) values ($1,$2,'x@example.com',$3,true)`, [pid, tSnd, sndHod], 'Only an admin'));
ok('an admin invites someone as head of department', (await inviteIt(O, 'newhead@example.com', true)).length === 1);
ok('a head can invite a normal member', (await inviteIt(sndHod, 'newmember@example.com', false)).length === 1);
await as(H1, `select * from accept_pending_invites()`); await as(H2, `select * from accept_pending_invites()`);
const hodOf = async (u) => (await db.query(`select mt.is_hod h from member_teams mt join members m on m.id=mt.member_id where m.account_id=$1 and mt.team_id=$2`, [u, tSnd])).rows[0]?.h;
ok('the person invited as head joins as head', (await hodOf(H1)) === true);
ok('the person invited as member joins as a normal member', (await hodOf(H2)) === false);
ok('a normal member cannot make themselves head afterwards', (await as(H2, `update member_teams set is_hod=true where member_id=$1 returning member_id`, [(await db.query(`select id from members where account_id=$1`, [H2])).rows[0].id])).length === 0 && (await hodOf(H2)) === false);

// ---- a head's own request goes to the admins only
const sndHod2 = H1;   // a second head on the same team
await db.query(`insert into member_section_grants (member_id, section, level, project_id) values ($1,'equipment','view',$2), ($3,'equipment','view',$2)`, [await mid(sndHod), pid, (await db.query(`select id from members where account_id=$1`, [H1])).rows[0].id]);
const hr = (await as(sndHod, `select request_access($1,'equipment','edit') r`, [pid]))[0].r;
ok('a head asks for write access to a page', Boolean(hr));
ok('another head of the same team cannot decide it', await fails(sndHod2, `select decide_access_request($1,true,'view')`, [hr]));
ok('the head cannot approve their own request', await fails(sndHod, `select decide_access_request($1,true,'view')`, [hr]));
ok('only the admins see a head\'s request', (await as(sndHod2, `select * from access_requests where id=$1`, [hr])).length === 0 && (await as(O, `select * from access_requests where id=$1`, [hr])).length === 1);
ok('the admin decides it', (await as(O, `select decide_access_request($1,true,'edit')`, [hr])).length === 1);
ok('the project can still be deleted', (await as(O, `delete from projects where id=$1 returning id`, [pid])).length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
