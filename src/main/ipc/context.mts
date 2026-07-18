import type { IpcMainInvokeEvent } from 'electron'
import type { LocalDatabase } from '../persistence/local-database.mts'

export interface IpcRegistrationContext {
  assertMainSender: (event: IpcMainInvokeEvent) => void
  getDatabase: () => LocalDatabase | null
}

export function requireDatabase(getDatabase: () => LocalDatabase | null): LocalDatabase {
  const database = getDatabase()
  if (!database) throw new Error('DATABASE_NOT_READY')
  return database
}
