import asyncio

try:
  from bleak import BleakClient, BleakScanner
except ImportError:
  BleakClient = None
  BleakScanner = None

try:
  import serial
  from serial.tools import list_ports
except ImportError:
  serial = None
  list_ports = None


class BleakSerialDeviceAdapter:
  use_ble_heartbeat = False

  @property
  def ble_available(self) -> bool:
    return BleakClient is not None and BleakScanner is not None

  @property
  def usb_available(self) -> bool:
    return serial is not None and list_ports is not None

  async def scan_ble(self, timeout: float):
    if not self.ble_available:
      return []
    discovered = await BleakScanner.discover(timeout=timeout, return_adv=True)
    return list(discovered.values())

  async def find_ble(self, device_id: str, timeout: float):
    if not self.ble_available:
      return None
    return await BleakScanner.find_device_by_address(device_id, timeout=timeout)

  def create_ble_client(self, device, disconnected_callback):
    if not self.ble_available:
      raise RuntimeError("BLE is unavailable")
    return BleakClient(device, disconnected_callback=disconnected_callback)

  def list_serial_ports(self):
    if not self.usb_available:
      return []
    return list(list_ports.comports())

  def open_serial(self, port_path: str):
    if not self.usb_available:
      raise RuntimeError("USB serial is unavailable")
    return serial.Serial(
      port=port_path,
      baudrate=115200,
      timeout=0.1,
      write_timeout=0.2,
      rtscts=False,
      dsrdtr=False,
    )

  def map_ble_error(self, error: Exception) -> str:
    message = str(error).lower()
    if "access" in message or "permission" in message or "denied" in message:
      return "BLE_PERMISSION_DENIED"
    if "powered off" in message or "radio" in message and "off" in message:
      return "BLE_POWERED_OFF"
    if "adapter" in message and ("missing" in message or "not found" in message):
      return "BLE_ADAPTER_MISSING"
    if isinstance(error, asyncio.TimeoutError) or "timeout" in message:
      return "BLE_CONNECTION_TIMEOUT"
    return "BLE_UNAVAILABLE"

  def map_serial_error(self, error: Exception) -> str:
    message = str(error).lower()
    if "access" in message or "permission" in message or "busy" in message:
      return "USB_PORT_BUSY"
    return "USB_DEVICE_NOT_FOUND"
