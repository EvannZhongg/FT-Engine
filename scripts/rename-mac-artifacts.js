const fs = require('fs')
const path = require('path')

const distDir = path.join(__dirname, '..', 'dist')
if (!fs.existsSync(distDir)) {
  process.exit(0)
}

const pkg = require(path.join(__dirname, '..', 'package.json'))
const productName = (pkg.build && pkg.build.productName) || pkg.productName || 'FT Engine'
const version = pkg.version || '1.0.0'
const basePrefix = `${productName}-${version}`

const suffixMap = {
  arm64: 'mac-M系列芯片',
  x64: 'mac-Intel系列芯片'
}

function renameArtifact(name) {
  if (name.includes('-arm64')) {
    return name.replace(/-arm64(?=\.|-|$)/g, `-${suffixMap.arm64}`)
  }
  if (name.includes('-x64')) {
    return name.replace(/-x64(?=\.|-|$)/g, `-${suffixMap.x64}`)
  }
  if (name === `${basePrefix}.dmg`) {
    return `${basePrefix}-${suffixMap.x64}.dmg`
  }
  if (name === `${basePrefix}.dmg.blockmap`) {
    return `${basePrefix}-${suffixMap.x64}.dmg.blockmap`
  }
  if (name === `${basePrefix}-mac.zip`) {
    return `${basePrefix}-${suffixMap.x64}.zip`
  }
  if (name === `${basePrefix}-mac.zip.blockmap`) {
    return `${basePrefix}-${suffixMap.x64}.zip.blockmap`
  }
  return name
}

for (const name of fs.readdirSync(distDir)) {
  const fullPath = path.join(distDir, name)
  if (!fs.statSync(fullPath).isFile()) continue
  const nextName = renameArtifact(name)
  if (nextName !== name) {
    fs.renameSync(fullPath, path.join(distDir, nextName))
  }
}

const latestMacPath = path.join(distDir, 'latest-mac.yml')
if (fs.existsSync(latestMacPath)) {
  let content = fs.readFileSync(latestMacPath, 'utf8')
  content = content.replace(/-arm64(?=\.|\s|"|$)/g, `-${suffixMap.arm64}`)
  content = content.replace(/-x64(?=\.|\s|"|$)/g, `-${suffixMap.x64}`)
  content = content.split(`${basePrefix}.dmg`).join(`${basePrefix}-${suffixMap.x64}.dmg`)
  content = content.split(`${basePrefix}.dmg.blockmap`).join(`${basePrefix}-${suffixMap.x64}.dmg.blockmap`)
  content = content.split(`${basePrefix}-mac.zip`).join(`${basePrefix}-${suffixMap.x64}.zip`)
  content = content
    .split(`${basePrefix}-mac.zip.blockmap`)
    .join(`${basePrefix}-${suffixMap.x64}.zip.blockmap`)
  fs.writeFileSync(latestMacPath, content)
}
