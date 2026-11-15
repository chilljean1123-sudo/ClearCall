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
- 多角色结构：`characters` 文档存 `{ list, activeId }`；每个角色有独立头像（`avatarId` 指向 `files`）、聊天（`chatHistory:<角色id>`）、记忆（`memory:<角色id>`）；可选 `remark` 备注用于通讯录和切换过场展示。新增功能按角色取数时用当前角色 id，别写回全局单份文档。主屏入口名为「通讯录」，内部仍沿用角色数据结构。
- 「我」（用户人设）存 `userProfiles` 文档：`{ list: [{ id, name, persona }], activeId }`，可保存多套；入口是通讯录底部「我的」标签。通讯录底部固定「角色 / 我的」两个按钮，点击切换窗格，不要把两页内容堆在同一屏。当前人设由 `app.js` 的 `buildUserPersonaPrompt()` 注入聊天 system，只注入身份设定、不要求模型复述；备份随 `userProfiles` 一起导出导入。
- 聊天室从「切换」进入通讯录并选中联系人后，先播放全屏切换过场（居中头像 + 荧光旋转描边 + 角色名，有 `remark` 时显示备注），约 1.5 秒后再打开对应聊天窗口。
- 角色的语音、生图绑定存在角色记录里：`voice { enabled, voiceId, model }`、`image { enabled, prompt, referenceImageId }`；参考图 Blob 存 `files`，删除角色或换图时要清理旧文件。
- 世界书条目用 `scope: global | character` + `characterId` 绑定角色；全局条目所有角色参与匹配，角色条目只给绑定角色。选择角色用下拉，不要把所有角色平铺成顶栏标签。
- 角色记忆分三层存各角色的 `memory:<角色id>`：短期记忆 `entries`（按「个人信息 / 约定与待办 / 事件与进展 / 风格偏好」分类，稳定 id）、长期记忆 `longTerm`（每 30 条短期记忆总结 1 条）、核心记忆 `core`（每 5 条长期记忆总结 1 条）；用 `longTermSourceCount` / `coreSourceCount` 记录已归档数量，避免重复总结。总结优先走记忆摘要服务，失败或无配置时用本地摘要兜底；聊天注入顺序为核心 → 长期（最近 10 条）→ 最近 20 条短期。预留向量检索扩展（按 id/text 扩展即可）。
- 聊天气泡颜色、字体与字体颜色存 `appearance` 的 `bubbleColor` / `fontFamily` / `fontColor`，由 `applyChatAppearance()` 写成 CSS 变量 `--user-bubble-bg` / `--chat-font-family` / `--chat-font-color`；留空表示恢复默认，只作用于聊天窗口，不改全局布局。
- 聊天上下文：最近 20 条直接带上，更早内容整理成记忆总结注入 system；记忆服务独立配置，留空则复用聊天 AI 接口。
- 聊天消息除文本外还有 `kind: location | image | sticker | transfer`，附件数据挂在消息上；相册图片 Blob 存 `files`，消息只存 `imageId`。系统指令存在该角色聊天文档的 `directive` 字段，注入下一轮回复后清除。
- 表情包按角色存在 `stickers:<角色id>` 文档，只保存远程 URL 与名称；导入时自动绑定当前角色。角色主动发表情包用 `[[sticker:名称]]` 标记（兼容 id），标记可能和正文混在同一回复里，渲染层必须逐段解析成图片并剥离标记，不能把代码原样显示。
- 电话应用复用角色的聊天记录；通话内发送忽略回复触发设置，直接请求 AI；「重拨」会删掉最后一条角色回复后重新请求。语音合成走后端 `/api/tts`（Vercel 为 `api/tts.js`），无后端时直连 `/audio/speech`；只有角色开启语音才自动播放，浏览器拦截时降级为气泡上的「点按播放」。
- 电话挂断后要把本次新增对话写入该角色记忆（`rememberCallToMemory`）：记忆服务可用时走摘要，未配置或失败时写一条本地摘要兜底，之后再把 `lastSummarizedCount` 推进到最新，避免重复整理。
- 美化数据：主屏壁纸与每个应用图标的图片都存 `files`，`appearance` 用 `wallpaperId` + `icons: { appId: fileId }` 记录引用；禁止用一张图统一覆盖所有图标。单个应用设置自定义图标后，用 `.app-glyph.custom-icon` 隐藏默认底图、边框、线条图标，只显示上传图片。状态栏只做覆盖层，`.app-view` 统一用 `--statusbar-space` 预留安全区，关闭状态栏时只隐藏内容、不取消占位。
- 通知数据：开关与后台保活存 `notification` 文档（`enabled`、`keepAlive`、`soundId` / `soundName` / `soundType`），自定义提示音 Blob 存 `files`，备份随 `files` 一起导出；换提示音或清除时要删除旧文件。
- Dock 只放核心入口（电话、聊天、通讯录、设置），桌面网格放信息、相机、记忆、世界书、论坛、邮箱、阅读；新增应用继续按「高频放 Dock、内容型放桌面」分配，主屏网格保持完整入口。
- 主题跟随系统 `prefers-color-scheme`：默认深色，日间模式在 `styles.css` 末尾的 `@media (prefers-color-scheme: light)` 中覆盖变量与少量硬编码表面，采用 iOS 蓝（#007aff）/ 白 / 灰（#f2f2f7）/ 绿（#34c759）；新增界面必须同时检查日夜两套配色，避免日间出现深色块或浅色文字。
- 邮箱数据存 `email` 文档：`settings`（`characterIds`、`intervalHours` 默认 24、`lastCheckedAt`）、`mails`（`direction: in | out`、`characterId`、`characterName` 快照、主题、正文、已读）、`pending`（聊天工具预约的定时任务 `characterId` / `dueAt`）。邮件生成走 `/api/email`（Vercel 为 `api/email.js`），无后端时直连兼容接口；提示词必须带角色人设、记忆和最近聊天，要求 500-1000 字、符合角色语言风格，并输出 `{subject, body}` JSON。角色来信、用户发信都要写入该角色记忆。
- 邮箱定时调度在页面启动、打开邮箱、回到前台时检查：每个绑定角色按 `intervalHours` 最多一封，每次最多生成 2 封，60 秒内不重复检查；`pending` 任务到期后立即生成，成功才移除。删除角色时从邮箱绑定和 `pending` 中清理，历史邮件保留 `characterName` 快照。
- 聊天工具「邮件」复用同一套邮箱数据：可以立即生成一封，也可以按小时数写入 `pending` 预约送达。
- 小说数据：`books` 文档存书架 `{ list, activeId }`，每本书正文存 `book:<id>`（章节 `{ title, paragraphs }` + 批注），阅读讨论按角色存 `bookChat:<id>`。批注必须带 `chapterIndex` 和 `paragraph`（0 基），删除/修改只允许操作该角色自己的批注；批注与讨论都要写入角色记忆。导入文件解析放在 `public/js/books.js`（TXT 支持 UTF-8/GBK、EPUB 用内置 ZIP + DecompressionStream、PDF 懒加载 pdf.js），解析层只负责转成章节段落，不碰 DOM 数据和存储。阅读时为角色注入人设、记忆、当前章节附近 ±6 段正文和范围内批注，要求 500 字以内自然讨论，并用 `【新增批注 段落=N】` / `【删除批注 ID=】` / `【修改批注 ID=】` 尾注操作批注；正文动作尾注要剥离后再显示。
- 日记数据按角色存在 `diary:<角色id>`：`{ enabled, time, lastWrittenDate, entries }`，每条含 `{ date, title, mood, body, todos:[{ text, done }] }`。入口只在聊天加号工具里，打开时绑定当前聊天角色；「现在写一篇」与定时任务都走 `/api/diary`（Vercel 为 `api/diary.js`，共享 `lib/ai.js` 的 `diaryChat()`），提示词必须带人设、记忆、最近聊天和当天日期，正文 500-800 字，输出 `{title,mood,body,todos}` JSON，明日计划渲染成 iOS 备忘录待办。写完写一条角色记忆，并在小手机内弹通知横幅；页面后台时再补浏览器通知。定时任务在页面启动、打开日记、回到前台时检查，60 秒节流、每次最多 2 篇，`lastWrittenDate` 等于当天就跳过。
- 聊天方式入口已从聊天顶栏移到加号工具菜单（`data-tool="style"`），点击直接进入独立页，不再保留顶栏按钮。
- 角色的聊天方式（口吻）存在角色记录 `chatStyle.options`，选项定义在 `store.js` 的 `CHAT_STYLE_OPTIONS`；`年上/年下`、`网感好/差` 各自互斥。`buildChatStylePrompt()` 生成短规则后拼到 system 人设末尾，普通聊天、通话、共读讨论共用；聊天加号工具的「聊天方式」入口进入独立页，保存后下一轮生效。
- 论坛数据集中存在 `forum` 文档：`settings`（独立 API、`refreshCount`、`worldbookIds`、`characterIds`）、`boards`（多个板块，每个含 `id`/标题/简介/路人提示词）、`activeBoardId`、`profile`（昵称/签名/头像/背景图 id）、`posts`。帖子 `authorType: npc | character | user`，并带 `boardId` 归属板块；角色帖带 `authorId`，评论挂在帖子 `comments` 上。旧数据里的单份 `theme` 会在读写时自动迁移成 `boards`。首页只显示当前板块的帖子，关注/我的跨板块；刷新入口是板块下方的下拉栏（可改生成条数），不设悬浮刷新钮；「我的」页全屏显示并隐藏论坛顶栏、板块与刷新栏。删除板块会同时删除板块内帖子，且至少保留一个板块。用户主页图片 Blob 存 `files`，文档只存 `avatarId` / `coverId`；换图或清除时删除旧文件。删除角色时从 `settings.characterIds` 解绑，但保留历史帖子的作者名快照。
- 论坛生成走后端 `/api/forum`（Vercel 为 `api/forum.js`，共享 `lib/ai.js` 的 `forumChat()`），未部署后端时直连 OpenAI 兼容接口；论坛 API 留空则复用主 AI 配置。刷新生成的帖子要写入绑定角色的记忆；分享帖子到聊天室时写入 `kind: 'forum'` 卡片消息，并写一条记忆。

