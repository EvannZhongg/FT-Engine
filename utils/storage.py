import os
import csv
import json
import sys
from datetime import datetime
import shutil

# --- 1. 路径定义逻辑 (支持开发环境和打包后的 EXE 环境) ---
if getattr(sys, 'frozen', False):
  # 打包后：数据存在 EXE 同级目录
  PROJECT_ROOT = os.path.dirname(sys.executable)
else:
  # 开发时：数据存在项目根目录
  # 获取当前文件 (utils/storage.py) 的目录
  current_utils_dir = os.path.dirname(os.path.abspath(__file__))
  # 获取项目根目录 (utils 的上一级)
  PROJECT_ROOT = os.path.dirname(current_utils_dir)

# 基础数据存储路径
BASE_DIR = os.path.join(PROJECT_ROOT, "match_data")


class StorageManager:
  def __init__(self):
    # 打印路径方便调试
    print(f"[Storage] Data Path: {BASE_DIR}")

    if not os.path.exists(BASE_DIR):
      os.makedirs(BASE_DIR)
    self.current_project_path = None

  def create_project(self, project_name, mode):
    """创建项目文件夹"""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_name = "".join([c for c in project_name if c.isalnum() or c in (' ', '_', '-')]).strip()
    folder_name = f"{timestamp}_{safe_name}"

    self.current_project_path = os.path.join(BASE_DIR, folder_name)
    os.makedirs(self.current_project_path, exist_ok=True)

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
    if not self.current_project_path: return None
    safe_group = "".join([c for c in group_name if c.isalnum() or c in (' ', '_', '-')]).strip()
    if not safe_group: safe_group = "Default_Group"

    group_path = os.path.join(self.current_project_path, safe_group)
    if not os.path.exists(group_path):
      os.makedirs(group_path)
    return group_path

  def _get_contestant_filepath(self, group_name, contestant_name, ref_index):
    """生成文件路径: Group/选手名_RefX.csv"""
    group_dir = self._get_group_dir(group_name)
    if not group_dir: return None

    # 清洗选手名
    safe_c_name = "".join([c for c in contestant_name if c.isalnum() or c in (' ', '_', '-')]).strip()
    if not safe_c_name: safe_c_name = "Unknown_Player"

    # 文件名格式：PlayerName_Ref1.csv
    filename = f"{safe_c_name}_Ref{ref_index}.csv"
    return os.path.join(group_dir, filename)

  def log_data(self, group_name, ref_index, contestant_name, score_data, event_details):
    """
    记录数据到单独的 CSV
    """
    if not self.current_project_path: return

    filepath = self._get_contestant_filepath(group_name, contestant_name, ref_index)
    if not filepath: return

    # 如果文件不存在，写入表头
    if not os.path.exists(filepath):
      try:
        with open(filepath, 'w', newline='', encoding='utf-8-sig') as f:
          writer = csv.writer(f)
          writer.writerow([
            "SystemTime", "BLE_Timestamp", "DeviceRole",
            "CurrentTotal", "EventType", "TotalPlus", "TotalMinus"
          ])
      except Exception as e:
        print(f"[Storage Init Error] {e}")
        return

    system_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]

    # 追加写入数据
    try:
      with open(filepath, 'a', newline='', encoding='utf-8-sig') as f:
        writer = csv.writer(f)
        writer.writerow([
          system_time,
          event_details.get('timestamp', 0),
          event_details.get('role', 'UNKNOWN'),
          score_data.get('total', 0),
          event_details.get('type', 0),
          score_data.get('plus', 0),
          score_data.get('minus', 0)
        ])
    except Exception as e:
      print(f"[Storage Log Error] {e}")

  def list_projects(self):
    """列出所有历史项目"""
    projects = []
    if not os.path.exists(BASE_DIR): return []
    dirs = sorted(os.listdir(BASE_DIR), key=lambda x: os.path.getmtime(os.path.join(BASE_DIR, x)), reverse=True)
    for d in dirs:
      path = os.path.join(BASE_DIR, d)
      config_path = os.path.join(path, "config.json")
      if os.path.isdir(path) and os.path.exists(config_path):
        try:
          with open(config_path, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
            cfg['dir_name'] = d
            projects.append(cfg)
        except:
          pass
    return projects

  def load_project_config(self, dir_name):
    path = os.path.join(BASE_DIR, dir_name)
    config_path = os.path.join(path, "config.json")
    if os.path.exists(config_path):
      self.current_project_path = path
      with open(config_path, 'r', encoding='utf-8') as f:
        return json.load(f)
    return None

  def load_report_data(self, dir_name):
    """解析 CSV 生成报表数据"""
    project_path = os.path.join(BASE_DIR, dir_name)
    if not os.path.exists(project_path): return {}

    report = {}

    for group_name in os.listdir(project_path):
      group_path = os.path.join(project_path, group_name)
      if not os.path.isdir(group_path): continue

      report[group_name] = {}

      for file in os.listdir(group_path):
        if not file.endswith(".csv"): continue

        if "_Ref" not in file: continue

        try:
          base_name = file.replace(".csv", "")
          player_part, ref_part = base_name.rsplit("_Ref", 1)
          ref_idx = int(ref_part)
          c_name = player_part
        except:
          continue

        if not c_name: continue

        last_row = None
        try:
          with open(os.path.join(group_path, file), 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
              last_row = row
        except Exception as e:
          print(f"Error reading {file}: {e}")
          continue

        if last_row:
          if c_name not in report[group_name]:
            report[group_name][c_name] = {}

          report[group_name][c_name][ref_idx] = {
            "total": int(last_row.get("CurrentTotal") or 0),
            "plus": int(last_row.get("TotalPlus") or 0),
            "minus": int(last_row.get("TotalMinus") or 0)
          }

    return report

  def get_scored_players(self, group_name):
    """获取已打分选手"""
    if not self.current_project_path: return []
    group_dir = self._get_group_dir(group_name)
    if not os.path.exists(group_dir): return []

    scored_contestants = set()
    try:
      for file in os.listdir(group_dir):
        if file.endswith(".csv") and "_Ref" in file:
          base_name = file.replace(".csv", "")
          try:
            c_name, _ = base_name.rsplit("_Ref", 1)
            if c_name: scored_contestants.add(c_name)
          except:
            pass
    except Exception as e:
      print(f"Error scanning scored players: {e}")

    return list(scored_contestants)

  def delete_project(self, dir_name):
    if not dir_name: return False
    safe_name = os.path.basename(dir_name)
    project_path = os.path.join(BASE_DIR, safe_name)
    if os.path.exists(project_path) and os.path.isdir(project_path):
      try:
        shutil.rmtree(project_path)
        return True
      except:
        return False
    return False


# 单例模式
storage_manager = StorageManager()
