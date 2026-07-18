import asyncio
import hashlib
import threading
import time
from typing import Any, Awaitable, Callable

from .device_protocol import (
  USB_CMD_IDENTIFY,
  USB_CMD_RENAME,
  USB_CMD_RESET,
  USB_EVT_COUNTER,
  USB_RSP_COMMAND,
  USB_RSP_IDENTIFY,
  build_usb_frame,
  build_usb_port_address,
  extract_usb_frames,
  parse_identify_payload,
  parse_notification_data,
)


SERVICE_UUID = "025018d0-6951-4a81-de4f-453d8dae9128"
CHARACTERISTIC_UUID = SERVICE_UUID
DEVICE_NAME_UUID = "00002a00-0000-1000-8000-00805f9b34fb"
DEVICE_NAME_PREFIX = "Counter-"


class DeviceError(Exception):
  def __init__(self, code: str, message: str):
    super().__init__(message)
    self.code = code
    self.message = message


def _event_id(device_id: str, event) -> str:
  identity = (
    f"{device_id}:{event.timestamp_ms}:{event.event_type}:"
    f"{event.total_plus}:{event.total_minus}"
  )
  return hashlib.sha256(identity.encode("utf-8")).hexdigest()[:32]


def _read_usb_frame(ser, expect_type: int, timeout: float = 0.5):
  buffer = bytearray()
  deadline = time.monotonic() + timeout
  while time.monotonic() < deadline:
    chunk = ser.read(128)
    if not chunk:
      continue
    buffer.extend(chunk)
    for frame_type, payload in extract_usb_frames(buffer):
      if frame_type == expect_type:
        return payload
  raise DeviceError("USB_DEVICE_NOT_FOUND", "USB device did not respond")


def _identify_serial(adapter, port_path: str, timeout: float = 0.5):
  ser = adapter.open_serial(port_path)
  try:
    time.sleep(0.05)
    ser.reset_input_buffer()
    ser.write(build_usb_frame(USB_CMD_IDENTIFY))
    ser.flush()
    payload = _read_usb_frame(ser, USB_RSP_IDENTIFY, timeout)
    stable_id, name = parse_identify_payload(payload)
    return stable_id, name
  finally:
    ser.close()


