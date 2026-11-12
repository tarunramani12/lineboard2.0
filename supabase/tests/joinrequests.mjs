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

// ---- email invites also reach Cast and crew
const rowOf = (u) => db.query(`select * from cast_crew_rows where account_id=$1`, [u]).then(r => r.rows);
ok('an accepted email invite adds the person to Cast and crew', (await rowOf(MEM)).length === 1);
const memRow = (await rowOf(MEM))[0];
ok('as a crew row for their team, named after them, department = team name', memRow.team_id === tSound && memRow.kind === 'crew' && memRow.name === 'member' && memRow.department === 'Sound' && memRow.from_account);
ok('the owner is not added', (await rowOf(O)).length === 0);
ok('their account email is kept as the contact', (await db.query(`select email from cast_crew_contacts where row_id=$1`, [memRow.id])).rows[0]?.email === 'member@example.com');

// ---- codes
ok('the old instant join function is gone', await fails(N1, `select redeem_join_code($1)`, [cCam]));
ok('an unknown code is specific', await fails(N1, `select lookup_join_code('ZZZZZZZZ')`, [], 'code_not_found'));
const cOld = await code(tCam); await db.query(`update join_codes set revoked_at=now() where code=$1`, [cOld]);
ok('a revoked code is specific', await fails(N1, `select lookup_join_code($1)`, [cOld], 'code_revoked'));
const cExp = await code(tCam); await db.query(`update join_codes set expires_at=now()-interval '1 day' where code=$1`, [cExp]);
ok('an expired code is specific', await fails(N1, `select request_to_join($1,$2)`, [cExp, tCam], 'code_expired'));
ok('signed-out people cannot look up a code', await fails(null, `select lookup_join_code($1)`, [cCam]));
const look = (await as(N1, `select lookup_join_code($1) r`, [cCam]))[0].r;
ok('a valid code shows the project, its team and the team list', look.project_name === 'Join' && look.team_id === tCam && look.teams.length === 10);
ok('an existing member cannot request', await fails(MEM, `select lookup_join_code($1)`, [cCam], 'already_member'));

// ---- requesting
const other = (await as(X, `select create_project('Other') id`))[0].id;
const otherTeam = (await as(X, `select id from teams where project_id=$1 limit 1`, [other]))[0].id;
ok('a team from another project is refused', await fails(N1, `select request_to_join($1,$2)`, [cCam, otherTeam], 'team_not_in_project'));
const rid = (await as(N1, `select request_to_join($1,$2,'Boom operator') id`, [cCam, tSound]))[0].id;
ok('the request is created for the chosen team, not the code team', (await db.query(`select team_id, status, role from join_requests where id=$1`, [rid])).rows[0].team_id === tSound);
ok('the person is not a member yet', (await db.query(`select 1 from members where account_id=$1`, [N1])).rows.length === 0);
ok('and cannot read the project', (await as(N1, `select * from projects where id=$1`, [pid])).length === 0 && (await as(N1, `select * from cast_crew_rows`)).length === 0);
const rid2 = (await as(N1, `select request_to_join($1,$2,'Runner') id`, [cCam, tCam]))[0].id;
ok('asking again updates the one open request', rid2 === rid && (await db.query(`select team_id, role from join_requests where project_id=$1 and account_id=$2 and status='pending'`, [pid, N1])).rows.length === 1);
const mine = (await as(N1, `select my_join_requests() r`))[0].r;
ok('they see it waiting, with the team name and whether an HOD exists', mine.length === 1 && mine[0].team_name === 'Camera' && mine[0].project_name === 'Join' && mine[0].has_hod === true);
ok('nobody else sees it as theirs', (await as(N2, `select my_join_requests() r`))[0].r.length === 0);

