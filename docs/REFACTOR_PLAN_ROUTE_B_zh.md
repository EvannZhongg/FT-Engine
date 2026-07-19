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

StageService/Repository 已支持 graph 配置、排序、1～20 次尝试以及 draft/active/completed 转换；Renderer 已接入多 Stage/attempt 配置与运行选择，计分输入显式携带 stageId 和 attemptNumber。MatchProgressRepository 在事务内完成 start、当前完成+下一激活、finish 和 invalidate，并向不可变转换表追加审计。Schema 已切换为 clean v3，不迁移旧数据。

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

剩余：

1. 将仍使用中性深色局部样式的赛事向导、现场计分、报表和复盘逐步切换为共享语义 Token，减少组件内硬编码颜色。
2. 统一 OBS Overlay、现场播放器旁和复盘播放器旁的紧凑计分展示模型，在保留 Overlay 布局编辑能力的同时复用同一只读计分组件。
3. 补充可自动执行的 Renderer 交互测试，并完成 1366x768、1920x1080、2560x1440、双显示器缩放与真实窗口控制验收。

详细规范见 [桌面 UI 与交互目标](./UI_INTERACTION_SPEC_zh.md)。

## 4. P2：独立用户服务

本地主链路稳定后再接入 Django + PostgreSQL。Electron Main 通过 Gateway 调用，服务不可用不得阻断本地赛事。见 [Django 用户服务](./BACKEND_DJANGO_zh.md)。

## 5. 验证

~~~bash
npm test
npm run typecheck
npm run lint
npm run build
python -m unittest discover -s tests
~~~

Python 测试只发现 Platform Worker 相关用例。发布前还需在 Windows/macOS 实机验证 BLE、USB、睡眠恢复、OBS Overlay、YouTube、原生导出和安装包。
