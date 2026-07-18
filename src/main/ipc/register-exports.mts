import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-contract'
import type { ExportSaveResult } from '../../shared/contracts/export.mts'
import type { ExportArtifact, ExportService } from '../application/exports/export-service.mts'
import type { IpcRegistrationContext } from './context.mts'

export function registerExportIpc(
  context: IpcRegistrationContext,
  exportService: ExportService,
  saveArtifact: (buildArtifact: () => ExportArtifact) => Promise<ExportSaveResult>
): void {
  ipcMain.handle(IPC_CHANNELS.exports.saveDetails, (event, request) => {
    context.assertMainSender(event)
    return saveArtifact(() => exportService.buildDetails(request))
  })

  ipcMain.handle(IPC_CHANNELS.exports.saveReport, (event, request) => {
    context.assertMainSender(event)
    return saveArtifact(() => exportService.buildReport(request))
  })
}
