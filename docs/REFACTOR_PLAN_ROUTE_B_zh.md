# FT Engine 路线 B：剩余重构计划

> 更新基线：2026-07-19。新约束：不兼容任何旧项目、旧 CSV 或 legacy 数据目录。本文只保留剩余工作，已完成历史见 [当前架构](./ARCHITECTURE_CURRENT_zh.md)。

## 1. 当前切换点

实时计分、设备、设置、媒体、项目生命周期、查询和导出已进入 Electron Main/SQLite 单一路径。`CompetitionService` 支持原生项目完成配置和计分；`ExportService` 从同一 SQLite 只读快照生成报表 CSV、明细日志 CSV、SRT 和 ZIP，并通过系统保存对话框写入目标位置。

FastAPI、Renderer Axios fallback、backend 进程管理、旧项目 importer、shadow event、旧 Python 实现和构建资源已删除。干净 schema 不包含 `legacy_imports`、`legacy_ref_count` 或 `source_referee_index`；旧数据库只备份后重建，不迁移数据。Python 测试只保留 Platform Worker，安装包只包含 `local-platform-worker`。

SQLite schema 与连接生命周期已经独立；Competition/Match Repository 和 Replay/Report/Export Query 已从 `LocalDatabase` 拆出，facade 只保留连接生命周期和稳定方法委托。

主窗口与 Overlay 生命周期已进入 `DesktopWindowManager`，对应 IPC 已独立注册；主窗口启动尺寸按显示器工作区居中计算，不再固定为 `900 x 670`。

Platform Worker 的握手、事件转发、停止和有界自动重启已进入 `PlatformWorkerManager`；自动预算耗尽后可从设备设置页或活动计分页手动恢复，重试会合并并发请求，并在比赛活动时重新连接原设备。设备与窗口跟踪 IPC 也已从组合根拆出。

App/Shortcut IPC、更新通知以及 activate/will-quit/window-all-closed 生命周期已拆出，`index.js` 不再直接注册 IPC 或 Electron 生命周期事件。

`index.js` 已收缩为只调用 `bootstrapDesktopApp` 的 4 行入口。`bootstrap.mts` 只负责依赖装配、资源启动和注册；`LocalDataManager`、`StartupLog`、`ExportArtifactSaver` 与 `DesktopAppCommands` 分别承接数据库/清理、启动日志、系统保存对话框和应用命令时序。

StageService/Repository 已支持 graph 配置、排序、1～20 次尝试以及 draft/active/completed 转换；Renderer 已接入多 Stage/attempt 配置与运行选择，计分输入显式携带 stageId 和 attemptNumber。该能力只应对赛事模式完整开放；自由模式需要在 Renderer 侧走快速入口，并由 Main 固定生成 `attemptNumber = 1` 的统一上下文。MatchProgressRepository 在事务内完成 start、当前完成+下一激活、finish 和 invalidate，并向不可变转换表追加审计。Schema 已切换为 clean v3，不迁移旧数据。

现场计分页已提供保存结束与二次确认作废入口。设备连接与 Worker 控制协议、媒体生命周期、Renderer 状态通知已分别从 `MatchSessionService` 拆到 `MatchDeviceSession`、`MatchMediaSession` 和 `MatchSessionNotifier`。

Competition 和设备绑定共享 DTO 已改用稳定 camelCase 字段与领域 ID；`dir_name/project_name/source_key/pri_addr/sec_addr` 已从生产源码删除，不提供兼容别名。

## 2. P0：已完成

Main 组合根、赛事领域、MatchSession 协作者和 Platform Worker 手动恢复链路均已完成。后续工作进入 Renderer 分域和桌面壳层，不再向 Main P0 扩展职责。

目标目录和依赖方向见 [目标架构](./ARCHITECTURE_TARGET_zh.md)。

## 3. P1：桌面壳层与 Renderer 分域

已完成：

