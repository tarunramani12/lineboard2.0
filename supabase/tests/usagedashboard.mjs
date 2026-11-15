// Usage dashboard: only app admins may call it, the numbers match the data, nothing can be written, and the other tables stay closed.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const files = process.argv.slice(2);
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text,
    email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb default '{}',
    created_at timestamptz default now(), last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
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
const mk = async (email, confirmed = true) => (await db.query(`insert into auth.users (email, email_confirmed_at, raw_user_meta_data) values ($1, $2, $3) returning id`, [email, confirmed ? new Date() : null, JSON.stringify({ display_name: email.split('@')[0] })])).rows[0].id;

// the owner's own email is unlimited in project_creators BEFORE the migration would run on the live data; here we add it and re-run the seed
const BOSS = await mk('boss@example.com'), A = await mk('a@example.com'), B = await mk('b@example.com'), LATE = await mk('late@example.com', false);
await db.query(`insert into project_creators (email, unlimited) values ('boss@example.com', true)`);
await db.query(`insert into app_admins (email) select email from project_creators where unlimited on conflict do nothing`);
await db.query(`insert into app_admins (email) values ('  LATE@Example.com ')`);

// data: A owns two projects, B owns one and joins A's first as a member; BOSS is only a member of B's project
const p1 = (await as(A, `select create_project('Alpha') id`))[0].id;
const p2 = (await as(A, `select create_project('Beta') id`))[0].id;
const p3 = (await as(B, `select create_project('Gamma') id`))[0].id;
await db.query(`insert into members (project_id, account_id, role) values ($1, $2, 'member'), ($3, $4, 'admin')`, [p1, B, p3, BOSS]);
await db.query(`update auth.users set last_sign_in_at = now() - interval '2 days' where id = $1`, [A]);
await db.query(`update auth.users set last_sign_in_at = now() - interval '40 days' where id = $1`, [B]);
await db.query(`insert into storage.objects (bucket_id, name, metadata) values
  ('storyboard', $1 || '/s1/a.jpg', '{"size": 400000}'), ('storyboard', $1 || '/s1/b.jpg', '{"size": 100000}'),
  ('locations', $2 || '/l1/c.jpg', '{"size": 250000}'), ('moodboard', $3 || '/d.jpg', '{"size": 50000}')`, [p1, p1, p3]);

// who may open it
ok('the owner list was seeded from the unlimited emails and tidied', (await db.query(`select count(*)::int n from app_admins where email in ('boss@example.com','late@example.com')`)).rows[0].n === 2);
ok('an app admin is recognised', (await as(BOSS, `select is_app_admin() r`))[0].r === true);
ok('an ordinary account is not', (await as(A, `select is_app_admin() r`))[0].r === false);
ok('an unconfirmed email is never an admin, even when listed', (await as(LATE, `select is_app_admin() r`))[0].r === false);
ok('an anonymous caller cannot ask', await fails(null, `select is_app_admin()`) && await fails(null, `select app_overview()`));
ok('an ordinary account is refused with not_allowed (overview, projects, people)',
  await fails(A, `select app_overview()`, [], 'not_allowed') && await fails(A, `select * from app_projects()`, [], 'not_allowed') && await fails(A, `select * from app_people()`, [], 'not_allowed'));
ok('the list cannot be read or written from the app', await fails(BOSS, `select * from app_admins`) && await fails(BOSS, `insert into app_admins (email) values ('x@example.com')`));
ok('the helper check is not callable directly', await fails(BOSS, `select require_app_admin()`));

// the numbers
const o = (await as(BOSS, `select app_overview() o`))[0].o;
ok('accounts: 4 total, 4 profiles created just now', o.accounts === 4 && o.accounts_new_7d === 4);
ok('active in 7 days = 1 (A), in 30 days = 1 (B signed in 40 days ago)', o.accounts_active_7d === 1 && o.accounts_active_30d === 1);
ok('projects: 3, all active, none locked or read only', o.projects === 3 && o.projects_active_30d === 3 && o.projects_read_only === 0 && o.projects_script_locked === 0);
ok('owners = 2, admins = 1', o.owners === 2 && o.admins === 1);
ok('memberships: 3 owners + 2 added = 5; people in projects = 3 (A, B, BOSS)', o.memberships === 5 && o.people_in_projects === 3);
ok('average people per project = 1.7, most in one project = 2', Number(o.avg_people_per_project) === 1.7 && o.max_people_in_a_project === 2);
ok('average projects per owner = 1.5', Number(o.avg_projects_per_owner) === 1.5);
ok('storage: 4 files, 800000 bytes, by bucket', o.storage_files === 4 && o.storage_bytes === 800000 && o.storage_by_bucket.storyboard === 500000 && o.storage_by_bucket.locations === 250000 && o.storage_by_bucket.moodboard === 50000);
ok('email counters exist and are zero', o.emails_sent_30d === 0 && o.emails_failed === 0 && o.emails_waiting === 0 && o.join_requests_waiting === 0);

const projs = await as(BOSS, `select * from app_projects()`);
const alpha = projs.find((r) => r.name === 'Alpha'), gamma = projs.find((r) => r.name === 'Gamma');
ok('one row per project', projs.length === 3);
ok('Alpha: owner A, 2 people, 0 admins, 750000 bytes of pictures', alpha.owner_email === 'a@example.com' && alpha.people === 2 && alpha.admins === 0 && Number(alpha.storage_bytes) === 750000);
ok('Gamma: owner B, 2 people, 1 admin, 50000 bytes, picture limit 200 or 350 MB', gamma.owner_email === 'b@example.com' && gamma.people === 2 && gamma.admins === 1 && Number(gamma.storage_bytes) === 50000 && [200, 350].includes(gamma.image_cap_mb));

const people = await as(BOSS, `select * from app_people()`);
const pa = people.find((r) => r.email === 'a@example.com'), pb = people.find((r) => r.email === 'b@example.com'), pboss = people.find((r) => r.email === 'boss@example.com');
ok('one row per account', people.length === 4);
ok('A owns 2, B owns 1 and is a member of 1, BOSS is an admin of 1', pa.projects_owned === 2 && pb.projects_owned === 1 && pb.projects_member === 1 && pboss.projects_admin === 1);
ok('storage is counted on the owner of the project (A 750000, B 50000)', Number(pa.storage_bytes) === 750000 && Number(pb.storage_bytes) === 50000);
ok('last sign in is shown', pa.last_sign_in_at !== null && pboss.last_sign_in_at === null);

// removing someone from the list closes the door
await db.query(`delete from app_admins where email = 'boss@example.com'`);
ok('after removal from the list the same person is refused', await fails(BOSS, `select app_overview()`, [], 'not_allowed'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
