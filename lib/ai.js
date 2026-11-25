// 共享的 AI 代理逻辑：本地 Node 服务与 Vercel Serverless 函数共用
// 注意：本文件只包含通用逻辑，绝不含任何 API Key。

const TEST_TIMEOUT_MS = 15000;

// 把用户填的“接口地址”规范成基础地址（去掉结尾斜杠和 /chat/completions）
function normalizeBase(baseUrl) {
  let u = (baseUrl || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  u = u.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(u)) u = u.slice(0, -'/chat/completions'.length);
  return u;
}

// 聊天补全接口完整路径
function chatEndpoint(baseUrl) {
  const base = normalizeBase(baseUrl);
  return base ? base + '/chat/completions' : null;
}

// 模型列表接口完整路径
function modelsEndpoint(baseUrl) {
  const base = normalizeBase(baseUrl);
  return base ? base + '/models' : null;
}

// 根据 HTTP 状态码给出“原因 + 下一步检查”
function classifyStatus(status) {
  switch (status) {
    case 401:
    case 403:
      return {
        reason: '鉴权失败（HTTP ' + status + '）',
        hints: [
          '检查 API Key 是否复制完整，前后不要有多余空格',
          '确认这个 Key 属于你填写的接口地址对应的服务商',
          '到服务商控制台确认 Key 已启用、未过期、未删除',
        ],
      };
    case 404:
      return {
        reason: '接口路径不存在（HTTP 404）',
        hints: [
          '接口地址可能少了 /v1（OpenAI、硅基流动等需要，例如 https://api.openai.com/v1）',
          '或地址多了多余路径，只保留到域名或 /v1 即可',
          '对照服务商文档里的 Base URL 原文检查一遍',
        ],
      };
    case 429:
      return {
        reason: '请求被限流或额度不足（HTTP 429）',
        hints: [
          '稍等几秒再点一次',
          '到服务商控制台查看余额 / 额度是否用完',
          '确认套餐是否已过期',
        ],
      };
    case 400:
      return {
        reason: '请求参数错误（HTTP 400）',
        hints: [
          '通常是最可能“模型名”填错了',
          '到服务商文档确认可用的模型名（如 deepseek-chat、gpt-4o-mini）',
        ],
      };
    case 500:
    case 502:
    case 503:
      return {
        reason: '服务商服务端异常（HTTP ' + status + '）',
        hints: [
          '通常是服务商服务过载、繁忙或正在维护（503 表示繁忙/过载）',
          '稍等几十秒再重试',
          '换一个模型名试试（有些模型可能临时不可用）',
          '到服务商状态页确认是否在维护或故障',
        ],
      };
    default:
      return {
        reason: '请求失败（HTTP ' + status + '）',
        hints: ['查看下方“服务商返回”的原始错误信息', '确认接口地址与服务商文档一致'],
      };
  }
}

// 网络层错误（域名解析、拒绝连接、超时、证书等）
function classifyNetwork(err) {
  const code = err && (err.code || (err.cause && err.cause.code)) || '';
  const msg = (err && err.message) || String(err);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { reason: '域名无法解析（' + code + '）', hints: ['检查接口地址域名拼写是否正确', '确认网络可访问外网'] };
  }
  if (code === 'ECONNREFUSED') {
    return { reason: '连接被拒绝（' + code + '）', hints: ['检查地址里是否多写了端口号', '确认服务商地址正确'] };
  }
  if (code === 'ECONNRESET' || code === 'EPIPE') {
    return { reason: '连接被中断（' + code + '）', hints: ['可能是网络不稳定或代理问题，稍后重试'] };
  }
  if (code === 'ETIMEDOUT') {
    return { reason: '连接超时（' + code + '）', hints: ['检查网络是否稳定', '稍后重试'] };
  }
  if (/CERT|TLS|SSL/i.test(code) || /certificate/i.test(msg)) {
    return { reason: 'SSL 证书校验失败', hints: ['检查系统时间是否正确', '确认接口地址是 https 且证书有效'] };
  }
  return { reason: '网络请求失败：' + msg, hints: ['检查接口地址是否可访问', '确认网络可访问外网'] };
}

