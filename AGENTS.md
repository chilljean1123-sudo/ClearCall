# 开工必读（AGENTS.md）

本文件是本项目的施工规则与制作经验沉淀。每次开始任何任务前，先通读一遍；改动完成后，若又遇到反复出现的问题，把解决办法总结成一条简短规则补进来。

## 项目是什么

浏览器里运行的「虚拟小手机」，核心是 AI 角色聊天。

- 前端：`public/`（index.html / styles.css / js/）
- 前端分层：`js/store.js`（数据存取）· `js/api.js`（模型调用）· `js/ui.js`（界面渲染）· `js/app.js`（编排入口）
- 本地 Node 服务：`server.js`
- Vercel Serverless：`api/`（chat / test / models / memory）
- 共享代理逻辑：`lib/ai.js`

## 铁律（先想清楚再动手）

- **记忆优先**：任何应用产生的可记忆内容（聊天、通话、语音、生图等），在会话结束或阶段完成时，都必须通过记忆摘要写入对应角色的记忆；不能只留在聊天记录或该应用自己的存档里。新应用沿用「摘要服务 + 本地兜底」的写入方式，保证没配置记忆服务时也不丢内容。
- 新增「用户可以创建的内容」时，同时考虑它的**编辑**和**删除**。
- **内容可删除**：所有应用产生并展示的内容（朋友圈动态与评论、订单、邮件、歌曲、日记、帖子、记忆、角色内容等）都必须提供删除入口；删除时同步清理关联 Blob（`files`）、索引、绑定关系和定时任务，不留孤儿文件或幽灵数据。
- 新增「可以开启的功能」时，同时考虑它的**关闭方式**。
- 改任何东西前，先读相关现有代码，不要凭空假设结构。
- 按职责分层：界面（DOM）、存取数据、调用模型（请求）各归各的文件，新功能沿用已有层，别把多种职责堆进一个文件。
- **媒体不显示代码**：图片、表情包、语音等媒体必须渲染成真实图片或播放控件，不能把内部标记、id、URL、Base64、Markdown、HTML、JSON 等代码直接显示给用户；模型返回的媒体标记必须由渲染层解析并剥离，无法识别时只显示友好的媒体占位提示。

## 数据存储

