// Storyboard frames and files: who may read and write, the layer limit and the project size cap.
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
  -- a stand-in for Supabase Storage, just enough for the bucket and its file policies
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
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

const [O, C, V, R, X] = await Promise.all(['owner', 'camera', 'vfx', 'reader', 'outsider'].map(mkUser));
const pid = (await as(O, `select create_project('Storyboard') as id`))[0].id;
const team = async (n) => (await as(O, `select id from teams where project_id=$1 and name=$2`, [pid, n]))[0].id;
const [tCam, tVfx, tArt] = [await team('Camera'), await team('VFX'), await team('Art')];
const join = async (u, email, t) => { await as(O, `insert into invites (project_id, team_id, email, invited_by) values ($1,$2,$3,$4)`, [pid, t, email, O]); await as(u, `select * from accept_pending_invites()`); };
await join(C, 'camera@example.com', tCam); await join(V, 'vfx@example.com', tVfx); await join(R, 'reader@example.com', tArt);
const mid = async (u) => (await as(O, `select id from members where account_id=$1`, [u]))[0].id;
await as(O, `update team_section_access set level='edit' where section='shots' and team_id in ($1,$2)`, [tCam, tVfx]);
await as(O, `update team_section_access set level='view' where section='shots' and team_id=$1`, [tArt]);
await as(O, `update member_teams set can_edit=true where member_id in ($1,$2)`, [await mid(C), await mid(V)]);
const sc = (await as(O, `insert into scenes (project_id, display_number, heading, sort_order) values ($1,'1','INT. A - DAY',10) returning id`, [pid]))[0].id;
const shot = (await as(C, `insert into shots (project_id, scene_id, team_id, description) values ($1,$2,$3,'Wide') returning id`, [pid, sc, tCam]))[0].id;
const layer = (n, bytes = 100000) => ({ path: `${pid}/${shot}/${n}.jpg`, w: 1280, h: 720, bytes, opacity: 1, visible: true });
const mkFrame = (u, extra = {}) => as(u, `insert into storyboard_frames (project_id, shot_id, layers, strokes, bytes) values ($1,$2,$3::jsonb,$4::jsonb,$5) returning id`,
  [pid, shot, JSON.stringify(extra.layers ?? [layer('a')]), JSON.stringify(extra.strokes ?? []), extra.bytes ?? 100000]);

// ---- frames
ok('a reader cannot add a frame', await fails(R, `insert into storyboard_frames (project_id, shot_id) values ($1,$2)`, [pid, shot]));
ok('a team that does not own the shot cannot add a frame', await fails(V, `insert into storyboard_frames (project_id, shot_id) values ($1,$2)`, [pid, shot]));
ok('an outsider cannot add a frame', await fails(X, `insert into storyboard_frames (project_id, shot_id) values ($1,$2)`, [pid, shot]));
ok('anonymous cannot add a frame', await fails(null, `insert into storyboard_frames (project_id, shot_id) values ($1,$2)`, [pid, shot]));
ok('a file path from another shot is refused', await fails(C, `insert into storyboard_frames (project_id, shot_id, layers) values ($1,$2,$3::jsonb)`, [pid, shot, JSON.stringify([{ path: `${pid}/00000000-0000-0000-0000-000000000000/x.jpg`, bytes: 1 }])], 'bad_frame'));
ok('more than 4 layers is refused', await fails(C, `insert into storyboard_frames (project_id, shot_id, layers) values ($1,$2,$3::jsonb)`, [pid, shot, JSON.stringify(['a', 'b', 'c', 'd', 'e'].map((n) => layer(n)))]));
const frame = (await mkFrame(C))[0].id;
ok('the shot owner adds a frame', Boolean(frame));
ok('one frame per shot', await fails(C, `insert into storyboard_frames (project_id, shot_id) values ($1,$2)`, [pid, shot]));
ok('people with view access read frames', (await as(R, `select * from storyboard_frames`)).length === 1 && (await as(O, `select * from storyboard_frames`)).length === 1);
ok('an outsider reads no frames', (await as(X, `select * from storyboard_frames`)).length === 0);
ok('the shot owner updates the drawing', (await as(C, `update storyboard_frames set strokes=$1::jsonb where id=$2 returning 1`, [JSON.stringify([{ color: '#000', width: 3, points: [[0.1, 0.1], [0.2, 0.2]] }]), frame])).length === 1);
ok('another team cannot change the frame', (await as(V, `update storyboard_frames set done=true where id=$1 returning 1`, [frame])).length === 0);
ok('a reader cannot change the frame', (await as(R, `update storyboard_frames set done=true where id=$1 returning 1`, [frame])).length === 0);
ok('a frame cannot move to another shot', await fails(C, `update storyboard_frames set shot_id=gen_random_uuid() where id=$1`, [frame]));
ok('last editor is recorded', (await as(O, `select updated_by u from storyboard_frames where id=$1`, [frame]))[0].u === C);

// ---- the size cap
await as(O, `update projects set image_cap_mb=10 where id=$1`, [pid]);
ok('growing past the cap is refused', await fails(C, `update storyboard_frames set bytes=$1 where id=$2`, [11 * 1048576, frame], 'image_cap_reached'));
ok('staying under the cap is fine', (await as(C, `update storyboard_frames set bytes=$1 where id=$2 returning 1`, [9 * 1048576, frame])).length === 1);
ok('shrinking is always allowed, even over the cap', (await as(C, `update storyboard_frames set bytes=$1 where id=$2 returning 1`, [1000, frame])).length === 1);
ok('the cap cannot be set silly small or huge', await fails(O, `update projects set image_cap_mb=1 where id=$1`, [pid]) && await fails(O, `update projects set image_cap_mb=999999 where id=$1`, [pid]));
ok('a member cannot change the cap', (await as(C, `update projects set image_cap_mb=5000 where id=$1 returning 1`, [pid])).length === 0);

// ---- files in the bucket
ok('the bucket exists and is private', (await db.query(`select public p from storage.buckets where id='storyboard'`)).rows[0].p === false);
const put = (u, name) => as(u, `insert into storage.objects (bucket_id, name) values ('storyboard',$1) returning id`, [name]);
const good = `${pid}/${shot}/one.jpg`;
ok('the shot owner uploads a file', (await put(C, good)).length === 1);
ok('another team cannot upload to that shot', await fails(V, `insert into storage.objects (bucket_id, name) values ('storyboard',$1)`, [`${pid}/${shot}/two.jpg`]));
ok('a reader cannot upload', await fails(R, `insert into storage.objects (bucket_id, name) values ('storyboard',$1)`, [`${pid}/${shot}/three.jpg`]));
ok('a path that is not project/shot/file is refused', await fails(C, `insert into storage.objects (bucket_id, name) values ('storyboard',$1)`, [`${pid}/loose.jpg`]));
ok('a path into another project is refused', await fails(C, `insert into storage.objects (bucket_id, name) values ('storyboard',$1)`, [`00000000-0000-0000-0000-000000000000/${shot}/x.jpg`]));
ok('people with view access read the file', (await as(R, `select * from storage.objects where bucket_id='storyboard'`)).length === 1);
ok('an outsider reads no files', (await as(X, `select * from storage.objects where bucket_id='storyboard'`)).length === 0);
ok('another team cannot delete the file', (await as(V, `delete from storage.objects where name=$1 returning 1`, [good])).length === 0);
ok('the shot owner deletes the file', (await as(C, `delete from storage.objects where name=$1 returning 1`, [good])).length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
