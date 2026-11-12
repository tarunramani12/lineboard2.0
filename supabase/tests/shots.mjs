// Shot list: who may read, create, edit, change status and delete, enforced in the database.
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

const names = ['owner', 'camera', 'camera2', 'vfx', 'sound', 'ad', 'reader', 'outsider'];
const [O, C, C2, V, N, D, R, X] = await Promise.all(names.map(mkUser));
const pid = (await as(O, `select create_project('Shots') as id`))[0].id;
const team = async (n) => (await as(O, `select id from teams where project_id=$1 and name=$2`, [pid, n]))[0].id;
const [tCam, tVfx, tSound, tDir, tArt] = [await team('Camera'), await team('VFX'), await team('Sound'), await team('Direction'), await team('Art')];
const join = async (u, email, t) => { await as(O, `insert into invites (project_id, team_id, email, invited_by) values ($1,$2,$3,$4)`, [pid, t, email, O]); await as(u, `select * from accept_pending_invites()`); };
await join(C, 'camera@example.com', tCam); await join(C2, 'camera2@example.com', tCam); await join(V, 'vfx@example.com', tVfx);
await join(N, 'sound@example.com', tSound); await join(D, 'ad@example.com', tDir); await join(R, 'reader@example.com', tArt);
const mid = async (u) => (await as(O, `select id from members where account_id=$1`, [u]))[0].id;
// access: Camera edits shots, VFX/Sound/Direction/Art view or edit as noted
await as(O, `update team_section_access set level='edit' where section='shots' and team_id in ($1,$2,$3)`, [tCam, tVfx, tSound]);
await as(O, `update team_section_access set level='view' where section='shots' and team_id in ($1,$2)`, [tDir, tArt]);
await as(O, `update member_teams set can_edit=true where member_id in ($1,$2,$3,$4)`, [await mid(C), await mid(V), await mid(N), await mid(D)]);
// C2 is on the Camera team but has no edit grant

const sc = (await as(O, `insert into scenes (project_id, display_number, heading, sort_order) values ($1,'1','INT. KITCHEN - DAY',10) returning id`, [pid]))[0].id;
const sc2 = (await as(O, `insert into scenes (project_id, display_number, heading, sort_order) values ($1,'2','EXT. STREET - DAY',20) returning id`, [pid]))[0].id;
const ins = (u, team_id, extra = '') => as(u, `insert into shots (project_id, scene_id, team_id, position, description ${extra ? ', ' + extra.split('=')[0] : ''}) values ($1,$2,$3,10,'Wide of the kitchen' ${extra ? ', ' + extra.split('=')[1] : ''}) returning id`, [pid, sc, team_id]);

// ---- creating
ok('camera editor can add a shot owned by Camera', !(await fails(C, `insert into shots (project_id, scene_id, team_id, description) values ($1,$2,$3,'x')`, [pid, sc, tCam])));
ok('camera member without an edit grant cannot add a shot', await fails(C2, `insert into shots (project_id, scene_id, team_id, description) values ($1,$2,$3,'x')`, [pid, sc, tCam]));
ok('cannot add a shot for a team you do not edit for', await fails(C, `insert into shots (project_id, scene_id, team_id, description) values ($1,$2,$3,'x')`, [pid, sc, tSound]));
ok('view-only team cannot add a shot', await fails(D, `insert into shots (project_id, scene_id, team_id, description) values ($1,$2,$3,'x')`, [pid, sc, tDir]));
ok('outsider cannot add a shot', await fails(X, `insert into shots (project_id, scene_id, team_id, description) values ($1,$2,$3,'x')`, [pid, sc, tCam]));
ok('anonymous cannot add a shot', await fails(null, `insert into shots (project_id, scene_id, team_id, description) values ($1,$2,$3,'x')`, [pid, sc, tCam]));
ok('a shot cannot point at a scene of another project', await fails(O, `insert into shots (project_id, scene_id, team_id) values ($1,$2,$3)`, [pid, '00000000-0000-0000-0000-000000000000', tCam]));
ok('a new shot cannot start as done unless you may set status', await fails(C, `insert into shots (project_id, scene_id, team_id, status) values ($1,$2,$3,'done')`, [pid, sc, tCam], 'AD team'));
const shot = (await as(C, `select id from shots limit 1`))[0].id;
ok('the creator is recorded', (await as(O, `select created_by cb from shots where id=$1`, [shot]))[0].cb === C);

