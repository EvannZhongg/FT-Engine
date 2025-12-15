# utils/exporter.py
import os
import csv
import zipfile
import io
from datetime import datetime, timedelta


def parse_time(time_str):
    try: return datetime.strptime(time_str, "%Y-%m-%d %H:%M:%S.%f")
    except: return datetime.now()


def format_srt_time(td):
    total_seconds = int(td.total_seconds())
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60
    millis = int(td.microseconds / 1000)
    return f"{hours:02}:{minutes:02}:{seconds:02},{millis:03}"


class ExportManager:
    def __init__(self, storage_mgr):
        self.storage = storage_mgr

    def generate_zip(self, group_name, players, options):
        mem_file = io.BytesIO()
        group_dir = self.storage._get_group_dir(group_name)
        if not os.path.exists(group_dir): return None

        # 加载数据 (适配新文件名)
        data_map = self._load_group_data(group_dir)

        with zipfile.ZipFile(mem_file, 'w', zipfile.ZIP_DEFLATED) as zf:
            for player in players:
                if player not in data_map: continue
                player_refs = data_map[player]
                for ref_idx, events in player_refs.items():
                    # 导出 TXT
                    if options.get('txt'):
                        txt_content = self._generate_txt_content(events)
                        zf.writestr(f"{group_name}/{player}/Ref{ref_idx}_Log.txt", txt_content)
                    # 导出 SRT
                    if options.get('srt'):
                        srt_mode = options.get('srt_mode', 'TOTAL')
                        srt_content = self._generate_srt_content(events, srt_mode)
                        zf.writestr(f"{group_name}/{player}/Ref{ref_idx}_{srt_mode}.srt", srt_content)
        mem_file.seek(0)
        return mem_file

    def _load_group_data(self, group_dir):
        """读取该组所有 CSV 并按选手归类"""
        data = {}

        for f in os.listdir(group_dir):
            if not f.endswith(".csv") or "_Ref" not in f: continue

            # 解析文件名: Player_Ref1.csv
            try:
                base_name = f.replace(".csv", "")
                player_part, ref_part = base_name.rsplit("_Ref", 1)
                ref_idx = int(ref_part)
                c_name = player_part
            except:
                continue

            path = os.path.join(group_dir, f)
            with open(path, 'r', encoding='utf-8-sig') as csvfile:
                reader = csv.DictReader(csvfile)
                for row in reader:
                    # 现在CSV里没有 Contestant 列了，直接用文件名里的 c_name
                    if c_name not in data: data[c_name] = {}
                    if ref_idx not in data[c_name]: data[c_name][ref_idx] = []

                    try:
                        dt = parse_time(row["SystemTime"])
                        data[c_name][ref_idx].append({
                            "dt": dt,
                            "plus": int(row.get("TotalPlus") or 0),
                            "minus": int(row.get("TotalMinus") or 0),
                            "total": int(row.get("CurrentTotal") or 0)
                        })
                    except: pass

        # 排序
        for p in data:
            for r in data[p]:
                data[p][r].sort(key=lambda x: x['dt'])
        return data

    def _generate_txt_content(self, events):
        """生成 TXT: 时间戳 | 正分 | 总分 | 负分"""
        lines = ["Timestamp\tPlus\tTotal\tMinus"]
        if not events: return ""

        start_time = events[0]['dt']
        for e in events:
            # 相对时间 (秒)
            delta = (e['dt'] - start_time).total_seconds()
            lines.append(f"{delta:.3f}\t{e['plus']}\t{e['total']}\t{e['minus']}")

        return "\n".join(lines)

    def _generate_srt_content(self, events, mode):
        if not events: return ""

        srt_entries = []
        start_time_base = events[0]['dt']

        if mode == 'REALTIME':
            # 连击判定逻辑 (与 OverlayView 一致)
            BURST_THRESHOLD = 0.4  # 400ms
            DISPLAY_DURATION = 1.0  # 1s

            # 我们需要重建事件流
            # data_stream: 记录每次变化的 delta
            # events 已经是累积值，需要算出 delta
            prev = {'plus': 0, 'minus': 0}

            current_burst = None  # { start_dt, last_dt, val_plus, val_minus }

            for e in events:
                delta_p = e['plus'] - prev['plus']
                delta_m = e['minus'] - prev['minus']
                prev = {'plus': e['plus'], 'minus': e['minus']}

                if delta_p == 0 and delta_m == 0: continue

                now = e['dt']

                # 判定是否属于当前连击
                is_connected = False
                if current_burst:
                    diff = (now - current_burst['last_dt']).total_seconds()
                    if diff < BURST_THRESHOLD:
                        is_connected = True

                if is_connected:
                    # 累加
                    current_burst['val_plus'] += delta_p
                    current_burst['val_minus'] += delta_m
                    current_burst['last_dt'] = now
                else:
                    # 结算上一个
                    if current_burst:
                        srt_entries.append(self._make_srt_entry(current_burst, start_time_base, DISPLAY_DURATION))

                    # 开启新连击
                    current_burst = {
                        'start_dt': now,
                        'last_dt': now,
                        'val_plus': delta_p,
                        'val_minus': delta_m
                    }

            # 结算最后一个
            if current_burst:
                srt_entries.append(self._make_srt_entry(current_burst, start_time_base, DISPLAY_DURATION))

        else:
            # TOTAL 或 SPLIT 模式 (简单的一秒展示)
            # 逻辑：每当数值变化，生成一条字幕，持续1秒
            # 如果1秒内又有变化，是否截断？标准SRT允许重叠，但为了清晰，我们让上一条在下一条开始时结束

            prev_val = None
            last_entry = None

            for e in events:
                val_str = ""
                if mode == 'TOTAL':
                    val_str = str(e['total'])
                    curr_compare = e['total']
                else:  # SPLIT
                    val_str = f"+{e['plus']} / -{e['minus']}"
                    curr_compare = (e['plus'], e['minus'])

                if curr_compare != prev_val:
                    # 数值变了
                    now = e['dt']

                    # 修正上一条的结束时间 (如果有的话，且时间差小于默认时长)
                    if last_entry:
                        time_since_prev = (now - last_entry['start_abs']).total_seconds()
                        if time_since_prev < 1.0:
                            last_entry['end_abs'] = now  # 截断

                    entry = {
                        'start_abs': now,
                        'end_abs': now + timedelta(seconds=1),
                        'text': val_str
                    }
                    srt_entries.append(entry)
                    last_entry = entry
                    prev_val = curr_compare

        # 生成最终字符串
        output = []
        for idx, entry in enumerate(srt_entries):
            # 计算相对时间
            start_rel = entry['start_abs'] - start_time_base
            end_rel = entry['end_abs'] - start_time_base

            # 格式化
            t1 = format_srt_time(start_rel)
            t2 = format_srt_time(end_rel)

            text = entry.get('text')
            # 如果是 REALTIME 模式，text 需要在这里根据 burst 值生成
            if mode == 'REALTIME' and not text:
                p = entry['val_plus']
                m = entry['val_minus']
                parts = []
                if p > 0: parts.append(f"+{p}")
                if m > 0: parts.append(f"-{m}")
                text = " ".join(parts)

            if text:
                output.append(f"{idx + 1}\n{t1} --> {t2}\n{text}\n")

        return "\n".join(output)

    def _make_srt_entry(self, burst, base, duration):
        return {
            'start_abs': burst['start_dt'],
            'end_abs': burst['last_dt'] + timedelta(seconds=duration),  # 停留1秒
            'val_plus': burst['val_plus'],
            'val_minus': burst['val_minus']
        }