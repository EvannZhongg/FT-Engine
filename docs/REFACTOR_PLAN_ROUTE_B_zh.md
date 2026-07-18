# FT Engine 路线 B：剩余重构计划

> 更新基线：2026-07-18。新约束：不兼容任何旧项目、旧 CSV 或 legacy 数据目录。本文只保留剩余工作，已完成历史见 [当前架构](./ARCHITECTURE_CURRENT_zh.md)。

## 1. 当前切换点

实时计分、设备、设置、媒体、项目生命周期、查询和导出已进入 Electron Main/SQLite 单一路径。`CompetitionService` 支持原生项目完成配置和计分；`ExportService` 从同一 SQLite 只读快照生成报表 CSV、明细日志 CSV、SRT 和 ZIP，并通过系统保存对话框写入目标位置。

FastAPI、Renderer Axios fallback、backend 进程管理、旧项目 importer、shadow event、旧 Python 实现和构建资源已删除。干净 schema 不包含 `legacy_imports`、`legacy_ref_count` 或 `source_referee_index`；旧数据库只备份后重建，不迁移数据。Python 测试只保留 Platform Worker，安装包只包含 `local-platform-worker`。

## 2. P0：补齐赛事领域并拆分 Main

1. 将默认 `Main` Stage 扩展为正式 Stage service，支持排序、尝试次数和 Competition/Stage/MatchSession 状态流转。
2. 分域 IPC 注册已拆到 `src/main/ipc/`；继续将 `src/main/index.js` 拆为 bootstrap、窗口、设备/平台和 Overlay 生命周期模块。
3. SQLite schema 与连接/备份重建已拆到 `persistence/sqlite/`；继续将 `LocalDatabase` facade 拆成 Competition/Match/Settings Repository 与 Replay/Report Query。
4. 将 `MatchSessionService` 的设备控制、媒体锚点和状态通知拆为协作者。
5. 移除共享 DTO 中的 `dir_name`、`project_name`、`pri_addr` 等过渡命名，使用稳定领域 ID。

目标目录和依赖方向见 [目标架构](./ARCHITECTURE_TARGET_zh.md)。

## 3. P1：桌面壳层与 Renderer 分域

1. 实现非最大化居中窗口、固定侧栏、受限工作区和 light/dark Token。
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
