// A full copy of one project, made in the browser by the owner or an admin: a zip with every table as JSON,
// the script as a Fountain file, and the storyboard pictures. Nothing is sent anywhere.
import { toFountainFile, type ExportScene } from './exportScript'
import type { Element } from './fountain'
import { BUCKET, framePaths, type Frame } from './storyboard'
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
  const [access, memberTeams, texts, shots, frames, profiles] = await Promise.all([
    rows('team_section_access', 'team_id', teamIds), rows('member_teams', 'team_id', teamIds), rows('scene_text', 'scene_id', sceneIds),
    rows('shots', 'project_id', pid), rows('storyboard_frames', 'project_id', pid),
    rows('profiles', 'id', members.map((m) => m.account_id).filter((x): x is string => Boolean(x))),
  ])
  const data = { app: 'LineBoard 2.0', version: BACKUP_VERSION, made_at: new Date().toISOString(), project, teams, team_section_access: access, members, member_teams: memberTeams, profiles, scenes, scene_text: texts, shots, storyboard_frames: frames }

  const byScene = new Map((texts as { scene_id: string; elements: Element[] }[]).map((t) => [t.scene_id, t.elements]))
  const script: ExportScene[] = [...scenes].sort((a, b) => a.sort_order - b.sort_order).map((s) => ({
    number: s.display_number, heading: s.heading, omitted: s.status === 'omitted', elements: byScene.get(s.id) ?? [], revisedIn: s.revised_in,
  }))

  const files: Record<string, Uint8Array> = {
    'backup.json': strToU8(JSON.stringify(data, null, 2)),
    'script.fountain': strToU8(toFountainFile(script)),
    'README.txt': strToU8(`LineBoard 2.0 backup of "${projectName}", made ${new Date().toLocaleString()}.\nbackup.json holds every table. script.fountain is the script. storyboard/ holds the frame pictures, under the same paths the database refers to.\n`),
  }
  const paths = (frames as Frame[]).flatMap(framePaths)
  let pictures = 0
  for (const [i, path] of paths.entries()) {
    progress(`Storyboard pictures ${i + 1} of ${paths.length}`)
    const { data: blob, error } = await supabase.storage.from(BUCKET).download(path)
    if (error || !blob) throw new Error(`A storyboard picture could not be downloaded (${path}).`)
    files['storyboard/' + path] = new Uint8Array(await blob.arrayBuffer()); pictures++
  }
  progress('Packing the file')
  const zip = zipSync(files, { level: 0 })   // pictures are JPEGs already; skipping compression keeps it quick
  return { blob: new Blob([zip as BlobPart], { type: 'application/zip' }), files: Object.keys(files).length, pictures }
}
