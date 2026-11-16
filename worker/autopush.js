// ClearCall 主动消息 Worker
// 部署方式：
//   1. 到 https://dash.cloudflare.com → Workers & Pages → Create → Create Worker
//   2. 把这个文件内容粘贴进去，保存
//   3. 或者用 wrangler：wrangler init clearcall-autopush 然后替换 src/index.js 内容再 wrangler deploy
//
// 使用：前端 POST 配置后，Worker 会按间隔生成主动消息缓存；前端 GET /pull 拉取并显示。

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// 简单的内存存储（Worker 冷启动会清空，但足够用）
// 如果要持久化，可以换成 Cloudflare KV（需要绑定变量）
const store = new Map();

// --- 路由 ---
export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/config' && request.method === 'POST') {
        return await handleConfig(request);
      }
      if (path === '/pull' && request.method === 'GET') {
        return await handlePull(request);
      }
      if (path === '/generate' && request.method === 'POST') {
        return await handleGenerate(request);
      }
      if (path === '/status' && request.method === 'GET') {
        return new Response(JSON.stringify({ ok: true, message: 'ClearCall Autopush Worker running' }), { headers: CORS_HEADERS });
      }

      return new Response(JSON.stringify({ ok: false, error: 'not found' }), { status: 404, headers: CORS_HEADERS });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }), { status: 500, headers: CORS_HEADERS });
    }
  },

  // Cron 定时触发：默认每分钟检查一次，是否该生成新消息
  async scheduled(controller, env, ctx) {
    // 遍历所有已配置的用户，检查是否到了生成时间
    for (const [key, cfg] of store) {
      if (!cfg || !cfg.intervalMin || !cfg.nextAt) continue;
      if (Date.now() >= cfg.nextAt) {
        try {
          await generateFor(key, cfg);
        } catch (_) { /* 静默失败 */ }
      }
    }
  },
};

// --- 接口处理 ---

// POST /config  前端保存 AI 配置和主动消息设置
async function handleConfig(request) {
  const body = await request.json();
  const clientId = String(body.clientId || 'default');
  const intervalMin = parseInt(body.intervalMin, 10) || 0;

  const cfg = {
    clientId,
    baseUrl: body.baseUrl || '',
    apiKey: body.apiKey || '',
    model: body.model || '',
    persona: body.persona || '',
    memory: body.memory || '',
    intervalMin,
    prompt: body.prompt || '',
    enabled: body.enabled !== false && intervalMin > 0,
    messages: [],          // 待发送消息队列
    lastPullAt: 0,
    nextAt: intervalMin > 0 ? Date.now() + intervalMin * 60 * 1000 : 0,
  };

  store.set(clientId, cfg);

  return new Response(JSON.stringify({
    ok: true,
    clientId,
    enabled: cfg.enabled,
    nextAt: cfg.nextAt,
  }), { headers: CORS_HEADERS });
}

// GET /pull?clientId=xxx  前端拉取缓存的主动消息
async function handlePull(request) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('clientId') || 'default';
  const cfg = store.get(clientId);

  if (!cfg) {
    return new Response(JSON.stringify({ ok: true, messages: [] }), { headers: CORS_HEADERS });
  }

  const msgs = cfg.messages || [];
  cfg.messages = []; // 拉取后清空
  cfg.lastPullAt = Date.now();

  // 如果还有未到时间的，也立即生成一条供这次使用
  if (cfg.enabled && cfg.intervalMin > 0 && msgs.length === 0) {
    try {
      await generateFor(clientId, cfg);
      const fresh = cfg.messages.shift();
      if (fresh) msgs.push(fresh);
    } catch (_) { /* 忽略 */ }
  }

  return new Response(JSON.stringify({ ok: true, messages: msgs }), { headers: CORS_HEADERS });
}

// POST /generate  手动触发一次生成（或定时 cron 调到这里）
async function handleGenerate(request) {
  let clientId = 'default';
  try {
    const body = await request.json();
    clientId = String(body.clientId || clientId);
  } catch (_) {}

  const cfg = store.get(clientId);
  if (!cfg) {
    return new Response(JSON.stringify({ ok: false, error: 'not configured' }), { status: 400, headers: CORS_HEADERS });
  }

  await generateFor(clientId, cfg);
  return new Response(JSON.stringify({ ok: true }), { headers: CORS_HEADERS });
}

// --- 核心：调用 AI 接口生成主动消息 ---
async function generateFor(clientId, cfg) {
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    cfg.nextAt = Date.now() + 60 * 1000; // 没配好，1 分钟后再试
    return;
  }

  const sysPrompt = cfg.persona
    ? `你正在扮演以下角色：\n${cfg.persona}\n\n请根据角色人设，自然地发一句想对用户说的话。不要说"我是XX"，直接以角色的身份说话。`
    : '请发一句自然的问候。';

  const userPrompt = cfg.prompt
    ? cfg.prompt
    : '现在你想对我说什么？用一句话回复。';

  const messages = [
    { role: 'system', content: sysPrompt },
  ];
  if (cfg.memory) {
    messages.push({ role: 'system', content: `用户记忆：\n${cfg.memory}` });
  }
  messages.push({ role: 'user', content: userPrompt });

  const baseUrl = cfg.baseUrl.replace(/\/+$/, '');
  const resp = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + cfg.apiKey,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: 0.9,
      max_tokens: 200,
    }),
  });

  if (!resp.ok) {
    cfg.nextAt = Date.now() + 5 * 60 * 1000; // 失败 5 分钟后重试
    return;
  }

  const data = await resp.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (content) {
    if (!cfg.messages) cfg.messages = [];
    cfg.messages.push({
      content: String(content).trim(),
      generatedAt: Date.now(),
    });
    // 最多缓存 5 条
    if (cfg.messages.length > 5) cfg.messages = cfg.messages.slice(-5);
  }

  // 下次生成时间
  cfg.nextAt = Date.now() + cfg.intervalMin * 60 * 1000;
}
