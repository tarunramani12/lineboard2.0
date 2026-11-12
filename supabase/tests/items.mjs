import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;`);
for (const f of process.argv.slice(2)) await db.exec(fs.readFileSync(f, 'utf8'));
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); };
async function as(uid, sql, p = []) { await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`); await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [uid ?? '']); try { return (await db.query(sql, p)).rows } finally { await db.exec('reset role') } }
const fails = async (u, sql, p = []) => { try { await as(u, sql, p); return false } catch { return true } };
const mk = async (n) => (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1,$2) returning id`, [`${n}@example.com`, JSON.stringify({ display_name: n })])).rows[0].id;
const [O, ART, ART2, CAM, PROD, SND, X] = await Promise.all(['owner', 'art', 'art2', 'cam', 'prod', 'snd', 'outsider'].map(mk));
const pid = (await as(O, `select create_project('Items') id`))[0].id;
const team = async (n) => (await as(O, `select id from teams where project_id=$1 and name=$2`, [pid, n]))[0].id;
const [tArt, tCam, tProd, tSnd] = [await team('Art'), await team('Camera'), await team('Production'), await team('Sound')];
const join = async (u, e, t) => { await as(O, `insert into invites (project_id, team_id, email, invited_by) values ($1,$2,$3,$4)`, [pid, t, e, O]); await as(u, `select * from accept_pending_invites()`); };
await join(ART, 'art@example.com', tArt); await join(ART2, 'art2@example.com', tArt); await join(CAM, 'cam@example.com', tCam); await join(PROD, 'prod@example.com', tProd); await join(SND, 'snd@example.com', tSnd);
const lvl = (t, s, l) => db.query(`update team_section_access set level=$3 where team_id=$1 and section=$2`, [t, s, l]);
await lvl(tArt, 'props', 'edit'); await lvl(tCam, 'equipment', 'edit'); await lvl(tProd, 'props', 'edit'); await lvl(tProd, 'equipment', 'edit'); await lvl(tSnd, 'props', 'view');
await db.query(`update member_teams set can_edit=true where member_id in (select id from members where account_id in ($1,$2,$3))`, [ART, CAM, PROD]);
const sid = (await as(O, `insert into schedules (project_id, name, start_date, end_date) values ($1,'Block 1','2026-03-02','2026-03-13') returning id`, [pid]))[0].id;
const add = (u, kind, team, name = 'Lamp', extra = '') => as(u, `insert into schedule_items (project_id, schedule_id, kind, team_id, name ${extra ? ', ' + extra.split('=')[0] : ''}) values ($1,$2,$3,$4,$5 ${extra ? ', ' + extra.split('=')[1] : ''}) returning id`, [pid, sid, kind, team, name]);

ok('Art adds a prop for its team', (await add(ART, 'prop', tArt, 'Teapot')).length === 1);
ok('Art cannot add equipment (no access to that section)', await fails(ART, `insert into schedule_items (project_id, schedule_id, kind, team_id, name) values ($1,$2,'equipment',$3,'Dolly')`, [pid, sid, tArt]));
ok('Camera adds equipment but not props', (await add(CAM, 'equipment', tCam, 'Dolly')).length === 1 && await fails(CAM, `insert into schedule_items (project_id, schedule_id, kind, team_id, name) values ($1,$2,'prop',$3,'x')`, [pid, sid, tCam]));
ok('a member without an edit grant cannot add', await fails(ART2, `insert into schedule_items (project_id, schedule_id, kind, team_id, name) values ($1,$2,'prop',$3,'x')`, [pid, sid, tArt]));
ok('a view-only team cannot add', await fails(SND, `insert into schedule_items (project_id, schedule_id, kind, team_id, name) values ($1,$2,'prop',$3,'x')`, [pid, sid, tSnd]));
ok('cannot add for another team', await fails(ART, `insert into schedule_items (project_id, schedule_id, kind, team_id, name) values ($1,$2,'prop',$3,'x')`, [pid, sid, tProd]));
ok('an outsider cannot add or read', await fails(X, `insert into schedule_items (project_id, schedule_id, kind, team_id, name) values ($1,$2,'prop',$3,'x')`, [pid, sid, tArt]) && (await as(X, `select * from schedule_items`)).length === 0);
ok('a blank name is refused', await fails(ART, `insert into schedule_items (project_id, schedule_id, kind, team_id, name) values ($1,$2,'prop',$3,'  ')`, [pid, sid, tArt]));
ok('a quantity of 0 is refused', await fails(ART, `insert into schedule_items (project_id, schedule_id, kind, team_id, name, quantity) values ($1,$2,'prop',$3,'x',0)`, [pid, sid, tArt]));
ok('a schedule from another project is refused', await (async () => { const p2 = (await as(X, `select create_project('Other') id`))[0].id; const s2 = (await as(X, `insert into schedules (project_id, name, start_date, end_date) values ($1,'S','2026-01-01','2026-01-02') returning id`, [p2]))[0].id; return fails(ART, `insert into schedule_items (project_id, schedule_id, kind, team_id, name) values ($1,$2,'prop',$3,'x')`, [pid, s2, tArt]); })());

// reading follows the section
ok('Sound (view props) reads props but not equipment', (await as(SND, `select kind from schedule_items`)).every(r => r.kind === 'prop') && (await as(SND, `select * from schedule_items`)).length === 1);
ok('Camera (equipment edit, no props access) reads equipment only', (await as(CAM, `select kind from schedule_items`)).every(r => r.kind === 'equipment'));
ok('the owner reads both', (await as(O, `select * from schedule_items`)).length === 2);

// editing
const tea = (await as(ART, `select id from schedule_items where name='Teapot'`))[0].id;
ok('the owning team edits its item', (await as(ART, `update schedule_items set quantity=3, status='confirmed' where id=$1 returning id`, [tea])).length === 1);
ok('Production (other team, edit) cannot edit an Art item', (await as(PROD, `update schedule_items set quantity=9 where id=$1 returning id`, [tea])).length === 0);
ok('nor delete it', (await as(PROD, `delete from schedule_items where id=$1 returning id`, [tea])).length === 0);
ok('a team editor cannot move an item', await fails(ART, `update schedule_items set team_id=$2 where id=$1`, [tea, tProd]));
ok('the owner can move an item', !(await fails(O, `update schedule_items set team_id=$2 where id=$1`, [tea, tProd])) && !(await fails(O, `update schedule_items set team_id=$2 where id=$1`, [tea, tArt])));
ok('an item never changes list or schedule', await fails(O, `update schedule_items set kind='equipment' where id=$1`, [tea]));

// costs
const cost = (u, amt = 25) => as(u, `insert into schedule_item_costs (item_id, project_id, amount) values ($1,$2,$3) returning item_id`, [tea, pid, amt]);
ok('Art cannot read or set a cost', (await as(ART, `select * from schedule_item_costs`)).length === 0 && await fails(ART, `insert into schedule_item_costs (item_id, project_id, amount) values ($1,$2,5)`, [tea, pid]));
ok('Production sets a cost on an Art item', (await cost(PROD)).length === 1);
ok('Production, the owner read it; Art and an outsider do not', (await as(PROD, `select * from schedule_item_costs`)).length === 1 && (await as(O, `select * from schedule_item_costs`)).length === 1 && (await as(ART, `select * from schedule_item_costs`)).length === 0 && (await as(X, `select * from schedule_item_costs`)).length === 0);
ok('a negative cost is refused', await fails(O, `update schedule_item_costs set amount=-1 where item_id=$1`, [tea]));
ok('Production updates and removes it', (await as(PROD, `update schedule_item_costs set amount=30 where item_id=$1 returning item_id`, [tea])).length === 1 && (await as(PROD, `delete from schedule_item_costs where item_id=$1 returning item_id`, [tea])).length === 1);
ok('Sound (view only, not Production) cannot set a cost', await fails(SND, `insert into schedule_item_costs (item_id, project_id, amount) values ($1,$2,5)`, [tea, pid]));

// linked scenes
const sc = (await as(O, `insert into scenes (project_id, display_number, heading, sort_order) values ($1,'1','INT. A - DAY',10) returning id`, [pid]))[0].id;
ok('the owning team links a scene', (await as(ART, `insert into schedule_item_scenes (item_id, scene_id, project_id) values ($1,$2,$3) returning item_id`, [tea, sc, pid])).length === 1);
ok('another team cannot link or unlink', await fails(CAM, `insert into schedule_item_scenes (item_id, scene_id, project_id) values ($1,$2,$3)`, [tea, sc, pid]) && (await as(CAM, `delete from schedule_item_scenes where item_id=$1 returning item_id`, [tea])).length === 0);
ok('a scene from another project is refused', await (async () => { const p2 = (await db.query(`select id from projects where name='Other'`)).rows[0].id; const s2 = (await db.query(`insert into scenes (project_id, display_number, heading, sort_order) values ($1,'1','INT. B - DAY',10) returning id`, [p2])).rows[0].id; return fails(ART, `insert into schedule_item_scenes (item_id, scene_id, project_id) values ($1,$2,$3)`, [tea, s2, pid]); })());

// cascades
ok('deleting a schedule removes its items', await (async () => { await as(O, `delete from schedules where id=$1`, [sid]); return (await db.query(`select 1 from schedule_items`)).rows.length === 0; })());
ok('deleting a project with items works', await (async () => { const p3 = (await as(O, `select create_project('Gone') id`))[0].id; const s3 = (await as(O, `insert into schedules (project_id, name, start_date, end_date) values ($1,'S','2026-01-01','2026-01-02') returning id`, [p3]))[0].id; const t3 = (await as(O, `select id from teams where project_id=$1 limit 1`, [p3]))[0].id; await as(O, `insert into schedule_items (project_id, schedule_id, kind, team_id, name) values ($1,$2,'prop',$3,'Cup')`, [p3, s3, t3]); return (await as(O, `delete from projects where id=$1 returning id`, [p3])).length === 1; })());
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
