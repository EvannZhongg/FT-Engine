# FT Engine 当前架构

> 代码核对日期：2026-07-18。本文描述当前工作树事实，包括尚未提交的实时比赛切换代码；它不是目标设计。

## 1. 运行拓扑

~~~text
Vue Renderer
  ├─ typed IPC ─ Electron Main
  │                ├─ MatchSessionService + TypeScript scoring domain
  │                ├─ node:sqlite / ft-engine.db (schema v5)
  │                ├─ Python Platform Worker (JSONL stdio)
  │                └─ Window / Overlay / Shortcut / Update
  │
  └─ Axios ─ Legacy FastAPI backend
             ├─ project/config JSON and CSV compatibility
             ├─ report and export compatibility
             └─ dormant legacy hardware/scoring/media routes
~~~

Electron 仍同时启动三个运行单元：`server.py`、Platform Worker 和 Electron Main 内 SQLite。当前不能把 FastAPI 或 legacy 文件存储描述为已经移除。

## 2. 已落地边界

| 能力 | 当前主路径 | 状态 |
| --- | --- | --- |
| 窗口、快捷键、Overlay | Renderer -> IPC -> Main | 已切换 |
| 窗口枚举和边界 | Main -> Platform Worker | 已切换 |
| BLE/USB 扫描和重命名 | Main -> Platform Worker | 已切换 |
| 实时设备连接、Reset、计数事件 | Renderer -> Main MatchSession -> Worker | 已切换；不再调用 legacy 实时 HTTP/WebSocket |
| 分数聚合 | TypeScript 纯领域函数 | 已接管 Electron 实时路径 |
| 实时事件写入 | MatchSession -> SQLite | 上下文创建和事件写入在单个 `BEGIN IMMEDIATE` 事务内完成 |
| 历史列表、报表、复盘、删除 | SQLite IPC 优先，REST 回退 | 过渡期主路径 |
| legacy 项目导入 | JSON/CSV -> SQLite | 已实现幂等导入和 live-managed 保护 |
| 项目创建、组别编辑、继续项目 | Renderer -> FastAPI | 未切换 |
| 设置和设备备注 | Renderer -> Main -> SQLite `app_settings` | 已切换；输入使用固定键和有界值校验 |
| 媒体绑定 | Renderer -> Main shared normalizer -> SQLite | 已切换；不再写 legacy JSON |
| 播放锚点 | Renderer -> Main MatchSession | 已切换；legacy playback 路由无调用点 |
| 导出 | FastAPI + legacy ExportManager | 未切换 |

## 3. 实时比赛实际数据流

新建或继续项目仍先由 FastAPI 生成/加载 legacy 配置，并把 `source_key` 交给 Renderer。开始比赛时：

~~~text
Renderer startMatch
  -> Main importLegacyProject(source_key)
  -> MatchSessionService.start
  -> Worker device.connectMany
  -> SQLite markLegacyProjectLive
  -> Worker device.counter event
  -> TypeScript scoring domain
  -> SQLite ensure context + score_events (single transaction)
  -> IPC refereeUpdated -> Renderer/Overlay
~~~

Electron 实时路径中的活动设备只由 Worker 持有。生产代码仍保留 legacy 设备/计分路由，但 Renderer 已无调用点，也不再创建 localhost WebSocket。项目源目录缺失或 SQLite/Worker 未就绪仍会阻止新 MatchSession 启动。

## 4. 当前代码集中点

- `server.py` 约 1363 行，同时包含 Scanner、BLE/USB 节点、计分聚合、WebSocket、项目、媒体和导出路由。
- `src/main/index.js` 约 983 行，同时承担进程启动、数据库导入、Worker 监管、MatchSession 组合、全部 IPC 和窗口生命周期。
- `src/main/match/match-session.mts` 约 742 行，已经集中状态机、控制并发、事件持久化协调、媒体锚点和通知逻辑，需要在 P1 前继续按职责拆分。
- `src/main/persistence/local-database.mts` 约 1422 行，混合 migration、legacy 导入写入、实时仓储和多种查询投影；新增设置规则已放入独立 application 模块，后续仓储仍需分域。
- `src/renderer/src/stores/refereeStore.js` 约 573 行，混合设置、项目、设备、比赛、Overlay、复盘和导出，并同时维护 IPC 与 REST。
- `App.vue` 使用手写 `currentView`；主窗口与 Overlay 通过 query 参数共享入口。

下一阶段不能只拆 `server.py`；Main 组合根和 Renderer Store 也已达到需要分域的规模。

## 5. 已发现问题

### 高优先级

1. P0 的进程级验收尚未执行：仍需在真实 Electron 中启动比赛后停止 FastAPI，验证计分、切换、Reset、结束和 SQLite 查询完整可用。
2. `setContext` 已把 Worker Reset 与内存上下文切换串行化，但完成旧 MatchSession、创建下一 MatchSession 和审计记录尚未形成数据库事务。
3. 实时错误状态目前只在内存和 Renderer 状态条中保留；应用重启后的失败原因和恢复动作尚未持久化。
4. Worker 自动重启有次数上限，耗尽后的状态可见但缺少用户触发的重试命令。

### 中优先级

1. 实时路径仍以导入 legacy 目录作为创建 SQLite 上下文的前置条件，新数据库尚不能独立创建比赛。
2. 导入错误和迁移失败仍主要写日志，缺少用户可操作的迁移结果页面。
3. Main 的 `index.js`、`MatchSessionService`、`LocalDatabase` 和 Renderer Store 已成为新的集中式文件，继续追加职责会重复 `server.py` 的问题。

## 6. UI 当前差距

- 主窗口固定 `900 x 670`，没有按显示器工作区计算；当前未发现启动自动最大化或全屏调用。
- 主窗口为无边框、可缩放且有阴影，但启动尺寸和深色背景不符合新的桌面壳层目标。
- 顶部 `NavBar` 承担品牌、设置和窗口控制；没有固定左侧导航和底部用户摘要。
- 首页使用深色 Hero、渐变标题和三张大卡片；历史赛事藏在模态框，不适合高频扫描和继续操作。
- 全局 CSS 包含径向渐变、模板残留样式和多种高饱和动作色，尚无统一 light/dark 语义 Token。
- 大量操作使用 `alert`/`confirm`，错误状态难以持续查看，键盘焦点和可访问性不可控。

## 7. 当前验证基线

2026-07-18 本地检查结果：

- `npm test`：51/51 通过。
- `npm run typecheck`：通过。
- `python -m unittest discover -s tests`：36/36 通过。
- Docker 中存在 `pgvector-db`，镜像 `pgvector/pgvector:pg16`，宿主端口 `5433` 映射容器 `5432`。

这些结果证明单元级基线可用，不代表 Electron 实机、打包版、真实 BLE/USB、OBS 或 YouTube 网络场景已经验收。
