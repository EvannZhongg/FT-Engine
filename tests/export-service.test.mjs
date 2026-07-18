import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { strFromU8, unzipSync } from 'fflate'
import { CompetitionService } from '../src/main/application/competitions/competition-service.mts'
import {
  buildLogCsv,
  buildSrt,
  ExportService
} from '../src/main/application/exports/export-service.mts'
import { LocalDatabase } from '../src/main/persistence/local-database.mts'

const roots = []

function createFixture() {
  const root = path.join(tmpdir(), `ft-engine-export-${randomUUID()}`)
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
  const competition = competitions.create('Export Event', 'TOURNAMENT')
  competitions.update(competition.source_key, {
    projectName: 'Export Event',
    mode: 'TOURNAMENT',
    groups: [
      {
        name: 'Final',
        refCount: 2,
        players: ['Alice, Jr', 'Bob'],
        referees: [
          {
            index: 1,
            name: 'Judge One',
            mode: 'SINGLE',
            pri_addr: 'device-1',
            sec_addr: ''
          },
          {
            index: 2,
            name: 'Judge Two',
            mode: 'DUAL',
            pri_addr: 'device-2a',
            sec_addr: 'device-2b'
          }
        ]
      },
      {
        name: 'Qualifier',
        refCount: 1,
        players: ['Casey'],
        referees: [
          {
            index: 1,
            name: 'Judge Q',
            mode: 'SINGLE',
            pri_addr: 'device-q',
            sec_addr: ''
          }
        ]
      }
    ]
  })
  const written = []
  const exports = new ExportService(
    { getSnapshot: (sourceKey) => database.getCompetitionExportSnapshot(sourceKey) },
    {
      write: async (outputPath, data) => {
        written.push({ outputPath, data })
      }
    }
  )
  return { database, competition, exports, written }
}

function appendEvent(database, sourceKey, values) {
  const systemTime = values.systemTime
  const result = database.appendMatchScoreEvent({
    sourceKey,
    groupName: values.groupName,
    contestantName: values.contestantName,
    attemptNumber: values.attemptNumber ?? 1,
    refereeIndex: values.refereeIndex,
    event: {
      eventId: values.eventId,
      connectionId: `connection-${values.eventId}`,
      deviceId: `device-${values.refereeIndex}`,
      role: 'primary',
      eventType: 1,
      deviceTimestampMs: values.deviceTimestampMs,
      receivedAt: systemTime,
      systemTime,
      totalPlus: values.totalPlus,
      totalMinus: values.totalMinus,
      currentTotal: values.currentTotal,
      majorPenalty: values.majorPenalty
    }
  })
  assert.deepEqual(result, { status: 'inserted' })
}

function seedScores(fixture) {
  const base = {
    sourceKey: fixture.competition.source_key,
    groupName: 'Final',
    contestantName: 'Alice, Jr',
    refereeIndex: 1,
    refereeName: 'Judge One',
    refereeMode: 'SINGLE',
    majorPenalty: 0
  }
  appendEvent(fixture.database, fixture.competition.source_key, {
    ...base,
    eventId: 'alice-ref1-1',
    systemTime: '2026-07-18T10:00:00.000Z',
    deviceTimestampMs: 0,
    totalPlus: 1,
    totalMinus: 0,
    currentTotal: 1
  })
  appendEvent(fixture.database, fixture.competition.source_key, {
    ...base,
    eventId: 'alice-ref1-2',
    systemTime: '2026-07-18T10:00:00.200Z',
    deviceTimestampMs: 200,
    totalPlus: 2,
    totalMinus: 0,
    currentTotal: 2
  })
  appendEvent(fixture.database, fixture.competition.source_key, {
    ...base,
    eventId: 'alice-ref1-3',
    systemTime: '2026-07-18T10:00:01.400Z',
    deviceTimestampMs: 1400,
    totalPlus: 10,
    totalMinus: 0,
    currentTotal: 10
  })
  appendEvent(fixture.database, fixture.competition.source_key, {
    ...base,
    refereeIndex: 2,
    refereeName: 'Judge Two',
    refereeMode: 'DUAL',
    eventId: 'alice-ref2-1',
    systemTime: '2026-07-18T10:00:02.000Z',
    deviceTimestampMs: 2000,
    totalPlus: 10,
    totalMinus: 2,
    currentTotal: 8,
    majorPenalty: 2
  })
  appendEvent(fixture.database, fixture.competition.source_key, {
    ...base,
    contestantName: 'Bob',
    eventId: 'bob-ref1-1',
    systemTime: '2026-07-18T10:01:00.000Z',
    deviceTimestampMs: 3000,
    totalPlus: 5,
    totalMinus: 0,
    currentTotal: 5
  })
  appendEvent(fixture.database, fixture.competition.source_key, {
    ...base,
    contestantName: 'Bob',
    refereeIndex: 2,
    refereeName: 'Judge Two',
    refereeMode: 'DUAL',
    eventId: 'bob-ref2-1',
    systemTime: '2026-07-18T10:01:01.000Z',
    deviceTimestampMs: 4000,
    totalPlus: 5,
    totalMinus: 1,
    currentTotal: 4,
    majorPenalty: 1
  })
  appendEvent(fixture.database, fixture.competition.source_key, {
    ...base,
    groupName: 'Qualifier',
    contestantName: 'Casey',
    refereeName: 'Judge Q',
    eventId: 'casey-ref1-1',
    systemTime: '2026-07-18T10:02:00.000Z',
    deviceTimestampMs: 5000,
    totalPlus: 3,
    totalMinus: 0,
    currentTotal: 3
  })
}

