import asyncio
import time
import struct
from dataclasses import dataclass
from contextlib import asynccontextmanager
from fastapi.responses import StreamingResponse
import json
import os
import yaml

import uvicorn
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from bleak import BleakScanner, BleakClient
import pygetwindow as gw

from utils.app_settings import app_settings
from utils.exporter import ExportManager
from utils.platform import get_ble_heartbeat_config, should_enable_ble_heartbeat
from utils.runtime import get_config_path
from utils.storage import storage_manager

SERVICE_UUID = "025018d0-6951-4a81-de4f-453d8dae9128"
CHARACTERISTIC_UUID = "025018d0-6951-4a81-de4f-453d8dae9128"
STANDARD_DEVICE_NAME_UUID = "00002a00-0000-1000-8000-00805f9b34fb"

DEVICE_NAME_PREFIX = "Counter-"
DEBUG_SCORE_LATENCY = os.environ.get("DEBUG_SCORE_LATENCY", "").strip() == "1"

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


@dataclass
class ClickerEvent:
  current_total: int
  event_type: int
  total_plus: int
  total_minus: int
  timestamp_ms: int


def parse_notification_data(data: bytes) -> ClickerEvent:
  struct_format = "<ibiiI"
  if len(data) != 17:
    raise ValueError("Data mismatch")
  return ClickerEvent(*struct.unpack(struct_format, data))


class ScannerManager:
  def __init__(self):
    self.scanner = None
    self.is_scanning = False
    self.found_devices = {}
    self.device_ttl = 8.0
    self.init_error = None

  def _detection_callback(self, device, advertisement_data):
    self.found_devices[device.address] = {
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
    expired = [k for k, v in self.found_devices.items() if now - v['ts'] > self.device_ttl]
    for key in expired:
      del self.found_devices[key]

    remarks = app_settings.get("device_remarks") or {}
    results = []

    for entry in self.found_devices.values():
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
          "remark": remarks.get(device.address, "")
        })

    results.sort(key=lambda x: x['rssi'], reverse=True)
    return results

  def clear_cache(self):
    self.found_devices.clear()


scanner_manager = ScannerManager()


async def resolve_ble_device(address: str):
  scanner_manager.get_active_devices()
  entry = scanner_manager.found_devices.get(address)
  if entry:
    return entry["device"]

  try:
    return await BleakScanner.find_device_by_address(address, timeout=4.0)
  except Exception:
    return None


async def send_rename_command(ble_device, name: str):
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

  def _schedule_record_log(self, role, event_type, ble_timestamp):
    if _main_loop is None:
      self._record_log(role, event_type, ble_timestamp)
      return

    def runner():
      asyncio.create_task(asyncio.to_thread(self._record_log, role, event_type, ble_timestamp))

    _main_loop.call_soon_threadsafe(runner)

  def _on_pri_data(self, cur, typ, p, m, ts):
    started_at = time.perf_counter() if DEBUG_SCORE_LATENCY else None
    self.pri_cache = [p, m]
    self._update_score_state()
    self._schedule_record_log("PRIMARY", typ, ts)
    self._broadcast_update("score_update")
    if DEBUG_SCORE_LATENCY:
      print(f"[Score] pri_data done in {(time.perf_counter() - started_at) * 1000:.1f} ms")

  def _on_sec_data(self, cur, typ, p, m, ts):
    started_at = time.perf_counter() if DEBUG_SCORE_LATENCY else None
    self.sec_cache = [p, m]
    self._update_score_state()
    self._schedule_record_log("SECONDARY", typ, ts)
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

  def _record_log(self, role, event_type, ble_timestamp):
    group = match_state.get("current_group")
    contestant = match_state.get("current_contestant")

    if not contestant or contestant == "Unknown_Player":
      return

    config = match_state.get("config") or {}
    mode = config.get("mode", "FREE")
    is_zero_score = self.score['total'] == 0 and self.score['plus'] == 0 and self.score['minus'] == 0

    if mode == 'FREE' and is_zero_score:
      return

    event_details = {
      "role": role,
      "type": event_type,
      "timestamp": ble_timestamp
    }

    storage_manager.log_data(group, self.index, contestant, self.score, event_details)

  def _broadcast_update(self, msg_type):
    payload = {
      "index": self.index,
      "name": self.name,
      "score": self.score,
      "status": self.status
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

  if scanner_manager.init_error:
    return {"devices": [], "error": "Bluetooth Error: " + scanner_manager.init_error}

  if flush:
    scanner_manager.clear_cache()
    await asyncio.sleep(1.5)

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

  cached_map = {k: v['device'] for k, v in scanner_manager.found_devices.items()}
  connect_tasks = []

  for item in config.get("referees", []):
    idx = item.get("index")
    referee = HeadlessReferee(idx, item.get("name"), item.get("mode"), broadcast_json)

    pri_dev = cached_map.get(item.get("pri_addr"))
    sec_dev = cached_map.get(item.get("sec_addr"))

    node_pri = HeadlessDeviceNode(pri_dev, None, None) if pri_dev else None
    node_sec = HeadlessDeviceNode(sec_dev, None, None) if sec_dev and item.get("mode") == "DUAL" else None

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

      ble_device = await resolve_ble_device(address)
      if not ble_device:
        results.append({
          "address": address,
          "name": name,
          "status": "error",
          "msg": "Device not found"
        })
        continue

      ok, err = await send_rename_command(ble_device, name)
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


@app.get("/api/project/current")
async def get_current_project():
  return match_state["config"]


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
