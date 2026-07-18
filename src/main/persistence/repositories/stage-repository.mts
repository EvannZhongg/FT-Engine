import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { StageConfigInput } from '../../../shared/contracts/stage.mts'
import type {
  CompetitionStageConfig,
  CompetitionStatus,
  StageStatus
} from '../../../shared/contracts/stage.mts'
import type { SqliteConnection } from '../sqlite/connection.mts'
import { readStageGroups, replaceStageGraph } from '../sqlite/stage-graph.mts'

interface StageRow {
  id: string
  competition_id: string
  competition_status: CompetitionStatus
  name: string
  position: number
  status: StageStatus
  attempts: number
}

export class StageRepository {
  private readonly connection: SqliteConnection

  constructor(connection: SqliteConnection) {
    this.connection = connection
  }

  list(competitionId: string): CompetitionStageConfig[] {
    const database = this.connection.requireDatabase()
    this.requireCompetitionStatus(database, competitionId)
    return this.stageRows(database, competitionId).map((row) => this.toConfig(database, row))
  }

  create(competitionId: string, input: StageConfigInput): CompetitionStageConfig {
    const database = this.connection.requireDatabase()
    this.assertCompetitionDraft(database, competitionId)
    this.assertUniqueName(database, competitionId, input.name)
    const row = database
      .prepare(
        'SELECT COALESCE(MAX(position), -1) + 1 AS position FROM stages WHERE competition_id = ?'
      )
      .get(competitionId) as { position: number }
    const stageId = randomUUID()
    database.exec('BEGIN IMMEDIATE')
    try {
      database
        .prepare(
          `
          INSERT INTO stages (id, competition_id, name, position, status, attempts)
          VALUES (?, ?, ?, ?, 'draft', ?)
        `
        )
        .run(stageId, competitionId, input.name, Number(row.position), input.attempts)
      replaceStageGraph(database, competitionId, stageId, input.attempts, input.groups)
      this.touchCompetition(database, competitionId)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return this.requireConfig(stageId)
  }

  update(stageId: string, input: StageConfigInput): CompetitionStageConfig {
    const database = this.connection.requireDatabase()
    const stage = this.requireStage(database, stageId)
    if (stage.competition_status !== 'draft' || stage.status !== 'draft') {
      throw new Error('STAGE_STRUCTURE_LOCKED')
    }
    if (this.countEvents(database, stageId) > 0) throw new Error('STAGE_STRUCTURE_LOCKED')
    this.assertUniqueName(database, stage.competition_id, input.name, stageId)

    database.exec('BEGIN IMMEDIATE')
    try {
      database
        .prepare('UPDATE stages SET name = ?, attempts = ? WHERE id = ?')
        .run(input.name, input.attempts, stageId)
      replaceStageGraph(database, stage.competition_id, stageId, input.attempts, input.groups)
      this.touchCompetition(database, stage.competition_id)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return this.requireConfig(stageId)
  }

  reorder(competitionId: string, stageIds: string[]): CompetitionStageConfig[] {
    const database = this.connection.requireDatabase()
    this.assertCompetitionDraft(database, competitionId)
    const storedIds = this.stageRows(database, competitionId).map((stage) => stage.id)
    if (
      storedIds.length !== stageIds.length ||
      storedIds.some((stageId) => !stageIds.includes(stageId))
    ) {
      throw new Error('STAGE_ORDER_INVALID')
    }

    database.exec('BEGIN IMMEDIATE')
    try {
      database
        .prepare('UPDATE stages SET position = position + 1000 WHERE competition_id = ?')
        .run(competitionId)
      stageIds.forEach((stageId, position) => {
        database.prepare('UPDATE stages SET position = ? WHERE id = ?').run(position, stageId)
      })
      this.touchCompetition(database, competitionId)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return this.list(competitionId)
  }

  delete(stageId: string): boolean {
    const database = this.connection.requireDatabase()
    const stage = this.requireStage(database, stageId)
    if (stage.competition_status !== 'draft' || stage.status !== 'draft') {
      throw new Error('STAGE_STRUCTURE_LOCKED')
    }
    if (this.stageRows(database, stage.competition_id).length <= 1) {
      throw new Error('STAGE_LAST_REQUIRED')
    }
    if (this.countEvents(database, stageId) > 0) throw new Error('STAGE_STRUCTURE_LOCKED')

    database.exec('BEGIN IMMEDIATE')
    try {
      const result = database.prepare('DELETE FROM stages WHERE id = ?').run(stageId)
      this.compactPositions(database, stage.competition_id)
      this.touchCompetition(database, stage.competition_id)
      database.exec('COMMIT')
      return Number(result.changes) === 1
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  activate(stageId: string): CompetitionStageConfig {
    const database = this.connection.requireDatabase()
    const stage = this.requireStage(database, stageId)
    if (stage.status === 'active') return this.toConfig(database, stage)
    if (stage.status !== 'draft' || ['completed', 'archived'].includes(stage.competition_status)) {
      throw new Error('STAGE_STATE_CONFLICT')
    }
    const groupCount = database
      .prepare('SELECT COUNT(*) AS count FROM competition_groups WHERE stage_id = ?')
      .get(stageId) as { count: number }
    if (Number(groupCount.count) < 1) throw new Error('STAGE_EMPTY')
    const active = database
      .prepare("SELECT id FROM stages WHERE competition_id = ? AND status = 'active' AND id <> ?")
      .get(stage.competition_id, stageId)
    if (active) throw new Error('STAGE_ACTIVE_CONFLICT')

    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare("UPDATE stages SET status = 'active' WHERE id = ?").run(stageId)
      database
        .prepare("UPDATE competitions SET status = 'active', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), stage.competition_id)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return this.requireConfig(stageId)
  }

  complete(stageId: string): CompetitionStageConfig {
    const database = this.connection.requireDatabase()
    const stage = this.requireStage(database, stageId)
    if (stage.status === 'completed') return this.toConfig(database, stage)
    if (stage.status !== 'active') throw new Error('STAGE_STATE_CONFLICT')
    const incomplete = database
      .prepare(
        `
        SELECT ms.id
        FROM match_sessions ms
        JOIN contestants p ON p.id = ms.contestant_id
        JOIN competition_groups g ON g.id = p.group_id
        WHERE g.stage_id = ? AND ms.status NOT IN ('completed', 'invalidated')
        LIMIT 1
      `
      )
      .get(stageId)
    if (incomplete) throw new Error('STAGE_SESSIONS_INCOMPLETE')

    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare("UPDATE stages SET status = 'completed' WHERE id = ?").run(stageId)
      const remaining = database
        .prepare("SELECT id FROM stages WHERE competition_id = ? AND status <> 'completed' LIMIT 1")
        .get(stage.competition_id)
      database
        .prepare('UPDATE competitions SET status = ?, updated_at = ? WHERE id = ?')
        .run(remaining ? 'active' : 'completed', new Date().toISOString(), stage.competition_id)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return this.requireConfig(stageId)
  }

  private requireConfig(stageId: string): CompetitionStageConfig {
    const database = this.connection.requireDatabase()
    return this.toConfig(database, this.requireStage(database, stageId))
  }

  private toConfig(database: DatabaseSync, row: StageRow): CompetitionStageConfig {
    return {
      id: row.id,
      competitionId: row.competition_id,
      name: row.name,
      position: Number(row.position),
      status: row.status,
      attempts: Number(row.attempts),
      groups: readStageGroups(database, row.id)
    }
  }

  private stageRows(database: DatabaseSync, competitionId: string): StageRow[] {
    return database
      .prepare(
        `
        SELECT s.*, c.status AS competition_status
        FROM stages s
        JOIN competitions c ON c.id = s.competition_id
        WHERE s.competition_id = ?
        ORDER BY s.position
      `
      )
      .all(competitionId) as unknown as StageRow[]
  }

  private requireStage(database: DatabaseSync, stageId: string): StageRow {
    const row = database
      .prepare(
        `
        SELECT s.*, c.status AS competition_status
        FROM stages s JOIN competitions c ON c.id = s.competition_id
        WHERE s.id = ?
      `
      )
      .get(stageId) as unknown as StageRow | undefined
    if (!row) throw new Error('STAGE_NOT_FOUND')
    return row
  }

  private requireCompetitionStatus(
    database: DatabaseSync,
    competitionId: string
  ): CompetitionStatus {
    const row = database
      .prepare('SELECT status FROM competitions WHERE id = ?')
      .get(competitionId) as { status: CompetitionStatus } | undefined
    if (!row) throw new Error('COMPETITION_NOT_FOUND')
    return row.status
  }

  private assertCompetitionDraft(database: DatabaseSync, competitionId: string): void {
    if (this.requireCompetitionStatus(database, competitionId) !== 'draft') {
      throw new Error('STAGE_STRUCTURE_LOCKED')
    }
  }

  private assertUniqueName(
    database: DatabaseSync,
    competitionId: string,
    name: string,
    excludedStageId = ''
  ): void {
    const row = database
      .prepare('SELECT id FROM stages WHERE competition_id = ? AND name = ? AND id <> ?')
      .get(competitionId, name, excludedStageId)
    if (row) throw new Error('STAGE_NAME_DUPLICATE')
  }

  private countEvents(database: DatabaseSync, stageId: string): number {
    const row = database
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM score_events e
        JOIN match_sessions ms ON ms.id = e.match_session_id
        JOIN contestants p ON p.id = ms.contestant_id
        JOIN competition_groups g ON g.id = p.group_id
        WHERE g.stage_id = ?
      `
      )
      .get(stageId) as { count: number }
    return Number(row.count)
  }

  private compactPositions(database: DatabaseSync, competitionId: string): void {
    const ids = this.stageRows(database, competitionId).map((stage) => stage.id)
    database
      .prepare('UPDATE stages SET position = position + 1000 WHERE competition_id = ?')
      .run(competitionId)
    ids.forEach((id, position) => {
      database.prepare('UPDATE stages SET position = ? WHERE id = ?').run(position, id)
    })
  }

  private touchCompetition(database: DatabaseSync, competitionId: string): void {
    database
      .prepare('UPDATE competitions SET updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), competitionId)
  }
}
