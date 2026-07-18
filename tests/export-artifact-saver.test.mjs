import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { ExportServiceError } from '../src/main/application/exports/export-service.mts'
import { ExportArtifactSaver } from '../src/main/infrastructure/filesystem/export-artifact-saver.mts'

const artifact = {
  fileName: 'results.csv',
  mimeType: 'text/csv',
  data: new Uint8Array([1, 2, 3])
}

test('saves an export through an owner-scoped system dialog', async () => {
  const owner = { name: 'main-window' }
  const dialogCalls = []
  const writes = []
  const saver = new ExportArtifactSaver({
    exportService: {
      writeArtifact: async (...args) => writes.push(args)
    },
    dialog: {
      showSaveDialog: async (...args) => {
        dialogCalls.push(args)
        return { canceled: false, filePath: path.join('output', 'results.csv') }
      }
    },
    getOwnerWindow: () => owner,
    getDocumentsPath: () => path.join('home', 'Documents')
  })

  assert.deepEqual(await saver.save(() => artifact), {
    status: 'saved',
    fileName: 'results.csv'
  })
  assert.equal(dialogCalls[0][0], owner)
  assert.equal(dialogCalls[0][1].defaultPath, path.join('home', 'Documents', 'results.csv'))
  assert.deepEqual(dialogCalls[0][1].filters, [
    { name: 'CSV file', extensions: ['csv'] }
  ])
  assert.deepEqual(writes, [[artifact, path.join('output', 'results.csv')]])
})

test('returns cancellation without writing an export', async () => {
  let writeCount = 0
  const dialogCalls = []
  const saver = new ExportArtifactSaver({
    exportService: {
      writeArtifact: async () => {
        writeCount += 1
      }
    },
    dialog: {
      showSaveDialog: async (...args) => {
        dialogCalls.push(args)
        return { canceled: true }
      }
    },
    getOwnerWindow: () => null,
    getDocumentsPath: () => 'documents'
  })

  assert.deepEqual(await saver.save(() => artifact), { status: 'cancelled' })
  assert.equal(dialogCalls[0].length, 1)
  assert.equal(writeCount, 0)
})

test('maps domain and unexpected export failures to stable results', async () => {
  const failures = []
  const saver = new ExportArtifactSaver({
    exportService: { writeArtifact: async () => {} },
    dialog: { showSaveDialog: async () => ({ canceled: true }) },
    getOwnerWindow: () => null,
    getDocumentsPath: () => 'documents',
    onError: (code, error) => failures.push({ code, error })
  })

  assert.deepEqual(
    await saver.save(() => {
      throw new ExportServiceError('EXPORT_NO_DATA')
    }),
    { status: 'error', error: 'EXPORT_NO_DATA' }
  )
  assert.deepEqual(
    await saver.save(() => {
      throw new Error('unexpected')
    }),
    { status: 'error', error: 'EXPORT_WRITE_FAILED' }
  )
  assert.deepEqual(
    failures.map((failure) => failure.code),
    ['EXPORT_NO_DATA', 'EXPORT_WRITE_FAILED']
  )

  const failingReporter = new ExportArtifactSaver({
    exportService: { writeArtifact: async () => {} },
    dialog: { showSaveDialog: async () => ({ canceled: true }) },
    getOwnerWindow: () => null,
    getDocumentsPath: () => 'documents',
    onError: () => {
      throw new Error('logger unavailable')
    }
  })
  assert.deepEqual(
    await failingReporter.save(() => {
      throw new Error('unexpected')
    }),
    { status: 'error', error: 'EXPORT_WRITE_FAILED' }
  )
})
