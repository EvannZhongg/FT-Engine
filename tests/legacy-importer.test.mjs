import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  buildLegacyProjectImport,
  deleteLegacyProjectSource,
  importLegacyProject,
  importLegacyProjects
} from '../src/main/persistence/legacy-importer.mts'
import { LocalDatabase } from '../src/main/persistence/local-database.mts'
import { MatchSessionService } from '../src/main/match/match-session.mts'

const tempRoots = []

function createLegacyFixture() {
  const root = path.join(tmpdir(), `ft-engine-legacy-${randomUUID()}`)
  const legacyRoot = path.join(root, 'match_data')
  const projectName = '20260718_120000_Demo'
  const projectPath = path.join(legacyRoot, projectName)
  const firstGroup = path.join(projectPath, 'Open Group')
  const secondGroup = path.join(projectPath, 'Final Group')
  mkdirSync(firstGroup, { recursive: true })
  mkdirSync(secondGroup, { recursive: true })
  writeFileSync(
    path.join(projectPath, 'config.json'),
    JSON.stringify(
      {
        project_name: 'Demo Event',
        mode: 'TOURNAMENT',
        created_at: '20260718_120000',
        groups: [
          {
            name: 'Open Group',
            players: ['Alice'],
            referees: [{ index: 1, name: 'Judge A', mode: 'SINGLE' }]
          },
          {
            name: 'Final Group',
            players: ['Bob'],
            referees: [{ index: 1, name: 'Judge B', mode: 'DUAL' }]
          }
        ],
        media: {
          'Final Group': {
            Bob: {
              provider: 'youtube',
              video_id: 'dQw4w9WgXcQ',
              canonical_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
            }
          }
        }
      },
      null,
      2
    )
  )
  const oldCsv =
    [
      'SystemTime,BLE_Timestamp,DeviceRole,CurrentTotal,EventType,TotalPlus,TotalMinus,MajorPenalty',
      '2026-07-18 12:00:01.000,100,PRIMARY,1,1,1,0,0',
      '2026-07-18 12:00:02.000,200,PRIMARY,0,-1,1,1,0'
    ].join('\n') + '\n'
  writeFileSync(path.join(firstGroup, 'Alice_Ref1.csv'), oldCsv)
  const newCsvPath = path.join(secondGroup, 'Bob_Ref1.csv')
  const newCsv =
    [
      'SystemTime,BLE_Timestamp,DeviceRole,CurrentTotal,EventType,TotalPlus,TotalMinus,MajorPenalty,EventId,MediaProvider,MediaId,MediaTimeMs,MediaSyncStatus',
      '2026-07-18 12:01:01.000,300,PRIMARY,2,1,2,0,0,event-bob-1,youtube,dQw4w9WgXcQ,4500,aligned'
    ].join('\n') + '\n'
  writeFileSync(newCsvPath, newCsv)
  tempRoots.push(root)
  return { root, legacyRoot, projectName, projectPath, newCsvPath, newCsv }
}

