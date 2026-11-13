// Project bible: access defaults, who edits, aspect ratio on the project, moodboard rows and files, the shared image cap.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const files = process.argv.slice(2);
const [early, late] = [files.filter((f) => !/002[6789]_/.test(f)), files.filter((f) => /002[6789]_/.test(f))];
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
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`);
for (const f of early) await db.exec(fs.readFileSync(f, 'utf8'));

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
const [O, D, C, S, W, X] = await Promise.all(['owner', 'direction', 'camera', 'sound', 'viewer', 'outsider'].map(mkUser));

// a project made before the Project bible existed
const old = (await as(O, `select create_project('Before') as id`))[0].id;
for (const f of late) await db.exec(fs.readFileSync(f, 'utf8'));
const lvl = async (p, team) => (await db.query(`select a.level from team_section_access a join teams t on t.id=a.team_id where t.project_id=$1 and t.name=$2 and a.section='bible'`, [p, team])).rows[0]?.level;
const owners = async (p) => (await db.query(`select (select name from teams where id=bible_format_team) f, (select name from teams where id=bible_mood_team) m from projects where id=$1`, [p])).rows[0];
ok('an existing project: Camera owns the format, Direction owns the moodboard', JSON.stringify(await owners(old)) === JSON.stringify({ f: 'Camera', m: 'Direction' }));
ok('an existing project: Direction and Camera have the edit level, everyone else views', (await lvl(old, 'Direction')) === 'edit' && (await lvl(old, 'Camera')) === 'edit' && (await lvl(old, 'Sound')) === 'view' && (await lvl(old, 'Art')) === 'view');

const pid = (await as(O, `select create_project('Bible') as id`))[0].id;
ok('a new project: same owners', JSON.stringify(await owners(pid)) === JSON.stringify({ f: 'Camera', m: 'Direction' }));
ok('a new project: Direction and Camera edit level, every other team views', (await lvl(pid, 'Direction')) === 'edit' && (await lvl(pid, 'Camera')) === 'edit' && (await lvl(pid, 'Production')) === 'view' && (await lvl(pid, 'VFX')) === 'view');
ok('a new project starts at 16:9', (await as(O, `select aspect_ratio a from projects where id=$1`, [pid]))[0].a === '16:9');
ok('every team has the bible row', (await db.query(`select count(*)::int n from team_section_access where team_id in (select id from teams where project_id=$1) and section='bible'`, [pid])).rows[0].n === 10);

const team = async (n) => (await as(O, `select id from teams where project_id=$1 and name=$2`, [pid, n]))[0].id;
const [tDir, tCam, tSnd, tArt] = [await team('Direction'), await team('Camera'), await team('Sound'), await team('Art')];
const join = async (u, email, t) => { await as(O, `insert into invites (project_id, team_id, email, invited_by) values ($1,$2,$3,$4)`, [pid, t, email, O]); await as(u, `select * from accept_pending_invites()`); };
await join(D, 'direction@example.com', tDir); await join(C, 'camera@example.com', tCam); await join(S, 'sound@example.com', tSnd); await join(W, 'viewer@example.com', tArt);
const mid = async (u) => (await as(O, `select id from members where account_id=$1`, [u]))[0].id;
// a team's edit level alone is not enough: the head of department, or someone the head allows, is needed
ok('a Camera member without a grant cannot save the format yet', await fails(C, `insert into project_bible (project_id) values ($1)`, [pid]));
await as(O, `update member_teams set is_hod=true where member_id=$1`, [await mid(C)]);   // the DoP
await as(O, `update member_teams set is_hod=true where member_id=$1`, [await mid(D)]);   // the Director

// ---- Format: owned by Camera
ok('the DoP (Camera head of department) saves the format', (await as(C, `insert into project_bible (project_id, frame_rate, resolution) values ($1,'25','4K') returning 1`, [pid])).length === 1);
ok('the Direction head cannot change the format', (await as(D, `update project_bible set camera_format='Alexa' where project_id=$1 returning 1`, [pid])).length === 0);
ok('last editor is recorded', (await as(O, `select updated_by u from project_bible where project_id=$1`, [pid]))[0].u === C);
ok('a team given only view cannot change it', (await as(W, `update project_bible set notes='x' where project_id=$1 returning 1`, [pid])).length === 0);
ok('everyone on the project reads the format (view level)', (await as(W, `select * from project_bible`)).length === 1 && (await as(S, `select * from project_bible`)).length === 1);
ok('an outsider reads nothing', (await as(X, `select * from project_bible`)).length === 0);
ok('the owner edits the format', (await as(O, `update project_bible set notes='Shoot on location' where project_id=$1 returning 1`, [pid])).length === 1);
// the DoP allows a colleague (an edit grant), who is on the Camera team
const C2 = await mkUser('camera2'); await join(C2, 'camera2@example.com', tCam);
ok('a Camera member the DoP has not allowed cannot edit', (await as(C2, `update project_bible set notes='y' where project_id=$1 returning 1`, [pid])).length === 0);
await as(O, `update member_teams set can_edit=true where member_id=$1`, [await mid(C2)]);
ok('once the DoP allows them, they can', (await as(C2, `update project_bible set notes='By the focus puller' where project_id=$1 returning 1`, [pid])).length === 1);

// ---- aspect ratio (part of the format)
ok('the DoP sets the aspect ratio', (await as(C, `select set_aspect_ratio($1,'2.39:1')`, [pid])).length === 1 && (await as(O, `select aspect_ratio a from projects where id=$1`, [pid]))[0].a === '2.39:1');
ok('everyone on the project reads the aspect ratio, even without bible access', (await as(S, `select aspect_ratio a from projects where id=$1`, [pid]))[0].a === '2.39:1');
ok('the Direction head cannot change it', await fails(D, `select set_aspect_ratio($1,'1:1')`, [pid]));
ok('a viewer cannot change it', await fails(W, `select set_aspect_ratio($1,'1:1')`, [pid]));
ok('an outsider cannot change it', await fails(X, `select set_aspect_ratio($1,'1:1')`, [pid]));
ok('a direct update of the ratio is refused (even for the owner)', await fails(O, `update projects set aspect_ratio='4:3' where id=$1`, [pid], 'Project bible'));
ok('nonsense is refused', await fails(O, `select set_aspect_ratio($1,'wide')`, [pid], 'bad_ratio'));
ok('an extreme shape is refused', await fails(O, `select set_aspect_ratio($1,'40:1')`, [pid], 'bad_ratio'));
ok('zero is refused', await fails(O, `select set_aspect_ratio($1,'0:9')`, [pid], 'bad_ratio'));
ok('9:16 vertical is allowed', (await as(O, `select set_aspect_ratio($1,'9:16')`, [pid])).length === 1);

// ---- Moodboard: owned by Direction
const card = (u, kind, extra = {}) => as(u, `insert into moodboard_items (project_id, kind, image_path, caption, description, bytes, position) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
  [pid, kind, extra.path ?? null, extra.caption ?? 'Note', extra.desc ?? '', extra.bytes ?? 0, extra.pos ?? 0]);
