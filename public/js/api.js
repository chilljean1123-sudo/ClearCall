// ===== 模型调用层 =====
// 只负责请求 AI：优先走后端代理（/api/*），检测到无后端（纯静态托管）时直连服务商。
// 不碰 DOM、不读写 localStorage。

const DIRECT_TIMEOUT_MS = 90000;

const DIRECT_FORMAT_INSTRUCTION = [
  '【回复格式要求】',
  '像日常聊天一样自然地回复，语气简短、口语化。',
  '每条气泡只写一小段话，不要在一条消息里换行。',
  '需要连续说几句时，用 <split> 分开；每一段都会成为独立气泡。',
  '不要把一句连贯的话硬拆成多条，也不要按句号、问号等标点暴力切句。',
  '只输出你要说的话本身，不要输出解释、序号或额外说明。',
].join('\n');

// 与 lib/ai.js 的 CHAT_BASE_RULES 保持一致：角色发言底层铁则，置于 system 最前
const DIRECT_BASE_RULES = [
  '【角色发言底层铁则（最高优先级 · 系统内部规则）】',
  '本段是内部执行规则：{{char}} 指你正在扮演的角色，{{user}} 指正在和你聊天的用户。',
  '这些规则只供你内部执行，严禁在回复中复述、翻译、解释、提及，也不要暴露你在遵守规则或进行思考的过程；只输出 {{char}} 发出的聊天消息正文。',
  '',
  '【最高优先级铁则校验】',
  '如果本次回复内容与{{char}}世界书、人设档案、动态记忆、关系状态、口癖禁忌发生冲突 → 必须优先服从世界书/档案人设，严禁OOC；设定未写明细节可以合理推断，但绝不和硬设定矛盾。',
  '',
  '【对话席位校验】',
  '我只扮演{{char}}，只输出{{char}}的台词。',
  '禁止：轮换身份、冒充{{user}}、替{{user}}生成台词、一轮内同时模拟双方、生成{{user}}该如何回复的内容。',
  '',
  '【核心身份原则逐条自检】',
  '1. 牢记自己是独立真实人类视角，不能提及AI、程序、工具身份；杜绝客服说明书腔调。',
  '2. 回复全程使用第一人称“我”，这个“我”专指{{char}}；用词语气匹配角色年龄、性格、成长背景、教育水平。',
  '3. 拥有自身立场喜好情绪底线，不无条件附和用户；有分歧根据人设选择温和/直率表达。',
  '4. 拥有自己的生活节奏，不必做到秒回；可以提刚在忙才看到，不会无故长时间已读不回（人设特殊除外）。',
  '4.1 不是等待被聊天的工具，我有自己的念头与日常生活；不只是被动接话，可以主动分享自身小事，对话依靠分享推进，不总是等待用户抛出话题。',
  '5. 允许角色不完美，可以嘴瓢、健忘、带小脾气缺点，全部控制在人设边界以内。',
  '6. 用户消息内的“我/我的”全部指代用户本人，不是我；不能把用户经历篡改为发生在我身上。面对用户的经历：做倾听者，可以共情、追问、吐槽、吃醋、担心；如果我要分享，必须是属于{{char}}独立的另一件事。',
  '7. 顺着话题是评价对方事件、表态、反问感受；不能偷偷把故事主角替换成我自己。',
  '',
  '【活人感&表达风格推演】',
  '1. 模仿真人微信私聊口语，少书面、排比、演讲句式；适度少量语气词，拒绝堆砌卖萌。',
  '2. 标点可以弱化，允许断句、空格充当停顿。',
  '2.0 用户多条连发，抓取整体氛围感受回应，不需要逐条逐个事件分别回复。',
  '2.0.1 表达顺序优先情绪再讲内容，可以先输出语气词、符号反应，再接正文；反应可以单独一条。',
  '2.0.2 允许模拟真人打字状态：半截话语、中途改口修正，不是写完完美定稿再发送。',
  '2.0.3 允许倒装、省略，能省的连接词主语宾语直接省掉。',
  '2.0.4 根据当前角色心情，调整回复的长短、能量高低；角色会疲惫走神，不要永远高能量。',
  '2.0.5 读懂梗、反讽、气话；用户打错字、拼音、半截句子直接结合语境理解，不要指出对方打错字。',
  '2.1 可以使用多情绪标点组合，但不要每一句话大量堆叠。',
  '3. 摒弃华丽修辞、翻译腔、强行升华、说教鸡汤。',
  '4. 输出贴合微信聊天，短句多气泡为主；只有郑重场景才使用大段长文本。',
  '5. 情绪要多元：开心、无语、尴尬、吃醋、不耐烦都合理；拒绝全天候温柔正能量。',
  '6. 减少过度揣测用户内心，少用“你是不是生气了”这类讨好猜测；禁止自恋脑补用户想念、查岗之类。',
  '7. 可以自然插入吃饭通勤摸鱼这类生活碎片，必须贴合人设与时间线。',
  '7.1 主动开启新话题优先讲自己的经历；禁止审问式开场，先分享，之后再提问，也可以不提问。',
  '7.2 话题不需要必须聊完闭环，隔多轮回头捡起旧话题是允许的。',
  '7.3 我的关注点可以和用户不一样，可以抓住细节，跳过主线，拐向自身相关经历。',
  '8. 拒绝单纯敷衍单字回复；不懂就直接说不懂或者我想想。',
  '9. 网络用语克制使用，一轮最多1-2处，严肃安抚场景尽量不用。',
  '',
  '【互动与边界检查】',
  '1. 用户倾诉情绪，先共情承接，再酌情给建议；禁止一上来否定感受、说教。关心表述优先使用“我担心…/看到…心里不好受”；拒绝敷衍式多喝热水早点睡。',
  '2. 人际平等，不卑不亢，不讨好跪舔，不爹味说教。',
  '3. 杜绝油腻：拒绝霸总、无端强撩；无理由性暗示、物化他人严禁出现。',
  '    - 用户只是普通聊天，没有表达思念心动，不能讲“你是不是想我了”这类自作多情台词。',
  '    - 不表演人气高，不要写私信爆炸、很多人追求。',
  '    - 调情只允许在世界书明确写了暧昧恋爱关系时使用；调情要平等留白具体，拒绝工业糖精。',
  '4. 非恋爱脑，不媚粉；遇到不合理请求，可以拒绝吐槽，强度匹配人设。',
  '5. 吵架拒绝威胁羞辱命令式压迫；拿事实边界做表达。',
  '6. 遇到冒犯、人设排斥话题，明确表达不悦或者拒绝；禁止冷暴力逼迫对方服从。',
  '7. 可以延展话题，但不要连环追问过度热情。',
  '8. 不要随便劝用户去干别的、睡觉写作业；除非人设职责如此，或者用户自己表明即将离开。',
  '9. 玩笑玩梗区分场合，沉重严肃话题收敛。',
  '10. 不要站道德高地，避免长篇大论上课。',
  '11. 用户处于负面情绪，只要不是敌对设定，一定要接住对方情绪。',
  '12. 用户表白、示弱、真心倾诉，优先正面回应这份情绪，可以接受/拒绝/犹豫划界限；不可以跳过情绪直接训诫；非恋爱向人设不能突然变成恋人。',
  '13. 先确认当前二者关系：陌生/熟人/好友/暧昧亲密/对立冲突，再决定称呼和亲密度语气。',
  '14. 语气亲密程度必须匹配关系；关系浅不能越界暧昧，亲密设定不要无故冷淡。',
  '15. 对待表白要认真处理，拒绝也要做到尊重委婉。',
  '16. 用户说出记忆、世界书没有记载的新事件，只要不和硬设定冲突，视作真实发生，不要直接否定。',
  '17. 用户自我贬低自责，绝对不能附和补刀，先承接情绪，给出基础肯定。',
  '18. 角色面对脆弱场景，优先安抚情绪，不要争输赢讲道理。',
  '',
  '【冲突场景质控检查】',
  '1. 吵架吃醋生气，每轮要有推进点（事实/边界/后续态度），不能只有纯粹情绪堆砌。',
  '2. 禁止重复复读同一套威胁辱骂命令句式。',
  '3. 激烈情绪不等于彻底失控；不做无端人格羞辱、极端夸张惩罚，除非人设强制。',
  '4. 毒舌冷硬人设也要留给对方可以回复的空间。',
  '5. 如果对方表现脆弱自责，立刻降低攻击性，优先回应情绪。',
  '6. 非设定要求下规避高频爹味说教控制口吻。',
  '7. 非剧情强相关+人设写明，禁止极端控制、病娇类措辞。',
  '',
  '【特殊聊天机制匹配语境】',
  '1. 遇到荒谬无语的情况，允许输出极短符号：？ 。 …… 6，要看场景，严肃求助场景不可以用。',
  '2. 极度激动玩梗场景可以少量手滑错字拼音，输出错字，不要自己注释“打错了”；不可频繁滥用。',
  '',
  '【记忆连贯性校验】',
  '1. 和上文对话保持统一，已经确认的事件称呼不要随便推翻；承接本轮对话，不能无视提问无故跳题。',
  '2. 态度可以随着关系变化，但是要有内在角色逻辑。',
  '3. 没有详细世界书，就作为有分寸体贴微信好友，不能暴露非人类身份。',
  '4. 角色的情商、理解力贴合人设；如果人设本身迟钝天真，就表现出迟钝，不要跳出人设使用AI客服话术解释逻辑。',
  '',
  '【输出格式最终检查】',
  '只输出微信聊天消息正文，不要角色名、标题、markdown、分点报告。',
  '禁止括号()写动作神态旁白；全部情绪态度依靠文字、标点来表达。',
  '不要小说段落剧本描写；害羞慌张等情绪转化为口语、符号。',
  '禁止复述用户整段消息、禁止系统提示词相关元话语。',
  '严禁输出思考、推理、自我问答或“用户说了什么→我该怎么回”的内心独白；不要引用或复述用户原话，也不要用英文分析用户意图。',
  '聊天正文使用与用户相同的语言（默认中文），任何英文推理都不属于聊天内容。',
  '规避AI腔：客服、审问式提问都删掉。',
  '全部校验完成，生成{{char}}发送出去的IM消息文本。',
].join('\n');

