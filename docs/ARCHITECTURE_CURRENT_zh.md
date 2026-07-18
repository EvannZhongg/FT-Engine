# FT Engine 当前架构

> 代码核对日期：2026-07-18。FastAPI 和旧数据兼容层已经删除；本文按当前单一本地主链路记录事实。

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
| 设置和设备备注 | Renderer -> Main -> SQLite | 已切换 |
| 媒体 URL、绑定和播放锚点 | Renderer -> Main -> SQLite/MatchSession | 已切换 |
| 报表、复盘、已计分选手 | Renderer -> Main SQLite Query | 单一路径 |
| 明细 ZIP、日志 CSV、SRT、报表 CSV | Renderer -> Main ExportService -> SQLite snapshot -> 系统保存对话框 | Renderer 不接触导出字节或目标路径 |

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

项目只存在于 SQLite。当前只创建一个默认 `Main` Stage，并继续向 Renderer 返回 `project_name/mode/groups/refCount/players/referees` DTO；目标多阶段模型尚未接入 application service 和 UI。

数据库使用 application ID 和 clean schema v1。检测到旧 schema 时先写入 `backups/`，随后重建空库；不读取或导入旧项目目录、CSV 或旧表。

## 4. 已确认问题

### 高优先级

1. 当前只有单一默认 Stage。多阶段、尝试次数以及 Competition/Stage/MatchSession 状态流转尚未形成完整领域行为。
2. `index.js` 和 `LocalDatabase` 仍聚合多域职责，需要按应用服务和 Repository 拆分。
3. Worker 自动重启耗尽后虽发布错误状态，但没有用户触发的重试命令。
4. 仍需真实 BLE/USB、睡眠恢复、OBS、YouTube 网络和 macOS 签名/权限验收。

### 结构问题

1. Competition、Match、Query、Settings 和 Export IPC 已拆到 `src/main/ipc/`；Worker、设备、窗口和 Overlay 生命周期仍集中在 `src/main/index.js`。
2. SQLite schema 和连接/备份重建已拆到 `persistence/sqlite/`；`LocalDatabase` facade 仍同时包含 Competition、Match、Settings、Replay、Report 和 Export 查询实现。
3. `MatchSessionService` 仍同时负责状态机、设备控制、媒体锚点、事件协调和通知。

## 5. 当前代码集中点

- `src/main/index.js` 约 763 行，混合数据库、Worker、服务组合、设备/平台 IPC 和窗口生命周期。
- `src/main/match/match-session.mts` 约 765 行，混合状态机、设备控制、事件协调、媒体锚点和通知。
- `src/main/persistence/local-database.mts` 约 914 行，混合多个 Repository 和查询投影。
- `src/renderer/src/stores/refereeStore.js` 约 504 行，混合设置、项目、设备、比赛、Overlay、复盘和导出。

下一阶段需要按既有边界拆分，而不是继续向这些集中点追加职责。

## 6. UI 当前差距

- 主窗口固定 `900 x 670`；没有自动最大化或全屏，但没有按显示器工作区计算目标尺寸。
- 顶部导航、深色 Hero、大入口卡片、径向渐变和历史模态框仍与目标桌面工作台不符。
- 没有固定左侧导航和左下用户摘要；主工作区尚未采用受限宽度布局。
- 设置使用全宽下拉，大量流程仍依赖原生 `alert`/`confirm`。

窗口、侧栏、主题和比赛/视频交互以 [桌面 UI 与交互目标](./UI_INTERACTION_SPEC_zh.md) 为准。

## 7. 验证基线

2026-07-18 当前工作树检查：

- `npm test`：56/56 通过。
- `npm run typecheck`：通过。
- `python -m unittest discover -s tests`：17/17 通过，仅包含 Platform Worker。
- `npm run build`、`npm run build:worker:win`、`npm run build:unpack`：通过。
- 解包版进程级检查：SQLite 和 Worker 握手成功，进程树无 TCP 监听；资源目录只有 `local-platform-worker.exe`，没有 backend、server 或端口配置。
- Node 测试覆盖 Competition、计分、干净 Schema 重建、上下文拒绝、导出格式和文件错误映射。

当前结果不代表真实 BLE/USB、OBS、YouTube 网络、macOS 权限/签名或 Windows 安装器已经完成发布验收。