- **localStorage 只放少量轻量设置与开关**（AI 接口配置、回复触发模式）。
- **IndexedDB 放聊天、角色、记忆、各 App 存档**等结构化/大块数据；库名 `clearcall`，对象仓库 `documents`（按 id 存 JSON 文档）+ `files`（存图片 Blob）。
- 上传的图片用 **Blob** 存在 `files`，其他记录只存**稳定 id** 引用；显示或发给 API 时再转格式（对象 URL / dataUrl）。
- 备份导出/导入走 `store.js` 的 `buildBackup()` / `applyBackup()`，图片在备份里转 base64 dataUrl。
- 存取失败（尤其 `QuotaExceededError` 空间不足）要转成友好提示，别静默丢数据。
- 改动存储结构时，旧数据要先迁移（见 `store.js` 的 `migrate()`），迁移成功再清理旧键。
- 多角色结构：`characters` 文档存 `{ list, activeId }`；每个角色有独立头像（`avatarId` 指向 `files`）、人设大图（`personaImageId`，缺省时一律回退头像）、聊天（`chatHistory:<角色id>`）、记忆（`memory:<角色id>`）；可选 `remark` 备注用于通讯录和切换过场展示。新增功能按角色取数时用当前角色 id，别写回全局单份文档。主屏入口名为「通讯录」，内部仍沿用角色数据结构。
- 「我」（用户人设）存 `userProfiles` 文档：`{ list: [{ id, name, persona, avatarId }], activeId }`，可保存多套；入口是通讯录底部「我的」标签。头像 Blob 存 `files`，人设记录只存 `avatarId`；换图、移除头像或删除人设时要清理旧 Blob，备份随 `userProfiles` 一起导出导入。通讯录底部固定「角色 / 我的」两个按钮，点击切换窗格，不要把两页内容堆在同一屏。当前人设由 `app.js` 的 `buildUserPersonaPrompt()` 注入聊天 system，只注入身份设定、不要求模型复述；备份随 `userProfiles` 一起导出导入。
- 聊天室从「切换」进入通讯录并选中联系人后，先播放全屏切换过场（居中头像 + 荧光旋转描边 + 角色名，有 `remark` 时显示备注），约 1.5 秒后再打开对应聊天窗口。
- 角色的语音、生图绑定存在角色记录里：`voice { enabled, voiceId, model }`、`image { enabled, prompt, referenceImageId }`；参考图 Blob 存 `files`，删除角色或换图时要清理旧文件。角色开启语音后，聊天与通话的新回复都要自动朗读；浏览器拦截自动播放时，降级为气泡上的「播放语音 / 点按播放」按钮，不能静默失败。
- 世界书条目用 `scope: global | character` + `characterId` 绑定角色；全局条目所有角色参与匹配，角色条目只给绑定角色。选择角色用下拉，不要把所有角色平铺成顶栏标签。
- 角色记忆分三层存各角色的 `memory:<角色id>`：短期记忆 `entries`（按「个人信息 / 约定与待办 / 事件与进展 / 风格偏好」分类，稳定 id）、长期记忆 `longTerm`（每 30 条短期记忆总结 1 条）、核心记忆 `core`（每 5 条长期记忆总结 1 条）；用 `longTermSourceCount` / `coreSourceCount` 记录已归档数量，避免重复总结。总结优先走记忆摘要服务，失败或无配置时用本地摘要兜底；聊天注入顺序为核心 → 长期（最近 10 条）→ 最近 20 条短期。预留向量检索扩展（按 id/text 扩展即可）。
- 聊天气泡颜色、字体与字体颜色存 `appearance` 的 `bubbleColor` / `fontFamily` / `fontColor`，由 `applyChatAppearance()` 写成 CSS 变量 `--user-bubble-bg` / `--chat-font-family` / `--chat-font-color`；留空表示恢复默认，只作用于聊天窗口，不改全局布局。
- 聊天上下文：最近 20 条直接带上，更早内容整理成记忆总结注入 system；记忆服务独立配置，留空则复用聊天 AI 接口。
- 聊天消息除文本外还有 `kind: location | image | sticker | transfer`，附件数据挂在消息上；相册图片 Blob 存 `files`，消息只存 `imageId`。系统指令存在该角色聊天文档的 `directive` 字段，注入下一轮回复后清除。
- 表情包按角色存在 `stickers:<角色id>` 文档，只保存远程 URL 与名称；导入时自动绑定当前角色。角色主动发表情包用 `[[sticker:名称]]` 标记（兼容 id），标记可能和正文混在同一回复里，渲染层必须逐段解析成图片并剥离标记，不能把代码原样显示。
- 电话应用复用角色的聊天记录；通话内发送忽略回复触发设置，直接请求 AI；「重拨」会删掉最后一条角色回复后重新请求。语音合成走后端 `/api/tts`（Vercel 为 `api/tts.js`），无后端时直连 `/audio/speech`；只有角色开启语音才自动播放，浏览器拦截时降级为气泡上的「点按播放」。
- 电话挂断后要把本次新增对话写入该角色记忆（`rememberCallToMemory`）：记忆服务可用时走摘要，未配置或失败时写一条本地摘要兜底，之后再把 `lastSummarizedCount` 推进到最新，避免重复整理。
- 美化数据：主屏壁纸与每个应用图标的图片都存 `files`，`appearance` 用 `wallpaperId` + `icons: { appId: fileId }` 记录引用；壁纸铺满方式存 `wallpaperFit`（`cover` 自动铺满 / `contain` 完整显示 / `auto` 原始大小），由 `applyAppearance` 写到 `#view-home` 的 `background-size`。安卓壳通过 `getDeviceInfo` 显示机型、物理分辨率与英寸数。禁止用一张图统一覆盖所有图标。单个应用设置自定义图标后，用 `.app-glyph.custom-icon` 隐藏默认底图、边框、线条图标，只显示上传图片。状态栏只做覆盖层，`.app-view` 统一用 `--statusbar-space` 预留安全区，关闭状态栏时只隐藏内容、不取消占位。
- 桌面布局存 `appearance.homeItems`（应用与小组件混排的扁平数组），`appearance.widgets` 存三个图片小组件的 `fileId`（`small1` / `small2` / `large`）。主屏按 20 格容量自动分页，空间不足自动新建下一页，Dock 固定不随页面移动；小组件 `small` 占 2×2、`large` 占 4×2，图片 Blob 存 `files`。长按桌面图标或小组件进入整理，拖动可换位、可跨页；换图、取下小组件或恢复默认时要清理旧 Blob。
- 通知数据：开关与后台保活存 `notification` 文档（`enabled`、`keepAlive`、`soundId` / `soundName` / `soundType`），自定义提示音 Blob 存 `files`，备份随 `files` 一起导出；换提示音或清除时要删除旧文件。
- Dock 只放核心入口（电话、聊天、通讯录、设置），桌面网格放信息、相机、记忆、世界书、论坛、邮箱、阅读、日程；新增应用继续按「高频放 Dock、内容型放桌面」分配，主屏网格保持完整入口。
- 视觉主题固定为低饱和白‑灰‑粉柔和色系，不跟随系统深色；所有颜色只用 `styles.css` 根部的设计 token（`--color-page-bg` / `--color-surface` / `--color-text-primary` / `--color-text-secondary` / `--color-border` / `--color-accent-light` / `--color-accent` / `--color-divider-soft`），禁止新增高饱和艳丽色。粉色只做局部点缀（hover、标签、小按钮），不做全屏大背景；文字统一灰系，不使用 `#000` 纯黑。
- 邮箱数据存 `email` 文档：`settings`（`characterIds`、`intervalHours` 默认 24、`lastCheckedAt`）、`mails`（`direction: in | out`、`characterId`、`characterName` 快照、主题、正文、已读）、`pending`（聊天工具预约的定时任务 `characterId` / `dueAt`）。邮件生成走 `/api/email`（Vercel 为 `api/email.js`），无后端时直连兼容接口；提示词必须带角色人设、记忆和最近聊天，要求 500-1000 字、符合角色语言风格，并输出 `{subject, body}` JSON。角色来信、用户发信都要写入该角色记忆。
- 邮箱定时调度在页面启动、打开邮箱、回到前台时检查：每个绑定角色按 `intervalHours` 最多一封，每次最多生成 2 封，60 秒内不重复检查；`pending` 任务到期后立即生成，成功才移除。删除角色时从邮箱绑定和 `pending` 中清理，历史邮件保留 `characterName` 快照。
- 聊天工具「邮件」复用同一套邮箱数据：可以立即生成一封，也可以按小时数写入 `pending` 预约送达。
- 小说数据：`books` 文档存书架 `{ list, activeId }`，每本书正文存 `book:<id>`（章节 `{ title, paragraphs }` + 批注），阅读讨论按角色存 `bookChat:<id>`。批注必须带 `chapterIndex` 和 `paragraph`（0 基），删除/修改只允许操作该角色自己的批注；批注与讨论都要写入角色记忆。导入文件解析放在 `public/js/books.js`（TXT 支持 UTF-8/GBK、EPUB 用内置 ZIP + DecompressionStream、PDF 懒加载 pdf.js），解析层只负责转成章节段落，不碰 DOM 数据和存储。阅读时为角色注入人设、记忆、当前章节附近 ±6 段正文和范围内批注，要求 500 字以内自然讨论，并用 `【新增批注 段落=N】` / `【删除批注 ID=】` / `【修改批注 ID=】` 尾注操作批注；正文动作尾注要剥离后再显示。
- 日记数据按角色存在 `diary:<角色id>`：`{ enabled, time, lastWrittenDate, entries }`，每条含 `{ date, title, mood, body, todos:[{ text, done }] }`。入口只在聊天加号工具里，打开时绑定当前聊天角色；「现在写一篇」与定时任务都走 `/api/diary`（Vercel 为 `api/diary.js`，共享 `lib/ai.js` 的 `diaryChat()`），提示词必须带人设、记忆、最近聊天和当天日期，正文 500-800 字，输出 `{title,mood,body,todos}` JSON，明日计划渲染成 iOS 备忘录待办。写完写一条角色记忆，并在小手机内弹通知横幅；页面后台时再补浏览器通知。定时任务在页面启动、打开日记、回到前台时检查，60 秒节流、每次最多 2 篇，`lastWrittenDate` 等于当天就跳过。
- 聊天方式入口已从聊天顶栏移到加号工具菜单（`data-tool="style"`），点击直接进入独立页，不再保留顶栏按钮。
- 角色的聊天方式（口吻）存在角色记录 `chatStyle.options`，选项定义在 `store.js` 的 `CHAT_STYLE_OPTIONS`；`年上/年下`、`网感好/差` 各自互斥。`buildChatStylePrompt()` 生成短规则后拼到 system 人设末尾，普通聊天、通话、共读讨论共用；聊天加号工具的「聊天方式」入口进入独立页，保存后下一轮生效。
- 通讯录角色页是卡包交互：横向卡片列表，正面只有角色名 + 虚化人设图（无大图用头像），第一次点击全屏看大图，再点卡片 3D 翻到背面看完整人设与设置，背面提供「设为当前角色 / 编辑 / 删除」。换图或清除时要删除旧 Blob，缺图时降级头像不能报错。人设大图必须按原图 Blob 保存，不压缩、不缩放（头像才走 `fileToAvatar` 压缩），保证看图模式清晰。
- 日程数据按角色存在 `schedule:<角色id>`：`{ enabled, time, lastRunDate, date, items:[{ start, end, title, place, note }] }`，`time` 默认 `07:00`。入口在桌面「日程」，界面是真实日历月视图 + 当日时间轴，顶部下拉可切换任意角色查看（只影响日程页，不改聊天当前角色）。手动刷新与定时任务都走 `/api/schedule`（Vercel 为 `api/schedule.js`，共享 `lib/ai.js` 的 `scheduleChat()`），提示词必须带人设、世界书、记忆、最近聊天和当天日期，要求生成 6-9 个不重叠的 24 小时制时间段，输出 `{items:[...]}` JSON。生成成功后写入该角色记忆。定时任务在页面启动、打开日程、回到前台时检查，60 秒节流、每次最多 2 个角色，`lastRunDate` 等于当天就跳过。聊天与通话构建 system 时注入 `buildScheduleContextPrompt()`：说明现在几点、当前时段在做什么、接下来做什么，要求自然影响语气但不要逐条汇报日程。
- 电话是模拟真实拨打：进入通话页先显示「正在呼叫…」，随机等待 2-4 秒才接通并开始计时；等待期间输入框、发送、重拨禁用，挂断可以取消。挂断按钮固定在页面底部独立操作行，不挤在输入框里；通话区顶部头像、姓名和波纹装饰只占上半部分，消息列表单独滚动，装饰不得穿过对话内容。
- 请求失败、接口报错不写入聊天气泡：错误消息只存 `error + errorReason + errorHints`，由渲染层在聊天室内以上浮灰底提示卡展示原因、建议和重试，避免失败内容伪装成角色台词。
- 角色档案编辑页统一用轻量卡片：顶部标题 + 大卡片（并排头像 / 人设大图两张图片卡 + 带标签的角色名 / 备注 / 人设字段）+ 默认收起的绑定抽屉 + 底部 sticky 操作栏（取消描边、保存柔粉主按钮）；编辑时隐藏联系人卡片列表，取消或保存后恢复，不要把字段裸铺在页面上。
- 论坛数据集中存在 `forum` 文档：`settings`（独立 API、`refreshCount`、`worldbookIds`、`characterIds`）、`boards`（多个板块，每个含 `id`/标题/简介/路人提示词）、`activeBoardId`、`profile`（昵称/签名/头像/背景图 id）、`posts`。帖子 `authorType: npc | character | user`，并带 `boardId` 归属板块；角色帖带 `authorId`，评论挂在帖子 `comments` 上。旧数据里的单份 `theme` 会在读写时自动迁移成 `boards`。首页只显示当前板块的帖子，关注/我的跨板块；刷新入口是板块下方的下拉栏（可改生成条数），不设悬浮刷新钮；「我的」页全屏显示并隐藏论坛顶栏、板块与刷新栏。删除板块会同时删除板块内帖子，且至少保留一个板块。用户主页图片 Blob 存 `files`，文档只存 `avatarId` / `coverId`；换图或清除时删除旧文件。删除角色时从 `settings.characterIds` 解绑，但保留历史帖子的作者名快照。
- 动态（朋友圈）数据集中存在 `moments` 文档：`settings`（`characterIds`、`intervalHours` 默认 24、`lastCheckedAt`、`lastPostAt` 按角色记录上次发布）、`profile`（`coverId` / `coverTouched`，动态背景图 Blob 存 `files`）、`posts`。动态页「我」的头像优先使用当前 `userProfiles` 的 `avatarId`，缺省再回退论坛主页头像；动态背景独立于论坛背景，`coverTouched` 为 true 后不再回退论坛背景。动态 `authorType` 为 `character | user`，带 `authorId` / `authorName` 快照、`text`、`imageId` 或 `imageDesc`、`likes`、`comments`（评论 `authorType` 还支持 `npc` 路人）。角色动态必须带图：绑定生图（角色 `image.enabled` + 设置里的生图服务）时调 `/api/image` 生成并存入 `files`，否则用 `imageDesc` 文字描述图；每条角色动态配 3-5 条路人评论。用户发动态可自选相册配图，绑定角色会点赞、评论，并在聊天室主动发消息讨论；用户评论角色动态后，角色也在聊天室主动回应。所有发布、点赞、评论与聊天联动都写入对应角色记忆。
- 定时动态在页面启动、打开动态、回到前台时检查，60 秒节流、每次最多 2 条，按 `intervalHours` 与各角色 `lastPostAt` 判断是否到期；删除角色时从 `settings.characterIds` 和 `lastPostAt` 清理，历史动态保留作者名快照。
- 聊天外观变量（`--user-bubble-bg` / `--chat-font-family` / `--chat-font-color`）只写在 `#view-chat` 与 `#view-call` 上，不写 `documentElement`，避免影响其它页面。
- 论坛生成走后端 `/api/forum`（Vercel 为 `api/forum.js`，共享 `lib/ai.js` 的 `forumChat()`），未部署后端时直连 OpenAI 兼容接口；论坛 API 留空则复用主 AI 配置。刷新生成的帖子要写入绑定角色的记忆；分享帖子到聊天室时写入 `kind: 'forum'` 卡片消息，并写一条记忆。
- 多套 AI 接口配置存 localStorage（`clearcall.apiProfiles` / `clearcall.apiProfileActive`），设置页可保存、切换、删除；切换时把 `baseUrl` / `apiKey` / `model` / `modelMode` 写回主接口设置并调用 `save()`，名称留空时自动命名。
- 音乐数据存 `music` 文档：`tracks` 含 `source: local | netease`、本地曲目 `fileId` 指向 `files` 里的音频 Blob、网易云曲目 `neteaseId`、`lyrics`、`playlistName`。网易云 API 地址与登录 cookie 存 localStorage（`clearcall.musicApiBase` / `clearcall.musicNeteaseCookie` / `clearcall.musicNeteaseName`），前端直连用户自部署的 `NeteaseCloudMusicApi`。扫码流程 `/login/qr/key` → `/login/qr/create?qrimg=true` → 轮询 `/login/qr/check`（800 过期 / 801 等待 / 802 已扫 / 803 成功）→ `/user/account` → `/user/playlist` → `/playlist/detail`；歌词用 `/lyric` 取 LRC 并剥离时间轴。分享歌曲给角色时写入 `kind:'music'` 消息，把歌词注入 content，让角色基于歌词谈感受，同时写一条记忆。删除本地曲目要同时删除音频 Blob。
- 感知数据存 `perception` 文档：`{ timeEnabled, locationEnabled, location:{lat,lng,label,at}, weather:{address,text,temp,code,updatedAt}, lastActiveAt }`。设置 → 感知进入独立页；开启真实时间后在聊天/通话 system 注入当前日期、时段与「距上次说话多久」；开启真实地点用 `navigator.geolocation` 取坐标并反查城市；天气用 Open-Meteo 地理编码 + 预报接口，结果落在主屏时间下方，30 分钟内复用缓存。感知提示词只影响语气，禁止复述系统信息。
- 备份导出/导入要覆盖所有新增结构化数据（`music` 已接入；`perception` 属于本机感知偏好，可不跨设备迁移）。
- APK 壳更新提醒：页面加载完成与回到前台时请求 `/api/version`（Vercel 用 `VERCEL_DEPLOYMENT_ID` / `VERCEL_GIT_COMMIT_SHA` / `VERCEL_URL` 作为 `webVersion`，静态站回退 `/version.json`），与本地 `web_version` 比较。有变化弹原生「发现新版本」，「立即更新」清 WebView 缓存并重载，「稍后再说」只忽略本次进程，第二次启动仍会提示；安装包版本变化时重置 `web_version`，避免刚装完就误报。`apkVersion` / `apkUrl` 可由 Vercel 环境变量提供，正按钮打开安装包下载页。

