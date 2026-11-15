// Who may create projects: the switch, the allowed list, one project each, the counter, unlimited emails, and the 350 MB default.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const files = process.argv.slice(2);
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
for (const f of files) await db.exec(fs.readFileSync(f, 'utf8'));
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
const mk = async (email, confirmed = true) => (await db.query(`insert into auth.users (email, email_confirmed_at, raw_user_meta_data) values ($1, $2, $3) returning id`, [email, confirmed ? new Date() : null, JSON.stringify({ display_name: email })])).rows[0].id;
const [OWNER, GUEST, STRANGER, UNCONFIRMED] = [await mk('boss@example.com'), await mk('Guest@Example.com'), await mk('stranger@example.com'), await mk('late@example.com', false)];

// switch off: everything works as before
ok('with the switch off anyone creates a project', (await as(STRANGER, `select create_project('Open') id`)).length === 1);
ok('and can_create_project says ok', (await as(STRANGER, `select can_create_project() r`))[0].r === 'ok');
ok('a new project starts with a 350 MB picture limit', (await db.query(`select image_cap_mb c from projects where name='Open'`)).rows[0].c === 350);

// the tables are closed to users
ok('users cannot read the list or the switch', await fails(OWNER, `select * from project_creators`) && await fails(OWNER, `select * from app_settings`));
ok('users cannot write the list or the switch', await fails(OWNER, `insert into project_creators (email) values ('x@example.com')`) && await fails(OWNER, `update app_settings set project_creation_restricted = false`));
ok('an anonymous caller cannot ask or create', await fails(null, `select create_project('x')`));

// switch on
await db.query(`update app_settings set project_creation_restricted = true`);
await db.query(`insert into project_creators (email, unlimited) values ('  BOSS@Example.com ', true)`);
await db.query(`insert into project_creators (email) values ('guest@example.com')`);
ok('emails are tidied to lower case without spaces', (await db.query(`select count(*)::int n from project_creators where email in ('boss@example.com','guest@example.com')`)).rows[0].n === 2);
ok('a row without numbers allows exactly 1', (await db.query(`select allowed, unlimited, created from project_creators where email='guest@example.com'`)).rows[0].allowed === 1);
ok('a bad email is refused', await (async () => { try { await db.query(`insert into project_creators (email) values ('nonsense')`); return false; } catch { return true; } })());

ok('someone not on the list is refused with a clear code', await fails(STRANGER, `select create_project('No')`, [], 'not_invited'));
ok('and can_create_project says not_invited', (await as(STRANGER, `select can_create_project() r`))[0].r === 'not_invited');
ok('an unconfirmed email is never allowed, even if listed', await (async () => { await db.query(`insert into project_creators (email) values ('late@example.com')`); return (await as(UNCONFIRMED, `select can_create_project() r`))[0].r === 'not_invited' && await fails(UNCONFIRMED, `select create_project('No')`, [], 'not_invited'); })());
ok('an invited person (any capitals at sign-up) creates one project', (await as(GUEST, `select can_create_project() r`))[0].r === 'ok' && (await as(GUEST, `select create_project('Mine') id`)).length === 1);
ok('the second is refused', (await as(GUEST, `select can_create_project() r`))[0].r === 'projects_used' && await fails(GUEST, `select create_project('Two')`, [], 'projects_used'));
ok('deleting the project does not give another', await (async () => { const id = (await as(GUEST, `select id from projects where name='Mine'`))[0].id; await as(GUEST, `delete from projects where id=$1`, [id]); return await fails(GUEST, `select create_project('Again')`, [], 'projects_used'); })());
ok('the counter shows what was used', (await db.query(`select created from project_creators where email='guest@example.com'`)).rows[0].created === 1);
ok('raising allowed gives more', await (async () => { await db.query(`update project_creators set allowed = 2 where email='guest@example.com'`); return (await as(GUEST, `select create_project('Second') id`)).length === 1; })());
ok('unlimited creates as many as it likes', await (async () => { for (const n of ['a', 'b', 'c']) await as(OWNER, `select create_project($1)`, [n]); return (await as(OWNER, `select count(*)::int n from projects where owner_id=$1`, [OWNER]))[0].n === 3; })());
ok('removing a row stops further projects but keeps the projects', await (async () => { await db.query(`delete from project_creators where email='guest@example.com'`); return await fails(GUEST, `select create_project('x')`, [], 'not_invited') && (await as(GUEST, `select count(*)::int n from projects where owner_id=$1`, [GUEST]))[0].n === 1; })());
ok('nobody can insert into projects directly', await fails(OWNER, `insert into projects (name, owner_id) values ('Sneaky', $1)`, [OWNER]));

// the rest stays open: joining and transfer do not need the list
ok('a person not on the list can still join a project by invite', await (async () => {
  const pid = (await as(OWNER, `select id from projects where name='a'`))[0].id;
  const tid = (await db.query(`select id from teams where project_id=$1 limit 1`, [pid])).rows[0].id;
  await as(OWNER, `insert into invites (project_id, team_id, email, invited_by) values ($1,$2,'stranger@example.com',$3)`, [pid, tid, OWNER]);
  await as(STRANGER, `select * from accept_pending_invites()`);
  return (await as(STRANGER, `select count(*)::int n from members where project_id=$1 and account_id=$2`, [pid, STRANGER]))[0].n === 1;
})());
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