class BleSession:
  def __init__(self, connection_id, device_id, device, adapter, emit):
    self.connection_id = connection_id
    self.device_id = device_id
    self.device = device
    self.adapter = adapter
    self.emit = emit
    self.client = None
    self.intentional_disconnect = False
    self.reconnect_task = None
    self.heartbeat_task = None
    self.loop = asyncio.get_running_loop()
    self.connect_lock = asyncio.Lock()

  async def connect(self):
    self.intentional_disconnect = False
    await self._connect_once()

  async def _connect_once(self):
    async with self.connect_lock:
      if self.heartbeat_task and not self.heartbeat_task.done():
        self.heartbeat_task.cancel()
      await self.emit("device.status", {
        "connectionId": self.connection_id,
        "deviceId": self.device_id,
        "status": "connecting",
      })
      device = self.device or await self.adapter.find_ble(self.device_id, 4.0)
      if device is None:
        raise DeviceError("BLE_DEVICE_NOT_FOUND", "BLE device was not found")
      self.device = device
      client = self.adapter.create_ble_client(device, self._on_disconnected)
      try:
        await asyncio.wait_for(client.connect(), timeout=10.0)
        await client.start_notify(CHARACTERISTIC_UUID, self._on_notification)
      except Exception as error:
        try:
          await client.disconnect()
        except Exception:
          pass
        raise DeviceError(self.adapter.map_ble_error(error), "BLE connection failed") from error
      self.client = client
      await self.emit("device.status", {
        "connectionId": self.connection_id,
        "deviceId": self.device_id,
        "status": "connected",
      })
      if self.adapter.use_ble_heartbeat:
        self.heartbeat_task = asyncio.create_task(self._heartbeat())

  def _on_notification(self, _sender, data):
    try:
      event = parse_notification_data(bytes(data))
    except ValueError:
      return
    self.loop.call_soon_threadsafe(
      lambda: asyncio.create_task(self._emit_counter(event))
    )

  async def _emit_counter(self, event):
    await self.emit("device.counter", {
      "connectionId": self.connection_id,
      "deviceId": self.device_id,
      "transport": "BLE",
      "currentTotal": event.current_total,
      "eventType": event.event_type,
      "totalPlus": event.total_plus,
      "totalMinus": event.total_minus,
      "deviceTimestampMs": event.timestamp_ms,
    }, _event_id(self.device_id, event))

  def _on_disconnected(self, _client):
    if self.intentional_disconnect:
      return
    self.loop.call_soon_threadsafe(self._start_reconnect)

  def _start_reconnect(self):
    if self.reconnect_task is None or self.reconnect_task.done():
      self.reconnect_task = asyncio.create_task(self._reconnect())

  async def _reconnect(self):
    await self.emit("device.status", {
      "connectionId": self.connection_id,
      "deviceId": self.device_id,
      "status": "error",
    })
    while not self.intentional_disconnect:
      await asyncio.sleep(3.0)
      try:
        await self._connect_once()
        return
      except DeviceError:
        continue

  async def _heartbeat(self):
    failures = 0
    try:
      while not self.intentional_disconnect and self.client:
        await asyncio.sleep(5.0)
        try:
          await self.client.read_gatt_char(DEVICE_NAME_UUID)
          failures = 0
        except Exception:
          failures += 1
          if failures >= 2:
            await self.client.disconnect()
            return
    except asyncio.CancelledError:
      return

  async def reset(self):
    if not self.client or not self.client.is_connected:
      raise DeviceError("BLE_DEVICE_NOT_FOUND", "BLE device is disconnected")
    try:
      await self.client.write_gatt_char(CHARACTERISTIC_UUID, b"\x01", response=True)
    except Exception as error:
      raise DeviceError(self.adapter.map_ble_error(error), "BLE reset failed") from error

  async def rename(self, name: str):
    if not self.client or not self.client.is_connected:
      raise DeviceError("BLE_DEVICE_NOT_FOUND", "BLE device is disconnected")
    try:
      await self.client.write_gatt_char(
        CHARACTERISTIC_UUID, b"\x02" + name.encode("utf-8"), response=True
      )
    except Exception as error:
      raise DeviceError(self.adapter.map_ble_error(error), "BLE rename failed") from error

  async def disconnect(self):
    self.intentional_disconnect = True
    for task in (self.reconnect_task, self.heartbeat_task):
      if task and not task.done():
        task.cancel()
    if self.client:
      try:
        await self.client.disconnect()
      except Exception:
        pass
      self.client = None
    await self.emit("device.status", {
      "connectionId": self.connection_id,
      "deviceId": self.device_id,
      "status": "disconnected",
    })


