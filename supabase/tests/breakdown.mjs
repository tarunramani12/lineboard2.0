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

const [O, ART, ART2, CAM, R, X] = await Promise.all(['owner', 'art', 'art2', 'camera', 'reader', 'outsider'].map(mkUser));
const pid = (await as(O, `select create_project('Breakdown') as id`))[0].id;
const team = async (n) => (await as(O, `select id from teams where project_id=$1 and name=$2`, [pid, n]))[0].id;
const [tArt, tCam, tSound] = [await team('Art'), await team('Camera'), await team('Sound')];
const join = async (u, email, t) => { await as(O, `insert into invites (project_id, team_id, email, invited_by) values ($1,$2,$3,$4)`, [pid, t, email, O]); await as(u, `select * from accept_pending_invites()`); };
await join(ART, 'art@example.com', tArt); await join(ART2, 'art2@example.com', tArt); await join(CAM, 'camera@example.com', tCam); await join(R, 'reader@example.com', tSound);
const mid = async (u) => (await as(O, `select id from members where account_id=$1`, [u]))[0].id;
await as(O, `update team_section_access set level='edit' where section='breakdown' and team_id in ($1,$2)`, [tArt, tCam]);
await as(O, `update team_section_access set level='view' where section='breakdown' and team_id=$1`, [tSound]);
await as(O, `update member_teams set can_edit=true where member_id in ($1,$2)`, [await mid(ART), await mid(CAM)]);
// ART2 is on Art but has no edit grant; R only views

const sc = (await as(O, `insert into scenes (project_id, display_number, heading, sort_order) values ($1,'1','INT. KITCHEN - DAY',10) returning id`, [pid]))[0].id;
const item = (u, team_id, cat, name, qty = 1) => as(u, `insert into breakdown_items (project_id, scene_id, team_id, category, name, quantity) values ($1,$2,$3,$4,$5,$6) returning id`, [pid, sc, team_id, cat, name, qty]);

// ---- elements: creating
ok('an editor adds an element owned by their team', !(await fails(ART, `insert into breakdown_items (project_id, scene_id, team_id, category, name) values ($1,$2,$3,'props','Kettle')`, [pid, sc, tArt])));
ok('a member without an edit grant cannot add', await fails(ART2, `insert into breakdown_items (project_id, scene_id, team_id, category, name) values ($1,$2,$3,'props','Cup')`, [pid, sc, tArt]));
ok('cannot add for a team you do not edit for', await fails(ART, `insert into breakdown_items (project_id, scene_id, team_id, category, name) values ($1,$2,$3,'props','Cup')`, [pid, sc, tCam]));
ok('view-only team cannot add', await fails(R, `insert into breakdown_items (project_id, scene_id, team_id, category, name) values ($1,$2,$3,'props','Cup')`, [pid, sc, tSound]));
ok('outsider cannot add', await fails(X, `insert into breakdown_items (project_id, scene_id, team_id, category, name) values ($1,$2,$3,'props','Cup')`, [pid, sc, tArt]));
ok('anonymous cannot add', await fails(null, `insert into breakdown_items (project_id, scene_id, team_id, category, name) values ($1,$2,$3,'props','Cup')`, [pid, sc, tArt]));
ok('the owner can add for any team', !(await fails(O, `insert into breakdown_items (project_id, scene_id, team_id, category, name) values ($1,$2,$3,'wardrobe','Red coat')`, [pid, sc, tArt])));
ok('a blank name is refused', await fails(ART, `insert into breakdown_items (project_id, scene_id, team_id, category, name) values ($1,$2,$3,'props','   ')`, [pid, sc, tArt]));
ok('an unknown category is refused', await fails(ART, `insert into breakdown_items (project_id, scene_id, team_id, category, name) values ($1,$2,$3,'cakes','x')`, [pid, sc, tArt]));
ok('a prop quantity of 0 is refused', await fails(ART, `insert into breakdown_items (project_id, scene_id, team_id, category, name, quantity) values ($1,$2,$3,'props','x',0)`, [pid, sc, tArt]));
ok('an equipment quantity of 0 is allowed (listed, not counted)', !(await fails(CAM, `insert into breakdown_items (project_id, scene_id, team_id, category, name, quantity) values ($1,$2,$3,'equipment','Dolly',0)`, [pid, sc, tCam])));
ok('only crew can name a whole department', await fails(ART, `insert into breakdown_items (project_id, scene_id, team_id, category, name, ref_team_id) values ($1,$2,$3,'props','Camera',$4)`, [pid, sc, tArt, tCam]));
ok('crew can include a whole department', !(await fails(ART, `insert into breakdown_items (project_id, scene_id, team_id, category, name, ref_team_id) values ($1,$2,$3,'crew','Camera',$4)`, [pid, sc, tArt, tCam])));
ok('a scene of another project is refused', await fails(O, `insert into breakdown_items (project_id, scene_id, team_id, category, name) values ($1,$2,$3,'props','x')`, [pid, '00000000-0000-0000-0000-000000000000', tArt]));
const kettle = (await as(ART, `select id from breakdown_items where name='Kettle'`))[0].id;
ok('the creator is recorded', (await as(O, `select created_by cb from breakdown_items where id=$1`, [kettle]))[0].cb === ART);

