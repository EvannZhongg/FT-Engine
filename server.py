import asyncio
import time
import threading
import uuid
from dataclasses import asdict
from contextlib import asynccontextmanager
from datetime import datetime
from fastapi.responses import StreamingResponse
import json
import os
import yaml
from typing import Optional

import uvicorn
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from bleak import BleakScanner, BleakClient
import pygetwindow as gw
import serial
from serial.tools import list_ports

from utils.app_settings import app_settings
from utils.exporter import ExportManager
from utils.platform import get_ble_heartbeat_config, should_enable_ble_heartbeat
from utils.runtime import get_config_path
from utils.media import MediaCapture, normalize_youtube_url, playback_anchors
from utils.storage import ScoreEventSnapshot, storage_manager
from workers.local_platform_worker.ft_worker.device_protocol import (
  USB_CMD_IDENTIFY,
  USB_CMD_RENAME,
  USB_CMD_RESET,
  USB_EVT_COUNTER,
  USB_PORT_PREFIX,
  USB_RSP_COMMAND,
  USB_RSP_IDENTIFY,
  USB_SERIAL_PREFIX,
  build_usb_frame,
  build_usb_port_address,
  extract_usb_frames,
  parse_identify_payload,
  parse_notification_data,
)

SERVICE_UUID = "025018d0-6951-4a81-de4f-453d8dae9128"
CHARACTERISTIC_UUID = "025018d0-6951-4a81-de4f-453d8dae9128"
STANDARD_DEVICE_NAME_UUID = "00002a00-0000-1000-8000-00805f9b34fb"

DEVICE_NAME_PREFIX = "Counter-"
DEBUG_SCORE_LATENCY = os.environ.get("DEBUG_SCORE_LATENCY", "").strip() == "1"
EMIT_SHADOW_EVENTS = os.environ.get("FT_ENGINE_SHADOW_EVENTS", "").strip() == "1"
SHADOW_EVENT_PREFIX = "FT_SHADOW_EVENT "
ESPRESSIF_USB_VID = 0x303A
SERIAL_SCAN_TIMEOUT = 0.35

_main_loop = None

match_state = {
    "current_group": "Free Mode",
    "current_contestant": "",
    "config": {}
}


def load_config():
  port = 8000
  config_path = get_config_path()

  if os.path.exists(config_path):
    try:
      with open(config_path, 'r', encoding='utf-8') as f:
        config = yaml.safe_load(f)
        if config and 'server_port' in config:
          port = int(config['server_port'])
          print(f"[Config] Loaded port from config.yaml: {port}")
    except Exception as e:
      print(f"[Config] Failed to load config.yaml, using default: {e}")
  else:
    print(f"[Config] config.yaml not found at {config_path}, using default port 8000")

  return port


def get_remark_for_id(remarks: dict, device_id: str, legacy_ble_id: Optional[str] = None) -> str:
  if device_id in remarks:
    return remarks[device_id]
  if legacy_ble_id and legacy_ble_id in remarks:
    return remarks[legacy_ble_id]
  return ""


def invoke_in_main_loop(callback, *args):
  if not callback:
    return
  if _main_loop and _main_loop.is_running():
    _main_loop.call_soon_threadsafe(callback, *args)
  else:
    callback(*args)


