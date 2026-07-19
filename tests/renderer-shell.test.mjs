import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('uses Vue Router and a fixed desktop shell without routing the Overlay through it', () => {
  const app = source('src/renderer/src/App.vue')
  const router = source('src/renderer/src/app/router/index.js')
  const shell = source('src/renderer/src/app/layouts/AppShell.vue')
  const packageJson = JSON.parse(source('package.json'))

  assert.equal(packageJson.dependencies['vue-router'] !== undefined, true)
  assert.equal(app.includes('currentView'), false)
  assert.equal(app.includes('<OverlayView />'), true)
  assert.equal(app.includes('<AppShell v-else />'), true)
  for (const route of ['/dashboard', '/competitions', '/scoring', '/replay', '/settings']) {
    assert.equal(router.includes(`'${route}'`), true, route)
  }
  assert.equal(shell.includes('class="app-sidebar"'), true)
  assert.equal(shell.includes('<RouterView />'), true)
  const replay = source('src/renderer/src/components/ReplayView.vue')
  for (const filter of ['competition', 'group', 'contestant', 'referee']) {
    assert.equal(replay.includes(filter), true, filter)
  }
  assert.equal(replay.includes('router.replace({ query })'), true)
})

test('splits Renderer state by domain and removes native page dialogs', () => {
  const stores = [
    'competitionStore.js',
    'deviceStore.js',
    'matchStore.js',
    'replayStore.js',
    'settingsStore.js'
  ]
  for (const store of stores) {
    assert.equal(
      existsSync(new URL(`../src/renderer/src/stores/${store}`, import.meta.url)),
      true,
      store
    )
  }
  assert.equal(
    existsSync(new URL('../src/renderer/src/stores/refereeStore.js', import.meta.url)),
    false
  )

  const renderer = [
    source('src/renderer/src/App.vue'),
    source('src/renderer/src/components/SetupWizard.vue'),
    source('src/renderer/src/components/ReportView.vue'),
    source('src/renderer/src/features/settings/SettingsView.vue')
  ].join('\n')
  for (const nativeDialog of ['window.alert', 'window.confirm', 'alert(', 'confirm(']) {
    assert.equal(renderer.includes(nativeDialog), false, nativeDialog)
  }
})

test('routes operational workspace structure through shared semantic tokens', () => {
  const tokens = source('src/renderer/src/assets/main.css')
  for (const token of [
    '--workbench-bg',
    '--workbench-surface',
    '--workbench-border',
    '--workbench-text',
    '--workbench-accent'
  ]) {
    assert.equal(tokens.includes(token), true, token)
  }

  for (const page of [
    'src/renderer/src/components/SetupWizard.vue',
    'src/renderer/src/components/ScoreBoard.vue',
    'src/renderer/src/components/ReplayView.vue',
    'src/renderer/src/components/ReportView.vue'
  ]) {
    const pageSource = source(page)
    assert.equal(pageSource.includes('var(--workbench-'), true, page)
    assert.equal(pageSource.includes('background: #1e1e1e'), false, page)
  }
})

test('shares focus-managed dialogs across confirmation, scoring and report workflows', () => {
  const shell = source('src/renderer/src/components/DialogShell.vue')
  for (const behavior of [
    '<Teleport to="body">',
    'aria-modal="true"',
    "event.key === 'Escape'",
    "event.key !== 'Tab'",
    'previouslyFocused',
    'closeOnBackdrop'
  ]) {
    assert.equal(shell.includes(behavior), true, behavior)
  }

  for (const consumer of [
    'src/renderer/src/components/AppDialog.vue',
    'src/renderer/src/components/ScoreBoard.vue',
    'src/renderer/src/components/ReportView.vue',
    'src/renderer/src/components/SetupWizard.vue'
  ]) {
    assert.equal(source(consumer).includes("import DialogShell from './DialogShell.vue'"), true)
  }
  assert.equal(
    source('src/renderer/src/components/ScoreBoard.vue').includes('modal-overlay'),
    false
  )
  assert.equal(
    source('src/renderer/src/components/ReportView.vue').includes('modal-overlay'),
    false
  )
  assert.equal(
    source('src/renderer/src/components/SetupWizard.vue').includes('class="overlay"'),
    false
  )
})
