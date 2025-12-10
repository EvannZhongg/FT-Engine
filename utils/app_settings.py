# utils/app_settings.py
import json
import os

SETTINGS_FILE = "app_settings.json"

# 默认配置
DEFAULT_SETTINGS = {
    "language": "zh",
    "reset_shortcut": "Ctrl+G",
    "suppress_reset_confirm": False  # 【新增】默认开启提醒
}

class AppSettings:
    def __init__(self):
        self.settings = DEFAULT_SETTINGS.copy()
        self.load()

    def load(self):
        """加载配置文件，如果不存在则使用默认值"""
        if os.path.exists(SETTINGS_FILE):
            try:
                with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.settings.update(data)
            except Exception as e:
                print(f"Failed to load settings: {e}")

    def save(self):
        """保存当前配置到文件"""
        try:
            with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
                json.dump(self.settings, f, indent=4, ensure_ascii=False)
        except Exception as e:
            print(f"Failed to save settings: {e}")

    def get(self, key):
        """获取配置项"""
        return self.settings.get(key, DEFAULT_SETTINGS.get(key))

    def set(self, key, value):
        """设置配置项并立即保存"""
        self.settings[key] = value
        self.save()

# 全局单例
app_settings = AppSettings()