import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
)

test('publishes updates from the canonical FT-Studio repository', () => {
  assert.deepEqual(packageJson.build.publish, [{
    provider: 'github',
    owner: 'evannzhongg',
    repo: 'FT-Studio'
  }])
})

test('does not disable platform signing checks in release configuration', () => {
  assert.notEqual(packageJson.build.win.verifyUpdateCodeSignature, false)
  assert.notEqual(packageJson.build.mac.identity, null)
  assert.equal(packageJson.build.mac.hardenedRuntime, true)
})

test('packages only the desktop output and local platform worker', () => {
  assert.deepEqual(packageJson.build.files, ['out/**/*', 'resources/**/*'])
  assert.equal(packageJson.build.win.extraResources.length, 1)
  assert.equal(packageJson.build.win.extraResources[0].to, 'local-platform-worker.exe')
  assert.equal(JSON.stringify(packageJson.build).includes('backend-engine'), false)
})