1. 主窗口采用固定侧栏、顶部上下文栏和 `max-width: 1240px` 受限工作区；浅色/中性深色语义 Token 已接入并持久化主题设置。
2. Vue Router 已承接工作台、赛事、配置、现场计分、复盘、报表和设置；手写 `currentView` 已删除，报表与复盘上下文通过 route params/query 恢复。
3. 单一 `refereeStore` 已删除，状态拆到 Competition、Match、Device、Settings 和 Replay/Export Store；复杂页面只组合所需分域。
4. 历史赛事已从模态框改为工作台/赛事页面表格，设置已成为独立页面；更新完成、删除确认、导入和导出反馈不再使用原生 `alert`/`confirm`。
5. Overlay 继续直接渲染独立透明根节点，不进入 Router、侧栏、主题背景或主窗口壳层。
6. 现场播放器旁、复盘播放器旁和 OBS Overlay 的 TOTAL/SPLIT/COMBINED 模式共用 `RefereeScoreDisplay` 与纯 `scoreDisplay` 模型；罚分、缩放边界和颜色语义只有一处实现。
7. 现场计分、报表和部分复盘结构已切换到共享 Workbench Token；赛事配置和复盘仍有旧黑色 UI、局部背景和控件级硬编码颜色，需要继续迁移。
8. `DialogShell` 统一 Teleport、ARIA、焦点循环/恢复、Esc 和遮罩关闭策略；应用确认框、现场计分的六类决策弹窗、报表导出/高级设置以及赛事向导的导入/设备/连接弹窗均已接入。

剩余工作按以下顺序执行：

1. **已完成：自由模式快速路径**：自由模式只收集项目名称和裁判数量，自动建立 `Main/Free Mode/Player 1` 上下文，直接进入设备绑定；前端不展示 Stage、组别、选手名单和尝试次数。`stageDrafts.mjs` 与 Renderer 回归测试锁定该 graph。
2. **已完成：赛事/复盘 UI 统一**：赛事配置、复盘和设备绑定页面已统一 Workbench Token、状态色、Dialog、焦点和响应式约束；Overlay 继续保持独立透明窗口。
3. **已完成代码边界：BLE 扫描错误**：`device-scan-dto.mts` 在 Main IPC 归一化 Worker 返回值和异常，保证 Renderer 只接收 JSON 可序列化 DTO，并映射稳定错误码、消息和重试标志；仍需真实设备验收。
4. **已完成代码验证：存储一致性**：自由模式 SQLite fixture 已覆盖创建、设备绑定、计分、完成、复盘、报表和导出查询；自由模式的会话始终为 `attemptNumber = 1`。后续仍需在实际应用流程中验收同一结果。
5. **自动化与实机验收**：补充 Renderer 交互测试、Worker 协议测试，并完成 1366x768、1920x1080、2560x1440、双显示器缩放、Windows BLE/USB 和 macOS 权限验收。

每项工作的完成标准是：行为在对应文档中有唯一描述、存在自动化或实机验证证据、失败时不破坏本地工作台和复盘。

详细规范见 [桌面 UI 与交互目标](./UI_INTERACTION_SPEC_zh.md)。

## 4. P2：独立用户服务

本地主链路稳定后再接入 Django + PostgreSQL。Electron Main 通过 Gateway 调用，服务不可用不得阻断本地赛事。见 [Django 用户服务](./BACKEND_DJANGO_zh.md)。

## 5. 本阶段验证矩阵

| 场景 | 必须验证的结果 |
| --- | --- |
| 自由模式创建 | 项目名称 + 裁判数量后直接进入设备绑定，隐式 attempt 固定为 1 |
| 赛事模式创建 | Stage/组别/选手/裁判/attempt 配置可保存、恢复和运行 |
| 复盘与报表 | 两种模式均从 SQLite 查询，不读取旧目录或 CSV |
| 设备扫描失败 | 显示稳定错误码、本地化提示和重试，不泄露不可克隆对象或原始异常实例 |
| UI 响应式 | 赛事、复盘、计分和设备绑定在目标分辨率下无溢出、重叠和黑色旧页面残留 |

## 6. 验证命令

~~~bash
npm test
npm run typecheck
npm run lint
npm run build
python -m unittest discover -s tests
~~~

Python 测试目前只发现 Platform Worker 相关用例；完成本阶段后还需在 Windows/macOS 实机验证 BLE、USB、睡眠恢复、扫描异常恢复、OBS Overlay、YouTube、原生导出和安装包。
