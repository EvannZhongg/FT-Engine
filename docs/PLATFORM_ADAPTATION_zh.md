# FT Engine Windows 与 macOS 平台适配规范

## 1. 文档目标

本文档集中定义路线 B 重构中的操作系统差异。通用领域、UI、接口和数据模型不在这里重复说明。

所有平台相关代码、构建配置、权限说明和验收用例必须归入本规范对应的适配层。业务模块和 Vue 页面不得散落 `process.platform`、`sys.platform` 或系统命令判断。

配套文档：

- [当前架构](./ARCHITECTURE_CURRENT_zh.md)
- [目标架构与项目结构](./ARCHITECTURE_TARGET_zh.md)
- [路线 B 剩余重构计划](./REFACTOR_PLAN_ROUTE_B_zh.md)
- [桌面 UI 与交互目标](./UI_INTERACTION_SPEC_zh.md)

## 2. 建议支持基线

| 系统 | 建议首发范围 | CPU 架构 | 安装产物 |
| --- | --- | --- | --- |
| Windows | Windows 10 22H2、Windows 11 | x64 | NSIS EXE |
| macOS | 仍受 Apple 安全更新支持的版本 | arm64、x64 分别构建 | DMG |

macOS 第一阶段建议分别构建 arm64 和 x64 安装包，不立即制作 Universal Binary。Python、Bleak 和其他原生依赖需要逐架构验证，强行合并 Universal Binary 会增加签名和依赖合并风险。

最低系统版本最终应根据真实用户设备和 CI 硬件确定，并写入发布配置。未列入支持矩阵的系统不应显示为正式支持。

## 3. 适配层边界

### 3.1 Electron Main 平台接口

```ts
export interface DesktopPlatformAdapter {
  readonly platform: 'windows' | 'macos'
  getDataRoot(): string
  getLogRoot(): string
  configureApplicationLifecycle(): void
  configureOverlay(window: BrowserWindow, options: OverlayOptions): void
  setOverlayClickThrough(window: BrowserWindow, enabled: boolean): void
  registerGlobalShortcut(shortcut: string, handler: () => void): RegistrationResult
  getSecureStorageStatus(): SecureStorageStatus
}
```

平台选择只允许出现在组合根：

```text
apps/desktop/src/main/platform/
├─ index.ts
├─ contract.ts
├─ windows/
│  ├─ windows-platform.ts
│  └─ windows-overlay.ts
└─ macos/
   ├─ macos-platform.ts
   └─ macos-overlay.ts
```

领域服务只依赖 `DesktopPlatformAdapter`，不得自行读取系统名称。

### 3.2 Python Worker 平台接口

```py
class BlePlatformAdapter(Protocol):
    async def scan(self, flush: bool): ...
    async def connect(self, device_id: str): ...
    async def permissions(self): ...

class WindowTracker(Protocol):
    async def list_windows(self): ...
    async def get_bounds(self, window_id: str): ...
    async def track(self, window_id: str): ...
```

建议目录：

```text
workers/local-platform-worker/ft_worker/platform/
├─ contract.py
├─ factory.py
├─ windows/
│  ├─ ble.py
│  ├─ serial.py
│  └─ windows.py
└─ macos/
   ├─ ble.py
   ├─ serial.py
   └─ windows.py
```

只有 `factory.py` 可以读取 `sys.platform`。BLE、USB 和窗口 RPC Handler 只调用协议接口。

## 4. 通用能力与平台实现映射

| 能力 | 通用调用方 | Windows 实现 | macOS 实现 |
| --- | --- | --- | --- |
| BLE | Python DeviceService | Bleak WinRT backend | Bleak CoreBluetooth backend |
| USB | Python DeviceService | COM Port + VID/PID | `/dev/cu.*` + USB metadata |
| 窗口枚举 | Python WindowService | Win32 API adapter | Quartz/CoreGraphics adapter |
| 窗口坐标 | Python WindowService | 物理像素/DPI 转换 | CoreGraphics 全局坐标转换 |
| Overlay | Electron OverlayService | BrowserWindow Windows policy | BrowserWindow macOS policy |
| 点击穿透 | Electron OverlayService | Electron Windows behavior | Electron macOS behavior |
| 全局快捷键 | Electron ShortcutService | Windows accelerator | macOS accelerator/Command mapping |
| 安全存储 | Electron AuthService | DPAPI-backed `safeStorage` | Keychain-backed `safeStorage` |
| 安装 | Build Pipeline | NSIS | DMG |
| 发布信任 | Build Pipeline | Authenticode | Developer ID + Notarization |

