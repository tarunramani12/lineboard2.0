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

const [O, A, M, X] = await Promise.all(['owner', 'admin', 'member', 'outsider'].map(mkUser));
const pid = (await as(O, `select create_project('Film') as id`))[0].id;
const tCam = (await as(O, `select id from teams where project_id=$1 and name='Camera'`, [pid]))[0].id;
const join = async (u, email) => { await as(O, `insert into invites (project_id, team_id, email, invited_by) values ($1,$2,$3,$4)`, [pid, tCam, email, O]); await as(u, `select * from accept_pending_invites()`); };
await join(A, 'admin@example.com'); await join(M, 'member@example.com');
const mid = async (u) => (await as(O, `select id from members where account_id=$1 and project_id=$2`, [u, pid]))[0].id;
const role = async (u) => (await as(O, `select role from members where account_id=$1 and project_id=$2`, [u, pid]))[0].role;
const ownerId = async () => (await db.query(`select owner_id from projects where id=$1`, [pid])).rows[0].owner_id;
const [mO, mA, mM] = [await mid(O), await mid(A), await mid(M)];

await as(O, `update members set role='admin' where id=$1`, [mA]);
ok('a plain member cannot transfer', await fails(M, `select transfer_ownership($1,$2)`, [pid, mM], 'Only the owner'));
ok('an outsider cannot transfer', await fails(X, `select transfer_ownership($1,$2)`, [pid, mM], 'Only the owner'));
ok('the owner cannot hand it to a plain member (make them admin first)', await fails(O, `select transfer_ownership($1,$2)`, [pid, mM], 'admin first'));
ok('the owner cannot hand it to themselves', await fails(O, `select transfer_ownership($1,$2)`, [pid, mO], 'admin first'));
ok('a member of another project is refused', await fails(O, `select transfer_ownership($1,$2)`, [pid, '00000000-0000-0000-0000-000000000000'], 'not on this project'));
ok('plain update of owner_id still refused', await fails(O, `update projects set owner_id=$1 where id=$2`, [A, pid]));
ok('plain role change to owner still refused', await fails(O, `update members set role='owner' where id=$1`, [mA]));
ok('an admin cannot promote themselves', await fails(A, `update members set role='owner' where id=$1`, [mA]));
await as(O, `select transfer_ownership($1,$2)`, [pid, mA]);
ok('the admin is now the owner', (await role(A)) === 'owner' && (await ownerId()) === A);
ok('the old owner is now an admin', (await role(O)) === 'admin');
ok('exactly one owner', (await db.query(`select count(*)::int n from members where project_id=$1 and role='owner'`, [pid])).rows[0].n === 1);
ok('the new owner can lock the script', !(await fails(A, `select lock_script($1)`, [pid])));
ok('the old owner can no longer lock/unlock', await fails(O, `select unlock_script($1)`, [pid]));
ok('the old owner cannot transfer it back', await fails(O, `select transfer_ownership($1,$2)`, [pid, mO], 'Only the owner'));
ok('the old owner can delete their account now', !(await fails(O, `select delete_my_account()`)));
ok('the new owner cannot delete their account while owning', await fails(A, `select delete_my_account()`, [], 'You own a project'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
