# FT Engine macOS 迁移与构建指南

本项目原为 Windows 平台开发，现已支持 macOS。以下是修改内容与构建说明。

## 1. 修改内容概览

### 1.1 `src/main/index.js`
- 修改了 Python 后端进程启动逻辑。
- 只有在 Windows 平台下才寻找 `backend-engine.exe`。
- 在 macOS/Linux 下寻找无后缀的 `backend-engine` 二进制文件。
- 开发环境下 (`is.dev`) 默认使用 `python3` 启动 `server.py`。
- 修改了进程清理逻辑，macOS 使用 `kill()` 而非 `taskkill`。

### 1.2 `package.json`
- 新增 `build.mac` 配置，包含：
  - 权限配置 (`entitlements`)：允许蓝牙访问。
  - 图标配置。
  - `extraResources`：只在 macOS 打包时包含 `backend-engine` (无后缀)，而不包含 `.exe`。
- 新增 `build.dmg` 配置，定制 DMG 安装界面。

### 1.3 依赖与构建脚本
- 新增 `requirements-mac.txt`：移除了 Windows 专用的 `winrt` 库，确保能在 macOS 安装依赖。
- 新增 `resources/entitlements.mac.plist`：声明蓝牙权限。
- 新增 `build-backend-mac.sh`：一键编译 macOS 版 Python 后端的脚本。

---

## 2. 构建步骤

### 第一步：编译 Python 后端
在项目根目录运行以下命令，生成 macOS 可执行文件 `backend-engine`。

```bash
./build-backend-mac.sh
```

> **注意**：首次运行可能需要安装 Python 依赖，脚本会自动执行。确保你已安装 Python 3.9+。

### 第二步：打包 Electron 应用
确保前端依赖已安装，然后运行打包命令：

```bash
npm install
npm run build:mac
```

构建完成后，DMG 安装包将位于 `dist/` 目录下。

## 3. 注意事项

1. **蓝牙权限**：
   macOS 在首次运行应用并尝试扫描蓝牙时，会弹窗请求蓝牙权限，确授允许。

2. **辅助功能权限 (Accessibility)**：
   如果应用使用了窗口追踪功能 (Overlay)，需要在「系统设置 -> 隐私与安全性 -> 辅助功能」中授予 FT Engine 权限，否则无法获取其他窗口位置。

3. **签名与公证**：
   目前的构建配置未包含 Apple 开发者证书签名。生成的应用仅供本地测试或分发给已设置“允许任何来源”的用户。如果要正式分发，需要配置 `electron-builder` 的签名参数。
