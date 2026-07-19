import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('routes manual Platform Worker recovery from both Renderer workflows', () => {
  const contract = source('src/shared/ipc-contract.ts')
  const preload = source('src/preload/index.ts')
  const registration = source('src/main/ipc/register-platform.mts')
  const store = source('src/renderer/src/stores/deviceStore.js')
  const scoreboard = source('src/renderer/src/components/ScoreBoard.vue')
  const wizard = source('src/renderer/src/components/SetupWizard.vue')

  assert.equal(contract.includes("retryWorker: 'platform:retry-worker'"), true)
  assert.equal(contract.includes('Promise<PlatformWorkerRetryResult>'), true)
  assert.equal(preload.includes('IPC_CHANNELS.platform.retryWorker'), true)
  assert.equal(registration.includes('await worker.retry()'), true)
  assert.equal(registration.includes("'WORKER_RETRY_FAILED'"), true)
  assert.equal(store.includes('retryPlatformWorker()'), true)
  assert.equal(scoreboard.includes('@click="retryPlatformWorker"'), true)
  assert.equal(scoreboard.includes("store.matchStatus.worker === 'error'"), true)
  assert.equal(wizard.includes('workerRetryAvailable'), true)
  assert.equal(wizard.includes("msg.includes('WORKER_')"), true)
  assert.equal(wizard.includes('await startScan(true)'), true)
})
