import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { PlatformWorkerManager } from '../src/main/infrastructure/platform-worker/platform-worker-manager.mjs'

class FakeWorker extends EventEmitter {
  requests = []
  started = false
  stoppedWith = null
  terminated = false

  async start() {
    this.started = true
  }

  async request(method, params = {}, timeoutMs) {
    this.requests.push({ method, params, timeoutMs })
    if (method === 'system.hello') return { protocolVersion: 1 }
    return { ok: true }
  }

  async stop(graceMs) {
    this.stoppedWith = graceMs
  }

  terminate() {
    this.terminated = true
  }
}

function createFixture(options = {}) {
  const workers = []
  const events = []
  const logs = []
  const timers = []
  let unavailable = 0
  let reconnected = 0
  const manager = new PlatformWorkerManager({
    createClient: () => {
      const worker = new FakeWorker()
      options.configureWorker?.(worker, workers.length)
      workers.push(worker)
      return worker
    },
    onEvent: (message) => events.push(message),
    onUnavailable: () => {
      unavailable += 1
    },
    isSessionActive: () => options.active === true,
    reconnectSession: async () => {
      reconnected += 1
    },
    log: (level, message) => logs.push({ level, message }),
    schedule: (callback, delayMs) => {
      const timer = { callback, delayMs, cancelled: false }
      timers.push(timer)
      return timer
    },
    cancel: (timer) => {
      timer.cancelled = true
    }
  })
  return {
    manager,
    workers,
    events,
    logs,
    timers,
    unavailable: () => unavailable,
    reconnected: () => reconnected
  }
}

test('starts, handshakes and reconnects an active match session', async () => {
  const fixture = createFixture({ active: true })
  assert.deepEqual(await fixture.manager.start(), { protocolVersion: 1 })
  assert.equal(fixture.workers[0].started, true)
  assert.equal(fixture.reconnected(), 1)

  assert.deepEqual(await fixture.manager.retry(), { status: 'already_ready' })
  assert.equal(fixture.workers.length, 1)
  assert.equal(fixture.reconnected(), 2)

  fixture.workers[0].emit('event', { event: 'device.counter' })
  assert.deepEqual(fixture.events, [{ event: 'device.counter' }])
  assert.deepEqual(await fixture.manager.request('window.list'), { ok: true })
})

test('schedules a bounded restart after an unexpected exit', async () => {
  const fixture = createFixture()
  await fixture.manager.start()
  fixture.workers[0].emit('exit', { code: 1, signal: null })

  assert.equal(fixture.unavailable(), 1)
  assert.equal(fixture.timers.length, 1)
  assert.equal(fixture.timers[0].delayMs, 1000)
  await fixture.timers[0].callback()
  assert.equal(fixture.workers.length, 2)
  assert.equal(fixture.workers[1].started, true)
})

test('ignores a stale exit after a replacement worker is ready', async () => {
  const fixture = createFixture()
  await fixture.manager.start()
  const replacedWorker = fixture.workers[0]
  replacedWorker.emit('exit', { code: 1, signal: null })
  await fixture.timers[0].callback()

  replacedWorker.emit('exit', { code: 1, signal: null })

  assert.equal(fixture.unavailable(), 1)
  assert.equal(fixture.timers.length, 1)
  assert.deepEqual(await fixture.manager.request('window.list'), { ok: true })
})

test('stops restarting after three attempts', async () => {
  const fixture = createFixture()
  await fixture.manager.start()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    fixture.workers[attempt].emit('exit', { code: 1, signal: null })
    assert.equal(fixture.timers[attempt].delayMs, (attempt + 1) * 1000)
    await fixture.timers[attempt].callback()
  }
  fixture.workers[3].emit('exit', { code: 1, signal: null })
  assert.equal(fixture.timers.length, 3)
})

test('stops without scheduling a replacement worker', async () => {
  const fixture = createFixture()
  await fixture.manager.start()
  const worker = fixture.workers[0]
  await fixture.manager.stop(900)
  worker.emit('exit', { code: 0, signal: null })

  assert.equal(worker.stoppedWith, 900)
  assert.equal(fixture.unavailable(), 0)
  assert.equal(fixture.timers.length, 0)
  assert.throws(() => fixture.manager.request('system.hello'), /WORKER_NOT_RUNNING/)
})

test('manual retry resets an exhausted automatic restart budget', async () => {
  const fixture = createFixture()
  await fixture.manager.start()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    fixture.workers[attempt].emit('exit', { code: 1, signal: null })
    await fixture.timers[attempt].callback()
  }
  fixture.workers[3].emit('exit', { code: 1, signal: null })
  assert.equal(fixture.timers.length, 3)

  assert.deepEqual(await fixture.manager.retry(), {
    status: 'ready',
    hello: { protocolVersion: 1 }
  })
  assert.equal(fixture.workers.length, 5)

  fixture.workers[4].emit('exit', { code: 1, signal: null })
  assert.equal(fixture.timers.length, 4)
  assert.equal(fixture.timers[3].delayMs, 1000)
})

test('coalesces manual retries and cancels a pending automatic restart', async () => {
  let releaseStart
  const startPending = new Promise((resolve) => {
    releaseStart = resolve
  })
  const fixture = createFixture({
    configureWorker: (worker, index) => {
      if (index === 1) worker.start = async () => startPending
    }
  })
  await fixture.manager.start()
  fixture.workers[0].emit('exit', { code: 1, signal: null })

  const first = fixture.manager.retry()
  const second = fixture.manager.retry()

  assert.equal(first, second)
  assert.equal(fixture.timers[0].cancelled, true)
  releaseStart()
  await first
  assert.equal(fixture.workers.length, 2)
})

test('starts a fresh automatic budget when manual recovery fails', async () => {
  const fixture = createFixture({
    configureWorker: (worker) => {
      worker.start = async () => {
        const error = new Error('worker start failed')
        error.code = 'WORKER_START_FAILED'
        throw error
      }
    }
  })

  await assert.rejects(fixture.manager.start(), { code: 'WORKER_START_FAILED' })
  await assert.rejects(fixture.manager.retry(), { code: 'WORKER_START_FAILED' })
  assert.equal(fixture.timers.length, 1)
  assert.equal(fixture.timers[0].delayMs, 1000)
  assert.equal(
    fixture.logs.some((entry) => entry.message.includes('manual retry failed')),
    true
  )
})
