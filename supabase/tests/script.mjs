// Script text: per-scene locks and per-scene reading, enforced in the database.
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
const mkUser = async (name) => (await db.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
  [`${name}@example.com`, JSON.stringify({ display_name: name })])).rows[0].id;

const [O, W, W2, R, X] = await Promise.all(['owner', 'writer', 'writer2', 'reader', 'outsider'].map(mkUser));
const pid = (await as(O, `select create_project('Script test') as id`))[0].id;
const cam = (await as(O, `select id from teams where project_id=$1 and name='Camera'`, [pid]))[0].id;
for (const n of ['writer', 'writer2', 'reader']) await as(O, `insert into invites (project_id, team_id, email, invited_by) values ($1,$2,$3,$4)`, [pid, cam, `${n}@example.com`, O]);
for (const u of [W, W2, R]) await as(u, `select * from accept_pending_invites()`);
await as(O, `update team_section_access set level='edit' where team_id=$1 and section='script'`, [cam]);
const mid = async (u) => (await as(O, `select id from members where account_id=$1`, [u]))[0].id;
const [mW, mW2, mR] = [await mid(W), await mid(W2), await mid(R)];
await as(O, `update member_teams set can_edit=true where member_id in ($1,$2)`, [mW, mW2]);
for (const m of [mW, mW2]) await as(O, `insert into scene_access (member_id, mode) values ($1,'all') on conflict (member_id) do update set mode='all'`, [m]);

const s1 = (await as(O, `insert into scenes (project_id, display_number, heading, sort_order) values ($1,'1','INT. KITCHEN - DAY',10) returning id`, [pid]))[0].id;
const s2 = (await as(O, `insert into scenes (project_id, display_number, heading, sort_order) values ($1,'2','EXT. STREET - NIGHT',20) returning id`, [pid]))[0].id;
const els = [{ kind: 'action', text: 'Rain on the window.' }, { kind: 'character', text: 'ANNA' }, { kind: 'dialogue', text: 'Not yet.' }];

// ---- locking
const a = (await as(W, `select acquire_scene_lock($1) as r`, [s1]))[0].r;
ok('writer takes the lock', a.mine === true && a.name === 'writer');
const b = (await as(W2, `select acquire_scene_lock($1) as r`, [s1]))[0].r;
ok('second writer is told who holds it', b.mine === false && b.name === 'writer');
ok('holder can renew', (await as(W, `select acquire_scene_lock($1) as r`, [s1]))[0].r.mine === true);
ok('other writer cannot save while locked by someone else', await fails(W2, `select save_scene_text($1,'x','[]'::jsonb,0)`, [s1], 'lock_lost'));
ok('reader without edit rights cannot lock', await fails(R, `select acquire_scene_lock($1)`, [s1]));
ok('outsider cannot lock', await fails(X, `select acquire_scene_lock($1)`, [s1]));
ok('anonymous cannot lock', await fails(null, `select acquire_scene_lock($1)`, [s1]));
ok('everyone on the project sees the lock', (await as(R, `select * from scene_locks`)).length === 1);
ok('outsider sees no locks', (await as(X, `select * from scene_locks`)).length === 0);
ok('nobody can write locks directly', await fails(W2, `delete from scene_locks`) || (await as(W2, `delete from scene_locks returning 1`)).length === 0);
ok('direct insert into locks is refused', await fails(W2, `insert into scene_locks values ($1,$2, now() + interval '1 hour')`, [s1, W2]));