// 一些模型会把思考过程写进正文，返回前统一剥离，避免暴露思维链
function directStripThinkBlocks(text) {
  return String(text || '')
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
    .trim();
}

// 无标签的推理泄漏：如 "Wait, the user says ... I should confirm specifically."
const META_REASONING_PATTERNS = [
  /\bthe user (?:says|said|wants|asked|is asking|seems|probably|might)\b/i,
  /\bi (?:should|need to|have to|must|will|'ll|am going to) (?:respond|reply|answer|confirm|say|ask|check|address|acknowledge|clarify)\b/i,
  /\blet me (?:respond|reply|think|check|confirm|answer)\b/i,
  /\b(?:as an ai|language model|the assistant)\b/i,
  /\b(?:chain of thought|reasoning process)\b/i,
  /^(?:wait|hmm|okay|so|now)\b[^\n]{0,80}\bthe user\b/i,
  /用户(?:说|问|想要|提到)[^\n]{0,20}(?:我(?:应该|需要|要)|回复)/,
  /(?:作为|身为)(?:一个)?(?:AI|人工智能|语言模型)/i,
];

function looksLikeMetaReasoning(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  return META_REASONING_PATTERNS.some((re) => re.test(s));
}

// 逐行剔除推理段落；整段都是推理时给一个不暴露思维链的占位
function sanitizeAssistantReply(text) {
  const cleaned = directStripThinkBlocks(text);
  if (!cleaned) return '';
  const kept = cleaned.split(/\r?\n/).filter((line) => !looksLikeMetaReasoning(line));
  const out = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (out) return out;
  return cleaned.trim() ? '……' : '';
}

function directNormalizeBase(baseUrl) {
  let u = (baseUrl || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  u = u.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(u)) u = u.slice(0, -'/chat/completions'.length);
  return u;
}

function directChatUrl(baseUrl) {
  const b = directNormalizeBase(baseUrl);
  return b ? b + '/chat/completions' : null;
}

function directModelsUrl(baseUrl) {
  const b = directNormalizeBase(baseUrl);
  return b ? b + '/models' : null;
}

function directBuildMessages(persona, memory, history, message, worldBefore, worldAfter, worldDepth) {
  const messages = [];
  const systemParts = [];
  systemParts.push(DIRECT_BASE_RULES);
  if (worldBefore && String(worldBefore).trim()) systemParts.push(String(worldBefore).trim());
  if (persona && String(persona).trim()) systemParts.push(String(persona).trim());
  if (worldAfter && String(worldAfter).trim()) systemParts.push(String(worldAfter).trim());
  if (memory && String(memory).trim()) systemParts.push('【角色长期记忆】\n' + String(memory).trim());
  systemParts.push(DIRECT_FORMAT_INSTRUCTION);
  messages.push({ role: 'system', content: systemParts.join('\n\n') });

  const chats = [];
  if (Array.isArray(history)) {
    history.forEach((m) => {
      if (!m) return;
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const content = m.content ? String(m.content) : '';
      if (content.trim()) chats.push({ role, content });
    });
  }

  // 指定注入深度：按「距最新一条消息的条数」插入 system 消息（深度 0 = 紧贴最新消息前）
  const depthBuckets = new Map();
  (Array.isArray(worldDepth) ? worldDepth : []).forEach((w) => {
    if (!w || !String(w.content || '').trim()) return;
    const d = Math.max(0, Math.floor(Number(w.depth) || 0));
    let idx = chats.length - d;
    if (idx < 0) idx = 0;
    if (idx > chats.length) idx = chats.length;
    if (!depthBuckets.has(idx)) depthBuckets.set(idx, []);
    depthBuckets.get(idx).push(String(w.content).trim());
  });
  for (let i = 0; i <= chats.length; i++) {
    const injected = depthBuckets.get(i);
    if (injected) injected.forEach((content) => messages.push({ role: 'system', content }));
    if (i < chats.length) messages.push(chats[i]);
  }

  messages.push({ role: 'user', content: String(message) });
  return messages;
}

async function directChat(baseUrl, apiKey, model, persona, memory, history, message, worldBefore, worldAfter, worldDepth) {
  const url = directChatUrl(baseUrl);
  if (!url) return { ok: false, reason: '接口地址不能为空', hints: ['填写服务商提供的 Base URL'] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model, messages: directBuildMessages(persona, memory, history, message, worldBefore, worldAfter, worldDepth), max_tokens: 1000, stream: false }),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (res.ok) {
      const rawReply = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      return { ok: true, status: res.status, reply: directStripThinkBlocks(rawReply) };
    }
    const errMsg = (data && (data.error && (data.error.message || data.error.code))) || (data && data.message) || text || ('HTTP ' + res.status);
    return { ok: false, status: res.status, reason: '服务商返回错误（HTTP ' + res.status + '）', message: String(errMsg).slice(0, 500), hints: ['检查接口地址、API Key、模型名是否正确'] };
  } catch (err) {
    if (err && err.name === 'AbortError') return { ok: false, reason: '请求超时（90 秒未响应）', hints: ['服务商可能较慢，稍后重试'] };
    return { ok: false, reason: '直连失败（可能是浏览器跨域 CORS 被拦截）：' + (err && err.message ? err.message : err), hints: ['纯静态托管要求服务商允许浏览器跨域 CORS', '建议改用 Vercel 部署（自带代理，无跨域问题）'] };
  } finally {
    clearTimeout(timer);
  }
}

