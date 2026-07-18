# FT Engine 路线 B：剩余重构计划

> 更新基线：2026-07-18，包含显式 `MatchSession` 状态机、原子事件持久化、实时状态 IPC 和 legacy 实时传输关闭。本文只维护剩余工作，不重复已完成历史。

当前运行事实见 [当前架构](./ARCHITECTURE_CURRENT_zh.md)，最终边界和目录见 [目标架构](./ARCHITECTURE_TARGET_zh.md)。UI 与用户服务分别见 [UI 交互规范](./UI_INTERACTION_SPEC_zh.md) 和 [Django 用户服务](./BACKEND_DJANGO_zh.md)。

## 1. 当前切换点

实时比赛已经进入 Electron Main 主路径：Renderer 通过 typed IPC 启动 `MatchSessionService`，Platform Worker 连接设备并发送事件，TypeScript 计分域聚合分数，事件直接写入 SQLite。

但这还不是完整切换：项目创建、继续项目、组别配置和导出仍依赖 FastAPI 与 JSON/CSV。设置、设备备注、媒体 URL 规范化、媒体绑定和播放锚点已迁入 Main/SQLite typed IPC。Renderer 已不再创建 localhost WebSocket，实时比赛也不再调用 legacy setup/reset/teardown/context/playback/media 接口。Electron 启动时仍同时启动 FastAPI、Platform Worker 和 SQLite。

## 2. P0：稳定实时比赛切换

代码级切换已完成：上下文创建与事件追加使用一个 SQLite 事务；内存分数只在插入成功后更新；Worker 事件入口封闭非法 payload、领域和数据库异常；状态机覆盖 `idle/starting/active/stopping/completed/failed`；保存、Worker 和媒体状态通过 IPC 常驻显示；活动比赛只走 Main/Worker，不再走 legacy HTTP/WebSocket。

自动测试已覆盖启动失败、切换选手期间事件归属、Worker 重连失败、SQLite 写入失败、重复事件和启停竞争。静态边界测试禁止 Renderer 重新引入 `/setup`、`/reset`、`/teardown`、`/api/match/set_context`、legacy playback sync 或 WebSocket。

P0 剩余发布门槛：

1. 在真实 Electron 中开始比赛后停止 FastAPI，完成计分、切换选手、Reset、结束和 SQLite 复盘查询。
2. 使用真实 Worker 子进程执行崩溃与有限重启验收，确认状态条和手动恢复路径。
3. 注入真实 SQLite I/O 故障，确认现场分数保持最后持久化值，并验证恢复后的继续计分策略。

## 3. P1：项目与本地服务迁入 Main

1. 在 SQLite 中直接创建和更新 Competition、Stage、Group、Contestant、Referee、MatchSession，不再要求先创建 legacy 目录再导入。
2. 设置、设备备注、媒体绑定与播放锚点已迁入 Main/SQLite；YouTube URL 规范化已收口为共享实现并由契约测试覆盖。
3. 将历史项目“继续”改为读取 SQLite 领域对象，不再通过 `/api/project/load` 修改 Python 全局活动项目。
4. 将导出拆成 Main application service，通过系统保存对话框写入 `exports/`；CSV/SRT/ZIP 是派生产物，不是数据库主存储。
5. 增加迁移结果页面：显示失败项目、原因、源目录、重试和只读打开操作。

完成门槛：Renderer 不再导入 Axios、不创建 localhost WebSocket，本地赛事功能只依赖 IPC。

## 4. P2：收口组合根并移除 Legacy Backend

在 FastAPI 仍存在期间，先按 [目标架构](./ARCHITECTURE_TARGET_zh.md) 将 `server.py` 降为薄组合根。不要继续往该文件增加设备、存储或导出逻辑。

当 P0、P1 门槛满足后：

1. 停止启动和打包 `server.py`/backend-engine。
2. 删除 Python 中重复的 Scanner、BLE/USB DeviceNode、HeadlessReferee 和实时 WebSocket。
3. 删除 shadow stdout 事件协议、legacy 双关断协调和相应构建资源。
4. 保留一次性 legacy importer，直到支持窗口结束；它只能读旧项目，不得成为新项目运行依赖。

## 5. 测试和冗余代码清理

本轮只记录清理判定，不删除测试。

| 对象 | 当前判定 | 删除条件 |
| --- | --- | --- |
| `test_scoring_baseline.py` 中计分聚合与 Reset | 过渡期兼容基线 | FastAPI 不再拥有实时计分后，由 `scoring-domain`、`match-session` 和 Worker 测试替代 |
| `test_scoring_parity.py` | 暂时保留 | legacy `HeadlessReferee` 删除时一并删除；共享 fixture 继续由 TS 测试使用 |
| `test_score_snapshot.py` | 暂时保留 | SQLite 事务集成测试覆盖快速事件和上下文切换后删除 |
| baseline 中 BLE/USB 重连测试 | 应迁移而非直接删除 | 在 Platform Worker 设备服务测试补齐取消重连后，删除 server 版本 |
| `legacy-shadow-event.test.mjs` 与 `src/main/legacy/shadow-event.mts` | 兼容层 | FastAPI shadow stdout 停止后删除 |
| `device-lifecycle.test.mjs` | 已改为单 Worker 生命周期测试 | Platform Worker 生命周期迁入 application service 后随模块移动 |
| `test_media.py`、`test_storage.py` | 仍有效 | URL/旧 CSV 兼容迁入新模块后迁移用例，不能直接删除 |
| legacy importer 与测试 | 发布期兼容能力 | 旧项目支持窗口结束且迁移工具独立归档后删除 |

禁止以“Node 已有同名测试”为理由直接删除 Python 用例。删除必须同时满足：对应 Python 生产路径不可达、新主路径有等价或更强覆盖、打包配置不再包含该生产模块。

## 6. P3：桌面壳层与交互重构

1. 先实现非最大化居中窗口、固定侧栏、受限工作区和主题 Token。
2. 引入 Vue Router 和分域 Store，移除 `App.vue` 手写 `currentView` 与单一 `refereeStore`。
3. 将历史赛事从首页模态框改成可筛选页面，将设置从全宽下拉改成独立页面或侧边抽屉。
4. 按赛事配置、现场计分、复盘三个连续工作流重排控件；详细规则见 [UI 交互规范](./UI_INTERACTION_SPEC_zh.md)。
5. Overlay 使用独立透明壳层，不继承主窗口背景、圆角和侧栏。

## 7. P4：独立用户服务

本地链路稳定后再接入 `services/community`。第一期采用 Django + PostgreSQL，桌面端通过 Electron Main Gateway 调用；服务不可用不得阻断本地赛事。具体契约见 [Django 用户服务](./BACKEND_DJANGO_zh.md)。

## 8. 每阶段验证

~~~bash
npm test
npm run typecheck
npm run lint
npm run build
python -m unittest discover -s tests
~~~

删除 Legacy Backend 前还需要 Windows/macOS 实机验证 BLE、USB、睡眠恢复、OBS Overlay、YouTube 嵌入、导出和打包安装。PostgreSQL 或社区服务不可用不属于本地比赛失败条件。
