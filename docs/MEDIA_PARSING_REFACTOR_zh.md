# FT Engine 视频解析、绑定与评分时间同步重构

## 1. 文档目的

本文定义 FT Engine 从视频链接解析、选手绑定、播放器加载、播放状态采样、评分事件对齐到历史回放的完整重构方案。实现范围覆盖 YouTube 和 Bilibili，但所有媒体提供方必须通过同一领域契约接入。

本次重构必须满足以下产品结果：

- 一个选手在任意时刻只能绑定一个当前视频链接，不允许同时存在 YouTube 和 Bilibili 两条当前绑定。
- 多个选手可以绑定同一个视频链接；“选手绑定唯一”是按选手限制当前链接，不是按视频链接做全局唯一限制。
- 更新当前链接时保留不可变的历史绑定版本；已经产生的评分事件不得被新链接重新解释。
- 在视频计分工作区切换下一位、上一位或下拉选择其他选手时，统一经过视频绑定确认流程。
- 切换选手时，视频链接决策和播放进度决策必须分开确认：可以沿用相同视频并继续当前进度，也可以沿用相同视频但回到起点。
- 目标选手已有链接时，先询问是否更新链接；没有链接时，提示添加链接或明确选择无视频继续。
- 支持完整评分时间同步的播放器必须提供可信的播放位置、状态和倍速；能力不足时不得写入伪造时间。

## 当前进度（2026-07-21）

本分支为 `refactor/media-parsing-sync`，目标数据库直接使用新 Schema 初始化，不保留旧媒体绑定数据兼容层。

| 阶段                          | 状态                           | 当前证据与边界                                                                                                                                                                |
| ----------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A：领域模型和单绑定约束       | 已完成                         | `media_binding_versions`、单选手当前指针、共享媒体键、绑定版本与评分事件不可变触发器、Bilibili/YouTube 解析、安全短链逐跳/总超时及非公网地址拒绝均有自动化测试。              |
| B：统一播放器与选手切换       | 已完成                         | `MediaPlayer`、带能力声明的 YouTube/Bilibili adapter、统一 `requestContestantSwitch()`、目标链接/进度确认、无视频继续、草稿离开保护和 operation gate 已接入并通过构建与测试。 |
| C：提供方无关同步、回放与导出 | 已完成                         | Main 单调时钟、250 ms stale、session/version/sequence 校验、切换失败恢复、`continue`/`reset`、按 binding version 回放、CSV/SRT 媒体字段和多版本 SRT 隔离均有自动化测试。      |
| D：Bilibili 播放能力分级      | 基础嵌入级已完成，实验级不交付 | 基础 iframe 仅声明 `embed`/`seek_by_reload`，`time_sync=false`，因此不会产生伪造的 aligned 评分时间；完整同步桥接保留为未来可选产品增强，不属于本轮重构完成条件。             |

本轮代码重构已完成。验证结果为 `npm test`（105 项通过）、`npm run typecheck`、`npm run build` 和目标文件 Prettier 检查全部通过。阶段 D 的实验级桥接只有在 Windows x64、macOS arm64、macOS x64 实机矩阵、第三方页面版本探测和合规确认全部通过后才允许另行启用；该发布门槛不改变本轮基础嵌入级已完成的结论。

## 2. 重构前实现与问题

本节保留重构开始时的基线，便于审计差异；当前分支的实现进度见上面的“当前进度”。

当前媒体链路以 YouTube 为唯一提供方：

- `src/shared/media/youtube.mts` 只解析 YouTube URL，并把媒体 ID 限制为 11 位。
- `src/main/match/media-session.mts` 再次使用 YouTube ID 正则，并在捕获结果中硬编码 `provider: 'youtube'`。
- `src/renderer/src/components/YouTubePlayer.vue` 每 100 ms 调用 YouTube IFrame API，向 Main 上报播放位置、状态和倍速。
- `ScoreBoard.vue` 与 `ReplayView.vue` 直接依赖 `YouTubePlayer`，没有提供方适配层。
- `media_bindings` 使用 `UNIQUE (contestant_id, provider)`，因此同一选手可以同时保存多个提供方绑定。
- `CompetitionRepository` 把多条绑定写入单值配置对象，后读到的记录会覆盖先读到的记录。
- `ReplayQuery` 使用无确定排序的 `LIMIT 1` 读取绑定，存在结果不稳定问题。
- 回放事件只按 `media_id` 匹配，没有同时比较提供方、分 P 和绑定版本。
- 上下文切换只处理设备归零和 MatchSession 转换，没有使旧播放器锚点立即失效，也没有处理目标选手的视频链接确认。

