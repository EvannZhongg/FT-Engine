import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  type CompetitionCreateInput,
  type CompetitionUpdateInput,
  hasSameCompetitionStructure
} from '../application/competitions/competition-service.mts'
import type {
  CompetitionExportSnapshot,
  ExportScoreEvent
} from '../application/exports/export-service.mts'
import {
  createDefaultAppSettings,
  isAppSettingKey,
  normalizeAppSetting,
  type AppSettings
} from '../application/settings/app-settings.mts'
import type {
  CompetitionConfig,
  CompetitionGroupConfig,
  CompetitionListItem,
  CompetitionRefereeConfig
} from '../../shared/contracts/competition.mts'
import { SqliteConnection } from './sqlite/connection.mts'

export { DATABASE_APPLICATION_ID, LATEST_SCHEMA_VERSION } from './sqlite/schema.mts'

export interface StoredScoreEvent {
  eventId: string
  matchSessionId?: string | null
  refereeId?: string | null
  connectionId: string
  deviceId: string
  role: 'primary' | 'secondary'
  eventType: number
  deviceTimestampMs: number
  receivedAt: string
  systemTime: string
  totalPlus: number
  totalMinus: number
  currentTotal: number
  majorPenalty: number
  mediaProvider?: string
  mediaId?: string
  mediaTimeMs?: number | null
  mediaSyncStatus?: string
}

export interface MatchScoreEventWrite {
  sourceKey: string
  groupName: string
  contestantName: string
  refereeIndex: number
  event: Omit<StoredScoreEvent, 'matchSessionId' | 'refereeId'>
}

export type MatchScoreEventWriteResult =
  | { status: 'inserted' }
  | { status: 'duplicate' }
  | { status: 'context_missing' }

export interface ReplayEvent {
  event_id: string
  system_time: string
  ble_timestamp: number
  referee_index: number
  referee_name: string
  device_role: 'PRIMARY' | 'SECONDARY'
  event_type: number
  delta_plus: number
  delta_minus: number
  delta_penalty: number
  total_plus: number
  total_minus: number
  major_penalty: number
  current_total: number
  media_provider: string
  media_id: string
  media_time_ms: number | null
  media_sync_status: string
}

export interface CompetitionReport {
  status: 'ok'
  config: CompetitionConfig
  scores: Record<
    string,
    Record<string, Record<number, { total: number; plus: number; minus: number; penalty: number }>>
  >
}

export class LocalDatabase {
  private readonly connection: SqliteConnection

  constructor(databasePath: string, backupRoot: string) {
    this.connection = new SqliteConnection(databasePath, backupRoot)
  }

  get databasePath(): string {
    return this.connection.databasePath
  }

  get backupRoot(): string {
    return this.connection.backupRoot
  }

  open(): void {
    this.connection.open()
  }

  close(): void {
    this.connection.close()
  }

  getSchemaVersion(): number {
    return this.connection.getSchemaVersion()
  }

  getApplicationId(): number {
    return this.connection.getApplicationId()
  }

  listTableNames(): string[] {
    return this.connection.listTableNames()
  }

  getAppSettings(): AppSettings {
    const settings = createDefaultAppSettings()
    const rows = this.requireDatabase()
      .prepare('SELECT key, value_json FROM app_settings')
      .all() as Array<{ key: string; value_json: string }>
    for (const row of rows) {
      if (!isAppSettingKey(row.key)) continue
      try {
        Object.assign(settings, {
          [row.key]: normalizeAppSetting(row.key, JSON.parse(row.value_json))
        })
      } catch {
        // Keep the stable default when one setting row is corrupt.
      }
    }
    return settings
  }

  setAppSetting(key: string, value: unknown): AppSettings {
    if (!isAppSettingKey(key)) throw new Error('SETTINGS_KEY_INVALID')
    const normalized = normalizeAppSetting(key, value)
    this.requireDatabase()
      .prepare(
        `
      INSERT INTO app_settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `
      )
      .run(key, JSON.stringify(normalized), new Date().toISOString())
    return this.getAppSettings()
  }

