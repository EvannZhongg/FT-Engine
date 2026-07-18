# FT Engine 当前架构

> 代码核对日期：2026-07-19。FastAPI 和旧数据兼容层已经删除；本文按当前单一本地主链路记录事实。

## 1. 运行拓扑

~~~text
Vue Renderer
  └─ typed IPC ─ Electron Main
                   ├─ CompetitionService / MatchSessionService / ExportService
                   ├─ TypeScript scoring domain
                   ├─ node:sqlite / ft-engine.db (clean schema v1)
                   ├─ Python Platform Worker (JSONL stdio)
                   └─ Window / Overlay / Shortcut / Update
~~~

Electron 只启动 Platform Worker；本地数据库运行在 Main 内。应用不启动 HTTP/WebSocket 服务，也不打包 backend-engine。

## 2. 当前能力边界

| 能力 | 当前主路径 | 状态 |
| --- | --- | --- |
| 窗口、快捷键、Overlay | Renderer -> IPC -> Main | 已切换 |
| 窗口枚举和 BLE/USB 全生命周期 | Main -> Platform Worker | 已切换 |
| 实时比赛状态与计分 | Renderer -> MatchSession -> Worker/TS domain | 单一路径 |
| 实时事件持久化 | MatchSession -> SQLite | 原子写入成功后才发布分数 |
| 新建、更新、继续、列表、删除项目 | Renderer -> CompetitionService -> SQLite | 单一路径 |
| Stage 配置、排序、尝试次数和状态 | typed IPC -> StageService -> SQLite | Main 已实现，Renderer 尚未接入 |
| 设置和设备备注 | Renderer -> Main -> SQLite | 已切换 |
| 媒体 URL、绑定和播放锚点 | Renderer -> Main -> SQLite/MatchSession | 已切换 |
| 报表、复盘、已计分选手 | Renderer -> Main SQLite Query | 单一路径 |
| 明细 ZIP、日志 CSV、SRT、报表 CSV | Renderer -> Main ExportService -> SQLite snapshot -> 系统保存对话框 | Renderer 不接触导出字节或目标路径 |

## 3. 原生项目数据流

~~~text
Renderer projects.create/update
  -> CompetitionService validation
  -> SQLite Competition + initial Main Stage
  -> StageService create/update/reorder + groups/contestants/attempt sessions
  -> MatchSessionService.start(source_key = competition UUID, attemptNumber)
  -> Worker device.counter
  -> SQLite atomic score event
  -> report/replay SQLite query
~~~

项目只存在于 SQLite。创建项目时仍生成一个初始 `Main` Stage；StageService 已支持配置、多 Stage 新建/删除/排序、1～20 次尝试以及 draft/active/completed 状态，typed IPC 和 preload 已开放对应能力。当前 Renderer 仍只编辑和运行排序第一的 Stage，并继续使用 `project_name/mode/groups/refCount/players/referees` 过渡 DTO，多 Stage UI 尚未接入。

数据库使用 application ID 和 clean schema v2；Competition、Stage、Contestant 和 MatchSession 状态受 CHECK 约束。检测到旧 schema 时先写入 `backups/`，随后重建空库；不读取或导入旧项目目录、CSV 或旧表。

## 4. 已确认问题

### 高优先级

1. Stage 后端与 attempt 计分已实现；Renderer 多 Stage 配置/选择、MatchSession 完成/作废，以及“完成并下一位”的原子事务尚未接入。
2. `index.js` 仍聚合数据库/服务组装、本地数据清理、导出对话框和启动日志，需要继续收缩为 bootstrap。
3. Worker 自动重启耗尽后虽发布错误状态，但没有用户触发的重试命令。
4. 仍需真实 BLE/USB、睡眠恢复、OBS、YouTube 网络和 macOS 签名/权限验收。

### 结构问题

1. 所有现有 IPC 已拆到 `src/main/ipc/`；窗口、Worker、更新通知和 Electron 生命周期也已进入独立模块。
2. `MatchSessionService` 仍同时负责状态机、设备控制、媒体锚点、事件协调和通知。

## 5. 当前代码集中点

- `src/main/index.js` 约 353 行，仍混合数据库/服务组装、本地数据清理、导出对话框和启动日志。
- `src/main/match/match-session.mts` 约 719 行，混合状态机、设备控制、事件协调、媒体锚点和通知。
- `src/main/persistence/local-database.mts` 约 161 行，只保留连接生命周期和 repository/query 委托。
- `src/renderer/src/stores/refereeStore.js` 约 466 行，混合设置、项目、设备、比赛、Overlay、复盘和导出。

下一阶段需要继续拆分 `index.js`、`MatchSessionService` 和 Renderer Store，而不是向这些集中点追加职责。

## 6. UI 当前差距

- 主窗口已按显示器工作区计算约 72.5% x 77.5% 的居中普通窗口，并优先保持约 16:10 和至少 24px 工作区边距。
- 顶部导航、深色 Hero、大入口卡片、径向渐变和历史模态框仍与目标桌面工作台不符。
- 没有固定左侧导航和左下用户摘要；主工作区尚未采用受限宽度布局。
- 设置使用全宽下拉，大量流程仍依赖原生 `alert`/`confirm`。

窗口、侧栏、主题和比赛/视频交互以 [桌面 UI 与交互目标](./UI_INTERACTION_SPEC_zh.md) 为准。

## 7. 验证基线

2026-07-19 当前工作树检查：

- `npm test`：80/80 通过。
- `npm run typecheck`：通过，覆盖全部 Main `.mts` 模块。
- `npm run lint`：0 error；历史换行和格式 warning 尚未批量清理。
- `python -m unittest discover -s tests`：17/17 通过，仅包含 Platform Worker。
- `npm run build`、`npm run build:worker:win`、`npm run build:unpack`：通过。
- 解包版进程级检查：SQLite 和 Worker 握手成功，进程树无 TCP 监听；资源目录只有 `local-platform-worker.exe`，没有 backend、server 或端口配置。
- Node 测试覆盖 Competition、计分、干净 Schema 重建、上下文拒绝、导出格式和文件错误映射。

当前结果不代表真实 BLE/USB、OBS、YouTube 网络、macOS 权限/签名或 Windows 安装器已经完成发布验收。