class ScannerManager:
  def __init__(self):
    self.scanner = None
    self.is_scanning = False
    self.found_ble_devices = {}
    self.serial_devices = {}
    self.device_ttl = 8.0
    self.init_error = None

  def _detection_callback(self, device, advertisement_data):
    self.found_ble_devices[device.address] = {
      "device": device, "adv": advertisement_data, "ts": time.time()
    }

  async def start(self):
    if self.is_scanning:
      return

    print("[Scanner] Starting background scan...")
    self.get_active_devices()

    try:
      self.init_error = None
      self.scanner = BleakScanner(detection_callback=self._detection_callback)
      await self.scanner.start()
      self.is_scanning = True
    except Exception as e:
      print(f"[Scanner] Start failed (Bluetooth might be off): {e}")
      self.init_error = str(e)
      self.is_scanning = False

  async def stop(self):
    if not self.is_scanning:
      return

    print("[Scanner] Stopping background scan...")
    try:
      await self.scanner.stop()
    except Exception:
      pass

    self.scanner = None
    self.is_scanning = False

  def get_active_devices(self):
    now = time.time()
    expired = [k for k, v in self.found_ble_devices.items() if now - v['ts'] > self.device_ttl]
    for key in expired:
      del self.found_ble_devices[key]

    remarks = app_settings.get("device_remarks") or {}
    results = []

    for entry in self.found_ble_devices.values():
      device = entry['device']
      adv = entry['adv']
      real_name = adv.local_name or device.name or "Unknown"
      is_target = False

      if real_name.startswith(DEVICE_NAME_PREFIX):
        is_target = True
      elif adv.service_uuids:
        for uuid in adv.service_uuids:
          if str(uuid).lower() == CHARACTERISTIC_UUID.lower():
            is_target = True
            break

      if is_target:
        results.append({
          "name": real_name,
          "address": device.address,
          "rssi": adv.rssi,
          "remark": get_remark_for_id(remarks, device.address),
          "transport": "BLE"
        })

    results.extend(self.serial_devices.values())
    results.sort(key=lambda x: x['rssi'], reverse=True)
    return results

  def clear_cache(self):
    self.found_ble_devices.clear()
    self.serial_devices.clear()

  def _is_likely_esp_usb_port(self, port_info) -> bool:
    if port_info.vid == ESPRESSIF_USB_VID:
      return True

    haystack = " ".join(
      filter(None, [
        getattr(port_info, "manufacturer", None),
        getattr(port_info, "description", None),
        getattr(port_info, "product", None),
        getattr(port_info, "hwid", None)
      ])
    ).lower()
    return "espressif" in haystack or "jtag" in haystack or "303a" in haystack

  async def refresh_serial_devices(self):
    remarks = app_settings.get("device_remarks") or {}

    def worker():
      found = {}
      for port_info in list_ports.comports():
        if not self._is_likely_esp_usb_port(port_info):
          continue

        description = (port_info.description or getattr(port_info, "product", None) or "USB Serial/JTAG").strip()
        address = build_usb_port_address(port_info.device)
        found[address] = {
          "name": description,
          "address": address,
          "rssi": -1000,
          "remark": get_remark_for_id(remarks, address),
          "transport": "USB",
          "path": port_info.device,
          "description": description
        }
      return found

    self.serial_devices = await asyncio.to_thread(worker)
    return self.serial_devices

  async def resolve_device(self, address: str):
    if not address:
      return None

    if address.startswith(USB_PORT_PREFIX):
      if address not in self.serial_devices:
        await self.refresh_serial_devices()
      return self.serial_devices.get(address)
    if address.startswith(USB_SERIAL_PREFIX):
      return await asyncio.to_thread(_resolve_legacy_usb_device_sync, address)

    self.get_active_devices()
    entry = self.found_ble_devices.get(address)
    if entry:
      return {
        "transport": "BLE",
        "address": address,
        "device": entry["device"]
      }

    try:
      ble_device = await BleakScanner.find_device_by_address(address, timeout=4.0)
    except Exception:
      ble_device = None

    if ble_device:
      return {
        "transport": "BLE",
        "address": address,
        "device": ble_device
      }
    return None


scanner_manager = ScannerManager()


def _read_usb_frame_from_serial(ser, expect_type: int, timeout: float = 0.5):
  buffer = bytearray()
  deadline = time.time() + timeout

  while time.time() < deadline:
    chunk = ser.read(128)
    if not chunk:
      continue

    buffer.extend(chunk)
    for rx_type, rx_payload in extract_usb_frames(buffer):
      if rx_type == expect_type:
        return True, rx_payload

  return False, "timeout"


def _identify_usb_serial(ser, timeout: float = 0.5):
  ser.reset_input_buffer()
  ser.write(build_usb_frame(USB_CMD_IDENTIFY))
  ser.flush()

  ok, payload = _read_usb_frame_from_serial(ser, USB_RSP_IDENTIFY, timeout=timeout)
  if not ok:
    return False, payload

  try:
    stable_id, device_name = parse_identify_payload(payload)
  except Exception as e:
    return False, str(e)

  return True, {"stable_id": stable_id, "name": device_name}


def _resolve_legacy_usb_device_sync(address: str):
  for port_info in list_ports.comports():
    haystack = " ".join(
      filter(None, [
        getattr(port_info, "manufacturer", None),
        getattr(port_info, "description", None),
        getattr(port_info, "product", None),
        getattr(port_info, "hwid", None)
      ])
    ).lower()
    if ESPRESSIF_USB_VID != getattr(port_info, "vid", None) and "espressif" not in haystack and "jtag" not in haystack and "303a" not in haystack:
      continue

    ser = None
    try:
      ser = serial.Serial(
        port=port_info.device,
        baudrate=115200,
        timeout=0.05,
        write_timeout=0.2,
        rtscts=False,
        dsrdtr=False
      )
      time.sleep(0.05)
      ok, identify = _identify_usb_serial(ser, timeout=SERIAL_SCAN_TIMEOUT)
      if not ok:
        continue
      if identify["stable_id"] != address:
        continue

      return {
        "name": identify["name"],
        "address": build_usb_port_address(port_info.device),
        "rssi": -1000,
        "remark": "",
        "transport": "USB",
        "path": port_info.device,
        "description": port_info.description or port_info.device,
        "stable_id": identify["stable_id"]
      }
    except Exception:
      continue
    finally:
      try:
        if ser:
          ser.close()
      except Exception:
        pass

  return None


