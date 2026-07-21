import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { normalizeExternalUrl, normalizeOverlayOptions } from '../src/main/security.mjs'

test('allows only HTTPS external links', () => {
  assert.equal(normalizeExternalUrl('https://example.com/path'), 'https://example.com/path')
  assert.equal(normalizeExternalUrl('http://example.com'), null)
  assert.equal(normalizeExternalUrl('file:///C:/secret.txt'), null)
  assert.equal(normalizeExternalUrl('javascript:alert(1)'), null)
  assert.equal(normalizeExternalUrl('not a url'), null)
})

test('normalizes finite positive overlay bounds', () => {
  assert.deepEqual(
    normalizeOverlayOptions({
      bounds: { x: '-100', y: 20, width: '1920', height: 1080 },
      initialState: { referees: {} }
    }),
    {
      bounds: { x: -100, y: 20, width: 1920, height: 1080 },
      initialState: { referees: {} }
    }
  )
})

test('rejects invalid or excessive overlay bounds', () => {
  for (const bounds of [
    { x: 0, y: 0, width: 0, height: 100 },
    { x: 0, y: 0, width: 100, height: -1 },
    { x: 0, y: 0, width: 40000, height: 100 },
    { x: 'unknown', y: 0, width: 100, height: 100 }
  ]) {
    assert.throws(() => normalizeOverlayOptions({ bounds }), /IPC_INVALID_OVERLAY_BOUNDS/)
  }
})

test('drops non-object overlay state', () => {
  assert.deepEqual(normalizeOverlayOptions({ initialState: ['unexpected'] }), {
    bounds: null,
    initialState: null
  })
})

test('keeps third-party player CSP and Electron web preferences constrained', () => {
  const html = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  const windows = readFileSync(new URL('../src/main/app/windows.mts', import.meta.url), 'utf8')
  assert.match(
    html,
    /frame-src https:\/\/www\.youtube\.com https:\/\/www\.youtube-nocookie\.com https:\/\/player\.bilibili\.com/
  )
  assert.doesNotMatch(html, /frame-src[^;]*https:\s*[;\x22\x27]/)
  assert.match(windows, /contextIsolation:\s*true/)
  assert.match(windows, /nodeIntegration:\s*false/)
  assert.match(windows, /sandbox:\s*true/)
  assert.match(windows, /webSecurity:\s*true/)
  assert.doesNotMatch(windows, /webSecurity:\s*false|nodeIntegration:\s*true/)
})