## 5. Windows 适配

### 5.1 BLE

- 使用 Bleak WinRT backend，不在 Electron Renderer 中使用 Web Bluetooth。
- 区分“蓝牙关闭”“权限拒绝”“适配器不存在”“目标设备未发现”和“连接超时”。
- 扫描结果继续支持广播名称、Service UUID、RSSI、设备备注和传输类型。
- Worker 重启后重新建立 WinRT 对象，不复用失效的系统句柄。
- 保留现有 Windows BLE 心跳策略，并以平台配置注入设备节点。
- Windows 睡眠和唤醒后执行重新扫描与连接恢复测试。

### 5.2 USB

- 使用 COM Port 和 PySerial。
- 优先通过 VID/PID、序列号和设备 Identify 响应建立稳定设备 ID，不能仅依赖 `COM3` 这类易变化端口名。
- 设备拔出后关闭句柄并进入重连状态；重新插入到不同 COM Port 时应恢复同一设备绑定。
- 安装程序不默认安装第三方驱动；如果硬件需要专用驱动，应独立提供并在发布清单注明。

### 5.3 窗口枚举和坐标

- 使用 Win32 窗口 API 适配器；可以复用已验证的 PyGetWindow 行为，但不把 PyGetWindow 类型暴露到通用接口。
- 进程应声明 Per-Monitor DPI Awareness，统一将 Worker 坐标转换为 Electron `setBounds` 使用的坐标单位。
- 覆盖主显示器缩放 100%、125%、150% 以及不同缩放比例的双显示器。
- 支持负坐标显示器、窗口最大化、还原、最小化和跨屏移动。
- 窗口标题变化时优先使用稳定窗口 ID；标题只用于首次选择和展示。
- 目标进程退出时发送 `found: false`，不得沿用最后坐标无限置顶。

### 5.4 OBS Overlay

- Overlay 使用透明、无边框、置顶 BrowserWindow，并保持 `contentProtection=false`。
- 验证 OBS Window Capture 的不同捕获方法，记录正式推荐方法。
- 主窗口启用内容保护时，Overlay 仍必须可捕获。
- 点击穿透开启时，鼠标操作必须传递给下方应用。
- OBS 捕获画面不得出现黑色背景、白边、阴影或透明区域闪烁。
- 窗口重建、显卡切换和显示器断开后重新执行 Overlay 定位。

### 5.5 生命周期和快捷键

- 关闭最后一个窗口时结束 Worker，并确保串口句柄释放。
- 处理关机、注销和应用崩溃后的未完成 MatchSession 恢复。
- `Ctrl` 快捷键沿用现有用户设置；注册失败必须显示占用状态。
- 更新安装前停止 Worker 和 SQLite 连接。

### 5.6 数据路径

```text
%APPDATA%\FT Engine\
├─ ft-engine.db
├─ backups\
├─ exports\
└─ logs\
```

不要将可写数据库放入安装目录或 `Program Files`。

### 5.7 打包和签名

- Electron 生成 x64 NSIS 安装包。
- Python Worker 作为 x64 可执行文件随安装包分发。
- 主程序、Worker 和安装包均使用 Authenticode 签名。
- 自动更新校验签名和发布通道，不关闭签名验证。
- 验证覆盖安装、降级拒绝、卸载保留数据和清除本地数据选项。

## 6. macOS 适配

### 6.1 BLE