上述问题意味着增加一个 Bilibili URL 正则并不能完成需求，必须同时重构领域模型、数据库约束、IPC、播放器组件和上下文切换流程。

## 3. 领域不变量

以下规则必须由 Main/Application 层和 SQLite 共同保证，Renderer 校验只能用于改善交互：

1. 每个 `contestant_id` 最多存在一个当前媒体绑定。
2. 一个视频链接可以被多个选手使用；数据库不得对 `provider/media_id/segment` 建立全局唯一约束。
3. 当前绑定可以更新或删除，但历史绑定版本只能追加，不能修改或删除。
4. 每次更新绑定都生成新的 `binding_version_id` 和递增 `revision`，即使新旧链接属于同一提供方。
5. 每个播放器会话只关联一个选手、一个绑定版本和一个随机 `playback_session_id`。
6. Main 只接受当前比赛上下文、当前绑定版本和当前播放器会话三者完全匹配的播放快照。
7. 上下文开始切换时，旧播放锚点必须先失效；迟到的播放消息不能附着到新选手。
8. 评分事件写入后不可变，事件引用的绑定版本和媒体时间不得被当前绑定更新影响。
9. 只有状态为 `aligned` 的事件可以参与媒体时间轴回放；`not_ready`、`unsupported`、`stale` 和 `context_mismatch` 只能按系统时间查看。
10. 提供方适配器没有通过完整时间同步验收时，只能声明 `embed` 或 `seek_by_reload` 能力，不能声明 `time_sync`。

## 4. 统一媒体契约

### 4.1 链接解析结果

用通用类型替换 `YouTubeMediaBinding`：

```ts
export type MediaProvider = 'youtube' | 'bilibili'

export interface MediaLocator {
  provider: MediaProvider
  media_id: string
  segment: string
}

export interface MediaBinding {
  id: string
  contestant_id: string
  version_id: string
  revision: number
  provider: MediaProvider
  media_id: string
  segment: string
  canonical_url: string
  updated_at: string
}

export interface ParsedMediaUrl {
  provider: MediaProvider
  media_id: string
  segment: string
  canonical_url: string
  embed_url: string
}
```

`segment` 表示提供方内部的子资源：

- YouTube 普通视频固定为空字符串。
- Bilibili 单 P 固定为 `p=1`，多 P 使用 `p=2`、`p=3` 等稳定值。
- 视频回放统一按普通 VOD 处理，起点固定为视频的 0 秒。
- 后续若接入其他提供方，可以保存 episode、clip 或其他提供方专用定位值。

播放器、评分事件和回放匹配使用完整媒体键：

```text
media_key = provider + ":" + media_id + ":" + segment
```

不得再把 `video_id` 当作跨平台唯一标识。

### 4.2 播放器能力

```ts
export interface MediaCapabilities {
  embed: boolean
  play_pause: boolean
  seek: boolean
  playback_rate: boolean
  time_sync: boolean
  seek_by_reload: boolean
  preserve_position: boolean
}

export type MediaProgressMode = 'continue' | 'reset'

export type MediaPlaybackState = 'not_ready' | 'cued' | 'playing' | 'paused' | 'buffering' | 'ended'

export interface MediaPlaybackSnapshot {
  playback_session_id: string
  binding_version_id: string
  sequence: number
  provider: MediaProvider
  media_id: string
  segment: string
  position_ms: number
  duration_ms: number | null
  state: MediaPlaybackState
  playback_rate: number
}
```

`MediaPlaybackSnapshot` 不接受 Renderer 墙上时钟。Main 在收到消息时使用自己的单调时钟建立锚点，避免系统时间调整和跨进程时钟偏差。

## 5. URL 解析与规范化

### 5.1 统一入口

新增 `src/shared/media/normalize-media-url.mts`：

```text
normalizeMediaUrl(value)
├─ normalizeYouTubeUrl(value)
└─ normalizeBilibiliUrl(value)
```

解析器只接受 HTTPS、明确允许的主机名和有限长度输入。必须先使用 `URL` 结构化解析，再匹配 hostname 和 pathname，不允许使用包含关系判断域名。

### 5.2 YouTube

继续支持：

- `youtube.com/watch?v=...`
- `youtu.be/...`
- `youtube.com/shorts/...`
- `youtube.com/embed/...`
- `youtube-nocookie.com/embed/...`

规范链接保持 `https://www.youtube.com/watch?v=<id>`。

### 5.3 Bilibili

首期只支持已经录制完成的视频回放：

- `https://www.bilibili.com/video/BV...`
- `https://m.bilibili.com/video/BV...`
- 带 `?p=N` 的普通或多 P 链接
- `https://b23.tv/...` 短链

