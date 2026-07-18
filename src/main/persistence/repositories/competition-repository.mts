import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  type CompetitionCreateInput,
  type CompetitionUpdateInput,
  hasSameCompetitionStructure
} from '../../application/competitions/competition-service.mts'
import type {
  CompetitionConfig,
  CompetitionListItem
} from '../../../shared/contracts/competition.mts'
import { findFirstStage, resolveCompetition } from '../sqlite/competition-context.mts'
import type { SqliteConnection } from '../sqlite/connection.mts'
import { readStageGroups, replaceStageGraph, updateStageBindings } from '../sqlite/stage-graph.mts'

export class CompetitionRepository {
  private readonly connection: SqliteConnection

  constructor(connection: SqliteConnection) {
    this.connection = connection
  }

  create(input: CompetitionCreateInput): CompetitionConfig {
    const database = this.connection.requireDatabase()
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
    return this.requireConfig(competitionId)
  }

  update(sourceKey: string, input: CompetitionUpdateInput): CompetitionConfig {
    const database = this.connection.requireDatabase()
    const competition = resolveCompetition(database, sourceKey)
    if (!competition) throw new Error('COMPETITION_NOT_FOUND')
    const current = this.requireConfig(sourceKey)
    const hasEvents = this.countEvents(database, competition.id) > 0
    if (hasEvents && !hasSameCompetitionStructure(current, input)) {
      throw new Error('COMPETITION_STRUCTURE_LOCKED')
    }

    database.exec('BEGIN IMMEDIATE')
    try {
      database
        .prepare('UPDATE competitions SET name = ?, mode = ?, updated_at = ? WHERE id = ?')
        .run(input.projectName, input.mode, new Date().toISOString(), competition.id)
      const stage = findFirstStage(database, competition.id)
      if (!stage) throw new Error('COMPETITION_NOT_FOUND')
      if (hasEvents) {
        updateStageBindings(database, competition.id, stage.id, input.groups)
      } else {
        replaceStageGraph(database, competition.id, stage.id, stage.attempts, input.groups)
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return this.requireConfig(sourceKey)
  }

  getConfig(sourceKey: string): CompetitionConfig | null {
    const database = this.connection.requireDatabase()
    const competition = resolveCompetition(database, sourceKey)
    if (!competition) return null
    const stage = findFirstStage(database, competition.id)
    if (!stage) return null
    const groups = readStageGroups(database, stage.id)
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

  list(): CompetitionListItem[] {
    const rows = this.connection
      .requireDatabase()
      .prepare('SELECT id FROM competitions ORDER BY updated_at DESC, created_at DESC')
      .all() as Array<{ id: string }>
    return rows.flatMap((row) => {
      const config = this.getConfig(row.id)
      return config ? [{ ...config, dir_name: config.source_key }] : []
    })
  }

  delete(sourceKey: string): boolean {
    const result = this.connection
      .requireDatabase()
      .prepare('DELETE FROM competitions WHERE id = ?')
      .run(sourceKey)
    return Number(result.changes) === 1
  }

  hasMatchContext(
    sourceKey: string,
    groupName: string,
    contestantName: string,
    attemptNumber: number,
    refereeIndexes: number[]
  ): boolean {
    const database = this.connection.requireDatabase()
    const stage = findFirstStage(database, sourceKey)
    if (!stage || attemptNumber < 1 || attemptNumber > stage.attempts) return false
    const config = this.getConfig(sourceKey)
    const group = config?.groups.find((value) => value.name === groupName)
    if (!group || !group.players.includes(contestantName)) return false
    const configuredIndexes = new Set(group.referees.map((referee) => referee.index))
    return refereeIndexes.every((index) => configuredIndexes.has(index))
  }

  private requireConfig(sourceKey: string): CompetitionConfig {
    const config = this.getConfig(sourceKey)
    if (!config) throw new Error('COMPETITION_NOT_FOUND')
    return config
  }

  private countEvents(database: DatabaseSync, competitionId: string): number {
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
}
