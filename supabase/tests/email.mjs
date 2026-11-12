import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth;
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
const svc = async (sql, p = []) => { await db.exec('set role service_role'); try { return (await db.query(sql, p)).rows } finally { await db.exec('reset role') } };
const outbox = (w = '') => q(`select * from email_outbox ${w} order by created_at, to_email`);
// ---- sending identity
ok('a new project has no sending id yet', (await q(`select mail_id from projects where id=$1`, [pid]))[0].mail_id === null);
ok('the owner can set an id, name and reply address', !(await fails(O, `select set_mail_identity($1,'Bakery-At-Night','Bakery at Night','me@real.example')`, [pid])));
const pr = (await q(`select mail_id, mail_name, reply_to from projects where id=$1`, [pid]))[0];
ok('the id is stored in lower case', pr.mail_id === 'bakery-at-night' && pr.mail_name === 'Bakery at Night' && pr.reply_to === 'me@real.example');
ok('an admin cannot change it', await fails(ADM, `select set_mail_identity($1,'other-id','x','')`, [pid], 'not_allowed'));
ok('a member cannot change it', await fails(MEM, `select set_mail_identity($1,'other-id','x','')`, [pid], 'not_allowed'));
ok('an outsider cannot change it', await fails(X, `select set_mail_identity($1,'other-id','x','')`, [pid], 'not_allowed'));
ok('the id cannot change again within 7 days', await fails(O, `select set_mail_identity($1,'second-name','x','')`, [pid], 'mail_id_changed_recently'));
ok('the name and reply can change any time', !(await fails(O, `select set_mail_identity($1,'bakery-at-night','New name','')`, [pid])));
for (const bad of ['ab', '-bad-', 'has space', 'x'.repeat(31), 'under_score', 'caf\u00e9']) ok(`refused id "${bad.slice(0, 12)}"`, await fails(O, `select set_mail_identity($1,$2,'','')`, [pid, bad], 'mail_id_format'));
for (const bad of ['support', 'Admin', 'no-reply', 'line-board', 'netflix', 'postmaster']) ok(`reserved id "${bad}" refused`, await fails(O, `select set_mail_identity($1,$2,'','')`, [pid, bad], 'mail_id_reserved'));
ok('a bad reply address is refused', await fails(O, `select set_mail_identity($1,'bakery-at-night','','not an address')`, [pid], 'reply_format'));
const pid2 = (await as(HC, `select create_project('Second') id`))[0].id;
ok('an id used by another project is refused', await fails(HC, `select set_mail_identity($1,'bakery-at-night','','')`, [pid2], 'mail_id_taken'));
ok('a free id works on another project', !(await fails(HC, `select set_mail_identity($1,'second-film','','')`, [pid2])));
ok('clearing the id is allowed', !(await fails(HC, `select set_mail_identity($1,'','','')`, [pid2])));
ok('direct writes to the identity columns are blocked', await fails(O, `update projects set mail_id='sneaky-id' where id=$1`, [pid]));
ok('email_paused cannot be set by the owner', await fails(O, `update projects set email_paused=true where id=$1`, [pid]));

// ---- queue from join requests: team with a HOD
await q(`delete from email_outbox`);
await as(N1, `select request_to_join($1,$2,'Focus puller')`, [cCam, tCam]);
let rows = await outbox();
ok('a request to a team with a head emails only the head', rows.length === 1 && rows[0].to_email === 'camhod@example.com' && rows[0].kind === 'join_request');
ok('the email data names the project, team and person', rows[0].payload.project === 'Join' && rows[0].payload.team === 'Camera' && rows[0].payload.person === 'new1' && rows[0].payload.role === 'Focus puller');
// team without a HOD: owner and admins
await db.query(`update member_teams set is_hod=false where team_id=$1`, [tCam]);
await q(`delete from email_outbox`);
await as(N2, `select request_to_join($1,$2,'')`, [cCam, tCam]);
rows = await outbox();
ok('a team without a head sends to the owner and the admins', rows.map(r => r.to_email).sort().join() === 'admin@example.com,owner@example.com');
ok('a request never emails the person who sent it', !rows.some(r => r.to_email === 'new2@example.com'));
// decision
await q(`delete from email_outbox`);
const reqId = (await as(O, `select list_join_requests($1) r`, [pid]))[0].r.find(x => x.name === 'new1').id;
await as(O, `select decide_join_request($1,true)`, [reqId]);
rows = await outbox();
ok('approving emails the requester', rows.length === 1 && rows[0].to_email === 'new1@example.com' && rows[0].kind === 'join_decision' && rows[0].payload.approved === true);
await q(`delete from email_outbox`);
const reqId2 = (await as(O, `select list_join_requests($1) r`, [pid]))[0].r.find(x => x.name === 'new2').id;
await as(O, `select decide_join_request($1,false)`, [reqId2]);
rows = await outbox();
ok('declining emails the requester too', rows.length === 1 && rows[0].to_email === 'new2@example.com' && rows[0].payload.approved === false);
await q(`delete from email_outbox`);