可选兼容 `av...` 链接，但必须通过受控的 Bilibili 元数据查询转换为 BV 号，不能在客户端自行猜测转换结果。

短链解析只能在 Electron Main 中执行：

1. 使用独立 HTTP 客户端，不携带应用 Cookie。
2. 最多跟随 3 次重定向，并设置连接和总超时。
3. 每次重定向都拒绝非 HTTPS、环回地址、私网地址和非允许域名。
4. 最终地址必须属于 `bilibili.com` 的明确允许主机。
5. Renderer 只接收规范化结果，不接触重定向请求。

Bilibili 规范链接使用：

```text
https://www.bilibili.com/video/<bvid>/?p=<part>
```

嵌入链接由播放器适配器生成，不持久化第三方临时参数：

```text
https://player.bilibili.com/player.html
  ?bvid=<bvid>
  &p=<part>
  &autoplay=0
  &danmaku=0
```

## 6. 单选手单视频的数据模型

### 6.1 目标表结构

当前绑定表只保存指向不可变版本的指针：

```sql
CREATE TABLE media_binding_versions (
  id TEXT PRIMARY KEY,
  contestant_id TEXT NOT NULL REFERENCES contestants(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  provider TEXT NOT NULL CHECK (provider IN ('youtube', 'bilibili')),
  media_id TEXT NOT NULL,
  segment TEXT NOT NULL DEFAULT '',
  canonical_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (contestant_id, revision)
) STRICT;

CREATE TABLE media_bindings (
  id TEXT PRIMARY KEY,
  contestant_id TEXT NOT NULL UNIQUE REFERENCES contestants(id) ON DELETE CASCADE,
  current_version_id TEXT NOT NULL UNIQUE
    REFERENCES media_binding_versions(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL
) STRICT;
```

`UNIQUE (contestant_id, provider)` 必须改为 `UNIQUE (contestant_id)`。提供方是绑定属性，不是允许多条绑定的维度。不得增加 `UNIQUE (provider, media_id, segment)`，因为同一个视频必须可以绑定给多个选手。

不同选手即使绑定了完全相同的媒体键，也各自拥有自己的 binding version 和评分事件引用。这样更新张三的链接不会改变李四的当前链接，也不会修改任何历史评分。

`score_events` 增加：

```sql
media_binding_version_id TEXT REFERENCES media_binding_versions(id),
media_segment TEXT NOT NULL DEFAULT ''
```

事件继续保留 `media_provider`、`media_id` 和 `media_time_ms` 快照，方便导出和故障诊断；`media_binding_version_id` 是历史回放的权威关联。

### 6.2 更新事务

`replaceContestantMediaBinding()` 必须在一个 SQLite 事务中：

1. 解析并验证 `contestant_id` 和规范化媒体输入。
2. 读取当前 revision，计算 `next_revision`。
3. 向 `media_binding_versions` 追加不可变版本。
4. 按 `contestant_id` upsert `media_bindings.current_version_id`。
5. 提交事务后返回完整 `MediaBinding`。

如果规范化后的 `provider/media_id/segment/canonical_url` 与当前版本完全相同，返回现有绑定，不生成空 revision。

删除当前绑定只删除 `media_bindings` 指针，不删除 `media_binding_versions`。旧评分事件仍可通过版本表回放。

### 6.3 旧数据处理

目标架构允许从新 Schema 初始化，因此正式重构可以直接重建本地数据库，无需兼容任何的旧数据。

## 7. 选手切换与链接确认交互

### 7.1 所有入口统一收口

以下入口必须调用同一个 `requestContestantSwitch(target)`，不能分别实现切换逻辑：

- “下一位选手”按钮。
- “上一位选手”按钮。
- 选手下拉框。
- 全局快捷键触发的自动下一位。
- 全部完成后重新开始。
- 自由模式自动创建并进入下一位选手。

`requestContestantSwitch()` 负责媒体决策，真正的 `commitContestantSwitch()` 才能调用 Main 的上下文切换。

### 7.2 视频工作区中的目标绑定确认

用户在视频计分工作区点击下一位选手时，首先确定目标选手，但不立即归零、完成当前会话或切换上下文。弹窗同时处理两个独立问题：目标选手使用哪条链接，以及播放器从哪个进度开始。

目标已有链接时显示：

```text
下一位选手：李四

已绑定：Bilibili / BVxxxxxxxxxx / P2
是否为李四更新视频链接？

视频链接：
(●) 使用现有链接
( ) 更新链接

播放进度：
(●) 继续当前进度
( ) 回到最初位置

[取消] [确认并进入]
```

