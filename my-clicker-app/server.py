import asyncio
import time
import struct
from dataclasses import dataclass
from typing import List, Dict, Optional
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from bleak import BleakScanner, BleakClient
import pygetwindow as gw

# ==========================================================
# 配置与协议
# ==========================================================
SERVICE_UUID = "025018d0-6951-4a81-de4f-453d8dae9128"
CHARACTERISTIC_UUID = "025018d0-6951-4a81-de4f-453d8dae9128"
DEVICE_NAME_PREFIX = "Counter-"


@dataclass
class ClickerEvent:
  current_total: int
  event_type: int
  total_plus: int
  total_minus: int
  timestamp_ms: int


def parse_notification_data(data: bytes) -> ClickerEvent:
  STRUCT_FORMAT = "<ibiiI"
  if len(data) != 17: raise ValueError("Data mismatch")
  return ClickerEvent(*struct.unpack(STRUCT_FORMAT, data))


# ==========================================================
# 扫描管理器
# ==========================================================
class ScannerManager:
  def __init__(self):
    self.scanner = None
    self.is_scanning = False
    self.found_devices = {}
    self.device_ttl = 10.0

  def _detection_callback(self, device, advertisement_data):
    self.found_devices[device.address] = {
      "device": device, "adv": advertisement_data, "ts": time.time()
    }

  async def start(self):
    if self.is_scanning: return
    print("[Scanner] Starting background scan...")
    self.scanner = BleakScanner(detection_callback=self._detection_callback)
    await self.scanner.start()
    self.is_scanning = True

  async def stop(self):
    if not self.is_scanning: return
    print("[Scanner] Stopping background scan...")
    try:
      await self.scanner.stop()
    except:
      pass
    self.scanner = None
    self.is_scanning = False

  def get_active_devices(self):
    now = time.time()
    expired = [k for k, v in self.found_devices.items() if now - v['ts'] > self.device_ttl]
    for k in expired: del self.found_devices[k]

    results = []
    for entry in self.found_devices.values():
      d, adv = entry['device'], entry['adv']
      real_name = adv.local_name or d.name or "Unknown"
      is_target = False

      if real_name.startswith(DEVICE_NAME_PREFIX):
        is_target = True
      elif adv.service_uuids:
        for u in adv.service_uuids:
          if str(u).lower() == CHARACTERISTIC_UUID.lower():
            is_target = True;
            break

      if is_target:
        results.append({"name": real_name, "address": d.address, "rssi": adv.rssi})

    results.sort(key=lambda x: x['rssi'], reverse=True)
    return results

  def clear_cache(self):
    self.found_devices.clear()


scanner_manager = ScannerManager()


# ==========================================================
# 核心业务类 (修复连接逻辑)
# ==========================================================
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

      # 【修复】移除报错的 get_services()
      # 【优化】等待 1 秒让 Windows 蓝牙栈完成服务发现，防止 "Characteristic not found"
      await asyncio.sleep(1.0)

      # 开启通知
      await self.client.start_notify(CHARACTERISTIC_UUID, self._on_notify)

      self._emit_status("connected")

      if self._heartbeat_task: self._heartbeat_task.cancel()
      self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

      return True
    except Exception as e:
      print(f"Conn failed: {e}")

      # 【调试】如果失败，打印出设备支持的所有 UUID，方便核对
      try:
        if self.client and self.client.services:
          print("--- Debug: Device Services ---")
          for s in self.client.services:
            for c in s.characteristics:
              print(f"   Char: {c.uuid} ({c.properties})")
          print("------------------------------")
      except:
        pass

      # 失败后必须主动断开，释放设备
      if self.client and self.client.is_connected:
        print("Cleaning up failed connection...")
        try:
          await self.client.disconnect()
        except:
          pass

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

    if self.client:
      try:
        await self.client.disconnect()
      except:
        pass
    self._emit_status("disconnected")

  def _on_disconnect(self, client):
    print(f"Disconnected callback: {self.ble_device.name}")
    if self._heartbeat_task:
      self._heartbeat_task.cancel()

    if not self.intentional_disconnect:
      self._trigger_reconnect()
    else:
      self._emit_status("disconnected")

  def _trigger_reconnect(self):
    if self.is_reconnecting: return
    self._emit_status("error")
    print(f"Connection lost/failed! Starting auto-reconnect for {self.ble_device.name}...")
    asyncio.create_task(self._reconnect_loop())

  async def _reconnect_loop(self):
    self.is_reconnecting = True
    while not self.intentional_disconnect:
      print(f"Retrying connection to {self.ble_device.name} in 2s...")
      await asyncio.sleep(2.0)
      if await self._do_connect():
        print(f"Reconnection successful: {self.ble_device.name}")
        self.is_reconnecting = False
        return
    self.is_reconnecting = False

  async def _heartbeat_loop(self):
    try:
      while True:
        await asyncio.sleep(3)
        if self.client and self.client.is_connected:
          try:
            await self.client.get_rssi()
          except Exception as e:
            print(f"Heartbeat failed ({e}), forcing disconnect...")
            if self.client: await self.client.disconnect()
            break
        else:
          break
    except asyncio.CancelledError:
      pass

  def _emit_status(self, status):
    if self.on_status_callback:
      self.on_status_callback(status)

  async def send_reset(self):
    if self.client and self.client.is_connected:
      try:
        await self.client.write_gatt_char(CHARACTERISTIC_UUID, b'\x01', response=True)
      except:
        pass

  def _on_notify(self, sender, data):
    try:
      evt = parse_notification_data(data)
      if self.on_data_callback:
        self.on_data_callback(evt.current_total, evt.event_type, evt.total_plus, evt.total_minus, evt.timestamp_ms)
    except:
      pass