test.afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('imports old projects idempotently and preserves group referee indexes', () => {
  const fixture = createLegacyFixture()
  const database = new LocalDatabase(
    path.join(fixture.root, 'ft-engine.db'),
    path.join(fixture.root, 'backups')
  )
  database.open()
  try {
    const graph = buildLegacyProjectImport(fixture.projectPath)
    assert.equal(graph.competition.mode, 'TOURNAMENT')
    assert.equal(graph.competition.createdAt, '2026-07-18T12:00:00')
    assert.equal(graph.groups[0].referees[0].sourceIndex, 1)
    assert.equal(graph.groups[1].referees[0].sourceIndex, 1)
    assert.notEqual(
      graph.groups[0].referees[0].storageIndex,
      graph.groups[1].referees[0].storageIndex
    )

    const shadowEvent = graph.groups[0].contestants[0].events[0]
    assert.equal(
      database.appendScoreEvent({
        ...shadowEvent,
        matchSessionId: null,
        refereeId: null
      }),
      true
    )

    const first = importLegacyProjects(database, fixture.legacyRoot)
    assert.deepEqual(first, { projects: 1, imported: 1, events: 3, errors: [] })
    assert.deepEqual(database.getLegacyImportSummary(fixture.projectName), {
      competitionName: 'Demo Event',
      groups: 2,
      contestants: 2,
      referees: 2,
      events: 3
    })
    const eventContext = database.resolveLegacyEventContext(
      fixture.projectName,
      'Final Group',
      'Bob',
      1
    )
    assert.equal(typeof eventContext?.matchSessionId, 'string')
    assert.equal(typeof eventContext?.refereeId, 'string')
    const aliceReplay = database.getLegacyReplay(fixture.projectName, 'Open Group', 'Alice')
    assert.equal(aliceReplay?.binding, null)
    assert.deepEqual(
      aliceReplay?.events.map((event) => ({
        event_id: event.event_id,
        referee_index: event.referee_index,
        referee_name: event.referee_name,
        delta_plus: event.delta_plus,
        delta_minus: event.delta_minus,
        current_total: event.current_total
      })),
      [
        {
          event_id: 'ref1-row0',
          referee_index: 1,
          referee_name: 'Judge A',
          delta_plus: 1,
          delta_minus: 0,
          current_total: 1
        },
        {
          event_id: 'ref1-row1',
          referee_index: 1,
          referee_name: 'Judge A',
          delta_plus: 0,
          delta_minus: 1,
          current_total: 0
        }
      ]
    )
    const bobReplay = database.getLegacyReplay(fixture.projectName, 'Final Group', 'Bob')
    assert.equal(bobReplay?.binding?.video_id, 'dQw4w9WgXcQ')
    assert.equal(bobReplay?.events[0].media_sync_status, 'aligned')
    const report = database.getLegacyReport(fixture.projectName)
    assert.equal(report?.config.mode, 'TOURNAMENT')
    assert.equal(report?.config.groups[0].refCount, 1)
    assert.deepEqual(report?.scores['Open Group'].Alice[1], {
      total: 0,
      plus: 1,
      minus: 1,
      penalty: 0
    })
    assert.deepEqual(report?.scores['Final Group'].Bob[1], {
      total: 2,
      plus: 2,
      minus: 0,
      penalty: 0
    })

    const second = importLegacyProjects(database, fixture.legacyRoot)
    assert.deepEqual(second, { projects: 1, imported: 0, events: 0, errors: [] })
    const projects = database.listLegacyProjects()
    assert.equal(projects.length, 1)
    assert.equal(projects[0].dir_name, fixture.projectName)
    assert.equal(projects[0].groups[0].refCount, 1)
    assert.equal(deleteLegacyProjectSource(fixture.legacyRoot, fixture.projectName), true)
    assert.equal(database.deleteLegacyProject(fixture.projectName), true)
    assert.deepEqual(database.listLegacyProjects(), [])
    assert.deepEqual(importLegacyProjects(database, fixture.legacyRoot), {
      projects: 0,
      imported: 0,
      events: 0,
      errors: []
    })
  } finally {
    database.close()
  }
})

test('rolls back a newly created live context when its event is not inserted', () => {
  const fixture = createLegacyFixture()
  const database = new LocalDatabase(
    path.join(fixture.root, 'ft-engine.db'),
    path.join(fixture.root, 'backups')
  )
  database.open()
  try {
    importLegacyProjects(database, fixture.legacyRoot)
    const input = {
      sourceKey: fixture.projectName,
      groupName: 'Final Group',
      contestantName: 'Charlie',
      refereeIndex: 1,
      refereeName: 'Judge B',
      refereeMode: 'DUAL',
      event: {
        eventId: 'event-bob-1',
        connectionId: 'match-ref-1-primary',
        deviceId: 'primary-device',
        role: 'primary',
        eventType: 1,
        deviceTimestampMs: 400,
        receivedAt: '2026-07-18T12:02:00.000Z',
        systemTime: '2026-07-18T12:02:00.000Z',
        totalPlus: 3,
        totalMinus: 0,
        currentTotal: 3,
        majorPenalty: 0
      }
    }

    assert.deepEqual(database.appendLegacyScoreEvent(input), { status: 'duplicate' })
    assert.equal(
      database.resolveLegacyEventContext(fixture.projectName, 'Final Group', 'Charlie', 1),
      null
    )
    assert.deepEqual(
      database.appendLegacyScoreEvent({
        ...input,
        event: { ...input.event, eventId: 'event-charlie-1' }
      }),
      { status: 'inserted' }
    )
    assert.ok(database.resolveLegacyEventContext(fixture.projectName, 'Final Group', 'Charlie', 1))
  } finally {
    database.close()
  }
})

test('refreshes one imported competition when its source hash changes', () => {
  const fixture = createLegacyFixture()
  const database = new LocalDatabase(
    path.join(fixture.root, 'ft-engine.db'),
    path.join(fixture.root, 'backups')
  )
  database.open()
  try {
    importLegacyProjects(database, fixture.legacyRoot)
    writeFileSync(
      fixture.newCsvPath,
      fixture.newCsv +
        '2026-07-18 12:01:02.000,400,PRIMARY,3,1,3,0,0,event-bob-2,youtube,dQw4w9WgXcQ,5500,aligned\n'
    )
    const updated = importLegacyProject(database, fixture.legacyRoot, fixture.projectName)
    assert.deepEqual(updated, { found: true, imported: true, events: 4 })
    assert.equal(database.getLegacyImportSummary(fixture.projectName)?.events, 4)
    assert.equal(
      database.getLegacyReport(fixture.projectName)?.scores['Final Group'].Bob[1].total,
      3
    )
  } finally {
    database.close()
  }
})