- `使用现有链接`：保留目标当前 binding version，进入进度选择。
- `更新链接`：在同一弹窗进入链接编辑状态，预填现有规范链接；解析成功后进入进度选择。
- `取消`：保持当前选手、分数、播放器和链接不变。

`继续当前进度` 只在目标媒体键与当前播放器媒体键相同、且适配器声明 `preserve_position = true` 时可选。它适用于同一录制回放被连续分配给多个选手：播放器不重新加载媒体，只创建新的选手播放会话，并从当前播放位置继续。

`回到最初位置` 会对目标媒体执行 `seekTo(0)`；Bilibili 基础 iframe 使用 `t=0` 重建或等效的起点加载，从视频自身的 0 秒开始。

如果目标链接和当前链接不同，`继续当前进度` 必须禁用并显示“更换视频后从新视频起点开始”。不能把旧视频的秒数直接套用到新视频。

目标没有链接时显示：

```text
下一位选手：李四

李四尚未绑定视频。
[ 视频链接输入框 ]

播放进度：
( ) 继续当前进度（仅当解析后与当前视频相同）
(●) 从新视频最初位置开始

[取消] [无视频继续] [保存并进入]
```

- `保存并进入`：先解析并保存目标链接，再完成当前上下文并切换。
- `无视频继续`：允许正常计分，但目标媒体状态为 `not_ready`，视频工作区显示空状态。
- 如果新链接与当前媒体键相同且播放器支持位置保持，解析成功后可以将进度选为“继续当前进度”；否则强制从新视频起点开始。
- 赛事设置可以在未来增加“视频计分必须绑定链接”的策略；启用时隐藏 `无视频继续`。

如果当前链接编辑器存在未保存修改，必须先显示当前选手的离开保护：

```text
当前选手的视频链接尚未保存。
[取消] [放弃修改] [保存当前链接]
```

不得同时叠加两个 Dialog。离开保护完成后，再进入目标绑定确认步骤。

### 7.3 与现有完成确认的顺序

为避免链接保存失败后当前选手已经被错误完成，顺序固定为：

```text
点击下一位
  -> 处理当前未保存链接
  -> 确认或更新目标选手链接
  -> 选择目标播放进度：continue 或 reset
  -> 显示现有“完成并下一位”确认（若未被设置关闭）
  -> Main 原子完成当前上下文并切换目标上下文
  -> 按进度策略保留播放器位置或加载目标媒体起点
  -> 创建目标播放器会话
  -> 等待播放器 ready 和首个有效快照
```

快捷键和自动下一位不能绕过链接确认。`suppress_reset_confirm` 只控制现有的完成确认，不控制媒体链接确认；否则用户可能无意中沿用错误视频。

### 7.4 交互状态机

```text
idle
  -> checking_current_draft
  -> choosing_target_binding
  -> editing_target_binding
  -> choosing_progress
  -> confirming_completion
  -> switching_context
  -> loading_player
  -> ready

任意可取消状态 -> idle
保存失败 -> editing_target_binding
切换失败 -> choosing_target_binding 或 idle，并保留错误信息
```

切换进行期间禁用选手选择、下一位按钮、快捷键重复触发和链接保存。所有异步操作使用 operation token，过期请求不得覆盖新状态。进度策略需要在真正切换前固定，不能在目标播放器加载后再根据旧弹窗状态补发 seek。

## 8. 播放器适配层

新增通用 `MediaPlayer.vue`，按 provider 选择适配器：

```text
MediaPlayer.vue
├─ adapters/youtube-player-adapter
└─ adapters/bilibili-player-adapter
```

每个适配器必须实现：

```ts
export interface MediaPlayerAdapter {
  capabilities: MediaCapabilities
  load(
    binding: MediaBinding,
    playbackSessionId: string,
    progressMode: MediaProgressMode,
    continuityPositionMs?: number
  ): Promise<void>
  play(): Promise<void>
  pause(): Promise<void>
  seekTo(positionMs: number): Promise<void>
  getSnapshot(): Promise<MediaPlaybackSnapshot | null>
  destroy(): Promise<void>
}
```

Vue 组件只负责布局、错误状态和用户命令。播放状态归一化、采样和提供方差异必须留在适配器内。

适配器在 `progressMode = 'continue'` 时不得隐式重置视频。若不能保证位置保持，必须返回 `MEDIA_PROGRESS_CONTINUITY_UNAVAILABLE`，由 UI 让用户改选 `reset`，不能静默从 0 开始却仍显示“继续当前进度”。

### 8.1 YouTube

YouTube 适配器继续使用公开 IFrame API：

