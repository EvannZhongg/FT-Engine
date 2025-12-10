# config.py

# 根据 C 代码中的 ble_uuid128_init 定义，转换为标准字符串
# 0x28, 0x91, 0xae, ... -> 2891ae8d-3d45-4fde-814a-5169d0185001
SERVICE_UUID = "025018d0-6951-4a81-de4f-453d8dae9128"
# 特征值 UUID (Notify)
CHARACTERISTIC_UUID = "025018d0-6951-4a81-de4f-453d8dae9128"

# 扫描过滤前缀
DEVICE_NAME_PREFIX = "Counter-"

# 结构体格式：对应 C 代码 #pragma pack(push, 1)
# int32 (4), int8 (1), int32 (4), int32 (4), uint32 (4)
# <: 小端模式 (ESP32 是小端)
# i: int32, b: int8, I: uint32
STRUCT_FORMAT = "<ibiiI"
STRUCT_SIZE = 17  # 4+1+4+4+4 bytes