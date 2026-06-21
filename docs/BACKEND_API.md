# Backend API (FT Engine)

Language: [English](BACKEND_API.md) | [中文](BACKEND_API_zh.md)

## Base
- Default base URL: `http://127.0.0.1:8000`
- Port comes from `my-clicker-app/config.yaml` (`server_port`)
- No authentication (local access only)

## REST API

### Settings
- `GET /api/settings`
  - Description: fetch global settings
  - Response: settings object (not wrapped)
  - Example:
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
  - Description: update one or more settings
  - Body:
    ```json
    { "reset_shortcut": "Ctrl+G" }
    ```
  - Response:
    ```json
    { "status": "ok", "settings": { "...": "..." } }
    ```

### BLE Scan / Device Binding
- `GET /scan?flush=bool`
  - Description: scan BLE devices
  - Query: `flush=true` clears cache and rescan
  - Response:
    ```json
    {
      "devices": [
        { "name": "Counter-xxx", "address": "AA:BB:CC", "rssi": -50, "remark": "A" }
      ],
      "error": "Bluetooth Error: ..." // only when Bluetooth is unavailable
    }
    ```

- `POST /setup`
  - Description: bind devices and connect
  - Body:
    ```json
    {
      "referees": [
        { "index": 1, "name": "Ref1", "mode": "SINGLE", "pri_addr": "...", "sec_addr": "" },
        { "index": 2, "name": "Ref2", "mode": "DUAL", "pri_addr": "...", "sec_addr": "..." }
      ]
    }
    ```
  - Response: `{ "status": "ok" }`

- `POST /teardown`
  - Description: disconnect all devices and resume scanning
  - Response: `{ "status": "ok" }`

- `POST /reset`
  - Description: reset all referees' scores
  - Response: `{ "status": "ok" }`

### Project / Match
- `POST /api/project/create`
  - Description: create a project
  - Body:
    ```json
    { "name": "Match A", "mode": "FREE" }
    ```
  - Response:
    ```json
    { "status": "ok", "config": { "project_name": "...", "mode": "...", "created_at": "...", "groups": [] } }
    ```

- `POST /api/project/update_groups`
  - Description: update groups, players, referee binding, etc.
  - Body:
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
  - Response: `{ "status": "ok" }`
  - Side effect: broadcasts `groups_update` via WebSocket

- `POST /api/match/set_context`
  - Description: set current group and contestant
  - Body:
    ```json
    { "group": "Group 1", "contestant": "Player A" }
    ```
  - Response: `{ "status": "ok" }`
  - Side effect: broadcasts `context_update` via WebSocket

- `GET /api/project/current`
  - Description: get current project config
  - Response: config object (or empty)

- `GET /api/projects/list`
  - Description: list history projects
  - Response:
    ```json
    { "projects": [ { "project_name": "...", "mode": "...", "created_at": "...", "dir_name": "..." } ] }
    ```

- `POST /api/project/load`
  - Description: load a project by directory name
  - Body:
    ```json
    { "dir_name": "20250101_xxx" }
    ```
  - Response:
    ```json
    { "status": "ok", "config": { "...": "..." } }
    ```
  - Error:
    ```json
    { "status": "error", "msg": "Project not found" }
    ```

- `POST /api/project/report`
  - Description: load report data (config + scores)
  - Body:
    ```json
    { "dir_name": "20250101_xxx" }
    ```
  - Response:
    ```json
    { "status": "ok", "config": { "...": "..." }, "scores": { "...": "..." } }
    ```

- `POST /api/group/status`
  - Description: list players already scored in a group
  - Body:
    ```json
    { "group": "Group 1" }
    ```
  - Response:
    ```json
    { "status": "ok", "scored": ["A", "B"] }
    ```

- `POST /api/project/delete`
  - Description: delete a project
  - Body:
    ```json
    { "dir_name": "20250101_xxx" }
    ```
  - Response:
    ```json
    { "status": "ok" }
    ```
  - Error:
    ```json
    { "status": "error", "msg": "Failed to delete project" }
    ```

### Export
- `POST /api/export/details`
  - Description: export detail ZIP (TXT / SRT)
  - Body:
    ```json
    {
      "group": "Group 1",
      "players": ["A", "B"],
      "options": { "txt": true, "srt": true, "srt_mode": "REALTIME" }
    }
    ```
  - Response: `application/zip` stream
  - Error:
    ```json
    { "status": "error", "msg": "No data found" }
    ```

### Window / Overlay
- `GET /api/windows`
  - Description: list visible window titles
  - Response:
    ```json
    { "windows": ["OBS", "Game", "..."] }
    ```

- `POST /api/window/bounds`
  - Description: get window bounds by title
  - Body:
    ```json
    { "title": "OBS" }
    ```
  - Response:
    ```json
    { "found": true, "bounds": { "x": 0, "y": 0, "width": 1920, "height": 1080 } }
    ```
  - Not found:
    ```json
    { "found": false }
    ```

## WebSocket

### `ws://127.0.0.1:8000/ws`
Used for real-time score/status/context sync.

Client -> Server:
```json
{ "type": "mark_scored", "payload": { "name": "Player A" } }
```

Server -> Clients:
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
Used to track a target window.

Client -> Server (text):
```
OBS
```

Server -> Client (looped):
```json
{ "found": true, "x": 0, "y": 0, "width": 1280, "height": 720 }
```
or:
```json
{ "found": false }
```

## Scoring Rules (Backend)
- SINGLE mode: `total = plus - minus`
- DUAL mode:
  - `plus = primary.plus`
  - `minus = secondary.plus`
  - `penalty = primary.minus + secondary.minus`

## Notes
- Endpoint `/api/group/status` is defined close to a comment in `server.py`. If you see it not registering, double-check the decorator formatting.