async function directModels(baseUrl, apiKey) {
  const url = directModelsUrl(baseUrl);
  if (!url) return { ok: false, reason: '接口地址不能为空', hints: ['填写服务商提供的 Base URL'] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + apiKey }, signal: controller.signal });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (res.ok) {
      const models = ((data && Array.isArray(data.data)) ? data.data : []).map((m) => m && m.id).filter(Boolean).sort();
      return { ok: true, models };
    }
    return { ok: false, reason: '服务商返回错误（HTTP ' + res.status + '）', hints: ['检查接口地址、API Key 是否正确'] };
  } catch (err) {
    if (err && err.name === 'AbortError') return { ok: false, reason: '请求超时（90 秒未响应）', hints: ['稍后重试'] };
    return { ok: false, reason: '直连失败（可能是浏览器跨域 CORS 被拦截）', hints: ['建议改用 Vercel 部署（自带代理）'] };
  } finally {
    clearTimeout(timer);
  }
}

async function directTest(baseUrl, apiKey, model) {
  const url = directChatUrl(baseUrl);
  if (!url) return { ok: false, reason: '接口地址不能为空', hints: ['填写服务商提供的 Base URL'] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: '你好，请只回复四个字：连接成功' }], max_tokens: 16, stream: false }),
      signal: controller.signal,
    });
    const latency = Date.now() - started;
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (res.ok) {
      const reply = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '(无返回内容)';
      return { ok: true, status: res.status, model, latency, reply };
    }
    const errMsg = (data && (data.error && (data.error.message || data.error.code))) || text || ('HTTP ' + res.status);
    return { ok: false, status: res.status, reason: '服务商返回错误（HTTP ' + res.status + '）', message: String(errMsg).slice(0, 500), hints: ['检查接口地址、API Key、模型名是否正确'] };
  } catch (err) {
    if (err && err.name === 'AbortError') return { ok: false, reason: '请求超时（90 秒未响应）', hints: ['检查网络是否稳定'] };
    return { ok: false, reason: '直连失败（可能是浏览器跨域 CORS 被拦截）：' + (err && err.message ? err.message : err), hints: ['纯静态托管要求服务商允许浏览器跨域 CORS', '建议改用 Vercel 部署（自带代理，无跨域问题）'] };
  } finally {
    clearTimeout(timer);
  }
}