def _send_usb_command_sync(port_path: str, frame_type: int, payload: bytes = b"", expect_type: Optional[int] = None,
                           timeout: float = 0.5):
  ser = None
  try:
    ser = serial.Serial(
      port=port_path,
      baudrate=115200,
      timeout=0.05,
      write_timeout=0.2,
      rtscts=False,
      dsrdtr=False
    )
    time.sleep(0.05)
    if frame_type == USB_CMD_IDENTIFY:
      ok, identify = _identify_usb_serial(ser, timeout=timeout)
      return (True, identify) if ok else (False, identify)

    ser.reset_input_buffer()
    ser.write(build_usb_frame(frame_type, payload))
    ser.flush()

    if expect_type is None:
      return True, None

    return _read_usb_frame_from_serial(ser, expect_type, timeout=timeout)
  except Exception as e:
    return False, str(e)
  finally:
    try:
      if ser:
        ser.close()
    except Exception:
      pass


async def send_rename_command(device_info: dict, name: str):
  if device_info.get("transport") == "USB":
    ok, response = await asyncio.to_thread(
      _send_usb_command_sync,
      device_info["path"],
      USB_CMD_RENAME,
      name.encode("utf-8"),
      USB_RSP_COMMAND
    )
    if not ok:
      return False, response or "USB rename failed"
    if not response or len(response) < 2 or response[0] != USB_CMD_RENAME or response[1] != 0:
      return False, "USB rename rejected"
    return True, ""

  ble_device = device_info.get("device")
  client = BleakClient(ble_device)
  payload = b"\x02" + name.encode("utf-8")

  try:
    await client.connect()
    await asyncio.sleep(0.3)
    await client.write_gatt_char(CHARACTERISTIC_UUID, payload, response=True)
    await asyncio.sleep(0.3)
    return True, ""
  except Exception as e:
    return False, str(e)
  finally:
    try:
      if client.is_connected:
        await client.disconnect()
    except Exception:
      pass


class HeadlessDeviceNode:
  def __init__(self, ble_device, on_data_callback, on_status_callback):
    self.ble_device = ble_device
    self.client = None
    self.on_data_callback = on_data_callback
    self.on_status_callback = on_status_callback

    self.intentional_disconnect = False
    self.is_reconnecting = False
    self._heartbeat_task = None

  async def connect(self):
    self.intentional_disconnect = False
    return await self._do_connect()

  async def _do_connect(self):
    self._emit_status("connecting")
    print(f"Connecting to {self.ble_device.name}...")

    try:
      self.client = BleakClient(self.ble_device, disconnected_callback=self._on_disconnect)
      await self.client.connect()
      print(f"Connected: {self.ble_device.name}")

      await asyncio.sleep(1.5)

      if not self.client:
        print(f"Connection aborted for {self.ble_device.name} during setup.")
        return False

      try:
        await self.client.read_gatt_char(STANDARD_DEVICE_NAME_UUID)
      except Exception:
        pass

      if not self.client:
        return False

      await self.client.start_notify(CHARACTERISTIC_UUID, self._on_notify)
      self._emit_status("connected")

      if self._heartbeat_task:
        self._heartbeat_task.cancel()
      self._heartbeat_task = asyncio.create_task(self._heartbeat_loop()) if should_enable_ble_heartbeat() else None

      return True
    except Exception as e:
      print(f"Conn failed: {e}")

      try:
        if self.client and self.client.services:
          print("--- Debug: Services Found ---")
          for service in self.client.services:
            print(f"   Service: {service.uuid}")
          print("-----------------------------")
      except Exception:
        pass

      await self._ensure_disconnect()

      if not self.intentional_disconnect:
        self._trigger_reconnect()
      else:
        self._emit_status("disconnected")
      return False

  async def disconnect(self):
    self.intentional_disconnect = True
    if self._heartbeat_task:
      self._heartbeat_task.cancel()
      self._heartbeat_task = None

    await self._ensure_disconnect()
    self._emit_status("disconnected")

  async def _ensure_disconnect(self):
    if self.client:
      try:
        if self.client.is_connected:
          print(f"Terminating connection to {self.ble_device.name}...")
          await self.client.disconnect()
      except Exception as e:
        print(f"Disconnect error (ignored): {e}")
      finally:
        self.client = None

  def _on_disconnect(self, client):
    print(f"Disconnected callback: {self.ble_device.name}")
    if self._heartbeat_task:
      self._heartbeat_task.cancel()

    if not self.intentional_disconnect:
      self._trigger_reconnect()
    else:
      self._emit_status("disconnected")

  def _trigger_reconnect(self):
    if self.is_reconnecting:
      return

    self._emit_status("error")
    print(f"Connection lost! Auto-reconnect {self.ble_device.name}...")
    asyncio.create_task(self._reconnect_loop())

  async def _reconnect_loop(self):
    self.is_reconnecting = True
    while not self.intentional_disconnect:
      print(f"Retrying {self.ble_device.name} in 3s...")
      await asyncio.sleep(3.0)

      if self.intentional_disconnect:
        break

      if await self._do_connect():
        print(f"Reconnected: {self.ble_device.name}")
        self.is_reconnecting = False
        return

    self.is_reconnecting = False

  async def _heartbeat_loop(self):
    interval, retry_delay, fail_threshold = get_ble_heartbeat_config()
    consecutive_failures = 0

    try:
      while True:
        await asyncio.sleep(interval)
        if not self.client:
          break

        heartbeat_error = None
        try:
          await self.client.read_gatt_char(STANDARD_DEVICE_NAME_UUID)
        except Exception as e:
          heartbeat_error = e

        if heartbeat_error and retry_delay > 0 and self.client:
          await asyncio.sleep(retry_delay)
          try:
            if self.client:
              await self.client.read_gatt_char(STANDARD_DEVICE_NAME_UUID)
            heartbeat_error = None
          except Exception:
            pass

        if heartbeat_error and self.client:
          consecutive_failures += 1
          if consecutive_failures < fail_threshold:
            continue

          print(f"Heartbeat failed ({heartbeat_error}), active disconnect...")
          await self._ensure_disconnect()
          if not self.intentional_disconnect:
            self._trigger_reconnect()
          break

        consecutive_failures = 0
    except asyncio.CancelledError:
      pass

  def _emit_status(self, status):
    if self.on_status_callback:
      self.on_status_callback(status)

  async def send_reset(self):
    if self.client:
      try:
        await self.client.write_gatt_char(CHARACTERISTIC_UUID, b'\x01', response=True)
      except Exception:
        pass

  def _on_notify(self, sender, data):
    try:
      if DEBUG_SCORE_LATENCY:
        print(f"[BLE] recv t={time.perf_counter():.3f} bytes={len(data)}")
      evt = parse_notification_data(data)
      if self.on_data_callback:
        self.on_data_callback(evt.current_total, evt.event_type, evt.total_plus, evt.total_minus, evt.timestamp_ms)
    except Exception:
      pass


