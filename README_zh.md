# FT Engine - 专业电子裁判系统

语言：[English](README.md) | [中文](README_zh.md)

FT Engine 是面向竞技比赛的 Electron 桌面计分应用，支持 BLE/USB 计分器、SINGLE/DUAL 裁判模式、OBS 悬浮窗、YouTube 计分时间轴、历史报表和导出。

## 当前架构状态

项目正在执行路线 B 重构。当前版本是可运行的双链路过渡架构：

- Vue Renderer 的窗口、Overlay、设备、实时比赛和主要历史读取使用受控 IPC。
- Electron Main 中的 `MatchSessionService` 已接入 Platform Worker、TypeScript 计分域和 SQLite 原子实时事件写入，并向计分页持续发布保存、Worker 和媒体状态。
- Legacy FastAPI 仍负责项目创建/加载、组别和导出；设置、设备备注、媒体绑定与播放锚点已使用 SQLite/Main IPC；其中硬件、媒体与 WebSocket 路由仍存在，但 Electron 实时计分已无调用点。
- SQLite schema v5 已支持迁移备份、legacy 导入、live-managed 项目、历史读取和实时事件，但新项目仍依赖 legacy 目录作为启动上下文。

实际调用链见 [当前架构](docs/ARCHITECTURE_CURRENT_zh.md)，下一步见 [路线 B 剩余重构计划](docs/REFACTOR_PLAN_ROUTE_B_zh.md)。不要依据目标文档假定 localhost backend 已经移除。

## 主要能力

- 自由模式和赛事模式。
- BLE/USB 单机、双机裁判设备。
- 退出计分或关闭应用时由 Platform Worker 关断 BLE/USB 会话。
- 实时分数、重点扣分、波形和选手切换。
- OBS 友好的透明悬浮窗与窗口定位。
- YouTube 视频计分、播放器时间锚点和视频复盘悬浮分数。
- 历史报表、CSV、SRT 和 ZIP 导出。
- 中文、英文和日文界面。

## 开发环境

前置依赖：

- Node.js 22+。
- Python 3.10+，推荐使用项目 `.venv`。
- 开发真实设备功能时开启系统蓝牙并安装相应 USB 驱动。

安装依赖：

~~~bash
npm install
python -m pip install -r requirements.txt
~~~

启动开发版：

~~~bash
npm run dev
~~~

Electron 会同时启动 legacy backend、Platform Worker 和本地 SQLite。开发版 Renderer 通常位于 `http://localhost:5173`，legacy backend 默认监听 `127.0.0.1:8000`。

## 验证

~~~bash
npm test
npm run typecheck
npm run lint
npm run build
python -m unittest discover -s tests
~~~

其中 Node 测试覆盖计分领域、IPC/Worker、安全边界、SQLite、legacy 导入、报表和复盘；Python 测试覆盖设备协议、设备服务、平台适配、legacy 计分与媒体锚点。

## 构建

~~~bash
# 当前平台的 Python 产物
npm run build:backend

# 仅生成 Electron 解包目录
npm run build:unpack

# Windows / macOS 安装产物
npm run build:win
npm run build:mac
~~~

当前安装包仍包含两个 Python 产物：

- `backend-engine`：过渡期 legacy FastAPI backend。
- `local-platform-worker`：JSONL stdio 本机能力 Worker。

## 数据位置

开发模式默认写入仓库目录，打包后写入 Electron 用户数据目录。

| 数据 | 说明 |
| --- | --- |
| `config.yaml` | legacy backend 端口等运行配置 |
| `app_settings.json` | 仅供 legacy backend 兼容路由使用的旧设置 |
| `match_data/` | 当前 legacy 项目和 CSV 权威数据 |
| `ft-engine.db` | 实时事件与应用设置权威存储；项目数据仍处于导入/影子阶段 |
| `backups/` | SQLite 迁移前备份 |
| `logs/` | 启动和运行日志 |

常见打包后目录：Windows `%APPDATA%/FT Engine/`，macOS `~/Library/Application Support/FT Engine/`。

## 关键目录

~~~text
src/main/
  domain/             TypeScript 计分领域
  persistence/        SQLite、迁移和 legacy importer
  worker/             WorkerClient
  legacy/             影子事件兼容层
src/preload/          主窗口与 Overlay 的窄化 API
src/shared/           IPC 类型契约
src/renderer/         Vue 界面
workers/local_platform_worker/
                      BLE、USB 和窗口 Worker
server.py             过渡期 FastAPI backend
utils/                legacy 存储、导出和媒体模块
tests/                Node 与 Python 回归测试
~~~

## 文档

- [当前架构与已发现问题](docs/ARCHITECTURE_CURRENT_zh.md)
- [目标架构与项目结构](docs/ARCHITECTURE_TARGET_zh.md)
- [路线 B 剩余重构计划](docs/REFACTOR_PLAN_ROUTE_B_zh.md)
- [桌面 UI 与交互目标](docs/UI_INTERACTION_SPEC_zh.md)
- [Django 用户服务目标](docs/BACKEND_DJANGO_zh.md)
- [用户与社区产品边界](docs/COMMUNITY_CONTRACT_AND_UI_SPEC_zh.md)
- [Windows 与 macOS 平台适配规范](docs/PLATFORM_ADAPTATION_zh.md)
- [中文使用说明](Manual_Doc/zh/manual.md)

## License

Proprietary / Custom License（授权请联系 Freakthrow）。

## Author

Freakthrow Team