- `getCurrentTime()` 获取秒并转换为整数毫秒。
- `getPlayerState()` 映射统一状态。
- `getPlaybackRate()` 获取倍速。
- `loadVideoById()`/`cueVideoById()` 实现载入与跳转。
- 同一媒体切换选手且选择 `continue` 时保留现有 Player 实例和位置，只更新 `playback_session_id`；选择 `reset` 时调用 `seekTo(0)` 或重新 cue 到 0。
- 播放期间每 100 ms 发送快照，暂停、拖动、倍速和状态变化时立即发送。

### 8.2 Bilibili

Bilibili 官方外链播放器可以 iframe 嵌入，并支持 BV、分 P、`t`、`autoplay`、`muted` 和 `danmaku` 参数，但没有公开且稳定的父页面播放器控制 API。普通 Renderer 受同源策略限制，不能读取 iframe 内部 `<video>.currentTime`。

因此 Bilibili 分两级交付：

#### 基础嵌入级

- 使用 `player.bilibili.com/player.html` iframe。
- 支持载入 BV 和分 P。
- 支持通过重建 iframe 并传入 `t` 参数跳到评分时间。
- 同一 Bilibili iframe 是否能保持当前位置由 frame bridge/播放器能力决定；基础 iframe 只能可靠提供 `reset`，不能把重新加载后的时间当成 `continue`。
- `capabilities.time_sync = false`。
- 所有评分事件的媒体同步状态为 `unsupported` 或 `not_ready`，不得根据父页面计时器推测媒体时间。

#### 完整同步实验级

如产品必须实现 Bilibili 完整同步，使用 Electron Main 管理的受限 frame bridge：

1. 只对来源严格等于 `https://player.bilibili.com` 的子 frame 注入打包在应用内的固定桥接脚本。
2. 桥接脚本优先监听标准 `HTMLMediaElement` 的 `timeupdate`、`play`、`pause`、`waiting`、`seeking`、`seeked`、`ratechange` 和 `ended` 事件。
3. 播放期间以 100 ms 心跳补充快照，消息通过 `window.parent.postMessage` 发出。
4. 父页面严格校验 `event.origin`、随机 nonce、`playback_session_id`、绑定版本和消息 Schema。
5. 不给远程 frame Node 权限，不关闭 `webSecurity`、`sandbox` 或 `contextIsolation`。
6. frame 导航、崩溃、媒体元素替换或超过 250 ms 无快照时立即撤销 `aligned` 状态。
7. 如果播放器未暴露标准媒体元素，只能使用隔离的内部 API 兼容层；该层必须有版本探测和快速关闭开关。

这个桥接依赖第三方页面结构，不属于 Bilibili 公开 SDK 保证。只有通过 Windows/macOS 实机矩阵、稳定性观察和合规确认后，才能把 `capabilities.time_sync` 打开；否则产品保持基础嵌入级。

禁止通过以下方式实现：

- 设置 `webSecurity: false`。
- 给 Bilibili iframe 或页面开启 `nodeIntegration`。
- 把 Cookie、登录凭据或任意脚本交给 Renderer。
- 依赖带签名且短时过期的媒体直链作为永久绑定。
- 只用 `Date.now()` 从点击播放开始累加时间，因为暂停、缓冲、拖动和倍速都会使结果错误。

## 9. 完整评分时间同步

### 9.1 Main 中的播放锚点

Main 收到合法快照时记录：

```ts
interface PlaybackAnchor {
  playback_session_id: string
  binding_version_id: string
  group_name: string
  contestant_name: string
  provider: MediaProvider
  media_id: string
  segment: string
  position_ms: number
  state: MediaPlaybackState
  playback_rate: number
  sequence: number
  received_at_monotonic_ms: number
}
```

每个快照必须验证：

- 会话 ID、绑定版本、选手和当前 MatchContext 一致。
- `sequence` 严格递增，重复或倒序消息直接丢弃。
- 媒体键与绑定版本一致。
- `position_ms >= 0` 且不超过已知 duration 的容差范围。
- `playback_rate` 在提供方支持的允许范围内。
- 状态属于统一枚举。

### 9.2 评分时刻计算

设备计分事件到达 Main 时，使用同一个 Main 单调时钟读取锚点年龄：

```text
age_ms = monotonic_now - anchor.received_at_monotonic_ms

if age_ms > 250:
  status = stale
  media_time_ms = null
else if state == playing:
  media_time_ms = round(position_ms + age_ms * playback_rate)
  status = aligned
else if state in [paused, cued, ended]:
  media_time_ms = position_ms
  status = aligned
else:
  status = not_ready
  media_time_ms = null
```

`buffering` 默认不外推时间。播放器在缓冲期间可能短暂推进或回退，必须等待新的确定快照。

