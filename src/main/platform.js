import fs from 'fs'
import { join } from 'path'

export const isMac = process.platform === 'darwin'
export const isWindows = process.platform === 'win32'

function firstExistingPath(candidates) {
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0]
}

export function getConfigPath(app) {
  if (app.isPackaged) {
    return firstExistingPath([
      join(process.resourcesPath, 'config.yaml'),
      join(process.resourcesPath, 'backend-engine', 'config.yaml'),
      join(process.cwd(), 'config.yaml')
    ])
  }

  return join(process.cwd(), 'config.yaml')
}

function getDevPythonCommand() {
  const cwd = process.cwd()

  if (isWindows) {
    const venvPython = join(cwd, '.venv', 'Scripts', 'python.exe')
    return fs.existsSync(venvPython) ? venvPython : 'python'
  }

  const candidates = isMac
    ? [
        join(cwd, '.venv-mac', 'bin', 'python'),
        join(cwd, '.venv-mac', 'bin', 'python3'),
        join(cwd, '.venv', 'bin', 'python'),
        join(cwd, '.venv', 'bin', 'python3'),
        'python3',
        'python'
      ]
    : [join(cwd, '.venv', 'bin', 'python'), join(cwd, '.venv', 'bin', 'python3'), 'python3', 'python']

  return firstExistingPath(candidates)
}

function getPackagedBackendPath() {
  if (isWindows) {
    return join(process.resourcesPath, 'backend-engine.exe')
  }

  return join(process.resourcesPath, 'backend-engine', 'backend-engine')
}

function getPackagedWorkerPath() {
  if (isWindows) {
    return join(process.resourcesPath, 'local-platform-worker.exe')
  }

  return join(process.resourcesPath, 'local-platform-worker', 'local-platform-worker')
}

export function getBackendLaunchConfig(currentDir, isDev) {
  const script = join(currentDir, '../../server.py')

  if (isDev) {
    return {
      cmd: getDevPythonCommand(),
      args: [script]
    }
  }

  return {
    cmd: getPackagedBackendPath(),
    args: []
  }
}

export function getPlatformWorkerLaunchConfig(isDev) {
  if (isDev) {
    return {
      cmd: getDevPythonCommand(),
      args: ['-m', 'workers.local_platform_worker.ft_worker']
    }
  }

  return {
    cmd: getPackagedWorkerPath(),
    args: []
  }
}

export function getBackendEnv(app) {
  const dataRoot = app.isPackaged ? app.getPath('userData') : process.cwd()
  return {
    ...process.env,
    FT_ENGINE_PLATFORM: process.platform,
    FT_ENGINE_CONFIG_PATH: getConfigPath(app),
    FT_ENGINE_DATA_ROOT: dataRoot,
    FT_ENGINE_SHADOW_EVENTS: '1',
    FT_ENGINE_BLE_HEARTBEAT: isMac ? 'off' : 'auto'
  }
}

export function getDataRoot(app) {
  return app.isPackaged ? app.getPath('userData') : process.cwd()
}
