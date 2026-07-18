export type CompetitionMode = 'FREE' | 'TOURNAMENT'
export type CompetitionRefereeMode = 'SINGLE' | 'DUAL'

export interface CompetitionRefereeConfig {
  index: number
  name: string
  mode: CompetitionRefereeMode
  pri_addr: string
  sec_addr: string
}

export interface CompetitionGroupConfig {
  name: string
  refCount: number
  players: string[]
  referees: CompetitionRefereeConfig[]
}

export interface CompetitionConfig {
  project_name: string
  mode: CompetitionMode
  created_at: string
  source_key: string
  groups: CompetitionGroupConfig[]
  media: Record<
    string,
    Record<string, { provider: string; video_id: string; canonical_url: string }>
  >
}

export interface CompetitionListItem extends CompetitionConfig {
  dir_name: string
}