## 安卓壳（android/）

- `android/` 是 WebView 壳，加载 `BuildConfig.APP_URL`（Gradle 属性 `clearcallAppUrl` 或环境变量 `CLEARCALL_APP_URL`）；加载失败时弹原生输入框填写站点地址，存 `SharedPreferences`。
- 全屏采用 edge-to-edge：隐藏系统栏，WebView 一直铺到屏幕边缘；刘海高度、手势区高度按屏幕密度换算成 CSS px 写入 `--shell-inset-top/bottom`，网页再用这些变量留白，禁止给根布局加全局 padding（会出现上下色带）。只有软键盘弹出时才给根部加底部 padding。
- 壳内锁定显示比例：WebView 关闭缩放与缩放按钮、`setTextZoom(100)`、关闭 overview/wide viewport，CSS 在 `html.native-shell` 上设 `touch-action: pan-x pan-y`，只允许滚动，不允许双指或双击缩放。
- 侧边返回通过 `window.__handleAndroidBack()` 回到网页上一个页面（优先点当前页返回按钮），主屏再按一次才退出；键盘打开时先收起键盘。
- 原生能力由 `ClearCallNative` 注入：`getDeviceInfo / getShellState / notify / scheduleNotification / enableNativePush / disableNativePush / requestIgnoreBatteryOptimizations / openBatteryOptimizationSettings / saveTextFile`；网页端「设置 → 手机壳」按桥是否存在显示。备份与世界书导出在壳内走 `saveTextFile`（系统文件选择器），浏览器仍用 Blob 下载。
- 壳内 `Notification` 可能不存在：通知开关先判断 `ClearCallNative.notify`，走 `enableNativePush` 并把 `getShellState().pushEnabled / notificationsGranted` 当作权限状态；`onPause / onResume` 注入 `window.__shellHidden`，让后台回复通知可靠触发。不要用「浏览器不支持通知」直接拦住原生推送。
- 推送走 WorkManager（`PushWorker`）+ 通知渠道，网页 `sendBrowserNotification()` 在壳内优先走原生。
- 覆盖安装三条件：`applicationId` 不变、`versionCode` 递增、签名证书相同。CI 用 `CLEARCALL_VERSION_CODE = github.run_number`，并从 Secrets 读取 `ANDROID_KEYSTORE_BASE64 / ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD` 构建 `assembleRelease`；未配置密钥时退回 debug，只能卸载安装。
- 从旧的 debug 包切换到固定 release 签名必须卸载一次（签名不同）；卸载前先导出备份。之后同一密钥、递增 versionCode 的 APK 可直接覆盖安装并保留数据。
- GitHub Actions `.github/workflows/android.yml` 构建 APK 并上传 artifact；打 `v*` tag 时附加到 Release。

