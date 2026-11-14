const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const TEST_TIMEOUT_MS = 30000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

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
        hints: ['稍后重试', '到服务商状态页确认是否在维护或故障'],
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
    return { reason: '域名无法解析（' + code + '）', hints: ['检查接口地址域名拼写是否正确', '确认本机能够访问外网'] };
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
    return { reason: 'SSL 证书校验失败', hints: ['检查本机系统时间是否正确', '确认接口地址是 https 且证书有效'] };
  }
  return { reason: '网络请求失败：' + msg, hints: ['检查接口地址是否可访问', '确认本机能访问外网'] };
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
        reason: '请求超时（30 秒未响应）',
        hints: ['检查网络是否稳定', '确认接口地址可用（可先在浏览器直接打开该地址看是否报错）', '稍后重试'],
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
      return { ok: false, reason: '请求超时（30 秒未响应）', hints: ['检查网络是否稳定', '稍后重试'] };
    }
    return classifyNetwork(err);
  } finally {
    clearTimeout(timer);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // 连接测试接口
  if (req.method === 'POST' && url.pathname === '/api/test') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy(); // 防止超大请求
    });
    req.on('end', async () => {
      let payload = {};
      try {
        payload = JSON.parse(body || '{}');
      } catch (_) {
        payload = {};
      }
      const result = await testConnection({
        baseUrl: payload.baseUrl,
        apiKey: payload.apiKey,
        model: payload.model,
      });
      // 只记录结果状态，绝不记录 API Key
      console.log('[api/test]', result.ok ? 'success' : 'failed', result.status || '', result.reason || '');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  // 获取模型列表接口
  if (req.method === 'POST' && url.pathname === '/api/models') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', async () => {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch (_) { payload = {}; }
      const result = await fetchModels({ baseUrl: payload.baseUrl, apiKey: payload.apiKey });
      console.log('[api/models]', result.ok ? 'success (' + (result.models ? result.models.length : 0) + ' 个模型)' : 'failed', result.reason || '');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  // 静态文件
  let pathname = url.pathname;
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log('虚拟手机已启动：http://localhost:' + PORT);
  console.log('浏览器打开上面的地址即可使用。');
});
