export type CompetitionMode = 'FREE' | 'TOURNAMENT'
export type CompetitionRefereeMode = 'SINGLE' | 'DUAL'

export interface CompetitionRefereeConfig {
  index: number
  name: string
  mode: CompetitionRefereeMode
  primaryDeviceId: string
  secondaryDeviceId: string
}

export interface CompetitionGroupConfig {
  name: string
  refCount: number
  players: string[]
  referees: CompetitionRefereeConfig[]
}

export interface CompetitionConfig {
  id: string
  name: string
  mode: CompetitionMode
  createdAt: string
  groups: CompetitionGroupConfig[]
  media: Record<
    string,
    Record<string, { provider: string; video_id: string; canonical_url: string }>
  >
}

export type CompetitionListItem = CompetitionConfig
