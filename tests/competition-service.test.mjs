import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { CompetitionService } from '../src/main/application/competitions/competition-service.mts'
import { MatchSessionService } from '../src/main/match/match-session.mts'
import { LocalDatabase } from '../src/main/persistence/local-database.mts'

const roots = []

function createFixture() {
  const root = path.join(tmpdir(), `ft-engine-competition-${randomUUID()}`)
  roots.push(root)
  const database = new LocalDatabase(path.join(root, 'ft-engine.db'), path.join(root, 'backups'))
  database.open()
  const competitions = new CompetitionService({
    create: (input) => database.createCompetition(input),
    update: (sourceKey, input) => database.updateCompetition(sourceKey, input),
    get: (sourceKey) => database.getCompetitionConfig(sourceKey),
    list: () => database.listCompetitionProjects(),
    delete: (sourceKey) => database.deleteCompetition(sourceKey)
  })
  return { database, competitions }
}

test.afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const group = {
  name: 'Final',
  refCount: 1,
  players: ['Alice', 'Bob'],
  referees: [
    {
      index: 1,
      name: 'Judge A',
      mode: 'SINGLE',
      pri_addr: 'device-primary',
      sec_addr: ''
    }
  ]
}

test('creates and updates a SQLite competition', () => {
  const { database, competitions } = createFixture()
  try {
    const created = competitions.create('Local Event', 'FREE')
    assert.match(created.source_key, /^[0-9a-f-]{36}$/)
    assert.deepEqual(created.groups, [])

    const updated = competitions.update(created.source_key, {
      projectName: 'Local Event',
      mode: 'FREE',
      groups: [group]
    })
    assert.deepEqual(updated.groups, [group])
    assert.deepEqual(competitions.get(created.source_key), updated)
    assert.deepEqual(competitions.list(), [{ ...updated, dir_name: created.source_key }])
  } finally {
    database.close()
  }
})

test('scores a local competition and locks structure while allowing device rebinding', async () => {
  const { database, competitions } = createFixture()
  try {
    const created = competitions.create('Local Event', 'TOURNAMENT')
    competitions.update(created.source_key, {
      projectName: 'Local Event',
      mode: 'TOURNAMENT',
      groups: [group]
    })
    const match = new MatchSessionService({
      requestWorker: async (method, params = {}) =>
        method === 'device.connectMany'
          ? { connections: params.connections.map((value) => ({ ...value, status: 'connected' })) }
          : { connections: [] },
      persistEvent: (input) => database.appendMatchScoreEvent(input),
      upsertMediaBinding: (...args) => database.upsertMediaBinding(...args),
      emitRefereeUpdate: () => {},
      now: () => new Date('2026-07-18T14:00:00.000Z')
    })
    await match.start({
      sourceKey: created.source_key,
      groupName: 'Final',
      contestantName: 'Alice',
      attemptNumber: 1,
      referees: [
        {
          index: 1,
          name: 'Judge A',
          mode: 'SINGLE',
          primaryDeviceId: 'device-primary',
          secondaryDeviceId: null
        }
      ]
    })
    match.handleWorkerEvent({
      event: 'device.counter',
      eventId: 'local-event-1',
      payload: {
        connectionId: 'match-ref-1-primary',
        totalPlus: 4,
        totalMinus: 1,
        eventType: 1,
        deviceTimestampMs: 100
      }
    })

    assert.deepEqual(database.getReport(created.source_key)?.scores.Final.Alice[1], {
      total: 3,
      plus: 4,
      minus: 1,
      penalty: 0
    })
    assert.equal(
      database.getReplay(created.source_key, 'Final', 'Alice')?.events[0].event_id,
      'local-event-1'
    )
    assert.throws(
      () =>
        competitions.update(created.source_key, {
          projectName: 'Local Event',
          mode: 'TOURNAMENT',
          groups: [{ ...group, players: ['Renamed'] }]
        }),
      /COMPETITION_STRUCTURE_LOCKED/
    )

    const reboundGroup = {
      ...group,
      referees: [{ ...group.referees[0], pri_addr: 'replacement-device' }]
    }
    const rebound = competitions.update(created.source_key, {
      projectName: 'Local Event',
      mode: 'TOURNAMENT',
      groups: [reboundGroup]
    })
    assert.equal(rebound.groups[0].referees[0].pri_addr, 'replacement-device')
    assert.equal(database.getScoreEvents().length, 1)
  } finally {
    database.close()
  }
})

test('rejects duplicate players and deletes a competition graph', () => {
  const { database, competitions } = createFixture()
  try {
    const created = competitions.create('Local Event', 'FREE')
    assert.throws(
      () =>
        competitions.update(created.source_key, {
          projectName: 'Local Event',
          mode: 'FREE',
          groups: [{ ...group, players: ['Alice', 'Alice'] }]
        }),
      /COMPETITION_CONFIG_INVALID/
    )
    assert.equal(competitions.delete(created.source_key), true)
    assert.equal(competitions.get(created.source_key), null)
  } finally {
    database.close()
  }
})
