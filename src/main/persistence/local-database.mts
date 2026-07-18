import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  createDefaultAppSettings,
  isAppSettingKey,
  normalizeAppSetting,
  type AppSettings
} from '../application/settings/app-settings.mts'
import {
  hasSameCompetitionStructure,
  type CompetitionCreateInput,
  type CompetitionUpdateInput
} from '../application/competitions/competition-service.mts'
import type {
  CompetitionConfig,
  CompetitionGroupConfig,
  CompetitionListItem,
  CompetitionRefereeConfig
} from '../../shared/contracts/competition.mts'

export const LATEST_SCHEMA_VERSION = 5

export interface StoredScoreEvent {
  eventId: string
  sourceEventId?: string
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

export interface LegacyImportContestant {
  id: string
  name: string
  position: number
  sessionId: string
  events: StoredScoreEvent[]
  media?: {
    id: string
    provider: string
    mediaId: string
    canonicalUrl: string
  }
}

export interface LegacyImportReferee {
  id: string
  name: string
  storageIndex: number
  sourceIndex: number
  mode: 'SINGLE' | 'DUAL'
}

export interface LegacyImportGroup {
  id: string
  name: string
  position: number
  refCount: number
  contestants: LegacyImportContestant[]
  referees: LegacyImportReferee[]
}

export interface LegacyProjectImport {
  sourceKey: string
  sourceHash: string
  competition: {
    id: string
    name: string
    mode: 'FREE' | 'TOURNAMENT'
    createdAt: string
  }
  stage: {
    id: string
    name: string
  }
  groups: LegacyImportGroup[]
}

export interface LegacyReplayEvent {
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

export interface LegacyReport {
  status: 'ok'
  config: {
    project_name: string
    mode: 'FREE' | 'TOURNAMENT'
    created_at: string
    groups: Array<{
      name: string
      refCount: number
      players: string[]
      referees: Array<{ index: number; name: string; mode: 'SINGLE' | 'DUAL' }>
    }>
    media: Record<string, Record<string, Record<string, string>>>
  }
  scores: Record<
    string,
    Record<
      string,
      Record<
        number,
        {
          total: number
          plus: number
          minus: number
          penalty: number
        }
      >
    >
  >
}

export interface LegacyEventContext {
  matchSessionId: string
  refereeId: string
}

export interface LegacyScoreEventWrite {
  sourceKey: string
  groupName: string
  contestantName: string
  refereeIndex: number
  refereeName: string
  refereeMode: 'SINGLE' | 'DUAL'
  event: Omit<StoredScoreEvent, 'matchSessionId' | 'refereeId'>
}

export type LegacyScoreEventWriteResult =
  | { status: 'inserted' }
  | { status: 'duplicate' }
  | { status: 'context_missing' }

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS competitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('FREE', 'TOURNAMENT')),
        status TEXT NOT NULL DEFAULT 'draft',
        event_date TEXT,
        location TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS stages (
        id TEXT PRIMARY KEY,
        competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
        UNIQUE (competition_id, position)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS competition_groups (
        id TEXT PRIMARY KEY,
        stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        UNIQUE (stage_id, position)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS contestants (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES competition_groups(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        UNIQUE (group_id, position)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS referees (
        id TEXT PRIMARY KEY,
        stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
        referee_index INTEGER NOT NULL,
        name TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('SINGLE', 'DUAL')),
        UNIQUE (stage_id, referee_index)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS device_bindings (
        id TEXT PRIMARY KEY,
        referee_id TEXT NOT NULL REFERENCES referees(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('primary', 'secondary')),
        device_id TEXT NOT NULL,
        transport TEXT NOT NULL CHECK (transport IN ('BLE', 'USB')),
        UNIQUE (referee_id, role)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS match_sessions (
        id TEXT PRIMARY KEY,
        contestant_id TEXT NOT NULL REFERENCES contestants(id),
        attempt_number INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'pending',
        started_at TEXT,
        completed_at TEXT,
        invalidated_at TEXT,
        rule_version TEXT NOT NULL,
        UNIQUE (contestant_id, attempt_number)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS score_events (
        event_id TEXT PRIMARY KEY,
        match_session_id TEXT REFERENCES match_sessions(id),
        referee_id TEXT REFERENCES referees(id),
        connection_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('primary', 'secondary')),
        event_type INTEGER NOT NULL,
        device_timestamp_ms INTEGER NOT NULL,
        received_at TEXT NOT NULL,
        system_time TEXT NOT NULL,
        total_plus INTEGER NOT NULL,
        total_minus INTEGER NOT NULL,
        current_total INTEGER NOT NULL,
        major_penalty INTEGER NOT NULL DEFAULT 0,
        media_provider TEXT NOT NULL DEFAULT '',
        media_id TEXT NOT NULL DEFAULT '',
        media_time_ms INTEGER,
        media_sync_status TEXT NOT NULL DEFAULT 'not_ready',
        raw_payload TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS score_events_session_time
        ON score_events(match_session_id, system_time, event_id);

      CREATE TABLE IF NOT EXISTS media_bindings (
        id TEXT PRIMARY KEY,
        contestant_id TEXT NOT NULL REFERENCES contestants(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        media_id TEXT NOT NULL,
        canonical_url TEXT NOT NULL,
        UNIQUE (contestant_id, provider)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS export_records (
        id TEXT PRIMARY KEY,
        competition_id TEXT REFERENCES competitions(id) ON DELETE SET NULL,
        format TEXT NOT NULL,
        scope_json TEXT NOT NULL,
        output_path TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS share_drafts (
        id TEXT PRIMARY KEY,
        competition_id TEXT REFERENCES competitions(id) ON DELETE SET NULL,
        snapshot_json TEXT NOT NULL,
        snapshot_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS upload_tasks (
        id TEXT PRIMARY KEY,
        draft_id TEXT NOT NULL REFERENCES share_drafts(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error_code TEXT,
        next_attempt_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS legacy_imports (
        source_key TEXT PRIMARY KEY,
        source_hash TEXT NOT NULL,
        competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
        imported_at TEXT NOT NULL
      ) STRICT;
    `
  },
  {
    version: 2,
    sql: `
      ALTER TABLE referees ADD COLUMN group_id TEXT REFERENCES competition_groups(id);
      ALTER TABLE referees ADD COLUMN source_referee_index INTEGER;
      CREATE UNIQUE INDEX IF NOT EXISTS referees_group_source_index
        ON referees(group_id, source_referee_index)
      WHERE group_id IS NOT NULL;
    `
  },
  {
    version: 3,
    sql: `
      DROP INDEX IF EXISTS score_events_session_time;
      ALTER TABLE score_events RENAME TO score_events_v2;
      ALTER TABLE match_sessions RENAME TO match_sessions_v2;

      CREATE TABLE match_sessions (
        id TEXT PRIMARY KEY,
        contestant_id TEXT NOT NULL REFERENCES contestants(id) ON DELETE CASCADE,
        attempt_number INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'pending',
        started_at TEXT,
        completed_at TEXT,
        invalidated_at TEXT,
        rule_version TEXT NOT NULL,
        UNIQUE (contestant_id, attempt_number)
      ) STRICT;

      CREATE TABLE score_events (
        event_id TEXT PRIMARY KEY,
        match_session_id TEXT REFERENCES match_sessions(id) ON DELETE CASCADE,
        referee_id TEXT REFERENCES referees(id) ON DELETE SET NULL,
        connection_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('primary', 'secondary')),
        event_type INTEGER NOT NULL,
        device_timestamp_ms INTEGER NOT NULL,
        received_at TEXT NOT NULL,
        system_time TEXT NOT NULL,
        total_plus INTEGER NOT NULL,
        total_minus INTEGER NOT NULL,
        current_total INTEGER NOT NULL,
        major_penalty INTEGER NOT NULL DEFAULT 0,
        media_provider TEXT NOT NULL DEFAULT '',
        media_id TEXT NOT NULL DEFAULT '',
        media_time_ms INTEGER,
        media_sync_status TEXT NOT NULL DEFAULT 'not_ready',
        raw_payload TEXT NOT NULL
      ) STRICT;
      CREATE INDEX score_events_session_time
        ON score_events(match_session_id, system_time, event_id);

      INSERT INTO match_sessions
        SELECT * FROM match_sessions_v2;
      INSERT INTO score_events
        SELECT * FROM score_events_v2;

      DROP TABLE score_events_v2;
      DROP TABLE match_sessions_v2;
    `
  },
  {
    version: 4,
    sql: `
      ALTER TABLE competition_groups
        ADD COLUMN legacy_ref_count INTEGER NOT NULL DEFAULT 0;
    `
  },
  {
    version: 5,
    sql: `
      ALTER TABLE legacy_imports
        ADD COLUMN is_live_managed INTEGER NOT NULL DEFAULT 0 CHECK (is_live_managed IN (0, 1));
    `
  }
] as const

export class LocalDatabase {
  readonly databasePath: string
  readonly backupRoot: string
  private database: DatabaseSync | null = null

  constructor(databasePath: string, backupRoot: string) {
    this.databasePath = path.resolve(databasePath)
    this.backupRoot = path.resolve(backupRoot)
  }

  open(): void {
    if (this.database) return
    mkdirSync(path.dirname(this.databasePath), { recursive: true })
    mkdirSync(this.backupRoot, { recursive: true })
    const existing = existsSync(this.databasePath) && statSync(this.databasePath).size > 0
    let currentVersion = 0
    if (existing) {
      const probe = new DatabaseSync(this.databasePath, { readOnly: true })
      try {
        const row = probe.prepare('PRAGMA user_version').get() as { user_version: number }
        currentVersion = Number(row.user_version)
      } finally {
        probe.close()
      }
      if (currentVersion > LATEST_SCHEMA_VERSION) {
        throw new Error(`Database schema ${currentVersion} is newer than this application`)
      }
      if (currentVersion < LATEST_SCHEMA_VERSION) this.createMigrationBackup(currentVersion)
    }

    const database = new DatabaseSync(this.databasePath)
    this.database = database
    database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
    if (currentVersion < LATEST_SCHEMA_VERSION) {
      this.applyMigrations(currentVersion)
    }
  }

  close(): void {
    if (!this.database) return
    this.database.close()
    this.database = null
  }

  getSchemaVersion(): number {
    const row = this.requireDatabase().prepare('PRAGMA user_version').get() as {
      user_version: number
    }
    return Number(row.user_version)
  }

  listTableNames(): string[] {
    const rows = this.requireDatabase()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as Array<{ name: string }>
    return rows.map((row) => row.name)
  }

  appendScoreEvent(event: StoredScoreEvent): boolean {
    return this.insertScoreEvent(this.requireDatabase(), event)
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
        // Ignore corrupt rows and keep the stable default for that key.
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
    const source = this.resolveCompetitionSourceFrom(database, sourceKey)
    if (!source) throw new Error('COMPETITION_NOT_FOUND')
    const current = this.requireCompetitionConfig(sourceKey)
    const hasEvents = this.countCompetitionEvents(database, source.competitionId) > 0
    if (hasEvents && !hasSameCompetitionStructure(current, input)) {
      throw new Error('COMPETITION_STRUCTURE_LOCKED')
    }

    database.exec('BEGIN IMMEDIATE')
    try {
      database
        .prepare(
          `
        UPDATE competitions SET name = ?, mode = ?, updated_at = ? WHERE id = ?
      `
        )
        .run(input.projectName, input.mode, new Date().toISOString(), source.competitionId)
      if (hasEvents) {
        this.updateCompetitionBindings(database, source.competitionId, sourceKey, input.groups)
      } else {
        this.replaceCompetitionGraph(database, source.competitionId, sourceKey, input.groups)
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
    const source = this.resolveCompetitionSourceFrom(database, sourceKey)
    if (!source) return null
    const stage = database
      .prepare(
        `
      SELECT id FROM stages WHERE competition_id = ? ORDER BY position LIMIT 1
    `
      )
      .get(source.competitionId) as { id: string } | undefined
    if (!stage) return null

    const groupRows = database
      .prepare(
        `
      SELECT id, name, position, legacy_ref_count
      FROM competition_groups WHERE stage_id = ? ORDER BY position
    `
      )
      .all(stage.id) as Array<{
      id: string
      name: string
      position: number
      legacy_ref_count: number
    }>
    const groups = groupRows.map((group) => {
      const players = database
        .prepare(
          `
        SELECT name FROM contestants WHERE group_id = ? ORDER BY position
      `
        )
        .all(group.id) as Array<{ name: string }>
      const referees = database
        .prepare(
          `
        SELECT r.source_referee_index, r.name, r.mode,
          MAX(CASE WHEN db.role = 'primary' THEN db.device_id ELSE '' END) AS pri_addr,
          MAX(CASE WHEN db.role = 'secondary' THEN db.device_id ELSE '' END) AS sec_addr
        FROM referees r
        LEFT JOIN device_bindings db ON db.referee_id = r.id
        WHERE r.group_id = ?
        GROUP BY r.id
        ORDER BY r.source_referee_index
      `
        )
        .all(group.id) as Array<Record<string, string | number>>
      return {
        name: group.name,
        refCount: Number(group.legacy_ref_count),
        players: players.map((player) => player.name),
        referees: referees.map((referee) => ({
          index: Number(referee.source_referee_index),
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
      project_name: source.projectName,
      mode: source.mode,
      created_at: source.createdAt,
      source_key: source.sourceKey,
      groups,
      media
    }
  }

  listCompetitionProjects(): CompetitionListItem[] {
    const rows = this.requireDatabase()
      .prepare(
        `
      SELECT COALESCE(li.source_key, c.id) AS source_key
      FROM competitions c
      LEFT JOIN legacy_imports li ON li.competition_id = c.id
      ORDER BY c.updated_at DESC, c.created_at DESC
    `
      )
      .all() as Array<{ source_key: string }>
    return rows.flatMap((row) => {
      const config = this.getCompetitionConfig(row.source_key)
      return config ? [{ ...config, dir_name: config.source_key }] : []
    })
  }

  deleteCompetition(sourceKey: string): boolean {
    const database = this.requireDatabase()
    const source = this.resolveCompetitionSourceFrom(database, sourceKey)
    if (!source) return false
    const result = database
      .prepare('DELETE FROM competitions WHERE id = ?')
      .run(source.competitionId)
    return Number(result.changes) === 1
  }

  isLegacyCompetition(sourceKey: string): boolean {
    return this.resolveCompetitionSourceFrom(this.requireDatabase(), sourceKey)?.isLegacy ?? false
  }

  getScoreEvents(): StoredScoreEvent[] {
    const rows = this.requireDatabase()
      .prepare('SELECT raw_payload FROM score_events ORDER BY system_time, event_id')
      .all() as Array<{ raw_payload: string }>
    return rows.map((row) => JSON.parse(row.raw_payload) as StoredScoreEvent)
  }

  importLegacyProject(input: LegacyProjectImport): { imported: boolean; eventCount: number } {
    validateLegacyImport(input)
    const database = this.requireDatabase()
    const existing = database
      .prepare(
        'SELECT source_hash, competition_id, is_live_managed FROM legacy_imports WHERE source_key = ?'
      )
      .get(input.sourceKey) as
      | {
          source_hash: string
          competition_id: string
          is_live_managed: number
        }
      | undefined
    if (existing?.source_hash === input.sourceHash || existing?.is_live_managed === 1) {
      return { imported: false, eventCount: 0 }
    }

    database.exec('BEGIN IMMEDIATE')
    try {
      if (existing) {
        database.prepare('DELETE FROM competitions WHERE id = ?').run(existing.competition_id)
        database.prepare('DELETE FROM legacy_imports WHERE source_key = ?').run(input.sourceKey)
      }
      const now = new Date().toISOString()
      database
        .prepare(
          `
        INSERT INTO competitions (id, name, mode, status, created_at, updated_at)
        VALUES (?, ?, ?, 'archived', ?, ?)
      `
        )
        .run(
          input.competition.id,
          input.competition.name,
          input.competition.mode,
          input.competition.createdAt,
          now
        )
      database
        .prepare(
          `
        INSERT INTO stages (id, competition_id, name, position, status, attempts)
        VALUES (?, ?, ?, 0, 'completed', 1)
      `
        )
        .run(input.stage.id, input.competition.id, input.stage.name)

      let eventCount = 0
      for (const group of input.groups) {
        database
          .prepare(
            `
          INSERT INTO competition_groups (
            id, stage_id, name, position, legacy_ref_count
          ) VALUES (?, ?, ?, ?, ?)
        `
          )
          .run(group.id, input.stage.id, group.name, group.position, group.refCount)
        for (const referee of group.referees) {
          database
            .prepare(
              `
            INSERT INTO referees (
              id, stage_id, referee_index, name, mode, group_id, source_referee_index
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `
            )
            .run(
              referee.id,
              input.stage.id,
              referee.storageIndex,
              referee.name,
              referee.mode,
              group.id,
              referee.sourceIndex
            )
        }
        for (const contestant of group.contestants) {
          database
            .prepare(
              `
            INSERT INTO contestants (id, group_id, name, position, status)
            VALUES (?, ?, ?, ?, ?)
          `
            )
            .run(
              contestant.id,
              group.id,
              contestant.name,
              contestant.position,
              contestant.events.length ? 'completed' : 'pending'
            )
          database
            .prepare(
              `
            INSERT INTO match_sessions (
              id, contestant_id, attempt_number, status, completed_at, rule_version
            ) VALUES (?, ?, 1, ?, ?, 'legacy-v1')
          `
            )
            .run(
              contestant.sessionId,
              contestant.id,
              contestant.events.length ? 'completed' : 'pending',
              contestant.events.at(-1)?.systemTime ?? null
            )
          if (contestant.media) {
            database
              .prepare(
                `
              INSERT INTO media_bindings (
                id, contestant_id, provider, media_id, canonical_url
              ) VALUES (?, ?, ?, ?, ?)
            `
              )
              .run(
                contestant.media.id,
                contestant.id,
                contestant.media.provider,
                contestant.media.mediaId,
                contestant.media.canonicalUrl
              )
          }
          for (const event of contestant.events) {
            this.insertScoreEvent(database, event)
            database
              .prepare(
                `
              UPDATE score_events
              SET
                match_session_id = COALESCE(match_session_id, ?),
                referee_id = COALESCE(referee_id, ?)
              WHERE event_id = ?
            `
              )
              .run(event.matchSessionId ?? null, event.refereeId ?? null, event.eventId)
            eventCount += 1
          }
        }
      }
      database
        .prepare(
          `
        INSERT INTO legacy_imports (source_key, source_hash, competition_id, imported_at)
        VALUES (?, ?, ?, ?)
      `
        )
        .run(input.sourceKey, input.sourceHash, input.competition.id, now)
      database.exec('COMMIT')
      return { imported: true, eventCount }
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  getLegacyImportSummary(sourceKey: string): {
    competitionName: string
    groups: number
    contestants: number
    referees: number
    events: number
  } | null {
    const row = this.requireDatabase()
      .prepare(
        `
      SELECT
        c.name AS competition_name,
        (SELECT COUNT(*) FROM competition_groups g JOIN stages s ON s.id = g.stage_id
          WHERE s.competition_id = c.id) AS group_count,
        (SELECT COUNT(*) FROM contestants p JOIN competition_groups g ON g.id = p.group_id
          JOIN stages s ON s.id = g.stage_id WHERE s.competition_id = c.id) AS contestant_count,
        (SELECT COUNT(*) FROM referees r WHERE r.stage_id IN
          (SELECT id FROM stages WHERE competition_id = c.id)) AS referee_count,
        (SELECT COUNT(*) FROM score_events e WHERE e.match_session_id IN
          (SELECT ms.id FROM match_sessions ms JOIN contestants p ON p.id = ms.contestant_id
           JOIN competition_groups g ON g.id = p.group_id JOIN stages s ON s.id = g.stage_id
           WHERE s.competition_id = c.id)) AS event_count
      FROM legacy_imports li
      JOIN competitions c ON c.id = li.competition_id
      WHERE li.source_key = ?
    `
      )
      .get(sourceKey) as Record<string, string | number> | undefined
    if (!row) return null
    return {
      competitionName: String(row.competition_name),
      groups: Number(row.group_count),
      contestants: Number(row.contestant_count),
      referees: Number(row.referee_count),
      events: Number(row.event_count)
    }
  }

  resolveLegacyEventContext(
    sourceKey: string,
    groupName: string,
    contestantName: string,
    refereeIndex: number
  ): LegacyEventContext | null {
    return this.resolveLegacyEventContextFrom(
      this.requireDatabase(),
      sourceKey,
      groupName,
      contestantName,
      refereeIndex
    )
  }

  private resolveLegacyEventContextFrom(
    database: DatabaseSync,
    sourceKey: string,
    groupName: string,
    contestantName: string,
    refereeIndex: number
  ): LegacyEventContext | null {
    const source = this.resolveCompetitionSourceFrom(database, sourceKey)
    if (!source) return null
    const row = database
      .prepare(
        `
      SELECT ms.id AS match_session_id, r.id AS referee_id
      FROM stages s
      JOIN competition_groups g ON g.stage_id = s.id
      JOIN contestants p ON p.group_id = g.id
      JOIN match_sessions ms ON ms.contestant_id = p.id AND ms.attempt_number = 1
      JOIN referees r ON r.group_id = g.id AND r.source_referee_index = ?
      WHERE s.competition_id = ? AND g.name = ? AND p.name = ?
      LIMIT 1
    `
      )
      .get(refereeIndex, source.competitionId, groupName, contestantName) as
      | {
          match_session_id: string
          referee_id: string
        }
      | undefined
    return row
      ? {
          matchSessionId: row.match_session_id,
          refereeId: row.referee_id
        }
      : null
  }

  markLegacyProjectLive(sourceKey: string): boolean {
    const result = this.requireDatabase()
      .prepare(
        `
      UPDATE legacy_imports SET is_live_managed = 1 WHERE source_key = ?
    `
      )
      .run(sourceKey)
    return Number(result.changes) === 1
  }

  ensureLegacyEventContext(
    sourceKey: string,
    groupName: string,
    contestantName: string,
    refereeIndex: number,
    refereeName: string,
    refereeMode: 'SINGLE' | 'DUAL'
  ): LegacyEventContext | null {
    const database = this.requireDatabase()
    database.exec('BEGIN IMMEDIATE')
    try {
      const context = this.ensureLegacyEventContextInTransaction(
        database,
        sourceKey,
        groupName,
        contestantName,
        refereeIndex,
        refereeName,
        refereeMode
      )
      if (!context) {
        database.exec('ROLLBACK')
        return null
      }
      database.exec('COMMIT')
      return context
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  appendLegacyScoreEvent(input: LegacyScoreEventWrite): LegacyScoreEventWriteResult {
    validateScoreEvent(input.event)
    const database = this.requireDatabase()
    database.exec('BEGIN IMMEDIATE')
    try {
      const context = this.ensureLegacyEventContextInTransaction(
        database,
        input.sourceKey,
        input.groupName,
        input.contestantName,
        input.refereeIndex,
        input.refereeName,
        input.refereeMode
      )
      if (!context) {
        database.exec('ROLLBACK')
        return { status: 'context_missing' }
      }
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

  private ensureLegacyEventContextInTransaction(
    database: DatabaseSync,
    sourceKey: string,
    groupName: string,
    contestantName: string,
    refereeIndex: number,
    refereeName: string,
    refereeMode: 'SINGLE' | 'DUAL'
  ): LegacyEventContext | null {
    const existing = this.resolveLegacyEventContextFrom(
      database,
      sourceKey,
      groupName,
      contestantName,
      refereeIndex
    )
    if (existing) {
      database
        .prepare(
          `
        UPDATE match_sessions
        SET status = 'active', started_at = COALESCE(started_at, ?)
        WHERE id = ?
      `
        )
        .run(new Date().toISOString(), existing.matchSessionId)
      return existing
    }

    const source = this.resolveCompetitionSourceFrom(database, sourceKey)
    if (!source) return null
    const stage = database
      .prepare(
        `
        SELECT s.id
        FROM stages s
        WHERE s.competition_id = ?
        ORDER BY s.position
        LIMIT 1
      `
      )
      .get(source.competitionId) as { id: string } | undefined
    if (!stage) return null

    let group = database
      .prepare(
        `
        SELECT id, position FROM competition_groups WHERE stage_id = ? AND name = ? LIMIT 1
      `
      )
      .get(stage.id, groupName) as { id: string; position: number } | undefined
    if (!group) {
      const row = database
        .prepare(
          `
          SELECT COALESCE(MAX(position), -1) + 1 AS position
          FROM competition_groups WHERE stage_id = ?
        `
        )
        .get(stage.id) as { position: number }
      group = {
        id: stableDatabaseId(sourceKey, 'live-group', groupName),
        position: Number(row.position)
      }
      database
        .prepare(
          `
          INSERT INTO competition_groups (id, stage_id, name, position, legacy_ref_count)
          VALUES (?, ?, ?, ?, ?)
        `
        )
        .run(group.id, stage.id, groupName, group.position, refereeIndex)
    }

    let contestant = database
      .prepare(
        `
        SELECT id FROM contestants WHERE group_id = ? AND name = ? LIMIT 1
      `
      )
      .get(group.id, contestantName) as { id: string } | undefined
    if (!contestant) {
      const row = database
        .prepare(
          `
          SELECT COALESCE(MAX(position), -1) + 1 AS position
          FROM contestants WHERE group_id = ?
        `
        )
        .get(group.id) as { position: number }
      contestant = { id: stableDatabaseId(sourceKey, group.id, 'live-contestant', contestantName) }
      database
        .prepare(
          `
          INSERT INTO contestants (id, group_id, name, position, status)
          VALUES (?, ?, ?, ?, 'active')
        `
        )
        .run(contestant.id, group.id, contestantName, Number(row.position))
    }

    let referee = database
      .prepare(
        `
        SELECT id FROM referees WHERE group_id = ? AND source_referee_index = ? LIMIT 1
      `
      )
      .get(group.id, refereeIndex) as { id: string } | undefined
    if (!referee) {
      referee = {
        id: stableDatabaseId(sourceKey, group.id, 'live-referee', String(refereeIndex))
      }
      database
        .prepare(
          `
          INSERT INTO referees (
            id, stage_id, referee_index, name, mode, group_id, source_referee_index
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          referee.id,
          stage.id,
          group.position * 100000 + refereeIndex,
          refereeName,
          refereeMode,
          group.id,
          refereeIndex
        )
    }

    let session = database
      .prepare(
        `
        SELECT id FROM match_sessions WHERE contestant_id = ? AND attempt_number = 1
      `
      )
      .get(contestant.id) as { id: string } | undefined
    if (!session) {
      session = { id: stableDatabaseId(sourceKey, contestant.id, 'live-session', '1') }
      database
        .prepare(
          `
          INSERT INTO match_sessions (
            id, contestant_id, attempt_number, status, started_at, rule_version
          ) VALUES (?, ?, 1, 'active', ?, 'route-b-v1')
        `
        )
        .run(session.id, contestant.id, new Date().toISOString())
    }

    return { matchSessionId: session.id, refereeId: referee.id }
  }

  upsertLegacyMediaBinding(
    sourceKey: string,
    groupName: string,
    contestantName: string,
    binding: { provider: string; mediaId: string; canonicalUrl: string }
  ): boolean {
    const database = this.requireDatabase()
    const source = this.resolveCompetitionSourceFrom(database, sourceKey)
    if (!source) return false
    const contestant = database
      .prepare(
        `
      SELECT p.id
      FROM stages s
      JOIN competition_groups g ON g.stage_id = s.id
      JOIN contestants p ON p.group_id = g.id
      WHERE s.competition_id = ? AND g.name = ? AND p.name = ?
      LIMIT 1
    `
      )
      .get(source.competitionId, groupName, contestantName) as { id: string } | undefined
    if (!contestant) return false
    this.requireDatabase()
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

  listLegacyScoredContestants(sourceKey: string, groupName: string): string[] {
    const database = this.requireDatabase()
    const source = this.resolveCompetitionSourceFrom(database, sourceKey)
    if (!source) return []
    const rows = database
      .prepare(
        `
      SELECT DISTINCT p.name, p.position
      FROM stages s
      JOIN competition_groups g ON g.stage_id = s.id
      JOIN contestants p ON p.group_id = g.id
      JOIN match_sessions ms ON ms.contestant_id = p.id
      JOIN score_events e ON e.match_session_id = ms.id
      WHERE s.competition_id = ? AND g.name = ?
      ORDER BY p.position
    `
      )
      .all(source.competitionId, groupName) as Array<{ name: string }>
    return rows.map((row) => row.name)
  }

  getLegacyReplay(
    sourceKey: string,
    groupName: string,
    contestantName: string
  ): {
    status: 'ok'
    binding: {
      provider: string
      video_id: string
      canonical_url: string
    } | null
    events: LegacyReplayEvent[]
  } | null {
    const database = this.requireDatabase()
    const source = this.resolveCompetitionSourceFrom(database, sourceKey)
    if (!source) return null
    const contestant = database
      .prepare(
        `
      SELECT p.id
      FROM stages s
      JOIN competition_groups g ON g.stage_id = s.id
      JOIN contestants p ON p.group_id = g.id
      WHERE s.competition_id = ? AND g.name = ? AND p.name = ?
      LIMIT 1
    `
      )
      .get(source.competitionId, groupName, contestantName) as { id: string } | undefined
    if (!contestant) return null

    const bindingRow = database
      .prepare(
        `
      SELECT provider, media_id, canonical_url
      FROM media_bindings
      WHERE contestant_id = ?
      LIMIT 1
    `
      )
      .get(contestant.id) as
      | {
          provider: string
          media_id: string
          canonical_url: string
        }
      | undefined
    const rows = database
      .prepare(
        `
      SELECT
        e.*,
        r.source_referee_index,
        r.name AS referee_name
      FROM match_sessions ms
      JOIN score_events e ON e.match_session_id = ms.id
      LEFT JOIN referees r ON r.id = e.referee_id
      WHERE ms.contestant_id = ?
      ORDER BY e.system_time, r.source_referee_index, e.event_id
    `
      )
      .all(contestant.id) as Array<Record<string, string | number | null>>

    const previousByReferee = new Map<number, { plus: number; minus: number; penalty: number }>()
    const events = rows.map((row) => {
      const refereeIndex = Number(
        row.source_referee_index ?? legacyRefereeIndex(String(row.connection_id))
      )
      const previous = previousByReferee.get(refereeIndex) ?? { plus: 0, minus: 0, penalty: 0 }
      const plus = Number(row.total_plus)
      const minus = Number(row.total_minus)
      const penalty = Number(row.major_penalty)
      previousByReferee.set(refereeIndex, { plus, minus, penalty })
      const raw = JSON.parse(String(row.raw_payload)) as StoredScoreEvent
      const deviceRole: 'PRIMARY' | 'SECONDARY' =
        String(row.role) === 'secondary' ? 'SECONDARY' : 'PRIMARY'
      return {
        event_id: raw.sourceEventId ?? String(row.event_id),
        system_time: String(row.system_time),
        ble_timestamp: Number(row.device_timestamp_ms),
        referee_index: refereeIndex,
        referee_name: String(row.referee_name || `Referee ${refereeIndex}`),
        device_role: deviceRole,
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

  getLegacyReport(sourceKey: string): LegacyReport | null {
    const database = this.requireDatabase()
    const source = this.resolveCompetitionSourceFrom(database, sourceKey)
    if (!source) return null
    const competition = {
      id: source.competitionId,
      name: source.projectName,
      mode: source.mode,
      created_at: source.createdAt
    }

    const groupRows = database
      .prepare(
        `
      SELECT g.id, g.name, g.position, g.legacy_ref_count
      FROM stages s
      JOIN competition_groups g ON g.stage_id = s.id
      WHERE s.competition_id = ?
      ORDER BY g.position
    `
      )
      .all(competition.id) as Array<{
      id: string
      name: string
      position: number
      legacy_ref_count: number
    }>
    const groups = groupRows.map((group) => {
      const players = database
        .prepare(
          `
        SELECT name FROM contestants WHERE group_id = ? ORDER BY position
      `
        )
        .all(group.id) as Array<{ name: string }>
      const referees = database
        .prepare(
          `
        SELECT source_referee_index, name, mode
        FROM referees
        WHERE group_id = ?
        ORDER BY source_referee_index
      `
        )
        .all(group.id) as Array<{
        source_referee_index: number
        name: string
        mode: string
      }>
      return {
        name: group.name,
        refCount: group.legacy_ref_count,
        players: players.map((player) => player.name),
        referees: referees.map((referee) => ({
          index: Number(referee.source_referee_index),
          name: referee.name,
          mode: referee.mode === 'DUAL' ? ('DUAL' as const) : ('SINGLE' as const)
        }))
      }
    })
    const mediaRows = database
      .prepare(
        `
      SELECT g.name AS group_name, p.name AS contestant_name,
        mb.provider, mb.media_id, mb.canonical_url
      FROM stages s
      JOIN competition_groups g ON g.stage_id = s.id
      JOIN contestants p ON p.group_id = g.id
      JOIN media_bindings mb ON mb.contestant_id = p.id
      WHERE s.competition_id = ?
    `
      )
      .all(competition.id) as Array<Record<string, string>>
    const media: Record<string, Record<string, Record<string, string>>> = {}
    for (const row of mediaRows) {
      media[row.group_name] ??= {}
      media[row.group_name][row.contestant_name] = {
        provider: row.provider,
        video_id: row.media_id,
        canonical_url: row.canonical_url
      }
    }

    const scoreRows = database
      .prepare(
        `
      SELECT * FROM (
        SELECT
          g.name AS group_name,
          p.name AS contestant_name,
          r.source_referee_index,
          e.current_total,
          e.total_plus,
          e.total_minus,
          e.major_penalty,
          ROW_NUMBER() OVER (
            PARTITION BY p.id, r.id
            ORDER BY e.system_time DESC, e.event_id DESC
          ) AS position
        FROM stages s
        JOIN competition_groups g ON g.stage_id = s.id
        JOIN contestants p ON p.group_id = g.id
        JOIN match_sessions ms ON ms.contestant_id = p.id
        JOIN score_events e ON e.match_session_id = ms.id
        JOIN referees r ON r.id = e.referee_id
        WHERE s.competition_id = ?
      ) WHERE position = 1
    `
      )
      .all(competition.id) as Array<Record<string, string | number>>
    const scores: Record<
      string,
      Record<
        string,
        Record<
          number,
          {
            total: number
            plus: number
            minus: number
            penalty: number
          }
        >
      >
    > = {}
    for (const row of scoreRows) {
      const groupName = String(row.group_name)
      const contestantName = String(row.contestant_name)
      scores[groupName] ??= {}
      scores[groupName][contestantName] ??= {}
      scores[groupName][contestantName][Number(row.source_referee_index)] = {
        total: Number(row.current_total),
        plus: Number(row.total_plus),
        minus: Number(row.total_minus),
        penalty: Number(row.major_penalty)
      }
    }
    return {
      status: 'ok',
      config: {
        project_name: competition.name,
        mode: competition.mode === 'TOURNAMENT' ? 'TOURNAMENT' : 'FREE',
        created_at: competition.created_at,
        groups,
        media
      },
      scores
    }
  }

  listLegacyProjects(): Array<Record<string, unknown>> {
    const rows = this.requireDatabase()
      .prepare(
        `
      SELECT li.source_key
      FROM legacy_imports li
      JOIN competitions c ON c.id = li.competition_id
      ORDER BY c.created_at DESC, li.source_key DESC
    `
      )
      .all() as Array<{ source_key: string }>
    return rows.flatMap((row) => {
      const report = this.getLegacyReport(row.source_key)
      return report ? [{ dir_name: row.source_key, ...report.config }] : []
    })
  }

  deleteLegacyProject(sourceKey: string): boolean {
    const database = this.requireDatabase()
    const row = database
      .prepare('SELECT competition_id FROM legacy_imports WHERE source_key = ?')
      .get(sourceKey) as { competition_id: string } | undefined
    if (!row) return false
    const result = database.prepare('DELETE FROM competitions WHERE id = ?').run(row.competition_id)
    return Number(result.changes) === 1
  }

  private resolveCompetitionSourceFrom(
    database: DatabaseSync,
    sourceKey: string
  ): {
    competitionId: string
    sourceKey: string
    projectName: string
    mode: 'FREE' | 'TOURNAMENT'
    createdAt: string
    isLegacy: boolean
  } | null {
    const row = database
      .prepare(
        `
      SELECT c.id, c.name, c.mode, c.created_at, li.source_key
      FROM competitions c
      LEFT JOIN legacy_imports li ON li.competition_id = c.id
      WHERE li.source_key = ? OR c.id = ?
      ORDER BY CASE WHEN li.source_key = ? THEN 0 ELSE 1 END
      LIMIT 1
    `
      )
      .get(sourceKey, sourceKey, sourceKey) as
      | {
          id: string
          name: string
          mode: string
          created_at: string
          source_key: string | null
        }
      | undefined
    if (!row) return null
    return {
      competitionId: row.id,
      sourceKey: row.source_key || row.id,
      projectName: row.name,
      mode: row.mode === 'TOURNAMENT' ? 'TOURNAMENT' : 'FREE',
      createdAt: row.created_at,
      isLegacy: Boolean(row.source_key)
    }
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
    const stage = database
      .prepare(
        `
      SELECT id FROM stages WHERE competition_id = ? ORDER BY position LIMIT 1
    `
      )
      .get(competitionId) as { id: string } | undefined
    if (!stage) throw new Error('COMPETITION_NOT_FOUND')

    database.prepare('DELETE FROM referees WHERE stage_id = ?').run(stage.id)
    database.prepare('DELETE FROM competition_groups WHERE stage_id = ?').run(stage.id)
    groups.forEach((group, groupPosition) => {
      const groupId = stableDatabaseId(sourceKey, 'group', String(groupPosition), group.name)
      database
        .prepare(
          `
        INSERT INTO competition_groups (id, stage_id, name, position, legacy_ref_count)
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
          INSERT INTO match_sessions (
            id, contestant_id, attempt_number, status, rule_version
          ) VALUES (?, ?, 1, 'pending', 'route-b-v1')
        `
          )
          .run(stableDatabaseId(sourceKey, contestantId, 'session', '1'), contestantId)
      })
      group.referees.forEach((referee) => {
        const refereeId = stableDatabaseId(sourceKey, groupId, 'referee', String(referee.index))
        database
          .prepare(
            `
          INSERT INTO referees (
            id, stage_id, referee_index, name, mode, group_id, source_referee_index
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `
          )
          .run(
            refereeId,
            stage.id,
            groupPosition * 100000 + referee.index,
            referee.name,
            referee.mode,
            groupId,
            referee.index
          )
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
          .prepare(
            `
          SELECT id FROM referees
          WHERE group_id = ? AND source_referee_index = ?
          LIMIT 1
        `
          )
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

  private applyMigrations(currentVersion: number): void {
    const database = this.requireDatabase()
    database.exec('BEGIN IMMEDIATE')
    try {
      for (const migration of MIGRATIONS) {
        if (migration.version <= currentVersion) continue
        database.exec(migration.sql)
        database.exec(`PRAGMA user_version = ${migration.version}`)
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  private insertScoreEvent(database: DatabaseSync, event: StoredScoreEvent): boolean {
    validateScoreEvent(event)
    const result = database
      .prepare(
        `
      INSERT OR IGNORE INTO score_events (
        event_id, match_session_id, referee_id, connection_id, device_id, role,
        event_type, device_timestamp_ms, received_at, system_time, total_plus,
        total_minus, current_total, major_penalty, media_provider, media_id,
        media_time_ms, media_sync_status, raw_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        event.eventId,
        event.matchSessionId ?? null,
        event.refereeId ?? null,
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
        event.mediaSyncStatus ?? 'not_ready',
        JSON.stringify(event)
      )
    return Number(result.changes) === 1
  }

  private createMigrationBackup(currentVersion: number): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = path.join(this.backupRoot, `ft-engine-v${currentVersion}-${timestamp}.db`)
    copyFileSync(this.databasePath, backupPath)
    return backupPath
  }

  private requireDatabase(): DatabaseSync {
    if (!this.database) throw new Error('Local database is not open')
    return this.database
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

function validateLegacyImport(input: LegacyProjectImport): void {
  if (
    !input ||
    typeof input.sourceKey !== 'string' ||
    !input.sourceKey ||
    typeof input.sourceHash !== 'string' ||
    input.sourceHash.length !== 64 ||
    typeof input.competition?.id !== 'string' ||
    !input.competition.id ||
    typeof input.stage?.id !== 'string' ||
    !input.stage.id ||
    !Array.isArray(input.groups)
  ) {
    throw new Error('Invalid legacy project import')
  }
}

function legacyRefereeIndex(connectionId: string): number {
  const match = /^legacy-ref-(\d+)-/.exec(connectionId)
  return match ? Number(match[1]) : 0
}

function stableDatabaseId(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32)
}
