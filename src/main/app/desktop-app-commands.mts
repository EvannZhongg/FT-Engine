import type { LocalDataDeleteResult } from '../persistence/local-data-manager.mts'

interface DesktopAppCommandDependencies {
  stopDeviceSessions: (reason: string) => Promise<unknown>
  stopWorker: () => Promise<void>
  closeDatabase: () => void
  closeLog: () => Promise<void>
  deleteLocalDataFiles: () => LocalDataDeleteResult
  quitAndInstall: () => void
  relaunchProcess: () => void
  exitProcess: (code: number) => void
}

export class DesktopAppCommands {
  private readonly dependencies: DesktopAppCommandDependencies

  constructor(dependencies: DesktopAppCommandDependencies) {
    this.dependencies = dependencies
  }

  async deleteLocalData(): Promise<LocalDataDeleteResult> {
    await this.dependencies.stopDeviceSessions('delete-local-data')
    await this.dependencies.stopWorker()
    this.dependencies.closeDatabase()
    await this.dependencies.closeLog()
    return this.dependencies.deleteLocalDataFiles()
  }

  async restartForUpdate(): Promise<void> {
    await this.dependencies.stopDeviceSessions('restart-for-update')
    await this.dependencies.stopWorker()
    this.dependencies.closeDatabase()
    await this.dependencies.closeLog()
    this.dependencies.quitAndInstall()
  }

  relaunch(): void {
    this.dependencies.relaunchProcess()
    this.dependencies.exitProcess(0)
  }
}