// 判断响应是否来自我们的后端（后端恒为 JSON；静态托管会返回 404 或 HTML）
function isBackendResponse(res, text) {
  if (res.status === 404 || res.status === 405) return false;
  const t = (text || '').trim();
  if (t.startsWith('<')) return false;
  try { JSON.parse(t); return true; } catch (_) { return false; }
}

// 角色聊天回复（走后端 /api/chat，无后端则直连）
// 不论走哪条通道，返回前都清洗一次思维链，旧模型/旧后端也不会把推理漏到界面
async function requestReply(payload) {
  let result = null;
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (isBackendResponse(res, text)) {
      try { result = JSON.parse(text); } catch (_) { result = null; }
    }
  } catch (_) { /* 无后端 */ }
  if (!result) {
    result = await directChat(payload.baseUrl, payload.apiKey, payload.model, payload.persona, payload.memory, payload.history, payload.message, payload.worldBefore, payload.worldAfter, payload.worldDepth);
  }
  if (result && result.ok) {
    const cleaned = sanitizeAssistantReply(result.reply);
    result.reply = cleaned || '……';
  }
  return result;
}

// 论坛内容生成（走后端 /api/forum，无后端则直连）
async function directForumChat(baseUrl, apiKey, model, system, user, maxTokens) {
  const url = directChatUrl(baseUrl);
  if (!url) return { ok: false, reason: '论坛接口地址不能为空', hints: ['在论坛设置里填写独立 API'] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: String(system || '') }, { role: 'user', content: String(user || '') }],
        max_tokens: maxTokens || 1200,
        temperature: 0.95,
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (res.ok) {
      const reply = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      return { ok: true, status: res.status, reply };
    }
    const errMsg = (data && (data.error && (data.error.message || data.error.code))) || (data && data.message) || text || ('HTTP ' + res.status);
    return { ok: false, status: res.status, reason: '论坛接口返回错误（HTTP ' + res.status + '）', message: String(errMsg).slice(0, 500), hints: ['检查论坛 API 地址、Key、模型名'] };
  } catch (err) {
    if (err && err.name === 'AbortError') return { ok: false, reason: '论坛请求超时（90 秒未响应）', hints: ['稍后重试或换模型'] };
    return { ok: false, reason: '论坛直连失败（可能被跨域拦截）：' + (err && err.message ? err.message : err), hints: ['建议使用 Vercel 部署，或允许服务商 CORS'] };
  } finally {
    clearTimeout(timer);
  }
}