class HeadlessReferee:
  def __init__(self, index, name, mode, broadcast_func):
    self.index = index
    self.name = name
    self.mode = mode
    self.broadcast = broadcast_func
    self.pri_dev = None
    self.sec_dev = None
    self.score = {"total": 0, "plus": 0, "minus": 0}
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
    t = []
    if self.pri_dev: t.append(self.pri_dev.send_reset())
    if self.sec_dev: t.append(self.sec_dev.send_reset())
    if t: await asyncio.gather(*t, return_exceptions=True)
    self.pri_cache = [0, 0];
    self.sec_cache = [0, 0]
    self._update_score()

  def _on_status_change(self, role, status):
    self.status[role] = status
    self._broadcast_update("status_update")

  def _on_pri_data(self, cur, typ, p, m, ts):
    self.pri_cache = [p, m]
    self._update_score()

  def _on_sec_data(self, cur, typ, p, m, ts):
    self.sec_cache = [p, m]
    self._update_score()

  def _update_score(self):
    if self.mode == "SINGLE":
      self.score = {"total": self.pri_cache[0] - self.pri_cache[1], "plus": self.pri_cache[0],
                    "minus": self.pri_cache[1]}
    else:
      self.score = {
        "total": self.pri_cache[0] - self.sec_cache[0],
        "plus": self.pri_cache[0],
        "minus": self.pri_cache[1] + self.sec_cache[1]
      }
    self._broadcast_update("score_update")

  def _broadcast_update(self, msg_type):
    payload = {
      "index": self.index,
      "score": self.score,
      "status": self.status
    }
    asyncio.create_task(self.broadcast({"type": msg_type, "payload": payload}))


# ==========================================================
# FastAPI 接口
# ==========================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
  await scanner_manager.start()
  yield
  await scanner_manager.stop()


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"],
                   allow_headers=["*"])

active_ws = []
referees = {}


async def broadcast_json(data):
  for ws in active_ws:
    try:
      await ws.send_json(data)
    except:
      pass


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
  await websocket.accept()
  active_ws.append(websocket)
  try:
    while True: await websocket.receive_text()
  except:
    if websocket in active_ws: active_ws.remove(websocket)


@app.websocket("/ws/tracking")
async def tracking_endpoint(websocket: WebSocket):
  await websocket.accept()
  try:
    target = await websocket.receive_text()
    while True:
      try:
        wins = await asyncio.to_thread(gw.getWindowsWithTitle, target)
        if wins:
          w = wins[0]
          await websocket.send_json({"found": True, "x": w.left, "y": w.top, "width": w.width, "height": w.height})
        else:
          await websocket.send_json({"found": False})
      except:
        pass
      await asyncio.sleep(0.05)
  except:
    pass


@app.get("/scan")
async def scan_devices(flush: bool = False):
  if flush:
    scanner_manager.clear_cache()
    await asyncio.sleep(1.5)
  return {"devices": scanner_manager.get_active_devices()}


@app.post("/setup")
async def setup(config: dict):
  await scanner_manager.stop()
  global referees
  for r in referees.values():
    if r.pri_dev: await r.pri_dev.disconnect()
    if r.sec_dev: await r.sec_dev.disconnect()
  referees.clear()

  cached_map = {k: v['device'] for k, v in scanner_manager.found_devices.items()}
  connect_tasks = []

  for item in config.get("referees", []):
    idx = item.get("index")
    r = HeadlessReferee(idx, item.get("name"), item.get("mode"), broadcast_json)

    pri_dev = cached_map.get(item.get("pri_addr"))
    sec_dev = cached_map.get(item.get("sec_addr"))

    node_pri = None;
    node_sec = None
    if pri_dev:
      node_pri = HeadlessDeviceNode(pri_dev, None, None)
    if sec_dev and item.get("mode") == "DUAL":
      node_sec = HeadlessDeviceNode(sec_dev, None, None)

    r.set_devices(node_pri, node_sec)
    referees[idx] = r

    if node_pri: connect_tasks.append(node_pri.connect())
    if node_sec: connect_tasks.append(node_sec.connect())

  for coro in connect_tasks:
    asyncio.create_task(coro)

  return {"status": "ok"}


@app.post("/teardown")
async def teardown():
  global referees
  tasks = []
  for r in referees.values():
    if r.pri_dev: tasks.append(r.pri_dev.disconnect())
    if r.sec_dev: tasks.append(r.sec_dev.disconnect())
  if tasks: await asyncio.gather(*tasks, return_exceptions=True)
  referees.clear()
  await scanner_manager.start()
  return {"status": "ok"}


@app.post("/reset")
async def reset():
  tasks = [r.reset() for r in referees.values()]
  if tasks: await asyncio.gather(*tasks)
  return {"status": "ok"}


if __name__ == "__main__":
  uvicorn.run(app, host="127.0.0.1", port=8000)