  createCompetition(input: CompetitionCreateInput): CompetitionConfig {
    const database = this.requireDatabase()
    const competitionId = randomUUID()
    const stageId = randomUUID()
    const now = new Date().toISOString()
    database.exec('BEGIN IMMEDIATE')
    try {
      database
        .prepare(
          `
        INSERT INTO competitions (id, name, mode, status, created_at, updated_at)
        VALUES (?, ?, ?, 'draft', ?, ?)
      `
        )
        .run(competitionId, input.projectName, input.mode, now, now)
      database
        .prepare(
          `
        INSERT INTO stages (id, competition_id, name, position, status, attempts)
        VALUES (?, ?, 'Main', 0, 'draft', 1)
      `
        )
        .run(stageId, competitionId)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return this.requireCompetitionConfig(competitionId)
  }

  updateCompetition(sourceKey: string, input: CompetitionUpdateInput): CompetitionConfig {
    const database = this.requireDatabase()
    const competition = this.resolveCompetition(database, sourceKey)
    if (!competition) throw new Error('COMPETITION_NOT_FOUND')
    const current = this.requireCompetitionConfig(sourceKey)
    const hasEvents = this.countCompetitionEvents(database, competition.id) > 0
    if (hasEvents && !hasSameCompetitionStructure(current, input)) {
      throw new Error('COMPETITION_STRUCTURE_LOCKED')
    }

    database.exec('BEGIN IMMEDIATE')
    try {
      database
        .prepare('UPDATE competitions SET name = ?, mode = ?, updated_at = ? WHERE id = ?')
        .run(input.projectName, input.mode, new Date().toISOString(), competition.id)
      if (hasEvents) {
        this.updateCompetitionBindings(database, competition.id, sourceKey, input.groups)
      } else {
        this.replaceCompetitionGraph(database, competition.id, sourceKey, input.groups)
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return this.requireCompetitionConfig(sourceKey)
  }

  getCompetitionConfig(sourceKey: string): CompetitionConfig | null {
    const database = this.requireDatabase()
    const competition = this.resolveCompetition(database, sourceKey)
    if (!competition) return null
    const stage = this.firstStage(database, competition.id)
    if (!stage) return null
    const groupRows = database
      .prepare(
        `
      SELECT id, name, referee_count
      FROM competition_groups WHERE stage_id = ? ORDER BY position
    `
      )
      .all(stage.id) as Array<{ id: string; name: string; referee_count: number }>
    const groups = groupRows.map((group) => {
      const players = database
        .prepare('SELECT name FROM contestants WHERE group_id = ? ORDER BY position')
        .all(group.id) as Array<{ name: string }>
      const referees = database
        .prepare(
          `
        SELECT r.referee_index, r.name, r.mode,
          MAX(CASE WHEN db.role = 'primary' THEN db.device_id ELSE '' END) AS pri_addr,
          MAX(CASE WHEN db.role = 'secondary' THEN db.device_id ELSE '' END) AS sec_addr
        FROM referees r
        LEFT JOIN device_bindings db ON db.referee_id = r.id
        WHERE r.group_id = ?
        GROUP BY r.id
        ORDER BY r.referee_index
      `
        )
        .all(group.id) as Array<Record<string, string | number>>
      return {
        name: group.name,
        refCount: Number(group.referee_count),
        players: players.map((player) => player.name),
        referees: referees.map((referee) => ({
          index: Number(referee.referee_index),
          name: String(referee.name),
          mode: referee.mode === 'DUAL' ? ('DUAL' as const) : ('SINGLE' as const),
          pri_addr: String(referee.pri_addr || ''),
          sec_addr: String(referee.sec_addr || '')
        }))
      }
    })
    const mediaRows = database
      .prepare(
        `
      SELECT g.name AS group_name, p.name AS contestant_name,
        mb.provider, mb.media_id, mb.canonical_url
      FROM competition_groups g
      JOIN contestants p ON p.group_id = g.id
      JOIN media_bindings mb ON mb.contestant_id = p.id
      WHERE g.stage_id = ?
    `
      )
      .all(stage.id) as Array<Record<string, string>>
    const media: CompetitionConfig['media'] = {}
    for (const row of mediaRows) {
      media[row.group_name] ??= {}
      media[row.group_name][row.contestant_name] = {
        provider: row.provider,
        video_id: row.media_id,
        canonical_url: row.canonical_url
      }
    }
    return {
      project_name: competition.name,
      mode: competition.mode,
      created_at: competition.createdAt,
      source_key: competition.id,
      groups,
      media
    }
  }

  listCompetitionProjects(): CompetitionListItem[] {
    const rows = this.requireDatabase()
      .prepare('SELECT id FROM competitions ORDER BY updated_at DESC, created_at DESC')
      .all() as Array<{ id: string }>
    return rows.flatMap((row) => {
      const config = this.getCompetitionConfig(row.id)
      return config ? [{ ...config, dir_name: config.source_key }] : []
    })
  }

  deleteCompetition(sourceKey: string): boolean {
    const result = this.requireDatabase()
      .prepare('DELETE FROM competitions WHERE id = ?')
      .run(sourceKey)
    return Number(result.changes) === 1
  }

  hasMatchContext(
    sourceKey: string,
    groupName: string,
    contestantName: string,
    refereeIndexes: number[]
  ): boolean {
    const config = this.getCompetitionConfig(sourceKey)
    const group = config?.groups.find((value) => value.name === groupName)
    if (!group || !group.players.includes(contestantName)) return false
    const configuredIndexes = new Set(group.referees.map((referee) => referee.index))
    return refereeIndexes.every((index) => configuredIndexes.has(index))
  }

  appendMatchScoreEvent(input: MatchScoreEventWrite): MatchScoreEventWriteResult {
    validateScoreEvent(input.event)
    const database = this.requireDatabase()
    database.exec('BEGIN IMMEDIATE')
    try {
      const context = this.resolveMatchContext(database, input)
      if (!context) {
        database.exec('ROLLBACK')
        return { status: 'context_missing' }
      }
      database
        .prepare(
          `
        UPDATE match_sessions
        SET status = 'active', started_at = COALESCE(started_at, ?)
        WHERE id = ?
      `
        )
        .run(input.event.systemTime, context.matchSessionId)
      const inserted = this.insertScoreEvent(database, {
        ...input.event,
        matchSessionId: context.matchSessionId,
        refereeId: context.refereeId
      })
      if (!inserted) {
        database.exec('ROLLBACK')
        return { status: 'duplicate' }
      }
      database.exec('COMMIT')
      return { status: 'inserted' }
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  upsertMediaBinding(
    sourceKey: string,
    groupName: string,
    contestantName: string,
    binding: { provider: string; mediaId: string; canonicalUrl: string }
  ): boolean {
    const database = this.requireDatabase()
    const contestant = this.resolveContestant(database, sourceKey, groupName, contestantName)
    if (!contestant) return false
    database
      .prepare(
        `
      INSERT INTO media_bindings (id, contestant_id, provider, media_id, canonical_url)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(contestant_id, provider) DO UPDATE SET
        media_id = excluded.media_id,
        canonical_url = excluded.canonical_url
    `
      )
      .run(
        stableDatabaseId(sourceKey, contestant.id, 'media', binding.provider),
        contestant.id,
        binding.provider,
        binding.mediaId,
        binding.canonicalUrl
      )
    return true
  }

  listScoredContestants(sourceKey: string, groupName: string): string[] {
    const rows = this.requireDatabase()
      .prepare(
        `
      SELECT DISTINCT p.name, p.position
      FROM competitions c
      JOIN stages s ON s.competition_id = c.id
      JOIN competition_groups g ON g.stage_id = s.id
      JOIN contestants p ON p.group_id = g.id
      JOIN match_sessions ms ON ms.contestant_id = p.id
      JOIN score_events e ON e.match_session_id = ms.id
      WHERE c.id = ? AND g.name = ?
      ORDER BY p.position
    `
      )
      .all(sourceKey, groupName) as Array<{ name: string }>
    return rows.map((row) => row.name)
  }

  getReplay(
    sourceKey: string,
    groupName: string,
    contestantName: string
  ): {
    status: 'ok'
    binding: { provider: string; video_id: string; canonical_url: string } | null
    events: ReplayEvent[]
  } | null {
    const database = this.requireDatabase()
    const contestant = this.resolveContestant(database, sourceKey, groupName, contestantName)
    if (!contestant) return null
    const bindingRow = database
      .prepare(
        `
      SELECT provider, media_id, canonical_url
      FROM media_bindings WHERE contestant_id = ? LIMIT 1
    `
      )
      .get(contestant.id) as
      | { provider: string; media_id: string; canonical_url: string }
      | undefined
    const rows = database
      .prepare(
        `
      SELECT e.*, r.referee_index, r.name AS referee_name
      FROM match_sessions ms
      JOIN score_events e ON e.match_session_id = ms.id
      JOIN referees r ON r.id = e.referee_id
      WHERE ms.contestant_id = ?
      ORDER BY e.system_time, r.referee_index, e.event_id
    `
      )
      .all(contestant.id) as Array<Record<string, string | number | null>>
    const previousByReferee = new Map<number, { plus: number; minus: number; penalty: number }>()
    const events = rows.map((row) => {
      const refereeIndex = Number(row.referee_index)
      const previous = previousByReferee.get(refereeIndex) ?? { plus: 0, minus: 0, penalty: 0 }
      const plus = Number(row.total_plus)
      const minus = Number(row.total_minus)
      const penalty = Number(row.major_penalty)
      previousByReferee.set(refereeIndex, { plus, minus, penalty })
      return {
        event_id: String(row.event_id),
        system_time: String(row.system_time),
        ble_timestamp: Number(row.device_timestamp_ms),
        referee_index: refereeIndex,
        referee_name: String(row.referee_name),
        device_role:
          String(row.role) === 'secondary' ? ('SECONDARY' as const) : ('PRIMARY' as const),
        event_type: Number(row.event_type),
        delta_plus: plus - previous.plus,
        delta_minus: minus - previous.minus,
        delta_penalty: penalty - previous.penalty,
        total_plus: plus,
        total_minus: minus,
        major_penalty: penalty,
        current_total: Number(row.current_total),
        media_provider: String(row.media_provider),
        media_id: String(row.media_id),
        media_time_ms: row.media_time_ms === null ? null : Number(row.media_time_ms),
        media_sync_status: String(row.media_sync_status)
      }
    })
    return {
      status: 'ok',
      binding: bindingRow
        ? {
            provider: bindingRow.provider,
            video_id: bindingRow.media_id,
            canonical_url: bindingRow.canonical_url
          }
        : null,
      events
    }
  }

  getReport(sourceKey: string): CompetitionReport | null {
    const config = this.getCompetitionConfig(sourceKey)
    if (!config) return null
    const rows = this.requireDatabase()
      .prepare(
        `
      SELECT * FROM (
        SELECT g.name AS group_name, p.name AS contestant_name,
          r.referee_index, e.current_total, e.total_plus, e.total_minus,
          e.major_penalty,
          ROW_NUMBER() OVER (
            PARTITION BY p.id, r.id
            ORDER BY e.system_time DESC, e.event_id DESC
          ) AS row_position
        FROM competitions c
        JOIN stages s ON s.competition_id = c.id
        JOIN competition_groups g ON g.stage_id = s.id
        JOIN contestants p ON p.group_id = g.id
        JOIN match_sessions ms ON ms.contestant_id = p.id
        JOIN score_events e ON e.match_session_id = ms.id
        JOIN referees r ON r.id = e.referee_id
        WHERE c.id = ?
      ) WHERE row_position = 1
    `
      )
      .all(sourceKey) as Array<Record<string, string | number>>
    const scores: CompetitionReport['scores'] = {}
    for (const row of rows) {
      const groupName = String(row.group_name)
      const contestantName = String(row.contestant_name)
      scores[groupName] ??= {}
      scores[groupName][contestantName] ??= {}
      scores[groupName][contestantName][Number(row.referee_index)] = {
        total: Number(row.current_total),
        plus: Number(row.total_plus),
        minus: Number(row.total_minus),
        penalty: Number(row.major_penalty)
      }
    }
    return { status: 'ok', config, scores }
  }

  getCompetitionExportSnapshot(sourceKey: string): CompetitionExportSnapshot | null {
    const database = this.requireDatabase()
    if (!this.resolveCompetition(database, sourceKey)) return null
    database.exec('BEGIN')
    try {
      const config = this.getCompetitionConfig(sourceKey)
      const stage = this.firstStage(database, sourceKey)
      if (!config || !stage) {
        database.exec('COMMIT')
        return null
      }
      const rows = database
        .prepare(
          `
        SELECT g.name AS group_name, p.name AS contestant_name,
          r.referee_index, e.event_id, e.system_time, e.total_plus,
          e.total_minus, e.current_total, e.major_penalty
        FROM score_events e
        JOIN match_sessions ms ON ms.id = e.match_session_id
        JOIN contestants p ON p.id = ms.contestant_id
        JOIN competition_groups g ON g.id = p.group_id
        JOIN referees r ON r.id = e.referee_id
        WHERE g.stage_id = ?
        ORDER BY g.position, p.position, r.referee_index, e.system_time, e.event_id
      `
        )
        .all(stage.id) as Array<Record<string, string | number>>
      const events = new Map<string, ExportScoreEvent[]>()
      for (const row of rows) {
        const key = exportEventKey(
          String(row.group_name),
          String(row.contestant_name),
          Number(row.referee_index)
        )
        const values = events.get(key) || []
        values.push({
          eventId: String(row.event_id),
          systemTime: String(row.system_time),
          totalPlus: Number(row.total_plus),
          totalMinus: Number(row.total_minus),
          currentTotal: Number(row.current_total),
          majorPenalty: Number(row.major_penalty)
        })
        events.set(key, values)
      }
      const snapshot: CompetitionExportSnapshot = {
        sourceKey: config.source_key,
        competitionName: config.project_name,
        groups: config.groups.map((group) => ({
          name: group.name,
          refCount: group.refCount,
          contestants: group.players.map((contestantName) => ({
            name: contestantName,
            referees: group.referees.map((referee) => ({
              index: referee.index,
              name: referee.name,
              mode: referee.mode,
              events: events.get(exportEventKey(group.name, contestantName, referee.index)) || []
            }))
          }))
        }))
      }
      database.exec('COMMIT')
      return snapshot
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  getScoreEvents(): StoredScoreEvent[] {
    const rows = this.requireDatabase()
      .prepare('SELECT * FROM score_events ORDER BY system_time, event_id')
      .all() as Array<Record<string, string | number | null>>
    return rows.map((row) => ({
      eventId: String(row.event_id),
      matchSessionId: String(row.match_session_id),
      refereeId: String(row.referee_id),
      connectionId: String(row.connection_id),
      deviceId: String(row.device_id),
      role: row.role === 'secondary' ? 'secondary' : 'primary',
      eventType: Number(row.event_type),
      deviceTimestampMs: Number(row.device_timestamp_ms),
      receivedAt: String(row.received_at),
      systemTime: String(row.system_time),
      totalPlus: Number(row.total_plus),
      totalMinus: Number(row.total_minus),
      currentTotal: Number(row.current_total),
      majorPenalty: Number(row.major_penalty),
      mediaProvider: String(row.media_provider),
      mediaId: String(row.media_id),
      mediaTimeMs: row.media_time_ms === null ? null : Number(row.media_time_ms),
      mediaSyncStatus: String(row.media_sync_status)
    }))
  }

  private resolveCompetition(
    database: DatabaseSync,
    sourceKey: string
  ): { id: string; name: string; mode: 'FREE' | 'TOURNAMENT'; createdAt: string } | null {
    const row = database
      .prepare('SELECT id, name, mode, created_at FROM competitions WHERE id = ?')
      .get(sourceKey) as { id: string; name: string; mode: string; created_at: string } | undefined
    return row
      ? {
          id: row.id,
          name: row.name,
          mode: row.mode === 'TOURNAMENT' ? 'TOURNAMENT' : 'FREE',
          createdAt: row.created_at
        }
      : null
  }

  private firstStage(database: DatabaseSync, competitionId: string): { id: string } | null {
    const row = database
      .prepare('SELECT id FROM stages WHERE competition_id = ? ORDER BY position LIMIT 1')
      .get(competitionId) as { id: string } | undefined
    return row || null
  }

  private resolveContestant(
    database: DatabaseSync,
    sourceKey: string,
    groupName: string,
    contestantName: string
  ): { id: string } | null {
    const row = database
      .prepare(
        `
      SELECT p.id
      FROM competitions c
      JOIN stages s ON s.competition_id = c.id
      JOIN competition_groups g ON g.stage_id = s.id
      JOIN contestants p ON p.group_id = g.id
      WHERE c.id = ? AND g.name = ? AND p.name = ?
      LIMIT 1
    `
      )
      .get(sourceKey, groupName, contestantName) as { id: string } | undefined
    return row || null
  }

  private resolveMatchContext(
    database: DatabaseSync,
    input: MatchScoreEventWrite
  ): { matchSessionId: string; refereeId: string } | null {
    const row = database
      .prepare(
        `
      SELECT ms.id AS match_session_id, r.id AS referee_id
      FROM competitions c
      JOIN stages s ON s.competition_id = c.id
      JOIN competition_groups g ON g.stage_id = s.id
      JOIN contestants p ON p.group_id = g.id
      JOIN match_sessions ms ON ms.contestant_id = p.id AND ms.attempt_number = 1
      JOIN referees r ON r.group_id = g.id AND r.referee_index = ?
      WHERE c.id = ? AND g.name = ? AND p.name = ?
      LIMIT 1
    `
      )
      .get(input.refereeIndex, input.sourceKey, input.groupName, input.contestantName) as
      | { match_session_id: string; referee_id: string }
      | undefined
    return row ? { matchSessionId: row.match_session_id, refereeId: row.referee_id } : null
  }

  private requireCompetitionConfig(sourceKey: string): CompetitionConfig {
    const config = this.getCompetitionConfig(sourceKey)
    if (!config) throw new Error('COMPETITION_NOT_FOUND')
    return config
  }

  private countCompetitionEvents(database: DatabaseSync, competitionId: string): number {
    const row = database
      .prepare(
        `
      SELECT COUNT(*) AS count
      FROM score_events e
      JOIN match_sessions ms ON ms.id = e.match_session_id
      JOIN contestants p ON p.id = ms.contestant_id
      JOIN competition_groups g ON g.id = p.group_id
      JOIN stages s ON s.id = g.stage_id
      WHERE s.competition_id = ?
    `
      )
      .get(competitionId) as { count: number }
    return Number(row.count)
  }

  private replaceCompetitionGraph(
    database: DatabaseSync,
    competitionId: string,
    sourceKey: string,
    groups: CompetitionGroupConfig[]
  ): void {
    const stage = this.firstStage(database, competitionId)
    if (!stage) throw new Error('COMPETITION_NOT_FOUND')
    database.prepare('DELETE FROM competition_groups WHERE stage_id = ?').run(stage.id)
    groups.forEach((group, groupPosition) => {
      const groupId = stableDatabaseId(sourceKey, 'group', String(groupPosition), group.name)
      database
        .prepare(
          `
        INSERT INTO competition_groups (id, stage_id, name, position, referee_count)
        VALUES (?, ?, ?, ?, ?)
      `
        )
        .run(groupId, stage.id, group.name, groupPosition, group.refCount)
      group.players.forEach((playerName, playerPosition) => {
        const contestantId = stableDatabaseId(
          sourceKey,
          groupId,
          'contestant',
          String(playerPosition),
          playerName
        )
        database
          .prepare(
            `
          INSERT INTO contestants (id, group_id, name, position, status)
          VALUES (?, ?, ?, ?, 'pending')
        `
          )
          .run(contestantId, groupId, playerName, playerPosition)
        database
          .prepare(
            `
          INSERT INTO match_sessions (id, contestant_id, attempt_number, status, rule_version)
          VALUES (?, ?, 1, 'pending', 'route-b-v1')
        `
          )
          .run(stableDatabaseId(sourceKey, contestantId, 'session', '1'), contestantId)
      })
      group.referees.forEach((referee) => {
        const refereeId = stableDatabaseId(sourceKey, groupId, 'referee', String(referee.index))
        database
          .prepare(
            `
          INSERT INTO referees (id, group_id, referee_index, name, mode)
          VALUES (?, ?, ?, ?, ?)
        `
          )
          .run(refereeId, groupId, referee.index, referee.name, referee.mode)
        this.writeDeviceBindings(database, sourceKey, refereeId, referee)
      })
    })
  }

  private updateCompetitionBindings(
    database: DatabaseSync,
    competitionId: string,
    sourceKey: string,
    groups: CompetitionGroupConfig[]
  ): void {
    for (const group of groups) {
      const row = database
        .prepare(
          `
        SELECT g.id
        FROM stages s
        JOIN competition_groups g ON g.stage_id = s.id
        WHERE s.competition_id = ? AND g.name = ?
        LIMIT 1
      `
        )
        .get(competitionId, group.name) as { id: string } | undefined
      if (!row) throw new Error('COMPETITION_STRUCTURE_LOCKED')
      for (const referee of group.referees) {
        const stored = database
          .prepare('SELECT id FROM referees WHERE group_id = ? AND referee_index = ?')
          .get(row.id, referee.index) as { id: string } | undefined
        if (!stored) throw new Error('COMPETITION_STRUCTURE_LOCKED')
        database.prepare('DELETE FROM device_bindings WHERE referee_id = ?').run(stored.id)
        this.writeDeviceBindings(database, sourceKey, stored.id, referee)
      }
    }
  }

  private writeDeviceBindings(
    database: DatabaseSync,
    sourceKey: string,
    refereeId: string,
    referee: CompetitionRefereeConfig
  ): void {
    for (const [role, deviceId] of [
      ['primary', referee.pri_addr],
      ['secondary', referee.mode === 'DUAL' ? referee.sec_addr : '']
    ] as const) {
      if (!deviceId) continue
      const transport =
        deviceId.startsWith('usb:') || deviceId.startsWith('usbport:') ? 'USB' : 'BLE'
      database
        .prepare(
          `
        INSERT INTO device_bindings (id, referee_id, role, device_id, transport)
        VALUES (?, ?, ?, ?, ?)
      `
        )
        .run(
          stableDatabaseId(sourceKey, refereeId, 'device', role),
          refereeId,
          role,
          deviceId,
          transport
        )
    }
  }

  private insertScoreEvent(database: DatabaseSync, event: StoredScoreEvent): boolean {
    validateScoreEvent(event)
    if (!event.matchSessionId || !event.refereeId) throw new Error('MATCH_CONTEXT_INVALID')
    const result = database
      .prepare(
        `
      INSERT OR IGNORE INTO score_events (
        event_id, match_session_id, referee_id, connection_id, device_id, role,
        event_type, device_timestamp_ms, received_at, system_time, total_plus,
        total_minus, current_total, major_penalty, media_provider, media_id,
        media_time_ms, media_sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        event.eventId,
        event.matchSessionId,
        event.refereeId,
        event.connectionId,
        event.deviceId,
        event.role,
        event.eventType,
        event.deviceTimestampMs,
        event.receivedAt,
        event.systemTime,
        event.totalPlus,
        event.totalMinus,
        event.currentTotal,
        event.majorPenalty,
        event.mediaProvider ?? '',
        event.mediaId ?? '',
        event.mediaTimeMs ?? null,
        event.mediaSyncStatus ?? 'not_ready'
      )
    return Number(result.changes) === 1
  }

  private requireDatabase(): DatabaseSync {
    return this.connection.requireDatabase()
  }
}

function validateScoreEvent(event: StoredScoreEvent): void {
  if (
    !event ||
    typeof event.eventId !== 'string' ||
    !event.eventId ||
    typeof event.connectionId !== 'string' ||
    !event.connectionId ||
    typeof event.deviceId !== 'string' ||
    !event.deviceId ||
    (event.role !== 'primary' && event.role !== 'secondary') ||
    !Number.isSafeInteger(event.eventType) ||
    !Number.isSafeInteger(event.deviceTimestampMs) ||
    event.deviceTimestampMs < 0 ||
    typeof event.receivedAt !== 'string' ||
    !Number.isFinite(Date.parse(event.receivedAt)) ||
    typeof event.systemTime !== 'string' ||
    !Number.isFinite(Date.parse(event.systemTime)) ||
    !Number.isSafeInteger(event.totalPlus) ||
    event.totalPlus < 0 ||
    !Number.isSafeInteger(event.totalMinus) ||
    event.totalMinus < 0 ||
    !Number.isSafeInteger(event.currentTotal) ||
    !Number.isSafeInteger(event.majorPenalty)
  ) {
    throw new Error('Invalid score event')
  }
}

function exportEventKey(groupName: string, contestantName: string, refereeIndex: number): string {
  return JSON.stringify([groupName, contestantName, refereeIndex])
}

function stableDatabaseId(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32)
}