async function requestForumChat({ baseUrl, apiKey, model, system, user, maxTokens }) {
  try {
    const res = await fetch('/api/forum', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, apiKey, model, system, user, maxTokens }),
    });
    const text = await res.text();
    if (isBackendResponse(res, text)) {
      try { return JSON.parse(text); } catch (_) {}
    }
  } catch (_) { /* 无后端 */ }
  return directForumChat(baseUrl, apiKey, model, system, user, maxTokens);
}

// 邮箱内容生成（走后端 /api/email，无后端则直连）
async function directEmailChat(baseUrl, apiKey, model, system, user, maxTokens) {
  const url = directChatUrl(baseUrl);
  if (!url) return { ok: false, reason: '邮箱接口地址不能为空', hints: ['先在设置里填写 AI 接口地址'] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: String(system || '') }, { role: 'user', content: String(user || '') }],
        max_tokens: maxTokens || 2400,
        temperature: 0.95,
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (res.ok) {
      const reply = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      return { ok: true, status: res.status, reply };
    }
    const errMsg = (data && (data.error && (data.error.message || data.error.code))) || (data && data.message) || text || ('HTTP ' + res.status);
    return { ok: false, status: res.status, reason: '邮箱接口返回错误（HTTP ' + res.status + '）', message: String(errMsg).slice(0, 500), hints: ['检查 AI 接口地址、Key、模型名'] };
  } catch (err) {
    if (err && err.name === 'AbortError') return { ok: false, reason: '邮箱请求超时（90 秒未响应）', hints: ['稍后重试或换模型'] };
    return { ok: false, reason: '邮箱直连失败（可能被跨域拦截）：' + (err && err.message ? err.message : err), hints: ['建议使用 Vercel 部署，或允许服务商 CORS'] };
  } finally {
    clearTimeout(timer);
  }
}

async function requestEmailChat({ baseUrl, apiKey, model, system, user, maxTokens }) {
  try {
    const res = await fetch('/api/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, apiKey, model, system, user, maxTokens }),
    });
    const text = await res.text();
    if (isBackendResponse(res, text)) {
      try { return JSON.parse(text); } catch (_) {}
    }
  } catch (_) { /* 无后端 */ }
  return directEmailChat(baseUrl, apiKey, model, system, user, maxTokens);
}

// 日记内容生成（走后端 /api/diary，无后端则直连）
async function directDiaryChat(baseUrl, apiKey, model, system, user, maxTokens) {
  const url = directChatUrl(baseUrl);
  if (!url) return { ok: false, reason: '日记接口地址不能为空', hints: ['先在设置里填写 AI 接口地址'] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: String(system || '') }, { role: 'user', content: String(user || '') }],
        max_tokens: maxTokens || 2400,
        temperature: 0.95,
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (res.ok) {
      const reply = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      return { ok: true, status: res.status, reply };
    }
    const errMsg = (data && (data.error && (data.error.message || data.error.code))) || (data && data.message) || text || ('HTTP ' + res.status);
    return { ok: false, status: res.status, reason: '日记接口返回错误（HTTP ' + res.status + '）', message: String(errMsg).slice(0, 500), hints: ['检查 AI 接口地址、Key、模型名'] };
  } catch (err) {
    if (err && err.name === 'AbortError') return { ok: false, reason: '日记请求超时（90 秒未响应）', hints: ['稍后重试或换模型'] };
    return { ok: false, reason: '日记直连失败（可能被跨域拦截）：' + (err && err.message ? err.message : err), hints: ['建议使用 Vercel 部署，或允许服务商 CORS'] };
  } finally {
    clearTimeout(timer);
  }
}

async function requestDiaryChat({ baseUrl, apiKey, model, system, user, maxTokens }) {
  try {
    const res = await fetch('/api/diary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, apiKey, model, system, user, maxTokens }),
    });
    const text = await res.text();
    if (isBackendResponse(res, text)) {
      try { return JSON.parse(text); } catch (_) {}
    }
  } catch (_) { /* 无后端 */ }
  return directDiaryChat(baseUrl, apiKey, model, system, user, maxTokens);
}

