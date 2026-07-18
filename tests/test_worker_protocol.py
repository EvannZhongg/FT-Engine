import asyncio
import json
import unittest

from workers.local_platform_worker.ft_worker.platform.contract import PlatformServices
from workers.local_platform_worker.ft_worker.protocol import (
  PROTOCOL_VERSION,
  ProtocolError,
  encode_message,
  parse_request_line,
)
from workers.local_platform_worker.ft_worker.runtime import WorkerRuntime


class FakeWindowTracker:
  available = True

  async def permission_status(self):
    return "notRequired"

  async def list_windows(self):
    return [{"windowId": "101", "title": "OBS"}]

  async def get_bounds(self, window_id):
    if window_id != "101":
      return None
    return {"x": -100, "y": 20, "width": 1920, "height": 1080}


def request_line(request_id="request-1", method="system.ping", params=None, version=1):
  return json.dumps({
    "protocolVersion": version,
    "id": request_id,
    "method": method,
    "params": {} if params is None else params,
  })


class WorkerProtocolTests(unittest.TestCase):
  def setUp(self):
    services = PlatformServices("windows", FakeWindowTracker(), True, True)
    self.runtime = WorkerRuntime(services)

  def dispatch(self, **overrides):
    return asyncio.run(self.runtime.handle_line(request_line(**overrides)))

  def test_parses_versioned_request(self):
    request = parse_request_line(request_line(params={"echo": "hello"}))
    self.assertEqual(request.request_id, "request-1")
    self.assertEqual(request.method, "system.ping")
    self.assertEqual(request.params, {"echo": "hello"})

  def test_rejects_invalid_json_and_protocol_version(self):
    with self.assertRaises(ProtocolError) as invalid_json:
      parse_request_line("not-json")
    self.assertEqual(invalid_json.exception.code, "INVALID_JSON")

    with self.assertRaises(ProtocolError) as mismatch:
      parse_request_line(request_line(version=99))
    self.assertEqual(mismatch.exception.code, "PROTOCOL_VERSION_MISMATCH")
    self.assertEqual(mismatch.exception.request_id, "request-1")

  def test_hello_reports_platform_capabilities(self):
    response = self.dispatch(method="system.hello")
    self.assertTrue(response["ok"])
    self.assertEqual(response["result"], {
      "protocolVersion": PROTOCOL_VERSION,
      "platform": "windows",
      "capabilities": {
        "ble": True,
        "usb": True,
        "windowTracking": True,
        "screenRecordingPermission": "notRequired",
      },
    })

  def test_window_methods_use_stable_window_id(self):
    listed = self.dispatch(method="window.list")
    self.assertEqual(listed["result"]["windows"][0]["windowId"], "101")

    found = self.dispatch(method="window.getBounds", params={"windowId": "101"})
    self.assertEqual(found["result"]["bounds"]["x"], -100)
    missing = self.dispatch(method="window.getBounds", params={"windowId": "999"})
    self.assertEqual(missing["result"], {"found": False, "bounds": None})

  def test_returns_stable_errors_without_tracebacks(self):
    unknown = self.dispatch(method="unknown.command")
    self.assertEqual(unknown["error"]["code"], "METHOD_NOT_FOUND")

    invalid = self.dispatch(method="window.getBounds", params={})
    self.assertEqual(invalid["error"]["code"], "INVALID_PARAMS")

  def test_shutdown_is_acknowledged_before_stopping(self):
    response = self.dispatch(method="system.shutdown")
    self.assertEqual(response["result"], {"stopping": True})
    self.assertTrue(self.runtime.should_stop)

  def test_encoded_response_is_one_json_line(self):
    encoded = encode_message({"message": "计分"})
    self.assertEqual(encoded.count("\n"), 1)
    self.assertTrue(encoded.endswith("\n"))
    self.assertEqual(json.loads(encoded), {"message": "计分"})


if __name__ == "__main__":
  unittest.main()
