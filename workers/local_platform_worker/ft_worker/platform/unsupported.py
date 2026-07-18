from .contract import PlatformCapabilityError


class UnsupportedWindowTracker:
  available = False

  async def permission_status(self) -> str:
    return "unavailable"

  async def list_windows(self):
    raise PlatformCapabilityError("PLATFORM_UNSUPPORTED", "Window tracking is unsupported")

  async def get_bounds(self, window_id: str):
    raise PlatformCapabilityError("PLATFORM_UNSUPPORTED", "Window tracking is unsupported")
