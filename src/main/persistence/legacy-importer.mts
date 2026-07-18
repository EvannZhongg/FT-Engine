import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'

import type {
  LegacyImportContestant,
  LegacyImportGroup,
  LegacyProjectImport,
  LocalDatabase,
  StoredScoreEvent
} from './local-database.mts'


interface LegacyRefereeConfig {
  index?: number
  name?: string
  mode?: 'SINGLE' | 'DUAL'
}

interface LegacyGroupConfig {
  name?: string
  players?: string[]
  referees?: LegacyRefereeConfig[]
}

interface LegacyConfig {
  project_name?: string
  mode?: 'FREE' | 'TOURNAMENT'
  created_at?: string
  groups?: LegacyGroupConfig[]
  media?: Record<string, Record<string, {
    provider?: string
    video_id?: string
    canonical_url?: string
  }>>
}

interface CsvFile {
  path: string
  refereeIndex: number
}

export interface LegacyImportRunResult {
  projects: number
  imported: number
  events: number
  errors: Array<{ sourceKey: string; message: string }>
}

export function importLegacyProjects(database: LocalDatabase, legacyRoot: string): LegacyImportRunResult {
  const result: LegacyImportRunResult = { projects: 0, imported: 0, events: 0, errors: [] }
  if (!existsSync(legacyRoot)) return result
  const projects = readdirSync(legacyRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))

  for (const entry of projects) {
    const projectPath = path.join(legacyRoot, entry.name)
    if (!existsSync(path.join(projectPath, 'config.json'))) continue
    result.projects += 1
    try {
      const imported = database.importLegacyProject(buildLegacyProjectImport(projectPath))
      if (imported.imported) result.imported += 1
      result.events += imported.eventCount
    } catch (error) {
      result.errors.push({
        sourceKey: entry.name,
        message: error instanceof Error ? error.message : 'Legacy import failed'
      })
    }
  }
  return result
}

