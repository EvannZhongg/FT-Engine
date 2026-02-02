# BLE 通信协议文档 (Counter Project)

本文档描述了计数器设备 (Counter Device) 的蓝牙低功耗 (BLE) 通信接口规范。适用于 Android、iOS、Windows 或 Web Bluetooth 的客户端开发。

## 1\. 设备发现与连接

### 1.1 设备广播名称 (Device Name)

设备名称由前缀 `Counter-` 加上 MAC 地址的最后两个字节组成（大写，无冒号分隔）。

* **格式**: `Counter-XXXX`
* **示例**: `Counter-A1B2` (对应 MAC 结尾 A1:B2)

### 1.2 UUID 定义

客户端在扫描和连接时，请使用以下 UUID：

| 属性 (Attribute) | UUID | 权限 (Permissions) | 备注 |
| :--- | :--- | :--- | :--- |
| **Service UUID** | `015018d0-6951-4a81-de4f-453d8dae9128` | - | 主服务 |
| **Characteristic** | `025018d0-6951-4a81-de4f-453d8dae9128` | Read, Notify, **Write** | **核心数据通道** (双向) |> **注意**:>

> * 该特征值支持 **Notify** 属性。建议客户端连接后立即订阅 (Subscribe) 该特征值的通知，以便实时获取按键事件。
> * 该特征值支持 **Write** 属性，用于接收客户端的控制指令（如重置）。

-----

## 2\. 数据包格式 (Data Protocol)

设备通过上述 Characteristic 发送的数据包固定为 **17 字节**。
**重要提示**: 所有多字节数值均采用 **小端序 (Little-Endian)** 格式。

### 2.1 字节结构图

```text
[Byte 0-3] [Byte 4] [Byte 5-8] [Byte 9-12] [Byte 13-16]
|________| |______| |________| |_________| |__________|
 Current    Event     Total      Total       Timestamp
  Total     Type      Plus       Minus         (ms)
 (int32)    (int8)   (int32)    (int32)      (uint32)
```

### 2.2 字段详细定义

| 偏移 (Offset) | 字段名称 | 类型 | 长度 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| **0 - 3** | `current_total` | `int32` | 4 Bytes | **当前显示数值**<br>有符号整数 (例如: 10, -5) |
| **4** | `event_type` | `int8` | 1 Byte | **触发事件类型**<br>`1`: 加分 (Key Click)<br>`-1`: 减分 (Zero Click)<br>`0`: 重置 (Long Press) |
| **5 - 8** | `total_plus` | `int32` | 4 Bytes | **累计加分次数**<br>统计值，只增不减 |
| **9 - 12** | `total_minus` | `int32` | 4 Bytes | **累计减分次数**<br>统计值，只增不减 |
| **13 - 16** | `timestamp_ms` | `uint32`| 4 Bytes | **设备时间戳**<br>单位：毫秒 (ms)<br>表示设备开机后的运行时间 |

### 2.3 客户端下行指令 (Client -> Device)

客户端可以通过向 Characteristic 写入 (Write) 特定指令来控制设备。建议使用 Write Request (With Response) 方式。

| 指令名称 | 载荷 (Hex) | 长度 | 功能说明
| :--- | :--- | :--- | :--- |
| 远程重置 (Reset) | 0x01 | 1 Byte | 将当前计数、累计计数全部归零，并重置状态。设备执行后会推送一次类型为 0 的数据包。
-----

## 3\. 开发示例代码

以下提供了不同平台解析这 17 字节数据的核心代码片段。

### 3.1 Python (Bleak)

```python
import struct

# data 为收到的 bytes 对象
def parse_data(data):
    if len(data) != 17:
        print("Error: Invalid data length")
        return

    # < : 小端序
    # i : int32 (4 bytes)
    # b : int8 (1 byte)
    # I : uint32 (4 bytes)
    current, evt_type, t_plus, t_minus, ts = struct.unpack('<ibiiI', data)
    
    print(f"当前分: {current}, 事件: {evt_type}, 时间戳: {ts}")
```

### 3.2 Android (Kotlin)

Android 默认是大端序，**必须**显式设置为小端序。

```kotlin
import java.nio.ByteBuffer
import java.nio.ByteOrder

fun parseData(data: ByteArray) {
    if (data.size != 17) return

    val buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)

    val currentTotal = buffer.int        // Offset 0
    val eventType = buffer.get().toInt() // Offset 4
    val totalPlus = buffer.int           // Offset 5
    val totalMinus = buffer.int          // Offset 9
    // Java无uint，需转long防止负数溢出
    val timestampMs = buffer.int.toLong() and 0xFFFFFFFFL // Offset 13

    println("Score: $currentTotal, Event: $eventType")
}
```

### 3.3 iOS (Swift)

```swift
struct CounterEvent {
    let currentTotal: Int32
    let eventType: Int8
    let totalPlus: Int32
    let totalMinus: Int32
    let timestampMs: UInt32
}

func parse(data: Data) -> CounterEvent? {
    guard data.count == 17 else { return nil }
    
    return data.withUnsafeBytes { buffer in
        // 读取并处理小端序
        let currentTotal = buffer.load(fromByteOffset: 0, as: Int32.self).littleEndian
        let eventType = buffer.load(fromByteOffset: 4, as: Int8.self) // 单字节无需转换
        let totalPlus = buffer.load(fromByteOffset: 5, as: Int32.self).littleEndian
        let totalMinus = buffer.load(fromByteOffset: 9, as: Int32.self).littleEndian
        let timestampMs = buffer.load(fromByteOffset: 13, as: UInt32.self).littleEndian
        
        return CounterEvent(currentTotal: currentTotal, 
                            eventType: eventType, 
                            totalPlus: totalPlus, 
                            totalMinus: totalMinus, 
                            timestampMs: timestampMs)
    }
}
```

-----

## 4\. 连接策略与最佳实践

1.  **扫描过滤 (Filtering)**:
      * 建议扫描时通过 **Service UUID** (`025018...`) 进行过滤，或者匹配设备名以 `Counter-` 开头。
2.  **订阅通知 (Notification)**:
      * 连接建立并发现服务后，必须启用 Characteristic 的 Notification 功能（写入 CCCD 描述符），否则 App 将无法收到按键数据的实时更新。
3.  **心跳/保活**:
      * 虽然设备会主动推送数据，但建议客户端在长时间无数据时（如超过 5-10 秒），读取一次标准的 `Device Name` 特征值或检查 RSSI，以确认物理连接依然存活。
