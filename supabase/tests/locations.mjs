// Locations: access, contacts, costs (Admins and Production only), locking rules, scene links, availability, photos and the picture limit.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const files = process.argv.slice(2);
const [early, late] = [files.filter((f) => !/003[89]_/.test(f)), files.filter((f) => /003[89]_/.test(f))];
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
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
const [O, DIR, PROD, CAM, X] = await Promise.all(['owner', 'direction', 'production', 'camera', 'outsider'].map(mkUser));

// a project made before Locations existed
const old = (await as(O, `select create_project('Before') id`))[0].id;
for (const f of late) await db.exec(fs.readFileSync(f, 'utf8'));
const oldLv = (await db.query(`select t.name, a.level from teams t join team_section_access a on a.team_id = t.id and a.section = 'locations' where t.project_id = $1`, [old])).rows;
ok('an existing project gets Locations for every team', oldLv.length === 10);
ok('existing Production and Direction edit, the others view', oldLv.filter((r) => ['Production', 'Direction'].includes(r.name)).every((r) => r.level === 'edit') && oldLv.filter((r) => !['Production', 'Direction'].includes(r.name)).every((r) => r.level === 'view'));
ok('an existing project keeps its 200 MB picture limit', (await db.query(`select image_cap_mb c from projects where id=$1`, [old])).rows[0].c === 200);

const pid = (await as(O, `select create_project('Places') id`))[0].id;
ok('a new project starts with a 500 MB picture limit', (await db.query(`select image_cap_mb c from projects where id=$1`, [pid])).rows[0].c === 500);
const team = async (n) => (await as(O, `select id from teams where project_id=$1 and name=$2`, [pid, n]))[0].id;
const [tDir, tProd, tCam] = [await team('Direction'), await team('Production'), await team('Camera')];
const join = async (u, email, t) => { await as(O, `insert into invites (project_id, team_id, email, invited_by) values ($1,$2,$3,$4)`, [pid, t, email, O]); await as(u, `select * from accept_pending_invites()`); };
await join(DIR, 'direction@example.com', tDir); await join(PROD, 'production@example.com', tProd); await join(CAM, 'camera@example.com', tCam);
const lv = (await db.query(`select t.name, a.level from teams t join team_section_access a on a.team_id=t.id and a.section='locations' where t.project_id=$1`, [pid])).rows;
ok('a new project: Production and Direction edit, others view', lv.filter((r) => ['Production', 'Direction'].includes(r.name)).every((r) => r.level === 'edit') && lv.filter((r) => !['Production', 'Direction'].includes(r.name)).every((r) => r.level === 'view') && lv.length === 10);
await db.query(`update member_teams set can_edit=true where member_id in (select id from members where account_id in ($1,$2))`, [DIR, PROD]);

const addLoc = (u, name = 'Old mill') => as(u, `insert into locations (project_id, name) values ($1,$2) returning id`, [pid, name]);
const loc = (await addLoc(PROD))[0].id;
ok('Production adds a location', !!loc);
ok('Direction adds a location', (await addLoc(DIR, 'Harbour')).length === 1);
ok('a view-only team (Camera) cannot add', await fails(CAM, `insert into locations (project_id, name) values ($1,'x')`, [pid]));
ok('an outsider cannot add or read', await fails(X, `insert into locations (project_id, name) values ($1,'x')`, [pid]) && (await as(X, `select * from locations`)).length === 0);
ok('Direction edits a location that Production added', (await as(DIR, `update locations set kind='Mill' where id=$1 returning id`, [loc])).length === 1);
ok('a blank name is refused', await fails(PROD, `insert into locations (project_id, name) values ($1,'  ')`, [pid]));
ok('an unknown status is refused', await fails(PROD, `update locations set status='done' where id=$1`, [loc]));
ok('lat without lng is refused', await fails(PROD, `update locations set lat=10 where id=$1`, [loc]));
ok('a pin is accepted', (await as(PROD, `update locations set lat=48.1, lng=11.5, address='Mill Rd 1' where id=$1 returning id`, [loc])).length === 1);
ok('Camera reads locations', (await as(CAM, `select * from locations`)).length === 2);
ok('Camera cannot edit one', (await as(CAM, `update locations set name='x' where id=$1 returning id`, [loc])).length === 0);
ok('a new location cannot start locked', await fails(PROD, `insert into locations (project_id, name, status) values ($1,'x','locked')`, [pid], 'cannot start locked'));