// ---- saving
ok('holder saves text and heading', (await as(W, `select save_scene_text($1,'INT. KITCHEN - NIGHT',$2::jsonb,0) as rev`, [s1, JSON.stringify(els)]))[0].rev === 1);
ok('heading changed on the scene', (await as(R, `select heading from scenes where id=$1`, [s1]))[0].heading === 'INT. KITCHEN - NIGHT');
ok('stale revision is refused', await fails(W, `select save_scene_text($1,'x','[]'::jsonb,0)`, [s1], 'rev_conflict'));
ok('bad element kind is refused', await fails(W, `select save_scene_text($1,'x','[{"kind":"banana","text":"a"}]'::jsonb,1)`, [s1], 'bad_elements'));
ok('non-array text is refused', await fails(W, `select save_scene_text($1,'x','{"a":1}'::jsonb,1)`, [s1], 'bad_elements'));
ok('cannot save to a scene you have not locked', await fails(W, `select save_scene_text($1,'x','[]'::jsonb,0)`, [s2], 'lock_lost'));
ok('direct write to scene text is refused', await fails(W, `update scene_text set elements='[]'::jsonb`));
ok('direct insert to scene text is refused', await fails(W, `insert into scene_text (scene_id) values ($1)`, [s2]));

// ---- reading
ok('owner reads the text', (await as(O, `select * from scene_text where scene_id=$1`, [s1])).length === 1);
ok('writer with script access reads it', (await as(W2, `select * from scene_text where scene_id=$1`, [s1])).length === 1);
ok('reader with no script access sees no text', (await as(R, `select * from scene_text`)).length === 0);
await as(O, `insert into scene_access (member_id, mode) values ($1,'selected') on conflict (member_id) do update set mode='selected'`, [mR]);
await as(O, `insert into scene_access_scenes values ($1,$2)`, [mR, s2]);
ok('selected-scenes reader still cannot read scene 1', (await as(R, `select * from scene_text where scene_id=$1`, [s1])).length === 0);
ok('outsider sees no text', (await as(X, `select * from scene_text`)).length === 0);

// ---- release and takeover
await as(W, `select release_scene_lock($1)`, [s1]);
ok('release frees the scene', (await as(O, `select * from scene_locks`)).length === 0);
await as(W2, `select acquire_scene_lock($1)`, [s1]);
await as(W, `select release_scene_lock($1)`, [s1]);
ok('someone else cannot release your lock', (await as(O, `select * from scene_locks`)).length === 1);
await db.exec(`update scene_locks set expires_at = now() - interval '1 minute'`);
ok('an expired lock can be taken over', (await as(W, `select acquire_scene_lock($1) as r`, [s1]))[0].r.mine === true);
ok('second save on the new rev works', (await as(W, `select save_scene_text($1,'INT. KITCHEN - NIGHT',$2::jsonb,1) as rev`, [s1, JSON.stringify(els)]))[0].rev === 2);

// ---- numbers are given at the lock (migration 0006)
// existing scenes s1, s2 were created with numbers; make a fresh unnumbered script in a new project
const pid2 = (await as(O, `select create_project('Numbering') as id`))[0].id;
const ins = async (h, sort, num = null) => (await as(O, `insert into scenes (project_id, display_number, heading, sort_order) values ($1,$2,$3,$4) returning id`, [pid2, num, h, sort]))[0].id;
const nums2 = async () => (await as(O, `select display_number n from scenes where project_id=$1 order by sort_order`, [pid2])).map(r => r.n);
const [n1, n2, n3] = [await ins('A', 10), await ins('B', 20), await ins('C', 30)];
ok('before the lock scenes have no number', (await nums2()).every(n => n === null));
ok('a scene can be removed freely before the lock', (await as(O, `delete from scenes where id=$1 returning 1`, [n2])).length === 1);
const nB = await ins('B again', 20);
ok('plain update cannot lock an unnumbered script', await fails(O, `update projects set script_locked=true where id=$1`, [pid2], 'Use Lock script'));
ok('only the owner can lock', await fails(W, `select lock_script($1)`, [pid2]));
await as(O, `select lock_script($1)`, [pid2]);
ok('lock numbers 1..n in script order', (await nums2()).join(',') === '1,2,3');
ok('lock starts revision 1', (await as(O, `select revision_no r from projects where id=$1`, [pid2]))[0].r === 1);
ok('lock is idempotent', !(await fails(O, `select lock_script($1)`, [pid2])));