class SerialSession:
  def __init__(self, connection_id, device_id, port_path, adapter, resolve_path, emit):
    self.connection_id = connection_id
    self.device_id = device_id
    self.port_path = port_path
    self.adapter = adapter
    self.resolve_path = resolve_path
    self.emit = emit
    self.serial = None
    self.reader_thread = None
    self.stop_event = threading.Event()
    self.io_lock = threading.Lock()
    self.intentional_disconnect = False
    self.reconnect_task = None
    self.loop = asyncio.get_running_loop()

  async def connect(self):
    self.intentional_disconnect = False
    await self._connect_once()

  async def _connect_once(self):
    await self.emit("device.status", {
      "connectionId": self.connection_id,
      "deviceId": self.device_id,
      "status": "connecting",
    })
    latest_path = await self.resolve_path(self.device_id)
    if latest_path:
      self.port_path = latest_path
    await asyncio.to_thread(self._open_sync)
    self.stop_event.clear()
    self.reader_thread = threading.Thread(
      target=self._reader_worker,
      name=f"ft-worker-{self.connection_id}",
      daemon=True,
    )
    self.reader_thread.start()
    await self.emit("device.status", {
      "connectionId": self.connection_id,
      "deviceId": self.device_id,
      "status": "connected",
    })

  def _open_sync(self):
    try:
      self.serial = self.adapter.open_serial(self.port_path)
      time.sleep(0.05)
      with self.io_lock:
        self.serial.reset_input_buffer()
        self.serial.write(build_usb_frame(USB_CMD_IDENTIFY))
        self.serial.flush()
        payload = _read_usb_frame(self.serial, USB_RSP_IDENTIFY, 0.8)
      stable_id, _name = parse_identify_payload(payload)
      if self.device_id.startswith("usb:") and stable_id != self.device_id:
        raise DeviceError("USB_DEVICE_NOT_FOUND", "USB identity changed")
    except DeviceError:
      self._close_sync()
      raise
    except Exception as error:
      self._close_sync()
      raise DeviceError(
        self.adapter.map_serial_error(error), "USB connection failed"
      ) from error

  def _reader_worker(self):
    buffer = bytearray()
    try:
      while not self.stop_event.is_set() and self.serial:
        with self.io_lock:
          chunk = self.serial.read(128)
        if not chunk:
          continue
        buffer.extend(chunk)
        for frame_type, payload in extract_usb_frames(buffer):
          if frame_type != USB_EVT_COUNTER:
            continue
          try:
            event = parse_notification_data(payload)
          except ValueError:
            continue
          self.loop.call_soon_threadsafe(
            lambda value=event: asyncio.create_task(self._emit_counter(value))
          )
    except Exception:
      if not self.intentional_disconnect:
        self.loop.call_soon_threadsafe(self._start_reconnect)

  async def _emit_counter(self, event):
    await self.emit("device.counter", {
      "connectionId": self.connection_id,
      "deviceId": self.device_id,
      "transport": "USB",
      "currentTotal": event.current_total,
      "eventType": event.event_type,
      "totalPlus": event.total_plus,
      "totalMinus": event.total_minus,
      "deviceTimestampMs": event.timestamp_ms,
    }, _event_id(self.device_id, event))

  def _start_reconnect(self):
    if self.reconnect_task is None or self.reconnect_task.done():
      self.reconnect_task = asyncio.create_task(self._reconnect())

  async def _reconnect(self):
    await asyncio.to_thread(self._close_sync)
    await self.emit("device.status", {
      "connectionId": self.connection_id,
      "deviceId": self.device_id,
      "status": "error",
    })
    while not self.intentional_disconnect:
      await asyncio.sleep(3.0)
      try:
        await self._connect_once()
        return
      except Exception:
        continue

  def _send_command_sync(self, command: int, payload: bytes = b"", expect_response=False):
    if not self.serial:
      raise DeviceError("USB_DEVICE_NOT_FOUND", "USB device is disconnected")
    with self.io_lock:
      self.serial.reset_input_buffer()
      self.serial.write(build_usb_frame(command, payload))
      self.serial.flush()
      if not expect_response:
        return None
      return _read_usb_frame(self.serial, USB_RSP_COMMAND, 0.8)

  async def reset(self):
    try:
      await asyncio.to_thread(self._send_command_sync, USB_CMD_RESET)
    except DeviceError:
      raise
    except Exception as error:
      raise DeviceError(self.adapter.map_serial_error(error), "USB reset failed") from error

  async def rename(self, name: str):
    try:
      response = await asyncio.to_thread(
        self._send_command_sync, USB_CMD_RENAME, name.encode("utf-8"), True
      )
    except DeviceError:
      raise
    except Exception as error:
      raise DeviceError(self.adapter.map_serial_error(error), "USB rename failed") from error
    if not response or len(response) < 2 or response[0] != USB_CMD_RENAME or response[1] != 0:
      raise DeviceError("USB_COMMAND_REJECTED", "USB rename was rejected")

  async def disconnect(self):
    self.intentional_disconnect = True
    if self.reconnect_task and not self.reconnect_task.done():
      self.reconnect_task.cancel()
    self.stop_event.set()
    await asyncio.to_thread(self._close_sync)
    thread = self.reader_thread
    self.reader_thread = None
    if thread and thread.is_alive():
      await asyncio.to_thread(thread.join, 0.5)
    await self.emit("device.status", {
      "connectionId": self.connection_id,
      "deviceId": self.device_id,
      "status": "disconnected",
    })

  def _close_sync(self):
    serial_handle = self.serial
    self.serial = None
    if serial_handle:
      try:
        serial_handle.close()
      except Exception:
        pass


