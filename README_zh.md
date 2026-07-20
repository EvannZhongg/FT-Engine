# FT Engine

语言：[English](README.md) | [中文](README_zh.md)

FT Engine 是面向电子裁判和竞技比赛的桌面计分应用，支持自由模式、赛事模式、BLE/USB 计分器、实时计分、OBS 悬浮窗、YouTube 复盘、历史报表以及 CSV/SRT/ZIP 导出。应用基于 Electron、TypeScript、SQLite 构建，并使用 Python Platform Worker 处理设备和窗口等本机 I/O。

## 主要能力

- 自由模式和赛事模式，支持单裁判或双裁判。
- BLE 与 USB 计分器及重连处理。
- 实时分数、罚分、复盘、媒体时间轴和 OBS 悬浮窗。
- 历史报表以及 CSV、SRT、ZIP 导出。
- 中文、英文和日文界面。

## 环境要求

- Node.js 22 或更高版本。
- Python 3.10 或更高版本。
- 开发真实设备功能时需要蓝牙硬件和相应 USB 驱动。

Platform Worker 包含系统原生依赖，Windows 和 macOS 必须使用独立虚拟环境：

- Windows：`.venv-win`，安装 `requirements-windows.txt`。
- macOS：`.venv-mac`，安装 `requirements-macos.txt`。
- `requirements.txt` 只保存两端共用依赖，不应在两个系统之间复制虚拟环境目录。

## 开发运行

```bash
npm install
python3 -m venv .venv-mac
source .venv-mac/bin/activate
python -m pip install -r requirements-macos.txt
npm run dev
```

Windows PowerShell：

```powershell
npm install
py -3 -m venv .venv-win
.\.venv-win\Scripts\Activate.ps1
python -m pip install -r requirements-windows.txt
npm run dev
```

`npm run build:worker:mac` 和 `npm run build:worker:win` 会自动创建并使用各自的虚拟环境。

项目数据保存在 Electron 用户数据目录下的 SQLite 中。应用不依赖本地 HTTP 或 WebSocket 服务。

## 验证

```bash
npm test
npm run typecheck
npm run lint
npm run build
.venv-mac/bin/python -m unittest discover -s tests  # macOS
# .\.venv-win\Scripts\python.exe -m unittest discover -s tests  # Windows
```

## 构建安装包

```bash
npm run build:worker
npm run build:unpack
npm run build:win
npm run build:mac
```

Windows 使用 NSIS，macOS 使用 DMG；Platform Worker 会随应用一起打包。
macOS 构建会优先使用钥匙串中的 Developer ID Application 证书；未安装证书时会生成经过 ad-hoc 签名、适合本地测试的 DMG，但面向其他用户发布前仍须完成 Developer ID 签名、公证和 Stapling。

## 文档

- [目标架构](docs/ARCHITECTURE_TARGET_zh.md)
- [后续目标](docs/FUTURE_GOALS_zh.md)
- [Django 用户服务](docs/BACKEND_DJANGO_zh.md)
- [用户与社区产品边界](docs/COMMUNITY_CONTRACT_AND_UI_SPEC_zh.md)
- [Windows 与 macOS 平台适配规范](docs/PLATFORM_ADAPTATION_zh.md)

## License

Proprietary / Custom License（授权请联系 Freakthrow）。