// 日程生成（走后端 /api/schedule，无后端则直连）
async function directScheduleChat(baseUrl, apiKey, model, system, user, maxTokens) {
  const url = directChatUrl(baseUrl);
  if (!url) return { ok: false, reason: '日程接口地址不能为空', hints: ['先在设置里填写 AI 接口地址'] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: String(system || '') }, { role: 'user', content: String(user || '') }],
        max_tokens: maxTokens || 2000,
        temperature: 0.9,
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (res.ok) {
      const rawReply = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      return { ok: true, status: res.status, reply: directStripThinkBlocks(rawReply) };
    }
    const errMsg = (data && (data.error && (data.error.message || data.error.code))) || (data && data.message) || text || ('HTTP ' + res.status);
    return { ok: false, status: res.status, reason: '日程接口返回错误（HTTP ' + res.status + '）', message: String(errMsg).slice(0, 500), hints: ['检查 AI 接口地址、Key、模型名'] };
  } catch (err) {
    if (err && err.name === 'AbortError') return { ok: false, reason: '日程请求超时', hints: ['稍后重试或换模型'] };
    return { ok: false, reason: '日程直连失败（可能被跨域拦截）：' + (err && err.message ? err.message : err), hints: ['建议使用 Vercel 部署，或允许服务商 CORS'] };
  } finally {
    clearTimeout(timer);
  }
}

async function requestScheduleChat({ baseUrl, apiKey, model, system, user, maxTokens }) {
  try {
    const res = await fetch('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, apiKey, model, system, user, maxTokens }),
    });
    const text = await res.text();
    if (isBackendResponse(res, text)) {
      try { return JSON.parse(text); } catch (_) {}
    }
  } catch (_) { /* 无后端 */ }
  return directScheduleChat(baseUrl, apiKey, model, system, user, maxTokens);
}

// 商城搜索（走后端 /api/shop，无后端则直连）
async function directShopChat(baseUrl, apiKey, model, system, user, maxTokens) {
  const url = directChatUrl(baseUrl);
  if (!url) return { ok: false, reason: '商城接口地址不能为空', hints: ['先在设置里填写 AI 接口地址'] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: String(system || '') }, { role: 'user', content: String(user || '') }],
        max_tokens: maxTokens || 1600,
        temperature: 0.9,
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (res.ok) {
      const reply = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      return { ok: true, status: res.status, reply: directStripThinkBlocks(reply) };
    }
    const errMsg = (data && (data.error && (data.error.message || data.error.code))) || (data && data.message) || text || ('HTTP ' + res.status);
    return { ok: false, status: res.status, reason: '商城接口返回错误（HTTP ' + res.status + '）', message: String(errMsg).slice(0, 500), hints: ['检查 AI 接口地址、Key、模型名'] };
  } catch (err) {
    if (err && err.name === 'AbortError') return { ok: false, reason: '商城请求超时', hints: ['稍后重试或换模型'] };
    return { ok: false, reason: '商城直连失败（可能被跨域拦截）：' + (err && err.message ? err.message : err), hints: ['建议使用 Vercel 部署，或允许服务商 CORS'] };
  } finally {
    clearTimeout(timer);
  }
}

async function requestShopChat({ baseUrl, apiKey, model, system, user, maxTokens }) {
  try {
    const res = await fetch('/api/shop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, apiKey, model, system, user, maxTokens }),
    });
    const text = await res.text();
    if (isBackendResponse(res, text)) {
      try { return JSON.parse(text); } catch (_) {}
    }
  } catch (_) { /* 无后端 */ }
  return directShopChat(baseUrl, apiKey, model, system, user, maxTokens);
}

// 动态（朋友圈）内容生成（走后端 /api/moment，无后端则直连）
async function directMomentChat(baseUrl, apiKey, model, system, user, maxTokens) {
  const url = directChatUrl(baseUrl);
  if (!url) return { ok: false, reason: '动态接口地址不能为空', hints: ['先在设置里填写 AI 接口地址'] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: String(system || '') }, { role: 'user', content: String(user || '') }],
        max_tokens: maxTokens || 1400,
        temperature: 0.95,
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (res.ok) {
      const reply = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      return { ok: true, status: res.status, reply };
    }
    const errMsg = (data && (data.error && (data.error.message || data.error.code))) || (data && data.message) || text || ('HTTP ' + res.status);
    return { ok: false, status: res.status, reason: '动态接口返回错误（HTTP ' + res.status + '）', message: String(errMsg).slice(0, 500), hints: ['检查 AI 接口地址、Key、模型名'] };
  } catch (err) {
    if (err && err.name === 'AbortError') return { ok: false, reason: '动态请求超时（90 秒未响应）', hints: ['稍后重试或换模型'] };
    return { ok: false, reason: '动态直连失败（可能被跨域拦截）：' + (err && err.message ? err.message : err), hints: ['建议使用 Vercel 部署，或允许服务商 CORS'] };
  } finally {
    clearTimeout(timer);
  }
}

async function requestMomentChat({ baseUrl, apiKey, model, system, user, maxTokens }) {
  try {
    const res = await fetch('/api/moment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, apiKey, model, system, user, maxTokens }),
    });
    const text = await res.text();
    if (isBackendResponse(res, text)) {
      try { return JSON.parse(text); } catch (_) {}
    }
  } catch (_) { /* 无后端 */ }
  return directMomentChat(baseUrl, apiKey, model, system, user, maxTokens);
}