// ---- who decides
const listFor = async (u) => (await as(u, `select list_join_requests($1) r`, [pid]))[0].r;
ok('the HOD of the chosen team sees it, with name and email', (await listFor(HC)).length === 1 && (await listFor(HC))[0].email === 'new1@example.com');
ok('the HOD of another team does not', (await listFor(HS)).length === 0);
ok('a plain member sees none', (await listFor(MEM)).length === 0);
ok('the owner and an admin see it', (await listFor(O)).length === 1 && (await listFor(ADM)).length === 1);
ok('another team HOD cannot approve', await fails(HS, `select decide_join_request($1,true)`, [rid], 'not_allowed'));
ok('a plain member cannot approve', await fails(MEM, `select decide_join_request($1,true)`, [rid], 'not_allowed'));
ok('the requester cannot approve themselves', await fails(N1, `select decide_join_request($1,true)`, [rid], 'not_allowed'));
await as(HC, `select decide_join_request($1,true)`, [rid]);
const mem1 = (await db.query(`select m.id, m.role, sa.mode from members m join scene_access sa on sa.member_id=m.id where m.project_id=$1 and m.account_id=$2`, [pid, N1])).rows[0];
ok('approval makes them a member with no script access', mem1?.role === 'member' && mem1.mode === 'none');
ok('on the team they asked for, read-only', (await db.query(`select team_id, is_hod, can_edit from member_teams where member_id=$1`, [mem1.id])).rows.every(r => r.team_id === tCam && !r.is_hod && !r.can_edit));
const r1 = (await rowOf(N1));
ok('they are in Cast and crew once, under that team, with the role they gave', r1.length === 1 && r1[0].team_id === tCam && r1[0].role === 'Runner' && r1[0].department === 'Camera' && r1[0].name === 'new1');
ok('approved requests leave the waiting list', (await as(N1, `select my_join_requests() r`))[0].r.length === 0);
ok('a decided request cannot be decided again', await fails(HC, `select decide_join_request($1,true)`, [rid], 'request_not_found'));

// ---- a team with no HOD: owner decides; decline; withdraw
const cArt = await code(tArt);
const rid3 = (await as(N2, `select request_to_join($1,$2,'') id`, [cArt, tArt]))[0].id;
ok('a team with no HOD shows has_hod false', (await listFor(O))[0].has_hod === false);
ok('the owner approves it', (await as(O, `select decide_join_request($1,true) p`, [rid3]))[0].p === pid);
ok('without a role the row has no role yet', (await rowOf(N2))[0].role === '');
const N3 = await mk('new3'); const rid4 = (await as(N3, `select request_to_join($1,$2) id`, [cCam, tCam]))[0].id;
await as(ADM, `select decide_join_request($1,false)`, [rid4]);
ok('declining makes no member and no row', (await db.query(`select 1 from members where account_id=$1`, [N3])).rows.length === 0 && (await rowOf(N3)).length === 0);
ok('they can see it was declined, and ask again', (await as(N3, `select my_join_requests() r`))[0].r[0]?.status === 'declined' && !(await fails(N3, `select request_to_join($1,$2)`, [cCam, tCam])));
const mine3 = (await as(N3, `select my_join_requests() r`))[0].r; const wid = mine3.find(x => x.status === 'pending').id;
await as(N3, `select withdraw_join_request($1)`, [wid]);
ok('withdrawing removes it from both lists', (await listFor(O)).length === 0 && (await as(N3, `select my_join_requests() r`))[0].r.every(x => x.status !== 'pending'));
ok('only the owner of a request can withdraw it', await fails(N2, `select withdraw_join_request($1)`, [wid]));

// ---- no duplicate when a row with the same email already exists
await as(O, `insert into cast_crew_rows (project_id, team_id, kind, name, role) values ($1,$2,'crew','Dana Lee','Gaffer') returning id`, [pid, tCam]);
const dana = (await db.query(`select id from cast_crew_rows where name='Dana Lee'`)).rows[0].id;
await as(O, `insert into cast_crew_contacts (row_id, project_id, email) values ($1,$2,'dana@example.com')`, [dana, pid]);
const D = await mk('dana'); const cc = await code(tCam);
const rd = (await as(D, `select request_to_join($1,$2,'Grip') id`, [cc, tCam]))[0].id; await as(HC, `select decide_join_request($1,true)`, [rd]);
const danaRows = await rowOf(D);
ok('an existing row with the same email is linked, not duplicated', danaRows.length === 1 && danaRows[0].id === dana);
ok('and keeps its role', danaRows[0].role === 'Gaffer');

// ---- clean-up
await db.query(`delete from auth.users where id=$1`, [N3]);
ok('deleting an account removes its requests', (await db.query(`select 1 from join_requests where account_id=$1`, [N3])).rows.length === 0);
ok('deleting a project with requests works', await (async () => { const p3 = (await as(O, `select create_project('Gone') id`))[0].id; const t3 = (await as(O, `select id from teams where project_id=$1 limit 1`, [p3]))[0].id; const c3 = await code(t3); await as(X, `select request_to_join($1,$2)`, [c3, t3]); return (await as(O, `delete from projects where id=$1 returning id`, [p3])).length === 1 })());
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
