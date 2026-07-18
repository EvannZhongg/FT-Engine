import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  buildLegacyProjectImport,
  importLegacyProjects
} from '../src/main/persistence/legacy-importer.mts'
import { LocalDatabase } from '../src/main/persistence/local-database.mts'


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
  writeFileSync(path.join(projectPath, 'config.json'), JSON.stringify({
    project_name: 'Demo Event',
    mode: 'TOURNAMENT',
    created_at: '20260718_120000',
    groups: [
      { name: 'Open Group', players: ['Alice'], referees: [{ index: 1, name: 'Judge A', mode: 'SINGLE' }] },
      { name: 'Final Group', players: ['Bob'], referees: [{ index: 1, name: 'Judge B', mode: 'DUAL' }] }
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
  }, null, 2))
  const oldCsv = [
    'SystemTime,BLE_Timestamp,DeviceRole,CurrentTotal,EventType,TotalPlus,TotalMinus,MajorPenalty',
    '2026-07-18 12:00:01.000,100,PRIMARY,1,1,1,0,0',
    '2026-07-18 12:00:02.000,200,PRIMARY,0,-1,1,1,0'
  ].join('\n') + '\n'
  writeFileSync(path.join(firstGroup, 'Alice_Ref1.csv'), oldCsv)
  const newCsvPath = path.join(secondGroup, 'Bob_Ref1.csv')
  const newCsv = [
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
    assert.notEqual(graph.groups[0].referees[0].storageIndex, graph.groups[1].referees[0].storageIndex)

    const shadowEvent = graph.groups[0].contestants[0].events[0]
    assert.equal(database.appendScoreEvent({
      ...shadowEvent,
      matchSessionId: null,
      refereeId: null
    }), true)

    const first = importLegacyProjects(database, fixture.legacyRoot)
    assert.deepEqual(first, { projects: 1, imported: 1, events: 3, errors: [] })
    assert.deepEqual(database.getLegacyImportSummary(fixture.projectName), {
      competitionName: 'Demo Event',
      groups: 2,
      contestants: 2,
      referees: 2,
      events: 3
    })

    const second = importLegacyProjects(database, fixture.legacyRoot)
    assert.deepEqual(second, { projects: 1, imported: 0, events: 0, errors: [] })
  } finally {
    database.close()
  }
})

test('replaces one imported competition when its source hash changes', () => {
  const fixture = createLegacyFixture()
  const database = new LocalDatabase(
    path.join(fixture.root, 'ft-engine.db'),
    path.join(fixture.root, 'backups')
  )
  database.open()
  try {
    importLegacyProjects(database, fixture.legacyRoot)
    writeFileSync(fixture.newCsvPath, fixture.newCsv +
      '2026-07-18 12:01:02.000,400,PRIMARY,3,1,3,0,0,event-bob-2,youtube,dQw4w9WgXcQ,5500,aligned\n')
    const updated = importLegacyProjects(database, fixture.legacyRoot)
    assert.deepEqual(updated, { projects: 1, imported: 1, events: 4, errors: [] })
    assert.equal(database.getLegacyImportSummary(fixture.projectName)?.events, 4)
  } finally {
    database.close()
  }
})