async function testConnection({ baseUrl, apiKey, model }) {
  const endpoint = chatEndpoint(baseUrl);
  if (!endpoint) {
    return { ok: false, reason: '接口地址不能为空', hints: ['填写服务商提供的 Base URL，例如 https://api.deepseek.com 或 https://api.openai.com/v1'] };
  }
  if (!apiKey) {
    return { ok: false, reason: 'API Key 不能为空', hints: ['在设置页粘贴你的 API Key'] };
  }
  if (!model) {
    return { ok: false, reason: '模型名不能为空', hints: ['填写模型名，例如 deepseek-chat、gpt-4o-mini'] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  const started = Date.now();

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: '你好，请只回复四个字：连接成功' }],
        max_tokens: 16,
        stream: false,
      }),
      signal: controller.signal,
    });

    const latency = Date.now() - started;
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = null;
    }

    if (res.ok) {
      const reply = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '(无返回内容)';
      return { ok: true, status: res.status, model, latency, reply };
    }

    const errMsg = (data && (data.error && (data.error.message || data.error.code))) || (data && data.message) || text || ('HTTP ' + res.status);
    const c = classifyStatus(res.status);
    return { ok: false, status: res.status, reason: c.reason, message: String(errMsg).slice(0, 500), hints: c.hints };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return {
        ok: false,
        reason: '请求超时（15 秒未响应）',
        hints: ['检查网络是否稳定', '确认接口地址可用', '稍后重试'],
      };
    }
    return classifyNetwork(err);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchModels({ baseUrl, apiKey }) {
  const url = modelsEndpoint(baseUrl);
  if (!url) {
    return { ok: false, reason: '接口地址不能为空', hints: ['填写服务商提供的 Base URL，例如 https://api.deepseek.com 或 https://api.openai.com/v1'] };
  }
  if (!apiKey) {
    return { ok: false, reason: 'API Key 不能为空', hints: ['在设置页粘贴你的 API Key'] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + apiKey },
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }

    if (res.ok) {
      const models = ((data && Array.isArray(data.data)) ? data.data : [])
        .map((m) => (m && m.id) || null)
        .filter(Boolean)
        .sort();
      return { ok: true, models };
    }

    const errMsg = (data && (data.error && (data.error.message || data.error.code))) || (data && data.message) || text || ('HTTP ' + res.status);
    const c = classifyStatus(res.status);
    return { ok: false, reason: c.reason, message: String(errMsg).slice(0, 500), hints: c.hints };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return { ok: false, reason: '请求超时（15 秒未响应）', hints: ['检查网络是否稳定', '稍后重试'] };
    }
    return classifyNetwork(err);
  } finally {
    clearTimeout(timer);
  }
}

const CHAT_FORMAT_INSTRUCTION = [
  '【回复格式要求】',
  '像日常聊天一样自然地回复，语气简短、口语化。',
  '当你需要一次发送多条独立消息时，用 <split> 分隔它们；每条会被显示成一个单独的气泡。',
  '单条消息内部可以使用换行，这些换行会保留在同一个气泡里。',
  '不要把一句连贯的话硬拆成多条，也不要按句号、问号等标点暴力切句。',
  '只输出你要说的话本身，不要输出解释、序号或额外说明。',
].join('\n');

