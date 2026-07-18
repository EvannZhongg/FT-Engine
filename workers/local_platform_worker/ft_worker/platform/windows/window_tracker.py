import asyncio

from ..contract import PlatformCapabilityError

try:
  import pygetwindow as window_api
except ImportError:
  window_api = None


class WindowsWindowTracker:
  @property
  def available(self) -> bool:
    return window_api is not None

  async def permission_status(self) -> str:
    return "notRequired" if self.available else "unavailable"

  async def list_windows(self):
    if not self.available:
      raise PlatformCapabilityError("PLATFORM_UNSUPPORTED", "Windows window API is unavailable")
    return await asyncio.to_thread(self._list_windows_sync)

  async def get_bounds(self, window_id: str):
    if not self.available:
      raise PlatformCapabilityError("PLATFORM_UNSUPPORTED", "Windows window API is unavailable")
    return await asyncio.to_thread(self._get_bounds_sync, window_id)

  @staticmethod
  def _list_windows_sync():
    windows = []
    for window in window_api.getAllWindows():
      title = str(getattr(window, "title", "") or "").strip()
      handle = getattr(window, "_hWnd", None)
      if not title or handle is None:
        continue
      windows.append({"windowId": str(handle), "title": title})
    return windows

  @staticmethod
  def _get_bounds_sync(window_id: str):
    for window in window_api.getAllWindows():
      if str(getattr(window, "_hWnd", "")) != window_id:
        continue
      if bool(getattr(window, "isMinimized", False)):
        return None
      return {
        "x": int(window.left),
        "y": int(window.top),
        "width": int(window.width),
        "height": int(window.height),
      }
    return None
