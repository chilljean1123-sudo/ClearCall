// ===== 模型调用层 =====
// 只负责请求 AI：优先走后端代理（/api/*），检测到无后端（纯静态托管）时直连服务商。
// 不碰 DOM、不读写 localStorage。

const DIRECT_TIMEOUT_MS = 30000;

const DIRECT_FORMAT_INSTRUCTION = [
  '【回复格式要求】',
  '像日常聊天一样自然地回复，语气简短、口语化。',
  '当你需要一次发送多条独立消息时，用 <split> 分隔它们；每条会被显示成一个单独的气泡。',
  '单条消息内部可以使用换行，这些换行会保留在同一个气泡里。',
  '不要把一句连贯的话硬拆成多条，也不要按句号、问号等标点暴力切句。',
  '只输出你要说的话本身，不要输出解释、序号或额外说明。',
].join('\n');

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
      const reply = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      return { ok: true, status: res.status, reply };
    }
    const errMsg = (data && (data.error && (data.error.message || data.error.code))) || (data && data.message) || text || ('HTTP ' + res.status);
    return { ok: false, status: res.status, reason: '服务商返回错误（HTTP ' + res.status + '）', message: String(errMsg).slice(0, 500), hints: ['检查接口地址、API Key、模型名是否正确'] };
  } catch (err) {
    if (err && err.name === 'AbortError') return { ok: false, reason: '请求超时（30 秒未响应）', hints: ['服务商可能较慢，稍后重试'] };
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
    if (err && err.name === 'AbortError') return { ok: false, reason: '请求超时（30 秒未响应）', hints: ['稍后重试'] };
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
    if (err && err.name === 'AbortError') return { ok: false, reason: '请求超时（30 秒未响应）', hints: ['检查网络是否稳定'] };
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
async function requestReply(payload) {
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (isBackendResponse(res, text)) {
      try { return JSON.parse(text); } catch (_) {}
    }
  } catch (_) { /* 无后端 */ }
  return directChat(payload.baseUrl, payload.apiKey, payload.model, payload.persona, payload.memory, payload.history, payload.message, payload.worldBefore, payload.worldAfter, payload.worldDepth);
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
    if (err && err.name === 'AbortError') return { ok: false, reason: '论坛请求超时（30 秒未响应）', hints: ['稍后重试或换模型'] };
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
    if (err && err.name === 'AbortError') return { ok: false, reason: '邮箱请求超时（30 秒未响应）', hints: ['稍后重试或换模型'] };
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
    if (err && err.name === 'AbortError') return { ok: false, reason: '请求超时（30 秒未响应）', hints: ['记忆服务可能较慢，稍后重试'] };
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