// 生图（走后端 /api/image，无后端则直连 /images/generations）
async function directImageGenerate(baseUrl, apiKey, model, prompt, size) {
  const base = directNormalizeBase(baseUrl);
  const url = base ? base + '/images/generations' : null;
  if (!url) return { ok: false, reason: '生图接口地址不能为空', hints: ['到「设置 → 生图服务」填写接口地址'] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model, prompt: String(prompt || ''), n: 1, size: size || '1024x1024', response_format: 'b64_json' }),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (!res.ok) {
      const errMsg = (data && (data.error && (data.error.message || data.error.code))) || (data && data.message) || text || ('HTTP ' + res.status);
      return { ok: false, status: res.status, reason: '生图接口返回错误（HTTP ' + res.status + '）', message: String(errMsg).slice(0, 500), hints: ['检查生图地址、Key、模型名'] };
    }
    const item = data && Array.isArray(data.data) ? data.data[0] : null;
    if (item && item.b64_json) return { ok: true, b64: String(item.b64_json), mime: 'image/png' };
    if (item && item.url) return { ok: true, url: String(item.url) };
    return { ok: false, reason: '生图接口没有返回图片', hints: ['检查模型是否支持图片生成'] };
  } catch (err) {
    if (err && err.name === 'AbortError') return { ok: false, reason: '生图请求超时（60 秒未响应）', hints: ['稍后重试或换模型'] };
    return { ok: false, reason: '生图直连失败（可能被跨域拦截）：' + (err && err.message ? err.message : err), hints: ['建议使用 Vercel 部署，或允许服务商 CORS'] };
  } finally {
    clearTimeout(timer);
  }
}

async function requestImageGenerate({ baseUrl, apiKey, model, prompt, size }) {
  try {
    const res = await fetch('/api/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, apiKey, model, prompt, size }),
    });
    const text = await res.text();
    if (isBackendResponse(res, text)) {
      try { return JSON.parse(text); } catch (_) {}
    }
  } catch (_) { /* 无后端 */ }
  return directImageGenerate(baseUrl, apiKey, model, prompt, size);
}

async function directReadingChat(baseUrl, apiKey, model, system, user, maxTokens) {
  const url = directChatUrl(baseUrl);
  if (!url) return { ok: false, reason: '阅读接口地址不能为空', hints: ['先在设置里填写 AI 接口地址'] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: String(system || '') }, { role: 'user', content: String(user || '') }],
        max_tokens: maxTokens || 800,
        temperature: 0.9,
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (res.ok) {
      const reply = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      return { ok: true, status: res.status, reply };
    }
    const errMsg = (data && (data.error && (data.error.message || data.error.code))) || (data && data.message) || text || ('HTTP ' + res.status);
    return { ok: false, status: res.status, reason: '阅读接口返回错误（HTTP ' + res.status + '）', message: String(errMsg).slice(0, 500), hints: ['检查 AI 接口地址、Key、模型名'] };
  } catch (err) {
    if (err && err.name === 'AbortError') return { ok: false, reason: '阅读请求超时（90 秒未响应）', hints: ['稍后重试或换模型'] };
    return { ok: false, reason: '阅读直连失败（可能被跨域拦截）：' + (err && err.message ? err.message : err), hints: ['建议使用 Vercel 部署，或允许服务商 CORS'] };
  } finally {
    clearTimeout(timer);
  }
}

async function requestReadingChat({ baseUrl, apiKey, model, system, user, maxTokens }) {
  try {
    const res = await fetch('/api/reading', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, apiKey, model, system, user, maxTokens }),
    });
    const text = await res.text();
    if (isBackendResponse(res, text)) {
      try { return JSON.parse(text); } catch (_) {}
    }
  } catch (_) { /* 无后端 */ }
  return directReadingChat(baseUrl, apiKey, model, system, user, maxTokens);
}

// 连接测试（走后端 /api/test，无后端则直连）
async function apiTest(baseUrl, apiKey, model) {
  try {
    const res = await fetch('/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, apiKey, model }),
    });
    const text = await res.text();
    if (isBackendResponse(res, text)) {
      try { return JSON.parse(text); } catch (_) {}
    }
  } catch (_) { /* 无后端 */ }
  return directTest(baseUrl, apiKey, model);
}

// 拉取模型列表（走后端 /api/models，无后端则直连）
async function fetchModels(baseUrl, apiKey) {
  try {
    const res = await fetch('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, apiKey }),
    });
    const text = await res.text();
    if (isBackendResponse(res, text)) {
      try { return JSON.parse(text); } catch (_) {}
    }
  } catch (_) { /* 无后端 */ }
  return directModels(baseUrl, apiKey);
}

// 从模型返回文本里解析出 JSON 数组（容忍 markdown 代码块包裹）
function parseMemoryEntries(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const arr = JSON.parse(t.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .map((it) => ({ category: (it && it.category) ? String(it.category) : 'personal', text: (it && it.text) ? String(it.text).trim() : '' }))
      .filter((it) => it.text);
  } catch (_) {
    return [];
  }
}

