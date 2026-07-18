import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'

import { WorkerClient, WorkerClientError } from '../src/main/worker/worker-client.mjs'


const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const virtualWorker = path.join(projectRoot, 'tests', 'fixtures', 'virtual-worker.mjs')

function createVirtualClient() {
  return new WorkerClient({
    command: process.execPath,
    args: [virtualWorker],
    cwd: projectRoot,
    requestTimeoutMs: 1000
  })
}

test('routes concurrent JSONL responses by request id', async () => {
  const client = createVirtualClient()
  await client.start()
  try {
    const results = await Promise.all([
      client.request('system.ping', { echo: 'first' }),
      client.request('system.ping', { echo: 'second' })
    ])
    assert.deepEqual(results, [{ echo: 'first' }, { echo: 'second' }])
  } finally {
    await client.stop()
  }
})

test('surfaces stable worker errors', async () => {
  const client = createVirtualClient()
  await client.start()
  try {
    await assert.rejects(client.request('test.error'), (error) => {
      assert.ok(error instanceof WorkerClientError)
      assert.equal(error.code, 'USB_PORT_BUSY')
      return true
    })
  } finally {
    await client.stop()
  }
})

test('forwards worker events separately from responses', async () => {
  const client = createVirtualClient()
  await client.start()
  try {
    const eventPromise = new Promise((resolve) => client.once('event', resolve))
    await client.request('test.event')
    const event = await eventPromise
    assert.equal(event.event, 'device.score')
    assert.equal(event.payload.total, 3)
  } finally {
    await client.stop()
  }
})

test('terminates a worker that violates the JSONL protocol', async () => {
  const client = createVirtualClient()
  await client.start()
  const protocolError = new Promise((resolve) => client.once('protocolError', resolve))
  const request = client.request('test.malformed')
  const error = await protocolError
  assert.equal(error.code, 'WORKER_INVALID_JSON')
  await assert.rejects(request, { code: 'WORKER_INVALID_JSON' })
})

const python = process.platform === 'win32'
  ? path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
  : path.join(projectRoot, '.venv', 'bin', 'python')

test('completes a cross-language handshake with the Python worker', {
  skip: !existsSync(python)
}, async () => {
  const client = new WorkerClient({
    command: python,
    args: ['-m', 'workers.local_platform_worker.ft_worker'],
    cwd: projectRoot,
    requestTimeoutMs: 2000
  })
  await client.start()
  try {
    const hello = await client.request('system.hello')
    assert.equal(hello.protocolVersion, 1)
    assert.ok(['windows', 'macos', 'unsupported'].includes(hello.platform))
    assert.equal(typeof hello.capabilities.windowTracking, 'boolean')
  } finally {
    await client.stop()
  }
})
