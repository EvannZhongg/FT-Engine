import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { SqliteConnection } from '../sqlite/connection.mts'

export interface MatchProgressContext {
  sourceKey: string
  stageId: string
  groupName: string
  contestantName: string
  attemptNumber: number
}

interface SessionRow {
  competition_id: string
  competition_status: string
  stage_id: string
  stage_status: string
  contestant_id: string
  match_session_id: string
  match_status: 'pending' | 'active' | 'completed' | 'invalidated'
}

export class MatchProgressRepository {
  private readonly connection: SqliteConnection

  constructor(connection: SqliteConnection) {
    this.connection = connection
  }

  activate(context: MatchProgressContext, occurredAt: string): void {
    const database = this.connection.requireDatabase()
    database.exec('BEGIN IMMEDIATE')
    try {
      const session = this.requireSession(database, context)
      this.activateSession(database, session, occurredAt, 'start')
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  completeAndActivate(
    current: MatchProgressContext,
    next: MatchProgressContext,
    occurredAt: string
  ): void {
    const database = this.connection.requireDatabase()
    database.exec('BEGIN IMMEDIATE')
    try {
      const currentSession = this.requireSession(database, current)
      const nextSession = this.requireSession(database, next)
      if (
        currentSession.competition_id !== nextSession.competition_id ||
        currentSession.stage_id !== nextSession.stage_id
      ) {
        throw new Error('MATCH_CONTEXT_TRANSITION_INVALID')
      }
      if (currentSession.match_session_id === nextSession.match_session_id) {
        database.exec('COMMIT')
        return
      }
      if (currentSession.match_status === 'completed' && nextSession.match_status === 'active') {
        database.exec('COMMIT')
        return
      }
      this.completeSession(database, currentSession, occurredAt, 'context_switch')
      this.activateSession(database, nextSession, occurredAt, 'context_switch')
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  complete(context: MatchProgressContext, occurredAt: string): void {
    const database = this.connection.requireDatabase()
    database.exec('BEGIN IMMEDIATE')
    try {
      this.completeSession(database, this.requireSession(database, context), occurredAt, 'finish')
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  invalidate(context: MatchProgressContext, occurredAt: string): void {
    const database = this.connection.requireDatabase()
    database.exec('BEGIN IMMEDIATE')
    try {
      const session = this.requireSession(database, context)
      if (session.match_status === 'invalidated') {
        database.exec('COMMIT')
        return
      }
      if (session.match_status === 'pending') throw new Error('MATCH_STATE_CONFLICT')
      database
        .prepare(
          `
          UPDATE match_sessions
          SET status = 'invalidated', invalidated_at = ?
          WHERE id = ?
        `
        )
        .run(occurredAt, session.match_session_id)
      this.recordTransition(
        database,
        session.match_session_id,
        session.match_status,
        'invalidated',
        'invalidate',
        occurredAt
      )
      this.updateContestantStatus(database, session.contestant_id)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  private activateSession(
    database: DatabaseSync,
    session: SessionRow,
    occurredAt: string,
    reason: string
  ): void {
    if (session.match_status === 'active') return
    if (
      !['pending', 'completed'].includes(session.match_status) ||
      ['completed', 'archived'].includes(session.competition_status) ||
      session.stage_status === 'completed'
    ) {
      throw new Error('MATCH_STATE_CONFLICT')
    }
    const competingStage = database
      .prepare(
        "SELECT id FROM stages WHERE competition_id = ? AND status = 'active' AND id <> ? LIMIT 1"
      )
      .get(session.competition_id, session.stage_id)
    if (competingStage) throw new Error('MATCH_STAGE_CONFLICT')

    database
      .prepare("UPDATE stages SET status = 'active' WHERE id = ? AND status = 'draft'")
      .run(session.stage_id)
    database
      .prepare(
        "UPDATE competitions SET status = 'active', updated_at = ? WHERE id = ? AND status = 'draft'"
      )
      .run(occurredAt, session.competition_id)
    database
      .prepare(
        `
        UPDATE match_sessions
        SET status = 'active', started_at = COALESCE(started_at, ?), completed_at = NULL
        WHERE id = ?
      `
      )
      .run(occurredAt, session.match_session_id)
    database
      .prepare("UPDATE contestants SET status = 'active' WHERE id = ?")
      .run(session.contestant_id)
    this.recordTransition(
      database,
      session.match_session_id,
      session.match_status,
      'active',
      reason,
      occurredAt
    )
  }

  private completeSession(
    database: DatabaseSync,
    session: SessionRow,
    occurredAt: string,
    reason: string
  ): void {
    if (session.match_status === 'completed') return
    if (session.match_status !== 'active') throw new Error('MATCH_STATE_CONFLICT')
    database
      .prepare("UPDATE match_sessions SET status = 'completed', completed_at = ? WHERE id = ?")
      .run(occurredAt, session.match_session_id)
    this.recordTransition(
      database,
      session.match_session_id,
      session.match_status,
      'completed',
      reason,
      occurredAt
    )
    this.updateContestantStatus(database, session.contestant_id)
  }

  private updateContestantStatus(database: DatabaseSync, contestantId: string): void {
    const remaining = database
      .prepare(
        "SELECT id FROM match_sessions WHERE contestant_id = ? AND status IN ('pending', 'active') LIMIT 1"
      )
      .get(contestantId)
    database
      .prepare('UPDATE contestants SET status = ? WHERE id = ?')
      .run(remaining ? 'active' : 'completed', contestantId)
  }

  private requireSession(database: DatabaseSync, context: MatchProgressContext): SessionRow {
    validateContext(context)
    const row = database
      .prepare(
        `
        SELECT c.id AS competition_id, c.status AS competition_status,
          s.id AS stage_id, s.status AS stage_status, p.id AS contestant_id,
          ms.id AS match_session_id, ms.status AS match_status
        FROM competitions c
        JOIN stages s ON s.competition_id = c.id
        JOIN competition_groups g ON g.stage_id = s.id
        JOIN contestants p ON p.group_id = g.id
        JOIN match_sessions ms ON ms.contestant_id = p.id AND ms.attempt_number = ?
        WHERE c.id = ? AND s.id = ? AND g.name = ? AND p.name = ?
        LIMIT 1
      `
      )
      .get(
        context.attemptNumber,
        context.sourceKey,
        context.stageId,
        context.groupName,
        context.contestantName
      ) as unknown as SessionRow | undefined
    if (!row) throw new Error('MATCH_CONTEXT_INVALID')
    return row
  }

  private recordTransition(
    database: DatabaseSync,
    matchSessionId: string,
    fromStatus: string,
    toStatus: string,
    reason: string,
    occurredAt: string
  ): void {
    database
      .prepare(
        `
        INSERT INTO match_session_transitions (
          id, match_session_id, from_status, to_status, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `
      )
      .run(randomUUID(), matchSessionId, fromStatus, toStatus, reason, occurredAt)
  }
}

function validateContext(context: MatchProgressContext): void {
  if (
    !context ||
    typeof context.sourceKey !== 'string' ||
    !context.sourceKey ||
    typeof context.stageId !== 'string' ||
    !context.stageId ||
    typeof context.groupName !== 'string' ||
    !context.groupName ||
    typeof context.contestantName !== 'string' ||
    !context.contestantName ||
    !Number.isSafeInteger(context.attemptNumber) ||
    context.attemptNumber < 1 ||
    context.attemptNumber > 20
  ) {
    throw new Error('MATCH_CONTEXT_INVALID')
  }
}
