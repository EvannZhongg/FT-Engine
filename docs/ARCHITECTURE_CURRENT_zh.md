# FT Engine 当前架构

> 代码核对日期：2026-07-19。FastAPI 和旧数据兼容层已经删除；本文按当前单一本地主链路记录事实。

## 1. 运行拓扑

~~~text
Vue Renderer
  └─ typed IPC ─ Electron Main
                   ├─ CompetitionService / MatchSessionService / ExportService
                   ├─ TypeScript scoring domain
                   ├─ node:sqlite / ft-engine.db (clean schema v3)
                   ├─ Python Platform Worker (JSONL stdio)
                   └─ Window / Overlay / Shortcut / Update
~~~

Electron 只启动 Platform Worker；本地数据库运行在 Main 内。应用不启动 HTTP/WebSocket 服务，也不打包 backend-engine。

`MatchSessionService` 负责比赛状态机、上下文转换和计分事件持久化时序；`MatchDeviceSession` 独立持有比赛设备连接与 Worker 控制协议，`MatchMediaSession` 负责媒体生命周期，`MatchSessionNotifier` 隔离所有 Renderer 状态通知与错误回调。

## 2. 当前能力边界

| 能力 | 当前主路径 | 状态 |
| --- | --- | --- |
| 窗口、快捷键、Overlay | Renderer -> IPC -> Main | 已切换 |
| 窗口枚举和 BLE/USB 全生命周期 | Main -> Platform Worker | 已切换，支持有界自动重启与手动恢复 |
| 实时比赛状态与计分 | Renderer -> MatchSession -> MatchDeviceSession/TS domain | 单一路径 |
| 实时事件持久化 | MatchSession -> SQLite | 原子写入成功后才发布分数 |
| MatchSession 激活、切换、完成和作废 | MatchSession -> MatchProgressRepository -> SQLite | 原子状态转换并追加审计 |
| 新建、更新、继续、列表、删除项目 | Renderer -> CompetitionService -> SQLite | 单一路径 |
| Stage 配置、排序、尝试次数和状态 | Renderer -> typed IPC -> StageService -> SQLite | 已接入配置和运行选择 |
| 设置和设备备注 | Renderer -> Main -> SQLite | 已切换 |
| 媒体 URL、绑定和播放锚点 | Renderer -> Main -> MatchMediaSession/SQLite | 已切换并拆出协作者 |
| 报表、复盘、已计分选手 | Renderer -> Main SQLite Query | 单一路径 |
| 明细 ZIP、日志 CSV、SRT、报表 CSV | Renderer -> Main ExportService -> SQLite snapshot -> 系统保存对话框 | Renderer 不接触导出字节或目标路径 |

## 3. 原生项目数据流

~~~text
Renderer projects.create/update
  -> CompetitionService validation
  -> SQLite Competition + initial Main Stage
  -> StageService create/update/reorder + groups/contestants/attempt sessions
  -> MatchSessionService.start(sourceKey = competition UUID, stageId, attemptNumber)
  -> SQLite activate MatchSession + Stage + Competition
  -> Worker device.counter
  -> SQLite atomic score event
  -> complete current + activate next / finish / invalidate
  -> report/replay SQLite query
~~~

项目只存在于 SQLite。创建项目时仍生成一个初始 `Main` Stage；StageService 已支持配置、多 Stage 新建/删除/排序、1～20 次尝试以及 draft/active/completed 状态。Renderer 设置向导已按“赛事 -> Stage/组别 -> 设备”组织，可为每个 Stage 独立编辑组别、排序并选择运行 attempt。实时比赛、媒体绑定、会话转换、计分事件和已完成选手查询都显式携带 `stageId`，同名组别和选手不会跨 Stage 串联。Competition DTO 已统一为 `id/name/createdAt`，设备绑定统一为 `primaryDeviceId/secondaryDeviceId`，生产源码不再包含 `dir_name/project_name/source_key/pri_addr/sec_addr`。

数据库使用 application ID 和 clean schema v3；Competition、Stage、Contestant 和 MatchSession 状态受 CHECK 约束，`match_session_transitions` 追加保存 start/context_switch/finish/invalidate 审计。检测到旧 schema 时先写入 `backups/`，随后重建空库；不读取或导入旧项目目录、CSV 或旧表。

### 3.1 自由模式与赛事模式

当前数据库对两种模式使用同一套关系图，这是正确的存储方向，但 Renderer 的入口还没有体现模式差异。

| 模式 | 当前实际结构 | 应保留的用户路径 |
| --- | --- | --- |
| `FREE` | `competition -> Main stage -> group -> contestant -> match_session(attempt=1)`；创建时可生成 `Free Mode`、`Player 1` 和配置的裁判 | 项目名称、裁判数量、设备绑定、计分 |
| `TOURNAMENT` | 显式 Stage、组别、选手、裁判、设备绑定和 `1..20` 次尝试 | 项目名称、Stage/组别/选手配置、设备绑定、计分 |

自由模式不需要 Stage、组别、选手名单或尝试次数选择器；`attempt_number` 仍在数据库中固定写入 `1`，以便复盘、报表和导出继续复用同一路径。赛事模式才向用户展示并编辑 `stages.attempts`。这保留了旧仓库“统一配置和事件读取”的优点，同时去除自由模式的配置负担。

旧仓库的运行时形态是 `match_data/<时间_项目名>/config.json`，组目录下按 `选手名_RefN.csv` 保存裁判事件；`config.json` 还保存模式、组别、裁判设备地址和媒体绑定。这些目录名、JSON 和 CSV 只用于对照，不属于新项目运行时存储。新数据库不提供旧字段别名或导入兼容层。

## 4. 已确认问题

