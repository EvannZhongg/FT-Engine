import struct
from dataclasses import dataclass
from config import STRUCT_FORMAT, STRUCT_SIZE


@dataclass
class ClickerEvent:
    current_total: int
    event_type: int
    total_plus: int
    total_minus: int
    timestamp_ms: int


def parse_notification_data(data: bytes) -> ClickerEvent:
    """解析 ESP32 发送的二进制 Struct"""
    if len(data) != STRUCT_SIZE:
        raise ValueError(f"Data size mismatch: expected {STRUCT_SIZE}, got {len(data)}")

    unpacked = struct.unpack(STRUCT_FORMAT, data)
    return ClickerEvent(
        current_total=unpacked[0],
        event_type=unpacked[1],
        total_plus=unpacked[2],
        total_minus=unpacked[3],
        timestamp_ms=unpacked[4]
    )