import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { LocalDatabase } from '../src/main/persistence/local-database.mts'

const roots = []
const group = {
  name: 'Final',
  refCount: 1,
  players: ['Alice', 'Bob'],
  referees: [
    {
      index: 1,
      name: 'Judge A',
      mode: 'SINGLE',
      primaryDeviceId: 'device-primary',
      secondaryDeviceId: ''
    }
  ]
}

function createFixture() {
  const root = path.join(tmpdir(), `ft-engine-progress-${randomUUID()}`)
  roots.push(root)
  const database = new LocalDatabase(path.join(root, 'ft-engine.db'), path.join(root, 'backups'))
  database.open()
  const competition = database.createCompetition({ name: 'Progress Event', mode: 'FREE' })
  database.updateCompetition(competition.id, {
    name: 'Progress Event',
    mode: 'FREE',
    groups: [group]
  })
  const context = (contestantName) => ({
    sourceKey: competition.id,
    groupName: 'Final',
    contestantName,
    attemptNumber: 1
  })
  return { database, competition, context }
}

function all(database, sql, ...params) {
  const connection = new DatabaseSync(database.databasePath)
  try {
    return connection
      .prepare(sql)
      .all(...params)
      .map((row) => ({ ...row }))
  } finally {
    connection.close()
  }
}

function run(database, sql, ...params) {
  const connection = new DatabaseSync(database.databasePath)
  try {
    return connection.prepare(sql).run(...params)
  } finally {
    connection.close()
  }
}

test.afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('activates, switches and completes sessions with an immutable audit trail', () => {
  const { database, competition, context } = createFixture()
  try {
    database.activateMatchSession(context('Alice'), '2026-07-19T01:00:00.000Z')
    database.transitionMatchSession(context('Alice'), context('Bob'), '2026-07-19T01:05:00.000Z')
    database.completeMatchSession(context('Bob'), '2026-07-19T01:10:00.000Z')

    assert.deepEqual(
      all(
        database,
        `SELECT p.name, ms.status FROM match_sessions ms
         JOIN contestants p ON p.id = ms.contestant_id ORDER BY p.position`
      ),
      [
        { name: 'Alice', status: 'completed' },
        { name: 'Bob', status: 'completed' }
      ]
    )
    assert.deepEqual(
      all(
        database,
        'SELECT from_status, to_status, reason FROM match_session_transitions ORDER BY created_at, rowid'
      ),
      [
        { from_status: 'pending', to_status: 'active', reason: 'start' },
        { from_status: 'active', to_status: 'completed', reason: 'context_switch' },
        { from_status: 'pending', to_status: 'active', reason: 'context_switch' },
        { from_status: 'active', to_status: 'completed', reason: 'finish' }
      ]
    )

    const stage = database.listStages(competition.id)[0]
    assert.equal(database.completeStage(stage.id).status, 'completed')
  } finally {
    database.close()
  }
})

test('rolls back current completion when the next session cannot activate', () => {
  const { database, context } = createFixture()
  try {
    database.activateMatchSession(context('Alice'), '2026-07-19T02:00:00.000Z')
    run(
      database,
      `UPDATE match_sessions SET status = 'invalidated'
       WHERE contestant_id = (SELECT id FROM contestants WHERE name = 'Bob')`
    )

    assert.throws(
      () =>
        database.transitionMatchSession(
          context('Alice'),
          context('Bob'),
          '2026-07-19T02:05:00.000Z'
        ),
      /MATCH_STATE_CONFLICT/
    )
    assert.deepEqual(
      all(
        database,
        `SELECT p.name, ms.status FROM match_sessions ms
         JOIN contestants p ON p.id = ms.contestant_id ORDER BY p.position`
      ),
      [
        { name: 'Alice', status: 'active' },
        { name: 'Bob', status: 'invalidated' }
      ]
    )
  } finally {
    database.close()
  }
})

test('invalidates a started session without mutating its score events', () => {
  const { database, context } = createFixture()
  try {
    database.activateMatchSession(context('Alice'), '2026-07-19T03:00:00.000Z')
    database.invalidateMatchSession(context('Alice'), '2026-07-19T03:01:00.000Z')
    assert.deepEqual(
      all(
        database,
        `SELECT ms.status, t.from_status, t.to_status, t.reason
         FROM match_sessions ms
         JOIN contestants p ON p.id = ms.contestant_id
         JOIN match_session_transitions t ON t.match_session_id = ms.id
         WHERE p.name = 'Alice' ORDER BY t.created_at`
      ),
      [
        { status: 'invalidated', from_status: 'pending', to_status: 'active', reason: 'start' },
        {
          status: 'invalidated',
          from_status: 'active',
          to_status: 'invalidated',
          reason: 'invalidate'
        }
      ]
    )
  } finally {
    database.close()
  }
})