class SerialDeviceNode:
  def __init__(self, device_info, on_data_callback, on_status_callback):
    self.device_id = device_info["address"]
    self.device_name = device_info.get("name") or self.device_id
    self.port_path = device_info["path"]
    self.on_data_callback = on_data_callback
    self.on_status_callback = on_status_callback

    self.intentional_disconnect = False
    self.is_reconnecting = False
    self.serial = None
    self._reader_thread = None
    self._stop_event = threading.Event()
    self._buffer = bytearray()

  async def connect(self):
    self.intentional_disconnect = False
    return await self._do_connect()

  async def _do_connect(self):
    self._emit_status("connecting")
    print(f"Connecting to {self.device_name} via USB ({self.port_path})...")

    device_info = await scanner_manager.resolve_device(self.device_id)
    if device_info and device_info.get("path"):
      self.port_path = device_info["path"]
      self.device_name = device_info.get("name") or self.device_name

    try:
      self.serial = await asyncio.to_thread(
        serial.Serial,
        self.port_path,
        115200,
        timeout=0.1,
        write_timeout=0.2,
        rtscts=False,
        dsrdtr=False
      )
      await asyncio.sleep(0.05)
      ok, identify = await asyncio.to_thread(_identify_usb_serial, self.serial, 0.8)
      if not ok:
        raise RuntimeError(f"USB identify failed: {identify}")

      self.device_name = identify["name"] or self.device_name
      print(f"USB identify ok: {self.device_name} on {self.port_path}")
    except Exception as e:
      print(f"USB conn failed: {e}")
      await self._ensure_disconnect()
      if not self.intentional_disconnect:
        self._trigger_reconnect()
      else:
        self._emit_status("disconnected")
      return False

    self._stop_event.clear()
    self._buffer.clear()
    self._reader_thread = threading.Thread(target=self._reader_worker, name=f"usb-node-{self.device_id}", daemon=True)
    self._reader_thread.start()
    self._emit_status("connected")
    return True

  async def disconnect(self):
    self.intentional_disconnect = True
    await self._ensure_disconnect()
    self._emit_status("disconnected")

  async def _ensure_disconnect(self):
    self._stop_event.set()

    ser = self.serial
    self.serial = None
    if ser:
      try:
        await asyncio.to_thread(ser.close)
      except Exception:
        pass

    thread = self._reader_thread
    self._reader_thread = None
    if thread and thread.is_alive():
      await asyncio.to_thread(thread.join, 0.5)

  def _reader_worker(self):
    try:
      while not self._stop_event.is_set():
        if not self.serial:
          break

        chunk = self.serial.read(128)
        if not chunk:
          continue

        self._buffer.extend(chunk)
        for frame_type, payload in extract_usb_frames(self._buffer):
          if frame_type != USB_EVT_COUNTER:
            continue

          try:
            evt = parse_notification_data(payload)
          except Exception:
            continue

          invoke_in_main_loop(
            self.on_data_callback,
            evt.current_total,
            evt.event_type,
            evt.total_plus,
            evt.total_minus,
            evt.timestamp_ms
          )
    except Exception as e:
      if not self.intentional_disconnect:
        print(f"USB reader lost for {self.device_name}: {e}")
        invoke_in_main_loop(self._handle_unexpected_disconnect)

  def _handle_unexpected_disconnect(self):
    if self.intentional_disconnect:
      return
    asyncio.create_task(self._recover_after_disconnect())

  async def _recover_after_disconnect(self):
    await self._ensure_disconnect()
    if not self.intentional_disconnect:
      self._trigger_reconnect()

  def _trigger_reconnect(self):
    if self.is_reconnecting:
      return

    self._emit_status("error")
    print(f"USB connection lost! Auto-reconnect {self.device_name}...")
    asyncio.create_task(self._reconnect_loop())

  async def _reconnect_loop(self):
    self.is_reconnecting = True
    while not self.intentional_disconnect:
      print(f"Retrying {self.device_name} in 3s...")
      await asyncio.sleep(3.0)

      if self.intentional_disconnect:
        break

      if await self._do_connect():
        print(f"Reconnected: {self.device_name}")
        self.is_reconnecting = False
        return

    self.is_reconnecting = False

  def _emit_status(self, status):
    if self.on_status_callback:
      invoke_in_main_loop(self.on_status_callback, status)

  async def send_reset(self):
    if not self.serial:
      return
    try:
      await asyncio.to_thread(self.serial.write, build_usb_frame(USB_CMD_RESET))
      await asyncio.to_thread(self.serial.flush)
    except Exception:
      pass


