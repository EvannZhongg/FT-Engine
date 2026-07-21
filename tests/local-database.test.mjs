import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { normalizeMediaUrl } from '../src/shared/media/normalize-media-url.mts'

import {
  DATABASE_APPLICATION_ID,
  LATEST_SCHEMA_VERSION,
  LocalDatabase
} from '../src/main/persistence/local-database.mts'

const tempRoots = []

function createDatabase() {
  const root = path.join(tmpdir(), `ft-engine-db-${randomUUID()}`)
  const databasePath = path.join(root, 'ft-engine.db')
  const backupRoot = path.join(root, 'backups')
  tempRoots.push(root)
  return { root, databasePath, backupRoot, database: new LocalDatabase(databasePath, backupRoot) }
}

function createConfiguredCompetition(database) {
  const competition = database.createCompetition({ name: 'Test Event', mode: 'FREE' })
  database.updateCompetition(competition.id, {
    name: 'Test Event',
    mode: 'FREE',
    groups: [
      {
        name: 'Final',
        refCount: 1,
        players: ['Alice'],
        referees: [
          {
            index: 1,
            name: 'Judge A',
            mode: 'SINGLE',
            primaryDeviceId: 'device-1',
            secondaryDeviceId: ''
          }
        ]
      }
    ]
  })
  return { ...competition, stageId: database.listStages(competition.id)[0].id }
}

function createTwoContestantCompetition(database) {
  const competition = database.createCompetition({ name: 'Shared Media Event', mode: 'FREE' })
  database.updateCompetition(competition.id, {
    name: 'Shared Media Event',
    mode: 'FREE',
    groups: [
      {
        name: 'Final',
        refCount: 1,
        players: ['Alice', 'Bob'],
        referees: [
          {
            index: 1,
            name: 'Judge A',
            mode: 'SINGLE',
            primaryDeviceId: 'device-1',
            secondaryDeviceId: ''
          }
        ]
      }
    ]
  })
  return { ...competition, stageId: database.listStages(competition.id)[0].id }
}

test.afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

test('creates the versioned local schema', () => {
  const { database } = createDatabase()
  database.open()
  try {
    assert.equal(database.getSchemaVersion(), LATEST_SCHEMA_VERSION)
    assert.equal(database.getApplicationId(), DATABASE_APPLICATION_ID)
    const tables = database.listTableNames()
    for (const table of [
      'competitions',
      'stages',
      'competition_groups',
      'contestants',
      'referees',
      'device_bindings',
      'match_sessions',
      'match_session_transitions',
      'score_events',
      'media_binding_versions',
      'media_bindings',
      'app_settings',
      'share_drafts',
      'upload_tasks'
    ]) {
      assert.ok(tables.includes(table), `missing table: ${table}`)
    }
  } finally {
    database.close()
  }
})

test('backs up and replaces a database from the retired schema', () => {
  const { root, databasePath, backupRoot, database } = createDatabase()
  mkdirSync(root, { recursive: true })
  const retired = new DatabaseSync(databasePath)
  retired.exec('CREATE TABLE retired_marker (value TEXT); PRAGMA user_version = 5;')
  retired.close()

  database.open()
  try {
    assert.equal(database.getSchemaVersion(), LATEST_SCHEMA_VERSION)
    assert.equal(database.listTableNames().includes('retired_marker'), false)
    const backups = readdirSync(backupRoot)
    assert.equal(backups.length, 1)
    assert.match(backups[0], /^ft-engine-reset-v5-/)
    assert.ok(existsSync(path.join(backupRoot, backups[0])))
  } finally {
    database.close()
  }
})

test('appends immutable score events idempotently', () => {
  const { database } = createDatabase()
  database.open()
  const competition = createConfiguredCompetition(database)
  const event = {
    eventId: 'event-1',
    connectionId: 'judge-1-primary',
    deviceId: 'device-1',
    role: 'primary',
    eventType: 1,
    deviceTimestampMs: 100,
    receivedAt: '2026-07-18T08:00:00.100Z',
    systemTime: '2026-07-18T08:00:00.100Z',
    totalPlus: 1,
    totalMinus: 0,
    currentTotal: 1,
    majorPenalty: 0
  }
  try {
    assert.deepEqual(
      database.appendMatchScoreEvent({
        sourceKey: competition.id,
        stageId: competition.stageId,
        groupName: 'Final',
        contestantName: 'Alice',
        attemptNumber: 1,
        refereeIndex: 1,
        event
      }),
      { status: 'inserted' }
    )
    assert.deepEqual(
      database.appendMatchScoreEvent({
        sourceKey: competition.id,
        stageId: competition.stageId,
        groupName: 'Final',
        contestantName: 'Alice',
        attemptNumber: 1,
        refereeIndex: 1,
        event: { ...event, currentTotal: 99 }
      }),
      { status: 'duplicate' }
    )
    const [stored] = database.getScoreEvents()
    const { matchSessionId, refereeId, ...eventValue } = stored
    assert.match(matchSessionId, /^[0-9a-f]{32}$/)
    assert.match(refereeId, /^[0-9a-f]{32}$/)
    assert.deepEqual(eventValue, {
      ...event,
      mediaBindingVersionId: null,
      mediaProvider: '',
      mediaId: '',
      mediaSegment: '',
      mediaTimeMs: null,
      mediaSyncStatus: 'not_ready'
    })
    const raw = new DatabaseSync(database.databasePath)
    try {
      assert.throws(
        () =>
          raw
            .prepare('UPDATE score_events SET current_total = ? WHERE event_id = ?')
            .run(99, event.eventId),
        /SCORE_EVENT_IMMUTABLE/
      )
      assert.throws(
        () => raw.prepare('DELETE FROM score_events WHERE event_id = ?').run(event.eventId),
        /SCORE_EVENT_IMMUTABLE/
      )
    } finally {
      raw.close()
    }
  } finally {
    database.close()
  }
})