async function chatReply({ baseUrl, apiKey, model, persona, memory, history, message }) {
  const endpoint = chatEndpoint(baseUrl);
  if (!endpoint) {
    return { ok: false, reason: '接口地址不能为空', hints: ['填写服务商提供的 Base URL，例如 https://api.deepseek.com 或 https://api.openai.com/v1'] };
  }
  if (!apiKey) {
    return { ok: false, reason: 'API Key 不能为空', hints: ['在设置页粘贴你的 API Key'] };
  }
  if (!model) {
    return { ok: false, reason: '模型名不能为空', hints: ['在设置页选择或填写模型名'] };
  }
  if (!message || !String(message).trim()) {
    return { ok: false, reason: '消息不能为空', hints: ['输入你想说的话'] };
  }

  const messages = [];
  const systemParts = [];
  if (persona && String(persona).trim()) systemParts.push(String(persona).trim());
  if (memory && String(memory).trim()) systemParts.push('【角色长期记忆】\n' + String(memory).trim());
  systemParts.push(CHAT_FORMAT_INSTRUCTION);
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  const started = Date.now();

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model, messages, max_tokens: 1000, stream: false }),
      signal: controller.signal,
    });
    const latency = Date.now() - started;
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }

    if (res.ok) {
      const reply = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      if (!String(reply).trim()) {
        return { ok: false, reason: '模型返回了空内容', hints: ['换个模型或稍后重试'] };
      }
      return { ok: true, status: res.status, latency, reply: String(reply) };
    }

    const errMsg = (data && (data.error && (data.error.message || data.error.code))) || (data && data.message) || text || ('HTTP ' + res.status);
    const c = classifyStatus(res.status);
    return { ok: false, status: res.status, reason: c.reason, message: String(errMsg).slice(0, 500), hints: c.hints };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return { ok: false, reason: '请求超时（15 秒未响应）', hints: ['服务商可能较慢或繁忙', '稍后重试'] };
    }
    return classifyNetwork(err);
  } finally {
    clearTimeout(timer);
  }
}

const MEMORY_CATEGORIES = [
  ['personal', '用户个人信息（称呼、喜好、忌口、身份背景等）'],
  ['agreement', '约定与待办（用户交代的事、角色答应的承诺、要跟进的事项）'],
  ['event', '重要事件与进展（正在进行的项目、计划、关键时间点、里程碑）'],
  ['style', '对话风格偏好（称呼方式、语气、回复长短等聊天习惯）'],
];

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
      .map((it) => ({
        category: (it && it.category) ? String(it.category) : 'personal',
        text: (it && it.text) ? String(it.text).trim() : '',
      }))
      .filter((it) => it.text);
  } catch (_) {
    return [];
  }
}

// 调用记忆服务，把聊天内容提炼成记忆条目
async function summarizeMemory({ baseUrl, apiKey, model, content, existing }) {
  const endpoint = chatEndpoint(baseUrl);
  if (!endpoint) {
    return { ok: false, reason: '记忆服务地址不能为空', hints: ['在设置里填好记忆服务地址'] };
  }
  if (!apiKey) {
    return { ok: false, reason: '记忆服务 Key 不能为空', hints: ['在设置里填好记忆服务 Key'] };
  }
  if (!model) {
    return { ok: false, reason: '记忆服务模型不能为空', hints: ['在设置里填好记忆服务模型'] };
  }
  if (!content || !String(content).trim()) {
    return { ok: false, reason: '没有需要整理的内容', hints: ['先和角色聊几句，再点「整理记忆」'] };
  }

  const catDesc = MEMORY_CATEGORIES.map(([k, d]) => '"' + k + '"：' + d).join('\n');
  const system = [
    '你是记忆整理助手。根据聊天内容，提炼出值得长期记住的信息，按四类输出。',
    '分类定义：',
    catDesc,
    '只输出 JSON 数组，每项格式 {"category":"...","text":"一句话事实"}；某类没有就省略。',
    '不要复述原话，用简洁的一句话概括；只记录稳定、可长期使用的事实，忽略寒暄与临时话题。',
  ].join('\n');

  const messages = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: '已有记忆：\n' + (existing || '（无）') + '\n\n新聊天内容：\n' + String(content) + '\n\n请输出需要新增或更新的记忆（JSON 数组）。',
    },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model, messages, max_tokens: 1000, stream: false }),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }

    if (res.ok) {
      const reply = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      const entries = parseMemoryEntries(reply);
      return { ok: true, entries };
    }

    const errMsg = (data && (data.error && (data.error.message || data.error.code))) || (data && data.message) || text || ('HTTP ' + res.status);
    const c = classifyStatus(res.status);
    return { ok: false, reason: c.reason, message: String(errMsg).slice(0, 500), hints: c.hints };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return { ok: false, reason: '请求超时（15 秒未响应）', hints: ['记忆服务可能较慢或繁忙', '稍后重试'] };
    }
    return classifyNetwork(err);
  } finally {
    clearTimeout(timer);
  }
}

