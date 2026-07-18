import { EventEmitter } from 'node:events'
import type { spawn } from 'node:child_process'

interface WorkerClientOptions {
  command: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  requestTimeoutMs?: number
  spawnProcess?: typeof spawn
}

export const WORKER_PROTOCOL_VERSION: number

export class WorkerClientError extends Error {
  readonly code: string
  constructor(code: string, message: string)
}

export class WorkerClient extends EventEmitter {
  constructor(options: WorkerClientOptions)
  start(): Promise<void>
  request(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<unknown>
  stop(timeoutMs?: number): Promise<void>
  terminate(): void
}
