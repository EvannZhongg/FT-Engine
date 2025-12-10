# logic/referee.py
import asyncio
from PyQt6.QtCore import QObject, pyqtSignal, Qt
from core.device_node import DeviceNode
from utils.storage import storage


class Referee(QObject):
    # 信号: total_score, plus_part, minus_part (注意：minus_part 现在代表重点扣分)
    score_updated = pyqtSignal(int, int, int)

    def __init__(self, index, name, mode="SINGLE"):
        super().__init__()
        self.index = index
        self.name = name
        self.mode = mode

        self.primary_device: DeviceNode = None
        self.secondary_device: DeviceNode = None

        # 最终显示的数值
        self.last_total = 0
        self.last_plus = 0  # 在双机模式下，这代表算分项
        self.last_minus = 0  # 在双机模式下，这代表“重点扣分”

        # 内部缓存
        self.pri_plus = 0
        self.pri_minus = 0
        self.sec_plus = 0
        self.sec_minus = 0

        # 上下文：当前选手
        self.current_contestant = ""

    def set_devices(self, primary, secondary=None):
        self.primary_device = primary
        self.primary_device.data_received.connect(self._on_primary_data, Qt.ConnectionType.QueuedConnection)

        if self.mode == "DUAL" and secondary:
            self.secondary_device = secondary
            self.secondary_device.data_received.connect(self._on_secondary_data, Qt.ConnectionType.QueuedConnection)

    def set_contestant(self, name):
        """更新当前执裁的选手名称，用于日志记录"""
        self.current_contestant = name

    def request_reset(self):
        async def _do_reset():
            coros = []
            if self.primary_device:
                coros.append(self.primary_device.send_reset_command())
            if self.secondary_device:
                coros.append(self.secondary_device.send_reset_command())
            if coros:
                await asyncio.gather(*coros, return_exceptions=True)

            # 重置本地缓存
            self.pri_plus = 0;
            self.pri_minus = 0
            self.sec_plus = 0;
            self.sec_minus = 0
            self._update_score_output()

        asyncio.create_task(_do_reset())

    def _on_primary_data(self, current, evt_type, plus, minus, ts):
        # 记录原始日志 (包含 current_total 供调试)
        storage.log_data(self.index, "PRIMARY", (current, evt_type, plus, minus, ts), self.current_contestant)

        self.pri_plus = plus
        self.pri_minus = minus
        self._update_score_output()

    def _on_secondary_data(self, current, evt_type, plus, minus, ts):
        storage.log_data(self.index, "SECONDARY", (current, evt_type, plus, minus, ts), self.current_contestant)

        self.sec_plus = plus
        self.sec_minus = minus
        self._update_score_output()

    def _update_score_output(self):
        if self.mode == "SINGLE":
            # 单机模式：传统逻辑 (Total = Plus - Minus)
            # ESP32 内部已经计算了 current_total = plus - minus
            # 但为了保持和双机逻辑一致，我们也可以手动算，或者直接信任 current_total
            # 这里沿用 current_total 以匹配 ESP32 显示
            self.last_total = self.pri_plus - self.pri_minus
            self.last_plus = self.pri_plus
            self.last_minus = self.pri_minus
        else:
            # 双机模式 (用户定制需求)：
            # 总分 = 主设备正分 - 副设备正分
            # 重点扣分 (显示在负分栏) = 主设备负分 + 副设备负分 (不参与总分计算)

            self.last_total = self.pri_plus - self.sec_plus
            self.last_plus = self.pri_plus  # 这里的Plus仅指主设备正分，或者也可以定义为 (PriPlus + SecPlus)？

            # 策略：UI上的"Plus"显示主设备正分，UI上的"Minus"显示重点扣分总和
            # "Total" 显示计算后的得分
            self.last_plus = self.pri_plus
            # self.last_plus_extra = self.sec_plus # 副设备正分其实是减分项，UI没地方显示，只能隐含在Total里

            self.last_minus = self.pri_minus + self.sec_minus  # 重点扣分

        self.score_updated.emit(self.last_total, self.last_plus, self.last_minus)