// ---- reading
ok('owner reads shots', (await as(O, `select * from shots`)).length === 1);
ok('a team with view access reads shots', (await as(D, `select * from shots`)).length === 1 && (await as(R, `select * from shots`)).length === 1);
ok('outsider reads no shots', (await as(X, `select * from shots`)).length === 0);
await as(O, `update team_section_access set level='none' where section='shots' and team_id=$1`, [tArt]);
ok('a team with no access to Shots reads none', (await as(R, `select * from shots`)).length === 0);
await as(O, `update team_section_access set level='view' where section='shots' and team_id=$1`, [tArt]);

// ---- editing fields
ok('owning team editor changes the description', (await as(C, `update shots set description='Wide, handheld' where id=$1 returning 1`, [shot])).length === 1);
ok('a team member without an edit grant cannot change it', await fails(C2, `update shots set description='nope' where id=$1`, [shot]) || (await as(C2, `update shots set description='nope' where id=$1 returning 1`, [shot])).length === 0);
ok('a view-only team cannot change it', await fails(D, `update shots set description='nope' where id=$1`, [shot], 'owning team'));
ok('VFX cannot change the description', await fails(V, `update shots set description='nope' where id=$1`, [shot], 'owning team'));
ok('VFX can fill in VFX required on a shot it does not own', (await as(V, `update shots set vfx_required='Remove the wire' where id=$1 returning 1`, [shot])).length === 1);
ok('VFX cannot fill in the Sound field', await fails(V, `update shots set sound_required='x' where id=$1`, [shot], 'Sound team'));
ok('Sound can fill in sound effects required', (await as(N, `update shots set sound_required='Kettle ticking' where id=$1 returning 1`, [shot])).length === 1);
ok('Sound cannot change VFX required', await fails(N, `update shots set vfx_required='x' where id=$1`, [shot], 'VFX team'));
ok('the owning team can also write the VFX field', (await as(C, `update shots set vfx_required='Remove the wire, please' where id=$1 returning 1`, [shot])).length === 1);
ok('last editor is recorded', (await as(O, `select updated_by u from shots where id=$1`, [shot]))[0].u === C);
ok('scene and project of a shot never change', await fails(C, `update shots set scene_id=$1 where id=$2`, [sc2, shot], 'never change'));
ok('text length limits hold', await fails(C, `update shots set size=$1 where id=$2`, ['x'.repeat(61), shot]));

// ---- status
ok('the camera team cannot change status', await fails(C, `update shots set status='done' where id=$1`, [shot], 'AD team'));
ok('an AD-team member with an edit grant can change status', (await as(D, `update shots set status='done' where id=$1 returning 1`, [shot])).length === 1);
ok('the owner can change status', (await as(O, `update shots set status='dropped' where id=$1 returning 1`, [shot])).length === 1);
ok('a reader cannot change status', await fails(R, `update shots set status='planned' where id=$1`, [shot]) || (await as(R, `update shots set status='planned' where id=$1 returning 1`, [shot])).length === 0);
await as(O, `update member_teams set can_edit=false where member_id=$1`, [await mid(D)]);
ok('an AD-team member without an edit grant cannot change status', await fails(D, `update shots set status='planned' where id=$1`, [shot]) || (await as(D, `update shots set status='planned' where id=$1 returning 1`, [shot])).length === 0);
await as(O, `update member_teams set can_edit=true where member_id=$1`, [await mid(D)]);

// ---- handing a shot to another team, and deleting
ok('the owning team cannot hand a shot to a team it cannot edit for', await fails(C, `update shots set team_id=$1 where id=$2`, [tDir, shot], 'hand a shot'));
ok('the owner can hand a shot to another team', (await as(O, `update shots set team_id=$1 where id=$2 returning 1`, [tSound, shot])).length === 1);
ok('after the hand-over the old team cannot edit it', await fails(C, `update shots set description='nope' where id=$1`, [shot]) || (await as(C, `update shots set description='nope' where id=$1 returning 1`, [shot])).length === 0);
ok('a team that does not own the shot cannot delete it', (await as(C, `delete from shots where id=$1 returning 1`, [shot])).length === 0);
ok('the owning team can delete it', (await as(N, `delete from shots where id=$1 returning 1`, [shot])).length === 1);

// ---- deleting a scene (draft) removes its shots
const sh2 = (await as(O, `insert into shots (project_id, scene_id, team_id) values ($1,$2,$3) returning id`, [pid, sc2, tCam]))[0].id;
await as(O, `delete from scenes where id=$1`, [sc2]);
ok('deleting an unlocked scene removes its shots', (await as(O, `select * from shots where id=$1`, [sh2])).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