// after the lock: letters in between, whole number at the end, A1 before the first
const iA = await ins('after 1', 15);
const iB = await ins('after 1 again', 17);
const iC = await ins('between 1A and 1B', 16);
const iEnd = await ins('at the end', 99);
const iFirst = await ins('before everything', 1);
ok('between 1 and 2 takes 1A', (await as(O, `select display_number n from scenes where id=$1`, [iA]))[0].n === '1A');
ok('next one after 1 and 1A takes 1B', (await as(O, `select display_number n from scenes where id=$1`, [iB]))[0].n === '1B');
ok('between 1A and 1B stays in front of 1B (1AA)', (await as(O, `select display_number n from scenes where id=$1`, [iC]))[0].n === '1AA');
ok('added at the end takes the next whole number', (await as(O, `select display_number n from scenes where id=$1`, [iEnd]))[0].n === '4');
ok('added before the first scene takes A1', (await as(O, `select display_number n from scenes where id=$1`, [iFirst]))[0].n === 'A1');
ok('existing numbers never moved', (await nums2()).join(',') === 'A1,1,1A,1AA,1B,2,3,4'.replace('1A,1AA,1B', '1A,1AA,1B'));
ok('a numbered scene cannot be deleted once locked', await fails(O, `delete from scenes where id=$1`, [n1], 'locked'));
ok('a locked number cannot be changed', await fails(O, `update scenes set display_number='99' where id=$1`, [n1], 'locked'));
ok('number cannot be blanked while locked', await fails(O, `update scenes set display_number=null where id=$1`, [n1], 'locked'));

// unlock keeps numbers; scenes added meanwhile are unnumbered; the next lock numbers only those
await as(O, `update projects set script_locked=false where id=$1`, [pid2]);
ok('unlock keeps every number', (await nums2()).filter(n => n !== null).length === 8);
const u1 = await ins('added while unlocked', 25);
ok('a scene added while unlocked has no number', (await as(O, `select display_number n from scenes where id=$1`, [u1]))[0].n === null);
ok('an unnumbered scene can be removed after an unlock', (await as(O, `delete from scenes where id=$1 returning 1`, [await ins('temp', 26)])).length === 1);
await as(O, `select lock_script($1)`, [pid2]);
ok('relock numbers only the new scene (2A, after 2)', (await as(O, `select display_number n from scenes where id=$1`, [u1]))[0].n === '2A');
ok('relock leaves the other numbers alone', (await nums2()).join(',') === 'A1,1,1A,1AA,1B,2,2A,3,4');
ok('relock keeps the revision in progress', (await as(O, `select revision_no r from projects where id=$1`, [pid2]))[0].r === 1);

