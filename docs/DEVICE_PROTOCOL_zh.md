# 计分器设备连接、识别与加减计分信号

本文只描述当前 Worker 实现使用的 BLE 连接策略、USB 设备识别方式，以及计分器的加分/减分信号结构。设备由 Python Platform Worker 独占；Renderer 不直接持有 Bleak 对象、串口对象、GATT 客户端或系统连接句柄。

## BLE 连接策略

### 设备发现

Worker 使用 Bleak 扫描 BLE 广播，并接受满足以下任一条件的设备：

- 广播本地名称以 `Counter-` 开头；
- 广播的 Service UUID 为 `015018d0-6951-4a81-de4f-453d8dae9128`。

设备以 BLE 地址作为 `deviceId`，并缓存扫描到的设备对象；扫描结果还带有广播名称、地址、RSSI、备注和 `transport: "BLE"`。

### 建立连接

比赛会话通过 `device.connectMany` 一次提交多个连接。Worker 要求连接项的 `connectionId` 和 `deviceId` 均唯一，最多 32 项，并为每项创建独立的 `BleSession`；多个会话并行连接。

单个 BLE 会话的顺序如下：

1. 发出 `status=connecting`。
2. 优先使用扫描缓存；没有缓存时按 `deviceId`（BLE 地址）重新查找，查找窗口为 `4 s`。
3. 创建 Bleak 客户端，连接超时为 `10 s`。
4. 连接成功后订阅计数特征的 Notify；订阅成功后才发出 `status=connected`。

首次连接失败不会在本次 `connectMany` 调用中自动重试，该连接项返回 `status=error` 和错误码。

### 断线与重连

- 非主动断线先发出 `status=error`，随后每隔 `3 s` 尝试重新查找并连接；重连成功后再次经历 `connecting -> connected`，失败则继续重试。
- Windows 使用 BLE 心跳：连接后每 `5 s` 读取标准 Device Name 特征 `00002a00-0000-1000-8000-00805f9b34fb`；连续两次读取失败会主动断开当前客户端并进入上述重连流程。macOS 当前不启用该心跳。
- 主动断开或 Worker 关闭时取消重连、心跳和通知相关任务，关闭客户端，最后发出 `status=disconnected`。

Worker 对外的连接状态事件结构为：

```json
{
  "protocolVersion": 1,
  "event": "device.status",
  "payload": {
    "connectionId": "match-ref-1-primary",
    "deviceId": "AA:BB:CC:DD:EE:FF",
    "status": "connecting | connected | error | disconnected"
  }
}
```

## USB 设备识别

### 候选串口

Worker 先从系统串口中筛选可能的计分器：

- Windows：USB VID 为 `0x303A`，或者厂商、描述、产品名、硬件 ID 中包含 `espressif`、`jtag` 或 `303a`；
- macOS：除上述设备特征外，串口路径还必须以 `/dev/cu.` 开头。

候选串口使用 `115200 baud`、8 位数据位、无流控的串口连接。端口名只用于定位设备，不作为优先的稳定身份。

### Identify 交互

Worker 打开候选串口后发送 `IDENTIFY` 请求，并等待设备返回身份信息。USB 消息使用以下通用帧结构：

| 偏移 | 长度 | 字段 | 内容 |
| ---: | ---: | --- | --- |
| 0 | 4 | `magic` | 固定 ASCII `FTE1`，即 `46 54 45 31` |
| 4 | 1 | `frame_type` | 请求或响应类型 |
| 5 | 1 | `payload_len` | Payload 长度，范围 `0..255` |
| 6 | N | `payload` | `payload_len` 字节 |
| 6 + N | 1 | `checksum` | `frame_type XOR payload_len XOR payload[0..N-1]` |

Identify 请求没有 Payload：

```text
46 54 45 31 03 00 03
|--- FTE1 ---| |  |  |
              |  |  +-- checksum = 0x03
              |  +----- payload_len = 0
              +-------- frame_type = 0x03 (IDENTIFY)
```

设备应返回 `frame_type=0x12` 的 Identify 响应，其 Payload 结构为：

| 偏移 | 长度 | 类型 | 字段 | 含义 |
| ---: | ---: | --- | --- | --- |
| 0 | 6 | `uint8[6]` | `device_mac` | 设备的 6 字节稳定身份 |
| 6 | 1 | `uint8` | `name_len` | UTF-8 设备名称的字节长度 |
| 7 | `name_len` | `uint8[]` | `name` | UTF-8 设备名称 |

Worker 将 `device_mac` 转为大写、无分隔符的十六进制字符串，并生成稳定设备 ID：

```text
device_mac = AA BB CC DD EE FF
deviceId   = usb:AABBCCDDEEFF
```

扫描阶段若设备没有返回有效 Identify 响应，Worker 会暂时使用 `usbport:<串口路径>` 标识并展示该端口；该标识依赖系统端口路径，不保证设备重新插拔后保持不变。对 `usb:<设备身份>` 建立连接时，Worker 会再次执行 Identify，并拒绝身份与绑定值不一致的设备。

## BLE GATT 与加减计分信号

设备使用 NimBLE 的 128 位 UUID。按 BLE 规范转换后，当前连接所需的 GATT 布局为：

| 用途 | UUID | 本文使用方式 |
| --- | --- | --- |
| 主服务 | `015018d0-6951-4a81-de4f-453d8dae9128` | Primary |
| 计数特征 | `025018d0-6951-4a81-de4f-453d8dae9128` | 读取 17 字节值 / 订阅 Notify |

连接成功后必须订阅计数特征的 Notify。通知（以及读取到的同一计数值）固定为 17 字节、小端序，字段布局如下：

| 偏移 | 长度 | 类型 | 字段 | 加减计分含义 |
| ---: | ---: | --- | --- | --- |
| 0 | 4 | `int32` | `current_total` | 设备当前总值，可为负 |
| 4 | 1 | `int8` | `event_type` | `1` 表示加分，`-1` 表示减分 |
| 5 | 4 | `int32` | `total_plus` | 设备累计加分次数 |
| 9 | 4 | `int32` | `total_minus` | 设备累计减分次数 |
| 13 | 4 | `uint32` | `timestamp_ms` | 设备时间戳（毫秒） |

等价的 Python 解包格式为：

```python
struct.unpack("<ibiiI", data)  # data 必须正好 17 字节
```

Worker 将每个有效通知转成 JSON 事件：

```json
{
  "protocolVersion": 1,
  "event": "device.counter",
  "eventId": "<32 位十六进制 ID>",
  "payload": {
    "connectionId": "match-ref-1-primary",
    "deviceId": "AA:BB:CC:DD:EE:FF",
    "transport": "BLE",
    "currentTotal": 2,
    "eventType": 1,
    "totalPlus": 3,
    "totalMinus": 1,
    "deviceTimestampMs": 123456
  }
}
```

其中 `eventId` 由 `deviceId`、设备时间戳、事件类型、累计加分和累计减分确定；相同信号重复到达会得到相同 ID，计分层据此去重。计分层以 `totalPlus`/`totalMinus` 的累计值更新状态，`eventType` 用于标识本次信号是加分还是减分；不要仅依赖 `currentTotal` 推导累计计分。
