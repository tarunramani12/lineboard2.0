import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const MIGRATIONS = process.argv.slice(2);
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
for (const f of MIGRATIONS) await db.exec(fs.readFileSync(f, 'utf8'));

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); };

async function as(uid, sql, params = []) {
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec('reset role'); }
}
async function fails(uid, sql, params = [], match) {
  try { await as(uid, sql, params); return false; }
  catch (e) { return match ? String(e.message).includes(match) : true; }
}
const mkUser = async (name) => (await db.query(
  `insert into auth.users (email) values ($1) returning id`, [`${name}@example.com`])).rows[0].id;

const [O, A, H, E, M, S, X] = await Promise.all(['owner', 'admin', 'hod', 'editor', 'member', 'sound', 'outsider'].map(mkUser));

// ---- create project
const pid = (await as(O, `select create_project('The Last Ferry') as id`))[0].id;
const teams = await as(O, `select id, name, is_ad_team from teams where project_id=$1`, [pid]);
ok('project gets 10 default teams', teams.length === 10);
ok('Direction flagged as AD team', teams.find(t => t.name === 'Direction').is_ad_team);
const cam = teams.find(t => t.name === 'Camera').id;
const snd = teams.find(t => t.name === 'Sound').id;
const defaults = await as(O, `select section, level from team_section_access where team_id=$1`, [cam]);
ok('defaults: view schedule/call sheets/cast, none elsewhere',
  defaults.length === 7 && defaults.every(d =>
    ['schedule', 'call_sheets', 'cast_crew'].includes(d.section) ? d.level === 'view' : d.level === 'none'));

// ---- invite admin by email, accept
await as(O, `insert into invites (project_id, team_id, email, invited_by) values ($1,$2,'admin@example.com',$3)`, [pid, cam, O]);
ok('invite accepted for matching email', (await as(A, `select * from accept_pending_invites()`)).length === 1);
ok('owner promotes to admin', (await as(O, `update members set role='admin' where project_id=$1 and account_id=$2 returning id`, [pid, A])).length === 1);
await as(O, `insert into invites (project_id, team_id, email, invited_by) values ($1,$2,'editor@example.com',$3)`, [pid, cam, O]);
await as(E, `select * from accept_pending_invites()`);
ok('admin cannot promote a member to admin', await fails(A, `update members set role='admin' where project_id=$1 and account_id=$2`, [pid, E], 'Only the owner'));
await as(O, `delete from members where project_id=$1 and account_id=$2`, [pid, E]);

// ---- HOD via invite, appointed by owner
await as(O, `insert into invites (project_id, team_id, email, invited_by) values ($1,$2,'hod@example.com',$3)`, [pid, cam, O]);
await as(H, `select * from accept_pending_invites()`);
const hodMember = (await as(O, `select id from members where account_id=$1`, [H]))[0].id;
ok('non-HOD cannot appoint themselves HOD', (await as(H, `update member_teams set is_hod=true where member_id=$1 returning 1`, [hodMember]).catch(() => [])).length === 0);
await as(O, `update member_teams set is_hod=true where member_id=$1`, [hodMember]);

// ---- join codes by HOD
const code = (await as(H, `insert into join_codes (team_id, created_by) values ($1,$2) returning code`, [cam, H]))[0].code;
ok('HOD cannot make a code for another team', await fails(H, `insert into join_codes (team_id) values ($1)`, [snd]));
await as(E, `select redeem_join_code($1)`, [code]);
await as(M, `select redeem_join_code($1)`, [code.toLowerCase()]);
const editorMember = (await as(O, `select id from members where account_id=$1`, [E]))[0].id;
const memberMember = (await as(O, `select id from members where account_id=$1`, [M]))[0].id;
ok('HOD cannot appoint another HOD', await fails(H, `update member_teams set is_hod=true where member_id=$1`, [editorMember], 'Only the owner or an admin'));
ok('code joiner is a read-only member', (await as(O, `select role from members where id=$1`, [memberMember]))[0].role === 'member');
ok('code not found is specific', await fails(X, `select redeem_join_code('ZZZZZZZZ')`, [], 'code_not_found'));
await as(O, `update join_codes set revoked_at=now() where code=$1`, [code]);
ok('revoked code is specific', await fails(X, `select redeem_join_code($1)`, [code], 'code_revoked'));
const code2 = (await as(H, `insert into join_codes (team_id, expires_at) values ($1, now() - interval '1 day') returning code`, [cam]))[0].code;
ok('expired code is specific', await fails(X, `select redeem_join_code($1)`, [code2], 'code_expired'));
ok('member cannot read join codes', (await as(M, `select * from join_codes`)).length === 0);
ok('HOD cannot invite into another team', await fails(H, `insert into invites (project_id, team_id, email) values ($1,$2,'a@b.c')`, [pid, snd]));
ok('HOD can invite into own team', !(await fails(H, `insert into invites (project_id, team_id, email, invited_by) values ($1,$2,'newcrew@example.com',$3)`, [pid, cam, H])));

