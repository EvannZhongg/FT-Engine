import unittest

from workers.local_platform_worker.ft_worker.platform.factory import create_platform_services


class PlatformFactoryTests(unittest.TestCase):
  def test_selects_supported_platforms_only_in_factory(self):
    self.assertEqual(create_platform_services("win32").platform, "windows")
    self.assertEqual(create_platform_services("darwin").platform, "macos")

  def test_unsupported_platform_disables_local_capabilities(self):
    services = create_platform_services("linux")
    capabilities = asyncio_run(services.capabilities())
    self.assertEqual(services.platform, "unsupported")
    self.assertEqual(capabilities, {
      "ble": False,
      "usb": False,
      "windowTracking": False,
      "screenRecordingPermission": "unavailable",
    })


def asyncio_run(awaitable):
  import asyncio
  return asyncio.run(awaitable)


if __name__ == "__main__":
  unittest.main()
