# BLE Protocol (Counter Project)

Language: [English](BLE_PROTOCOL.md) | [中文](BLE_PROTOCOL_zh.md)

This document describes the BLE interface for the Counter device, intended for Android, iOS, Windows, or Web Bluetooth clients.

## 1. Discovery and Connection

### 1.1 Device Name

The device name is `Counter-` plus the last two bytes of the MAC address (uppercase, no colons).

- **Format**: `Counter-XXXX`
- **Example**: `Counter-A1B2` (MAC ending with A1:B2)

### 1.2 UUIDs

Use the following UUIDs for scan and connection:

| Attribute | UUID | Permissions | Notes |
| :--- | :--- | :--- | :--- |
| **Service UUID** | `025018d0-6951-4a81-de4f-453d8dae9128` | - | Primary service |
| **Characteristic** | `025018d0-6951-4a81-de4f-453d8dae9128` | Read, Notify, **Write** | **Core data channel** (bi-directional) |
| **Device Name** | `00002a00-0000-1000-8000-00805f9b34fb` | Read | Standard device name (heartbeat) |

Notes:
- The characteristic supports **Notify**; subscribe immediately after connecting.
- The characteristic supports **Write** for client control (e.g., reset).

## 2. Data Protocol

Packets sent from the characteristic are fixed at **17 bytes**.  
**Important**: all multi-byte values are **little-endian**.

### 2.1 Byte Layout

```text
[Byte 0-3] [Byte 4] [Byte 5-8] [Byte 9-12] [Byte 13-16]
|________| |______| |________| |_________| |__________|
 Current    Event     Total      Total       Timestamp
  Total     Type      Plus       Minus         (ms)
 (int32)    (int8)   (int32)    (int32)      (uint32)
```

### 2.2 Field Definition

| Offset | Field | Type | Length | Description |
| :--- | :--- | :--- | :--- | :--- |
| **0 - 3** | `current_total` | `int32` | 4 Bytes | **Current displayed total** (signed) |
| **4** | `event_type` | `int8` | 1 Byte | **Event type**<br>Current firmware convention: `1`=plus, `-1`=minus, `0`=reset |
| **5 - 8** | `total_plus` | `int32` | 4 Bytes | **Accumulated plus count** |
| **9 - 12** | `total_minus` | `int32` | 4 Bytes | **Accumulated minus count** |
| **13 - 16** | `timestamp_ms` | `uint32` | 4 Bytes | **Device timestamp** in milliseconds since power-on |

> `event_type` meanings are firmware-defined; update this table if the device firmware changes.

### 2.3 Client Commands (Client -> Device)

Clients can write control commands to the characteristic. Use Write Request (With Response).

| Command | Payload (Hex) | Length | Description |
| :--- | :--- | :--- | :--- |
| Remote Reset | 0x01 | 1 Byte | Clears current/accumulated counts and resets state. The device typically sends one packet with `event_type = 0`. |

## 3. Example Code

### 3.1 Python (Bleak)

```python
import struct

# data is a bytes object
def parse_data(data):
    if len(data) != 17:
        print("Error: Invalid data length")
        return

    # < : little-endian
    # i : int32 (4 bytes)
    # b : int8 (1 byte)
    # I : uint32 (4 bytes)
    current, evt_type, t_plus, t_minus, ts = struct.unpack('<ibiiI', data)

    print(f"Current: {current}, Event: {evt_type}, Timestamp: {ts}")
```

### 3.2 Android (Kotlin)

Android uses big-endian by default, so **you must** set little-endian.

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
    // Java has no uint, convert to long to avoid sign issues
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
        let currentTotal = buffer.load(fromByteOffset: 0, as: Int32.self).littleEndian
        let eventType = buffer.load(fromByteOffset: 4, as: Int8.self)
        let totalPlus = buffer.load(fromByteOffset: 5, as: Int32.self).littleEndian
        let totalMinus = buffer.load(fromByteOffset: 9, as: Int32.self).littleEndian
        let timestampMs = buffer.load(fromByteOffset: 13, as: UInt32.self).littleEndian

        return CounterEvent(
            currentTotal: currentTotal,
            eventType: eventType,
            totalPlus: totalPlus,
            totalMinus: totalMinus,
            timestampMs: timestampMs
        )
    }
}
```

## 4. Best Practices

1. **Filtering**: filter by Service UUID (`025018...`) or device name prefix `Counter-`.
2. **Notifications**: enable Notification (write CCCD) right after service discovery.
3. **Heartbeat**: if idle for 5–10 seconds, read `Device Name` or check RSSI to confirm the link.
