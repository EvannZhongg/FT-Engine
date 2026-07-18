import assert from 'node:assert/strict'
import test from 'node:test'

import { MatchSessionService } from '../src/main/match/match-session.mts'

function defaultWorkerResult(method, params) {
  if (method === 'device.connectMany') {
    return {
      connections: params.connections.map((value) => ({ ...value, status: 'connected' }))
    }
  }
  return { connections: [] }
}

function createFixture() {
  const workerCalls = []
  const updates = []
  const statuses = []
  const contexts = []
  const events = []
  const errors = []
  const mediaBindings = []
  let monotonicMs = 1000
  let workerImplementation = async (method, params) => defaultWorkerResult(method, params)
  let persistenceImplementation = (input) => {
    events.push(input)
    return { status: 'inserted' }
  }
  let contextImplementation = () => true
  const service = new MatchSessionService({
    requestWorker: async (method, params = {}) => {
      workerCalls.push({ method, params })
      return workerImplementation(method, params)
    },
    persistEvent: (input) => persistenceImplementation(input),
    validateContext: (...args) => contextImplementation(...args),
    upsertMediaBinding: (...args) => {
      mediaBindings.push(args)
      return true
    },
    emitRefereeUpdate: (update) => updates.push(update),
    emitContextUpdate: (context) => contexts.push(context),
    emitStatusUpdate: (status) => statuses.push(status),
    onError: (code, error) => errors.push({ code, error }),
    now: () => new Date('2026-07-18T12:00:00.000Z'),
    monotonicNow: () => monotonicMs
  })
  return {
    service,
    workerCalls,
    updates,
    statuses,
    contexts,
    events,
    errors,
    mediaBindings,
    advance: (milliseconds) => {
      monotonicMs += milliseconds
    },
    setWorkerImplementation: (implementation) => {
      workerImplementation = implementation
    },
    setPersistenceImplementation: (implementation) => {
      persistenceImplementation = implementation
    },
    setContextImplementation: (implementation) => {
      contextImplementation = implementation
    }
  }
}

const startInput = {
  sourceKey: '20260718_120000_Demo',
  groupName: 'Final',
  contestantName: 'Alice',
  attemptNumber: 1,
  referees: [
    {
      index: 1,
      name: 'Judge A',
      mode: 'DUAL',
      primaryDeviceId: 'device-primary',
      secondaryDeviceId: 'device-secondary'
    }
  ]
}

function counterEvent(overrides = {}) {
  const { payload = {}, ...message } = overrides
  return {
    event: 'device.counter',
    eventId: 'event-primary',
    payload: {
      connectionId: 'match-ref-1-primary',
      totalPlus: 5,
      totalMinus: 2,
      eventType: 1,
      deviceTimestampMs: 100,
      ...payload
    },
    ...message
  }
}

test('connects bindings and publishes explicit session state', async () => {
  const fixture = createFixture()
  const result = await fixture.service.start(startInput)

  assert.deepEqual(
    fixture.workerCalls.map((value) => value.method),
    ['device.disconnectAll', 'device.connectMany']
  )
  assert.equal(fixture.workerCalls[1].params.connections.length, 2)
  assert.equal(result.status.state, 'active')
  assert.equal(result.status.worker, 'ready')
  assert.equal(fixture.statuses[0].state, 'starting')
  assert.equal(fixture.statuses.at(-1).state, 'active')
})

test('rejects unconfigured contexts before controlling devices', async () => {
  const fixture = createFixture()
  fixture.setContextImplementation(() => false)
  await assert.rejects(fixture.service.start(startInput), { code: 'MATCH_CONTEXT_INVALID' })
  assert.deepEqual(fixture.workerCalls, [])

  fixture.setContextImplementation(() => true)
  await fixture.service.start(startInput)
  fixture.setContextImplementation(() => false)
  await assert.rejects(fixture.service.setContext('Final', 'Bob'), {
    code: 'MATCH_CONTEXT_INVALID'
  })
  assert.equal(
    fixture.workerCalls.some((call) => call.method === 'device.resetAll'),
    false
  )
})

