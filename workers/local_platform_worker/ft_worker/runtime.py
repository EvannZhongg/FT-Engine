import asyncio
import sys
from typing import Any, Awaitable, Callable

from .platform import create_platform_services
from .platform.contract import PlatformCapabilityError, PlatformServices
from .protocol import (
  ProtocolError,
  WorkerRequest,
  encode_message,
  error_response,
  parse_request_line,
  success_response,
)


Handler = Callable[[dict[str, Any]], Awaitable[Any]]


class WorkerRuntime:
  def __init__(self, services: PlatformServices | None = None):
    self.services = services or create_platform_services()
    self.should_stop = False
    self._handlers: dict[str, Handler] = {
      "system.hello": self._hello,
      "system.ping": self._ping,
      "system.shutdown": self._shutdown,
      "window.list": self._list_windows,
      "window.getBounds": self._get_window_bounds,
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


async def run_stdio():
  runtime = WorkerRuntime()
  while True:
    line = await asyncio.to_thread(sys.stdin.buffer.readline)
    if not line:
      break
    response = await runtime.handle_line(line)
    sys.stdout.write(encode_message(response))
    sys.stdout.flush()
    if runtime.should_stop:
      break
