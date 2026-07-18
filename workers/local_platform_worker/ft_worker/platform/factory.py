import importlib.util
import sys

from .contract import PlatformServices


def create_platform_services(platform_name: str | None = None) -> PlatformServices:
  selected = sys.platform if platform_name is None else platform_name
  ble_available = importlib.util.find_spec("bleak") is not None
  usb_available = importlib.util.find_spec("serial") is not None

  if selected == "win32":
    from .windows.window_tracker import WindowsWindowTracker
    return PlatformServices("windows", WindowsWindowTracker(), ble_available, usb_available)
  if selected == "darwin":
    from .macos.window_tracker import MacOSWindowTracker
    return PlatformServices("macos", MacOSWindowTracker(), ble_available, usb_available)

  from .unsupported import UnsupportedWindowTracker
  return PlatformServices("unsupported", UnsupportedWindowTracker(), False, False)