test('rejects legacy source keys that escape the project root', () => {
  const fixture = createLegacyFixture()
  const database = new LocalDatabase(
    path.join(fixture.root, 'ft-engine.db'),
    path.join(fixture.root, 'backups')
  )
  database.open()
  try {
    assert.throws(
      () => importLegacyProject(database, fixture.legacyRoot, '..'),
      /LEGACY_SOURCE_KEY_INVALID/
    )
    assert.throws(
      () => deleteLegacyProjectSource(fixture.legacyRoot, `${fixture.projectName}/config.json`),
      /LEGACY_SOURCE_KEY_INVALID/
    )
  } finally {
    database.close()
  }
})

test('keeps SQLite-managed live events when legacy source files change', () => {
  const fixture = createLegacyFixture()
  const database = new LocalDatabase(
    path.join(fixture.root, 'ft-engine.db'),
    path.join(fixture.root, 'backups')
  )
  database.open()
  try {
    importLegacyProjects(database, fixture.legacyRoot)
    assert.equal(database.markLegacyProjectLive(fixture.projectName), true)
    const context = database.ensureLegacyEventContext(
      fixture.projectName,
      'Final Group',
      'Charlie',
      1,
      'Judge B',
      'DUAL'
    )
    assert.ok(context)
    database.appendScoreEvent({
      eventId: 'live-charlie-1',
      matchSessionId: context.matchSessionId,
      refereeId: context.refereeId,
      connectionId: 'match-ref-1-primary',
      deviceId: 'device-primary',
      role: 'primary',
      eventType: 1,
      deviceTimestampMs: 500,
      receivedAt: '2026-07-18T12:02:00.000Z',
      systemTime: '2026-07-18T12:02:00.000Z',
      totalPlus: 1,
      totalMinus: 0,
      currentTotal: 1,
      majorPenalty: 0
    })

    writeFileSync(
      fixture.newCsvPath,
      fixture.newCsv +
        '2026-07-18 12:01:02.000,400,PRIMARY,3,1,3,0,0,event-bob-2,youtube,dQw4w9WgXcQ,5500,aligned\n'
    )
    assert.deepEqual(importLegacyProject(database, fixture.legacyRoot, fixture.projectName), {
      found: true,
      imported: false,
      events: 0
    })
    assert.ok(database.getScoreEvents().some((event) => event.eventId === 'live-charlie-1'))
    assert.ok(
      database.getLegacyReport(fixture.projectName)?.config.groups[1].players.includes('Charlie')
    )
  } finally {
    database.close()
  }
})

test('serves worker-owned live scores from SQLite in the same run', async () => {
  const fixture = createLegacyFixture()
  const database = new LocalDatabase(
    path.join(fixture.root, 'ft-engine.db'),
    path.join(fixture.root, 'backups')
  )
  database.open()
  try {
    importLegacyProjects(database, fixture.legacyRoot)
    database.markLegacyProjectLive(fixture.projectName)
    const service = new MatchSessionService({
      requestWorker: async (method, params = {}) =>
        method === 'device.connectMany'
          ? { connections: params.connections.map((value) => ({ ...value, status: 'connected' })) }
          : { connections: [] },
      persistEvent: (input) => database.appendLegacyScoreEvent(input),
      emitRefereeUpdate: () => {},
      now: () => new Date('2026-07-18T13:00:00.000Z')
    })
    await service.start({
      sourceKey: fixture.projectName,
      groupName: 'Final Group',
      contestantName: 'Bob',
      referees: [
        {
          index: 1,
          name: 'Judge B',
          mode: 'DUAL',
          primaryDeviceId: 'primary-device',
          secondaryDeviceId: 'secondary-device'
        }
      ]
    })
    service.handleWorkerEvent({
      event: 'device.counter',
      eventId: 'worker-primary',
      payload: {
        connectionId: 'match-ref-1-primary',
        totalPlus: 5,
        totalMinus: 2,
        eventType: 1,
        deviceTimestampMs: 1000
      }
    })
    service.handleWorkerEvent({
      event: 'device.counter',
      eventId: 'worker-secondary',
      payload: {
        connectionId: 'match-ref-1-secondary',
        totalPlus: 3,
        totalMinus: 4,
        eventType: -1,
        deviceTimestampMs: 1010
      }
    })

    assert.deepEqual(database.getLegacyReport(fixture.projectName)?.scores['Final Group'].Bob[1], {
      total: 2,
      plus: 5,
      minus: 3,
      penalty: 6
    })
    assert.ok(
      database
        .getLegacyReplay(fixture.projectName, 'Final Group', 'Bob')
        ?.events.some((event) => event.event_id === 'worker-secondary')
    )
  } finally {
    database.close()
  }
})
