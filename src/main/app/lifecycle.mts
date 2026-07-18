import type { App } from 'electron'

interface AppLifecycleDependencies {
  isMac: boolean
  hasMainWindow: () => boolean
  createMainWindow: () => void
  unregisterShortcuts: () => void
  closeDatabase: () => void
  terminateWorker: () => void
  stopWorker: () => Promise<void>
}

export function registerAppLifecycle(app: App, dependencies: AppLifecycleDependencies): void {
  app.on('activate', () => {
    if (!dependencies.hasMainWindow()) dependencies.createMainWindow()
  })

  app.on('will-quit', () => {
    dependencies.unregisterShortcuts()
    dependencies.closeDatabase()
    dependencies.terminateWorker()
  })

  app.on('window-all-closed', async () => {
    if (dependencies.isMac) return
    await dependencies.stopWorker()
    dependencies.closeDatabase()
    app.quit()
  })
}