test('rejects invalid events before writing', () => {
  const { database } = createDatabase()
  database.open()
  try {
    assert.throws(
      () => database.appendMatchScoreEvent({ event: { eventId: 'invalid' } }),
      /Invalid score event/
    )
    assert.deepEqual(database.getScoreEvents(), [])
  } finally {
    database.close()
  }
})

test('rejects score events outside the configured competition graph', () => {
  const { database } = createDatabase()
  database.open()
  const competition = createConfiguredCompetition(database)
  try {
    const timestamp = '2026-07-18T08:00:00.100Z'
    assert.deepEqual(
      database.appendMatchScoreEvent({
        sourceKey: competition.id,
        stageId: competition.stageId,
        groupName: 'Final',
        contestantName: 'Unknown',
        attemptNumber: 1,
        refereeIndex: 1,
        event: {
          eventId: 'outside-context',
          connectionId: 'judge-1-primary',
          deviceId: 'device-1',
          role: 'primary',
          eventType: 1,
          deviceTimestampMs: 100,
          receivedAt: timestamp,
          systemTime: timestamp,
          totalPlus: 1,
          totalMinus: 0,
          currentTotal: 1,
          majorPenalty: 0
        }
      }),
      { status: 'context_missing' }
    )
    assert.equal(database.getCompetitionConfig(competition.id)?.groups[0].players.length, 1)
    assert.deepEqual(database.getScoreEvents(), [])
  } finally {
    database.close()
  }
})

