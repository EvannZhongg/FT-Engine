const path = require('node:path')
const { signAsync } = require('@electron/osx-sign')

const appPath = path.resolve(process.argv[2] || '')
if (!process.argv[2] || !appPath.endsWith('.app')) {
  throw new Error('A macOS .app path is required')
}

const mainEntitlements = path.resolve('resources/entitlements.mac.adhoc.plist')
const workerEntitlements = path.resolve('resources/entitlements-worker.adhoc.plist')

signAsync({
  app: appPath,
  identity: '-',
  identityValidation: false,
  platform: 'darwin',
  type: 'development',
  preAutoEntitlements: false,
  optionsForFile(filePath) {
    if (filePath === appPath || filePath.endsWith('.app')) {
      return { entitlements: mainEntitlements, hardenedRuntime: true }
    }
    if (filePath.endsWith('/Resources/local-platform-worker/local-platform-worker')) {
      return { entitlements: workerEntitlements, hardenedRuntime: true }
    }
    return null
  }
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