test.afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('builds scoped CSV and SRT files from one SQLite competition snapshot', () => {
  const fixture = createFixture()
  try {
    seedScores(fixture)
    const artifact = fixture.exports.buildDetails({
      scope: {
        sourceKey: fixture.competition.source_key,
        groupNames: ['Final'],
        contestantNames: ['Alice, Jr'],
        refereeIndexes: [1]
      },
      includeCsv: true,
      includeSrt: true,
      srtMode: 'REALTIME'
    })
    assert.equal(artifact.fileName, 'Details_Final.zip')
    const files = unzipSync(artifact.data)
    assert.deepEqual(Object.keys(files).sort(), [
      'Final/Alice, Jr/Ref1_Log.csv',
      'Final/Alice, Jr/Ref1_REALTIME.srt'
    ])
    const csv = strFromU8(files['Final/Alice, Jr/Ref1_Log.csv'])
    assert.match(csv, /Timestamp,Plus,Minus,Total,MajorPenalty/)
    assert.match(csv, /0\.200,2,0,2,0/)
    const srt = strFromU8(files['Final/Alice, Jr/Ref1_REALTIME.srt'])
    assert.match(srt, /00:00:00,000 --> 00:00:01,200/)
    assert.match(srt, /\+2/)
  } finally {
    fixture.database.close()
  }
})

test('supports whole-competition and referee scopes from SQLite', () => {
  const fixture = createFixture()
  try {
    seedScores(fixture)
    const artifact = fixture.exports.buildDetails({
      scope: {
        sourceKey: fixture.competition.source_key,
        refereeIndexes: [1]
      },
      includeCsv: true,
      includeSrt: false,
      srtMode: 'TOTAL'
    })
    const names = Object.keys(unzipSync(artifact.data)).sort()
    assert.deepEqual(names, [
      'Final/Alice, Jr/Ref1_Log.csv',
      'Final/Bob/Ref1_Log.csv',
      'Qualifier/Casey/Ref1_Log.csv'
    ])
  } finally {
    fixture.database.close()
  }
})

test('generates raw and scaled report CSV with escaping and dual-referee penalties', () => {
  const fixture = createFixture()
  try {
    seedScores(fixture)
    const raw = strFromU8(
      fixture.exports.buildReport({
        sourceKey: fixture.competition.source_key,
        groupName: 'Final',
        view: 'RAW',
        scaleRatio: 60,
        includePenalty: true
      }).data
    )
    assert.match(raw, /"Alice, Jr",10 \(\+10\/-0\/-0\),8 \(\+10\/-2\/-2\),9\.00/)

    const scaled = strFromU8(
      fixture.exports.buildReport({
        sourceKey: fixture.competition.source_key,
        groupName: 'Final',
        view: 'SCALED',
        scaleRatio: 60,
        includePenalty: true
      }).data
    )
    assert.match(scaled, /1,"Alice, Jr",60\.00,60\.00,2,58\.00/)
    assert.match(scaled, /2,Bob,30\.00,30\.00,1,29\.00/)
  } finally {
    fixture.database.close()
  }
})

test('keeps SRT timing on system timestamps and rejects empty detail scopes', () => {
  const events = [
    {
      eventId: 'one',
      systemTime: '2026-07-18T10:00:00.000Z',
      totalPlus: 1,
      totalMinus: 0,
      currentTotal: 1,
      majorPenalty: 0
    },
    {
      eventId: 'two',
      systemTime: '2026-07-18T10:00:00.250Z',
      totalPlus: 2,
      totalMinus: 0,
      currentTotal: 2,
      majorPenalty: 0
    }
  ]
  assert.match(buildSrt(events, 'TOTAL'), /00:00:00,000 --> 00:00:00,250/)
  assert.match(buildLogCsv(events), /0\.250,2,0,2,0/)

  const fixture = createFixture()
  try {
    const emptyReport = strFromU8(
      fixture.exports.buildReport({
        sourceKey: fixture.competition.source_key,
        groupName: 'Final',
        view: 'RAW',
        scaleRatio: 60,
        includePenalty: true
      }).data
    )
    assert.match(emptyReport, /Bob,-,-,0\.00/)
    assert.throws(
      () =>
        fixture.exports.buildDetails({
          scope: {
            sourceKey: fixture.competition.source_key,
            groupNames: ['Final'],
            contestantNames: ['Bob']
          },
          includeCsv: true,
          includeSrt: false,
          srtMode: 'TOTAL'
        }),
      /EXPORT_NO_DATA/
    )
  } finally {
    fixture.database.close()
  }
})

test('maps permission, disk and generic file failures to stable export errors', async () => {
  const artifact = { fileName: 'scores.csv', mimeType: 'text/csv', data: new Uint8Array([1]) }
  for (const [fileCode, exportCode] of [
    ['EACCES', 'EXPORT_PERMISSION_DENIED'],
    ['ENOSPC', 'EXPORT_DISK_FULL'],
    ['EIO', 'EXPORT_WRITE_FAILED']
  ]) {
    const service = new ExportService(
      { getSnapshot: () => null },
      {
        write: async () => {
          throw Object.assign(new Error(fileCode), { code: fileCode })
        }
      }
    )
    await assert.rejects(service.writeArtifact(artifact, 'C:\\exports\\scores.csv'), {
      message: exportCode
    })
  }
})
