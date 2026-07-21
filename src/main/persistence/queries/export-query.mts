import type {
  CompetitionExportSnapshot,
  ExportScoreEvent
} from '../../application/exports/export-service.mts'
import type { CompetitionRepository } from '../repositories/competition-repository.mts'
import { findFirstStage, resolveCompetition } from '../sqlite/competition-context.mts'
import type { SqliteConnection } from '../sqlite/connection.mts'

export class ExportQuery {
  private readonly connection: SqliteConnection
  private readonly competitions: Pick<CompetitionRepository, 'getConfig'>

  constructor(
    connection: SqliteConnection,
    competitions: Pick<CompetitionRepository, 'getConfig'>
  ) {
    this.connection = connection
    this.competitions = competitions
  }

  getCompetitionSnapshot(sourceKey: string): CompetitionExportSnapshot | null {
    const database = this.connection.requireDatabase()
    if (!resolveCompetition(database, sourceKey)) return null
    database.exec('BEGIN')
    try {
      const config = this.competitions.getConfig(sourceKey)
      const stage = findFirstStage(database, sourceKey)
      if (!config || !stage) {
        database.exec('COMMIT')
        return null
      }
      const rows = database
        .prepare(
          `
        SELECT g.name AS group_name, p.name AS contestant_name,
          r.referee_index, e.event_id, e.system_time, e.total_plus,
          e.total_minus, e.current_total, e.major_penalty,
          e.media_binding_version_id, e.media_provider, e.media_id,
          e.media_segment, e.media_time_ms, e.media_sync_status
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
          majorPenalty: Number(row.major_penalty),
          mediaBindingVersionId:
            row.media_binding_version_id === null ? null : String(row.media_binding_version_id),
          mediaProvider: String(row.media_provider),
          mediaId: String(row.media_id),
          mediaSegment: String(row.media_segment),
          mediaTimeMs: row.media_time_ms === null ? null : Number(row.media_time_ms),
          mediaSyncStatus: String(row.media_sync_status)
        })
        events.set(key, values)
      }
      const snapshot: CompetitionExportSnapshot = {
        sourceKey: config.id,
        competitionName: config.name,
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
}

function exportEventKey(groupName: string, contestantName: string, refereeIndex: number): string {
  return JSON.stringify([groupName, contestantName, refereeIndex])
}
