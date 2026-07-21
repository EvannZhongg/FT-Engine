import assert from 'node:assert/strict'
import test from 'node:test'

import { MatchMediaSession } from '../src/main/match/media-session.mts'
import { normalizeMediaUrl } from '../src/shared/media/normalize-media-url.mts'

const context = {
  sourceKey: 'competition-1',
  stageId: 'stage-1',
  groupName: 'Final',
  contestantName: 'Alice'
}

function binding(overrides = {}) {
  return {
    id: 'binding-alice',
    contestant_id: 'alice-id',
    version_id: 'version-alice-1',
    revision: 1,
    provider: 'youtube',
    media_id: 'dQw4w9WgXcQ',
    segment: '',
    canonical_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    updated_at: '2026-07-21T00:00:00.000Z',
    ...overrides
  }
}

function snapshot(playback, overrides = {}) {
  return {
    playback_session_id: playback.playback_session_id,
    binding_version_id: playback.binding_version_id,
    sequence: 1,
    provider: 'youtube',
    media_id: 'dQw4w9WgXcQ',
    segment: '',
    position_ms: 4500,
    duration_ms: 10000,
    state: 'playing',
    playback_rate: 1,
    ...overrides
  }
}

test('uses a bound playback session and monotonic freshness window', () => {
  let now = 1000
  const current = binding()
  const media = new MatchMediaSession({
    monotonicNow: () => now,
    getMediaBinding: () => current,
    createPlaybackSessionId: () => 'playback-1'
  })

  const playback = media.beginPlayback(context, current.version_id)
  assert.equal(media.capture(context).status, 'not_ready')
  assert.equal(media.updatePlayback(snapshot(playback), context), 'aligned')

  now = 1200
  assert.deepEqual(media.capture(context), {
    bindingVersionId: current.version_id,
    provider: 'youtube',
    mediaId: 'dQw4w9WgXcQ',
    segment: '',
    mediaTimeMs: 4700,
    status: 'aligned'
  })
  assert.equal(media.capture({ ...context, contestantName: 'Bob' }).status, 'context_mismatch')

  now = 1500
  assert.equal(media.capture(context).status, 'aligned')
  now = 1501
  assert.equal(media.capture(context).status, 'stale')
  media.reset()
  assert.equal(media.capture(context).status, 'not_ready')
})

test('rejects stale sessions, binding versions, media keys and sequences', () => {
  const current = binding()
  const media = new MatchMediaSession({
    getMediaBinding: () => current,
    createPlaybackSessionId: () => 'playback-current'
  })
  const playback = media.beginPlayback(context, current.version_id)
  media.updatePlayback(snapshot(playback), context)
  for (const invalid of [
    snapshot(playback, { sequence: 1 }),
    snapshot(playback, { sequence: 2, playback_session_id: 'old-session' }),
    snapshot(playback, { sequence: 2, binding_version_id: 'old-version' }),
    snapshot(playback, { sequence: 2, media_id: 'aqz-KE-bpKQ' })
  ]) {
    assert.throws(() => media.updatePlayback(invalid, context), {
      code: invalid.sequence === 1 ? 'MEDIA_PLAYBACK_INVALID' : 'MEDIA_PLAYBACK_SESSION_MISMATCH'
    })
  }
})

test('does not align buffering or unsupported Bilibili playback', () => {
  const youtube = binding()
  const media = new MatchMediaSession({ getMediaBinding: () => youtube })
  const playback = media.beginPlayback(context, youtube.version_id)
  media.updatePlayback(snapshot(playback, { state: 'buffering' }), context)
  assert.deepEqual(media.capture(context).mediaTimeMs, null)
  assert.equal(media.capture(context).status, 'not_ready')

  const bilibili = binding({
    version_id: 'version-bilibili',
    provider: 'bilibili',
    media_id: 'BV1xx411c7mD',
    segment: 'p=2',
    canonical_url: 'https://www.bilibili.com/video/BV1xx411c7mD/?p=2'
  })
  const unsupported = new MatchMediaSession({ getMediaBinding: () => bilibili })
  const session = unsupported.beginPlayback(context, bilibili.version_id)
  assert.equal(unsupported.capture(context).status, 'unsupported')
  assert.throws(
    () =>
      unsupported.updatePlayback(
        snapshot(session, {
          provider: 'bilibili',
          media_id: bilibili.media_id,
          segment: bilibili.segment
        }),
        context
      ),
    { code: 'MEDIA_PLAYBACK_UNSUPPORTED' }
  )
})

test('persists provider-neutral bindings and validates continuity', () => {
  const writes = []
  const saved = binding({
    version_id: 'version-bilibili',
    provider: 'bilibili',
    media_id: 'BV1xx411c7mD',
    segment: 'p=2',
    canonical_url: 'https://www.bilibili.com/video/BV1xx411c7mD/?p=2'
  })
  const media = new MatchMediaSession({
    replaceMediaBinding: (...args) => {
      writes.push(args)
      return saved
    }
  })
  const parsed = normalizeMediaUrl('https://www.bilibili.com/video/BV1xx411c7mD?p=2')
  assert.deepEqual(media.replaceBinding(context, 'Final', 'Alice', parsed), saved)
  assert.deepEqual(writes[0].at(-1), parsed)

  const missing = new MatchMediaSession({ replaceMediaBinding: () => null })
  assert.throws(() => missing.replaceBinding(context, 'Final', 'Alice', parsed), {
    code: 'MEDIA_BINDING_CONTEXT_NOT_FOUND'
  })
})

