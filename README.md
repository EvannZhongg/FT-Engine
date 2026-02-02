# FT Engine - Professional Electronic Referee System

Language: [English](README.md) | [中文](README_zh.md)

FT Engine is a professional electronic referee system for competitions that require accurate scoring, real-time visualization, and multi-device coordination. It combines BLE clicker hardware, real-time waveform analysis, OBS-friendly overlays, and end-to-end match data management.

The application code lives under `my-clicker-app/`.

## Key Features
- Multi-mode support: Free Mode and Tournament Mode
- BLE device integration (single or dual clicker setup)
- Real-time visualization with waveform widget
- Transparent overlay for OBS or game capture
- Data management: CSV raw data, TXT logs, SRT subtitles
- Built-in i18n (Chinese and English)

## Scoring Rules
- SINGLE: `total = plus - minus`
- DUAL:
  - Plus comes from primary device
  - Minus comes from secondary device
  - Penalty = primary minus + secondary minus

## Project Layout (Simplified)
```
ElectronicClickerPC2/
  my-clicker-app/
    server.py
    config.yaml
    requirements.txt
    package.json
    src/
    utils/
  docs/
```

## Development Setup
Prerequisites:
- Node.js (v16+ recommended)
- Python 3.9+
- Bluetooth enabled on the host machine

All commands below run inside `my-clicker-app/`.

### Backend (Python)
```bash
python -m venv venv
# Windows
.\venv\Scripts\activate
# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt

# Optional: run backend manually
python server.py
# Default: http://127.0.0.1:8000
```

### Frontend (Electron + Vue)
```bash
npm install
npm run dev
```

Note: In dev mode (`is.dev` is true), `src/main/index.js` starts the backend via `python server.py`.

## Documentation
- Backend API: `docs/BACKEND_API.md`
- BLE Protocol: `docs/BLE_PROTOCOL.md`

## License
Proprietary / Custom License (contact Freakthrow for details).

## Author
Freakthrow Team
