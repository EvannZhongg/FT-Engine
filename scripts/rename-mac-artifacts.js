/**
 * 将 Mac 打包产物重命名为：产品名-版本号-mac-Intel系列芯片 / 产品名-版本号-mac-M系列芯片
 * - 含 -arm64 的 -> -mac-M系列芯片
 * - 含 -x64 的 -> -mac-Intel系列芯片
 * - 无架构后缀的（x64 默认产物）-> -mac-Intel系列芯片
 */
const fs = require('fs')
const path = require('path')

const distDir = path.join(__dirname, '..', 'dist')
if (!fs.existsSync(distDir)) {
  console.log('scripts/rename-mac-artifacts.js: dist 不存在，跳过重命名')
  process.exit(0)
}

const pkg = require(path.join(__dirname, '..', 'package.json'))
const productName = (pkg.build && pkg.build.productName) || pkg.productName || 'FT Engine'
const version = pkg.version || '1.0.0'
const basePrefix = `${productName}-${version}`

const SUFFIX_M = 'mac-M系列芯片'
const SUFFIX_INTEL = 'mac-Intel系列芯片'

function renameFile(name) {
  let newName = name

  // 1. 含 -arm64 的 -> -mac-M系列芯片
  if (newName.includes('-arm64')) {
    newName = newName.replace(/-arm64(?=\.|-|$)/g, `-${SUFFIX_M}`)
  }
  // 2. 含 -x64 的 -> -mac-Intel系列芯片
  else if (newName.includes('-x64')) {
    newName = newName.replace(/-x64(?=\.|-|$)/g, `-${SUFFIX_INTEL}`)
  }
  // 3. 无架构后缀的 x64 默认产物：如 FT Engine-1.5.0.dmg
  else if (
    (newName.startsWith(basePrefix + '.') || newName.startsWith(basePrefix + '-mac.')) &&
    !newName.includes(SUFFIX_M) &&
    !newName.includes(SUFFIX_INTEL)
  ) {
    if (newName === `${basePrefix}.dmg`) newName = `${basePrefix}-${SUFFIX_INTEL}.dmg`
    else if (newName === `${basePrefix}.dmg.blockmap`) newName = `${basePrefix}-${SUFFIX_INTEL}.dmg.blockmap`
    else if (newName === `${basePrefix}-mac.zip`) newName = `${basePrefix}-${SUFFIX_INTEL}.zip`
    else if (newName === `${basePrefix}-mac.zip.blockmap`) newName = `${basePrefix}-${SUFFIX_INTEL}.zip.blockmap`
  }

  return newName
}

let renamed = 0
for (const name of fs.readdirSync(distDir)) {
  const full = path.join(distDir, name)
  if (!fs.statSync(full).isFile()) continue
  const newName = renameFile(name)
  if (newName !== name) {
    fs.renameSync(full, path.join(distDir, newName))
    console.log('  ' + name + ' -> ' + newName)
    renamed++
  }
}

// 同步更新 latest-mac.yml 中的文件名
const ymlPath = path.join(distDir, 'latest-mac.yml')
if (fs.existsSync(ymlPath)) {
  let yml = fs.readFileSync(ymlPath, 'utf8')
  yml = yml.replace(/-arm64(?=\.|\s|"|$)/g, `-${SUFFIX_M}`)
  yml = yml.replace(/-x64(?=\.|\s|"|$)/g, `-${SUFFIX_INTEL}`)
  yml = yml.split(`${basePrefix}.dmg`).join(`${basePrefix}-${SUFFIX_INTEL}.dmg`)
  yml = yml.split(`${basePrefix}.dmg.blockmap`).join(`${basePrefix}-${SUFFIX_INTEL}.dmg.blockmap`)
  yml = yml.split(`${basePrefix}-mac.zip`).join(`${basePrefix}-${SUFFIX_INTEL}.zip`)
  yml = yml.split(`${basePrefix}-mac.zip.blockmap`).join(`${basePrefix}-${SUFFIX_INTEL}.zip.blockmap`)
  fs.writeFileSync(ymlPath, yml)
  console.log('  已更新 latest-mac.yml 中的文件名')
}

if (renamed > 0) {
  console.log('rename-mac-artifacts: 已重命名 ' + renamed + ' 个文件')
}
