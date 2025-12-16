import asyncio
import time
import struct
from dataclasses import dataclass
from contextlib import asynccontextmanager
from fastapi.responses import StreamingResponse

import sys
import os
import yaml

import uvicorn
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from bleak import BleakScanner, BleakClient
import pygetwindow as gw

# 引入配置模块
from utils.app_settings import app_settings
from utils.storage import storage_manager
from utils.exporter import ExportManager
# ==========================================================
# 配置与协议
# ==========================================================
SERVICE_UUID = "025018d0-6951-4a81-de4f-453d8dae9128"
CHARACTERISTIC_UUID = "025018d0-6951-4a81-de4f-453d8dae9128"
# 标准设备名称特征值 UUID (Generic Access -> Device Name)
# 用于心跳检测，因为所有 BLE 设备都有这个，且读取它不会影响业务逻辑
STANDARD_DEVICE_NAME_UUID = "00002a00-0000-1000-8000-00805f9b34fb"

DEVICE_NAME_PREFIX = "Counter-"

# ==========================================================
# 全局比赛状态 (State Management)
# ==========================================================
match_state = {
    "current_group": "Free Mode", # 默认为自由模式，防止空指针
    "current_contestant": "",
    "config": {}
}


def load_config():
  port = 8000  # 默认端口

  # 判断路径 (兼容开发环境和打包环境)
  if getattr(sys, 'frozen', False):
    base_path = os.path.dirname(sys.executable)
  else:
    base_path = os.path.dirname(os.path.abspath(__file__))

  config_path = os.path.join(base_path, 'config.yaml')

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
    self.device_ttl = 8.0  # 缩短 TTL，让列表刷新更快

  def _detection_callback(self, device, advertisement_data):
    self.found_devices[device.address] = {
      "device": device, "adv": advertisement_data, "ts": time.time()
    }

  async def start(self):
    if self.is_scanning: return
    print("[Scanner] Starting background scan...")
    # 每次启动扫描前先清理过期太久的缓存
    self.get_active_devices()
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
# 核心业务类 (修复心跳与重连)
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

      # 【修复 1】等待服务发现，解决 Windows 缓存问题
      await asyncio.sleep(1.5)

      # 【关键修复】如果在等待期间连接被断开(self.client变为None)，则中止后续操作，防止 AttributeError
      if not self.client:
          print(f"Connection aborted for {self.ble_device.name} during setup.")
          return False

      # 【修复 2】检查特征值是否存在
      # 如果不存在，尝试读取标准设备名来"激活"服务列表
      try:
        await self.client.read_gatt_char(STANDARD_DEVICE_NAME_UUID)
      except Exception:
        pass  # 忽略错误，只是为了刷新缓存

      # 再次检查，防止 read_gatt_char 期间断开
      if not self.client:
          return False

      # 开启通知
      await self.client.start_notify(CHARACTERISTIC_UUID, self._on_notify)

      self._emit_status("connected")

      # 开启心跳
      if self._heartbeat_task: self._heartbeat_task.cancel()
      self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

      return True

    except Exception as e:
      print(f"Conn failed: {e}")

      # 打印调试信息
      try:
        if self.client and self.client.services:
          print("--- Debug: Services Found ---")
          for s in self.client.services:
            print(f"   Service: {s.uuid}")
          print("-----------------------------")
      except:
        pass

      # 【关键】失败必须断开，否则设备卡死不广播
      await self._ensure_disconnect()

      if not self.intentional_disconnect:
        self._trigger_reconnect()
      else:
        self._emit_status("disconnected")
      return False

  async def disconnect(self):
    """用户主动断开"""
    self.intentional_disconnect = True
    if self._heartbeat_task:
      self._heartbeat_task.cancel()
      self._heartbeat_task = None

    await self._ensure_disconnect()
    self._emit_status("disconnected")

  async def _ensure_disconnect(self):
    """确保底层连接断开的辅助函数"""
    if self.client:
      try:
        # 只有连接状态才需要断开
        if self.client.is_connected:
          print(f"Terminating connection to {self.ble_device.name}...")
          await self.client.disconnect()
      except Exception as e:
        print(f"Disconnect error (ignored): {e}")
      finally:
        # 无论如何，清空 client 对象，防止残留
        self.client = None

  def _on_disconnect(self, client):
    print(f"Disconnected callback: {self.ble_device.name}")
    if self._heartbeat_task: self._heartbeat_task.cancel()

    if not self.intentional_disconnect:
      self._trigger_reconnect()
    else:
      self._emit_status("disconnected")

  def _trigger_reconnect(self):
    if self.is_reconnecting: return
    self._emit_status("error")
    print(f"Connection lost! Auto-reconnect {self.ble_device.name}...")
    asyncio.create_task(self._reconnect_loop())

  async def _reconnect_loop(self):
    self.is_reconnecting = True
    while not self.intentional_disconnect:
      print(f"Retrying {self.ble_device.name} in 3s...")
      await asyncio.sleep(3.0)  # 稍微放慢重连频率

      # 如果用户在重连期间点了 Stop，立即停止
      if self.intentional_disconnect: break

      if await self._do_connect():
        print(f"Reconnected: {self.ble_device.name}")
        self.is_reconnecting = False
        return
    self.is_reconnecting = False

  async def _heartbeat_loop(self):
    """心跳检测：每3秒读取一次设备名称"""
    try:
      while True:
        await asyncio.sleep(3)
        if self.client:  # 只要 client 还在就尝试检查
          try:
            # 【修复 3】用读取标准特征值代替 get_rssi
            await self.client.read_gatt_char(STANDARD_DEVICE_NAME_UUID)
          except Exception as e:
            print(f"Heartbeat failed ({e}), active disconnect...")
            # 心跳失败，说明链路已死，主动断开触发重连逻辑
            await self._ensure_disconnect()
            # _ensure_disconnect 可能会触发 _on_disconnect 回调
            # 如果没触发，我们需要手动确保进入重连流程
            if not self.intentional_disconnect:
              self._trigger_reconnect()
            break
        else:
          break
    except asyncio.CancelledError:
      pass

  def _emit_status(self, status):
    if self.on_status_callback:
      self.on_status_callback(status)

  async def send_reset(self):
    if self.client:  # 不检查 is_connected，让 bleak 自己抛异常
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
    # 初始分数
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
    # Reset 时也要更新内部状态
    self._update_score_state()
    self._broadcast_update("score_update")

  def _on_status_change(self, role, status):
    self.status[role] = status
    self._broadcast_update("status_update")

  def _on_pri_data(self, cur, typ, p, m, ts):
    self.pri_cache = [p, m]
    # 1. 先计算最新的比赛得分
    self._update_score_state()
    # 2. 再将计算好的得分写入日志 (Event Type 和 Timestamp 用当前的)
    self._record_log("PRIMARY", typ, ts)
    # 3. 广播给前端
    self._broadcast_update("score_update")

  def _on_sec_data(self, cur, typ, p, m, ts):
    self.sec_cache = [p, m]
    # 同上：副设备数据进来，先融合计算，再保存融合后的状态
    self._update_score_state()
    self._record_log("SECONDARY", typ, ts)
    self._broadcast_update("score_update")

  def _update_score_state(self):
    """仅计算分数，不广播，不存储"""
    if self.mode == "SINGLE":
      self.score = {
        "total": self.pri_cache[0] - self.pri_cache[1],
        "plus": self.pri_cache[0],
        "minus": self.pri_cache[1]
      }
    else:
      # 双机模式：Primary Plus 为正分，Secondary Plus 为负分
      pri_plus = self.pri_cache[0]
      sec_plus = self.sec_cache[0]
      self.score = {
        "total": pri_plus - sec_plus,
        "plus": pri_plus,
        "minus": sec_plus
      }

  def _record_log(self, role, event_type, ble_timestamp):
    """
    统一日志记录
    """
    # 1. 获取当前比赛上下文
    group = match_state.get("current_group")
    contestant = match_state.get("current_contestant")

    # 【修复 1】如果选手名为空或为默认占位符，直接丢弃数据
    # 这解决了 Unknown_Player_Ref1.csv 的生成问题
    if not contestant or contestant == "Unknown_Player":
      return

    # 2. 获取当前模式 (默认为 FREE)
    config = match_state.get("config") or {}
    mode = config.get("mode", "FREE")

    # 自由模式 (FREE) 下的 0 分过滤
    # 如果当前分数为 0 (Total=0, Plus=0, Minus=0)，且处于自由模式，则不记录
    # 这过滤掉了 "点击下一位" 时触发的归零信号，也过滤了未上场选手的空文件
    is_zero_score = (self.score['total'] == 0 and self.score['plus'] == 0 and self.score['minus'] == 0)

    if mode == 'FREE' and is_zero_score:
      return

    # 注意：赛事模式 (TOURNAMENT) 下不拦截 0 分
    # 这样如果该选手真实存在但没有得分，依然会生成一个包含 0 分记录的 CSV，证明该选手已参赛。

    event_details = {
      "role": role,
      "type": event_type,
      "timestamp": ble_timestamp
    }

    # 调用 Storage Manager 写入数据
    storage_manager.log_data(group, self.index, contestant, self.score, event_details)

  def _broadcast_update(self, msg_type):
    payload = {
      "index": self.index,
      "name": self.name,
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
export_manager = ExportManager(storage_manager)

async def broadcast_json(data):
  for ws in active_ws:
    try:
      await ws.send_json(data)
    except:
      pass

# 1. 获取全局设置
@app.get("/api/settings")
async def get_settings():
    return app_settings.settings

# 2. 更新全局设置
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
  # 强制清理：调用 disconnect 方法，确保 intentional_disconnect 被设置
  cleanup_tasks = []
  for r in referees.values():
    if r.pri_dev: cleanup_tasks.append(r.pri_dev.disconnect())
    if r.sec_dev: cleanup_tasks.append(r.sec_dev.disconnect())
  if cleanup_tasks:
    await asyncio.gather(*cleanup_tasks, return_exceptions=True)

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
  print("Teardown requested...")
  tasks = []
  for r in referees.values():
    if r.pri_dev: tasks.append(r.pri_dev.disconnect())
    if r.sec_dev: tasks.append(r.sec_dev.disconnect())

  if tasks:
    await asyncio.gather(*tasks, return_exceptions=True)

  referees.clear()
  await scanner_manager.start()
  return {"status": "ok"}


@app.post("/reset")
async def reset():
  tasks = [r.reset() for r in referees.values()]
  if tasks: await asyncio.gather(*tasks)
  return {"status": "ok"}


@app.post("/api/project/create")
async def create_project(data: dict):
  # data: { "name": "xxx", "mode": "TOURNAMENT" | "FREE" }
  config = storage_manager.create_project(data.get("name"), data.get("mode"))
  match_state["config"] = config
  return {"status": "ok", "config": config}


# 2. 更新分组信息 (添加/编辑组别、裁判数、选手名单)
@app.post("/api/project/update_groups")
async def update_groups(data: dict):
  # data: { "groups": [ ... ] }
  if not match_state["config"]:
    return {"status": "error", "msg": "No active project"}

  groups = data.get("groups", [])
  match_state["config"]["groups"] = groups
  storage_manager.save_config(match_state["config"])

  # 【新增】广播最新的分组信息给所有客户端（主窗口、悬浮窗）
  # 这样当一端新增选手时，另一端能同步收到列表更新
  await broadcast_json({
      "type": "groups_update",
      "payload": {
          "groups": groups
      }
  })

  return {"status": "ok"}


# 3. 设置当前上下文 (切换到哪个组、哪个选手)
@app.post("/api/match/set_context")
async def set_context(data: dict):
  # data: { "group": "GroupA", "contestant": "Player1" }
  match_state["current_group"] = data.get("group")
  match_state["current_contestant"] = data.get("contestant")
  print(f"Context updated: {match_state['current_contestant']}")

  # 广播给前端，确保多端同步
  await broadcast_json({
    "type": "context_update",
    "payload": {
      "group": match_state["current_group"],
      "contestant": match_state["current_contestant"]
    }
  })
  return {"status": "ok"}


# 4. 获取当前项目配置 (用于恢复)
@app.get("/api/project/current")
async def get_current_project():
  return match_state["config"]

@app.get("/api/windows")
async def get_windows():
    """获取所有可见窗口的标题"""
    try:
        # 过滤掉空标题和 default IME 等系统窗口
        titles = [t for t in gw.getAllTitles() if t.strip()]
        return {"windows": titles}
    except Exception as e:
        print(f"List windows error: {e}")
        return {"windows": []}

@app.post("/api/window/bounds")
async def get_window_bounds(data: dict):
    """获取指定标题窗口的坐标和大小"""
    title = data.get("title")
    try:
        wins = gw.getWindowsWithTitle(title)
        if wins:
            w = wins[0]
            # 返回 Electron setBounds 需要的格式
            return {
                "found": True,
                "bounds": {"x": w.left, "y": w.top, "width": w.width, "height": w.height}
            }
        return {"found": False}
    except Exception as e:
        return {"found": False}

# 5. 获取项目列表
@app.get("/api/projects/list")
async def get_projects_list():
    return {"projects": storage_manager.list_projects()}

# 6. 加载历史项目 (用于 Continue Match)
@app.post("/api/project/load")
async def load_project(data: dict):
  dir_name = data.get("dir_name")
  config = storage_manager.load_project_config(dir_name)

  if config:
    match_state["config"] = config

    groups = config.get("groups", [])
    if groups and len(groups) > 0:
      # 如果有组，取第一个组名
      match_state["current_group"] = groups[0].get("name", "Unknown")
    else:
      # 如果列表为空 (例如刚创建还没加组的空项目)，给个默认值
      match_state["current_group"] = "Free Mode"
    # --- 修复结束 ---

    return {"status": "ok", "config": config}

  return {"status": "error", "msg": "Project not found"}

# 7. 获取报表数据 (用于 View Details)
@app.post("/api/project/report")
async def get_project_report(data: dict):
    dir_name = data.get("dir_name")
    # 1. 加载配置以获取组别结构
    config = storage_manager.load_project_config(dir_name)
    # 2. 加载分数数据
    scores = storage_manager.load_report_data(dir_name)
    return {"status": "ok", "config": config, "scores": scores}

# 8. 获取当前组打分状态
@app.post("/api/group/status")
async def get_group_status(data: dict):
    group_name = data.get("group")
    scored_list = storage_manager.get_scored_players(group_name)
    return {"status": "ok", "scored": scored_list}

# 9. 删除项目
@app.post("/api/project/delete")
async def delete_project(data: dict):
    dir_name = data.get("dir_name")
    success = storage_manager.delete_project(dir_name)
    if success:
        return {"status": "ok"}
    else:
        return {"status": "error", "msg": "Failed to delete project"}


@app.post("/api/export/details")
async def export_details(data: dict):
  """
  导出详情压缩包
  data: {
    "group": "GroupA",
    "players": ["P1", "P2"],
    "options": { "txt": true, "srt": true, "srt_mode": "REALTIME" }
  }
  """
  group_name = data.get("group")
  players = data.get("players", [])
  options = data.get("options", {})

  # 在后台生成 ZIP
  zip_io = await asyncio.to_thread(export_manager.generate_zip, group_name, players, options)

  if not zip_io:
    return {"status": "error", "msg": "No data found"}

  # 返回流式响应
  safe_name = "".join([c for c in group_name if c.isalnum() or c in (' ', '_', '-')]).strip()
  headers = {
    'Content-Disposition': f'attachment; filename="Details_{safe_name}.zip"'
  }
  return StreamingResponse(zip_io, media_type="application/zip", headers=headers)

if __name__ == "__main__":
    # 获取端口
    SERVER_PORT = load_config()
    # 使用动态端口启动
    uvicorn.run(app, host="127.0.0.1", port=SERVER_PORT)
