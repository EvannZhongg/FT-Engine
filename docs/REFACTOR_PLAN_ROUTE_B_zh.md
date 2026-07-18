# FT Engine 路线 B：剩余重构计划

> 更新基线：2026-07-18。新约束：不兼容任何旧项目、旧 CSV 或 legacy 数据目录。本文只保留剩余工作，已完成历史见 [当前架构](./ARCHITECTURE_CURRENT_zh.md)。

## 1. 当前切换点

实时计分、设备、设置、媒体和项目生命周期已进入 Electron Main/SQLite 主路径。当前工作树的 `CompetitionService` 支持原生 SQLite 项目完成配置和计分。

FastAPI 当前实际必要职责只剩 legacy CSV/SRT/ZIP 导出；其他 REST fallback、旧项目 importer、shadow event 和 Python 设备/计分实现均不再具有产品兼容价值，可以按依赖顺序删除。

## 2. P0：先补齐原生导出

1. 实现 Main `ExportService`，只从 SQLite 只读快照生成 CSV、SRT 和 ZIP。
2. 通过系统保存对话框写入用户选择的位置，不经 Renderer Blob 下载或 localhost HTTP。
3. 为每种格式建立 SQLite fixture 测试；SRT 时间基准保持现有系统时间语义，不改为 YouTube 时间。
4. 在原生项目中覆盖整场、组别、选手和裁判范围，以及空数据、路径权限和磁盘错误。

完成门槛：删除 FastAPI 导出接口后，原生项目的报表、视频复盘和全部导出格式仍可用。

## 3. P1：删除 Legacy Runtime 和兼容层

按以下顺序一次完成，不再建设新的 Python 兼容模块：

1. 删除 Renderer 的 Axios fallback、`apiBase`、server port 配置和 localhost 调用。
2. 将 `getLegacyReport/getLegacyReplay/listLegacyScoredContestants` 重命名为通用 Query Service，并删除读取前的 legacy refresh。
3. 删除 Main 的 FastAPI spawn/wait/kill、backend stdout parser、legacy importer、shadow event 和 legacy 目录删除逻辑。
4. 删除 `server.py` 及其 Scanner、DeviceNode、HeadlessReferee、WebSocket、项目、媒体、存储和导出实现。
5. 删除 `utils/storage.py`、`utils/media.py`、legacy exporter 及只被 backend 使用的设置/runtime 模块。
6. 删除 backend-engine 构建脚本、PyInstaller 配置和 Electron Builder 资源，只保留 `local-platform-worker`。
7. 删除 `match_data` 扫描、旧 `config.json`/CSV header 升级、live-managed、legacy_imports 和旧 DTO 兼容字段；用新的 migration 重建干净 Schema，不迁移旧库数据。

完成门槛：应用不启动 Uvicorn、不监听 localhost 端口、不读取 `match_data`，仓库中没有 legacy runtime/importer/shadow event。

## 4. P2：清理测试

既然不要求旧数据兼容，以下测试和 fixture 应随对应生产代码直接删除：

- `test_scoring_baseline.py`
- `test_scoring_parity.py`
- `test_score_snapshot.py`
- `test_media.py`
- `test_storage.py`
- `legacy-importer.test.mjs`
- `legacy-shadow-event.test.mjs`
- 只用于旧 CSV 的 fixture 和 header 升级用例
- `project/realtime/settings boundary` 中只为防止回退 FastAPI 而存在的文本扫描；backend 删除后改为依赖边界测试

保留并加强：

- TypeScript scoring domain、MatchSession、CompetitionService 和 SQLite Repository 测试。
- Platform Worker 的协议、BLE/USB 设备服务、重连取消和跨语言握手测试。
- YouTube normalizer、媒体锚点、复盘重建和 Electron 安全边界测试。
- 新 ExportService 的格式契约和文件错误测试。

测试清理应和生产代码删除在同一提交完成，避免留下导入不存在模块的测试或无测试的替代实现。

## 5. P3：补齐赛事领域并拆分 Main

1. 将默认 `Main` Stage 扩展为正式 Stage service，支持排序、尝试次数和 Competition/Stage/MatchSession 状态流转。
2. 将 `src/main/index.js` 拆为 bootstrap、窗口生命周期和分域 IPC 注册。
3. 将 `LocalDatabase` 拆成 migration runner、Competition/Match/Settings Repository 与 Replay/Report Query。
4. 将 `MatchSessionService` 的设备控制、媒体锚点和状态通知拆为协作者。
5. 移除 Schema 和共享 DTO 中的 `legacy_*`、`source_referee_index`、`dir_name` 等兼容命名，使用稳定领域 ID。

目标目录和依赖方向见 [目标架构](./ARCHITECTURE_TARGET_zh.md)。

## 6. P4：桌面壳层与 Renderer 分域

1. 实现非最大化居中窗口、固定侧栏、受限工作区和 light/dark Token。
2. 引入 Vue Router 和分域 Store，移除手写 `currentView` 与单一 `refereeStore`。
3. 将历史赛事改为页面，设置改为独立页面，用应用内 Dialog/状态条替代原生弹窗。
4. 保持现场播放器旁、视频悬浮模式和复盘中的悬浮计分组件一致。
5. Overlay 保持独立透明壳层，不继承主窗口背景和侧栏。

详细规范见 [桌面 UI 与交互目标](./UI_INTERACTION_SPEC_zh.md)。

## 7. P5：独立用户服务

本地主链路稳定后再接入 Django + PostgreSQL。Electron Main 通过 Gateway 调用，服务不可用不得阻断本地赛事。见 [Django 用户服务](./BACKEND_DJANGO_zh.md)。

## 8. 验证

~~~bash
npm test
npm run typecheck
npm run lint
npm run build
python -m unittest discover -s tests
~~~

legacy 删除完成后，Python 测试只发现 Platform Worker 相关用例。发布前还需在 Windows/macOS 实机验证 BLE、USB、睡眠恢复、OBS Overlay、YouTube、原生导出和安装包。
