import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { StageService } from '../src/main/application/competitions/stage-service.mts'
import { LocalDatabase } from '../src/main/persistence/local-database.mts'

const roots = []

const group = {
  name: 'Open',
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

function createFixture(mode = 'TOURNAMENT') {
  const root = path.join(tmpdir(), `ft-engine-stage-${randomUUID()}`)
  roots.push(root)
  const database = new LocalDatabase(path.join(root, 'ft-engine.db'), path.join(root, 'backups'))
  database.open()
  const competition = database.createCompetition({ name: 'Stage Event', mode })
  const stages = new StageService({
    list: (competitionId) => database.listStages(competitionId),
    create: (competitionId, input) => database.createStage(competitionId, input),
    update: (stageId, input) => database.updateStage(stageId, input),
    reorder: (competitionId, stageIds) => database.reorderStages(competitionId, stageIds),
    delete: (stageId) => database.deleteStage(stageId),
    activate: (stageId) => database.activateStage(stageId),
    complete: (stageId) => database.completeStage(stageId),
    appendFreeContestant: (stageId, groupName, contestantName) =>
      database.appendFreeContestant(stageId, groupName, contestantName)
  })
  return { database, competition, stages }
}

function queryDatabase(database, sql, ...params) {
  const connection = new DatabaseSync(database.databasePath)
  try {
    return connection.prepare(sql).get(...params)
  } finally {
    connection.close()
  }
}

function executeDatabase(database, sql, ...params) {
  const connection = new DatabaseSync(database.databasePath)
  try {
    connection.prepare(sql).run(...params)
  } finally {
    connection.close()
  }
}

test.afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('configures multiple stages, attempts and stable ordering', () => {
  const { database, competition, stages } = createFixture()
  try {
    const main = stages.list(competition.id)[0]
    const qualifier = stages.update(main.id, { name: 'Qualifier', attempts: 2, groups: [group] })
    const final = stages.create(competition.id, {
      name: 'Final',
      attempts: 3,
      groups: [{ ...group, players: ['Alice'] }]
    })

    assert.equal(qualifier.groups[0].players.length, 2)
    assert.equal(
      queryDatabase(
        database,
        `SELECT COUNT(*) AS count FROM match_sessions ms
         JOIN contestants p ON p.id = ms.contestant_id
         JOIN competition_groups g ON g.id = p.group_id WHERE g.stage_id = ?`,
        qualifier.id
      ).count,
      4
    )
    assert.equal(
      queryDatabase(
        database,
        `SELECT COUNT(*) AS count FROM match_sessions ms
         JOIN contestants p ON p.id = ms.contestant_id
         JOIN competition_groups g ON g.id = p.group_id WHERE g.stage_id = ?`,
        final.id
      ).count,
      3
    )

    const reordered = stages.reorder(competition.id, [final.id, qualifier.id])
    assert.deepEqual(
      reordered.map((stage) => [stage.name, stage.position]),
      [
        ['Final', 0],
        ['Qualifier', 1]
      ]
    )
    assert.throws(() => stages.reorder(competition.id, [final.id]), /STAGE_ORDER_INVALID/)
    assert.throws(
      () => stages.create(competition.id, { name: 'Final', attempts: 1, groups: [] }),
      /STAGE_NAME_DUPLICATE/
    )

    assert.deepEqual(
      database.appendMatchScoreEvent({
        sourceKey: competition.id,
        stageId: final.id,
        groupName: 'Open',
        contestantName: 'Alice',
        attemptNumber: 3,
        refereeIndex: 1,
        event: {
          eventId: 'final-attempt-3',
          connectionId: 'judge-1-primary',
          deviceId: 'device-primary',
          role: 'primary',
          eventType: 1,
          deviceTimestampMs: 100,
          receivedAt: '2026-07-19T00:00:00.000Z',
          systemTime: '2026-07-19T00:00:00.000Z',
          totalPlus: 1,
          totalMinus: 0,
          currentTotal: 1,
          majorPenalty: 0
        }
      }),
      { status: 'inserted' }
    )
    const storedContext = queryDatabase(
      database,
      `SELECT ms.attempt_number, g.stage_id FROM score_events e
       JOIN match_sessions ms ON ms.id = e.match_session_id
       JOIN contestants p ON p.id = ms.contestant_id
       JOIN competition_groups g ON g.id = p.group_id WHERE e.event_id = ?`,
      'final-attempt-3'
    )
    assert.equal(storedContext.attempt_number, 3)
    assert.equal(storedContext.stage_id, final.id)
    assert.equal(stages.list(competition.id)[0].status, 'active')
    assert.equal(
      queryDatabase(
        database,
        "SELECT COUNT(*) AS count FROM match_session_transitions WHERE reason = 'score_event'"
      ).count,
      1
    )
  } finally {
    database.close()
  }
})

test('enforces stage and competition lifecycle transitions', () => {
  const { database, competition, stages } = createFixture()
  try {
    const main = stages.list(competition.id)[0]
    stages.update(main.id, { name: 'Main', attempts: 1, groups: [group] })
    const active = stages.activate(main.id)
    assert.equal(active.status, 'active')
    assert.equal(
      queryDatabase(database, 'SELECT status FROM competitions WHERE id = ?', competition.id)
        .status,
      'active'
    )
    assert.throws(
      () => stages.update(main.id, { name: 'Changed', attempts: 1, groups: [group] }),
      /STAGE_STRUCTURE_LOCKED/
    )
    assert.throws(() => stages.complete(main.id), /STAGE_SESSIONS_INCOMPLETE/)

    executeDatabase(
      database,
      "UPDATE match_sessions SET status = 'completed', completed_at = ?",
      '2026-07-19T00:00:00.000Z'
    )
    assert.equal(stages.complete(main.id).status, 'completed')
    assert.equal(
      queryDatabase(database, 'SELECT status FROM competitions WHERE id = ?', competition.id)
        .status,
      'completed'
    )
  } finally {
    database.close()
  }
})

test('appends persisted contestants to an active Free Mode stage', () => {
  const { database, competition, stages } = createFixture('FREE')
  try {
    const main = stages.list(competition.id)[0]
    const freeGroup = { ...group, name: 'Free Mode', players: ['Player 1'] }
    stages.update(main.id, { name: 'Main', attempts: 2, groups: [freeGroup] })
    stages.activate(main.id)

    const updated = stages.appendFreeContestant(main.id, 'Free Mode', 'Player 2')
    assert.deepEqual(updated.groups[0].players, ['Player 1', 'Player 2'])
    assert.equal(
      database.hasMatchContext(competition.id, main.id, 'Free Mode', 'Player 2', 1, [1]),
      true
    )
    assert.equal(
      database.hasMatchContext(competition.id, main.id, 'Free Mode', 'Player 2', 2, [1]),
      true
    )
    assert.deepEqual(
      stages.appendFreeContestant(main.id, 'Free Mode', 'Player 2').groups[0].players,
      ['Player 1', 'Player 2']
    )
  } finally {
    database.close()
  }
})

test('rejects dynamic contestant appends outside Free Mode', () => {
  const { database, competition, stages } = createFixture()
  try {
    const main = stages.list(competition.id)[0]
    stages.update(main.id, { name: 'Main', attempts: 1, groups: [group] })
    assert.throws(
      () => stages.appendFreeContestant(main.id, 'Open', 'Charlie'),
      /FREE_CONTESTANT_APPEND_FORBIDDEN/
    )
  } finally {
    database.close()
  }
})

test('rejects empty activation, invalid attempts and removal of the last stage', () => {
  const { database, competition, stages } = createFixture()
  try {
    const main = stages.list(competition.id)[0]
    assert.throws(() => stages.activate(main.id), /STAGE_EMPTY/)
    assert.throws(
      () => stages.update(main.id, { name: 'Main', attempts: 0, groups: [] }),
      /STAGE_CONFIG_INVALID/
    )
    assert.throws(() => stages.delete(main.id), /STAGE_LAST_REQUIRED/)

    const spare = stages.create(competition.id, { name: 'Spare', attempts: 1, groups: [] })
    assert.equal(stages.delete(spare.id), true)
    assert.deepEqual(
      stages.list(competition.id).map((stage) => stage.id),
      [main.id]
    )
  } finally {
    database.close()
  }
})