export function buildLegacyProjectImport(projectPath: string): LegacyProjectImport {
  const resolvedProject = path.resolve(projectPath)
  const configPath = path.join(resolvedProject, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as LegacyConfig
  const sourceKey = path.basename(resolvedProject)
  const sourceHash = hashProjectFiles(resolvedProject)
  const competitionId = stableId(sourceKey, 'competition')
  const stageId = stableId(sourceKey, 'stage', '0')
  const mode = config.mode === 'TOURNAMENT' ? 'TOURNAMENT' : 'FREE'
  const groups = (Array.isArray(config.groups) ? config.groups : []).map(
    (group, groupPosition) => buildGroup(
      sourceKey,
      resolvedProject,
      stageId,
      group,
      groupPosition,
      config.media ?? {}
    )
  )
  return {
    sourceKey,
    sourceHash,
    competition: {
      id: competitionId,
      name: String(config.project_name || sourceKey),
      mode,
      createdAt: normalizeLegacyTimestamp(config.created_at || sourceKey.slice(0, 15))
    },
    stage: {
      id: stageId,
      name: mode === 'FREE' ? 'Free Scoring' : 'Main Event'
    },
    groups
  }
}

function buildGroup(
  sourceKey: string,
  projectPath: string,
  stageId: string,
  config: LegacyGroupConfig,
  position: number,
  mediaConfig: NonNullable<LegacyConfig['media']>
): LegacyImportGroup {
  const name = String(config.name || `Group ${position + 1}`)
  const groupId = stableId(sourceKey, 'group', String(position), name)
  const groupPath = path.join(projectPath, safeLegacyName(name, 'Default_Group'))
  const csvFiles = listCsvFiles(groupPath)
  const configuredReferees = new Map(
    (Array.isArray(config.referees) ? config.referees : [])
      .filter((referee) => Number.isSafeInteger(Number(referee.index)))
      .map((referee) => [Number(referee.index), referee])
  )
  const refereeIndexes = new Set([
    ...configuredReferees.keys(),
    ...csvFiles.map((file) => file.refereeIndex)
  ])
  const referees = [...refereeIndexes].sort((left, right) => left - right).map((index) => {
    const referee = configuredReferees.get(index)
    return {
      id: stableId(sourceKey, 'group', String(position), 'referee', String(index)),
      name: String(referee?.name || `Referee ${index}`),
      storageIndex: position * 100000 + index,
      sourceIndex: index,
      mode: referee?.mode === 'DUAL' ? 'DUAL' as const : 'SINGLE' as const
    }
  })
  const refereeIds = new Map(referees.map((referee) => [referee.sourceIndex, referee.id]))
  const players = Array.isArray(config.players) ? config.players.map(String) : []
  const contestants = players.map((player, playerPosition) => buildContestant(
    sourceKey,
    groupId,
    name,
    player,
    playerPosition,
    csvFiles,
    refereeIds,
    mediaConfig[name]?.[player]
  ))
  return { id: groupId, name, position, contestants, referees }
}

function buildContestant(
  sourceKey: string,
  groupId: string,
  groupName: string,
  name: string,
  position: number,
  csvFiles: CsvFile[],
  refereeIds: Map<number, string>,
  mediaConfig?: { provider?: string; video_id?: string; canonical_url?: string }
): LegacyImportContestant {
  const contestantId = stableId(sourceKey, groupId, 'contestant', String(position), name)
  const sessionId = stableId(sourceKey, contestantId, 'session', '1')
  const prefix = `${safeLegacyName(name, 'Unknown_Player')}_Ref`
  const events = csvFiles
    .filter((file) => path.basename(file.path).startsWith(prefix))
    .flatMap((file) => readScoreEvents(
      sourceKey,
      sessionId,
      refereeIds.get(file.refereeIndex) ?? null,
      file,
      groupName,
      name
    ))
    .sort((left, right) =>
      left.systemTime.localeCompare(right.systemTime) || left.eventId.localeCompare(right.eventId)
    )
  const provider = String(mediaConfig?.provider || '')
  const mediaId = String(mediaConfig?.video_id || '')
  const canonicalUrl = String(mediaConfig?.canonical_url || '')
  const media = provider && mediaId && canonicalUrl ? {
    id: stableId(sourceKey, contestantId, 'media', provider),
    provider,
    mediaId,
    canonicalUrl
  } : undefined
  return { id: contestantId, name, position, sessionId, events, media }
}

function readScoreEvents(
  sourceKey: string,
  sessionId: string,
  refereeId: string | null,
  file: CsvFile,
  groupName: string,
  contestantName: string
): StoredScoreEvent[] {
  const workbook = XLSX.read(readFileSync(file.path), { type: 'buffer', raw: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) return []
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true })
  return rows.map((row, rowIndex) => {
    const systemTime = String(row.SystemTime || '')
    const role = String(row.DeviceRole).toUpperCase() === 'SECONDARY' ? 'secondary' : 'primary'
    const eventId = String(row.EventId || stableId(
      sourceKey, groupName, contestantName, String(file.refereeIndex), String(rowIndex)
    ))
    return {
      eventId,
      matchSessionId: sessionId,
      refereeId,
      connectionId: `legacy-ref-${file.refereeIndex}-${role}`,
      deviceId: `legacy-ref-${file.refereeIndex}-${role}`,
      role,
      eventType: integer(row.EventType),
      deviceTimestampMs: integer(row.BLE_Timestamp),
      receivedAt: systemTime,
      systemTime,
      totalPlus: integer(row.TotalPlus),
      totalMinus: integer(row.TotalMinus),
      currentTotal: integer(row.CurrentTotal),
      majorPenalty: integer(row.MajorPenalty || row.penalty),
      mediaProvider: String(row.MediaProvider || ''),
      mediaId: String(row.MediaId || ''),
      mediaTimeMs: optionalInteger(row.MediaTimeMs),
      mediaSyncStatus: String(row.MediaSyncStatus || 'not_ready')
    }
  })
}

function listCsvFiles(groupPath: string): CsvFile[] {
  if (!existsSync(groupPath)) return []
  return readdirSync(groupPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const match = /_Ref(\d+)\.csv$/i.exec(entry.name)
      return match ? {
        path: path.join(groupPath, entry.name),
        refereeIndex: Number(match[1])
      } : null
    })
    .filter((value): value is CsvFile => value !== null)
    .sort((left, right) => left.path.localeCompare(right.path))
}

function hashProjectFiles(projectPath: string): string {
  const files = [path.join(projectPath, 'config.json')]
  for (const group of readdirSync(projectPath, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    const groupPath = path.join(projectPath, group.name)
    for (const file of readdirSync(groupPath, { withFileTypes: true })) {
      if (file.isFile() && file.name.toLowerCase().endsWith('.csv')) {
        files.push(path.join(groupPath, file.name))
      }
    }
  }
  const hash = createHash('sha256')
  for (const file of files.sort()) {
    hash.update(path.relative(projectPath, file).replaceAll('\\', '/'))
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function stableId(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32)
}

function safeLegacyName(value: string, fallback: string): string {
  const safe = [...value].filter((character) => /[\p{L}\p{N} _-]/u.test(character)).join('').trim()
  return safe || fallback
}

function normalizeLegacyTimestamp(value: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(value)
  if (!match) return value
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`
}

function integer(value: unknown): number {
  const parsed = Number.parseInt(String(value || '0'), 10)
  return Number.isSafeInteger(parsed) ? parsed : 0
}

function optionalInteger(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null
  return integer(value)
}