## 风格约束

- 文案不指代性别：需要第三人称时统一用「那个人」，不写「她 / 他」。
- 界面是「虚拟手机」全屏布局，铺满视口，不做居中手机模型、模拟边框或灵动岛；桌面端也按整屏处理。
- **顶栏导航图标统一**：所有应用顶栏的返回按钮一律用左箭头 SVG，设置按钮一律用齿轮 SVG；透明底、无圆框、无阴影，点按有颜色与缩放动画（默认柔粉，按下转白并轻微缩小）。由 `ui.js` 的 `initNavIcons()` 统一注入，新增页面只要给返回按钮加 `.back-btn`、设置按钮 id 以 `-settings` 结尾即可自动套用。
- **文案轻量有诗意**：界面不写冗长说明和实现细节，提示用一句短句（尽量 14 字以内），可带一点文学感；技术必要信息压到最短，状态类提示保留。
- 严格区分「设置页」「聊天页」「角色页」「记忆页」「世界书页」等独立页面，用状态切换显示/隐藏，不要混排挤压。
- 设置项和角色里的扩展绑定统一用抽屉（`<details class="drawer">`），点标题才展开；不要把所有字段平铺挤在一起。设置应用例外：启动时由 `initSettingsPages()` 把每个抽屉转成入口卡片，点击进入独立子页（`#view-settings-sub`），入口带 CSS/SVG 图标，不再在设置首页展开抽屉。
- 图标一律用 CSS/SVG 绘制，禁止用「地/图/表/¥/令/邮」等汉字充当功能图标；聊天工具菜单、顶栏入口都遵循这一条。
- 所有应用、Dock、聊天工具与功能图标必须采用深灰粗图形 + 柔粉/白底的高对比设计（strong visual weight、bold shapes），在低饱和配色内保持醒目易识别；自定义图片图标仍优先于默认 SVG，不得被默认底色或图形覆盖。
- 严格执行 8pt 网格：布局间距只使用 `--space-1` 到 `--space-6`（8/16/24/32/40/48），圆角只使用 `--radius-sm` / `--radius-md` / `--radius-lg`（8/16/24）。
- 字号只使用 `--font-caption` / `--font-body-sm` / `--font-body` / `--font-h3` / `--font-h2` / `--font-h1`（12/14/16/20/24/32），禁止新增字号；正文行高 `--leading-body`（1.6），大标题 `--leading-heading`（1.2），小标题 `--leading-subheading`（1.4）。
- 状态切换必须正确隐藏组件（该消失的消失、该出现的出现）。
- 适配移动端视口（以手机屏幕宽度为准）。
- 设置页的轻量功能（如版本检查）直接做成一行入口卡片，不跳子页；「一键还原」固定放最后，点击必须先弹确认并写明会清空哪些数据。

