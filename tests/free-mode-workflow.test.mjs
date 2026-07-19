import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { LocalDatabase } from '../src/main/persistence/local-database.mts'

const roots = []

test.afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('runs the Free Mode graph through SQLite score, replay, report and export queries', () => {
  const root = path.join(tmpdir(), `ft-engine-free-${randomUUID()}`)
  roots.push(root)
  const database = new LocalDatabase(path.join(root, 'ft-engine.db'), path.join(root, 'backups'))
  database.open()

  try {
    const competition = database.createCompetition({ name: 'Free Event', mode: 'FREE' })
    const stage = database.listStages(competition.id)[0]
    const referees = [
      {
        index: 1,
        name: 'Judge A',
        mode: 'SINGLE',
        primaryDeviceId: 'ble-a',
        secondaryDeviceId: ''
      },
      {
        index: 2,
        name: 'Judge B',
        mode: 'SINGLE',
        primaryDeviceId: 'ble-b',
        secondaryDeviceId: ''
      }
    ]
    database.updateStage(stage.id, {
      name: 'Main',
      attempts: 1,
      groups: [{ name: 'Free Mode', refCount: 2, players: ['Player 1'], referees }]
    })

    const config = database.getCompetitionConfig(competition.id)
    assert.equal(config.mode, 'FREE')
    assert.deepEqual(config.groups[0], {
      name: 'Free Mode',
      refCount: 2,
      players: ['Player 1'],
      referees
    })
    assert.equal(database.hasMatchContext(competition.id, stage.id, 'Free Mode', 'Player 1', 1, [1, 2]), true)
    assert.equal(database.hasMatchContext(competition.id, stage.id, 'Free Mode', 'Player 1', 2, [1, 2]), false)

    const context = {
      sourceKey: competition.id,
      stageId: stage.id,
      groupName: 'Free Mode',
      contestantName: 'Player 1',
      attemptNumber: 1
    }
    database.activateMatchSession(context, '2026-07-19T04:00:00.000Z')
    database.appendMatchScoreEvent({
      ...context,
      refereeIndex: 1,
      event: {
        eventId: 'free-event-1',
        connectionId: 'free-ref-1',
        deviceId: 'ble-a',
        role: 'primary',
        eventType: 1,
        deviceTimestampMs: 100,
        receivedAt: '2026-07-19T04:00:01.000Z',
        systemTime: '2026-07-19T04:00:01.000Z',
        totalPlus: 1,
        totalMinus: 0,
        currentTotal: 1,
        majorPenalty: 0
      }
    })
    database.completeMatchSession(context, '2026-07-19T04:00:02.000Z')

    assert.deepEqual(database.listScoredContestants(competition.id, stage.id, 'Free Mode', 1), ['Player 1'])
    assert.equal(database.getReplay(competition.id, 'Free Mode', 'Player 1').events.length, 1)
    assert.equal(database.getReport(competition.id).config.groups[0].name, 'Free Mode')
    assert.equal(database.getCompetitionExportSnapshot(competition.id).groups[0].name, 'Free Mode')
  } finally {
    database.close()
  }
})