- 使用 Bleak CoreBluetooth backend。
- CoreBluetooth 返回的设备标识可能是系统 UUID，不应假设能够获得真实 MAC 地址。
- 设备绑定优先使用系统设备 ID、广播名称和设备 Identify 结果，持久化模型不能要求 MAC 格式。
- Info.plist 包含清晰的蓝牙用途说明。
- 首次权限请求、权限拒绝、系统设置重新授权和蓝牙关闭分别测试。
- Worker 可执行文件需要随应用签名，并包含 BLE 所需 entitlement；父应用授权不应被假设为自动覆盖未签名子进程。
- 系统睡眠和唤醒后重新建立 CoreBluetooth 连接。

### 6.2 USB

- 使用 `/dev/cu.*` 设备路径，不优先选择 `/dev/tty.*`。
- 使用 USB Vendor ID、Product ID、序列号和 Identify 响应生成稳定设备 ID。
- 处理设备路径在重新插入后变化的情况。
- 未采用 App Sandbox 时不增加无关文件权限；若未来启用 Sandbox，应单独评审 USB entitlement。

### 6.3 窗口枚举和权限

- macOS 窗口实现使用 Quartz/CoreGraphics，不依赖仅适用于 Windows 的窗口 API 行为。
- 使用稳定的 CGWindow ID 进行跟踪，窗口标题只用于首次选择和展示。
- 窗口列表和名称可能受到 Screen Recording 权限影响，应提供明确权限状态和跳转系统设置操作。
- 只读取窗口信息时不默认申请 Accessibility 权限；只有未来需要控制其他应用窗口时再单独评审。
- 将 CoreGraphics 坐标转换为 Electron 坐标时，处理左上/左下原点差异、Retina Scale 和多显示器全局坐标。
- 覆盖内建 Retina 屏幕、外接显示器、不同缩放和负坐标布局。

### 6.4 OBS Overlay

- Overlay 保持透明、无边框、置顶和 `contentProtection=false`。
- 根据需要使用 `setVisibleOnAllWorkspaces`，验证全屏 Space 和普通桌面之间的行为。
- 验证 OBS 的 macOS Screen Capture/Window Capture 来源能够捕获透明 Overlay。
- 主窗口内容保护、Overlay 捕获和 Screen Recording 权限必须分别验证。
- 点击穿透启用和关闭后，窗口层级不得丢失。
- 显示器热插拔、Space 切换和应用隐藏/恢复后重新同步目标窗口。

### 6.5 生命周期和快捷键

- 关闭主窗口时明确选择退出应用，保持与当前产品行为一致。
- `Command` 与 `Control` 的快捷键映射在 UI 中使用系统化显示，不直接显示 Windows 文案。
- 处理系统休眠、唤醒、应用隐藏和重新激活。
- 更新或退出前正常停止 Worker 和 SQLite。

### 6.6 数据路径

```text
~/Library/Application Support/FT Engine/
├─ ft-engine.db
├─ backups/
├─ exports/
└─ logs/
```

不得将运行数据写入 `.app` Bundle 或 DMG 挂载目录。

### 6.7 打包、签名和公证

- arm64 和 x64 分别构建 Electron 应用和 Python Worker。
- 所有嵌套可执行文件、Framework、动态库和 Worker 按从内到外顺序签名。
- 主应用启用 Hardened Runtime。
- 主应用和 Worker 分别配置实际需要的 entitlement，不复制无关权限。
- DMG 发布前完成 Developer ID 签名、Apple Notarization 和 Stapling。
- 在未安装开发证书的干净设备上验证 Gatekeeper 首次启动。
- 自动更新产物按架构和发布通道区分，禁止向 arm64 安装 x64 专用更新。

## 7. 平台无关代码约束

- `domain/`、`application/`、共享 DTO 和 Vue 页面禁止读取操作系统名称。
- 通用代码不得拼接 `%APPDATA%`、`~/Library`、COM Port 或 `/dev/cu.*`。
- 平台错误先转换为稳定错误码，再交给 Renderer 本地化。
- UI 可以根据 capability 显示功能状态，但不根据系统名称猜测能力。
- Worker 握手应返回 capabilities：