// contacts: owner, admins, Production, Direction
const contact = (u, l = loc) => as(u, `insert into location_contacts (location_id, project_id, name, phone) values ($1,$2,'Mrs Weber','555') on conflict (location_id) do update set phone='556' returning location_id`, [l, pid]);
ok('Production sets a contact', (await contact(PROD)).length === 1);
ok('Camera cannot set or read a contact', await fails(CAM, `insert into location_contacts (location_id, project_id, name) values ($1,$2,'x')`, [loc, pid]) && (await as(CAM, `select * from location_contacts`)).length === 0);
ok('Production, Direction and the owner read it', (await as(PROD, `select * from location_contacts`)).length === 1 && (await as(DIR, `select * from location_contacts`)).length === 1 && (await as(O, `select * from location_contacts`)).length === 1);
ok('an outsider reads no contact', (await as(X, `select * from location_contacts`)).length === 0);

// costs: owner, admins, Production only
const cost = (u, extra = '') => as(u, `insert into location_costs (location_id, project_id, kind, amount ${extra ? ',' + extra.split('=')[0] : ''}) values ($1,$2,'Location fee',500 ${extra ? ',' + extra.split('=')[1] : ''}) returning id`, [loc, pid]);
ok('Direction cannot add a cost line', await fails(DIR, `insert into location_costs (location_id, project_id, amount) values ($1,$2,5)`, [loc, pid]));
ok('Camera cannot add a cost line', await fails(CAM, `insert into location_costs (location_id, project_id, amount) values ($1,$2,5)`, [loc, pid]));
const c1 = (await cost(PROD))[0].id;
ok('Production adds a cost line', !!c1);
ok('Production and the owner read costs', (await as(PROD, `select * from location_costs`)).length === 1 && (await as(O, `select * from location_costs`)).length === 1);
ok('Direction, Camera and an outsider read no costs', (await as(DIR, `select * from location_costs`)).length === 0 && (await as(CAM, `select * from location_costs`)).length === 0 && (await as(X, `select * from location_costs`)).length === 0);
ok('a negative amount is refused', await fails(PROD, `update location_costs set amount=-1 where id=$1`, [c1]));
ok('a cost line carries its status and dates', (await as(PROD, `update location_costs set status='agreed', due_date='2026-03-01' where id=$1 returning id`, [c1])).length === 1);
ok('Direction cannot change a cost line', (await as(DIR, `update location_costs set amount=1 where id=$1 returning id`, [c1])).length === 0);
ok('a cost line cannot move to another location', await fails(PROD, `update location_costs set location_id=$2 where id=$1`, [c1, (await db.query(`select id from locations where name='Harbour'`)).rows[0].id]));

// locking
ok('locking needs the agreement ticked', await fails(PROD, `update locations set status='locked' where id=$1`, [loc], 'agreement is signed'));
await as(PROD, `update locations set agreement_signed=true where id=$1`, [loc]);
const harbour = (await db.query(`select id from locations where name='Harbour'`)).rows[0].id;
await as(DIR, `update locations set agreement_signed=true where id=$1`, [harbour]);
ok('locking needs at least one cost line', await fails(DIR, `update locations set status='locked' where id=$1`, [harbour], 'cost line'));
ok('Camera cannot lock', (await as(CAM, `update locations set status='locked' where id=$1 returning id`, [loc])).length === 0);
ok('Direction (who cannot see costs) can lock once a cost line exists', (await as(DIR, `update locations set status='locked' where id=$1 returning id`, [loc])).length === 1);
const lk = (await db.query(`select status, locked_by, locked_at from locations where id=$1`, [loc])).rows[0];
ok('locking stamps who and when', lk.status === 'locked' && lk.locked_by === DIR && lk.locked_at);
ok('a locked location refuses edits to its details', await fails(PROD, `update locations set name='Renamed' where id=$1`, [loc], 'locked') && await fails(PROD, `update locations set parking='x' where id=$1`, [loc], 'locked'));
ok('but its notes can still change', (await as(PROD, `update locations set notes='Key at the bakery' where id=$1 returning id`, [loc])).length === 1);
ok('its cost lines stay editable (paid later)', (await as(PROD, `update location_costs set status='paid', paid_date='2026-03-05' where id=$1 returning id`, [c1])).length === 1);
ok('its last cost line cannot be removed while locked', await fails(PROD, `delete from location_costs where id=$1`, [c1], 'at least one cost line'));
ok('a second line can be added and the first removed', (await cost(PROD)).length === 1 && (await as(PROD, `delete from location_costs where id=$1 returning id`, [c1])).length === 1);
ok('a locked location cannot be deleted', (await as(PROD, `delete from locations where id=$1 returning id`, [loc])).length === 0);
ok('a locked location cannot be moved or changed while unlocking', await fails(PROD, `update locations set status='scouted', name='Other' where id=$1`, [loc], 'locked'));
ok('an editor unlocks it', (await as(PROD, `update locations set status='scouted' where id=$1 returning id`, [loc])).length === 1);
ok('unlocking clears the lock stamp and details are editable again', (await db.query(`select locked_by from locations where id=$1`, [loc])).rows[0].locked_by === null && (await as(PROD, `update locations set name='Old mill' where id=$1 returning id`, [loc])).length === 1);

