# FT Engine - Professional Electronic Referee System

Language: [English](README.md) | [中文](README_zh.md)

FT Engine is a professional electronic referee system for competitions that require accurate scoring, real-time visualization, and multi-device coordination. It combines BLE clicker hardware, real-time waveform analysis, OBS-friendly overlays, and end-to-end match data management.


## Key Features
- Multi-mode support: Free Mode and Tournament Mode
- BLE device integration (single or dual clicker setup)
- Real-time visualization with waveform widget
- Transparent overlay for OBS or game capture
- Data management: CSV raw data, TXT logs, SRT subtitles
- Built-in i18n (Chinese and English)

## Scoring Rules
- SINGLE: `total = plus - minus`
- DUAL:
  - Plus comes from primary device
  - Minus comes from secondary device
  - Penalty = primary minus + secondary minus

## Project Layout

```text
ft-engine/
├── server.py              # [后端] 程序入口 (FastAPI) - 负责蓝牙交互、WebSocket 推送与业务调度
├── config.yaml            # [配置] 后端配置文件 (定义服务端口等)
├── requirements.txt       # [依赖] Python 后端依赖库
├── package.json           # [构建] Electron/Vue 前端依赖与构建脚本
├── BLE_PROTOCOL.md        # [文档] 蓝牙通信协议规范
├── utils/                 # [后端] 核心工具模块
│   ├── app_settings.py    # 全局设置管理 (单例模式)
│   ├── exporter.py        # 数据导出引擎 (处理 ZIP 打包、生成 SRT 字幕/TXT 日志)
│   └── storage.py         # 存储管理器 (负责 CSV 数据读写、项目与组别结构管理)
├── resources/             # [资源] Electron 应用图标与构建资源
└── src/                   # [前端] Electron 源码目录
    ├── main/              # 主进程 (Main Process)
    │   └── index.js       # 应用生命周期管理、窗口创建、Python 子进程守护
    ├── preload/           # 预加载脚本 (Preload Script)
    │   └── index.js       # 进程间通信桥梁 (IPC)，安全暴露 API 给渲染层
    └── renderer/          # 渲染进程 (Vue 3 + Vite)
        ├── index.html     # Web 页面入口
        └── src/
            ├── assets/      # 静态资源 (全局样式 CSS、图标、SVG 图片)
            ├── components/  # Vue 组件 (包含页面级视图与功能组件)
            │   ├── HomeView.vue     # 主控台界面 (比赛控制核心)
            │   ├── ReportView.vue   # 数据报表界面 (查看历史与导出)
            │   ├── OverlayView.vue  # 直播悬浮窗界面
            │   ├── ScoreBoard.vue   # 通用计分板组件
            │   ├── WaveformWidget.vue # 实时波形图组件
            │   └── ...              # 其他组件 (SetupWizard, NavBar...)
            ├── locales/     # i18n 国际化语言包 (en.json, zh.json)
            ├── stores/      # Pinia 状态管理
            │   └── refereeStore.js  # 核心业务 Store (封装后端 API 调用、同步 WebSocket 状态)
            ├── App.vue      # Vue 根组件
            └── main.js      # Vue 初始化入口
```

## Development Setup
Prerequisites:
- Node.js (v16+ recommended)
- Python 3.9+
- Bluetooth enabled on the host machine

### Backend (Python)
```bash
python -m venv venv
# Windows
.\venv\Scripts\activate
# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt

# Optional: run backend manually
python server.py
# Default: http://127.0.0.1:8000
```

### Frontend (Electron + Vue)
```bash
npm install
npm run dev
```

Note: In dev mode (`is.dev` is true), `src/main/index.js` starts the backend via `python server.py`.

## Documentation
- Backend API: [docs/BACKEND_API.md](docs/BACKEND_API.md)
- BLE Protocol: [docs/BLE_PROTOCOL.md](docs/BLE_PROTOCOL.md)

## License
Proprietary / Custom License (contact Freakthrow for details).

## Author
Freakthrow Team
