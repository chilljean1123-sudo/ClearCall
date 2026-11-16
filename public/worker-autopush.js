// ClearCall 主动消息 Worker（前端「一键部署」用的就是这份脚本）
// 设计：无状态。前端每次带上自己的配置和上次收到消息的时间，Worker 判断到点就生成一条消息返回。
// 这样即使 Worker 冷启动、内存被清空，也不会丢配置；也不需要绑定 KV / D1。
//
// 接口：
//   GET  /status  健康检查
//   POST /sync    { clientId, intervalMin, lastAt, prompt, config:{baseUrl, apiKey, model, persona, memory} }
//                 → { ok, due, message: { content, at } | null }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: CORS_HEADERS });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    try {
      if (url.pathname === '/status') return json({ ok: true, service: 'clearcall-autopush' });
      if (url.pathname === '/sync' && request.method === 'POST') return await handleSync(request);
      return json({ ok: false, error: 'not found' }, 404);
    } catch (err) {
      return json({ ok: false, error: String((err && err.message) || err) }, 500);
    }
  },
};

async function handleSync(request) {
  const body = await request.json();
  const intervalMin = Math.max(0, parseInt(body.intervalMin || 0, 10) || 0);
  const lastAt = parseInt(body.lastAt || 0, 10) || 0;
  const enabled = body.enabled !== false && intervalMin > 0;

  if (!enabled) return json({ ok: true, enabled: false, due: false, message: null });

  const now = Date.now();
  const intervalMs = intervalMin * 60 * 1000;
  if (lastAt && now - lastAt < intervalMs) {
    return json({ ok: true, enabled: true, due: false, message: null, nextAt: lastAt + intervalMs });
  }

  const cfg = body.config || {};
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    return json({ ok: false, error: '缺少 AI 接口配置（地址 / Key / 模型）' });
  }

  try {
    const content = await generateMessage(cfg, body.prompt || '');
    if (!content) return json({ ok: true, enabled: true, due: true, message: null });
    return json({ ok: true, enabled: true, due: true, message: { content, at: now } });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}

async function generateMessage(cfg, prompt) {
  const persona = String(cfg.persona || '').trim();
  const system = persona
    ? '你正在扮演下面的角色：\n' + persona + '\n\n现在你要主动给用户发一条消息。只输出角色说出的话，不要解释、不要加引号、不要提到“我是AI”。一到两句话。'
    : '你是一个关心用户的聊天对象。现在主动发一条一到两句话的消息，自然、口语化。';

  const messages = [{ role: 'system', content: system }];
  if (cfg.memory) messages.push({ role: 'system', content: '关于用户的长期记忆：\n' + cfg.memory });
  messages.push({
    role: 'user',
    content: prompt ? ('参考方向：' + prompt) : '现在，主动发一条消息给用户。',
  });

  const baseUrl = String(cfg.baseUrl).replace(/\/+$/, '');
  const endpoint = /\/chat\/completions$/.test(baseUrl) ? baseUrl : baseUrl + '/chat/completions';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  let resp;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.apiKey,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: 0.9,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) throw new Error('AI 接口返回 ' + resp.status);
  const data = await resp.json();
  const choice = data && data.choices && data.choices[0];
  const text = choice && choice.message && choice.message.content;
  return String(text || '').trim();
}
