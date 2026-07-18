import struct
import unittest

from workers.local_platform_worker.ft_worker.device_protocol import (
  USB_EVT_COUNTER,
  build_usb_frame,
  extract_usb_frames,
  parse_identify_payload,
  parse_notification_data,
)


class DeviceProtocolTests(unittest.TestCase):
  def test_parses_clicker_notification_using_firmware_layout(self):
    payload = struct.pack("<ibiiI", -3, -1, 4, 7, 123456)

    event = parse_notification_data(payload)

    self.assertEqual(event.current_total, -3)
    self.assertEqual(event.event_type, -1)
    self.assertEqual(event.total_plus, 4)
    self.assertEqual(event.total_minus, 7)
    self.assertEqual(event.timestamp_ms, 123456)

  def test_extracts_fragmented_usb_frame_and_keeps_partial_data(self):
    frame = build_usb_frame(USB_EVT_COUNTER, b"counter-event")
    buffer = bytearray(b"noise" + frame[:8])

    self.assertEqual(extract_usb_frames(buffer), [])
    self.assertEqual(bytes(buffer), frame[:8])

    buffer.extend(frame[8:])
    self.assertEqual(extract_usb_frames(buffer), [(USB_EVT_COUNTER, b"counter-event")])
    self.assertEqual(buffer, bytearray())

  def test_discards_usb_frame_with_invalid_checksum(self):
    frame = bytearray(build_usb_frame(USB_EVT_COUNTER, b"payload"))
    frame[-1] ^= 0xFF
    self.assertEqual(extract_usb_frames(frame), [])
    self.assertEqual(frame, bytearray())

  def test_parses_stable_usb_identity(self):
    name = "Counter-A1B2".encode("utf-8")
    payload = bytes.fromhex("AABBCCDDEEFF") + bytes((len(name),)) + name
    self.assertEqual(parse_identify_payload(payload), ("usb:AABBCCDDEEFF", "Counter-A1B2"))

  def test_rejects_invalid_payload_sizes(self):
    with self.assertRaises(ValueError):
      parse_notification_data(b"short")
    with self.assertRaises(ValueError):
      build_usb_frame(1, bytes(256))
    with self.assertRaises(ValueError):
      parse_identify_payload(b"short")


if __name__ == "__main__":
  unittest.main()
