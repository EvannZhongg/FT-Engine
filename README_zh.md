# FT Engine - 专业电子裁判系统

语言：[English](README.md) | [中文](README_zh.md)

FT Engine 是一套面向竞技比赛的专业电子裁判系统，提供高精度计分、实时可视化与多设备协同能力。系统融合 BLE 计分器硬件接入、实时波形分析、OBS 友好悬浮窗，以及完整的比赛数据管理流程。

## 主要特性
- **多模式**：自由模式 / 赛事模式
- **BLE 硬件**：单机 / 双机计分器接入，低延迟同步
- **实时可视化**：波形组件展示计分趋势
- **直播增强**：透明悬浮窗 Overlay，可叠加 OBS 或游戏画面
- **数据管理**：CSV 原始数据、TXT 日志、SRT 字幕导出
- **国际化**：内置中文、英文、日文

## 开发环境配置
前置依赖：
- Node.js 18+
- Python 3.9+
- 主机需开启蓝牙

以下命令均在 [`FT-Engine/`](./FT-Engine) 目录下执行。

### 1. 安装依赖
```bash
npm install
python -m pip install -r requirements.txt
```

### 2. 开发模式
```bash
npm run dev
```

开发模式下，Electron 会自动从 `server.py` 拉起 Python 后端。

### 3. 仅构建后端
```bash
# 按当前系统自动选择脚本
npm run build:backend

# Windows
npm run build:backend:win

# macOS
npm run build:backend:mac
```

这些命令的作用：
- `build:backend:win`：使用 PyInstaller 生成 `backend-engine.exe`
- `build:backend:mac`：生成 macOS `onedir` 后端目录 `backend-engine/`，并注入蓝牙 entitlement

### 4. 构建应用安装包
```bash
# Windows 安装包
npm run build:win

# macOS DMG
npm run build:mac

# 仅构建解包产物，便于本地检查
npm run build:unpack
```

## 配置与数据
- 运行配置文件：`FT-Engine/config.yaml`
- 开发模式应用设置：`FT-Engine/app_settings.json`
- 开发模式比赛数据：`FT-Engine/match_data/`
- 打包后应用设置与比赛数据：系统用户数据目录

常见的打包后数据路径：
- Windows：`%APPDATA%/FT Engine/`
- macOS：`~/Library/Application Support/FT Engine/`

## 目录结构
```text
FT_Engine/
├── README.md
├── README_zh.md
└── FT-Engine/
    ├── server.py
    ├── config.yaml
    ├── requirements.txt
    ├── package.json
    ├── resources/
    │   ├── icon.png
    │   ├── entitlements.mac.plist
    │   ├── entitlements-backend.plist
    │   └── installer.nsh
    ├── scripts/
    │   ├── build-backend.js
    │   ├── build-backend-win.ps1
    │   ├── build-backend-mac.sh
    │   └── rename-mac-artifacts.js
    ├── src/
    │   ├── main/
    │   │   ├── index.js
    │   │   └── platform.js
    │   ├── preload/
    │   │   └── index.js
    │   └── renderer/
    │       ├── index.html
    │       └── src/
    │           ├── components/
    │           ├── locales/
    │           ├── stores/
    │           ├── App.vue
    │           └── main.js
    └── utils/
        ├── app_settings.py
        ├── exporter.py
        ├── platform.py
        ├── runtime.py
        └── storage.py
```

## 关键共享模块
- `src/main/platform.js`：Electron 主进程的平台启动与后端拉起逻辑
- `server.py`：共享的 FastAPI + BLE 后端
- `utils/platform.py`：按平台控制 BLE 心跳策略
- `utils/runtime.py`：统一解析配置路径与可写数据目录
- `scripts/`：打包阶段使用的辅助脚本，不会作为用户运行时功能直接打入界面

## License
Proprietary / Custom License（如需授权请联系 Freakthrow）。

## Author
Freakthrow Team