class HeadlessReferee:
  def __init__(self, index, name, mode, broadcast_func):
    self.index = index
    self.name = name
    self.mode = mode
    self.broadcast = broadcast_func
    self.pri_dev = None
    self.sec_dev = None
    self.score = {"total": 0, "plus": 0, "minus": 0, "penalty": 0}
    self.pri_cache = [0, 0]
    self.sec_cache = [0, 0]
    self.status = {"pri": "disconnected", "sec": "disconnected" if mode == "DUAL" else "n/a"}

  def set_devices(self, pri, sec=None):
    self.pri_dev = pri
    if pri:
      pri.on_data_callback = self._on_pri_data
      pri.on_status_callback = lambda s: self._on_status_change("pri", s)

    self.sec_dev = sec
    if sec:
      sec.on_data_callback = self._on_sec_data
      sec.on_status_callback = lambda s: self._on_status_change("sec", s)

  async def reset(self):
    tasks = []
    if self.pri_dev:
      tasks.append(self.pri_dev.send_reset())
    if self.sec_dev:
      tasks.append(self.sec_dev.send_reset())
    if tasks:
      await asyncio.gather(*tasks, return_exceptions=True)
    self.pri_cache = [0, 0]
    self.sec_cache = [0, 0]
    self._update_score_state()
    self._broadcast_update("score_update")

  def _on_status_change(self, role, status):
    self.status[role] = status
    self._broadcast_update("status_update")

  def _schedule_record_log(self, snapshot):
    if snapshot is None:
      return
    if EMIT_SHADOW_EVENTS:
      print(
        SHADOW_EVENT_PREFIX + json.dumps(asdict(snapshot), ensure_ascii=True, separators=(",", ":")),
        flush=True,
      )
    if _main_loop is None:
      storage_manager.log_event(snapshot)
      return

    def runner():
      asyncio.create_task(asyncio.to_thread(storage_manager.log_event, snapshot))

    _main_loop.call_soon_threadsafe(runner)

  def _on_pri_data(self, cur, typ, p, m, ts):
    started_at = time.perf_counter() if DEBUG_SCORE_LATENCY else None
    arrived_monotonic = time.monotonic()
    system_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    self.pri_cache = [p, m]
    self._update_score_state()
    self._schedule_record_log(self._capture_record_snapshot(
      "PRIMARY", typ, ts, arrived_monotonic, system_time
    ))
    self._broadcast_update("score_update")
    if DEBUG_SCORE_LATENCY:
      print(f"[Score] pri_data done in {(time.perf_counter() - started_at) * 1000:.1f} ms")

  def _on_sec_data(self, cur, typ, p, m, ts):
    started_at = time.perf_counter() if DEBUG_SCORE_LATENCY else None
    arrived_monotonic = time.monotonic()
    system_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    self.sec_cache = [p, m]
    self._update_score_state()
    self._schedule_record_log(self._capture_record_snapshot(
      "SECONDARY", typ, ts, arrived_monotonic, system_time
    ))
    self._broadcast_update("score_update")
    if DEBUG_SCORE_LATENCY:
      print(f"[Score] sec_data done in {(time.perf_counter() - started_at) * 1000:.1f} ms")

  def _update_score_state(self):
    if self.mode == "SINGLE":
      self.score = {
        "total": self.pri_cache[0] - self.pri_cache[1],
        "plus": self.pri_cache[0],
        "minus": self.pri_cache[1],
        "penalty": 0
      }
    else:
      pri_plus = self.pri_cache[0]
      sec_plus = self.sec_cache[0]
      major_penalty = self.pri_cache[1] + self.sec_cache[1]

      self.score = {
        "total": pri_plus - sec_plus,
        "plus": pri_plus,
        "minus": sec_plus,
        "penalty": major_penalty
      }

  def _capture_record_snapshot(self, role, event_type, ble_timestamp, arrived_monotonic, system_time):
    group = match_state.get("current_group")
    contestant = match_state.get("current_contestant")

    if not contestant or contestant == "Unknown_Player":
      return None

    config = match_state.get("config") or {}
    mode = config.get("mode", "FREE")
    is_zero_score = self.score['total'] == 0 and self.score['plus'] == 0 and self.score['minus'] == 0

    if mode == 'FREE' and is_zero_score:
      return None

    binding = storage_manager.get_media_binding(config, group, contestant)
    if not binding:
      media = MediaCapture(sync_status="no_media")
    else:
      media = playback_anchors.capture(group, contestant, arrived_monotonic)
      expected_video_id = binding.get("video_id", "")
      if media.video_id != expected_video_id:
        media = MediaCapture(
          provider="youtube",
          video_id=expected_video_id,
          sync_status="media_mismatch" if media.video_id else media.sync_status,
        )

    score = dict(self.score)
    return ScoreEventSnapshot(
      group_name=group,
      ref_index=self.index,
      contestant_name=contestant,
      system_time=system_time,
      ble_timestamp=ble_timestamp,
      device_role=role,
      current_total=score.get("total", 0),
      event_type=event_type,
      total_plus=score.get("plus", 0),
      total_minus=score.get("minus", 0),
      major_penalty=score.get("penalty", 0),
      event_id=str(uuid.uuid4()),
      media_provider=media.provider,
      media_id=media.video_id,
      media_time_ms=media.video_time_ms,
      media_sync_status=media.sync_status,
    )

  def _broadcast_update(self, msg_type):
    payload = {
      "index": self.index,
      "name": self.name,
      "score": dict(self.score),
      "status": dict(self.status)
    }
    asyncio.create_task(self.broadcast({"type": msg_type, "payload": payload}))


