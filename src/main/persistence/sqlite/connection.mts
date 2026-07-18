import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DATABASE_APPLICATION_ID, LATEST_SCHEMA_VERSION, SCHEMA_SQL } from './schema.mts'

export class SqliteConnection {
  readonly databasePath: string
  readonly backupRoot: string
  private database: DatabaseSync | null = null

  constructor(databasePath: string, backupRoot: string) {
    this.databasePath = path.resolve(databasePath)
    this.backupRoot = path.resolve(backupRoot)
  }

  open(): void {
    if (this.database) return
    mkdirSync(path.dirname(this.databasePath), { recursive: true })
    mkdirSync(this.backupRoot, { recursive: true })
    let initialize = !existsSync(this.databasePath) || statSync(this.databasePath).size === 0

    if (!initialize) {
      const metadata = this.readMetadata()
      if (
        metadata?.applicationId === DATABASE_APPLICATION_ID &&
        metadata.version > LATEST_SCHEMA_VERSION
      ) {
        throw new Error(`Database schema ${metadata.version} is newer than this application`)
      }
      if (
        !metadata ||
        metadata.applicationId !== DATABASE_APPLICATION_ID ||
        metadata.version !== LATEST_SCHEMA_VERSION
      ) {
        this.createResetBackup(metadata?.version ?? 0)
        this.removeDatabaseFiles()
        initialize = true
      }
    }

    const database = new DatabaseSync(this.databasePath)
    this.database = database
    try {
      database.exec(
        'PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;'
      )
      if (initialize) database.exec(SCHEMA_SQL)
    } catch (error) {
      database.close()
      this.database = null
      throw error
    }
  }

  close(): void {
    if (!this.database) return
    this.database.close()
    this.database = null
  }

  requireDatabase(): DatabaseSync {
    if (!this.database) throw new Error('Local database is not open')
    return this.database
  }

  getSchemaVersion(): number {
    const row = this.requireDatabase().prepare('PRAGMA user_version').get() as {
      user_version: number
    }
    return Number(row.user_version)
  }

  getApplicationId(): number {
    const row = this.requireDatabase().prepare('PRAGMA application_id').get() as {
      application_id: number
    }
    return Number(row.application_id)
  }

  listTableNames(): string[] {
    const rows = this.requireDatabase()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as Array<{ name: string }>
    return rows.map((row) => row.name)
  }

  private readMetadata(): { applicationId: number; version: number } | null {
    try {
      const probe = new DatabaseSync(this.databasePath, { readOnly: true })
      try {
        const application = probe.prepare('PRAGMA application_id').get() as {
          application_id: number
        }
        const version = probe.prepare('PRAGMA user_version').get() as { user_version: number }
        return {
          applicationId: Number(application.application_id),
          version: Number(version.user_version)
        }
      } finally {
        probe.close()
      }
    } catch {
      return null
    }
  }

  private createResetBackup(currentVersion: number): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = path.join(
      this.backupRoot,
      `ft-engine-reset-v${currentVersion}-${timestamp}.db`
    )
    copyFileSync(this.databasePath, backupPath)
    return backupPath
  }

  private removeDatabaseFiles(): void {
    for (const target of [
      this.databasePath,
      `${this.databasePath}-shm`,
      `${this.databasePath}-wal`
    ]) {
      if (existsSync(target)) rmSync(target, { force: true })
    }
  }
}
