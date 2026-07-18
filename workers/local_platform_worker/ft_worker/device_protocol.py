import struct
from dataclasses import dataclass


USB_FRAME_MAGIC = b"FTE1"
USB_CMD_RESET = 0x01
USB_CMD_RENAME = 0x02
USB_CMD_IDENTIFY = 0x03
USB_EVT_COUNTER = 0x11
USB_RSP_IDENTIFY = 0x12
USB_RSP_COMMAND = 0x13
USB_SERIAL_PREFIX = "usb:"
USB_PORT_PREFIX = "usbport:"


@dataclass(frozen=True)
class ClickerEvent:
  current_total: int
  event_type: int
  total_plus: int
  total_minus: int
  timestamp_ms: int


def build_usb_frame(frame_type: int, payload: bytes = b"") -> bytes:
  if not 0 <= frame_type <= 255:
    raise ValueError("USB frame type is out of range")
  payload_len = len(payload)
  if payload_len > 255:
    raise ValueError("USB payload too large")

  checksum = frame_type ^ payload_len
  for byte in payload:
    checksum ^= byte
  return USB_FRAME_MAGIC + bytes((frame_type, payload_len)) + payload + bytes((checksum,))


def extract_usb_frames(buffer: bytearray) -> list[tuple[int, bytes]]:
  frames = []
  while True:
    if len(buffer) < 7:
      break

    magic_index = buffer.find(USB_FRAME_MAGIC)
    if magic_index < 0:
      buffer.clear()
      break
    if magic_index > 0:
      del buffer[:magic_index]
    if len(buffer) < 7:
      break

    payload_len = buffer[5]
    frame_len = 7 + payload_len
    if len(buffer) < frame_len:
      break

    frame = bytes(buffer[:frame_len])
    del buffer[:frame_len]
    frame_type = frame[4]
    payload = frame[6:-1]
    checksum = frame[-1]

    expected = frame_type ^ payload_len
    for byte in payload:
      expected ^= byte
    if checksum == expected:
      frames.append((frame_type, payload))
  return frames


def parse_identify_payload(payload: bytes) -> tuple[str, str]:
  if len(payload) < 7:
    raise ValueError("identify payload too short")

  mac = payload[:6]
  name_len = payload[6]
  if len(payload) != 7 + name_len:
    raise ValueError("identify payload length mismatch")

  name = payload[7:].decode("utf-8")
  mac_hex = "".join(f"{part:02X}" for part in mac)
  return f"{USB_SERIAL_PREFIX}{mac_hex}", name


def build_usb_port_address(port_path: str) -> str:
  if not port_path:
    raise ValueError("USB port path is required")
  return f"{USB_PORT_PREFIX}{port_path}"


def parse_notification_data(data: bytes) -> ClickerEvent:
  if len(data) != 17:
    raise ValueError("Data mismatch")
  return ClickerEvent(*struct.unpack("<ibiiI", data))