### 高优先级

1. 自由模式快速入口和赛事模式配置入口已分开；自由模式不显示 Stage/组别/attempt 选择。
2. 赛事配置、复盘和设备绑定页面已统一使用 Workbench Token，生产样式不再保留旧黑色硬编码颜色。
3. 扫描链路已在 Main IPC 归一化为 clone-safe `devices/errors` DTO；Worker 异常映射为稳定 `code/message/retryable`，Renderer 不显示原始异常文本。仍需真实 BLE 扫描验证该边界。
4. 仍需真实 BLE/USB、睡眠恢复、OBS、YouTube 网络和 macOS 签名/权限验收。

### 结构状态

1. `index.js` 已收缩为 4 行入口；`bootstrap.mts` 只装配依赖、启动本地资源并注册生命周期/IPC。本地数据库与清理、启动日志、导出对话框和应用命令时序均有独立协作者。
2. 设备控制、媒体生命周期和状态通知已分别拆到 `MatchDeviceSession`、`MatchMediaSession` 和 `MatchSessionNotifier`；`MatchSessionService` 保留状态机与计分事件协调。
3. Platform Worker 自动重启三次耗尽后可通过 typed IPC 手动重试；重试会重置预算、合并并发请求，并在活动比赛中复用现有 Worker 执行设备重连。

## 5. 当前代码集中点

- `src/main/index.js` 4 行，只调用 `bootstrapDesktopApp`；`src/main/app/bootstrap.mts` 约 283 行，只保留依赖装配、资源启动和注册。
- `src/main/match/match-session.mts` 约 696 行，保留状态机、上下文转换和计分事件持久化时序；设备、媒体与通知均已拆出。
- `src/main/persistence/local-database.mts` 约 183 行，只保留连接生命周期和 repository/query 委托。
- Renderer 状态已拆到 `competitionStore.js`、`matchStore.js`、`deviceStore.js`、`settingsStore.js` 和 `replayStore.js`；旧 `refereeStore.js` 已删除。

Renderer 已进入 Vue Router 桌面壳层和分域 Store；下一阶段不应重新引入聚合 Store，而应继续收敛各页面的共享 Token、对话框和紧凑计分展示模型。

## 6. UI 当前状态与差距

- 主窗口按显示器工作区计算约 72.5% x 77.5% 的居中普通窗口，并优先保持约 16:10 和至少 24px 工作区边距。
- 主窗口已有固定左侧导航、左下本地用户摘要、顶部赛事/保存/设备上下文和受限工作区；工作台不再使用 Hero、大入口卡片、径向渐变或历史模态框。
- Vue Router 提供工作台、赛事、配置、现场计分、复盘、报表和设置路由；设置页使用主题分段控制、OBS 开关、快捷键输入和应用内删除确认。
- 默认浅色壳层和中性深色主题已使用语义 Token；现场计分、赛事配置、报表、复盘和设备绑定均接入共享 Workbench Token，状态色和控件交互不再依赖页面级旧色值。
- 复盘工作区和紧凑计分展示已开始使用共享 Workbench/Score Token；`RefereeScoreDisplay` 同时服务现场播放器、复盘和 OBS Overlay 的 TOTAL/SPLIT/COMBINED 模式，Overlay 只单独保留 REALTIME 连击与布局编辑。
- 原生 `alert`/`confirm` 已从 Renderer 生产源码删除；持续错误使用状态条/行内错误，删除使用支持焦点循环和 Esc 的应用内 Dialog。
- `DialogShell` 集中提供 Teleport、ARIA、焦点循环/恢复、Esc 和遮罩策略；App 确认框、现场计分决策、报表导出/高级设置以及赛事向导的导入/设备/连接弹窗不再各自实现遮罩与键盘行为。

窗口、侧栏、主题和比赛/视频交互以 [桌面 UI 与交互目标](./UI_INTERACTION_SPEC_zh.md) 为准。

## 7. 验证基线

2026-07-19 当前工作树检查：

- `npm test`：122/122 通过。
- `npm run typecheck`：通过，覆盖全部 Main `.mts` 模块。
- `npm run lint`：0 error；历史换行和格式 warning 尚未批量清理。
- `python -m unittest discover -s tests`：17/17 通过，仅包含 Platform Worker。
- `npm run build`：通过；本阶段未重复执行 Worker 与安装包构建。
- Windows 实机 Platform Worker 检查：`system.hello`、BLE 扫描、BLE 连接、reset、断开和 `system.shutdown` 均成功；扫描返回普通 JSON DTO，设备状态和 counter 事件可正常回传。
- 解包版进程级检查：SQLite 和 Worker 握手成功，进程树无 TCP 监听；资源目录只有 `local-platform-worker.exe`，没有 backend、server 或端口配置。
- Node 测试覆盖 Competition/Stage/attempt、自由模式 SQLite 全链路 graph、会话转换回滚与审计、计分、干净 Schema 重建、上下文拒绝、导出格式、文件错误映射、扫描 DTO 序列化、Router 壳层、Renderer Store 分域边界和共享计分展示模型；尚缺真实 BLE 扫描序列和赛事/复盘关键交互的浏览器自动化覆盖。
- 1366x768 的工作台/赛事/向导/现场计分/复盘、1920x1080 的设置/报表、2560x1440 的工作台以及系统 DPI 下的实际 Electron 主窗口已完成截图检查；应用内 Browser 不可用时使用本机 Chromium 和 Electron `PrintWindow` 复核。

当前结果不代表真实 BLE/USB、扫描异常恢复、OBS、YouTube 网络、macOS 权限/签名或 Windows 安装器已经完成发布验收；自由模式和扫描 DTO 已有代码级回归证据。
