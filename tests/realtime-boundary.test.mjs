import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('keeps the desktop runtime independent from a localhost backend', () => {
  const renderer = [
    'src/renderer/src/App.vue',
    'src/renderer/src/components/OverlayView.vue',
    'src/renderer/src/components/ScoreBoard.vue',
    'src/renderer/src/stores/refereeStore.js'
  ]
    .map(source)
    .join('\n')
  const main = [source('src/main/index.js'), source('src/main/app/bootstrap.mts')].join('\n')
  const html = source('src/renderer/index.html')
  const packageJson = JSON.parse(source('package.json'))

  for (const dependency of ['axios', 'http://127.0.0.1', 'new WebSocket']) {
    assert.equal(renderer.includes(dependency), false, dependency)
  }
  for (const runtime of ['server.py', 'match_data', 'child_process', 'waitForBackend']) {
    assert.equal(main.includes(runtime), false, runtime)
  }
  assert.equal(html.includes('127.0.0.1'), false)
  assert.equal(packageJson.dependencies.axios, undefined)
  assert.equal(packageJson.dependencies['js-yaml'], undefined)
  assert.equal(JSON.stringify(packageJson.build).includes('backend-engine'), false)
})