## 风格约束

- 界面是「虚拟手机」全屏布局，铺满视口，不做居中手机模型、模拟边框或灵动岛；桌面端也按整屏处理。
- 严格区分「设置页」「聊天页」「角色页」「记忆页」「世界书页」等独立页面，用状态切换显示/隐藏，不要混排挤压。
- 设置项和角色里的扩展绑定统一用抽屉（`<details class="drawer">`），点标题才展开；不要把所有字段平铺挤在一起。
- 图标一律用 CSS/SVG 绘制，禁止用「地/图/表/¥/令/邮」等汉字充当功能图标；聊天工具菜单、顶栏入口都遵循这一条。
- 状态切换必须正确隐藏组件（该消失的消失、该出现的出现）。
- 适配移动端视口（以手机屏幕宽度为准）。

## 样式继承（防连带破坏）

- 已确定的 CSS 不要推翻重来，只做增量修改。
- 改样式只针对目标元素，用更具体的选择器，别用全局通配符乱改。
- 这些布局已定版，改动时避免连带破坏：聊天气泡、输入框、顶栏、头像。

## 异常兜底（都要有展示）

- 长文本：自动换行/截断，不撑破布局。
- 超长人设：能正常发送，界面不崩。
- 空消息：给出明确提示，不静默失败。
- 网络失败：显示「原因 + 下一步检查 + 重试入口」，不丢已发内容。