## 样式继承（防连带破坏）

- 已确定的布局与设计 token 不要推翻重来，只做增量修改；新增界面必须复用现有 token，不得另起一套颜色、字号或间距。
- 改样式只针对目标元素，用更具体的选择器，别用全局通配符乱改。
- 这些布局已定版，改动时避免连带破坏：聊天气泡、输入框、顶栏、头像。

## 异常兜底（都要有展示）

- 长文本：自动换行/截断，不撑破布局。
- 超长人设：能正常发送，界面不崩。
- 空消息：给出明确提示，不静默失败。
- 网络失败：显示「原因 + 下一步检查 + 重试入口」，不丢已发内容。

## 制作经验（反复踩过的坑，一句话记录）

- 接口超时：后端代理 `TEST_TIMEOUT_MS` 为 55s，前端直连 `DIRECT_TIMEOUT_MS` 为 90s；Vercel 在 `vercel.json` 里给 `api/*.js` 配 `maxDuration: 60`，55s 留出网关余量。超时/503 提示「服务商过载，稍后重试或换模型」。
- 回复拆气泡用 `<split>` 分隔「多条消息」；模型写下的换行也一律拆成独立气泡，一个气泡只放一小段话。不要按句号/问号暴力切句。
- 语音、图片等媒体标记不能漏到界面：`[语音消息：0:05]` 渲染成可点的语音条，`[图片]` / `[图片：描述]` / `[[image:...]]` 渲染成图片占位卡；TTS 朗读前必须剥离这些标记。
- 「消息上屏」和「请求 AI」是两个阶段：三种触发模式都先上屏，区别只在何时调 AI。
- 消息要「立刻可见」再谈触发，不要出现发送后看不到自己消息的情况。
- 「居中」不要用固定列数的 grid：图标隐藏或增删后会偏左。Dock 改用 flex + `justify-content: space-evenly`，数量变化也自动居中。
- 角色回复只输出角色说的话，格式/身份指令走 system 消息注入，别写进用户消息。
- 页面是否铺满看定位：`.app-view` 是 `position:absolute; inset:0`，若某个 view 用 ID 改成 `position:relative`，它会退回流式布局、高度由内容撑开；聊天页要 `flex:1 1 auto; min-height:0` 才能让输入框贴底。
- 浏览器通知：移动端 Chrome 必须通过 Service Worker 的 `showNotification` 才能弹出，`new Notification()` 只作桌面兜底；仅页面切到后台且非通话中时推送。
- 后台保活用 1 秒静音 WAV 循环播放，浏览器自动播放策略会拦截，需等用户下一次点击后重试；关闭开关时立即停止并释放对象 URL。
- 媒体标记不能只按整段文本匹配：模型可能把 `[[sticker:...]]` 和正文放在同一气泡，渲染层要扫描标记、分段生成真实媒体，并对未知标记做占位兜底，避免代码泄漏到界面。
- 语音消息 `[语音消息：0:05]` 渲染成 CSS 声波条（12 根高低不一的竖条 + 时长），播放/加载时竖条起伏，不再显示“语音”文字或图标。
- 自定义指令同理会漏到界面：`[转账]¥5.00` 这类文本指令要按标记解析成卡片，`<split>`（含 `<split/>`）只做分段不显示；新增指令统一加进 `renderAssistantPart` 的标记扫描里。
- 聊天气泡宽度必须随内容自适应：`.msg-stack` 用 `align-items: flex-start`（用户侧 `flex-end`），`max-width` 只做上限，不能靠默认 stretch 把短消息拉成整条长条。
- 角色发言底层铁则（OOC 校验、对话席位、活人感、互动边界、记忆连贯、输出格式）写在 `lib/ai.js` 的 `CHAT_BASE_RULES` 与 `public/js/api.js` 的 `DIRECT_BASE_RULES`，固定放在 system 最前，并明确禁止复述或暴露；两份内容必须同步。回复返回前用 `stripThinkBlocks` 剥离 `<thinking>` / `<thought>` 标签，思维链不得进入界面。
- 无标签思维链（如 “Wait, the user says… I should confirm…”）不能只靠提示词：`api.js` 的 `sanitizeAssistantReply` 按行过滤英文元推理，`requestReply` 两条通道都清洗；旧消息在 `ui.js` 渲染时再用 `looksLikeMetaReasoning` 过滤一次。
- 聊天消息长按菜单依赖 `renderMessagesInto` 给每行写 `data-msg-index`；多选圆圈挂在 `.msg-row` 首个子元素（角色在头像前、用户在气泡后），删除按索引从大到小 `splice`，避免索引错位。
- 商城与外卖共用「搜索 → 购物车 → 选角色 → 结算发卡片」模式：`renderShopTabs/Products/Cart` 通过 `boxId`/`prefix` 复用；订单统一存 `kind:'shop'`，用 `shop.type` 区分 `shop`/`food`，卡片必须写 `toName`（送给谁）。
- 音乐播放：本地曲目用 `getFileUrl(fileId)` 的对象 URL，网易云曲目用外链 `https://music.163.com/song/media/outer/url?id=xxx.mp3`；版权或网络问题会触发 `<audio>` 的 `error`，必须提示「播放失败，可能是版权或网络问题」，不能静默。
- 网易云扫码登录依赖用户自部署的 NeteaseCloudMusicApi 且需允许跨域；沙箱里无法实测，只能做代码级校验，界面必须把「填 API 地址」这一步说明清楚。
- 壁纸必须给 `#view-home` 显式写 `background-size: cover; background-position: center; background-repeat: no-repeat;`，只改 inline `background-image` 会沿用 CSS 简写的 `auto`，大图只露左上角，看起来像「没换壁纸」。选图时同时兼容空 MIME 的手机相册文件（按扩展名判断）。
- 天气使用免 Key 的 Open-Meteo：`geocoding-api.open-meteo.com/v1/search` 取坐标，`api.open-meteo.com/v1/forecast?current=temperature_2m,weather_code` 取实况；定位坐标反查城市用 `api.bigdatacloud.net/data/reverse-geocode-client`。天气失败时显示「天气暂时迷路了」，不能静默。
- 更新提醒的「稍后再说」只放内存，不写持久存储；写进持久存储会导致第二次启动不再弹出，与需求相反。
- WebView 壳里不要调用 `webView.onPause()`，否则网页定时任务与后台保活会停；只在 `onResume` 里 `resumeTimers()`。返回键先判断输入法是否可见，再看网页返回栈，避免键盘打开时直接跳页。
- 安卓安全区不要给根布局整圈 padding：系统栏隐藏后露出的窗口底色会形成上下色带。只把刘海/手势区换算成 CSS px 注入 `--shell-inset-*`，键盘弹出时才临时加底部 padding。
- CSS 字体栈里不能把 `inherit` 当字体名和其他字体混写（`"X", inherit` 会让整条 `font-family` 失效，本机字体就一直不生效）；本机字体单独成栈，字体名带空格或以数字开头时加引号。
- 聊天发送键三态：有文字=发送、输入框空且有待回复=回复、请求进行中=正方形停止键。停止只 `abort` 请求，已上屏的消息和待回复状态都保留，不写失败气泡。
- 右滑引用与长按菜单位于同一气泡：气泡要 `touch-action: pan-y`，横向拖动才不会被纵向滚动吃掉；长按计时器在移动超过 10px 时取消，避免滑动同时触发菜单。

## 待补充

（以后遇到新问题：把一句话解决办法补到「制作经验」，把硬性约束补到上面相应小节。）
