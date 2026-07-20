import fs from 'fs'
import { join } from 'path'

export const isMac = process.platform === 'darwin'
export const isWindows = process.platform === 'win32'

function firstExistingPath(candidates) {
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0]
}

function getDevPythonCommand() {
  const cwd = process.cwd()
  if (isWindows) {
    const venvPython = join(cwd, '.venv-win', 'Scripts', 'python.exe')
    return fs.existsSync(venvPython) ? venvPython : 'python'
  }
  const candidates = isMac
    ? [
        join(cwd, '.venv-mac', 'bin', 'python'),
        join(cwd, '.venv-mac', 'bin', 'python3'),
        'python3',
        'python'
      ]
    : [
        join(cwd, '.venv', 'bin', 'python'),
        join(cwd, '.venv', 'bin', 'python3'),
        'python3',
        'python'
      ]
  return firstExistingPath(candidates)
}

function getPackagedWorkerPath() {
  return isWindows
    ? join(process.resourcesPath, 'local-platform-worker.exe')
    : join(process.resourcesPath, 'local-platform-worker', 'local-platform-worker')
}

export function getPlatformWorkerLaunchConfig(isDev) {
  return isDev
    ? {
        cmd: getDevPythonCommand(),
        args: ['-m', 'workers.local_platform_worker.ft_worker']
      }
    : { cmd: getPackagedWorkerPath(), args: [] }
}

export function getPlatformWorkerEnv(app) {
  return {
    ...process.env,
    FT_ENGINE_PLATFORM: process.platform,
    FT_ENGINE_DATA_ROOT: getDataRoot(app),
    FT_ENGINE_BLE_HEARTBEAT: isMac ? 'off' : 'auto'
  }
}

export function getDataRoot(app) {
  return app.getPath('userData')
}