// scene links
const mkScene = async (p, n) => (await db.query(`insert into scenes (project_id, display_number, heading, sort_order) values ($1,$2,'INT. A - DAY',$3) returning id`, [p, String(n), n * 10])).rows[0].id;
const [s1, s2] = [await mkScene(pid, 1), await mkScene(pid, 2)];
ok('an editor links a scene as first choice', (await as(PROD, `insert into location_scenes (location_id, scene_id, project_id) values ($1,$2,$3) returning location_id`, [loc, s1, pid])).length === 1);
ok('a scene has only one first choice', await fails(DIR, `insert into location_scenes (location_id, scene_id, project_id) values ($1,$2,$3)`, [harbour, s1, pid]));
ok('but can have alternates', (await as(DIR, `insert into location_scenes (location_id, scene_id, project_id, rank) values ($1,$2,$3,'alternate') returning location_id`, [harbour, s1, pid])).length === 1);
ok('a scene from another project is refused', await (async () => { const p2 = (await as(X, `select create_project('Other') id`))[0].id; const sx = await mkScene(p2, 1); return fails(PROD, `insert into location_scenes (location_id, scene_id, project_id) values ($1,$2,$3)`, [loc, sx, pid]); })());
ok('Camera cannot link or unlink a scene', await fails(CAM, `insert into location_scenes (location_id, scene_id, project_id) values ($1,$2,$3)`, [loc, s2, pid]) && (await as(CAM, `delete from location_scenes where location_id=$1 returning scene_id`, [loc])).length === 0);
ok('Camera reads the links', (await as(CAM, `select * from location_scenes`)).length === 2);
ok('links stay editable when the location is locked', await (async () => { await as(PROD, `update locations set status='locked' where id=$1`, [loc]); const r = (await as(PROD, `insert into location_scenes (location_id, scene_id, project_id) values ($1,$2,$3) returning scene_id`, [loc, s2, pid])).length === 1; await as(PROD, `update locations set status='scouted' where id=$1`, [loc]); return r; })());

// availability
const sched = (await db.query(`insert into schedules (project_id, name, start_date, end_date) values ($1,'Block','2026-03-02','2026-03-06') returning id`, [pid])).rows[0].id;
const day = (await db.query(`insert into shoot_days (project_id, schedule_id, day_date) values ($1,$2,'2026-03-02') returning id`, [pid, sched])).rows[0].id;
ok('an editor adds an availability range', (await as(PROD, `insert into location_availability (location_id, project_id, start_date, end_date, kind) values ($1,$2,'2026-03-01','2026-03-03','unavailable') returning id`, [loc, pid])).length === 1);
ok('an end before the start is refused', await fails(PROD, `insert into location_availability (location_id, project_id, start_date, end_date) values ($1,$2,'2026-03-05','2026-03-01')`, [loc, pid]));
ok('a booking points to a shoot day of this project', (await as(PROD, `insert into location_availability (location_id, project_id, start_date, end_date, kind, day_id) values ($1,$2,'2026-03-02','2026-03-02','booked',$3) returning id`, [loc, pid, day])).length === 1);
ok('a shoot day from another project is refused', await (async () => { const p2 = (await db.query(`select id from projects where name='Other'`)).rows[0].id; const sc2 = (await db.query(`insert into schedules (project_id, name, start_date, end_date) values ($1,'S','2026-01-01','2026-01-02') returning id`, [p2])).rows[0].id; const d2 = (await db.query(`insert into shoot_days (project_id, schedule_id, day_date) values ($1,$2,'2026-01-01') returning id`, [p2, sc2])).rows[0].id; return fails(PROD, `insert into location_availability (location_id, project_id, start_date, end_date, day_id) values ($1,$2,'2026-03-02','2026-03-02',$3)`, [loc, pid, d2]); })());
ok('Camera reads but cannot add availability', (await as(CAM, `select * from location_availability`)).length === 2 && await fails(CAM, `insert into location_availability (location_id, project_id, start_date, end_date) values ($1,$2,'2026-03-02','2026-03-02')`, [loc, pid]));

// shoot days and locations
ok('a shoot day can point to a location of its project', (await as(PROD, `update shoot_days set location_id=$2 where id=$1 returning id`, [day, loc])).length === 1);
ok('but not to a location of another project', await (async () => { const p2 = (await db.query(`select id from projects where name='Other'`)).rows[0].id; const l2 = (await db.query(`insert into locations (project_id, name) values ($1,'Elsewhere') returning id`, [p2])).rows[0].id; return fails(PROD, `update shoot_days set location_id=$2 where id=$1`, [day, l2], 'not in this project'); })());