// 从模型返回文本里解析出台词数组（容忍 markdown 代码块与编号）
function parseStandbyLines(text, count) {
  const t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  let arr = [];
  if (start !== -1 && end > start) {
    try { arr = JSON.parse(t.slice(start, end + 1)); } catch (_) { arr = []; }
  }
  if (!Array.isArray(arr) || !arr.length) arr = t.split('\n');
  return arr
    .map((it) => (typeof it === 'string' ? it : (it && typeof it.text === 'string' ? it.text : '')))
    .map((s) => String(s).replace(/^\s*(?:\d+[.、)]|[-*])\s*/, '').replace(/^["“”']+|["“”']+$/g, '').trim())
    .filter(Boolean)
    .slice(0, count || 5);
}

// 生成待机台词：按角色人设产出若干句短句
async function standbyLines({ baseUrl, apiKey, model, persona, count, avoid }) {
  const endpoint = chatEndpoint(baseUrl);
  if (!endpoint) {
    return { ok: false, reason: '接口地址不能为空', hints: ['填写服务商提供的 Base URL'] };
  }
  if (!apiKey) {
    return { ok: false, reason: 'API Key 不能为空', hints: ['在设置页粘贴你的 API Key'] };
  }
  if (!model) {
    return { ok: false, reason: '模型名不能为空', hints: ['在设置页选择或填写模型名'] };
  }

  const n = Math.min(Math.max(parseInt(count, 10) || 5, 1), 5);
  const system = [
    persona && String(persona).trim() ? String(persona).trim() : '你是一个温柔、有陪伴感的角色。',
    '请生成待机台词：角色安静待在用户身边时，随口说出的短句。',
    '要求：每句 6~20 个字，口语化、自然、有画面感；不要编号、引号、解释或动作描写。',
    '只输出 JSON 字符串数组，例如 ["今天过得怎么样？","我一直都在。"]',
  ].join('\n\n');
  const avoidList = Array.isArray(avoid) ? avoid.filter(Boolean).slice(0, 10) : [];
  const user = '现在生成 ' + n + ' 句互不重复的待机台词。'
    + (avoidList.length ? '\n不要与这些重复：' + avoidList.join(' / ') : '');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: 400,
        temperature: 0.9,
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }

    if (res.ok) {
      const reply = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      const lines = parseStandbyLines(reply, n);
      if (!lines.length) return { ok: false, reason: '模型没有返回可用台词', hints: ['换一个模型试试', '稍后重试'] };
      return { ok: true, status: res.status, lines };
    }

    const errMsg = (data && (data.error && (data.error.message || data.error.code))) || (data && data.message) || text || ('HTTP ' + res.status);
    const c = classifyStatus(res.status);
    return { ok: false, status: res.status, reason: c.reason, message: String(errMsg).slice(0, 500), hints: c.hints };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return { ok: false, reason: '请求超时（15 秒未响应）', hints: ['服务商可能较慢或繁忙', '稍后重试'] };
    }
    return classifyNetwork(err);
  } finally {
    clearTimeout(timer);
  }
}

// 读取 JSON 请求体（带大小上限保护）
function readJsonBody(req, maxBytes) {
  return new Promise((resolve) => {
    let body = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBytes) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) return resolve({});
      try { resolve(JSON.parse(body || '{}')); } catch (_) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// 输出 JSON 响应
function sendJson(res, data) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

module.exports = {
  TEST_TIMEOUT_MS,
  normalizeBase,
  chatEndpoint,
  modelsEndpoint,
  classifyStatus,
  classifyNetwork,
  testConnection,
  fetchModels,
  chatReply,
  summarizeMemory,
  standbyLines,
  parseStandbyLines,
  CHAT_FORMAT_INSTRUCTION,
  readJsonBody,
  sendJson,
};