ok('the Director adds a text card', (await card(D, 'text', { caption: 'Cold blues' })).length === 1);
ok('the DoP cannot add a moodboard card (it is the Direction team\'s part)', await fails(C, `insert into moodboard_items (project_id, kind) values ($1,'text')`, [pid]));
ok('an image card needs a picture path', await fails(D, `insert into moodboard_items (project_id, kind) values ($1,'image')`, [pid]));
ok('a text card cannot carry a picture', await fails(D, `insert into moodboard_items (project_id, kind, image_path) values ($1,'text',$2)`, [pid, `${pid}/a.jpg`]));
ok('a picture path from another project is refused', await fails(D, `insert into moodboard_items (project_id, kind, image_path, bytes) values ($1,'image',$2,10)`, [pid, `00000000-0000-0000-0000-000000000000/a.jpg`], 'bad_frame'));
const img = (await card(D, 'image', { path: `${pid}/a.jpg`, bytes: 100000, caption: 'Rain' }))[0].id;
ok('the Director adds a picture card', Boolean(img));
ok('everyone with view access reads the cards', (await as(W, `select * from moodboard_items`)).length === 2 && (await as(C, `select * from moodboard_items`)).length === 2);
ok('a viewer cannot add, change or delete a card', await fails(W, `insert into moodboard_items (project_id, kind) values ($1,'text')`, [pid]) && (await as(W, `update moodboard_items set caption='x' where id=$1 returning 1`, [img])).length === 0 && (await as(W, `delete from moodboard_items where id=$1 returning 1`, [img])).length === 0);
ok('the DoP cannot change or delete a card either', (await as(C, `update moodboard_items set caption='x' where id=$1 returning 1`, [img])).length === 0 && (await as(C, `delete from moodboard_items where id=$1 returning 1`, [img])).length === 0);
ok('an outsider reads no cards', (await as(X, `select * from moodboard_items`)).length === 0);
ok('a card keeps its kind', await fails(D, `update moodboard_items set kind='text', image_path=null, bytes=0 where id=$1`, [img]));
ok('the Director changes the caption and order', (await as(D, `update moodboard_items set caption='Heavy rain', position=5 where id=$1 returning 1`, [img])).length === 1);
ok('creator is recorded', (await as(O, `select created_by c from moodboard_items where id=$1`, [img]))[0].c === D);