```json
{
  "protocolVersion": 1,
  "platform": "macos",
  "capabilities": {
    "ble": true,
    "usb": true,
    "windowTracking": true,
    "screenRecordingPermission": "notDetermined"
  }
}
```

- 新增第三个平台时必须实现同一适配接口和完整验收矩阵，不允许在领域代码中补一个条件分支。

## 8. 平台错误码

建议统一以下错误码：

| 错误码 | 含义 |
| --- | --- |
| `PLATFORM_UNSUPPORTED` | 当前系统不在支持范围 |
| `BLE_ADAPTER_MISSING` | 未检测到蓝牙适配器 |
| `BLE_POWERED_OFF` | 蓝牙已关闭 |
| `BLE_PERMISSION_DENIED` | 蓝牙权限被拒绝 |
| `USB_DEVICE_NOT_FOUND` | 绑定的 USB 设备不可用 |
| `USB_PORT_BUSY` | 串口被其他程序占用 |
| `WINDOW_PERMISSION_DENIED` | 无法读取目标窗口 |
| `WINDOW_TARGET_GONE` | 目标窗口已关闭 |
| `OVERLAY_CAPTURE_UNAVAILABLE` | Overlay 无法按要求被捕获 |
| `SECURE_STORAGE_UNAVAILABLE` | 系统安全存储不可用 |

平台适配器保留原始异常到日志，但 Renderer 只接收稳定错误码和安全的上下文数据。

## 9. CI 和构建流水线

Windows 与 macOS 使用独立 Job，不共享已编译的 Python Worker 或 Electron 原生依赖。

```text
validate-common
├─ typecheck
├─ lint
├─ domain-tests
└─ protocol-contract-tests

build-windows-x64
├─ worker-tests-windows
├─ build-worker-x64
├─ electron-e2e-windows
├─ sign-authenticode
└─ package-nsis

build-macos-arm64 / build-macos-x64
├─ worker-tests-macos
├─ build-worker-arch
├─ electron-e2e-macos
├─ sign-nested-binaries
├─ notarize-and-staple
└─ package-dmg
```

无签名的开发构建可以用于 CI 功能测试，但不得作为正式更新产物发布。

## 10. 双平台验收矩阵

| 能力 | Windows x64 | macOS arm64 | macOS x64 |
| --- | --- | --- | --- |
| 安装、首次启动、卸载 | 必测 | 必测 | 必测 |
| 全新数据库初始化、Schema 重建和故障恢复 | 必测 | 必测 | 必测 |
| BLE 扫描、连接、重连 | 必测 | 必测 | 必测 |
| USB 插拔和端口变化 | 必测 | 必测 | 必测 |
| 睡眠/唤醒恢复 | 必测 | 必测 | 必测 |
| 全局快捷键 | 必测 | 必测 | 必测 |
| 多显示器 Overlay 跟踪 | 必测 | 必测 | 必测 |
| OBS 透明捕获 | 必测 | 必测 | 必测 |
| OBS 点击穿透 | 必测 | 必测 | 必测 |
| YouTube iframe 和回放 | 必测 | 必测 | 必测 |
| SQLite 崩溃恢复 | 必测 | 必测 | 必测 |
| 自动更新 | 必测 | 必测 | 必测 |
| 登录安全存储 | 必测 | 必测 | 必测 |

任一“必测”项失败都阻断对应平台发布，但不应阻断其他已通过平台的内部测试构建。

## 11. 平台适配完成定义

- 平台条件判断只存在于适配层组合根和构建配置。
- Windows 和 macOS 使用相同领域测试输入并产生相同计分结果。
- BLE、USB、窗口跟踪和安全存储通过 capability 接口访问。
- OBS Overlay 在支持矩阵的每个平台完成真实 OBS 捕获测试。
- 安装包、Worker、更新包满足对应系统签名要求。
- 用户数据始终写入对应系统的用户数据目录。
- 平台权限被拒绝时，应用仍可进入工作台和复盘，不发生启动崩溃。
- 平台差异新增或变更时只更新本文件和适配层，不修改无关产品流程文档。
