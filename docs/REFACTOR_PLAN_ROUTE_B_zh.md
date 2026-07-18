# FT Engine 路线 B：剩余重构计划

> 更新基线：2026-07-19。新约束：不兼容任何旧项目、旧 CSV 或 legacy 数据目录。本文只保留剩余工作，已完成历史见 [当前架构](./ARCHITECTURE_CURRENT_zh.md)。

## 1. 当前切换点

实时计分、设备、设置、媒体、项目生命周期、查询和导出已进入 Electron Main/SQLite 单一路径。`CompetitionService` 支持原生项目完成配置和计分；`ExportService` 从同一 SQLite 只读快照生成报表 CSV、明细日志 CSV、SRT 和 ZIP，并通过系统保存对话框写入目标位置。

FastAPI、Renderer Axios fallback、backend 进程管理、旧项目 importer、shadow event、旧 Python 实现和构建资源已删除。干净 schema 不包含 `legacy_imports`、`legacy_ref_count` 或 `source_referee_index`；旧数据库只备份后重建，不迁移数据。Python 测试只保留 Platform Worker，安装包只包含 `local-platform-worker`。

SQLite schema 与连接生命周期已经独立；Competition/Match Repository 和 Replay/Report/Export Query 已从 `LocalDatabase` 拆出，facade 只保留连接生命周期和稳定方法委托。

主窗口与 Overlay 生命周期已进入 `DesktopWindowManager`，对应 IPC 已独立注册；主窗口启动尺寸按显示器工作区居中计算，不再固定为 `900 x 670`。

Platform Worker 的握手、事件转发、停止和有界自动重启已进入 `PlatformWorkerManager`；设备与窗口跟踪 IPC 也已从组合根拆出。

App/Shortcut IPC、更新通知以及 activate/will-quit/window-all-closed 生命周期已拆出，`index.js` 不再直接注册 IPC 或 Electron 生命周期事件。

StageService/Repository 已支持 graph 配置、排序、1～20 次尝试以及 draft/active/completed 转换；计分输入显式携带 attemptNumber。MatchProgressRepository 在事务内完成 start、当前完成+下一激活、finish 和 invalidate，并向不可变转换表追加审计。Schema 已切换为 clean v3，不迁移旧数据。

Competition 和设备绑定共享 DTO 已改用稳定 camelCase 字段与领域 ID；`dir_name/project_name/source_key/pri_addr/sec_addr` 已从生产源码删除，不提供兼容别名。

## 2. P0：补齐赛事领域并拆分 Main

1. Stage、attempt 和 MatchSession 状态事务已在 Main 实现；继续接入 Renderer 多 Stage/attempt 配置选择与作废入口。
2. 所有 IPC、窗口/Overlay、Worker、更新和应用生命周期已拆出；继续将 `src/main/index.js` 中的数据库/服务装配、本地文件操作和导出对话框收敛到 bootstrap 与明确协作者。
3. 将 `MatchSessionService` 的设备控制、媒体锚点和状态通知拆为协作者。

目标目录和依赖方向见 [目标架构](./ARCHITECTURE_TARGET_zh.md)。

## 3. P1：桌面壳层与 Renderer 分域

1. 非最大化居中窗口已实现；继续实现固定侧栏、受限工作区和 light/dark Token。
2. 引入 Vue Router 和分域 Store，移除手写 `currentView` 与单一 `refereeStore`。
3. 将历史赛事改为页面，设置改为独立页面，用应用内 Dialog/状态条替代原生弹窗。
4. 保持现场播放器旁、视频悬浮模式和复盘中的悬浮计分组件一致。
5. Overlay 保持独立透明壳层，不继承主窗口背景和侧栏。

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
