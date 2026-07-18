import type { WorkerClient } from '../../worker/worker-client.mjs'

interface PlatformWorkerManagerDependencies {
  createClient: () => WorkerClient
  onEvent: (message: unknown) => void
  onUnavailable: () => void
  isSessionActive: () => boolean
  reconnectSession: () => Promise<unknown>
  log?: (level: 'info' | 'warn' | 'error', message: string) => void
  schedule?: typeof setTimeout
  cancel?: typeof clearTimeout
  maxRestarts?: number
}

export class PlatformWorkerManager {
  constructor(dependencies: PlatformWorkerManagerDependencies)
  start(): Promise<unknown>
  retry(): Promise<{
    status: 'ready' | 'already_ready'
    hello?: unknown
  }>
  request(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<unknown>
  disconnectAll(): Promise<unknown>
  scheduleRestart(): void
  stop(graceMs?: number): Promise<void>
  terminate(): void
}