// ---- outsider sees nothing
for (const t of ['projects', 'teams', 'members', 'scenes', 'team_section_access', 'member_teams', 'invites', 'script_versions', 'scene_access'])
  ok(`outsider reads 0 rows from ${t}`, (await as(X, `select * from ${t}`)).length === 0);
ok('outsider cannot add a scene', await fails(X, `insert into scenes (project_id, display_number) values ($1,'1')`, [pid]));
ok('outsider cannot add themselves as member', await fails(X, `insert into members (project_id, account_id) values ($1,$2)`, [pid, X]));
ok('anonymous cannot create a project', await fails(null, `select create_project('x')`));
ok('anonymous cannot read projects', await fails(null, `select * from projects`));

// ---- permission matrix & edit grants
ok('member cannot add a scene (script access none)', await fails(M, `insert into scenes (project_id, display_number) values ($1,'1')`, [pid]));
ok('member cannot change team access', (await as(M, `update team_section_access set level='edit' where team_id=$1 returning 1`, [cam])).length === 0);
await as(O, `update team_section_access set level='edit' where team_id=$1 and section='script'`, [cam]);
ok('edit level alone is not enough for a plain member', await fails(M, `insert into scenes (project_id, display_number) values ($1,'1')`, [pid]));
ok('edit level alone is not enough for an ungranted editor', await fails(E, `insert into scenes (project_id, display_number) values ($1,'1')`, [pid]));
ok('HOD grants edit access to own team member', (await as(H, `update member_teams set can_edit=true where member_id=$1 returning 1`, [editorMember])).length === 1);
ok('granted editor can add a scene', !(await fails(E, `insert into scenes (project_id, display_number, heading) values ($1,'1','INT. KITCHEN - DAY')`, [pid])));
ok('member without grant still cannot', await fails(M, `insert into scenes (project_id, display_number) values ($1,'2')`, [pid]));
ok('HOD can add a scene', !(await fails(H, `insert into scenes (project_id, display_number) values ($1,'2')`, [pid])));
ok('everyone on the project can read scene number and heading', (await as(M, `select * from scenes`)).length === 2);
ok('ungranted member cannot grant edit access', (await as(M, `update member_teams set can_edit=true where member_id=$1 returning 1`, [memberMember])).length === 0);

// ---- scene locking
ok('admin cannot lock the script', await fails(A, `update projects set script_locked=true where id=$1`, [pid]));
await as(O, `update projects set script_locked=true where id=$1`, [pid]);
ok('locked: scene number cannot change', await fails(E, `update scenes set display_number='9' where display_number='1'`, [], 'locked'));
ok('locked: heading can still change', (await as(E, `update scenes set heading='INT. KITCHEN - NIGHT' where display_number='1' returning 1`)).length === 1);
ok('locked: scene cannot be deleted', await fails(E, `delete from scenes where display_number='1'`, [], 'locked'));
ok('locked: inserted scene gets a letter', !(await fails(E, `insert into scenes (project_id, display_number) values ($1,'1A')`, [pid])));
ok('locked: scene can be marked omitted', (await as(E, `update scenes set status='omitted' where display_number='2' returning 1`)).length === 1);
await as(O, `update projects set script_locked=false where id=$1`, [pid]);
ok('owner can unlock and renumber', (await as(E, `update scenes set display_number='3' where display_number='2' returning 1`)).length === 1);

