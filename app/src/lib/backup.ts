// A full copy of one project, made in the browser by the owner or an admin: a zip with every table as JSON,
// the script as a Fountain file, and the storyboard pictures. Nothing is sent anywhere.
import { toFountainFile, type ExportScene } from './exportScript'
import type { Element } from './fountain'
import { BUCKET, framePaths, type Frame } from './storyboard'
import { MOOD_BUCKET, type MoodItem } from './bible'
import { LOC_BUCKET, type LocPhoto } from './locations'
import { supabase } from './supabase'

export const BACKUP_VERSION = 1

async function rows(table: string, col: string, ids: string[] | string): Promise<unknown[]> {
  const q = supabase.from(table).select('*')
  const { data, error } = await (Array.isArray(ids) ? (ids.length ? q.in(col, ids) : Promise.resolve({ data: [], error: null })) : q.eq(col, ids))
  if (error) throw new Error(`${table}: ${error.message}`)
  return (data ?? []) as unknown[]
}

export type BackupProgress = (step: string) => void

export async function buildBackup(pid: string, projectName: string, progress: BackupProgress = () => undefined): Promise<{ blob: Blob; files: number; pictures: number }> {
  const { zipSync, strToU8 } = await import('fflate')
  progress('Reading the project')
  const [project] = await rows('projects', 'id', pid) as Record<string, unknown>[]
  const teams = await rows('teams', 'project_id', pid) as { id: string }[]
  const teamIds = teams.map((t) => t.id)
  const members = await rows('members', 'project_id', pid) as { id: string; account_id: string | null }[]
  const scenes = await rows('scenes', 'project_id', pid) as { id: string; number?: string; display_number: string | null; heading: string; status: string; revised_in: number | null; sort_order: number }[]
  const sceneIds = scenes.map((s) => s.id)
  const [access, memberTeams, texts, shots, frames, profiles, bible, mood, locs, locContacts, locCosts, locScenes, locAvail, locPhotos] = await Promise.all([
    rows('team_section_access', 'team_id', teamIds), rows('member_teams', 'team_id', teamIds), rows('scene_text', 'scene_id', sceneIds),
    rows('shots', 'project_id', pid), rows('storyboard_frames', 'project_id', pid),
    rows('profiles', 'id', members.map((m) => m.account_id).filter((x): x is string => Boolean(x))),
    rows('project_bible', 'project_id', pid), rows('moodboard_items', 'project_id', pid),
    rows('locations', 'project_id', pid), rows('location_contacts', 'project_id', pid), rows('location_costs', 'project_id', pid),   // contacts and costs come back only to those who may see them
    rows('location_scenes', 'project_id', pid), rows('location_availability', 'project_id', pid), rows('location_photos', 'project_id', pid),
  ])
  const data = { app: 'LineBoard', version: BACKUP_VERSION, made_at: new Date().toISOString(), project, teams, team_section_access: access, members, member_teams: memberTeams, profiles, scenes, scene_text: texts, shots, storyboard_frames: frames, project_bible: bible, moodboard_items: mood, locations: locs, location_contacts: locContacts, location_costs: locCosts, location_scenes: locScenes, location_availability: locAvail, location_photos: locPhotos }

  const byScene = new Map((texts as { scene_id: string; elements: Element[] }[]).map((t) => [t.scene_id, t.elements]))
  const script: ExportScene[] = [...scenes].sort((a, b) => a.sort_order - b.sort_order).map((s) => ({
    number: s.display_number, heading: s.heading, omitted: s.status === 'omitted', elements: byScene.get(s.id) ?? [], revisedIn: s.revised_in,
  }))

  const files: Record<string, Uint8Array> = {
    'backup.json': strToU8(JSON.stringify(data, null, 2)),
    'script.fountain': strToU8(toFountainFile(script)),
    'README.txt': strToU8(`LineBoard backup of "${projectName}", made ${new Date().toLocaleString()}.\nbackup.json holds every table. script.fountain is the script. storyboard/ holds the frame pictures and moodboard/ the moodboard pictures, under the same paths the database refers to.\n`),
  }
  const paths = (frames as Frame[]).flatMap(framePaths)
  let pictures = 0
  for (const [i, path] of paths.entries()) {
    progress(`Storyboard pictures ${i + 1} of ${paths.length}`)
    const { data: blob, error } = await supabase.storage.from(BUCKET).download(path)
    if (error || !blob) throw new Error(`A storyboard picture could not be downloaded (${path}).`)
    files['storyboard/' + path] = new Uint8Array(await blob.arrayBuffer()); pictures++
  }
  const moodPaths = (mood as MoodItem[]).flatMap((m) => (m.image_path ? [m.image_path] : []))
  for (const [i, path] of moodPaths.entries()) {
    progress(`Moodboard pictures ${i + 1} of ${moodPaths.length}`)
    const { data: blob, error } = await supabase.storage.from(MOOD_BUCKET).download(path)
    if (error || !blob) throw new Error(`A moodboard picture could not be downloaded (${path}).`)
    files['moodboard/' + path] = new Uint8Array(await blob.arrayBuffer()); pictures++
  }
  const locPaths = (locPhotos as LocPhoto[]).map((p) => p.path)
  for (const [i, path] of locPaths.entries()) {
    progress(`Location pictures ${i + 1} of ${locPaths.length}`)
    const { data: blob, error } = await supabase.storage.from(LOC_BUCKET).download(path)
    if (error || !blob) throw new Error(`A location picture could not be downloaded (${path}).`)
    files['locations/' + path] = new Uint8Array(await blob.arrayBuffer()); pictures++
  }
  progress('Packing the file')
  const zip = zipSync(files, { level: 0 })   // pictures are JPEGs already; skipping compression keeps it quick
  return { blob: new Blob([zip as BlobPart], { type: 'application/zip' }), files: Object.keys(files).length, pictures }
}