// ---- reading
ok('owner reads', (await as(O, `select * from breakdown_items`)).length >= 4);
ok('a team with view access reads', (await as(R, `select * from breakdown_items`)).length >= 4);
ok('outsider reads nothing', (await as(X, `select * from breakdown_items`)).length === 0);
await as(O, `update team_section_access set level='none' where section='breakdown' and team_id=$1`, [tSound]);
ok('a team with no access reads nothing', (await as(R, `select * from breakdown_items`)).length === 0);
await as(O, `update team_section_access set level='view' where section='breakdown' and team_id=$1`, [tSound]);

// ---- editing
ok('the owning team edits its element', (await as(ART, `update breakdown_items set quantity=2, notes='Steel' where id=$1 returning id`, [kettle])).length === 1);
ok('another team cannot edit it', (await as(CAM, `update breakdown_items set quantity=5 where id=$1 returning id`, [kettle])).length === 0);
ok('a view-only team cannot edit it', (await as(R, `update breakdown_items set quantity=5 where id=$1 returning id`, [kettle])).length === 0);
ok('scene, kind and creator never change', await fails(ART, `update breakdown_items set category='wardrobe' where id=$1`, [kettle]) && await fails(ART, `update breakdown_items set scene_id=gen_random_uuid() where id=$1`, [kettle]));
ok('a team editor cannot hand the element to another team', await fails(ART, `update breakdown_items set team_id=$2 where id=$1`, [kettle, tCam]));
ok('the owner can move it to another team', !(await fails(O, `update breakdown_items set team_id=$2 where id=$1`, [kettle, tCam])));
ok('after the move the new team edits it', (await as(CAM, `update breakdown_items set notes='moved' where id=$1 returning id`, [kettle])).length === 1);
ok('and the old team no longer can', (await as(ART, `update breakdown_items set notes='back' where id=$1 returning id`, [kettle])).length === 0);

// ---- deleting
ok('another team cannot delete it', (await as(ART, `delete from breakdown_items where id=$1 returning id`, [kettle])).length === 0);
ok('the owning team deletes it', (await as(CAM, `delete from breakdown_items where id=$1 returning id`, [kettle])).length === 1);

// ---- the scene form
ok('any editor fills in the scene form', !(await fails(ART, `insert into breakdown_scenes (scene_id, project_id, location, story_date, synopsis) values ($1,$2,'Kitchen','Day 3','Anna waits')`, [sc, pid])));
ok('another team editor updates it', (await as(CAM, `update breakdown_scenes set notes='Check rain' where scene_id=$1 returning scene_id`, [sc])).length === 1);
ok('a view-only person cannot update it', (await as(R, `update breakdown_scenes set notes='x' where scene_id=$1 returning scene_id`, [sc])).length === 0);
ok('a member without an edit grant cannot update it', (await as(ART2, `update breakdown_scenes set notes='x' where scene_id=$1 returning scene_id`, [sc])).length === 0);
ok('an outsider reads no scene forms', (await as(X, `select * from breakdown_scenes`)).length === 0);
ok('a viewer reads the scene form', (await as(R, `select * from breakdown_scenes`)).length === 1);
ok('the editor is recorded', (await as(O, `select updated_by ub from breakdown_scenes where scene_id=$1`, [sc]))[0].ub === CAM);
ok('a form cannot be moved to another scene', await fails(ART, `update breakdown_scenes set scene_id=gen_random_uuid() where scene_id=$1`, [sc]));

// ---- scenes going away
const sc2 = (await as(O, `insert into scenes (project_id, display_number, heading, sort_order) values ($1,'2','EXT. STREET - DAY',20) returning id`, [pid]))[0].id;
await as(O, `insert into breakdown_items (project_id, scene_id, team_id, category, name) values ($1,$2,$3,'props','Car')`, [pid, sc2, tArt]);
await as(O, `delete from scenes where id=$1`, [sc2]);
ok('deleting an unlocked scene removes its elements', (await as(O, `select * from breakdown_items where name='Car'`)).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
