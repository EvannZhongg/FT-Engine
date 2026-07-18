import type { DatabaseSync } from 'node:sqlite'

export interface CompetitionRow {
  id: string
  name: string
  mode: 'FREE' | 'TOURNAMENT'
  createdAt: string
}

export function resolveCompetition(
  database: DatabaseSync,
  sourceKey: string
): CompetitionRow | null {
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

export function findFirstStage(
  database: DatabaseSync,
  competitionId: string
): { id: string; name: string; position: number; status: string; attempts: number } | null {
  const row = database
    .prepare(
      'SELECT id, name, position, status, attempts FROM stages WHERE competition_id = ? ORDER BY position LIMIT 1'
    )
    .get(competitionId) as
    | { id: string; name: string; position: number; status: string; attempts: number }
    | undefined
  return row || null
}

export function resolveContestant(
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