## 制作经验（反复踩过的坑，一句话记录）

- 接口超时 30s 会被网关抢先返回 504，已改为 15s；超时/503 提示「服务商过载，稍后重试或换模型」。
- 回复拆气泡用 `<split>` 分隔「多条消息」；气泡内换行要保留。二者要区分，不要按句号/问号暴力切句。
- 「消息上屏」和「请求 AI」是两个阶段：三种触发模式都先上屏，区别只在何时调 AI。
- 消息要「立刻可见」再谈触发，不要出现发送后看不到自己消息的情况。
- 角色回复只输出角色说的话，格式/身份指令走 system 消息注入，别写进用户消息。
- 浏览器通知：移动端 Chrome 必须通过 Service Worker 的 `showNotification` 才能弹出，`new Notification()` 只作桌面兜底；仅页面切到后台且非通话中时推送。
- 后台保活用 1 秒静音 WAV 循环播放，浏览器自动播放策略会拦截，需等用户下一次点击后重试；关闭开关时立即停止并释放对象 URL。
- 媒体标记不能只按整段文本匹配：模型可能把 `[[sticker:...]]` 和正文放在同一气泡，渲染层要扫描标记、分段生成真实媒体，并对未知标记做占位兜底，避免代码泄漏到界面。

## 待补充

（以后遇到新问题：把一句话解决办法补到「制作经验」，把硬性约束补到上面相应小节。）
