import sys

from .contract import PlatformServices


def create_platform_services(platform_name: str | None = None) -> PlatformServices:
  selected = sys.platform if platform_name is None else platform_name
  if selected == "win32":
    from .windows.device_adapter import WindowsDeviceAdapter
    from .windows.window_tracker import WindowsWindowTracker
    adapter = WindowsDeviceAdapter()
    return PlatformServices(
      "windows", WindowsWindowTracker(), adapter.ble_available, adapter.usb_available, adapter
    )
  if selected == "darwin":
    from .macos.device_adapter import MacOSDeviceAdapter
    from .macos.window_tracker import MacOSWindowTracker
    adapter = MacOSDeviceAdapter()
    return PlatformServices(
      "macos", MacOSWindowTracker(), adapter.ble_available, adapter.usb_available, adapter
    )

  from .unsupported import UnsupportedWindowTracker
  return PlatformServices("unsupported", UnsupportedWindowTracker(), False, False)