test('preserves position only for a fresh aligned YouTube anchor with the same media key', () => {
  let now = 1000
  const alice = binding()
  const bob = binding({
    id: 'binding-bob',
    contestant_id: 'bob-id',
    version_id: 'version-bob-1'
  })
  const bindings = new Map([
    ['Alice', alice],
    ['Bob', bob]
  ])
  let sessionNumber = 0
  const media = new MatchMediaSession({
    monotonicNow: () => now,
    getMediaBinding: (_sourceKey, _stageId, _groupName, contestantName) =>
      bindings.get(contestantName) || null,
    createPlaybackSessionId: () => `playback-${++sessionNumber}`
  })
  const alicePlayback = media.beginPlayback(context, alice.version_id)
  media.updatePlayback(snapshot(alicePlayback), context)
  now = 1250

  const prepared = media.prepareTransition(
    context,
    { ...context, contestantName: 'Bob' },
    bob.version_id,
    'continue',
    'youtube:dQw4w9WgXcQ:'
  )
  assert.deepEqual(prepared, { binding: bob, continuityPositionMs: 4750 })
  assert.equal(media.capture(context).status, 'not_ready')
  const bobPlayback = media.beginPlayback({ ...context, contestantName: 'Bob' }, bob.version_id)
  assert.notEqual(bobPlayback.playback_session_id, alicePlayback.playback_session_id)
  assert.throws(
    () => media.updatePlayback(snapshot(alicePlayback), { ...context, contestantName: 'Bob' }),
    { code: 'MEDIA_PLAYBACK_SESSION_MISMATCH' }
  )
})

test('rejects continuity for another media, unsupported providers and stale anchors', () => {
  let now = 1000
  const alice = binding()
  let target = binding({
    id: 'binding-bob',
    contestant_id: 'bob-id',
    version_id: 'version-bob-1',
    media_id: 'aqz-KE-bpKQ',
    canonical_url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'
  })
  const media = new MatchMediaSession({
    monotonicNow: () => now,
    getMediaBinding: (_sourceKey, _stageId, _groupName, contestantName) =>
      contestantName === 'Alice' ? alice : target
  })
  const playback = media.beginPlayback(context, alice.version_id)
  media.updatePlayback(snapshot(playback), context)
  const bobContext = { ...context, contestantName: 'Bob' }
  assert.throws(
    () =>
      media.prepareTransition(
        context,
        bobContext,
        target.version_id,
        'continue',
        'youtube:aqz-KE-bpKQ:'
      ),
    { code: 'MEDIA_PROGRESS_CONTINUITY_UNAVAILABLE' }
  )

  target = binding({
    id: 'binding-bob',
    contestant_id: 'bob-id',
    version_id: 'version-bob-2',
    provider: 'bilibili',
    media_id: 'BV1xx411c7mD',
    segment: 'p=1',
    canonical_url: 'https://www.bilibili.com/video/BV1xx411c7mD/?p=1'
  })
  assert.throws(
    () =>
      media.prepareTransition(
        context,
        bobContext,
        target.version_id,
        'continue',
        'bilibili:BV1xx411c7mD:p=1'
      ),
    { code: 'MEDIA_PROGRESS_CONTINUITY_UNAVAILABLE' }
  )

  target = binding({
    id: 'binding-bob',
    contestant_id: 'bob-id',
    version_id: 'version-bob-3'
  })
  now = 1501
  assert.throws(
    () =>
      media.prepareTransition(
        context,
        bobContext,
        target.version_id,
        'continue',
        'youtube:dQw4w9WgXcQ:'
      ),
    { code: 'MEDIA_PROGRESS_CONTINUITY_UNAVAILABLE' }
  )
  assert.deepEqual(
    media.prepareTransition(
      context,
      bobContext,
      target.version_id,
      'reset',
      'youtube:dQw4w9WgXcQ:'
    ),
    { binding: target, continuityPositionMs: null }
  )
})

test('uses paused positions without extrapolation and applies playback rate while playing', () => {
  let now = 1000
  const current = binding()
  const media = new MatchMediaSession({
    monotonicNow: () => now,
    getMediaBinding: () => current
  })
  const playback = media.beginPlayback(context, current.version_id)
  media.updatePlayback(snapshot(playback, { state: 'paused', position_ms: 3000 }), context)
  now = 1400
  assert.equal(media.capture(context).mediaTimeMs, 3000)
  media.updatePlayback(
    snapshot(playback, { sequence: 2, state: 'playing', position_ms: 3000, playback_rate: 2 }),
    context
  )
  now = 1500
  assert.equal(media.capture(context).mediaTimeMs, 3200)
})

test('reports player errors only for the active playback session and clears its anchor', () => {
  const current = binding()
  const media = new MatchMediaSession({ getMediaBinding: () => current })
  const playback = media.beginPlayback(context, current.version_id)
  media.updatePlayback(snapshot(playback), context)
  assert.throws(
    () =>
      media.reportPlaybackError(
        {
          playback_session_id: 'old-playback',
          binding_version_id: current.version_id,
          code: 'MEDIA_PLAYER_UNAVAILABLE'
        },
        context
      ),
    { code: 'MEDIA_PLAYBACK_SESSION_MISMATCH' }
  )
  assert.equal(
    media.reportPlaybackError(
      {
        playback_session_id: playback.playback_session_id,
        binding_version_id: current.version_id,
        code: 'MEDIA_PLAYER_UNAVAILABLE'
      },
      context
    ),
    'error'
  )
  assert.equal(media.capture(context).status, 'error')
  assert.equal(media.capture(context).mediaTimeMs, null)
  assert.equal(media.updatePlayback(snapshot(playback, { sequence: 2 }), context), 'aligned')
})
