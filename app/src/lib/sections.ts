import type { SectionKey } from './types'

// path: URL segment. key: the permission section the owner controls (null = fixed rule).
export interface SectionDef {
  path: string; label: string; icon: string; key: SectionKey | null
  fixed?: 'everyone' | 'team' | 'export'
  phoneSlot?: 'home' | 'shots' | 'call'
}

export const SECTIONS: SectionDef[] = [
  { path: '', icon: 's_overview', label: 'Overview', key: null, fixed: 'everyone', phoneSlot: 'home' },
  { path: 'script', icon: 's_script', label: 'Script', key: 'script' },
  { path: 'shots', icon: 's_shots', label: 'Shot list', key: 'shots', phoneSlot: 'shots' },
  { path: 'storyboard', icon: 's_storyboard', label: 'Storyboard', key: 'shots' },
  { path: 'breakdown', icon: 's_breakdown', label: 'Breakdown', key: 'breakdown' },
  { path: 'cast', icon: 's_cast', label: 'Cast and crew', key: 'cast_crew' },
  { path: 'props', icon: 's_props', label: 'Props', key: 'props' },
  { path: 'equipment', icon: 's_equipment', label: 'Equipment', key: 'equipment' },
  { path: 'schedule', icon: 's_schedule', label: 'Schedule', key: 'schedule' },
  { path: 'callsheets', icon: 's_callsheets', label: 'Call sheets', key: 'call_sheets', phoneSlot: 'call' },
  { path: 'team', icon: 's_team', label: 'Team and access', key: null, fixed: 'team' },
  { path: 'bible', icon: 's_bible', label: 'Project bible', key: 'bible' },
  { path: 'export', icon: 's_export', label: 'Export and settings', key: null, fixed: 'export' },
]

export const SECTION_LABELS: Record<SectionKey, string> = {
  script: 'Script', shots: 'Shot list and storyboard', cast_crew: 'Cast and crew',
  props: 'Props', equipment: 'Equipment', breakdown: 'Breakdown', schedule: 'Schedule', call_sheets: 'Call sheets', bible: 'Project bible',
}
export const SECTION_KEYS = Object.keys(SECTION_LABELS) as SectionKey[]

// Order the ten default departments the way the database creates them.
export const DEPARTMENT_ORDER = ['Direction', 'Production', 'Camera', 'Lighting and grip', 'Sound', 'Art', 'Costume', 'Makeup and hair', 'VFX', 'Post']
