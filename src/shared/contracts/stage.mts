import type { CompetitionGroupConfig } from './competition.mts'

export type CompetitionStatus = 'draft' | 'active' | 'completed' | 'archived'
export type StageStatus = 'draft' | 'active' | 'completed'

export interface CompetitionStageConfig {
  id: string
  competitionId: string
  name: string
  position: number
  status: StageStatus
  attempts: number
  groups: CompetitionGroupConfig[]
}

export interface StageConfigInput {
  name: string
  attempts: number
  groups: CompetitionGroupConfig[]
}