@asynccontextmanager
async def lifespan(app: FastAPI):
  global _main_loop
  _main_loop = asyncio.get_running_loop()
  yield
  await scanner_manager.stop()


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"],
                   allow_headers=["*"])

active_ws = []
referees = {}
export_manager = ExportManager(storage_manager)


async def broadcast_json(data):
  if DEBUG_SCORE_LATENCY and data.get("type") in ("score_update", "status_update"):
    print(f"[WS] broadcast {data.get('type')} t={time.perf_counter():.3f} n_ws={len(active_ws)}")
  for ws in active_ws:
    try:
      await ws.send_json(data)
    except Exception:
      pass


@app.get("/api/settings")
async def get_settings():
    return app_settings.settings


@app.post("/api/settings/update")
async def update_settings(data: dict):
    for k, v in data.items():
        app_settings.set(k, v)
    return {"status": "ok", "settings": app_settings.settings}


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
  await websocket.accept()
  active_ws.append(websocket)
  try:
    while True:
      data = await websocket.receive_text()
      try:
        msg = json.loads(data)
        if msg.get("type") == "mark_scored":
          await broadcast_json(msg)
      except Exception:
        pass
  except Exception:
    if websocket in active_ws:
      active_ws.remove(websocket)


@app.websocket("/ws/tracking")
async def tracking_endpoint(websocket: WebSocket):
  await websocket.accept()
  try:
    target = await websocket.receive_text()
    while True:
      try:
        wins = await asyncio.to_thread(gw.getWindowsWithTitle, target)
        if wins:
          window = wins[0]
          await websocket.send_json({
            "found": True,
            "x": window.left,
            "y": window.top,
            "width": window.width,
            "height": window.height
          })
        else:
          await websocket.send_json({"found": False})
      except Exception:
        pass
      await asyncio.sleep(0.05)
  except Exception:
    pass