// ---- who can read and write the outbox
await q(`insert into email_outbox (project_id, kind, to_email) values ($1,'test','a@example.com')`, [pid]);
ok('the owner can read the project outbox', (await as(O, `select * from email_outbox`)).length === 1);
ok('an admin can read the project outbox', (await as(ADM, `select * from email_outbox`)).length === 1);
ok('a member cannot read the outbox', (await as(MEM, `select * from email_outbox`)).length === 0);
ok('an outsider cannot read the outbox', (await as(X, `select * from email_outbox`)).length === 0);
ok('nobody can insert into the outbox', await fails(O, `insert into email_outbox (project_id, kind, to_email) values ($1,'test','b@example.com')`, [pid]));
ok('nobody can edit the outbox', await fails(O, `update email_outbox set status='sent'`));
ok('signed-in users cannot claim', await fails(O, `select * from claim_outbox(5)`));
ok('signed-in users cannot finish', await fails(O, `select finish_outbox(gen_random_uuid(), true)`));
ok('the public cannot queue email directly', await fails(O, `select queue_email($1,'test','a@example.com','{}')`, [pid]));
await q(`delete from email_outbox`);

// ---- claiming, caps, retry
const add = async (n, p = pid) => { for (let i = 0; i < n; i++) await q(`insert into email_outbox (project_id, kind, to_email) values ($1,'test',$2)`, [p, `u${i}@example.com`]); };
await add(3);
let c = await svc(`select * from claim_outbox(10)`);
ok('claim returns waiting rows and marks them sending', c.length === 3 && c.every(r => r.status === 'sending' && r.attempts === 1));
ok('a second claim finds nothing', (await svc(`select * from claim_outbox(10)`)).length === 0);
await svc(`select finish_outbox($1,true,'prov-1','')`, [c[0].id]);
const done = (await outbox(`where id='${c[0].id}'`))[0];
ok('success marks the row sent with the provider id', done.status === 'sent' && done.provider_id === 'prov-1' && done.sent_at);
await svc(`select finish_outbox($1,false,null,'boom')`, [c[1].id]);
const retry = (await outbox(`where id='${c[1].id}'`))[0];
ok('a failure goes back in the queue to try later', retry.status === 'queued' && retry.last_error === 'boom' && new Date(retry.next_try_at) > new Date());
ok('a row waiting for its retry time is not claimed', (await svc(`select * from claim_outbox(10)`)).length === 0);
await q(`update email_outbox set next_try_at = now() - interval '1 minute' where id=$1`, [c[1].id]);
for (let i = 0; i < 3; i++) { const cc = await svc(`select * from claim_outbox(10)`); ok(`retry ${i + 1} claims it again`, cc.length === 1 && cc[0].id === c[1].id); await svc(`select finish_outbox($1,false,null,'again')`, [c[1].id]); await q(`update email_outbox set next_try_at = now() - interval '1 minute' where id=$1 and status='queued'`, [c[1].id]); }
ok('after four tries the row is marked failed', (await outbox(`where id='${c[1].id}'`))[0].status === 'failed');
ok('finishing a row twice changes nothing', (await svc(`select finish_outbox($1,true,'x','')`, [c[0].id]), (await outbox(`where id='${c[0].id}'`))[0].provider_id === 'prov-1'));
await q(`update email_outbox set status='sent', sent_at = now() - interval '2 days'`);

// per-project cap: 40 a day
await q(`delete from email_outbox`);
await add(45);
c = await svc(`select * from claim_outbox(100)`);
ok('batch size is respected', c.length === 100 || c.length <= 40);
let used = (await q(`select count(*)::int n from email_outbox where status='sending'`))[0].n;
ok('a project sends at most 40 a day', used === 40);
const left = (await q(`select count(*)::int n, min(next_try_at) t from email_outbox where status='queued'`))[0];
ok('the rest wait until tomorrow', left.n === 5 && new Date(left.t) > new Date());
// app-wide cap: 80 a day
await q(`delete from email_outbox`);
const projs = []; for (let i = 0; i < 3; i++) projs.push((await as(O, `select create_project('Cap ${i}') id`))[0].id);
for (const p of projs) await add(35, p);
await svc(`select * from claim_outbox(100)`);
ok('the whole app sends at most 80 a day', (await q(`select count(*)::int n from email_outbox where status='sending'`))[0].n === 80);
// paused project
await q(`delete from email_outbox`);
await db.query(`select set_config('request.jwt.claim.sub','',false)`); await db.query(`update projects set email_paused=true where id=$1`, [pid]);
await add(2);
ok('a paused project sends nothing', (await svc(`select * from claim_outbox(10)`)).length === 0);
await db.query(`update projects set email_paused=false where id=$1`, [pid]);
// project delete removes its queue
await q(`delete from email_outbox`); await add(2, projs[0]);
await as(O, `delete from projects where id=$1`, [projs[0]]);
ok('deleting a project removes its queued email', (await outbox(`where project_id='${projs[0]}'`)).length === 0);

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
