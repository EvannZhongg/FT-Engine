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


class DevicePlatformAdapter(Protocol):
  @property
  def ble_available(self) -> bool: ...

  @property
  def usb_available(self) -> bool: ...

  @property
  def use_ble_heartbeat(self) -> bool: ...

  async def scan_ble(self, timeout: float): ...

  async def find_ble(self, device_id: str, timeout: float): ...

  def create_ble_client(self, device, disconnected_callback): ...

  def list_serial_ports(self): ...

  def is_supported_serial_port(self, port_info) -> bool: ...

  def open_serial(self, port_path: str): ...

  def map_ble_error(self, error: Exception) -> str: ...

  def map_serial_error(self, error: Exception) -> str: ...


@dataclass(frozen=True)
class PlatformServices:
  platform: str
  window_tracker: WindowTracker
  ble_available: bool
  usb_available: bool
  device_adapter: DevicePlatformAdapter | None = None

  async def capabilities(self) -> dict[str, Any]:
    return {
      "ble": self.ble_available,
      "usb": self.usb_available,
      "windowTracking": self.window_tracker.available,
      "screenRecordingPermission": await self.window_tracker.permission_status(),
    }