@app.get("/scan")
async def scan_devices(flush: bool = False):
  if not scanner_manager.is_scanning:
    await scanner_manager.start()

  if flush:
    scanner_manager.clear_cache()
    await asyncio.sleep(1.5)

  await scanner_manager.refresh_serial_devices()

  if scanner_manager.init_error:
    return {"devices": scanner_manager.get_active_devices(), "error": "Bluetooth Error: " + scanner_manager.init_error}

  return {"devices": scanner_manager.get_active_devices()}


@app.post("/setup")
async def setup(config: dict):
  await scanner_manager.stop()
  global referees

  cleanup_tasks = []
  for referee in referees.values():
    if referee.pri_dev:
      cleanup_tasks.append(referee.pri_dev.disconnect())
    if referee.sec_dev:
      cleanup_tasks.append(referee.sec_dev.disconnect())
  if cleanup_tasks:
    await asyncio.gather(*cleanup_tasks, return_exceptions=True)

  referees.clear()
  connect_tasks = []

  for item in config.get("referees", []):
    idx = item.get("index")
    referee = HeadlessReferee(idx, item.get("name"), item.get("mode"), broadcast_json)

    pri_info = await scanner_manager.resolve_device(item.get("pri_addr"))
    sec_info = await scanner_manager.resolve_device(item.get("sec_addr")) if item.get("mode") == "DUAL" else None

    if pri_info and pri_info.get("transport") == "USB":
      node_pri = SerialDeviceNode(pri_info, None, None)
    else:
      node_pri = HeadlessDeviceNode(pri_info["device"], None, None) if pri_info and pri_info.get("device") else None

    if sec_info and sec_info.get("transport") == "USB":
      node_sec = SerialDeviceNode(sec_info, None, None)
    else:
      node_sec = HeadlessDeviceNode(sec_info["device"], None, None) if sec_info and sec_info.get("device") else None

    referee.set_devices(node_pri, node_sec)
    referees[idx] = referee

    if node_pri:
      connect_tasks.append(node_pri.connect())
    if node_sec:
      connect_tasks.append(node_sec.connect())

  for task in connect_tasks:
    asyncio.create_task(task)

  return {"status": "ok"}


@app.post("/teardown")
async def teardown():
  global referees
  print("Teardown requested...")
  tasks = []

  for referee in referees.values():
    if referee.pri_dev:
      tasks.append(referee.pri_dev.disconnect())
    if referee.sec_dev:
      tasks.append(referee.sec_dev.disconnect())

  if tasks:
    await asyncio.gather(*tasks, return_exceptions=True)

  referees.clear()
  playback_anchors.clear()
  await scanner_manager.start()
  return {"status": "ok"}


@app.post("/reset")
async def reset():
  tasks = [referee.reset() for referee in referees.values()]
  if tasks:
    await asyncio.gather(*tasks)
  return {"status": "ok"}


@app.post("/api/devices/rename")
async def rename_devices(data: dict):
  requests = data.get("devices") or []
  if not isinstance(requests, list):
    return {"status": "error", "msg": "Invalid devices payload", "results": []}

  was_scanning = scanner_manager.is_scanning
  results = []

  if was_scanning:
    await scanner_manager.stop()

  try:
    for item in requests:
      address = (item.get("address") or "").strip()
      name = (item.get("name") or "").strip()

      if not address or not name:
        results.append({
          "address": address,
          "name": name,
          "status": "error",
          "msg": "Missing address or name"
        })
        continue

      device_info = await scanner_manager.resolve_device(address)
      if not device_info:
        results.append({
          "address": address,
          "name": name,
          "status": "error",
          "msg": "Device not found"
        })
        continue

      ok, err = await send_rename_command(device_info, name)
      results.append({
        "address": address,
        "name": name,
        "status": "ok" if ok else "error",
        "msg": err
      })
  finally:
    if was_scanning:
      scanner_manager.clear_cache()
      await scanner_manager.start()

  return {"status": "ok", "results": results}


@app.post("/api/project/create")
async def create_project(data: dict):
  config = storage_manager.create_project(data.get("name"), data.get("mode"))
  match_state["config"] = config
  playback_anchors.clear()
  return {"status": "ok", "config": config}


@app.post("/api/project/update_groups")
async def update_groups(data: dict):
  if not match_state["config"]:
    return {"status": "error", "msg": "No active project"}

  groups = data.get("groups", [])
  match_state["config"]["groups"] = groups
  storage_manager.save_config(match_state["config"])

  await broadcast_json({
    "type": "groups_update",
    "payload": {
      "groups": groups
    }
  })

  return {"status": "ok"}


