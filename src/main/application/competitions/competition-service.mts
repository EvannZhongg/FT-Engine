import type {
  CompetitionConfig,
  CompetitionGroupConfig,
  CompetitionListItem,
  CompetitionMode,
  CompetitionRefereeConfig
} from '../../../shared/contracts/competition.mts'

export interface CompetitionCreateInput {
  projectName: string
  mode: CompetitionMode
}

export interface CompetitionUpdateInput extends CompetitionCreateInput {
  groups: CompetitionGroupConfig[]
}

export interface CompetitionRepository {
  create(input: CompetitionCreateInput): CompetitionConfig
  update(sourceKey: string, input: CompetitionUpdateInput): CompetitionConfig
  get(sourceKey: string): CompetitionConfig | null
  list(): CompetitionListItem[]
  delete(sourceKey: string): boolean
}

export class CompetitionService {
  private readonly repository: CompetitionRepository

  constructor(repository: CompetitionRepository) {
    this.repository = repository
  }

  create(projectName: unknown, mode: unknown): CompetitionConfig {
    return this.repository.create(normalizeCreateInput(projectName, mode))
  }

  update(sourceKey: unknown, input: unknown): CompetitionConfig {
    const key = normalizeSourceKey(sourceKey)
    if (!isRecord(input)) throw new Error('COMPETITION_CONFIG_INVALID')
    return this.repository.update(
      key,
      normalizeUpdateInput(input.projectName, input.mode, input.groups)
    )
  }

  get(sourceKey: unknown): CompetitionConfig | null {
    return this.repository.get(normalizeSourceKey(sourceKey))
  }

  list(): CompetitionListItem[] {
    return this.repository.list()
  }

  delete(sourceKey: unknown): boolean {
    return this.repository.delete(normalizeSourceKey(sourceKey))
  }
}

export function normalizeCreateInput(projectName: unknown, mode: unknown): CompetitionCreateInput {
  if (
    typeof projectName !== 'string' ||
    !projectName.trim() ||
    projectName.trim().length > 128 ||
    (mode !== 'FREE' && mode !== 'TOURNAMENT')
  ) {
    throw new Error('COMPETITION_CONFIG_INVALID')
  }
  return { projectName: projectName.trim(), mode }
}

export function normalizeUpdateInput(
  projectName: unknown,
  mode: unknown,
  groups: unknown
): CompetitionUpdateInput {
  const create = normalizeCreateInput(projectName, mode)
  const normalizedGroups = normalizeCompetitionGroups(groups)
  return { ...create, groups: normalizedGroups }
}

export function normalizeCompetitionGroups(
  groups: unknown,
  options: { allowEmpty?: boolean } = {}
): CompetitionGroupConfig[] {
  const minimum = options.allowEmpty === true ? 0 : 1
  if (!Array.isArray(groups) || groups.length < minimum || groups.length > 64) {
    throw new Error('COMPETITION_CONFIG_INVALID')
  }
  const names = new Set<string>()
  return groups.map((group) => {
    const normalized = normalizeGroup(group)
    if (names.has(normalized.name)) throw new Error('COMPETITION_CONFIG_INVALID')
    names.add(normalized.name)
    return normalized
  })
}

export function hasSameCompetitionStructure(
  current: CompetitionConfig,
  input: CompetitionUpdateInput
): boolean {
  return (
    JSON.stringify({
      projectName: current.project_name,
      mode: current.mode,
      groups: current.groups.map(structuralGroup)
    }) ===
    JSON.stringify({
      projectName: input.projectName,
      mode: input.mode,
      groups: input.groups.map(structuralGroup)
    })
  )
}

function normalizeGroup(value: unknown): CompetitionGroupConfig {
  if (!isRecord(value)) throw new Error('COMPETITION_CONFIG_INVALID')
  const name = normalizedText(value.name, 128)
  if (
    !Number.isSafeInteger(value.refCount) ||
    Number(value.refCount) < 1 ||
    Number(value.refCount) > 32 ||
    !Array.isArray(value.players) ||
    value.players.length < 1 ||
    value.players.length > 2000 ||
    !Array.isArray(value.referees) ||
    value.referees.length > Number(value.refCount)
  ) {
    throw new Error('COMPETITION_CONFIG_INVALID')
  }
  const playerNames = new Set<string>()
  const players = value.players.map((player) => {
    const normalized = normalizedText(player, 128)
    if (playerNames.has(normalized)) throw new Error('COMPETITION_CONFIG_INVALID')
    playerNames.add(normalized)
    return normalized
  })
  const refereeIndexes = new Set<number>()
  const deviceIds = new Set<string>()
  const referees = value.referees.map((referee) => {
    const normalized = normalizeReferee(referee)
    if (refereeIndexes.has(normalized.index)) {
      throw new Error('COMPETITION_CONFIG_INVALID')
    }
    refereeIndexes.add(normalized.index)
    for (const deviceId of [normalized.pri_addr, normalized.sec_addr]) {
      if (!deviceId) continue
      if (deviceIds.has(deviceId)) throw new Error('COMPETITION_CONFIG_INVALID')
      deviceIds.add(deviceId)
    }
    return normalized
  })
  return { name, refCount: Number(value.refCount), players, referees }
}

function normalizeReferee(value: unknown): CompetitionRefereeConfig {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.index) ||
    Number(value.index) < 1 ||
    Number(value.index) > 1000 ||
    (value.mode !== 'SINGLE' && value.mode !== 'DUAL')
  ) {
    throw new Error('COMPETITION_CONFIG_INVALID')
  }
  const priAddr = optionalId(value.pri_addr)
  const secAddr = value.mode === 'DUAL' ? optionalId(value.sec_addr) : ''
  return {
    index: Number(value.index),
    name: normalizedText(value.name || `Referee ${value.index}`, 128),
    mode: value.mode,
    pri_addr: priAddr,
    sec_addr: secAddr
  }
}

function structuralGroup(group: CompetitionGroupConfig): unknown {
  return {
    name: group.name,
    refCount: group.refCount,
    players: group.players,
    referees: group.referees.map(({ index, name, mode }) => ({ index, name, mode }))
  }
}

function normalizeSourceKey(value: unknown): string {
  return normalizedText(value, 256)
}

function normalizedText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new Error('COMPETITION_CONFIG_INVALID')
  }
  return value.trim()
}

function optionalId(value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string' || value.length > 128) {
    throw new Error('COMPETITION_CONFIG_INVALID')
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
