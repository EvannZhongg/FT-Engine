# BLE 计分器协议边界

Platform Worker 是 FT Engine 唯一的 BLE 持有者。Renderer 只通过 Main IPC 使用普通 JSON DTO，不接触 Bleak 对象或系统连接句柄。

## GATT 布局

设备固件使用 NimBLE 的 `BLE_UUID128_INIT`。按 BLE 规范转换为扫描和 GATT 操作使用的 UUID 后，布局如下：

| 用途 | UUID | 权限 |
| --- | --- | --- |
| 主服务 | `015018d0-6951-4a81-de4f-453d8dae9128` | Primary |
| 计数特征 | `025018d0-6951-4a81-de4f-453d8dae9128` | Read / Write / Notify |
| 激活信息特征 | `035018d0-6951-4a81-de4f-453d8dae9128` | Read |

计数特征通知和读取值都是 17 字节小端结构：

```text
int32  current_total
int8   event_type        // 1 plus, -1 minus, 0 reset/snapshot
int32  total_plus
int32  total_minus
uint32 timestamp_ms
```

计数特征写入命令：

- `01`: reset counter and totals
- `02` + UTF-8 name: rename the BLE device

## 生命周期

1. `device.scan` 使用 Bleak 扫描窗口，按 `Counter-` 广播名或主服务 UUID 过滤，并只返回 `name/address/deviceId/rssi/remark/transport`。
2. `device.connectMany` 为每个绑定建立独立 `BleSession`，连接成功后订阅计数特征通知。
3. 断线由 Worker 发出 `device.status=error` 并按会话重连；主动停止会取消重连和心跳任务，再发出 `disconnected`。
4. `device.resetAll` 向每个活动会话写入 `01`，设备产生 reset snapshot 通知，计分会话再按事件顺序持久化。
