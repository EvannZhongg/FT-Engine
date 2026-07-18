import type { DatabaseSync } from 'node:sqlite'
import { resolveContestant } from '../sqlite/competition-context.mts'
import { stableDatabaseId } from '../sqlite/ids.mts'
import type { SqliteConnection } from '../sqlite/connection.mts'

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
  attemptNumber: number
  refereeIndex: number
  event: Omit<StoredScoreEvent, 'matchSessionId' | 'refereeId'>
}

export type MatchScoreEventWriteResult =
  | { status: 'inserted' }
  | { status: 'duplicate' }
  | { status: 'context_missing' }

export class MatchRepository {
  private readonly connection: SqliteConnection

  constructor(connection: SqliteConnection) {
    this.connection = connection
  }

  appendScoreEvent(input: MatchScoreEventWrite): MatchScoreEventWriteResult {
    validateScoreEvent(input.event)
    if (
      !Number.isSafeInteger(input.attemptNumber) ||
      input.attemptNumber < 1 ||
      input.attemptNumber > 20
    ) {
      throw new Error('MATCH_ATTEMPT_INVALID')
    }
    const database = this.connection.requireDatabase()
    database.exec('BEGIN IMMEDIATE')
    try {
      const context = this.resolveContext(database, input)
      if (!context) {
        database.exec('ROLLBACK')
        return { status: 'context_missing' }
      }
      const activeStage = database
        .prepare(
          "SELECT id FROM stages WHERE competition_id = ? AND status = 'active' AND id <> ? LIMIT 1"
        )
        .get(context.competitionId, context.stageId)
      if (activeStage) throw new Error('MATCH_STAGE_CONFLICT')
      database
        .prepare("UPDATE stages SET status = 'active' WHERE id = ? AND status = 'draft'")
        .run(context.stageId)
      database
        .prepare(
          "UPDATE competitions SET status = 'active', updated_at = ? WHERE id = ? AND status = 'draft'"
        )
        .run(input.event.systemTime, context.competitionId)
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
    const database = this.connection.requireDatabase()
    const contestant = resolveContestant(database, sourceKey, groupName, contestantName)
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

  listScoreEvents(): StoredScoreEvent[] {
    const rows = this.connection
      .requireDatabase()
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

  private resolveContext(
    database: DatabaseSync,
    input: MatchScoreEventWrite
  ): { competitionId: string; stageId: string; matchSessionId: string; refereeId: string } | null {
    const row = database
      .prepare(
        `
      SELECT c.id AS competition_id, s.id AS stage_id,
        ms.id AS match_session_id, r.id AS referee_id
      FROM competitions c
      JOIN stages s ON s.competition_id = c.id
      JOIN competition_groups g ON g.stage_id = s.id
      JOIN contestants p ON p.group_id = g.id
      JOIN match_sessions ms ON ms.contestant_id = p.id AND ms.attempt_number = ?
      JOIN referees r ON r.group_id = g.id AND r.referee_index = ?
      WHERE c.id = ? AND g.name = ? AND p.name = ?
        AND c.status NOT IN ('completed', 'archived')
        AND s.status <> 'completed'
        AND ms.status IN ('pending', 'active')
      ORDER BY s.position
      LIMIT 1
    `
      )
      .get(
        input.attemptNumber,
        input.refereeIndex,
        input.sourceKey,
        input.groupName,
        input.contestantName
      ) as
      | {
          competition_id: string
          stage_id: string
          match_session_id: string
          referee_id: string
        }
      | undefined
    return row
      ? {
          competitionId: row.competition_id,
          stageId: row.stage_id,
          matchSessionId: row.match_session_id,
          refereeId: row.referee_id
        }
      : null
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
