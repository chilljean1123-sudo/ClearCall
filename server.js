const http = require('http');
const fs = require('fs');
const path = require('path');
const ai = require('./lib/ai');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // 连接测试接口
  if (req.method === 'POST' && url.pathname === '/api/test') {
    const payload = await ai.readJsonBody(req, 1e6);
    const result = await ai.testConnection({ baseUrl: payload.baseUrl, apiKey: payload.apiKey, model: payload.model });
    // 只记录结果状态，绝不记录 API Key
    console.log('[api/test]', result.ok ? 'success' : 'failed', result.status || '', result.reason || '');
    ai.sendJson(res, result);
    return;
  }

  // 获取模型列表接口
  if (req.method === 'POST' && url.pathname === '/api/models') {
    const payload = await ai.readJsonBody(req, 1e6);
    const result = await ai.fetchModels({ baseUrl: payload.baseUrl, apiKey: payload.apiKey });
    console.log('[api/models]', result.ok ? 'success (' + (result.models ? result.models.length : 0) + ' 个模型)' : 'failed', result.reason || '');
    ai.sendJson(res, result);
    return;
  }

  // 角色聊天接口
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const payload = await ai.readJsonBody(req, 5e6);
    const result = await ai.chatReply({
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      model: payload.model,
      persona: payload.persona,
      memory: payload.memory,
      history: payload.history,
      message: payload.message,
      worldBefore: payload.worldBefore,
      worldAfter: payload.worldAfter,
      worldDepth: payload.worldDepth,
    });
    console.log('[api/chat]', result.ok ? 'success' : 'failed', result.reason || '');
    ai.sendJson(res, result);
    return;
  }

  // 论坛内容生成接口（独立 API，输出帖子 / 评论 JSON）
  if (req.method === 'POST' && url.pathname === '/api/forum') {
    const payload = await ai.readJsonBody(req, 5e6);
    const result = await ai.forumChat({
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      model: payload.model,
      system: payload.system,
      user: payload.user,
      maxTokens: payload.maxTokens,
    });
    console.log('[api/forum]', result.ok ? 'success' : 'failed', result.reason || '');
    ai.sendJson(res, result);
    return;
  }

  // 邮箱内容生成接口（角色来信，输出主题 / 正文 JSON）
  if (req.method === 'POST' && url.pathname === '/api/email') {
    const payload = await ai.readJsonBody(req, 5e6);
    const result = await ai.emailChat({
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      model: payload.model,
      system: payload.system,
      user: payload.user,
      maxTokens: payload.maxTokens,
    });
    console.log('[api/email]', result.ok ? 'success' : 'failed', result.reason || '');
    ai.sendJson(res, result);
    return;
  }

  // 日记内容生成接口（角色日记，输出标题 / 正文 / 明日计划 JSON）
  if (req.method === 'POST' && url.pathname === '/api/diary') {
    const payload = await ai.readJsonBody(req, 5e6);
    const result = await ai.diaryChat({
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      model: payload.model,
      system: payload.system,
      user: payload.user,
      maxTokens: payload.maxTokens,
    });
    console.log('[api/diary]', result.ok ? 'success' : 'failed', result.reason || '');
    ai.sendJson(res, result);
    return;
  }

  // 日程生成接口（角色日程，输出 JSON）
  if (req.method === 'POST' && url.pathname === '/api/schedule') {
    const payload = await ai.readJsonBody(req, 5e6);
    const result = await ai.scheduleChat({
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      model: payload.model,
      system: payload.system,
      user: payload.user,
      maxTokens: payload.maxTokens,
    });
    console.log('[api/schedule]', result.ok ? 'success' : 'failed', result.reason || '');
    ai.sendJson(res, result);
    return;
  }

  // 动态（朋友圈）内容生成接口
  if (req.method === 'POST' && url.pathname === '/api/moment') {
    const payload = await ai.readJsonBody(req, 5e6);
    const result = await ai.momentChat({
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      model: payload.model,
      system: payload.system,
      user: payload.user,
      maxTokens: payload.maxTokens,
    });
    console.log('[api/moment]', result.ok ? 'success' : 'failed', result.reason || '');
    ai.sendJson(res, result);
    return;
  }

  // 生图接口：统一返回 base64，前端转 Blob 存档
  if (req.method === 'POST' && url.pathname === '/api/image') {
    const payload = await ai.readJsonBody(req, 5e6);
    const result = await ai.generateImage({
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      model: payload.model,
      prompt: payload.prompt,
      size: payload.size,
      negativePrompt: payload.negativePrompt,
    });
    console.log('[api/image]', result.ok ? 'success' : 'failed', result.reason || '');
    ai.sendJson(res, result);
    return;
  }

  // 阅读讨论接口（角色陪读 + 批注动作尾注）
  if (req.method === 'POST' && url.pathname === '/api/reading') {
    const payload = await ai.readJsonBody(req, 5e6);
    const result = await ai.readingChat({
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      model: payload.model,
      system: payload.system,
      user: payload.user,
      maxTokens: payload.maxTokens,
    });
    console.log('[api/reading]', result.ok ? 'success' : 'failed', result.reason || '');
    ai.sendJson(res, result);
    return;
  }

  // 捏捏接口（补全角色人设 / 生成世界书）
  if (req.method === 'POST' && url.pathname === '/api/pinie') {
    const payload = await ai.readJsonBody(req, 5e6);
    const result = await ai.pinieChat({
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      model: payload.model,
      system: payload.system,
      user: payload.user,
      maxTokens: payload.maxTokens,
    });
    console.log('[api/pinie]', result.ok ? 'success' : 'failed', result.reason || '');
    ai.sendJson(res, result);
    return;
  }

  // 记忆整理接口
  if (req.method === 'POST' && url.pathname === '/api/memory') {
    const payload = await ai.readJsonBody(req, 5e6);
    if (payload.task === 'digest') {
      const digest = await ai.memoryDigest({
        baseUrl: payload.baseUrl,
        apiKey: payload.apiKey,
        model: payload.model,
        system: payload.system,
        user: payload.user,
        maxTokens: payload.maxTokens,
      });
      console.log('[api/memory]', 'digest', digest.ok ? 'success' : 'failed', digest.reason || '');
      ai.sendJson(res, digest);
      return;
    }
    const result = await ai.summarizeMemory({
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      model: payload.model,
      content: payload.content,
      existing: payload.existing,
    });
    console.log('[api/memory]', result.ok ? 'success (' + (result.entries ? result.entries.length : 0) + ' 条)' : 'failed', result.reason || '');
    ai.sendJson(res, result);
    return;
  }

  // 向量记忆接口（Embedding）
  if (req.method === 'POST' && url.pathname === '/api/embedding') {
    const payload = await ai.readJsonBody(req, 5e6);
    const result = await ai.embedding({
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      model: payload.model,
      inputs: payload.inputs,
    });
    console.log('[api/embedding]', result.ok ? 'success (' + ((result.vectors || []).length) + ' 条)' : 'failed', result.reason || '');
    ai.sendJson(res, result);
    return;
  }

  // 语音合成接口（返回音频流，不返回 JSON）
  if (req.method === 'POST' && url.pathname === '/api/tts') {
    const payload = await ai.readJsonBody(req, 1e6);
    const result = await ai.speech({
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      model: payload.model,
      voice: payload.voice,
      input: payload.input,
    });
    if (!result.ok) {
      console.log('[api/tts]', 'failed', result.status || '', result.reason || '');
      ai.sendJson(res, result);
      return;
    }
    console.log('[api/tts]', 'success', result.buffer.length + ' bytes');
    res.writeHead(200, {
      'Content-Type': result.contentType,
      'Content-Length': result.buffer.length,
      'Cache-Control': 'no-store',
    });
    res.end(result.buffer);
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