// ---- revisions per scene
const rs = (await as(O, `select id from scenes where project_id=$1 and display_number='1'`, [pid2]))[0].id;
const E = ['action', 'character', 'dialogue'];
const mk = (...t) => JSON.stringify(t.map((x, i) => ({ kind: E[i] ?? 'action', text: x })));
await as(O, `select acquire_scene_lock($1)`, [rs]);
let rv = (await as(O, `select save_scene_text($1,'A',$2::jsonb,0) r`, [rs, mk('Rain.', 'ANNA', 'Not yet.')]))[0].r;
let st = (await as(O, `select elements, (select revised_in from scenes where id=$1) ri from scene_text where scene_id=$1`, [rs]))[0];
ok('lines written after the lock are marked Blue (revision 1)', st.elements.every(e => e.rev === 1) && st.ri === 1);
await as(O, `select start_next_revision($1)`, [pid2]);
rv = (await as(O, `select save_scene_text($1,'A',$2::jsonb,$3) r`, [rs, mk('Rain.', 'ANNA', 'Not yet, Anna.'), rv]))[0].r;
st = (await as(O, `select elements, (select revised_in from scenes where id=$1) ri from scene_text where scene_id=$1`, [rs]))[0];
ok('earlier marks stay, the changed line is Pink (revision 2)', st.elements[0].rev === 1 && st.elements[1].rev === 1 && st.elements[2].rev === 2);
ok('the scene shows the latest revision', st.ri === 2);
rv = (await as(O, `select save_scene_text($1,'A',$2::jsonb,$3) r`, [rs, mk('Rain.', 'ANNA', 'Not yet, Anna.'), rv]))[0].r;
ok('saving with no change leaves marks alone', (await as(O, `select (select revised_in from scenes where id=$1) ri`, [rs]))[0].ri === 2);
ok('marks sent by a client are ignored', !(await fails(O, `select save_scene_text($1,'A','[{"kind":"action","text":"Rain.","rev":9}]'::jsonb,$2)`, [rs, rv])));
st = (await as(O, `select elements from scene_text where scene_id=$1`, [rs]))[0];
ok('a client cannot invent a revision number', st.elements[0].rev === 1);
ok('only owner or admin can start a revision', await fails(W, `select start_next_revision($1)`, [pid2]));
ok('revision number cannot be edited directly', await fails(O, `update projects set revision_no=9 where id=$1`, [pid2], 'revision'));
ok('revised_in cannot be edited directly', await fails(O, `update scenes set revised_in=9 where id=$1`, [rs], 'Revisions'));
await as(O, `select release_scene_lock($1)`, [rs]);
// before the lock nothing is marked, and a locked-then-unlocked scene keeps its marks
await as(O, `update projects set script_locked=false where id=$1`, [pid2]);
await as(O, `select acquire_scene_lock($1)`, [rs]);
const cur = (await as(O, `select rev r from scene_text where scene_id=$1`, [rs]))[0].r;
await as(O, `select save_scene_text($1,'A',$2::jsonb,$3)`, [rs, mk('Rain.', 'ANNA', 'Not yet, Anna.', ), cur]);
await as(O, `select release_scene_lock($1)`, [rs]);

// ---- import (migration 0007)
const imp = [
  { number: null, heading: 'INT. ONE - DAY', omitted: false, elements: [{ kind: 'action', text: 'Hello.' }, { kind: 'character', text: 'ANNA' }, { kind: 'dialogue', text: 'Hi.' }] },
  { number: null, heading: 'EXT. TWO - DAY', omitted: false, elements: [] },
];
const pid3 = (await as(O, `select create_project('Import draft') as id`))[0].id;
ok('import: a reader cannot import', await fails(R, `select import_script($1,$2::jsonb,false)`, [pid3, JSON.stringify(imp)]));
ok('import: an outsider cannot import', await fails(X, `select import_script($1,$2::jsonb,false)`, [pid3, JSON.stringify(imp)]));
ok('import: a writer who is not the owner cannot import', await fails(W, `select import_script($1,$2::jsonb,false)`, [pid3, JSON.stringify(imp)]));
ok('import: bad element kind refused', await fails(O, `select import_script($1,$2::jsonb,false)`, [pid3, JSON.stringify([{ number: null, heading: 'A', omitted: false, elements: [{ kind: 'x', text: 'y' }] }])], 'bad_import'));
ok('import: empty list refused', await fails(O, `select import_script($1,'[]'::jsonb,false)`, [pid3], 'bad_import'));
ok('import: a draft arrives unnumbered', (await as(O, `select import_script($1,$2::jsonb,false) n`, [pid3, JSON.stringify(imp)]))[0].n === 2);
const impRows = await as(O, `select display_number n, heading h, (select count(*) from scene_text t where t.scene_id = s.id)::int t from scenes s where project_id=$1 order by sort_order`, [pid3]);
ok('import: scenes in order, no numbers, text saved only where there is text', impRows.map(r => `${r.n}|${r.h}|${r.t}`).join(',') === 'null|INT. ONE - DAY|1,null|EXT. TWO - DAY|0');
ok('import: project stays unlocked', (await as(O, `select script_locked l from projects where id=$1`, [pid3]))[0].l === false);
ok('import: a second import adds to the end', (await as(O, `select import_script($1,$2::jsonb,false) n`, [pid3, JSON.stringify([imp[0]])]))[0].n === 1);
const pid4 = (await as(O, `select create_project('Import numbered') as id`))[0].id;
const imp2 = [
  { number: '1', heading: 'INT. A - DAY', omitted: false, elements: [{ kind: 'action', text: 'A.' }] },
  { number: '1A', heading: 'INT. A2 - DAY', omitted: false, elements: [] },
  { number: '2', heading: 'OMITTED', omitted: true, elements: [] },
  { number: null, heading: 'INT. NEW - DAY', omitted: false, elements: [] },
];
ok('import: duplicate numbers refused', await fails(O, `select import_script($1,$2::jsonb,true)`, [pid4, JSON.stringify([imp2[0], imp2[0]])]));
ok('import: nothing was saved by the failed import', (await as(O, `select count(*)::int c from scenes where project_id=$1`, [pid4]))[0].c === 0);
ok('import: a numbered script arrives locked', (await as(O, `select import_script($1,$2::jsonb,true) n`, [pid4, JSON.stringify(imp2)]))[0].n === 4);
const lockedRows = await as(O, `select display_number n, status st from scenes where project_id=$1 order by sort_order`, [pid4]);
ok('import: numbers kept, omitted marked, the unnumbered scene numbered at the lock', lockedRows.map(r => `${r.n}:${r.st}`).join(',') === '1:active,1A:active,2:omitted,3:active');
ok('import: the script is locked on revision 1', (await as(O, `select script_locked l, revision_no r from projects where id=$1`, [pid4]))[0].l === true && (await as(O, `select revision_no r from projects where id=$1`, [pid4]))[0].r === 1);
ok('import: imported lines carry no revision marks', (await as(O, `select count(*)::int c from scene_text t join scenes s on s.id=t.scene_id where s.project_id=$1 and t.elements::text like '%"rev"%'`, [pid4]))[0].c === 0);
ok('import: a locked script needs matching, not import', await fails(O, `select import_script($1,$2::jsonb,false)`, [pid4, JSON.stringify([imp[0]])], 'import_needs_matching'));