// ---- scene text access
const sid = (await as(O, `select id from scenes where display_number='1'`))[0].id;
const sid2 = (await as(O, `select id from scenes where display_number='3'`))[0].id;
ok('member cannot read scene text by default', (await as(M, `select can_read_scene_text($1) as v`, [sid]))[0].v === false);
ok('owner can read scene text', (await as(O, `select can_read_scene_text($1) as v`, [sid]))[0].v === true);
await as(O, `insert into scene_access (member_id, mode) values ($1,'selected') on conflict (member_id) do update set mode='selected'`, [memberMember]);
await as(O, `insert into scene_access_scenes values ($1,$2)`, [memberMember, sid]);
ok('selected scene readable', (await as(M, `select can_read_scene_text($1) as v`, [sid]))[0].v === true);
ok('other scene still hidden', (await as(M, `select can_read_scene_text($1) as v`, [sid2]))[0].v === false);
ok('member cannot grant themselves script access', await fails(M, `insert into scene_access_scenes values ($1,$2)`, [memberMember, sid2]));
ok('member cannot change own script access', (await as(M, `update scene_access set mode='all' where member_id=$1 returning 1`, [memberMember])).length === 0);

// ---- people and privacy
ok('member cannot read others\' email', (await as(M, `select * from profile_private`)).length === 1);
ok('member sees names of project people', (await as(M, `select * from profiles`)).length >= 4);
ok('outsider sees only own profile', (await as(X, `select * from profiles`)).length === 1);
ok('owner row cannot be deleted', await fails(O, `delete from members where role='owner'`));
ok('admin cannot delete the project', (await as(A, `delete from projects where id=$1 returning 1`, [pid])).length === 0);
ok('member can leave the project', (await as(M, `delete from members where id=$1 returning 1`, [memberMember])).length === 1);
ok('...and then sees nothing', (await as(M, `select * from projects`)).length === 0);
ok('member row cannot be moved to another project', await fails(O, `update members set project_id=gen_random_uuid() where id=$1`, [editorMember]));

// ---- a second project is invisible to the first project's people
const pid2 = (await as(X, `select create_project('Other film') as id`))[0].id;
ok('other project invisible to owner of first', (await as(O, `select * from projects where id=$1`, [pid2])).length === 0);
ok('owner cannot add scenes to the other project', await fails(O, `insert into scenes (project_id, display_number) values ($1,'1')`, [pid2]));

// ---- deleting a whole project (owner) removes everything, even with an admin and members on it
const pid3 = (await as(O, `select create_project('To delete') as id`))[0].id;
const cam3 = (await as(O, `select id from teams where project_id=$1 and name='Camera'`, [pid3]))[0].id;
const c3 = (await as(O, `insert into join_codes (team_id) values ($1) returning code`, [cam3]))[0].code;
await as(M, `select redeem_join_code($1)`, [c3]);
ok('owner can delete a project that has other members', (await as(O, `delete from projects where id=$1 returning 1`, [pid3])).length === 1);
ok('...and its members and teams are gone', (await db.query(`select (select count(*) from members where project_id=$1)::int + (select count(*) from teams where project_id=$1)::int as n`, [pid3])).rows[0].n === 0);
ok('owner row still cannot be removed from a live project', await fails(O, `delete from members where role='owner' and project_id=$1`, [pid], 'owner cannot be removed'));

// ---- account deletion
ok('owner cannot delete their account while owning a project', await fails(O, `select delete_my_account()`, [], 'You own a project'));
ok('anonymous cannot delete accounts', await fails(null, `select delete_my_account()`));
await as(E, `select delete_my_account()`);
ok('deleted account leaves a Former member row', (await as(O, `select count(*)::int as n from members where project_id=$1 and account_id is null`, [pid]))[0].n === 1);
ok('deleted account profile is gone', (await db.query(`select count(*)::int as n from profiles where id=$1`, [E])).rows[0].n === 0);
ok('their edit grant row stays for the HOD to reassign', (await as(O, `select count(*)::int as n from member_teams where member_id=$1`, [editorMember]))[0].n === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
