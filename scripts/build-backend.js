const { spawnSync } = require('node:child_process')
const path = require('node:path')

const isWindows = process.platform === 'win32'
const command = isWindows ? 'powershell' : 'bash'
const args = isWindows
  ? ['-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'build-backend-win.ps1')]
  : [path.join(__dirname, 'build-backend-mac.sh')]

const result = spawnSync(command, args, {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit'
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
