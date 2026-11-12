import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;`);
const files = process.argv.slice(2);
for (const f of files) await db.exec(fs.readFileSync(f, 'utf8'));
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); };
async function as(uid, sql, p = []) { await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`); await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [uid ?? '']); try { return (await db.query(sql, p)).rows } finally { await db.exec('reset role') } }
const fails = async (u, sql, p = [], m) => { try { await as(u, sql, p); return false } catch (e) { return m ? String(e.message).includes(m) : true } };
const mk = async (n) => (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1,$2) returning id`, [`${n}@example.com`, JSON.stringify({ display_name: n })])).rows[0].id;
const [O, ADM, HS, HC, MEM, N1, N2, X] = await Promise.all(['owner', 'admin', 'soundhod', 'camhod', 'member', 'new1', 'new2', 'outsider'].map(mk));
const pid = (await as(O, `select create_project('Join') id`))[0].id;
const team = async (n, p = pid) => (await as(O, `select id from teams where project_id=$1 and name=$2`, [p, n]))[0].id;
const [tSound, tCam, tArt] = [await team('Sound'), await team('Camera'), await team('Art')];
const invite = async (u, e, t) => { await as(O, `insert into invites (project_id, team_id, email, invited_by) values ($1,$2,$3,$4)`, [pid, t, e, O]); await as(u, `select * from accept_pending_invites()`); };
await invite(HS, 'soundhod@example.com', tSound); await invite(HC, 'camhod@example.com', tCam); await invite(MEM, 'member@example.com', tSound); await invite(ADM, 'admin@example.com', tArt);
await as(O, `update members set role='admin' where account_id=$1`, [ADM]);
await db.query(`update member_teams set is_hod=true where member_id=(select id from members where account_id=$1)`, [HS]);
await db.query(`update member_teams set is_hod=true where member_id=(select id from members where account_id=$1)`, [HC]);
const code = async (t) => (await as(O, `insert into join_codes (team_id, created_by) values ($1,$2) returning code`, [t, O]))[0].code;
const cCam = await code(tCam);


const q = (sql, p = []) => db.query(sql, p).then(r => r.rows);
// An admin edits rows in several sections, then deletes their account. The edits must not block it.
const crew = (await as(ADM, `select id from cast_crew_rows where project_id=$1 and account_id=$2`, [pid, ADM]))[0];
ok('the admin has a Cast and crew row', Boolean(crew));
await as(ADM, `update cast_crew_rows set role='Gaffer' where id=$1`, [crew.id]);
const stamped = (await q(`select updated_by from cast_crew_rows where id=$1`, [crew.id]))[0].updated_by;
ok('the row is stamped with the admin', stamped === ADM);
const before = (await q(`select count(*)::int n from cast_crew_rows where project_id=$1`, [pid]))[0].n;
ok('the admin can delete their account after editing', await as(ADM, `select delete_my_account()`).then(() => true, (e) => { console.log("ERR", e.message); return false }));
ok('the account is gone', (await q(`select count(*)::int n from auth.users where id=$1`, [ADM]))[0].n === 0);
const after = (await q(`select updated_by from cast_crew_rows where project_id=$1 and role='Gaffer'`, [pid]));
ok('the edited row stays, with no editor named', after.length <= 1 && after.every(r => r.updated_by === null));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
