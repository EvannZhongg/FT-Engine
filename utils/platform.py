import os
import sys


PLATFORM = os.environ.get("FT_ENGINE_PLATFORM") or sys.platform
IS_MACOS = PLATFORM == "darwin"


def should_enable_ble_heartbeat():
    mode = (os.environ.get("FT_ENGINE_BLE_HEARTBEAT") or "auto").strip().lower()
    if mode == "on":
        return True
    if mode == "off":
        return False
    return not IS_MACOS


def get_ble_heartbeat_config():
    interval = float(os.environ.get("FT_ENGINE_BLE_HEARTBEAT_INTERVAL", "5"))
    retry_delay = float(os.environ.get("FT_ENGINE_BLE_HEARTBEAT_RETRY_DELAY", "1"))
    fail_threshold = int(os.environ.get("FT_ENGINE_BLE_HEARTBEAT_FAIL_THRESHOLD", "2"))
    return interval, retry_delay, fail_threshold