@app.post("/api/match/set_context")
async def set_context(data: dict):
  match_state["current_group"] = data.get("group")
  match_state["current_contestant"] = data.get("contestant")
  print(f"Context updated: {match_state['current_contestant']}")

  await broadcast_json({
    "type": "context_update",
    "payload": {
      "group": match_state["current_group"],
      "contestant": match_state["current_contestant"]
    }
  })
  return {"status": "ok"}


@app.post("/api/project/media")
async def save_project_media(data: dict):
  config = match_state.get("config") or {}
  group = str(data.get("group") or "").strip()
  contestant = str(data.get("contestant") or "").strip()
  if not config or not storage_manager.current_project_path:
    return {"status": "error", "msg": "No active project"}
  if not group or not contestant:
    return {"status": "error", "msg": "Group and contestant are required"}
  try:
    binding = normalize_youtube_url(data.get("url"))
  except ValueError as exc:
    return {"status": "error", "msg": str(exc)}

  storage_manager.save_media_binding(config, group, contestant, binding)
  return {"status": "ok", "binding": binding}


@app.post("/api/media/playback/sync")
async def sync_media_playback(data: dict):
  try:
    anchor = playback_anchors.update(data)
  except ValueError as exc:
    return {"status": "error", "msg": str(exc)}
  return {"status": "ok", "received_monotonic": anchor.received_monotonic}


@app.get("/api/project/current")
async def get_current_project():
  config = match_state["config"]
  if config:
    config.setdefault("media", {})
  return config


@app.get("/api/windows")
async def get_windows():
    try:
        titles = [title for title in gw.getAllTitles() if title.strip()]
        return {"windows": titles}
    except Exception as e:
        print(f"List windows error: {e}")
        return {"windows": []}


@app.post("/api/window/bounds")
async def get_window_bounds(data: dict):
    title = data.get("title")
    try:
        wins = gw.getWindowsWithTitle(title)
        if wins:
            window = wins[0]
            return {
                "found": True,
                "bounds": {
                  "x": window.left,
                  "y": window.top,
                  "width": window.width,
                  "height": window.height
                }
            }
        return {"found": False}
    except Exception:
        return {"found": False}


@app.get("/api/projects/list")
async def get_projects_list():
    return {"projects": storage_manager.list_projects()}


@app.post("/api/project/load")
async def load_project(data: dict):
  dir_name = data.get("dir_name")
  config = storage_manager.load_project_config(dir_name)

  if config:
    match_state["config"] = config
    playback_anchors.clear()
    groups = config.get("groups", [])
    if groups:
      match_state["current_group"] = groups[0].get("name", "Unknown")
    else:
      match_state["current_group"] = "Free Mode"

    return {"status": "ok", "config": config}

  return {"status": "error", "msg": "Project not found"}


@app.post("/api/project/report")
async def get_project_report(data: dict):
    dir_name = data.get("dir_name")
    config = storage_manager.load_project_config(dir_name)
    scores = storage_manager.load_report_data(dir_name)
    return {"status": "ok", "config": config, "scores": scores}


@app.post("/api/project/replay")
async def get_project_replay(data: dict):
    dir_name = data.get("dir_name")
    group = str(data.get("group") or "").strip()
    contestant = str(data.get("contestant") or "").strip()
    if not dir_name or not group or not contestant:
      return {"status": "error", "msg": "Project, group and contestant are required"}
    replay = await asyncio.to_thread(
      storage_manager.load_replay_data, dir_name, group, contestant
    )
    if replay is None:
      return {"status": "error", "msg": "Project not found"}
    return {"status": "ok", **replay}


@app.post("/api/group/status")
async def get_group_status(data: dict):
    group_name = data.get("group")
    scored_list = storage_manager.get_scored_players(group_name)
    return {"status": "ok", "scored": scored_list}


@app.post("/api/project/delete")
async def delete_project(data: dict):
    dir_name = data.get("dir_name")
    success = storage_manager.delete_project(dir_name)
    if success:
        app_settings.remove_project_preferences(dir_name)
        return {"status": "ok"}
    return {"status": "error", "msg": "Failed to delete project"}


@app.post("/api/export/details")
async def export_details(data: dict):
  group_name = data.get("group")
  players = data.get("players", [])
  options = data.get("options", {})

  zip_io = await asyncio.to_thread(export_manager.generate_zip, group_name, players, options)

  if not zip_io:
    return {"status": "error", "msg": "No data found"}

  safe_name = "".join([c for c in group_name if c.isalnum() or c in (' ', '_', '-')]).strip()
  headers = {
    'Content-Disposition': f'attachment; filename="Details_{safe_name}.zip"'
  }
  return StreamingResponse(zip_io, media_type="application/zip", headers=headers)


if __name__ == "__main__":
    server_port = load_config()
    uvicorn.run(app, host="127.0.0.1", port=server_port)
