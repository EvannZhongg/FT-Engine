import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  clampAttempt,
  createGroupDraft,
  toStageDraft,
  toStageInput
} from '../src/renderer/src/features/competitions/stageDrafts.mjs'

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('creates independent editable Stage graphs and normalized inputs', () => {
  const stored = {
    id: 'stage-1',
    name: 'Qualifier',
    attempts: 3,
    status: 'draft',
    groups: [
      {
        name: 'Open',
        refCount: 1,
        players: ['Alice'],
        referees: []
      }
    ]
  }
  const draft = toStageDraft(stored)
  draft.groups[0].rawPlayers = 'Alice\n Bob \n\n'

  assert.deepEqual(toStageInput(draft), {
    name: 'Qualifier',
    attempts: 3,
    groups: [
      {
        name: 'Open',
        refCount: 1,
        players: ['Alice', 'Bob'],
        referees: []
      }
    ]
  })
  assert.deepEqual(stored.groups[0].players, ['Alice'])
  assert.notStrictEqual(createGroupDraft(0), createGroupDraft(0))
  assert.equal(clampAttempt(9, 3), 3)
  assert.equal(clampAttempt(0, 3), 1)
})

test('routes selected Stage and attempt through the Renderer boundary', () => {
  const competitionStore = source('src/renderer/src/stores/competitionStore.js')
  const matchStore = source('src/renderer/src/stores/matchStore.js')
  const wizard = source('src/renderer/src/components/SetupWizard.vue')
  const scoreboard = source('src/renderer/src/components/ScoreBoard.vue')

  assert.equal(matchStore.includes('stageId: competitionStore.activeStageId'), true)
  assert.equal(matchStore.includes('attemptNumber: competitionStore.activeAttemptNumber'), true)
  assert.equal(competitionStore.includes('window.ftEngine.stages.reorder'), true)
  assert.equal(wizard.includes('selectedStageIdToRun'), true)
  assert.equal(wizard.includes('selectedAttemptToRun'), true)
  assert.equal(scoreboard.includes('competitionStore.activeStage?.name'), true)
  assert.equal(scoreboard.includes('competitionStore.activeAttemptNumber'), true)
})