test('persists an event before publishing its score', async () => {
  const fixture = createFixture()
  await fixture.service.start(startInput)

  fixture.service.handleWorkerEvent(counterEvent())
  fixture.service.handleWorkerEvent(
    counterEvent({
      eventId: 'event-secondary',
      payload: {
        connectionId: 'match-ref-1-secondary',
        totalPlus: 3,
        totalMinus: 4,
        eventType: -1,
        deviceTimestampMs: 110
      }
    })
  )

  assert.deepEqual(fixture.updates.at(-1).score, {
    total: 2,
    plus: 5,
    minus: 3,
    penalty: 6
  })
  assert.deepEqual(fixture.events.at(-1), {
    sourceKey: startInput.sourceKey,
    groupName: 'Final',
    contestantName: 'Alice',
    attemptNumber: 1,
    refereeIndex: 1,
    event: {
      eventId: 'event-secondary',
      connectionId: 'match-ref-1-secondary',
      deviceId: 'device-secondary',
      role: 'secondary',
      eventType: -1,
      deviceTimestampMs: 110,
      receivedAt: '2026-07-18T12:00:00.000Z',
      systemTime: '2026-07-18T12:00:00.000Z',
      totalPlus: 5,
      totalMinus: 3,
      currentTotal: 2,
      majorPenalty: 6,
      mediaProvider: '',
      mediaId: '',
      mediaTimeMs: null,
      mediaSyncStatus: 'not_ready'
    }
  })
  assert.equal(fixture.statuses.at(-1).persistence, 'saved')
})

test('does not publish an unpersisted score and contains invalid worker payloads', async () => {
  const fixture = createFixture()
  await fixture.service.start(startInput)
  const updateCount = fixture.updates.length
  fixture.setPersistenceImplementation(() => {
    throw new Error('disk full')
  })

  assert.doesNotThrow(() => fixture.service.handleWorkerEvent(counterEvent()))
  assert.equal(fixture.updates.length, updateCount)
  assert.equal(fixture.service.getStatus().persistence, 'error')
  assert.equal(fixture.service.getStatus().errorCode, 'MATCH_EVENT_PERSIST_FAILED')

  assert.doesNotThrow(() =>
    fixture.service.handleWorkerEvent(
      counterEvent({
        eventId: 'invalid-event',
        payload: { totalPlus: -1 }
      })
    )
  )
  assert.equal(fixture.service.getStatus().errorCode, 'INVALID_DEVICE_EVENT')
  assert.doesNotThrow(() => fixture.service.handleWorkerEvent({ event: 'device.counter' }))
  assert.equal(fixture.service.getStatus().errorCode, 'MATCH_EVENT_INVALID')
  assert.deepEqual(
    fixture.errors.map((value) => value.code),
    ['MATCH_EVENT_PERSIST_FAILED', 'INVALID_DEVICE_EVENT', 'MATCH_EVENT_INVALID']
  )
})

test('deduplicates device events and resets all active connections', async () => {
  const fixture = createFixture()
  await fixture.service.start(startInput)
  const event = counterEvent({
    eventId: 'duplicate-event',
    payload: { totalPlus: 1, totalMinus: 0 }
  })
  fixture.service.handleWorkerEvent(event)
  fixture.service.handleWorkerEvent(event)
  assert.equal(fixture.events.length, 1)

  await fixture.service.reset()
  assert.equal(fixture.workerCalls.at(-1).method, 'device.resetAll')
  assert.deepEqual(fixture.updates.at(-1).score, { total: 0, plus: 0, minus: 0, penalty: 0 })
})

test('keeps in-flight events on the old contestant while switching context', async () => {
  const fixture = createFixture()
  await fixture.service.start(startInput)
  let releaseReset
  const resetPending = new Promise((resolve) => {
    releaseReset = resolve
  })
  fixture.setWorkerImplementation(async (method, params) => {
    if (method === 'device.resetAll') {
      await resetPending
      return { connections: [] }
    }
    return defaultWorkerResult(method, params)
  })

  const switching = fixture.service.setContext('Final', 'Bob')
  await assert.rejects(fixture.service.setContext('Final', 'Charlie'), {
    code: 'MATCH_OPERATION_IN_PROGRESS'
  })
  fixture.service.handleWorkerEvent(counterEvent({ eventId: 'alice-final-event' }))
  assert.equal(fixture.events.at(-1).contestantName, 'Alice')

  releaseReset()
  await switching
  assert.deepEqual(fixture.contexts.at(-1), { groupName: 'Final', contestantName: 'Bob' })
  assert.deepEqual(fixture.updates.at(-1).score, { total: 0, plus: 0, minus: 0, penalty: 0 })
})