评分事件和媒体快照都在 Main 内汇合，Platform Worker 不感知媒体，也不计算时间偏移。

### 9.3 上下文切换竞态

上下文切换开始时执行：

1. 将旧 `playback_session_id` 标记为 closing。
2. 立即清空 `PlaybackAnchor`。
3. 停止旧播放器采样并等待最多一个短超时，不依赖它成功关闭。
4. 在数据库事务中完成当前 MatchSession 并激活目标 MatchSession。
5. 提交后更新 Main 当前上下文。
6. 为目标绑定生成新的随机 `playback_session_id`。
7. 如果 `progress_mode = continue`，保留同一媒体实例的位置；如果 `reset`，在新会话首个快照前清除旧位置并向适配器发出 `seekTo(0)` 或起点加载命令。
8. 通知 Renderer 加载目标播放器。

旧 frame 的迟到消息因为会话 ID 不匹配而被拒绝。目标播放器首个合法快照到达前，媒体状态保持 `not_ready`。

### 9.4 同步状态

目标状态扩展为：

```ts
export type MatchMediaStatus =
  | 'not_ready'
  | 'aligned'
  | 'stale'
  | 'context_mismatch'
  | 'unsupported'
  | 'error'
```

- `unsupported`：播放器能嵌入，但适配器不能提供可信时间。
- `error`：播放器或桥接失败，用户可以在浏览器打开链接或重试。
- 状态必须显示在视频计分工作区，不用普通网络错误掩盖同步能力不足。

## 10. IPC 与事务边界

上下文切换需要把媒体决策作为受校验的输入传给 Main：

```ts
export interface ContextTransitionInput {
  group_name: string
  contestant_name: string
  binding_version_id: string | null
  progress_mode: MediaProgressMode
  expected_media_key: string | null
}
```

`expected_media_key` 只用于防止 Renderer 在弹窗期间看到旧播放器状态；真正的当前位置和绑定版本由 Main 当前会话重新读取。`progress_mode = 'continue'` 还必须满足：Main 有不超过 250 ms 的有效锚点、目标版本的完整媒体键与当前媒体键相等、当前适配器声明 `preserve_position = true`。否则 Main 返回 `MEDIA_PROGRESS_CONTINUITY_UNAVAILABLE`，要求 Renderer 让用户改选 `reset`。

建议 IPC：

```ts
media.parseUrl(url): Promise<ParsedMediaUrl>
media.getBinding(group, contestant): Promise<MediaBinding | null>
media.replaceBinding(group, contestant, url): Promise<MediaBinding>
media.removeBinding(group, contestant): Promise<void>
match.beginPlayback(playbackSession): Promise<void>
match.syncPlayback(snapshot): Promise<MatchMediaStatus>
match.transitionContext(input: ContextTransitionInput): Promise<ContextTransitionResult>
```

`match.transitionContext` 接收目标选手、已经确认的目标 `binding_version_id` 和 `progress_mode`，在 Main 中重新读取并验证，不能信任 Renderer 缓存。多个选手使用同一媒体键时，仍然传入各自选手的 binding version，不得共享选手身份或评分会话。

完成当前选手和切换下一位必须保持现有目标架构要求的原子事务。链接更新事务应在切换事务之前完成；如果链接保存失败，比赛上下文不改变。如果保存成功但后续切换失败，新链接仍作为目标选手当前绑定保留，Renderer 显示切换失败并允许重试。

稳定错误码至少包括：

| 错误码                                  | 含义                                   |
| --------------------------------------- | -------------------------------------- |
| `MEDIA_URL_INVALID`                     | URL、BV 号、视频 ID 或分段非法         |
| `MEDIA_URL_UNSUPPORTED`                 | 不支持的提供方或域名                   |
| `MEDIA_SHORT_URL_RESOLVE_FAILED`        | 短链解析失败或重定向不安全             |
| `MEDIA_BINDING_CONTEXT_NOT_FOUND`       | 目标选手不存在                         |
| `MEDIA_BINDING_VERSION_CONFLICT`        | 编辑期间绑定已被其他操作更新           |
| `MEDIA_PLAYBACK_UNSUPPORTED`            | 提供方不能提供完整时间同步             |
| `MEDIA_PLAYBACK_SESSION_MISMATCH`       | 播放器会话已过期或上下文不匹配         |
| `MEDIA_PLAYBACK_INVALID`                | 播放快照格式或数值非法                 |
| `MEDIA_PLAYER_UNAVAILABLE`              | 远程播放器无法加载                     |
| `MEDIA_PROGRESS_CONTINUITY_UNAVAILABLE` | 当前提供方或播放器不能保证沿用播放进度 |
| `MATCH_OPERATION_IN_PROGRESS`           | 已有上下文切换或控制操作进行中         |