// ---- shared image cap (10 MB)
await as(O, `update projects set image_cap_mb=10 where id=$1`, [pid]);
ok('a card that would pass the cap is refused', await fails(D, `insert into moodboard_items (project_id, kind, image_path, bytes) values ($1,'image',$2,$3)`, [pid, `${pid}/big.jpg`, 11 * 1048576], 'image_cap_reached'));
ok('a card under the cap is fine', (await card(D, 'image', { path: `${pid}/ok.jpg`, bytes: 5 * 1048576 })).length === 1);
const sc = (await as(O, `insert into scenes (project_id, display_number, heading, sort_order) values ($1,'1','INT. A - DAY',10) returning id`, [pid]))[0].id;
await as(O, `update team_section_access set level='edit' where section='shots' and team_id=$1`, [tCam]);
await as(O, `update member_teams set can_edit=true where member_id=$1`, [await mid(C)]);
const shot = (await as(C, `insert into shots (project_id, scene_id, team_id, description) values ($1,$2,$3,'Wide') returning id`, [pid, sc, tCam]))[0].id;
ok('a storyboard frame counts the moodboard pictures', await fails(C, `insert into storyboard_frames (project_id, shot_id, bytes) values ($1,$2,$3)`, [pid, shot, 6 * 1048576], 'image_cap_reached'));
ok('a smaller frame still fits', (await as(C, `insert into storyboard_frames (project_id, shot_id, bytes) values ($1,$2,$3) returning 1`, [pid, shot, 1048576])).length === 1);
ok('shrinking is always allowed', (await as(D, `update moodboard_items set bytes=1000 where id=$1 returning 1`, [img])).length === 1);

