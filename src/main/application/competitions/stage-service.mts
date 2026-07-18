import type { CompetitionStageConfig, StageConfigInput } from '../../../shared/contracts/stage.mts'
import { normalizeCompetitionGroups } from './competition-service.mts'

export interface StageRepository {
  list(competitionId: string): CompetitionStageConfig[]
  create(competitionId: string, input: StageConfigInput): CompetitionStageConfig
  update(stageId: string, input: StageConfigInput): CompetitionStageConfig
  reorder(competitionId: string, stageIds: string[]): CompetitionStageConfig[]
  delete(stageId: string): boolean
  activate(stageId: string): CompetitionStageConfig
  complete(stageId: string): CompetitionStageConfig
}

export class StageService {
  private readonly repository: StageRepository

  constructor(repository: StageRepository) {
    this.repository = repository
  }

  list(competitionId: unknown): CompetitionStageConfig[] {
    return this.repository.list(normalizeId(competitionId))
  }

  create(competitionId: unknown, input: unknown): CompetitionStageConfig {
    return this.repository.create(normalizeId(competitionId), normalizeStageInput(input))
  }

  update(stageId: unknown, input: unknown): CompetitionStageConfig {
    return this.repository.update(normalizeId(stageId), normalizeStageInput(input))
  }

  reorder(competitionId: unknown, stageIds: unknown): CompetitionStageConfig[] {
    const id = normalizeId(competitionId)
    if (!Array.isArray(stageIds) || stageIds.length < 1 || stageIds.length > 64) {
      throw new Error('STAGE_ORDER_INVALID')
    }
    const normalized = stageIds.map(normalizeId)
    if (new Set(normalized).size !== normalized.length) throw new Error('STAGE_ORDER_INVALID')
    return this.repository.reorder(id, normalized)
  }

  delete(stageId: unknown): boolean {
    return this.repository.delete(normalizeId(stageId))
  }

  activate(stageId: unknown): CompetitionStageConfig {
    return this.repository.activate(normalizeId(stageId))
  }

  complete(stageId: unknown): CompetitionStageConfig {
    return this.repository.complete(normalizeId(stageId))
  }
}

export function normalizeStageInput(value: unknown): StageConfigInput {
  if (!isRecord(value)) throw new Error('STAGE_CONFIG_INVALID')
  const name = normalizeName(value.name)
  if (
    !Number.isSafeInteger(value.attempts) ||
    Number(value.attempts) < 1 ||
    Number(value.attempts) > 20
  ) {
    throw new Error('STAGE_CONFIG_INVALID')
  }
  try {
    return {
      name,
      attempts: Number(value.attempts),
      groups: normalizeCompetitionGroups(value.groups, { allowEmpty: true })
    }
  } catch {
    throw new Error('STAGE_CONFIG_INVALID')
  }
}

function normalizeId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 128) {
    throw new Error('STAGE_ID_INVALID')
  }
  return value
}

function normalizeName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 128) {
    throw new Error('STAGE_CONFIG_INVALID')
  }
  return value.trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
