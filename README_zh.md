# FT Engine - 专业电子裁判系统

语言：[English](README.md) | [中文](README_zh.md)

FT Engine 是面向竞技比赛的 Electron 桌面计分应用，支持 BLE/USB 计分器、SINGLE/DUAL 裁判模式、OBS 悬浮窗、YouTube 计分时间轴、历史报表和导出。

## 当前架构状态

项目正在执行路线 B 重构。当前版本已经收敛为单一本地主链路：

- Vue Renderer 的窗口、Overlay、设备、实时比赛和主要历史读取使用受控 IPC。
- Electron Main 中的 `MatchSessionService` 已接入 Platform Worker、TypeScript 计分域和 SQLite 原子实时事件写入，并向计分页持续发布保存、Worker 和媒体状态。
- `CompetitionService` 将项目创建、配置、继续、列表和删除完整保留在 Main/SQLite 内。
- `ExportService` 从 SQLite 只读快照生成报表 CSV 和明细 ZIP/CSV/SRT，再通过 Electron 系统保存对话框写入文件。
- FastAPI、Axios fallback、旧项目 importer、shadow event 和 backend-engine 已删除。旧数据库只备份后重建，不导入旧项目或 CSV。

实际调用链见 [当前架构](docs/ARCHITECTURE_CURRENT_zh.md)，下一步见 [路线 B 剩余重构计划](docs/REFACTOR_PLAN_ROUTE_B_zh.md)。

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

Electron 启动 Platform Worker 和本地 SQLite。开发版 Renderer 由 Vite 提供；应用本身不启动 HTTP/WebSocket 服务。

## 验证

~~~bash
npm test
npm run typecheck
npm run lint
npm run build
python -m unittest discover -s tests
~~~

当前 Node 测试覆盖本地主路径、导出格式、SQLite、IPC/Worker、安全边界和媒体复盘；Python 测试只覆盖 Platform Worker 协议、设备服务和平台适配。

## 构建

~~~bash
# 当前平台的 Platform Worker
npm run build:worker

# 仅生成 Electron 解包目录
npm run build:unpack

# Windows / macOS 安装产物
npm run build:win
npm run build:mac
~~~

安装包只包含 `local-platform-worker` 这一项 Python 产物，通过 JSONL stdio 提供本机能力。

## 数据位置

开发模式和打包版都写入 Electron 用户数据目录。

| 数据 | 说明 |
| --- | --- |
| `ft-engine.db` | 项目、事件、设置和媒体的唯一权威存储 |
| `backups/` | 不兼容 Schema 重建前的只读备份 |
| `exports/` | 用户明确生成的派生文件 |
| `logs/` | 启动和运行日志 |

常见打包后目录：Windows `%APPDATA%/FT Engine/`，macOS `~/Library/Application Support/FT Engine/`。

## 关键目录

~~~text
src/main/
  application/        Competition、Export、Match、Settings 等应用服务
  domain/             TypeScript 计分领域
  persistence/        SQLite Repository 与查询投影
  ipc/                分域输入校验与 IPC 注册
  worker/             WorkerClient
src/preload/          主窗口与 Overlay 的窄化 API
src/shared/           IPC 与领域 DTO 契约
src/renderer/         Vue 界面
workers/local_platform_worker/
                      BLE、USB 和窗口 Worker
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

## License

Proprietary / Custom License（授权请联系 Freakthrow）。

## Author

Freakthrow Team
