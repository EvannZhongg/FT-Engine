from dataclasses import dataclass
from typing import Any, Protocol


class PlatformCapabilityError(Exception):
  def __init__(self, code: str, message: str):
    super().__init__(message)
    self.code = code
    self.message = message


class WindowTracker(Protocol):
  @property
  def available(self) -> bool: ...

  async def permission_status(self) -> str: ...

  async def list_windows(self) -> list[dict[str, Any]]: ...

  async def get_bounds(self, window_id: str) -> dict[str, int] | None: ...


@dataclass(frozen=True)
class PlatformServices:
  platform: str
  window_tracker: WindowTracker
  ble_available: bool
  usb_available: bool

  async def capabilities(self) -> dict[str, Any]:
    return {
      "ble": self.ble_available,
      "usb": self.usb_available,
      "windowTracking": self.window_tracker.available,
      "screenRecordingPermission": await self.window_tracker.permission_status(),
    }