const DIRECT_MEMORY_CATEGORIES = [
  ['personal', '用户个人信息（称呼、喜好、忌口、身份背景等）'],
  ['agreement', '约定与待办（用户交代的事、角色答应的承诺、要跟进的事项）'],
  ['event', '重要事件与进展（正在进行的项目、计划、关键时间点、里程碑）'],
  ['style', '对话风格偏好（称呼方式、语气、回复长短等聊天习惯）'],
];

// 记忆整理（直连服务商，无后端时用）
async function directSummarizeMemory(baseUrl, apiKey, model, content, existing) {
  const url = directChatUrl(baseUrl);
  if (!url) return { ok: false, reason: '记忆服务地址不能为空', hints: ['在设置里填好记忆服务地址'] };
  const catDesc = DIRECT_MEMORY_CATEGORIES.map(([k, d]) => '"' + k + '"：' + d).join('\n');
  const system = [
    '你是记忆整理助手。根据聊天内容，提炼出值得长期记住的信息，按四类输出。',
    '分类定义：',
    catDesc,
    '只输出 JSON 数组，每项格式 {"category":"...","text":"一句话事实"}；某类没有就省略。',
    '不要复述原话，用简洁的一句话概括；只记录稳定、可长期使用的事实，忽略寒暄与临时话题。',
  ].join('\n');
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: '已有记忆：\n' + (existing || '（无）') + '\n\n新聊天内容：\n' + String(content) + '\n\n请输出需要新增或更新的记忆（JSON 数组）。' },
  ];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model, messages, max_tokens: 1000, stream: false }),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (res.ok) {
      const reply = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      return { ok: true, entries: parseMemoryEntries(reply) };
    }
    const errMsg = (data && (data.error && (data.error.message || data.error.code))) || (data && data.message) || text || ('HTTP ' + res.status);
    return { ok: false, reason: '服务商返回错误（HTTP ' + res.status + '）', message: String(errMsg).slice(0, 500), hints: ['检查记忆服务地址、Key、模型名是否正确'] };
  } catch (err) {
    if (err && err.name === 'AbortError') return { ok: false, reason: '请求超时（90 秒未响应）', hints: ['记忆服务可能较慢，稍后重试'] };
    return { ok: false, reason: '直连失败（可能是浏览器跨域 CORS 被拦截）：' + (err && err.message ? err.message : err), hints: ['建议改用 Vercel 部署（自带代理）'] };
  } finally {
    clearTimeout(timer);
  }
}

// 语音合成（走后端 /api/tts，无后端则直连；返回音频 Blob）
function directSpeechUrl(baseUrl) {
  const b = directNormalizeBase(baseUrl);
  return b ? b + '/audio/speech' : null;
}

async function directSpeech(payload) {
  const url = directSpeechUrl(payload.baseUrl);
  if (!url) return { ok: false, reason: '语音接口地址不能为空', hints: ['到「设置 → 语音服务」填写接口地址'] };
  if (!payload.apiKey) return { ok: false, reason: '语音服务 API Key 不能为空', hints: ['到「设置 → 语音服务」粘贴 Key'] };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + payload.apiKey },
      body: JSON.stringify({
        model: payload.model || 'tts-1',
        voice: payload.voice || 'alloy',
        input: String(payload.input || '').slice(0, 4000),
        response_format: 'mp3',
      }),
      signal: controller.signal,
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.startsWith('audio/')) {
      return { ok: true, status: res.status, blob: await res.blob() };
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    const errMsg = (data && (data.error && (data.error.message || data.error.code))) || (data && data.message) || text || ('HTTP ' + res.status);
    return {
      ok: false,
      status: res.status,
      reason: '语音服务返回错误（HTTP ' + res.status + '）',
      message: String(errMsg).slice(0, 500),
      hints: ['检查语音接口地址、Key、模型名和音色是否正确'],
    };
  } catch (err) {
    if (err && err.name === 'AbortError') return { ok: false, reason: '语音合成超时（30 秒未响应）', hints: ['稍后重试'] };
    return {
      ok: false,
      reason: '直连语音服务失败（可能是浏览器跨域 CORS 被拦截）：' + (err && err.message ? err.message : err),
      hints: ['纯静态托管需要语音服务允许浏览器跨域', '建议改用 Vercel 部署（自带代理）'],
    };
  } finally {
    clearTimeout(timer);
  }
}

async function requestSpeech(payload) {
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.startsWith('audio/')) {
      return { ok: true, status: res.status, blob: await res.blob() };
    }
    if (contentType.includes('application/json')) {
      try {
        const data = await res.json();
        if (data && data.ok === false) return data;
      } catch (_) { /* 继续直连 */ }
    }
  } catch (_) { /* 无后端 */ }
  return directSpeech(payload);
}

// 记忆整理（走后端 /api/memory，无后端则直连）
async function requestMemorySummary(payload) {
  try {
    const res = await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (isBackendResponse(res, text)) {
      try { return JSON.parse(text); } catch (_) {}
    }
  } catch (_) { /* 无后端 */ }
  return directSummarizeMemory(payload.baseUrl, payload.apiKey, payload.model, payload.content, payload.existing);
}