test('enforces one current binding per contestant while retaining revisions and sharing media', () => {
  const { database, databasePath } = createDatabase()
  database.open()
  const competition = createTwoContestantCompetition(database)
  const youtube = normalizeMediaUrl('https://youtu.be/dQw4w9WgXcQ')
  const bilibili = normalizeMediaUrl('https://www.bilibili.com/video/BV1xx411c7mD?p=2')
  try {
    const aliceYoutube = database.replaceMediaBinding(
      competition.id,
      competition.stageId,
      'Final',
      'Alice',
      youtube
    )
    assert.ok(aliceYoutube)
    const repeated = database.replaceMediaBinding(
      competition.id,
      competition.stageId,
      'Final',
      'Alice',
      youtube
    )
    assert.deepEqual(repeated, aliceYoutube)
    const aliceBilibili = database.replaceMediaBinding(
      competition.id,
      competition.stageId,
      'Final',
      'Alice',
      bilibili
    )
    assert.equal(aliceBilibili?.revision, 2)
    assert.notEqual(aliceBilibili?.version_id, aliceYoutube?.version_id)

    const bobBilibili = database.replaceMediaBinding(
      competition.id,
      competition.stageId,
      'Final',
      'Bob',
      bilibili
    )
    assert.equal(bobBilibili?.revision, 1)
    assert.notEqual(bobBilibili?.id, aliceBilibili?.id)
    assert.equal(
      database.getMediaBinding(competition.id, competition.stageId, 'Final', 'Alice')?.provider,
      'bilibili'
    )
    assert.equal(
      database.getMediaBinding(competition.id, competition.stageId, 'Final', 'Bob')?.provider,
      'bilibili'
    )

    assert.throws(
      () =>
        database.appendMatchScoreEvent({
          sourceKey: competition.id,
          stageId: competition.stageId,
          groupName: 'Final',
          contestantName: 'Bob',
          attemptNumber: 1,
          refereeIndex: 1,
          event: {
            eventId: 'wrong-owner-event',
            connectionId: 'judge-1-primary',
            deviceId: 'device-1',
            role: 'primary',
            eventType: 1,
            deviceTimestampMs: 1,
            receivedAt: '2026-07-18T08:59:00.000Z',
            systemTime: '2026-07-18T08:59:00.000Z',
            totalPlus: 1,
            totalMinus: 0,
            currentTotal: 1,
            majorPenalty: 0,
            mediaBindingVersionId: aliceYoutube?.version_id,
            mediaProvider: 'youtube',
            mediaId: youtube.media_id,
            mediaSegment: youtube.segment,
            mediaTimeMs: 500,
            mediaSyncStatus: 'aligned'
          }
        }),
      /MEDIA_BINDING_VERSION_OWNER_MISMATCH/
    )

    const eventTime = '2026-07-18T09:00:00.000Z'
    assert.deepEqual(
      database.appendMatchScoreEvent({
        sourceKey: competition.id,
        stageId: competition.stageId,
        groupName: 'Final',
        contestantName: 'Alice',
        attemptNumber: 1,
        refereeIndex: 1,
        event: {
          eventId: 'alice-old-binding-event',
          connectionId: 'judge-1-primary',
          deviceId: 'device-1',
          role: 'primary',
          eventType: 1,
          deviceTimestampMs: 1,
          receivedAt: eventTime,
          systemTime: eventTime,
          totalPlus: 1,
          totalMinus: 0,
          currentTotal: 1,
          majorPenalty: 0,
          mediaBindingVersionId: aliceYoutube?.version_id,
          mediaProvider: 'youtube',
          mediaId: youtube.media_id,
          mediaSegment: youtube.segment,
          mediaTimeMs: 1000,
          mediaSyncStatus: 'aligned'
        }
      }),
      { status: 'inserted' }
    )
    assert.equal(
      database.removeMediaBinding(competition.id, competition.stageId, 'Final', 'Alice'),
      true
    )
    const replay = database.getReplay(competition.id, 'Final', 'Alice')
    assert.equal(replay?.binding, null)
    assert.deepEqual(
      replay?.binding_versions.map((version) => version.version_id || version.id),
      [aliceYoutube?.version_id]
    )
    assert.equal(replay?.events[0]?.media_binding_version_id, aliceYoutube?.version_id)

    const raw = new DatabaseSync(databasePath)
    try {
      assert.throws(
        () =>
          raw
            .prepare('UPDATE media_binding_versions SET canonical_url = ? WHERE id = ?')
            .run('https://example.com', aliceYoutube?.version_id),
        /MEDIA_BINDING_VERSION_IMMUTABLE/
      )
      assert.throws(
        () =>
          raw
            .prepare('UPDATE media_bindings SET current_version_id = ? WHERE id = ?')
            .run(aliceYoutube?.version_id, bobBilibili?.id),
        /MEDIA_BINDING_VERSION_OWNER_MISMATCH/
      )
      assert.throws(
        () =>
          raw
            .prepare('DELETE FROM media_binding_versions WHERE id = ?')
            .run(aliceYoutube?.version_id),
        /MEDIA_BINDING_VERSION_IMMUTABLE/
      )
    } finally {
      raw.close()
    }
  } finally {
    database.close()
  }
})

test('persists validated application settings in SQLite', () => {
  const { database } = createDatabase()
  database.open()
  try {
    assert.deepEqual(database.getAppSettings(), {
      language: 'zh',
      theme: 'light',
      reset_shortcut: 'Ctrl+G',
      suppress_reset_confirm: false,
      suppress_zero_confirm: false,
      device_remarks: {},
      obs_protect_main: false,
      project_preferences: {}
    })
    database.setAppSetting('language', 'ja')
    database.setAppSetting('theme', 'dark')
    database.setAppSetting('suppress_zero_confirm', true)
    database.setAppSetting('device_remarks', { 'device-1': 'Judge A' })
    database.setAppSetting('project_preferences', {
      '20260718_Demo': { show_penalty: true }
    })
  } finally {
    database.close()
  }

  database.open()
  try {
    assert.deepEqual(database.getAppSettings(), {
      language: 'ja',
      theme: 'dark',
      reset_shortcut: 'Ctrl+G',
      suppress_reset_confirm: false,
      suppress_zero_confirm: true,
      device_remarks: { 'device-1': 'Judge A' },
      obs_protect_main: false,
      project_preferences: {
        '20260718_Demo': { show_penalty: true }
      }
    })
  } finally {
    database.close()
  }
})

test('rejects unknown or unbounded application settings', () => {
  const { database } = createDatabase()
  database.open()
  try {
    assert.throws(() => database.setAppSetting('unknown', true), /SETTINGS_KEY_INVALID/)
    assert.throws(() => database.setAppSetting('language', 'unknown'), /SETTINGS_VALUE_INVALID/)
    assert.throws(() => database.setAppSetting('theme', 'system'), /SETTINGS_VALUE_INVALID/)
    assert.throws(
      () => database.setAppSetting('device_remarks', { device: 'x'.repeat(257) }),
      /SETTINGS_VALUE_INVALID/
    )
    assert.throws(
      () => database.setAppSetting('project_preferences', { project: { nested: {} } }),
      /SETTINGS_VALUE_INVALID/
    )
  } finally {
    database.close()
  }
})