class DeviceService:
  def __init__(self, adapter, emit: Callable[..., Awaitable[None]]):
    self.adapter = adapter
    self.emit = emit
    self.ble_devices = {}
    self.usb_devices = {}
    self.sessions = {}

  async def scan(self, flush=False, remarks=None):
    if flush:
      self.ble_devices.clear()
      self.usb_devices.clear()
    remarks = remarks if isinstance(remarks, dict) else {}
    errors = []
    devices = []

    if self.adapter.ble_available:
      try:
        discovered = await self.adapter.scan_ble(1.5 if flush else 0.8)
        for device, advertisement in discovered:
          name = advertisement.local_name or device.name or "Unknown"
          service_uuids = [str(value).lower() for value in advertisement.service_uuids or []]
          if not name.startswith(DEVICE_NAME_PREFIX) and SERVICE_UUID not in service_uuids:
            continue
          device_id = str(device.address)
          rssi = advertisement.rssi if isinstance(advertisement.rssi, (int, float)) else -1000
          self.ble_devices[device_id] = device
          devices.append({
            "name": name,
            "address": device_id,
            "deviceId": device_id,
            "rssi": rssi,
            "remark": str(remarks.get(device_id) or ""),
            "transport": "BLE",
          })
      except Exception as error:
        errors.append({"transport": "BLE", "code": self.adapter.map_ble_error(error)})

    if self.adapter.usb_available:
      ports = await asyncio.to_thread(self.adapter.list_serial_ports)
      for port_info in ports:
        if not self.adapter.is_supported_serial_port(port_info):
          continue
        port_path = str(port_info.device)
        try:
          device_id, name = await asyncio.to_thread(
            _identify_serial, self.adapter, port_path, 0.35
          )
        except Exception:
          device_id = build_usb_port_address(port_path)
          name = str(
            getattr(port_info, "description", None) or
            getattr(port_info, "product", None) or
            "USB Serial/JTAG"
          )
        self.usb_devices[device_id] = port_path
        devices.append({
          "name": name,
          "address": device_id,
          "deviceId": device_id,
          "rssi": -1000,
          "remark": str(remarks.get(device_id) or ""),
          "transport": "USB",
        })

    devices.sort(key=lambda value: value.get("rssi", -1000), reverse=True)
    return {"devices": devices, "errors": errors}

  async def connect(self, connection_id: str, device_id: str):
    if connection_id in self.sessions:
      raise DeviceError("DEVICE_ALREADY_CONNECTED", "Connection id is already active")
    if device_id in self.usb_devices or device_id.startswith("usb:") or device_id.startswith("usbport:"):
      port_path = await self._resolve_usb_path(device_id)
      if not port_path:
        raise DeviceError("USB_DEVICE_NOT_FOUND", "USB device was not found")
      session = SerialSession(
        connection_id, device_id, port_path, self.adapter, self._resolve_usb_path, self.emit
      )
    else:
      device = self.ble_devices.get(device_id)
      session = BleSession(connection_id, device_id, device, self.adapter, self.emit)
    self.sessions[connection_id] = session
    try:
      await session.connect()
    except Exception:
      await session.disconnect()
      self.sessions.pop(connection_id, None)
      raise
    return {"connectionId": connection_id, "deviceId": device_id}

  async def disconnect(self, connection_id: str):
    session = self.sessions.pop(connection_id, None)
    if session:
      await session.disconnect()
    return {"connectionId": connection_id}

  async def reset(self, connection_id: str):
    session = self._session(connection_id)
    await session.reset()
    return {"connectionId": connection_id}

  async def rename(self, connection_id: str, name: str):
    session = self._session(connection_id)
    await session.rename(name)
    return {"connectionId": connection_id, "name": name}

  async def close(self):
    sessions = list(self.sessions.values())
    self.sessions.clear()
    if sessions:
      await asyncio.gather(*(session.disconnect() for session in sessions), return_exceptions=True)

  def _session(self, connection_id: str):
    session = self.sessions.get(connection_id)
    if session is None:
      raise DeviceError("DEVICE_NOT_CONNECTED", "Device connection is not active")
    return session

  async def _resolve_usb_path(self, device_id: str):
    if device_id in self.usb_devices:
      return self.usb_devices[device_id]
    if device_id.startswith("usbport:"):
      return device_id.removeprefix("usbport:")
    result = await self.scan(flush=True)
    if result["errors"]:
      return None
    return self.usb_devices.get(device_id)
