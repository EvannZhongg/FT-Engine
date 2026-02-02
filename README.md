# FT Engine - Professional Electronic Referee System



**FT Engine** 是一款专业的电子裁判系统，专为需要精确计分、实时数据展示和多设备协同的竞技比赛设计（如悠悠球比赛）。该系统结合了 BLE 蓝牙硬件接入、实时波形分析、OBS 直播悬浮窗以及完整的赛事数据管理功能。



## 主要特性



  * **多模式支持**：提供自由模式（Free Mode）和赛事模式（Tournament Mode）。

  * **硬件接入**：支持单/双机位 BLE 计分器连接，实时低延迟数据同步。

  * **实时可视化**：内置波形图（Waveform Widget），直观展示得分趋势与连击判定。

  * **直播增强**：支持透明背景悬浮窗（Overlay），可直接叠加在 OBS 或游戏画面上。

  * **数据管理**：自动保存 CSV 原始数据，支持导出 TXT 日志和 SRT 字幕文件（用于视频后期）。

  * **国际化**：原生支持中/英多语言切换。


-----

## 关键功能说明
- **单设备模式 (SINGLE)**：总分 = Plus - Minus  
- **双设备模式 (DUAL)**：  
  - Plus 来源于主设备  
  - Minus 来源于副设备  
  - 重点扣分 = 主设备 Minus + 副设备 Minus

-----

## 开发环境部署指南



在开始之前，请确保您的系统已安装 **Node.js** (推荐 v16+) 和 **Python 3.9+**，并且电脑具备 **蓝牙功能**。



### 1\. 后端环境配置 (Python)



后端负责处理蓝牙连接、数据聚合与文件存储。



1.  **进入项目根目录**。

2.  **创建并激活虚拟环境**（推荐）：

    ```bash
    python -m venv venv

    # Windows
    .\venv\Scripts\activate

    # Mac/Linux
    source venv/bin/activate
    ```

3.  **安装依赖**：

    ```bash
    pip install -r requirements.txt
    ```

4.  **测试运行后端**（可选，Electron 启动时通常会自动拉起，但开发调试建议单独运行）：

    ```bash
    python server.py

    # 服务默认运行在 http://127.0.0.1:8000
    ```



### 2\. 前端环境配置 (Electron + Vue)



前端负责用户交互界面。



1.  **安装依赖**：

    ```bash
    npm install
    ```

2.  **启动开发模式**：

    ```bash
    npm run dev
    ```

    *注意：在开发模式下 (`is.dev` 为 true)，`src/main/index.js` 会尝试通过 `python server.py` 命令启动后端。请确保您的全局 Python 环境或 IDE 环境已正确配置依赖，或者手动先运行后端服务。*


-----



## 📂 目录结构说明



```text
ft-engine/
├── server.py              # [后端] 程序入口 (FastAPI) - 负责蓝牙交互、WebSocket 推送与业务调度
├── config.yaml            # [配置] 后端配置文件 (定义服务端口等)
├── requirements.txt       # [依赖] Python 后端依赖库
├── package.json           # [构建] Electron/Vue 前端依赖与构建脚本
├── BLE_PROTOCOL.md        # [文档] 蓝牙通信协议规范
├── utils/                 # [后端] 核心工具模块
│   ├── app_settings.py    # 全局设置管理 (单例模式)
│   ├── exporter.py        # 数据导出引擎 (处理 ZIP 打包、生成 SRT 字幕/TXT 日志)
│   └── storage.py         # 存储管理器 (负责 CSV 数据读写、项目与组别结构管理)
├── resources/             # [资源] Electron 应用图标与构建资源
└── src/                   # [前端] Electron 源码目录
    ├── main/              # 主进程 (Main Process)
    │   └── index.js       # 应用生命周期管理、窗口创建、Python 子进程守护
    ├── preload/           # 预加载脚本 (Preload Script)
    │   └── index.js       # 进程间通信桥梁 (IPC)，安全暴露 API 给渲染层
    └── renderer/          # 渲染进程 (Vue 3 + Vite)
        ├── index.html     # Web 页面入口
        └── src/
            ├── assets/      # 静态资源 (全局样式 CSS、图标、SVG 图片)
            ├── components/  # Vue 组件 (包含页面级视图与功能组件)
            │   ├── HomeView.vue     # 主控台界面 (比赛控制核心)
            │   ├── ReportView.vue   # 数据报表界面 (查看历史与导出)
            │   ├── OverlayView.vue  # 直播悬浮窗界面
            │   ├── ScoreBoard.vue   # 通用计分板组件
            │   ├── WaveformWidget.vue # 实时波形图组件
            │   └── ...              # 其他组件 (SetupWizard, NavBar...)
            ├── locales/     # i18n 国际化语言包 (en.json, zh.json)
            ├── stores/      # Pinia 状态管理
            │   └── refereeStore.js  # 核心业务 Store (封装后端 API 调用、同步 WebSocket 状态)
            ├── App.vue      # Vue 根组件
            └── main.js      # Vue 初始化入口
```



## 🔗 蓝牙协议



如果您希望开发适配该系统的硬件，请参阅 [BLE\_PROTOCOL.md](https://www.google.com/search?q=./BLE_PROTOCOL.md)。



-----



**License**: Proprietary / Custom License (Contact Freakthrow for details).

**Author**: Freakthrow Team