// photos and drawing
const photo = (u, bytes = 400000, path = `${pid}/${loc}/a.jpg`, strokes = '[]') => as(u, `insert into location_photos (location_id, project_id, path, bytes, strokes) values ($1,$2,$3,$4,$5::jsonb) returning id`, [loc, pid, path, bytes, strokes]);
const ph = (await photo(PROD))[0].id;
ok('an editor adds a photo', !!ph);
ok('Camera reads photos but cannot add one', (await as(CAM, `select * from location_photos`)).length === 1 && await fails(CAM, `insert into location_photos (location_id, project_id, path, bytes) values ($1,$2,$3,1)`, [loc, pid, `${pid}/${loc}/b.jpg`]));
ok('a photo path must sit under its project and location', await fails(PROD, `insert into location_photos (location_id, project_id, path, bytes) values ($1,$2,'elsewhere/x.jpg',1)`, [loc, pid]));
ok('the drawing is saved with the photo', (await as(PROD, `update location_photos set strokes=$2::jsonb where id=$1 returning id`, [ph, JSON.stringify([{ color: '#d7140f', width: 3, points: [[0.1, 0.1], [0.2, 0.3]] }])])).length === 1);
ok('a drawing must be a list and not too long', await fails(PROD, `update location_photos set strokes='{"a":1}'::jsonb where id=$1`, [ph]) && await fails(PROD, `update location_photos set strokes=$2::jsonb where id=$1`, [ph, JSON.stringify(Array.from({ length: 401 }, () => ({})))]));
ok('a photo cannot move to another location', await fails(PROD, `update location_photos set location_id=$2 where id=$1`, [ph, harbour]));
await db.query(`update projects set image_cap_mb = 10 where id=$1`, [pid]);
ok('location photos count toward the picture limit', await fails(PROD, `insert into location_photos (location_id, project_id, path, bytes) values ($1,$2,$3,$4)`, [loc, pid, `${pid}/${loc}/big.jpg`, 11 * 1048576], 'image_cap_reached'));
ok('and a storyboard frame cannot pass the limit that location photos use up', await (async () => { await db.query(`update location_photos set bytes = 9900000 where id=$1`, [ph]); const sh = (await db.query(`insert into shots (project_id, scene_id, team_id, position) values ($1,$2,$3,10) returning id`, [pid, s1, tCam])).rows[0]; return fails(O, `insert into storyboard_frames (project_id, shot_id, bytes) values ($1,$2,2000000)`, [pid, sh.id], 'image_cap_reached'); })());
await db.query(`update projects set image_cap_mb = 500 where id=$1`, [pid]);

// the picture bucket
const put = (u, name) => as(u, `insert into storage.objects (bucket_id, name) values ('locations',$1) returning id`, [name]);
ok('the bucket exists and is private', (await db.query(`select public p from storage.buckets where id='locations'`)).rows[0].p === false);
ok('an editor uploads under <project>/<location>/', (await put(PROD, `${pid}/${loc}/a.jpg`)).length === 1);
ok('Camera (view only) cannot upload, a path with no location is refused', await fails(CAM, `insert into storage.objects (bucket_id, name) values ('locations',$1)`, [`${pid}/${loc}/c.jpg`]) && await fails(PROD, `insert into storage.objects (bucket_id, name) values ('locations',$1)`, [`${pid}/c.jpg`]));
ok('Camera and the owner read the file, an outsider does not', (await as(CAM, `select * from storage.objects where bucket_id='locations'`)).length === 1 && (await as(O, `select * from storage.objects where bucket_id='locations'`)).length === 1 && (await as(X, `select * from storage.objects where bucket_id='locations'`)).length === 0);

// deleting
ok('deleting an unlocked location removes its records', await (async () => { const h = (await addLoc(PROD, 'Temp'))[0].id; await as(PROD, `insert into location_costs (location_id, project_id, amount) values ($1,$2,1)`, [h, pid]); const r = (await as(PROD, `delete from locations where id=$1 returning id`, [h])).length === 1; return r && (await db.query(`select 1 from location_costs where location_id=$1`, [h])).rows.length === 0; })());
ok('deleting a location clears the shoot day link', await (async () => { await as(PROD, `delete from locations where id=$1 returning id`, [loc]); return (await db.query(`select location_id from shoot_days where id=$1`, [day])).rows[0].location_id === null; })());
ok('deleting a project with a locked location and costs works', await (async () => { const p3 = (await as(O, `select create_project('Gone') id`))[0].id; const l3 = (await as(O, `insert into locations (project_id, name, agreement_signed) values ($1,'Cafe',true) returning id`, [p3]))[0].id; await as(O, `insert into location_costs (location_id, project_id, kind, amount) values ($1,$2,'No charge',0)`, [l3, p3]); await as(O, `update locations set status='locked' where id=$1`, [l3]); return (await as(O, `delete from projects where id=$1 returning id`, [p3])).length === 1; })());

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
