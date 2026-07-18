import asyncio
import sys
from typing import Any, Awaitable, Callable

from .devices import DeviceError, DeviceService
from .platform import create_platform_services
from .platform.contract import PlatformCapabilityError, PlatformServices
from .protocol import (
  ProtocolError,
  WorkerRequest,
  encode_message,
  error_response,
  event_message,
  parse_request_line,
  success_response,
)


Handler = Callable[[dict[str, Any]], Awaitable[Any]]


class WorkerRuntime:
  def __init__(self, services: PlatformServices | None = None, event_sink=None):
    self.services = services or create_platform_services()
    self.event_sink = event_sink
    self.should_stop = False
    self.device_service = (
      DeviceService(self.services.device_adapter, self._emit_device_event)
      if self.services.device_adapter is not None else None
    )
    self._handlers: dict[str, Handler] = {
      "system.hello": self._hello,
      "system.ping": self._ping,
      "system.shutdown": self._shutdown,
      "window.list": self._list_windows,
      "window.getBounds": self._get_window_bounds,
      "device.scan": self._scan_devices,
      "device.connect": self._connect_device,
      "device.disconnect": self._disconnect_device,
      "device.reset": self._reset_device,
      "device.rename": self._rename_device,
      "device.disconnectAll": self._disconnect_all_devices,
    }

  async def handle_line(self, line: bytes | str) -> dict[str, Any]:
    try:
      request = parse_request_line(line)
      return await self._dispatch(request)
    except ProtocolError as error:
      return error_response(error.request_id, error.code, error.message)

  async def _dispatch(self, request: WorkerRequest) -> dict[str, Any]:
    handler = self._handlers.get(request.method)
    if handler is None:
      return error_response(request.request_id, "METHOD_NOT_FOUND", "Unknown worker method")
    try:
      result = await handler(request.params)
      return success_response(request.request_id, result)
    except ProtocolError as error:
      return error_response(request.request_id, error.code, error.message)
    except PlatformCapabilityError as error:
      return error_response(request.request_id, error.code, error.message)
    except DeviceError as error:
      return error_response(request.request_id, error.code, error.message)
    except Exception as error:
      print(f"[Worker] Unhandled {request.method} error: {error}", file=sys.stderr)
      return error_response(request.request_id, "WORKER_INTERNAL_ERROR", "Worker command failed")

  async def _hello(self, params):
    return {
      "protocolVersion": 1,
      "platform": self.services.platform,
      "capabilities": await self.services.capabilities(),
    }

  async def _ping(self, params):
    return {"echo": params.get("echo")}

  async def _shutdown(self, params):
    await self.close()
    self.should_stop = True
    return {"stopping": True}

  async def _list_windows(self, params):
    return {"windows": await self.services.window_tracker.list_windows()}

  async def _get_window_bounds(self, params):
    window_id = params.get("windowId")
    if not isinstance(window_id, str) or not window_id:
      raise ProtocolError("INVALID_PARAMS", "windowId is required")
    bounds = await self.services.window_tracker.get_bounds(window_id)
    return {"found": bounds is not None, "bounds": bounds}

  async def _scan_devices(self, params):
    service = self._devices()
    flush = params.get("flush", False)
    remarks = params.get("remarks", {})
    if not isinstance(flush, bool) or not isinstance(remarks, dict):
      raise ProtocolError("INVALID_PARAMS", "Invalid device scan options")
    return await service.scan(flush=flush, remarks=remarks)

  async def _connect_device(self, params):
    service = self._devices()
    connection_id = self._required_id(params, "connectionId")
    device_id = self._required_id(params, "deviceId")
    return await service.connect(connection_id, device_id)

  async def _disconnect_device(self, params):
    return await self._devices().disconnect(self._required_id(params, "connectionId"))

  async def _reset_device(self, params):
    return await self._devices().reset(self._required_id(params, "connectionId"))

  async def _rename_device(self, params):
    connection_id = self._required_id(params, "connectionId")
    name = params.get("name")
    if not isinstance(name, str) or not name.strip() or len(name.encode("utf-8")) > 32:
      raise ProtocolError("INVALID_PARAMS", "Device name is invalid")
    return await self._devices().rename(connection_id, name.strip())

  async def _disconnect_all_devices(self, params):
    await self.close()
    return {"disconnected": True}

  async def _emit_device_event(self, event, payload, event_id=None):
    if self.event_sink is not None:
      await self.event_sink(event_message(event, payload, event_id))

  async def close(self):
    if self.device_service is not None:
      await self.device_service.close()

  def _devices(self):
    if self.device_service is None:
      raise DeviceError("PLATFORM_UNSUPPORTED", "Device services are unavailable")
    return self.device_service

  @staticmethod
  def _required_id(params, field):
    value = params.get(field)
    if not isinstance(value, str) or not value or len(value) > 128:
      raise ProtocolError("INVALID_PARAMS", f"{field} is required")
    return value


async def run_stdio():
  output_queue = asyncio.Queue()
  runtime = WorkerRuntime(event_sink=output_queue.put)

  async def write_output():
    while True:
      message = await output_queue.get()
      if message is None:
        return
      sys.stdout.buffer.write(encode_message(message).encode("utf-8"))
      sys.stdout.buffer.flush()

  writer = asyncio.create_task(write_output())
  try:
    while True:
      line = await asyncio.to_thread(sys.stdin.buffer.readline)
      if not line:
        break
      await output_queue.put(await runtime.handle_line(line))
      if runtime.should_stop:
        break
  finally:
    await runtime.close()
    await output_queue.put(None)
    await writer
