import asyncio

from ..contract import PlatformCapabilityError

try:
  import Quartz
except ImportError:
  Quartz = None


class MacOSWindowTracker:
  @property
  def available(self) -> bool:
    return Quartz is not None

  async def permission_status(self) -> str:
    if not self.available:
      return "unavailable"
    checker = getattr(Quartz, "CGPreflightScreenCaptureAccess", None)
    return "granted" if checker is None or checker() else "denied"

  async def list_windows(self):
    self._require_permission()
    return await asyncio.to_thread(self._list_windows_sync)

  async def get_bounds(self, window_id: str):
    self._require_permission()
    return await asyncio.to_thread(self._get_bounds_sync, window_id)

  def _require_permission(self):
    if not self.available:
      raise PlatformCapabilityError("PLATFORM_UNSUPPORTED", "Quartz window API is unavailable")
    checker = getattr(Quartz, "CGPreflightScreenCaptureAccess", None)
    if checker is not None and not checker():
      raise PlatformCapabilityError("WINDOW_PERMISSION_DENIED", "Screen Recording permission is required")

  @staticmethod
  def _window_rows():
    options = Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements
    return Quartz.CGWindowListCopyWindowInfo(options, Quartz.kCGNullWindowID) or []

  @classmethod
  def _list_windows_sync(cls):
    windows = []
    for row in cls._window_rows():
      window_id = row.get(Quartz.kCGWindowNumber)
      owner = str(row.get(Quartz.kCGWindowOwnerName) or "").strip()
      name = str(row.get(Quartz.kCGWindowName) or "").strip()
      title = " - ".join(part for part in (owner, name) if part)
      if window_id is not None and title:
        windows.append({"windowId": str(window_id), "title": title})
    return windows

  @classmethod
  def _get_bounds_sync(cls, window_id: str):
    for row in cls._window_rows():
      if str(row.get(Quartz.kCGWindowNumber)) != window_id:
        continue
      bounds = row.get(Quartz.kCGWindowBounds) or {}
      return {
        "x": int(round(bounds.get("X", 0))),
        "y": int(round(bounds.get("Y", 0))),
        "width": int(round(bounds.get("Width", 0))),
        "height": int(round(bounds.get("Height", 0))),
      }
    return None
