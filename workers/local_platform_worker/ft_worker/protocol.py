import json
from dataclasses import dataclass
from typing import Any, Optional


PROTOCOL_VERSION = 1
MAX_LINE_BYTES = 1024 * 1024
MAX_ID_LENGTH = 128
MAX_METHOD_LENGTH = 128


class ProtocolError(Exception):
  def __init__(self, code: str, message: str, request_id: Optional[str] = None):
    super().__init__(message)
    self.code = code
    self.message = message
    self.request_id = request_id


@dataclass(frozen=True)
class WorkerRequest:
  request_id: str
  method: str
  params: dict[str, Any]


def parse_request_line(line: bytes | str) -> WorkerRequest:
  if isinstance(line, bytes):
    if len(line) > MAX_LINE_BYTES:
      raise ProtocolError("MESSAGE_TOO_LARGE", "Worker request exceeds the size limit")
    try:
      text = line.decode("utf-8")
    except UnicodeDecodeError as exc:
      raise ProtocolError("INVALID_JSON", "Worker request is not valid UTF-8") from exc
  else:
    text = line
    if len(text.encode("utf-8")) > MAX_LINE_BYTES:
      raise ProtocolError("MESSAGE_TOO_LARGE", "Worker request exceeds the size limit")

  try:
    value = json.loads(text)
  except json.JSONDecodeError as exc:
    raise ProtocolError("INVALID_JSON", "Worker request is not valid JSON") from exc
  if not isinstance(value, dict):
    raise ProtocolError("INVALID_REQUEST", "Worker request must be an object")

  raw_id = value.get("id")
  request_id = raw_id if isinstance(raw_id, str) else None
  if not request_id or len(request_id) > MAX_ID_LENGTH:
    raise ProtocolError("INVALID_REQUEST_ID", "Worker request id is invalid", request_id)
  if value.get("protocolVersion") != PROTOCOL_VERSION:
    raise ProtocolError("PROTOCOL_VERSION_MISMATCH", "Unsupported worker protocol version", request_id)

  method = value.get("method")
  if not isinstance(method, str) or not method or len(method) > MAX_METHOD_LENGTH:
    raise ProtocolError("INVALID_METHOD", "Worker request method is invalid", request_id)
  params = value.get("params", {})
  if not isinstance(params, dict):
    raise ProtocolError("INVALID_PARAMS", "Worker request params must be an object", request_id)
  return WorkerRequest(request_id=request_id, method=method, params=params)


def success_response(request_id: str, result: Any) -> dict[str, Any]:
  return {
    "protocolVersion": PROTOCOL_VERSION,
    "id": request_id,
    "ok": True,
    "result": result,
  }


def error_response(request_id: Optional[str], code: str, message: str) -> dict[str, Any]:
  return {
    "protocolVersion": PROTOCOL_VERSION,
    "id": request_id,
    "ok": False,
    "error": {"code": code, "message": message},
  }


def event_message(event: str, payload: Any, event_id: Optional[str] = None) -> dict[str, Any]:
  message = {
    "protocolVersion": PROTOCOL_VERSION,
    "event": event,
    "payload": payload,
  }
  if event_id:
    message["eventId"] = event_id
  return message


def encode_message(message: dict[str, Any]) -> str:
  return json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n"
