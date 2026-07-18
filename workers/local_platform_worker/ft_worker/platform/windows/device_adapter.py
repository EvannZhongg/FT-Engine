from ..device_adapter import BleakSerialDeviceAdapter


ESPRESSIF_USB_VID = 0x303A


class WindowsDeviceAdapter(BleakSerialDeviceAdapter):
  use_ble_heartbeat = True

  def is_supported_serial_port(self, port_info) -> bool:
    if getattr(port_info, "vid", None) == ESPRESSIF_USB_VID:
      return True
    details = " ".join(filter(None, [
      getattr(port_info, "manufacturer", None),
      getattr(port_info, "description", None),
      getattr(port_info, "product", None),
      getattr(port_info, "hwid", None),
    ])).lower()
    return "espressif" in details or "jtag" in details or "303a" in details