test('rejects concurrent starts and cancels a start when stopping wins', async () => {
  const fixture = createFixture()
  let releaseConnect
  const connectPending = new Promise((resolve) => {
    releaseConnect = resolve
  })
  fixture.setWorkerImplementation(async (method, params) => {
    if (method === 'device.connectMany') {
      await connectPending
    }
    return defaultWorkerResult(method, params)
  })

  const starting = fixture.service.start(startInput)
  await new Promise((resolve) => setImmediate(resolve))
  await assert.rejects(fixture.service.start(startInput), { code: 'MATCH_STATE_CONFLICT' })
  assert.equal(fixture.service.beginStopping(), true)
  fixture.service.completeStop(true)
  releaseConnect()
  await assert.rejects(starting, { code: 'MATCH_START_CANCELLED' })
  assert.equal(fixture.service.getStatus().state, 'completed')
})

test('publishes worker reconnect failures without losing the active session', async () => {
  const fixture = createFixture()
  await fixture.service.start(startInput)
  fixture.service.markWorkerUnavailable()
  fixture.setWorkerImplementation(async (method, params) => {
    if (method === 'device.connectMany') throw new Error('worker unavailable')
    return defaultWorkerResult(method, params)
  })

  await assert.rejects(fixture.service.reconnectWorker(), /worker unavailable/)
  assert.equal(fixture.service.getStatus().state, 'active')
  assert.equal(fixture.service.getStatus().worker, 'error')
  assert.equal(fixture.service.getStatus().errorCode, 'MATCH_WORKER_RECONNECT_FAILED')
})

test('rejects duplicate device bindings before connecting', async () => {
  const fixture = createFixture()
  await assert.rejects(
    fixture.service.start({
      ...startInput,
      referees: [
        startInput.referees[0],
        {
          index: 2,
          name: 'Judge B',
          mode: 'SINGLE',
          primaryDeviceId: 'device-primary',
          secondaryDeviceId: null
        }
      ]
    }),
    { code: 'MATCH_CONFIG_INVALID' }
  )
})

test('captures a fresh playback anchor and persists media bindings', async () => {
  const fixture = createFixture()
  await fixture.service.start(startInput)
  assert.deepEqual(
    fixture.service.setMediaBinding('Final', 'Alice', 'https://youtu.be/dQw4w9WgXcQ?si=demo'),
    {
      provider: 'youtube',
      video_id: 'dQw4w9WgXcQ',
      canonical_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    }
  )
  assert.deepEqual(fixture.mediaBindings[0], [
    startInput.sourceKey,
    'Final',
    'Alice',
    {
      provider: 'youtube',
      mediaId: 'dQw4w9WgXcQ',
      canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    }
  ])
  fixture.service.updatePlayback({
    group: 'Final',
    contestant: 'Alice',
    video_id: 'dQw4w9WgXcQ',
    video_time_ms: 4500,
    state: 'playing',
    playback_rate: 1
  })
  fixture.advance(200)
  fixture.service.handleWorkerEvent(
    counterEvent({
      eventId: 'video-event',
      payload: {
        totalPlus: 1,
        totalMinus: 0,
        deviceTimestampMs: 120
      }
    })
  )

  assert.equal(fixture.mediaBindings.length, 1)
  assert.deepEqual(
    {
      provider: fixture.events[0].event.mediaProvider,
      mediaId: fixture.events[0].event.mediaId,
      mediaTimeMs: fixture.events[0].event.mediaTimeMs,
      status: fixture.events[0].event.mediaSyncStatus
    },
    {
      provider: 'youtube',
      mediaId: 'dQw4w9WgXcQ',
      mediaTimeMs: 4700,
      status: 'aligned'
    }
  )
  assert.equal(fixture.service.getStatus().media, 'aligned')
})