// ---- files in the moodboard bucket (Direction's part)
ok('the bucket exists and is private', (await db.query(`select public p from storage.buckets where id='moodboard'`)).rows[0].p === false);
const put = (u, name) => as(u, `insert into storage.objects (bucket_id, name) values ('moodboard',$1) returning id`, [name]);
ok('the Director uploads a picture', (await put(D, `${pid}/one.jpg`)).length === 1);
ok('the DoP cannot upload to the moodboard', await fails(C, `insert into storage.objects (bucket_id, name) values ('moodboard',$1)`, [`${pid}/cam.jpg`]));
ok('a viewer cannot upload', await fails(W, `insert into storage.objects (bucket_id, name) values ('moodboard',$1)`, [`${pid}/two.jpg`]));
ok('an outsider cannot upload', await fails(X, `insert into storage.objects (bucket_id, name) values ('moodboard',$1)`, [`${pid}/three.jpg`]));
ok('a path without a project is refused', await fails(D, `insert into storage.objects (bucket_id, name) values ('moodboard',$1)`, [`loose.jpg`]));
ok('a path into another project is refused', await fails(D, `insert into storage.objects (bucket_id, name) values ('moodboard',$1)`, [`00000000-0000-0000-0000-000000000000/x.jpg`]));
ok('everyone with view access reads the picture', (await as(W, `select * from storage.objects where bucket_id='moodboard'`)).length === 1 && (await as(C, `select * from storage.objects where bucket_id='moodboard'`)).length === 1);
ok('an outsider reads no pictures', (await as(X, `select * from storage.objects where bucket_id='moodboard'`)).length === 0);
ok('a viewer cannot delete the picture', (await as(W, `delete from storage.objects where name=$1 returning 1`, [`${pid}/one.jpg`])).length === 0);
ok('the Director deletes the picture', (await as(D, `delete from storage.objects where name=$1 returning 1`, [`${pid}/one.jpg`])).length === 1);

// ---- the owner hands a part to another team
ok('a Direction head cannot hand over the format', await fails(D, `select set_bible_owner($1,'format',$2)`, [pid, tDir]));
ok('the owner hands the moodboard to Art', (await as(O, `select set_bible_owner($1,'mood',$2)`, [pid, tArt])).length === 1 && (await owners(pid)).m === 'Art');
ok('Direction can no longer add cards', await fails(D, `insert into moodboard_items (project_id, kind) values ($1,'text')`, [pid]));
await as(O, `update team_section_access set level='edit' where section='bible' and team_id=$1`, [tArt]);
await as(O, `update member_teams set is_hod=true where member_id=$1`, [await mid(W)]);
ok('Art (now owner, edit level, head of department) can add cards', (await card(W, 'text', { caption: 'Set dressing' })).length === 1);
ok('a team from another project cannot be chosen', await fails(O, `select set_bible_owner($1,'mood',$2)`, [pid, (await db.query(`select id from teams where project_id=$1 limit 1`, [old])).rows[0].id], 'not on this project'));
ok('a bad area is refused', await fails(O, `select set_bible_owner($1,'nope',$2)`, [pid, tArt], 'bad_area'));
ok('the owner columns cannot be changed directly', await fails(O, `update projects set bible_format_team=null where id=$1`, [pid], 'owners'));
ok('with no owner team set, only the owner and admins edit', (await as(O, `select set_bible_owner($1,'mood',null)`, [pid])).length === 1 && await fails(W, `insert into moodboard_items (project_id, kind) values ($1,'text')`, [pid]) && (await as(O, `insert into moodboard_items (project_id, kind) values ($1,'text') returning 1`, [pid])).length === 1);
const tTmp = (await as(O, `insert into teams (project_id, name) values ($1,'Temp') returning id`, [pid]))[0].id;
await as(O, `select set_bible_owner($1,'format',$2)`, [pid, tTmp]);
ok('deleting an owning team leaves the part with the owner and admins', (await as(O, `delete from teams where id=$1 returning 1`, [tTmp])).length === 1 && (await owners(pid)).f === null);
ok('and the DoP can no longer edit the format', await fails(C, `select set_aspect_ratio($1,'1:1')`, [pid]));

// ---- clean up
ok('deleting the project removes its cards and format', (await as(O, `delete from projects where id=$1 returning 1`, [pid])).length === 1
  && (await db.query(`select count(*)::int n from moodboard_items where project_id=$1`, [pid])).rows[0].n === 0
  && (await db.query(`select count(*)::int n from project_bible where project_id=$1`, [pid])).rows[0].n === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
