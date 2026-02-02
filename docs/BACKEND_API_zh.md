# 后端接口文档（FT Engine）

Language: [English](BACKEND_API.md) | [中文](BACKEND_API_zh.md)

## 基础信息
- 默认地址：`http://127.0.0.1:8000`
- 端口来源：`config.yaml` 的 `server_port`
- 无鉴权（本机访问）

## REST API

### 设置
- `GET /api/settings`
  - 说明：获取全局设置
  - 响应：直接返回设置对象（非包裹结构）
  - 示例：
    ```json
    {
      "language": "zh",
      "reset_shortcut": "Ctrl+G",
      "suppress_reset_confirm": false,
      "device_remarks": {},
      "obs_protect_main": false
    }
    ```

- `POST /api/settings/update`
  - 说明：更新一个或多个设置项
  - 请求：
    ```json
    { "reset_shortcut": "Ctrl+1" }
    ```
  - 响应：
    ```json
    { "status": "ok", "settings": { "...": "..." } }
    ```

### BLE 扫描 / 设备绑定
- `GET /scan?flush=bool`
  - 说明：扫描蓝牙设备
  - 参数：`flush=true` 会清空缓存并重新扫描
  - 响应：
    ```json
    {
      "devices": [
        { "name": "Counter-xxx", "address": "AA:BB:CC", "rssi": -50, "remark": "A机" }
      ],
      "error": "Bluetooth Error: ..." // 仅在蓝牙异常时出现
    }
    ```

- `POST /setup`
  - 说明：绑定设备并发起连接
  - 请求：
    ```json
    {
      "referees": [
        { "index": 1, "name": "Ref1", "mode": "SINGLE", "pri_addr": "...", "sec_addr": "" },
        { "index": 2, "name": "Ref2", "mode": "DUAL", "pri_addr": "...", "sec_addr": "..." }
      ]
    }
    ```
  - 响应：`{ "status": "ok" }`

- `POST /teardown`
  - 说明：断开所有设备并回到扫描状态
  - 响应：`{ "status": "ok" }`

- `POST /reset`
  - 说明：全部裁判归零
  - 响应：`{ "status": "ok" }`

### 项目 / 比赛
- `POST /api/project/create`
  - 说明：创建项目
  - 请求：
    ```json
    { "name": "Match A", "mode": "FREE" }
    ```
  - 响应：
    ```json
    { "status": "ok", "config": { "project_name": "...", "mode": "...", "created_at": "...", "groups": [] } }
    ```

- `POST /api/project/update_groups`
  - 说明：更新分组、选手、裁判绑定等配置
  - 请求：
    ```json
    {
      "groups": [
        {
          "name": "Group 1",
          "refCount": 3,
          "players": ["A", "B"],
          "referees": []
        }
      ]
    }
    ```
  - 响应：`{ "status": "ok" }`
  - 副作用：通过 WebSocket 广播 `groups_update`

- `POST /api/match/set_context`
  - 说明：设置当前组别与选手
  - 请求：
    ```json
    { "group": "Group 1", "contestant": "Player A" }
    ```
  - 响应：`{ "status": "ok" }`
  - 副作用：通过 WebSocket 广播 `context_update`

- `GET /api/project/current`
  - 说明：获取当前项目配置
  - 响应：配置对象（或空）

- `GET /api/projects/list`
  - 说明：获取历史项目列表
  - 响应：
    ```json
    { "projects": [ { "project_name": "...", "mode": "...", "created_at": "...", "dir_name": "..." } ] }
    ```

- `POST /api/project/load`
  - 说明：加载历史项目
  - 请求：
    ```json
    { "dir_name": "20250101_xxx" }
    ```
  - 响应：
    ```json
    { "status": "ok", "config": { "...": "..." } }
    ```
  - 错误：
    ```json
    { "status": "error", "msg": "Project not found" }
    ```

- `POST /api/project/report`
  - 说明：获取报表数据（配置 + 分数）
  - 请求：
    ```json
    { "dir_name": "20250101_xxx" }
    ```
  - 响应：
    ```json
    { "status": "ok", "config": { "...": "..." }, "scores": { "...": "..." } }
    ```

- `POST /api/group/status`
  - 说明：获取已打分选手列表
  - 请求：
    ```json
    { "group": "Group 1" }
    ```
  - 响应：
    ```json
    { "status": "ok", "scored": ["A", "B"] }
    ```

- `POST /api/project/delete`
  - 说明：删除历史项目
  - 请求：
    ```json
    { "dir_name": "20250101_xxx" }
    ```
  - 响应：
    ```json
    { "status": "ok" }
    ```
  - 错误：
    ```json
    { "status": "error", "msg": "Failed to delete project" }
    ```

### 导出
- `POST /api/export/details`
  - 说明：导出详情 ZIP（TXT / SRT）
  - 请求：
    ```json
    {
      "group": "Group 1",
      "players": ["A", "B"],
      "options": { "txt": true, "srt": true, "srt_mode": "REALTIME" }
    }
    ```
  - 响应：`application/zip` 流
  - 错误：
    ```json
    { "status": "error", "msg": "No data found" }
    ```

### 窗口 / Overlay
- `GET /api/windows`
  - 说明：获取可见窗口标题列表
  - 响应：
    ```json
    { "windows": ["OBS", "Game", "..."] }
    ```

- `POST /api/window/bounds`
  - 说明：按标题获取窗口坐标
  - 请求：
    ```json
    { "title": "OBS" }
    ```
  - 响应：
    ```json
    { "found": true, "bounds": { "x": 0, "y": 0, "width": 1920, "height": 1080 } }
    ```
  - 未找到：
    ```json
    { "found": false }
    ```

## WebSocket

### `ws://127.0.0.1:8000/ws`
用于实时分数、状态、上下文同步。

客户端 -> 服务端：
```json
{ "type": "mark_scored", "payload": { "name": "Player A" } }
```

服务端 -> 客户端：
- `score_update` / `status_update`
  ```json
  {
    "type": "score_update",
    "payload": {
      "index": 1,
      "name": "Ref1",
      "score": { "total": 10, "plus": 12, "minus": 2, "penalty": 1 },
      "status": { "pri": "connected", "sec": "n/a" }
    }
  }
  ```
- `context_update`
  ```json
  { "type": "context_update", "payload": { "group": "Group 1", "contestant": "Player A" } }
  ```
- `groups_update`
  ```json
  { "type": "groups_update", "payload": { "groups": [ ... ] } }
  ```
- `mark_scored`
  ```json
  { "type": "mark_scored", "payload": { "name": "Player A" } }
  ```

### `ws://127.0.0.1:8000/ws/tracking`
用于窗口位置跟踪。

客户端 -> 服务端（文本）：
```
OBS
```

服务端 -> 客户端（循环推送）：
```json
{ "found": true, "x": 0, "y": 0, "width": 1280, "height": 720 }
```
或：
```json
{ "found": false }
```

## 计分规则（后端实现）
- SINGLE：`total = plus - minus`
- DUAL：
  - `plus = 主设备 plus`
  - `minus = 副设备 plus`
  - `penalty = 主设备 minus + 副设备 minus`

## 备注
- `/api/group/status` 在 `server.py` 中靠近注释位置，如遇路由未注册请检查装饰器格式。