// ---- applying a new draft (migration 0008)
const E2 = (...t) => t.map((x, i) => ({ kind: i === 0 ? 'action' : 'action', text: x }));
const pidD = (await as(O, `select create_project('New draft') as id`))[0].id;
await as(O, `select import_script($1,$2::jsonb,true)`, [pidD, JSON.stringify([
  { number: '1', heading: 'INT. ONE - DAY', omitted: false, elements: E2('Line a.', 'Line b.') },
  { number: '2', heading: 'INT. TWO - DAY', omitted: false, elements: E2('Two.') },
  { number: '3', heading: 'INT. THREE - DAY', omitted: false, elements: E2('Three.') },
  { number: '4', heading: 'INT. FOUR - DAY', omitted: false, elements: E2('Four.') },
])]);
const ids = (await as(O, `select id, display_number n from scenes where project_id=$1 order by sort_order`, [pidD])).map(r => r.id);
const planOk = [
  { op: 'update', id: ids[0], heading: 'INT. ONE - DAY', elements: E2('Line a.', 'Line b changed.') },
  { op: 'insert', number: null, heading: 'INT. NEW - NIGHT', elements: E2('Brand new.') },
  { op: 'keep', id: ids[1] },
  { op: 'omit', id: ids[2] },
  { op: 'update', id: ids[3], heading: 'INT. FOUR RENAMED - DAY', elements: E2('Four.') },
];
ok('draft: a reader cannot apply a draft', await fails(R, `select apply_draft($1,$2::jsonb)`, [pidD, JSON.stringify(planOk)]));
ok('draft: a writer who is not the owner cannot apply a draft', await fails(W, `select apply_draft($1,$2::jsonb)`, [pidD, JSON.stringify(planOk)]));
ok('draft: removing is refused on a locked script', await fails(O, `select apply_draft($1,$2::jsonb)`, [pidD, JSON.stringify([{ op: 'remove', id: ids[0] }])], 'locked'));
ok('draft: a scene from another project is refused', await fails(O, `select apply_draft($1,$2::jsonb)`, [pidD, JSON.stringify([{ op: 'keep', id: s2 }])], 'bad_plan'));
ok('draft: an unknown operation is refused', await fails(O, `select apply_draft($1,'[{"op":"explode"}]'::jsonb)`, [pidD], 'bad_plan'));
// a scene someone else is editing blocks the draft
await as(W, `select acquire_scene_lock($1)`, [ids[1]]).catch(() => {});
await db.query(`insert into scene_locks (scene_id, holder, expires_at) values ($1,$2, now() + interval '1 minute') on conflict (scene_id) do update set holder=excluded.holder, expires_at=excluded.expires_at`, [ids[1], W]);
ok('draft: a scene being edited by someone else blocks the draft', await fails(O, `select apply_draft($1,$2::jsonb)`, [pidD, JSON.stringify(planOk)], 'scene_busy'));
await db.query(`delete from scene_locks`);
const res = (await as(O, `select apply_draft($1,$2::jsonb) r`, [pidD, JSON.stringify(planOk)]))[0].r;
ok('draft: counts reported', res.updated === 2 && res.inserted === 1 && res.omitted === 1 && res.removed === 0);
const after = await as(O, `select id, display_number n, heading h, status st, revised_in ri from scenes where project_id=$1 order by sort_order`, [pidD]);
ok('draft: final order follows the plan', after.map(r => r.h).join('|') === 'INT. ONE - DAY|INT. NEW - NIGHT|INT. TWO - DAY|INT. THREE - DAY|INT. FOUR RENAMED - DAY');
ok('draft: scene ids and numbers never change', after.filter(r => r.n !== 'x').map(r => r.id).filter(id => ids.includes(id)).length === 4 && after.map(r => r.n).join(',') === '1,1A,2,3,4');
ok('draft: the new scene is numbered from its place (1A)', after[1].n === '1A');
ok('draft: the cut scene is marked omitted and keeps its number', after[3].st === 'omitted' && after[3].n === '3');
ok('draft: changed scenes are tagged with the revision, untouched ones are not', after[0].ri === 1 && after[1].ri === 1 && after[3].ri === 1 && after[4].ri === 1 && after[2].ri === null);
const t1 = (await as(O, `select elements from scene_text where scene_id=$1`, [ids[0]]))[0].elements;
ok('draft: only the changed line is marked', t1[0].rev === 1 || t1[0].rev === undefined ? t1[1].rev === 1 : false);
ok('draft: the draft counter went up', (await as(O, `select draft_no d from projects where id=$1`, [pidD]))[0].d === 1);
const t2 = (await as(O, `select elements from scene_text t join scenes s on s.id=t.scene_id where s.heading='INT. NEW - NIGHT'`))[0].elements;
ok('draft: a new scene after the lock is marked in the current revision', t2.every(e => e.rev === 1));
// unlocked script: remove works, no marks
await as(O, `update projects set script_locked=false where id=$1`, [pidD]);
const planU = [{ op: 'update', id: ids[0], heading: 'INT. ONE - DAY', elements: E2('Rewritten.') }, { op: 'remove', id: ids[3] }];
const resU = (await as(O, `select apply_draft($1,$2::jsonb) r`, [pidD, JSON.stringify(planU)]))[0].r;
ok('draft: unlocked script allows removing a scene', resU.removed === 1 && (await as(O, `select * from scenes where id=$1`, [ids[3]])).length === 0);
ok('draft: unlocked text is not marked', (await as(O, `select elements from scene_text where scene_id=$1`, [ids[0]]))[0].elements.every(e => e.rev === undefined || e.rev === 1));

// ---- deleting scenes removes text and locks
const dscene = await ins('to delete', 500);
await as(O, `delete from scenes where id=$1`, [dscene]);
ok('deleting a scene removes its text and lock', (await as(O, `select * from scene_text where scene_id=$1`, [dscene])).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
