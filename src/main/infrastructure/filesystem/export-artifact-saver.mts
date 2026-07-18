import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { BrowserWindow, Dialog, SaveDialogOptions } from 'electron'
import type { ExportSaveResult } from '../../../shared/contracts/export.mts'
import {
  ExportServiceError,
  type ExportArtifact,
  type ExportFileWriter,
  type ExportService
} from '../../application/exports/export-service.mts'

interface ExportArtifactSaverDependencies {
  exportService: ExportService
  dialog: Pick<Dialog, 'showSaveDialog'>
  getOwnerWindow: () => BrowserWindow | null
  getDocumentsPath: () => string
  onError?: (code: string, error: unknown) => void
}

export const nodeExportFileWriter: ExportFileWriter = {
  write: (outputPath, data) => writeFile(outputPath, data)
}

export class ExportArtifactSaver {
  private readonly dependencies: ExportArtifactSaverDependencies

  constructor(dependencies: ExportArtifactSaverDependencies) {
    this.dependencies = dependencies
  }

  async save(buildArtifact: () => ExportArtifact): Promise<ExportSaveResult> {
    try {
      const artifact = buildArtifact()
      const options = this.dialogOptions(artifact)
      const owner = this.dependencies.getOwnerWindow()
      const selection = owner
        ? await this.dependencies.dialog.showSaveDialog(owner, options)
        : await this.dependencies.dialog.showSaveDialog(options)
      if (selection.canceled || !selection.filePath) return { status: 'cancelled' }
      await this.dependencies.exportService.writeArtifact(artifact, selection.filePath)
      return { status: 'saved', fileName: basename(selection.filePath) }
    } catch (error) {
      const code = error instanceof ExportServiceError ? error.code : 'EXPORT_WRITE_FAILED'
      try {
        this.dependencies.onError?.(code, error)
      } catch {
        // Error reporting cannot replace the stable export result.
      }
      return { status: 'error', error: code }
    }
  }

  private dialogOptions(artifact: ExportArtifact): SaveDialogOptions {
    const isArchive = artifact.mimeType === 'application/zip'
    return {
      title: 'Save export',
      defaultPath: join(this.dependencies.getDocumentsPath(), artifact.fileName),
      filters: [
        {
          name: isArchive ? 'ZIP archive' : 'CSV file',
          extensions: [isArchive ? 'zip' : 'csv']
        }
      ]
    }
  }
}
