# FT Engine - Professional Electronic Referee System

Language: [English](README.md) | [中文](README_zh.md)

FT Engine is an Electron desktop scoring application for competitive events. It supports BLE/USB clickers, SINGLE/DUAL referee modes, OBS overlays, YouTube scoring timelines, historical reports, and exports.

## Current Architecture

Route B is being introduced incrementally. The current application is a working dual-runtime transition:

- Window, overlay, device, live-match, and primary historical reads use constrained IPC.
- Electron Main's `MatchSessionService` connects the Platform Worker, TypeScript scoring domain, and atomic live SQLite event writes while publishing continuous save/worker/media status to the scoring UI.
- The working tree's `CompetitionService` moves project creation, configuration, resume, list, and deletion into Main/SQLite; new projects no longer create legacy directories.
- The legacy FastAPI backend now mainly serves CSV/SRT/ZIP exports and a few REST fallbacks. Other hardware, project, media, and WebSocket routes are outside Electron's primary paths.
- SQLite schema v5 supports native projects, historical reads, and atomic live events. Multi-stage workflows and native exports remain unfinished. Future refactoring will delete legacy runtime/importer code without migrating old data.

See [current architecture](docs/ARCHITECTURE_CURRENT_zh.md) and the [remaining Route B plan](docs/REFACTOR_PLAN_ROUTE_B_zh.md). Do not assume the localhost backend has already been removed.

## Features

- Free and Tournament modes.
- BLE/USB clickers with single and dual-device referees.
- Platform Worker BLE/USB shutdown when leaving scoring or closing the application.
- Live scoring, major penalties, waveform display, and contestant navigation.
- Transparent OBS-friendly overlay and target-window positioning.
- YouTube video scoring, playback anchors, and score overlays during replay.
- Historical reports plus CSV, SRT, and ZIP exports.
- Chinese, English, and Japanese UI.

## Development

Prerequisites:

- Node.js 22+.
- Python 3.10+; the project `.venv` is recommended.
- Bluetooth and the relevant USB drivers for physical-device development.

~~~bash
npm install
python -m pip install -r requirements.txt
npm run dev
~~~

Electron currently starts the legacy backend, Platform Worker, and SQLite together. The development Renderer normally uses `http://localhost:5173`; the legacy backend defaults to `127.0.0.1:8000`.

## Verification

~~~bash
npm test
npm run typecheck
npm run lint
npm run build
python -m unittest discover -s tests
~~~

The current suites contain both the primary implementation and legacy boundaries scheduled for deletion. After legacy removal, only Main/Renderer and Platform Worker coverage remains.

## Packaging

~~~bash
npm run build:backend
npm run build:unpack
npm run build:win
npm run build:mac
~~~

Transition builds still package two Python executables. The target removes `backend-engine` and keeps only the JSONL stdio `local-platform-worker`.

## Local Data

Development data is written under the repository; packaged builds use Electron's user-data directory.

| Data | Purpose |
| --- | --- |
| `config.yaml` | Current backend port configuration; to be reduced after backend removal |
| `app_settings.json` | Legacy settings file scheduled for deletion |
| `match_data/` | Legacy project directory scheduled for deletion without migration |
| `ft-engine.db` | Authoritative projects, events, settings, and media; a clean schema reset is allowed |
| `backups/` | Pre-migration SQLite backups |
| `logs/` | Startup and runtime logs |

Typical packaged locations are `%APPDATA%/FT Engine/` on Windows and `~/Library/Application Support/FT Engine/` on macOS.

## Key Directories

~~~text
src/main/application/            Competition, match, and settings services
src/main/domain/                 TypeScript scoring domain
src/main/persistence/            SQLite repositories; importer pending deletion
src/main/worker/                 WorkerClient
src/main/legacy/                 Shadow event pending deletion
src/preload/                     Narrow main/overlay APIs
src/shared/                      IPC and domain DTO contracts
src/renderer/                    Vue UI
workers/local_platform_worker/   BLE, USB, and window worker
server.py                        FastAPI backend pending deletion
utils/                           Legacy modules and remaining runtime utilities
tests/                           Node and Python regression tests
~~~

## Documentation

- [Current architecture and findings (Chinese)](docs/ARCHITECTURE_CURRENT_zh.md)
- [Target architecture and project structure (Chinese)](docs/ARCHITECTURE_TARGET_zh.md)
- [Remaining Route B plan (Chinese)](docs/REFACTOR_PLAN_ROUTE_B_zh.md)
- [Desktop UI and interaction target (Chinese)](docs/UI_INTERACTION_SPEC_zh.md)
- [Django user-service target (Chinese)](docs/BACKEND_DJANGO_zh.md)
- [User and community product boundary (Chinese)](docs/COMMUNITY_CONTRACT_AND_UI_SPEC_zh.md)
- [Windows and macOS adaptation](docs/PLATFORM_ADAPTATION_zh.md)

## License

Proprietary / Custom License (contact Freakthrow for licensing).

## Author

Freakthrow Team
