import asyncio
import unittest
from unittest.mock import patch

from workers.local_platform_worker.ft_worker.platform.macos.device_adapter import (
  MacOSDeviceAdapter,
)
from workers.local_platform_worker.ft_worker.platform.macos import window_tracker


class Port:
  def __init__(self, device, vid=None, description=""):
    self.device = device
    self.vid = vid
    self.description = description
    self.product = ""
    self.manufacturer = ""
    self.hwid = ""


class QuartzFixture:
  kCGWindowListOptionOnScreenOnly = 1
  kCGWindowListExcludeDesktopElements = 2
  kCGNullWindowID = 0
  kCGWindowNumber = "number"
  kCGWindowOwnerName = "owner"
  kCGWindowName = "name"
  kCGWindowBounds = "bounds"

  @staticmethod
  def CGWindowListCopyWindowInfo(_options, _window_id):
    return [
      {
        "number": 42,
        "owner": "OBS",
        "name": "Preview",
        "bounds": {"X": -1440.4, "Y": 12.2, "Width": 1280.5, "Height": 720.6},
      }
    ]


class MacOSPlatformTests(unittest.TestCase):
  def test_serial_adapter_requires_callout_port(self):
    adapter = MacOSDeviceAdapter()
    self.assertTrue(adapter.is_supported_serial_port(Port("/dev/cu.usbmodem", 0x303A)))
    self.assertFalse(adapter.is_supported_serial_port(Port("/dev/tty.usbmodem", 0x303A)))
    self.assertFalse(adapter.is_supported_serial_port(Port("/dev/cu.other", description="USB UART")))

  def test_window_tracker_uses_stable_ids_and_normalized_bounds(self):
    tracker = window_tracker.MacOSWindowTracker()
    with patch.object(window_tracker, "_quartz_available", return_value=True):
      with patch.object(window_tracker, "_load_quartz", return_value=QuartzFixture):
        with patch.object(window_tracker, "_screen_recording_permission", return_value=True):
          self.assertTrue(tracker.available)
          windows = asyncio.run(tracker.list_windows())
          bounds = asyncio.run(tracker.get_bounds("42"))
    self.assertEqual(windows, [{"windowId": "42", "title": "OBS - Preview"}])
    self.assertEqual(bounds, {"x": -1440, "y": 12, "width": 1280, "height": 721})

  def test_window_tracker_reports_permission_denial(self):
    tracker = window_tracker.MacOSWindowTracker()
    with patch.object(window_tracker, "_quartz_available", return_value=True):
      with patch.object(window_tracker, "_load_quartz", return_value=QuartzFixture):
        with patch.object(window_tracker, "_screen_recording_permission", return_value=False):
          self.assertEqual(asyncio.run(tracker.permission_status()), "denied")
          with self.assertRaisesRegex(Exception, "Screen Recording"):
            asyncio.run(tracker.list_windows())


if __name__ == "__main__":
  unittest.main()
