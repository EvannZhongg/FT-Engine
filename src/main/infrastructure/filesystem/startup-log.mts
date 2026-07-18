import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'

interface StartupLogDependencies {
  now?: () => Date
  elapsedNow?: () => number
  reportError?: (operation: 'init' | 'write' | 'close', error: unknown) => void
}

export class StartupLog {
  private readonly dataRoot: string
  private readonly dependencies: StartupLogDependencies
  private stream: WriteStream | null = null
  private startedAt = 0

  constructor(dataRoot: string, dependencies: StartupLogDependencies = {}) {
    this.dataRoot = dataRoot
    this.dependencies = dependencies
  }

  init(): void {
    if (this.stream) return
    try {
      const logDirectory = join(this.dataRoot, 'logs')
      mkdirSync(logDirectory, { recursive: true })
      const logPath = join(logDirectory, 'startup.log')
      const stream = createWriteStream(logPath, { flags: 'a' })
      stream.on('error', (error) => this.reportError('write', error))
      this.stream = stream
      this.startedAt = this.elapsedNow()
      stream.write(`\n========== ${this.now().toISOString()} ==========\n`)
      stream.write(`Log file: ${logPath}\n`)
    } catch (error) {
      this.reportError('init', error)
    }
  }

  write(message: string): void {
    if (!this.stream) return
    try {
      const elapsed = this.elapsedNow() - this.startedAt
      this.stream.write(`T+${elapsed}ms    ${message}\n`)
    } catch (error) {
      this.reportError('write', error)
    }
  }

  async close(): Promise<void> {
    const stream = this.stream
    this.stream = null
    if (!stream) return
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        stream.off('error', finish)
        resolve()
      }
      stream.once('error', finish)
      try {
        stream.end(finish)
      } catch (error) {
        this.reportError('close', error)
        finish()
      }
    })
  }

  private now(): Date {
    return (this.dependencies.now ?? (() => new Date()))()
  }

  private elapsedNow(): number {
    return (this.dependencies.elapsedNow ?? (() => Date.now()))()
  }

  private reportError(operation: 'init' | 'write' | 'close', error: unknown): void {
    this.dependencies.reportError?.(operation, error)
  }
}
