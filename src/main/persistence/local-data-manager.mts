import { existsSync, rmSync } from 'node:fs'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import type { DeleteLocalDataResult } from '../../shared/ipc-contract.ts'
import { LocalDatabase } from './local-database.mts'

export type LocalDataDeleteResult = Omit<DeleteLocalDataResult, 'ok'>

export class LocalDataManager {
  readonly dataRoot: string
  private database: LocalDatabase | null = null

  constructor(dataRoot: string) {
    if (!dataRoot.trim()) throw new Error('LOCAL_DATA_ROOT_INVALID')
    const normalized = resolve(dataRoot)
    if (normalized === parse(normalized).root) throw new Error('LOCAL_DATA_ROOT_INVALID')
    this.dataRoot = normalized
  }

  getDatabase(): LocalDatabase | null {
    return this.database
  }

  requireDatabase(): LocalDatabase {
    if (!this.database) throw new Error('DATABASE_NOT_READY')
    return this.database
  }

  openDatabase(): LocalDatabase {
    if (this.database) return this.database
    const database = new LocalDatabase(
      join(this.dataRoot, 'ft-engine.db'),
      join(this.dataRoot, 'backups')
    )
    database.open()
    this.database = database
    return database
  }

  closeDatabase(): void {
    if (!this.database) return
    this.database.close()
    this.database = null
  }

  dataTargets(): string[] {
    return [
      join(this.dataRoot, 'ft-engine.db'),
      join(this.dataRoot, 'ft-engine.db-shm'),
      join(this.dataRoot, 'ft-engine.db-wal'),
      join(this.dataRoot, 'backups'),
      join(this.dataRoot, 'exports'),
      join(this.dataRoot, 'logs')
    ]
  }

  deleteFiles(): LocalDataDeleteResult {
    if (this.database) throw new Error('DATABASE_STILL_OPEN')
    const deleted: string[] = []
    const failed: Array<{ target: string; message: string }> = []
    for (const target of this.dataTargets()) {
      this.assertManagedTarget(target)
      try {
        if (existsSync(target)) {
          rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 })
        }
        deleted.push(target)
      } catch (error) {
        failed.push({ target, message: errorMessage(error) })
      }
    }
    return { deleted, failed, dataRoot: this.dataRoot }
  }

  private assertManagedTarget(target: string): void {
    const pathFromRoot = relative(this.dataRoot, target)
    if (
      !pathFromRoot ||
      pathFromRoot === '..' ||
      pathFromRoot.startsWith(`..${sep}`) ||
      isAbsolute(pathFromRoot)
    ) {
      throw new Error('LOCAL_DATA_TARGET_INVALID')
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
