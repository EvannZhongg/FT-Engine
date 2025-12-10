# utils/i18n.py
from PyQt6.QtCore import QObject, pyqtSignal
from utils.app_settings import app_settings


class I18nManager(QObject):
    language_changed = pyqtSignal()

    def __init__(self):
        super().__init__()
        self.current_lang = app_settings.get("language")

        self.translations = {
            "zh": {
                # --- 核心菜单翻译 (补全此处) ---
                "app_title": "电子计分系统 PC端",
                "menu_settings": "设置",
                "menu_language": "语言",
                "menu_preferences": "偏好设置...",
                "menu_help": "帮助",
                "menu_project": "项目",

                # --- 新增 Setup Wizard 词条 ---
                "wiz_step1_mode": "1. 模式选择",
                "wiz_mode_free": "自由模式 (自动生成选手 Player 1, 2...)",
                "wiz_mode_tourn": "赛事模式 (自定义分组 & 名单)",
                "wiz_step2_basic": "2. 基础设置",
                "wiz_lbl_proj_name": "项目名称:",
                "wiz_free_settings": "自由模式设置",
                "wiz_tourn_settings": "赛事模式设置",
                "wiz_lbl_free_ref_count": "裁判人数 (统一配置):",
                "btn_next_bind": "下一步: 绑定设备 >>",

                # --- 首页与通用 ---
                "home_new_project": "新建比赛项目",
                "home_continue_match": "继续比赛",
                "home_view_report": "查看成绩单",
                "lbl_history_list": "历史项目记录",
                "lbl_create_time": "创建时间:",
                "lbl_last_update": "最后更新:",
                "msg_select_project": "请先从左侧列表选择一个项目",
                "btn_back": "返回",
                "btn_next": "下一步",
                "btn_finish": "开始比赛",
                "btn_rescan": "重新扫描",

                # --- 向导页 ---
                "wiz_p1_title": "步骤 1/2: 项目设置",
                "wiz_p2_title": "步骤 2/2: 绑定裁判设备",
                "lbl_proj_name": "项目名称:",
                "lbl_game_mode": "比赛模式:",
                "val_free_mode": "自由模式 (自动无限选手)",
                "mode_multi_player": "赛事模式 (需配置组别)",
                "lbl_ref_count": "裁判人数:",
                "status_scanning": "正在扫描蓝牙设备...",
                "status_found": "扫描完成，找到 {} 个设备",
                "status_no_dev": "未找到可用设备",
                "header_referee": "裁判",
                "header_mode": "计分模式",
                "header_dev_pri": "主设备 (正分/总分)",
                "header_dev_sec": "副设备 (负分)",
                "mode_single_dev": "单机模式",
                "mode_dual_dev": "双机联动",
                "placeholder_select": "请选择设备...",
                "msg_duplicate_dev": "错误：设备 {} 被重复选择！",
                "msg_select_all": "请为所有启用的位置选择设备！",

                # --- 计分看板 ---
                "dash_title": "实时计分看板",
                "btn_stop_match": "结束并返回",
                "btn_overlay": "开启悬浮窗",
                "btn_exit_overlay": "退出悬浮",
                "title_select_window": "选择要附着的窗口",
                "lbl_window_list": "当前活动窗口列表:",
                "btn_confirm_overlay": "进入悬浮模式",
                "lbl_curr_group": "当前组别",
                "btn_prev_player": "<< 上一位",
                "btn_next_player": "下一位 >>",
                "chk_auto_next": "连赛模式 (清零自动切换)",

                # --- 裁判与分数 ---
                "referee_name": "裁判",
                "mode_single": "单机",
                "mode_dual": "双机",
                "score_total": "总分",
                "score_plus": "正分",
                "score_minus": "重点扣分",
                "status_waiting": "等待连接...",
                "status_connected": "已连接",
                "status_disconnected": "已断开",
                "device_primary": "主设备",
                "device_secondary": "副设备",

                # --- 弹窗与提示 ---
                "title_scored": "选手已打分",
                "msg_contestant_scored": "选手【{}】已有成绩记录。",
                "msg_want_to_overwrite": "选手【{}】已有成绩。\n\n您想要覆盖/追加成绩，还是结束比赛？",
                "btn_overwrite": "继续打分 (覆盖)",
                "btn_finish_match": "保存并结束比赛",
                "btn_stay": "取消 (留在当前)",

                "title_unsaved": "成绩未保存",
                "msg_unsaved": "当前选手成绩尚未保存（未重置）。\n\n是否在退出前保存？",
                "btn_save_exit": "保存并退出",
                "btn_discard_exit": "不保存，直接退出",
                "title_warning": "提醒",
                "msg_all_contestants_scored": "注意：本组所有选手均已完成打分！",
                "title_reset": "重置确认",
                "msg_reset_confirm": "确定要执行【归零】操作吗？",
                "msg_reset_auto_suffix": "\n\n[连赛模式] 将自动保存当前成绩并切换到下一位。",
                "chk_dont_ask_again": "下次不再提醒",

                # --- 组别管理 ---
                "btn_add_group": "新建组别",
                "btn_del_group": "删除组别",
                "btn_edit_names": "编辑选手名单",
                "header_group_name": "组别名称",
                "header_ref_count": "裁判数",
                "header_player_count": "选手人数",
                "msg_dbl_click_hint": "提示: 选中组别后点击“编辑选手名单”进行录入",
                "dialog_add_group": "新建组别",
                "dialog_group_name_input": "请输入组别名称:",
                "dialog_ref_count": "裁判数量",
                "dialog_ref_count_msg": "该组别配置的裁判人数:",
                "error_group_exists": "该组别已存在！",
                "error_select_group": "请先从列表中选择一个组别！",
                "title_edit_names": "编辑名单 - {}",
                "lbl_names_input": "请输入选手名单 (每行一位):",
                "msg_match_finished": "所有选手均已完成打分！\n\n是否结束比赛并导出成绩？",
                "btn_finish_return": "保存并结束",
                "btn_review": "留在页面查看",

                # --- 偏好设置 ---
                "prefs_title": "偏好设置",
                "tab_shortcuts": "快捷键",
                "lbl_reset_all_shortcut": "全局重置快捷键:",
                "btn_save": "保存",
                "btn_cancel": "取消",

                # --- 报表 ---
                "report_title": "成绩单 & 排名",
                "lbl_filter_group": "筛选组别:",
                "lbl_tech_ratio": "技术分占比 (%):",
                "btn_recalc": "重新计算",
                "btn_export_csv": "导出 CSV",
                "tab_ranking": "总排名",
                "tab_raw_data": "原始数据详情",
                "col_rank": "排名",
                "col_contestant": "选手",
                "col_final_score": "最终得分",
                "header_col_raw": "原始分",
                "header_col_scaled": "折算分"
            },
            "en": {
                # --- Core Menu Translations ---
                "app_title": "Electronic Clicker System",
                "menu_settings": "Settings",
                "menu_language": "Language",
                "menu_preferences": "Preferences...",
                "menu_project": "Project",
                "menu_help": "Help",

                # --- New Setup Wizard ---
                "wiz_step1_mode": "1. Select Mode",
                "wiz_mode_free": "Free Mode (Auto Player 1, 2...)",
                "wiz_mode_tourn": "Tournament Mode (Groups & Lists)",
                "wiz_step2_basic": "2. Basic Settings",
                "wiz_lbl_proj_name": "Project Name:",
                "wiz_free_settings": "Free Mode Settings",
                "wiz_tourn_settings": "Tournament Settings",
                "wiz_lbl_free_ref_count": "Referee Count:",
                "btn_next_bind": "Next: Bind Devices >>",

                # --- Home & General ---
                "home_new_project": "New Match",
                "home_continue_match": "Continue Match",
                "home_view_report": "View Report",
                "lbl_history_list": "History Projects",
                "lbl_create_time": "Created:",
                "lbl_last_update": "Last Update:",
                "msg_select_project": "Please select a project first.",
                "btn_back": "Back",
                "btn_next": "Next",
                "btn_finish": "Start Match",
                "btn_rescan": "Rescan",

                # --- Wizard ---
                "wiz_p1_title": "Step 1/2: Project Settings",
                "wiz_p2_title": "Step 2/2: Bind Devices",
                "lbl_proj_name": "Project Name:",
                "lbl_game_mode": "Game Mode:",
                "val_free_mode": "Free Mode (Auto Infinite)",
                "mode_multi_player": "Tournament Mode (Groups)",
                "lbl_ref_count": "Referee Count:",
                "status_scanning": "Scanning Bluetooth devices...",
                "status_found": "Scan complete. Found {} devices.",
                "status_no_dev": "No devices found",
                "header_referee": "Referee",
                "header_mode": "Mode",
                "header_dev_pri": "Primary (Plus/Total)",
                "header_dev_sec": "Secondary (Minus)",
                "mode_single_dev": "Single Device",
                "mode_dual_dev": "Dual Device",
                "placeholder_select": "Select Device...",
                "msg_duplicate_dev": "Error: Device {} is selected multiple times!",
                "msg_select_all": "Please select devices for all slots!",

                # --- Dashboard ---
                "dash_title": "Live Scoreboard",
                "btn_stop_match": "Stop & Return",
                "btn_overlay": "Floating Overlay",
                "btn_exit_overlay": "Exit Overlay",
                "title_select_window": "Select Target Window",
                "lbl_window_list": "Active Windows:",
                "btn_confirm_overlay": "Start Overlay",
                "lbl_curr_group": "Group",
                "btn_prev_player": "<< Prev",
                "btn_next_player": "Next >>",
                "chk_auto_next": "Auto-Switch (Next on Reset)",

                # --- Referee & Score ---
                "referee_name": "Referee",
                "mode_single": "Single",
                "mode_dual": "Dual",
                "score_total": "Total",
                "score_plus": "Plus",
                "score_minus": "Major Ded.",
                "status_waiting": "Waiting...",
                "status_connected": "Connected",
                "status_disconnected": "Disconnected",
                "device_primary": "Primary",
                "device_secondary": "Secondary",

                # --- Dialogs ---
                "title_scored": "Already Scored",
                "msg_contestant_scored": "Contestant '{}' has been scored.",
                "msg_want_to_overwrite": "Contestant '{}' is already scored.\n\nOverwrite/Append or Finish Match?",
                "btn_overwrite": "Continue (Overwrite)",
                "btn_finish_match": "Save & Finish Match",
                "btn_stay": "Cancel (Stay)",

                "title_unsaved": "Unsaved Score",
                "msg_unsaved": "Current score is not saved (not reset).\n\nSave before exit?",
                "btn_save_exit": "Save & Exit",
                "btn_discard_exit": "Discard & Exit",
                "title_warning": "Warning",
                "msg_all_contestants_scored": "All contestants in this group have been scored!",
                "title_reset": "Reset Confirmation",
                "msg_reset_confirm": "Are you sure you want to RESET ZERO?",
                "msg_reset_auto_suffix": "\n\n[Auto-Switch] Will SAVE results and switch to NEXT.",
                "chk_dont_ask_again": "Don't ask again",

                # --- Group Manager ---
                "btn_add_group": "+ New Group",
                "btn_del_group": "- Delete",
                "btn_edit_names": "Edit Contestants",
                "header_group_name": "Group Name",
                "header_ref_count": "Referees",
                "header_player_count": "Contestants",
                "msg_dbl_click_hint": "Hint: Select a group and click 'Edit Contestants' to manage list.",
                "dialog_add_group": "New Group",
                "dialog_group_name_input": "Enter Group Name:",
                "dialog_ref_count": "Referee Count",
                "dialog_ref_count_msg": "Number of Referees for this group:",
                "error_group_exists": "Group already exists!",
                "error_select_group": "Please select a group first!",
                "title_edit_names": "Edit List - {}",
                "lbl_names_input": "Enter names (One per line):",

                # --- Preferences ---
                "prefs_title": "Preferences",
                "tab_shortcuts": "Shortcuts",
                "lbl_reset_all_shortcut": "Global Reset Shortcut:",
                "btn_save": "Save",
                "btn_cancel": "Cancel",

                # --- Report ---
                "report_title": "Scoreboard & Ranking",
                "lbl_filter_group": "Group Filter:",
                "lbl_tech_ratio": "Tech Ratio (%):",
                "btn_recalc": "Recalculate",
                "btn_export_csv": "Export CSV",
                "tab_ranking": "Ranking",
                "tab_raw_data": "Raw Data",
                "col_rank": "Rank",
                "col_contestant": "Player",
                "col_final_score": "Final Score",
                "header_col_raw": "Raw",
                "header_col_scaled": "Scaled",
                "msg_match_finished": "All contestants have been scored!\n\nFinish match and export results?",
                "btn_finish_return": "Save & Finish",
                "btn_review": "Stay & Review",
            }
        }

    def set_language(self, lang_code):
        if lang_code in self.translations:
            self.current_lang = lang_code
            app_settings.set("language", lang_code)
            self.language_changed.emit()

    def tr(self, key, *args):
        text = self.translations.get(self.current_lang, {}).get(key, key)
        if args:
            try:
                return text.format(*args)
            except:
                return text
        return text

i18n = I18nManager()
