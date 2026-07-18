# FT Engine 当前架构

> 代码核对日期：2026-07-18。本文包含当前工作树中尚未提交的 `CompetitionService`。目标已明确不兼容任何旧项目或旧数据格式，但此处仍按实际代码记录尚未删除的 legacy 路径。

## 1. 运行拓扑

~~~text
Vue Renderer
  ├─ typed IPC ─ Electron Main
  │                ├─ CompetitionService / MatchSessionService
  │                ├─ TypeScript scoring domain
  │                ├─ node:sqlite / ft-engine.db (schema v5)
  │                ├─ Python Platform Worker (JSONL stdio)
  │                └─ Window / Overlay / Shortcut / Update
  │
  └─ Axios ─ Legacy FastAPI backend
             ├─ CSV/SRT/ZIP export
             ├─ report/replay/status fallback
             └─ dormant project/hardware/scoring/media routes
~~~

Electron 仍同时启动 `server.py`、Platform Worker 和 Electron Main 内 SQLite。FastAPI 已退出项目与实时比赛主路径，但尚未停止启动和打包。

## 2. 当前能力边界

| 能力 | 当前主路径 | 状态 |
| --- | --- | --- |
| 窗口、快捷键、Overlay | Renderer -> IPC -> Main | 已切换 |
| 窗口枚举和 BLE/USB 全生命周期 | Main -> Platform Worker | 已切换 |
| 实时比赛状态与计分 | Renderer -> MatchSession -> Worker/TS domain | 已切换，不调用 legacy 实时传输 |
| 实时事件持久化 | MatchSession -> SQLite | 原子写入成功后才发布分数 |
| 新建、更新、继续、列表、删除项目 | Renderer -> CompetitionService -> SQLite | 当前工作树已接入；新项目不创建 legacy 目录 |
| 设置和设备备注 | Renderer -> Main -> SQLite | 已切换 |
| 媒体 URL、绑定和播放锚点 | Renderer -> Main -> SQLite/MatchSession | 已切换 |
| 报表、复盘、已计分选手 | SQLite IPC 优先，REST fallback | SQLite 查询可读原生项目，fallback 尚未删除 |
| 导出 | Renderer -> FastAPI -> legacy CSV ExportManager | 未切换，也是 backend 当前主要运行依赖 |
| 旧项目导入和 shadow event | legacy 文件/stdout -> SQLite | 代码仍存在，但新目标中应直接删除 |

## 3. 原生项目数据流

~~~text
Renderer projects.create/update
  -> CompetitionService validation
  -> SQLite Competition + default Main Stage + groups/contestants/referees/sessions
  -> MatchSessionService.start(source_key = competition UUID)
  -> Worker device.counter
  -> SQLite atomic score event
  -> report/replay SQLite query
~~~

原生项目不依赖 `match_data/<dir>/config.json`。当前只创建一个默认 `Main` Stage，并继续向 Renderer 返回旧式 `project_name/mode/groups/refCount/players/referees` DTO；目标多阶段模型尚未接入 application service 和 UI。

## 4. 已确认问题

### 高优先级

1. 原生项目没有 legacy `current_project_path` 或计分 CSV，而当前导出只读取该路径；因此新项目 CSV/SRT/ZIP 导出没有有效数据源。移除 backend 前必须先实现 SQLite `ExportService`。
2. 当前只有单一默认 Stage。多阶段、尝试次数以及 Competition/Stage/MatchSession 状态流转尚未形成完整领域行为。
3. P0 仍缺真实 Electron 验收：需要在比赛开始后停止 FastAPI，验证计分、切换、Reset、停止、报表和复盘不受影响。
4. Worker 自动重启耗尽后虽发布错误状态，但没有用户触发的重试命令。

### 结构问题

1. 报表、复盘和状态查询仍使用 `getLegacy*`/`listLegacy*` 命名并保留 Axios fallback，和“不兼容旧数据”的新方向冲突。
2. `CompetitionService` 已建立 application 边界，但 IPC 注册继续集中在 `src/main/index.js`，Repository 实现继续集中在 `LocalDatabase`。
3. Main 仍启动、等待、监控和打包 FastAPI，还解析已无主路径事件来源的 backend stdout。
4. `server.py`、`utils/storage.py`、`utils/media.py` 和 Python legacy 测试构成一整套重复运行实现；既然不要求旧数据兼容，不应继续拆分维护。

## 5. 当前代码集中点

- `server.py` 约 1363 行，混合 Scanner、设备节点、计分、WebSocket、项目、媒体和导出。
- `src/main/index.js` 约 1052 行，混合进程、数据库、Worker、服务组合、全部 IPC 和窗口生命周期。
- `src/main/match/match-session.mts` 约 742 行，混合状态机、设备控制、事件协调、媒体锚点和通知。
- `src/main/persistence/local-database.mts` 约 1835 行，混合 migration、原生 Competition、legacy import、实时仓储和查询投影。
- `src/renderer/src/stores/refereeStore.js` 约 559 行，混合设置、项目、设备、比赛、Overlay、复盘和导出。

后续不能只删除 `server.py`；还要同步移除 Main legacy 进程管理/importer、Renderer fallback、旧 Schema 字段和构建资源。

## 6. UI 当前差距

- 主窗口固定 `900 x 670`；没有自动最大化或全屏，但没有按显示器工作区计算目标尺寸。
- 顶部导航、深色 Hero、大入口卡片、径向渐变和历史模态框仍与目标桌面工作台不符。
- 没有固定左侧导航和左下用户摘要；主工作区尚未采用受限宽度布局。
- 设置使用全宽下拉，大量流程仍依赖原生 `alert`/`confirm`。

窗口、侧栏、主题和比赛/视频交互以 [桌面 UI 与交互目标](./UI_INTERACTION_SPEC_zh.md) 为准。

## 7. 验证基线

2026-07-18 当前工作树检查：

- `npm test`：55/55 通过。
- `npm run typecheck`：通过。
- `python -m unittest discover -s tests`：36/36 通过。
- Node 测试已覆盖原生 Competition 创建、更新、计分、结构锁定和删除。

Python 36 项主要验证准备删除的 legacy 实现，不能再作为目标架构的验收规模。当前结果也不代表 Electron、打包版、真实 BLE/USB、OBS、YouTube 网络状态或原生项目导出已经通过。
