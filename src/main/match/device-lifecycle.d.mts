import type { MatchStopResult } from '../../shared/ipc-contract.ts'

interface DeviceLifecycleDependencies {
  disconnectWorker: () => Promise<unknown>
  onStopped?: (reason: string, result: MatchStopResult) => void
}

export class DeviceLifecycle {
  constructor(dependencies: DeviceLifecycleDependencies)
  stop(reason?: string): Promise<MatchStopResult>
}
