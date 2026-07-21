import { resolveContestant } from '../sqlite/competition-context.mts'
import type { SqliteConnection } from '../sqlite/connection.mts'
import type {
  MediaBinding,
  MediaBindingVersion,
  MediaProvider
} from '../../../shared/media/media-contract.mts'

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
  media_segment: string
  media_binding_version_id: string | null
  media_time_ms: number | null
  media_sync_status: string
}

export class ReplayQuery {
  private readonly connection: SqliteConnection

  constructor(connection: SqliteConnection) {
    this.connection = connection
  }

  listScoredContestants(
    sourceKey: string,
    stageId: string,
    groupName: string,
    attemptNumber: number
  ): string[] {
    const rows = this.connection
      .requireDatabase()
      .prepare(
        `
      SELECT DISTINCT p.name, p.position
      FROM competitions c
      JOIN stages s ON s.competition_id = c.id
      JOIN competition_groups g ON g.stage_id = s.id
      JOIN contestants p ON p.group_id = g.id
      JOIN match_sessions ms ON ms.contestant_id = p.id
      WHERE c.id = ? AND s.id = ? AND g.name = ?
        AND ms.attempt_number = ? AND ms.status = 'completed'
      ORDER BY p.position
    `
      )
      .all(sourceKey, stageId, groupName, attemptNumber) as Array<{ name: string }>
    return rows.map((row) => row.name)
  }

  get(
    sourceKey: string,
    groupName: string,
    contestantName: string
  ): {
    status: 'ok'
    binding: MediaBinding | null
    binding_versions: MediaBindingVersion[]
    events: ReplayEvent[]
  } | null {
    const database = this.connection.requireDatabase()
    const contestant = resolveContestant(database, sourceKey, groupName, contestantName)
    if (!contestant) return null
    const bindingRow = database
      .prepare(
        `
      SELECT mb.id, mb.contestant_id, mb.current_version_id, mb.updated_at,
        mv.revision, mv.provider, mv.media_id, mv.segment, mv.canonical_url
      FROM media_bindings mb
      JOIN media_binding_versions mv ON mv.id = mb.current_version_id
      WHERE mb.contestant_id = ?
    `
      )
      .get(contestant.id) as Record<string, string | number> | undefined
    const versionRows = database
      .prepare(
        `SELECT DISTINCT mv.id, mv.contestant_id, mv.revision, mv.provider,
          mv.media_id, mv.segment, mv.canonical_url, mv.created_at
         FROM media_binding_versions mv
         JOIN score_events e ON e.media_binding_version_id = mv.id
         JOIN match_sessions ms ON ms.id = e.match_session_id
         WHERE ms.contestant_id = ?
         ORDER BY mv.revision, mv.created_at, mv.id`
      )
      .all(contestant.id) as Array<Record<string, string | number>>
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
        media_segment: String(row.media_segment),
        media_binding_version_id:
          row.media_binding_version_id === null ? null : String(row.media_binding_version_id),
        media_time_ms: row.media_time_ms === null ? null : Number(row.media_time_ms),
        media_sync_status: String(row.media_sync_status)
      }
    })
    return {
      status: 'ok',
      binding: bindingRow
        ? {
            id: String(bindingRow.id),
            contestant_id: String(bindingRow.contestant_id),
            version_id: String(bindingRow.current_version_id),
            revision: Number(bindingRow.revision),
            provider: provider(bindingRow.provider),
            media_id: String(bindingRow.media_id),
            segment: String(bindingRow.segment),
            canonical_url: String(bindingRow.canonical_url),
            updated_at: String(bindingRow.updated_at)
          }
        : null,
      binding_versions: versionRows.map((row) => ({
        id: String(row.id),
        contestant_id: String(row.contestant_id),
        revision: Number(row.revision),
        provider: provider(row.provider),
        media_id: String(row.media_id),
        segment: String(row.segment),
        canonical_url: String(row.canonical_url),
        created_at: String(row.created_at)
      })),
      events
    }
  }
}

function provider(value: unknown): MediaProvider {
  return value === 'bilibili' ? 'bilibili' : 'youtube'
}
