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

function directBuildMessages(persona, history, message) {
  const messages = [];
  const systemParts = [];
  if (persona && String(persona).trim()) systemParts.push(String(persona).trim());
  systemParts.push(DIRECT_FORMAT_INSTRUCTION);
  messages.push({ role: 'system', content: systemParts.join('\n\n') });
  if (Array.isArray(history)) {
    history.forEach((m) => {
      if (!m) return;
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const content = m.content ? String(m.content) : '';
      if (content.trim()) messages.push({ role, content });
    });
  }
  messages.push({ role: 'user', content: String(message) });
  return messages;
}

async function directChat(baseUrl, apiKey, model, persona, history, message) {
  const url = directChatUrl(baseUrl);
  if (!url) return { ok: false, reason: '接口地址不能为空', hints: ['填写服务商提供的 Base URL'] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model, messages: directBuildMessages(persona, history, message), max_tokens: 1000, stream: false }),
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
  return directChat(payload.baseUrl, payload.apiKey, payload.model, payload.persona, payload.history, payload.message);
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
