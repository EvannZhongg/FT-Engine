import asyncio
import struct
import time
import unittest

from workers.local_platform_worker.ft_worker.device_protocol import (
  USB_CMD_IDENTIFY,
  USB_CMD_RENAME,
  USB_CMD_RESET,
  USB_EVT_COUNTER,
  USB_RSP_COMMAND,
  USB_RSP_IDENTIFY,
  build_usb_frame,
)
from workers.local_platform_worker.ft_worker.devices import DeviceService


class FakeBleDevice:
  address = "ble-device-1"
  name = "Counter-0001"


class FakeAdvertisement:
  local_name = "Counter-0001"
  service_uuids = []
  rssi = -42


class FakeBleClient:
  def __init__(self, disconnected_callback):
    self.disconnected_callback = disconnected_callback
    self.is_connected = False
    self.notify = None
    self.writes = []

  async def connect(self):
    self.is_connected = True

  async def start_notify(self, _uuid, callback):
    self.notify = callback

  async def write_gatt_char(self, _uuid, payload, response):
    self.writes.append((bytes(payload), response))

  async def read_gatt_char(self, _uuid):
    return b"Counter-0001"

  async def disconnect(self):
    self.is_connected = False


class FakeBleAdapter:
  ble_available = True
  usb_available = False
  use_ble_heartbeat = False

  def __init__(self):
    self.device = FakeBleDevice()
    self.client = None

  async def scan_ble(self, timeout):
    return [(self.device, FakeAdvertisement())]

  async def find_ble(self, device_id, timeout):
    return self.device if device_id == self.device.address else None

  def create_ble_client(self, device, disconnected_callback):
    self.client = FakeBleClient(disconnected_callback)
    return self.client

  def map_ble_error(self, error):
    return "BLE_UNAVAILABLE"


class FakePort:
  device = "COM9"
  vid = 0x303A
  description = "FT Counter"
  product = "FT Counter"


class FakeSerial:
  def __init__(self):
    self.buffer = bytearray()
    self.writes = []
    self.closed = False

  def reset_input_buffer(self):
    self.buffer.clear()

  def write(self, frame):
    self.writes.append(bytes(frame))
    command = frame[4]
    if command == USB_CMD_IDENTIFY:
      name = b"Counter-A1B2"
      identity = bytes.fromhex("AABBCCDDEEFF") + bytes((len(name),)) + name
      self.buffer.extend(build_usb_frame(USB_RSP_IDENTIFY, identity))
    elif command == USB_CMD_RENAME:
      self.buffer.extend(build_usb_frame(USB_RSP_COMMAND, bytes((USB_CMD_RENAME, 0))))

  def flush(self):
    return None

  def read(self, size):
    if not self.buffer:
      time.sleep(0.002)
      return b""
    value = bytes(self.buffer[:size])
    del self.buffer[:size]
    return value

  def close(self):
    self.closed = True

  def inject_counter(self, payload):
    self.buffer.extend(build_usb_frame(USB_EVT_COUNTER, payload))


class FakeUsbAdapter:
  ble_available = False
  usb_available = True
  use_ble_heartbeat = False

  def __init__(self):
    self.serial_handles = []

  def list_serial_ports(self):
    return [FakePort()]

  def is_supported_serial_port(self, port_info):
    return True

  def open_serial(self, port_path):
    handle = FakeSerial()
    self.serial_handles.append(handle)
    return handle

  def map_serial_error(self, error):
    return "USB_DEVICE_NOT_FOUND"


class DeviceServiceTests(unittest.TestCase):
  def test_ble_scan_session_commands_and_deterministic_events(self):
    async def scenario():
      emitted = []

      async def emit(*event):
        emitted.append(event)

      adapter = FakeBleAdapter()
      service = DeviceService(adapter, emit)
      scanned = await service.scan(remarks={"ble-device-1": "Judge A"})
      self.assertEqual(scanned["devices"][0]["remark"], "Judge A")

      await service.connect("judge-1-primary", "ble-device-1")
      payload = struct.pack("<ibiiI", 2, 1, 3, 1, 1234)
      adapter.client.notify(None, payload)
      adapter.client.notify(None, payload)
      await asyncio.sleep(0)
      await asyncio.sleep(0)

      counter_events = [event for event in emitted if event[0] == "device.counter"]
      self.assertEqual(len(counter_events), 2)
      self.assertEqual(counter_events[0][1]["totalPlus"], 3)
      self.assertEqual(counter_events[0][2], counter_events[1][2])

      await service.reset("judge-1-primary")
      await service.rename("judge-1-primary", "Counter-Test")
      self.assertEqual(adapter.client.writes[0][0], b"\x01")
      self.assertEqual(adapter.client.writes[1][0], b"\x02Counter-Test")
      await service.disconnect("judge-1-primary")

    asyncio.run(scenario())

  def test_usb_scan_uses_identify_id_and_handles_counter_commands(self):
    async def scenario():
      emitted = []

      async def emit(*event):
        emitted.append(event)

      adapter = FakeUsbAdapter()
      service = DeviceService(adapter, emit)
      scanned = await service.scan()
      device = scanned["devices"][0]
      self.assertEqual(device["deviceId"], "usb:AABBCCDDEEFF")

      await service.connect("judge-2-primary", device["deviceId"])
      active_serial = adapter.serial_handles[-1]
      active_serial.inject_counter(struct.pack("<ibiiI", -1, -1, 2, 3, 5678))
      for _ in range(20):
        if any(event[0] == "device.counter" for event in emitted):
          break
        await asyncio.sleep(0.01)

      counter = next(event for event in emitted if event[0] == "device.counter")
      self.assertEqual(counter[1]["transport"], "USB")
      self.assertEqual(counter[1]["currentTotal"], -1)

      await service.reset("judge-2-primary")
      await service.rename("judge-2-primary", "Counter-USB")
      commands = [frame[4] for frame in active_serial.writes]
      self.assertIn(USB_CMD_RESET, commands)
      self.assertIn(USB_CMD_RENAME, commands)
      await service.close()

    asyncio.run(scenario())


if __name__ == "__main__":
  unittest.main()
