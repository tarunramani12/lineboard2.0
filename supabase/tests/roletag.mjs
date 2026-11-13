// Team role tags: rules follow the tag, not the team's name.
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
const mkUser = async (name) => (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1,$2) returning id`,
  [`${name}@example.com`, JSON.stringify({ display_name: name })])).rows[0].id;
const [O, P, S, X] = await Promise.all(['owner', 'prod', 'snd', 'other'].map(mkUser));
const pid = (await as(O, `select create_project('Tags') as id`))[0].id;
const tag = async (n) => (await as(O, `select role_tag from teams where project_id=$1 and name=$2`, [pid, n]))[0].role_tag;
const team = async (n) => (await as(O, `select id from teams where project_id=$1 and name=$2`, [pid, n]))[0].id;
ok('new projects tag Production, Camera, Direction, Art, VFX and Sound', (await Promise.all(['Production', 'Camera', 'Direction', 'Art', 'VFX', 'Sound'].map(tag))).join() === 'production,camera,direction,art,vfx,sound');
ok('the other teams have no tag', (await tag('Costume')) === null && (await tag('Post')) === null);
const join = async (u, email, t) => { await as(O, `insert into invites (project_id, team_id, email, invited_by) values ($1,$2,$3,$4)`, [pid, t, email, O]); await as(u, `select * from accept_pending_invites()`); };
await join(P, 'prod@example.com', await team('Production')); await join(S, 'snd@example.com', await team('Sound'));
ok('Production members see costs', (await as(P, `select can_see_costs($1) as v`, [pid]))[0].v === true);
ok('other members do not', (await as(S, `select can_see_costs($1) as v`, [pid]))[0].v === false);
await as(O, `update teams set name='Producers' where id=$1`, [await team('Production')]);
ok('renaming the Production team keeps its cost access', (await as(P, `select can_see_costs($1) as v`, [pid]))[0].v === true);
await as(O, `update teams set name='Production' where id=$1`, [await team('Sound')]);
ok('a team that is only called Production gets no cost access', (await as(S, `select can_see_costs($1) as v`, [pid]))[0].v === false);
await as(O, `update teams set name='Audio' where id=$1`, [await team('Audio').catch(() => null) ?? (await as(O, `select id from teams where project_id=$1 and role_tag='sound'`, [pid]))[0].id]);
const sid = (await as(O, `select id from teams where project_id=$1 and role_tag='sound'`, [pid]))[0].id;
await as(O, `update team_section_access set level='edit' where team_id=$1 and section='shots'`, [sid]);
await as(O, `update member_teams set can_edit=true where member_id=(select id from members where account_id=$1)`, [S]);
ok('a renamed Sound team still edits the sound fields', (await as(S, `select can_edit_shots_as($1,'Sound') as v`, [pid]))[0].v === true);
ok('and is not the VFX team', (await as(S, `select can_edit_shots_as($1,'VFX') as v`, [pid]))[0].v === false);
ok('only the owner or an admin can change a tag', (await as(S, `update teams set role_tag='camera' where id=$1 returning id`, [sid])).length === 0);
ok('one team per tag in a project', await fails(O, `update teams set role_tag='camera' where id=$1`, [sid]));
ok('an unknown tag is refused', await fails(O, `update teams set role_tag='boss' where id=$1`, [sid]));
await as(O, `update teams set role_tag=null where id=$1`, [sid]);
ok('the owner can clear a tag, and the rule stops applying', (await as(S, `select can_edit_shots_as($1,'Sound') as v`, [pid]))[0].v === false);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
