import asyncio
import ctypes
import importlib.util
from functools import lru_cache

from ..contract import PlatformCapabilityError


def _quartz_available():
  return importlib.util.find_spec("Quartz") is not None


@lru_cache(maxsize=1)
def _load_quartz():
  try:
    import Quartz as quartz
  except ImportError:
    return None
  return quartz


def _screen_recording_permission():
  """Query CoreGraphics without importing the comparatively heavy PyObjC Quartz module."""
  try:
    framework = ctypes.CDLL(
      "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics"
    )
    checker = framework.CGPreflightScreenCaptureAccess
    checker.restype = ctypes.c_bool
    return bool(checker())
  except (AttributeError, OSError):
    return None


class MacOSWindowTracker:
  @property
  def available(self) -> bool:
    return _quartz_available()

  async def permission_status(self) -> str:
    if not _quartz_available():
      return "unavailable"
    granted = _screen_recording_permission()
    return "notDetermined" if granted is None else ("granted" if granted else "denied")

  async def list_windows(self):
    self._require_permission()
    return await asyncio.to_thread(self._list_windows_sync)

  async def get_bounds(self, window_id: str):
    self._require_permission()
    return await asyncio.to_thread(self._get_bounds_sync, window_id)

  def _require_permission(self):
    quartz = _load_quartz()
    if quartz is None:
      raise PlatformCapabilityError("PLATFORM_UNSUPPORTED", "Quartz window API is unavailable")
    granted = _screen_recording_permission()
    if granted is False:
      raise PlatformCapabilityError("WINDOW_PERMISSION_DENIED", "Screen Recording permission is required")

  @staticmethod
  def _window_rows():
    quartz = _load_quartz()
    options = quartz.kCGWindowListOptionOnScreenOnly | quartz.kCGWindowListExcludeDesktopElements
    return quartz.CGWindowListCopyWindowInfo(options, quartz.kCGNullWindowID) or []

  @classmethod
  def _list_windows_sync(cls):
    quartz = _load_quartz()
    windows = []
    for row in cls._window_rows():
      window_id = row.get(quartz.kCGWindowNumber)
      owner = str(row.get(quartz.kCGWindowOwnerName) or "").strip()
      name = str(row.get(quartz.kCGWindowName) or "").strip()
      title = " - ".join(part for part in (owner, name) if part)
      if window_id is not None and title:
        windows.append({"windowId": str(window_id), "title": title})
    return windows

  @classmethod
  def _get_bounds_sync(cls, window_id: str):
    quartz = _load_quartz()
    for row in cls._window_rows():
      if str(row.get(quartz.kCGWindowNumber)) != window_id:
        continue
      bounds = row.get(quartz.kCGWindowBounds) or {}
      return {
        "x": int(round(bounds.get("X", 0))),
        "y": int(round(bounds.get("Y", 0))),
        "width": int(round(bounds.get("Width", 0))),
        "height": int(round(bounds.get("Height", 0))),
      }
    return None
