import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { MediaBinding, ParsedMediaUrl } from '../../../shared/media/media-contract.mts'
import { resolveStageContestant } from '../sqlite/competition-context.mts'
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
  mediaSegment?: string
  mediaBindingVersionId?: string | null
  mediaTimeMs?: number | null
  mediaSyncStatus?: string
}

export interface MatchScoreEventWrite {
  sourceKey: string
  stageId: string
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
      if (context.matchStatus === 'pending') {
        database
          .prepare(
            `
            INSERT OR IGNORE INTO match_session_transitions (
              id, match_session_id, from_status, to_status, reason, created_at
            ) VALUES (?, ?, 'pending', 'active', 'score_event', ?)
          `
          )
          .run(
            stableDatabaseId(context.matchSessionId, 'transition', 'score-event'),
            context.matchSessionId,
            input.event.systemTime
          )
        database
          .prepare("UPDATE contestants SET status = 'active' WHERE id = ?")
          .run(context.contestantId)
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

  replaceMediaBinding(
    sourceKey: string,
    stageId: string,
    groupName: string,
    contestantName: string,
    binding: ParsedMediaUrl
  ): MediaBinding | null {
    const database = this.connection.requireDatabase()
    const contestant = resolveStageContestant(
      database,
      sourceKey,
      stageId,
      groupName,
      contestantName
    )
    if (!contestant) return null
    database.exec('BEGIN IMMEDIATE')
    try {
      const current = this.getMediaBindingByContestant(database, contestant.id)
      if (
        current?.provider === binding.provider &&
        current.media_id === binding.media_id &&
        current.segment === binding.segment &&
        current.canonical_url === binding.canonical_url
      ) {
        database.exec('COMMIT')
        return current
      }
      const latest = database
        .prepare(
          'SELECT COALESCE(MAX(revision), 0) AS revision FROM media_binding_versions WHERE contestant_id = ?'
        )
        .get(contestant.id) as { revision: number }
      const versionId = randomUUID()
      const revision = Number(latest.revision) + 1
      const now = new Date().toISOString()
      database
        .prepare(
          `INSERT INTO media_binding_versions (
            id, contestant_id, revision, provider, media_id, segment, canonical_url, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          versionId,
          contestant.id,
          revision,
          binding.provider,
          binding.media_id,
          binding.segment,
          binding.canonical_url,
          now
        )
      database
        .prepare(
          `INSERT INTO media_bindings (id, contestant_id, current_version_id, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(contestant_id) DO UPDATE SET
             current_version_id = excluded.current_version_id,
             updated_at = excluded.updated_at`
        )
        .run(stableDatabaseId(sourceKey, contestant.id, 'media'), contestant.id, versionId, now)
      database.exec('COMMIT')
      return {
        id: stableDatabaseId(sourceKey, contestant.id, 'media'),
        contestant_id: contestant.id,
        version_id: versionId,
        revision,
        provider: binding.provider,
        media_id: binding.media_id,
        segment: binding.segment,
        canonical_url: binding.canonical_url,
        updated_at: now
      }
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  getMediaBinding(
    sourceKey: string,
    stageId: string,
    groupName: string,
    contestantName: string
  ): MediaBinding | null {
    const database = this.connection.requireDatabase()
    const contestant = resolveStageContestant(
      database,
      sourceKey,
      stageId,
      groupName,
      contestantName
    )
    return contestant ? this.getMediaBindingByContestant(database, contestant.id) : null
  }

  removeMediaBinding(
    sourceKey: string,
    stageId: string,
    groupName: string,
    contestantName: string
  ): boolean {
    const database = this.connection.requireDatabase()
    const contestant = resolveStageContestant(
      database,
      sourceKey,
      stageId,
      groupName,
      contestantName
    )
    if (!contestant) return false
    database.prepare('DELETE FROM media_bindings WHERE contestant_id = ?').run(contestant.id)
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
      mediaSegment: String(row.media_segment),
      mediaBindingVersionId:
        row.media_binding_version_id === null ? null : String(row.media_binding_version_id),
      mediaTimeMs: row.media_time_ms === null ? null : Number(row.media_time_ms),
      mediaSyncStatus: String(row.media_sync_status)
    }))
  }

  private resolveContext(
    database: DatabaseSync,
    input: MatchScoreEventWrite
  ): {
    competitionId: string
    stageId: string
    contestantId: string
    matchSessionId: string
    matchStatus: string
    refereeId: string
  } | null {
    const row = database
      .prepare(
        `
      SELECT c.id AS competition_id, s.id AS stage_id, p.id AS contestant_id,
        ms.id AS match_session_id, ms.status AS match_status, r.id AS referee_id
      FROM competitions c
      JOIN stages s ON s.competition_id = c.id
      JOIN competition_groups g ON g.stage_id = s.id
      JOIN contestants p ON p.group_id = g.id
      JOIN match_sessions ms ON ms.contestant_id = p.id AND ms.attempt_number = ?
      JOIN referees r ON r.group_id = g.id AND r.referee_index = ?
      WHERE c.id = ? AND s.id = ? AND g.name = ? AND p.name = ?
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
        input.stageId,
        input.groupName,
        input.contestantName
      ) as
      | {
          competition_id: string
          stage_id: string
          contestant_id: string
          match_session_id: string
          match_status: string
          referee_id: string
        }
      | undefined
    return row
      ? {
          competitionId: row.competition_id,
          stageId: row.stage_id,
          contestantId: row.contestant_id,
          matchSessionId: row.match_session_id,
          matchStatus: row.match_status,
          refereeId: row.referee_id
        }
      : null
  }

  private insertScoreEvent(database: DatabaseSync, event: StoredScoreEvent): boolean {
    validateScoreEvent(event)
    if (!event.matchSessionId || !event.refereeId) throw new Error('MATCH_CONTEXT_INVALID')
    const existing = database
      .prepare('SELECT 1 FROM score_events WHERE event_id = ?')
      .get(event.eventId)
    if (existing) return false
    const result = database
      .prepare(
        `
      INSERT INTO score_events (
        event_id, match_session_id, referee_id, connection_id, device_id, role,
        event_type, device_timestamp_ms, received_at, system_time, total_plus,
        total_minus, current_total, major_penalty, media_binding_version_id,
        media_provider, media_id, media_segment, media_time_ms, media_sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        event.mediaBindingVersionId ?? null,
        event.mediaProvider ?? '',
        event.mediaId ?? '',
        event.mediaSegment ?? '',
        event.mediaTimeMs ?? null,
        event.mediaSyncStatus ?? 'not_ready'
      )
    return Number(result.changes) === 1
  }

  private getMediaBindingByContestant(
    database: DatabaseSync,
    contestantId: string
  ): MediaBinding | null {
    const row = database
      .prepare(
        `SELECT mb.id, mb.contestant_id, mb.current_version_id, mb.updated_at,
          mv.revision, mv.provider, mv.media_id, mv.segment, mv.canonical_url
         FROM media_bindings mb
         JOIN media_binding_versions mv ON mv.id = mb.current_version_id
         WHERE mb.contestant_id = ?`
      )
      .get(contestantId) as Record<string, string | number> | undefined
    return row
      ? {
          id: String(row.id),
          contestant_id: String(row.contestant_id),
          version_id: String(row.current_version_id),
          revision: Number(row.revision),
          provider: row.provider === 'bilibili' ? 'bilibili' : 'youtube',
          media_id: String(row.media_id),
          segment: String(row.segment),
          canonical_url: String(row.canonical_url),
          updated_at: String(row.updated_at)
        }
      : null
  }
}

function validateScoreEvent(event: StoredScoreEvent): void {
  const mediaStatus = event.mediaSyncStatus ?? 'not_ready'
  const mediaProvider = event.mediaProvider ?? ''
  const mediaId = event.mediaId ?? ''
  const mediaSegment = event.mediaSegment ?? ''
  const bindingVersionId = event.mediaBindingVersionId ?? null
  const mediaTimeMs = event.mediaTimeMs ?? null
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
    !Number.isSafeInteger(event.majorPenalty) ||
    !['not_ready', 'aligned', 'stale', 'context_mismatch', 'unsupported', 'error'].includes(
      mediaStatus
    ) ||
    !['', 'youtube', 'bilibili'].includes(mediaProvider) ||
    typeof mediaId !== 'string' ||
    mediaId.length > 256 ||
    typeof mediaSegment !== 'string' ||
    mediaSegment.length > 64 ||
    (bindingVersionId !== null &&
      (typeof bindingVersionId !== 'string' ||
        !bindingVersionId ||
        bindingVersionId.length > 256)) ||
    (mediaTimeMs !== null && (!Number.isSafeInteger(mediaTimeMs) || mediaTimeMs < 0)) ||
    (mediaStatus === 'aligned' &&
      (!bindingVersionId || !mediaProvider || !mediaId || mediaTimeMs === null))
  ) {
    throw new Error('Invalid score event')
  }
}
