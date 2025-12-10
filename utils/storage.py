import os
import csv
import json
from datetime import datetime

# 基础数据存储路径
BASE_DIR = os.path.join(os.getcwd(), "match_data")


class StorageManager:
    def __init__(self):
        if not os.path.exists(BASE_DIR):
            os.makedirs(BASE_DIR)

        self.current_project_path = None
        # 移除文件句柄缓存，避免多组别切换时文件占用问题，改用每次写入打开关闭(性能对于计分系统足够)

    def create_project(self, project_name, mode):
        """
        创建项目文件夹
        结构: match_data/{Timestamp}_{ProjectName}/
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        # 简单的文件名清洗，防止非法字符
        safe_name = "".join([c for c in project_name if c.isalnum() or c in (' ', '_', '-')]).strip()
        folder_name = f"{timestamp}_{safe_name}"

        self.current_project_path = os.path.join(BASE_DIR, folder_name)
        os.makedirs(self.current_project_path, exist_ok=True)

        # 初始化项目配置
        config = {
            "project_name": project_name,
            "mode": mode,
            "created_at": timestamp,
            "groups": []
        }
        self.save_config(config)
        return config

    def save_config(self, config_data):
        if not self.current_project_path: return
        path = os.path.join(self.current_project_path, "config.json")
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(config_data, f, ensure_ascii=False, indent=2)

    def _get_group_dir(self, group_name):
        """获取(并创建)组别子文件夹"""
        if not self.current_project_path or not group_name:
            return self.current_project_path  # 以此防守，如果没有组名则存根目录

        # 清洗组名防止路径穿越
        safe_group = "".join([c for c in group_name if c.isalnum() or c in (' ', '_', '-')]).strip()
        if not safe_group: safe_group = "Default_Group"

        group_path = os.path.join(self.current_project_path, safe_group)
        if not os.path.exists(group_path):
            os.makedirs(group_path)
        return group_path

    def init_referee_log(self, group_name, ref_index, role):
        """初始化日志文件 (写入表头)"""
        if not self.current_project_path: return

        group_dir = self._get_group_dir(group_name)
        filename = f"referee_{ref_index}_{role}.csv"
        filepath = os.path.join(group_dir, filename)

        if not os.path.exists(filepath):
            with open(filepath, 'w', newline='', encoding='utf-8-sig') as f:
                writer = csv.writer(f)
                writer.writerow([
                    "SystemTime", "BLE_Timestamp", "DeviceRole",
                    "Contestant", "CurrentTotal", "EventType",
                    "TotalPlus", "TotalMinus"
                ])
        return filepath

    def log_data(self, group_name, ref_index, role, packet, contestant_name):
        """
        记录数据到: match_data/项目/组别/referee_x.csv
        """
        if not self.current_project_path: return

        # 1. 确保目录和文件存在
        filepath = self.init_referee_log(group_name, ref_index, role)

        # 2. 解析数据
        current_total, event_type, total_plus, total_minus, ble_timestamp = packet
        system_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]

        # 3. 追加写入
        try:
            with open(filepath, 'a', newline='', encoding='utf-8-sig') as f:
                writer = csv.writer(f)
                writer.writerow([
                    system_time,
                    ble_timestamp,
                    role,
                    contestant_name,
                    current_total,
                    event_type,
                    total_plus,
                    total_minus
                ])
        except Exception as e:
            print(f"[Storage Error] {e}")


storage_manager = StorageManager()