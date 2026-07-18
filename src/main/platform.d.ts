import type { App } from 'electron'

export const isMac: boolean
export const isWindows: boolean

export function getPlatformWorkerLaunchConfig(isDevelopment: boolean): {
  cmd: string
  args: string[]
}

export function getPlatformWorkerEnv(app: App): NodeJS.ProcessEnv
export function getDataRoot(app: App): string