## 11. 回放、导出与绑定更新

### 11.1 回放查询

`ReplayQuery` 返回：

- 选手当前绑定，供默认打开使用。
- 评分事件引用到的所有不可变绑定版本。
- 每个事件的 `binding_version_id`、provider、media ID、segment、time 和 sync status。

回放选择规则：

1. 有 aligned 事件时，默认选择最近一次完成会话所使用的绑定版本。
2. 用户可以在历史绑定版本之间切换。
3. 当前绑定更新后，不把旧事件投射到新视频。
4. 匹配必须使用 `binding_version_id`；旧数据没有版本 ID 时才回退到完整媒体键。
5. `buildReplayScores()` 同时接收 binding version，不再只比较 `videoId`。

### 11.2 导出

CSV/SRT/ZIP 至少导出：

- `media_binding_version_id`
- `media_provider`
- `media_id`
- `media_segment`
- `media_time_ms`
- `media_sync_status`

只有 `aligned` 事件进入 SRT 媒体时间轴。其他事件仍保留在 CSV 和审计数据中。

## 12. 安全要求

- Renderer CSP 只增加必要的 Bilibili `frame-src`，不改成任意 HTTPS。
- 主窗口继续保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true` 和 `webSecurity: true`。
- 外部播放器新窗口继续交给受控的 `openExternalUrl`，并校验协议和允许域名。
- iframe 消息必须校验精确 origin、Schema、nonce、会话 ID、绑定版本和长度。
- Bilibili frame bridge 只能注入固定的本地脚本，不接受远程下发或用户输入代码。
- 短链解析防止 SSRF，不访问本机、局域网、云元数据地址和非允许域名。
- 日志记录 provider、媒体键、binding revision、playback session 和稳定错误码，不记录 Cookie、签名 URL 或账户凭据。

## 13. 实施阶段

### 阶段 A：领域模型和单绑定约束

- 新增通用媒体契约与 `normalizeMediaUrl()`。
- 实现 Bilibili BV、分 P 和安全短链解析。
- 新建绑定版本表，把唯一约束改为 `contestant_id`。
- 重构 Repository、CompetitionConfig 和 IPC 类型。
- 更新当前 YouTube 测试，增加跨提供方和唯一约束测试。

阶段完成标准：同一选手保存 Bilibili 后不会残留另一条 YouTube 当前绑定，旧 binding version 仍存在。

### 阶段 B：统一播放器与选手切换流程

- 新增 `MediaPlayer` 和 YouTube adapter。
- 新增 Bilibili 基础嵌入 adapter。
- 把所有选手切换入口收口到统一状态机。
- 实现目标链接确认、编辑、无视频继续和当前草稿离开保护。
- 增加多语言文案与键盘焦点管理。

阶段完成标准：下一位、下拉选择、快捷键和自由模式新增选手都不能绕过链接决策；取消操作不改变当前比赛状态。

### 阶段 C：提供方无关的完整同步

- 播放快照加入 provider、segment、binding version、session ID 和 sequence。
- Main 使用单调时钟锚点计算评分媒体时间。
- 上下文切换先撤销旧锚点，再建立新播放器会话。
- 上下文切换支持 `continue`/`reset` 进度策略，且只允许相同媒体键继续进度。
- 评分事件引用不可变绑定版本。
- 回放与导出改为按 binding version 工作。

阶段完成标准：YouTube 在播放、暂停、缓冲、拖动和倍速下都能产生正确的 aligned/stale 状态；旧播放器迟到消息不能污染新选手。

### 阶段 D：Bilibili 完整同步实验增强（本轮不交付）

- 实现严格 allowlist 的 Electron frame bridge。
- 完成播放器 DOM/API 版本探测、崩溃恢复和关闭开关。
- 在 Windows x64、macOS arm64 和 macOS x64 实测。
- 完成平台条款与长期维护风险确认。

只有实验增强验收全部通过，Bilibili adapter 才能声明 `time_sync = true`。实验增强不阻断已完成的阶段 A 到 C 与 Bilibili 基础嵌入级交付；在此之前 Bilibili 保持基础嵌入播放器能力。

## 14. 测试与验收矩阵

### 14.1 自动化测试

- YouTube 所有已支持 URL 形式继续规范化成功。
- Bilibili BV、移动端、分 P、无协议输入和短链规范化成功。
- HTTP、伪造子域名、超长 URL、非法 BV、非法分 P 和危险重定向被拒绝。
- 同一选手从 YouTube 更新到 Bilibili 后只有一个当前绑定，revision 加一。
- 两个或更多选手绑定同一个 provider/media_id/segment 成功，彼此拥有独立当前绑定和评分会话。
- 相同规范链接重复保存不创建新 revision。
- 更新和删除当前绑定不删除历史版本和旧评分事件。
- 切换弹窗的三个动作产生确定结果，取消不调用 `setContext`。
- 快捷键连续触发只产生一个切换 operation。
- 旧 session ID、旧 binding version、倒序 sequence 和错误媒体键被拒绝。
- 播放、暂停、倍速、缓冲和 250 ms stale 边界使用可控单调时钟测试。
- 同一视频切换选手并选择 `continue` 时位置保持；选择 `reset` 时位置为 0。
- 更换视频时 `continue` 选项被禁用或被 Main 拒绝，不能把旧视频时间套用到新视频。
- 同一视频回放在多个选手之间连续切换时可以保持当前播放位置；明确选择 `reset` 后从该回放的 0 秒开始。
- 回放按 binding version 隔离，同一个 BV 的不同分 P 不混合。
- 不支持时间同步的 Bilibili 基础 adapter 永远不产生 aligned 事件。

### 14.2 端到端验收

| 场景                             | 预期                                                              |
| -------------------------------- | ----------------------------------------------------------------- |
| 下一位已有链接并选择使用现有链接 | 完成当前选手，加载目标链接，首个快照前为 not_ready                |
| 下一位已有链接并选择更新         | 保存新 revision 后切换，旧评分仍关联旧 revision                   |
| 下一位使用同一视频并选择继续进度 | 播放器不回到 0，目标创建新 playback session，后续评分属于目标选手 |
| 下一位使用同一视频并选择回到起点 | 播放器执行 `seekTo(0)` 或等效起点加载后再产生 aligned 快照        |
| 下一位更换视频并尝试继续进度     | 选项禁用或返回 continuity error，不发生错误的时间继承             |
| 多个选手绑定同一个视频           | 保存成功，当前绑定按选手隔离，评分事件不互相混用                  |
| 同一视频回放连续切换并保持进度   | 继续当前回放位置，不重新加载视频                                  |
| 下一位无链接并选择无视频继续     | 正常计分，媒体状态为 not_ready，不写媒体时间                      |
| 链接保存失败                     | 不完成当前会话，不归零，不切换选手                                |
| 切换过程中旧播放器继续发消息     | Main 拒绝旧 session，目标事件不受污染                             |
| 播放中评分                       | 使用 Main 单调时钟外推到评分发生时刻                              |
| 暂停时评分                       | 使用暂停位置，不继续外推                                          |
| 缓冲或快照超过 250 ms            | 写入 null 时间和非 aligned 状态                                   |
| 回放旧链接后更新当前链接         | 旧事件仍打开旧绑定版本，新事件打开新版本                          |
| Bilibili 仅基础嵌入              | 可播放和按 t 重载跳转，但不显示精确同步成功                       |

### 14.3 Bilibili 完整同步实机矩阵

- 登录和未登录状态。
- 单 P 和多 P。
- 播放、暂停、拖动、缓冲、结束和倍速。
- iframe 内跳转、播放器重载和网络断开恢复。
- Windows x64、macOS arm64、macOS x64。
- 连续运行至少一场完整赛事，并检查评分点与画面误差。
- Bilibili 页面结构无法识别时安全降级为 `unsupported`，应用不崩溃。

## 15. 完成定义

- 数据库和 Main 强制每位选手最多一个当前视频绑定。
- 数据库允许多个选手绑定相同的媒体键，但不允许单个选手存在多个当前绑定。
- 当前绑定每次真实更新都生成不可变 revision，旧评分可复现。
- 所有选手切换入口都经过同一链接确认状态机。
- 在视频工作区点击下一位时，目标已有链接会先询问是否更新，目标无链接会提示添加或无视频继续。
- 在视频工作区点击下一位时，目标链接确认之后还必须选择“继续当前进度”或“回到最初位置”；更换媒体时只能从新媒体起点开始。
- 链接解析、绑定保存和上下文切换失败时不会导致错误归零或错误完成会话。
- 播放快照包含 provider、segment、binding version、session ID 和递增 sequence。
- Main 使用单调时钟和 250 ms 新鲜度窗口计算评分媒体时间。
- 回放和导出按不可变绑定版本工作，不依赖选手当前链接。
- YouTube 完整同步通过自动化测试和三平台验收。
- Bilibili 基础嵌入不伪装成完整同步；只有安全桥接和实机矩阵通过后才启用完整同步。
- Electron 的 CSP、sandbox、context isolation 和 web security 不因第三方播放器而降级。
