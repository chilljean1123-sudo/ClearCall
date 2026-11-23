// ===== 编排层 / 入口 =====
// 串联 store.js（存取数据）、api.js（调用模型）、ui.js（界面渲染）。
// 负责聊天状态机、回复触发模式、备份导入导出、以及所有事件绑定。

let chatSending = false;
let countdownTick = null;
let countdownSecRemain = 0;
let editingMemoryId = null;
let autopushInterval = null; // 主动消息的定时间隔
let plusMenuOpen = false;

const CLIENT_ID = 'clearcall-' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'default');

// 最近聊天直接带上；更早的内容交给记忆总结
const RECENT_HISTORY_LIMIT = 20;
const AUTO_SUMMARIZE_MIN_NEW = 20;

// ---- 设置页：读取 / 保存配置 ----
function loadSaved() {
  const s = getSettings();
  $('input-baseurl').value = s.baseUrl;
  $('input-apikey').value = s.apiKey;
  $('input-model').value = s.model;
  ensureSelectOption(s.model);
  setModelMode(s.modelMode);
  const m = getMemorySettings();
  $('input-memory-baseurl').value = m.baseUrl;
  $('input-memory-apikey').value = m.apiKey;
  $('input-memory-model').value = m.model;
  const cf = getCfSettings();
  $('input-cf-token').value = cf.token;
  $('input-cf-account').value = cf.accountId;
  $('input-cf-worker-url').value = cf.workerUrl;
}

function save() {
  setSettings({
    baseUrl: $('input-baseurl').value.trim(),
    apiKey: $('input-apikey').value.trim(),
    model: getCurrentModel(),
    modelMode: getModelMode(),
  });
  setMemorySettings({
    baseUrl: $('input-memory-baseurl').value.trim(),
    apiKey: $('input-memory-apikey').value.trim(),
    model: $('input-memory-model').value.trim(),
  });
  setCfSettings({
    token: $('input-cf-token').value.trim(),
    accountId: $('input-cf-account').value.trim(),
    workerUrl: $('input-cf-worker-url').value.trim().replace(/\/+$/, ''),
    workerName: (getCfSettings().workerName || 'clearcall-autopush'),
  });
}

// ---- 角色：读取 / 保存 ----
async function loadCharConfig() {
  const c = await getChar();
  $('input-char-name').value = c.name;
  $('input-char-persona').value = c.persona;
  await updateAvatarPreview();
  await updateChatTitle();
}

async function saveCharConfig() {
  await setChar({
    name: $('input-char-name').value.trim(),
    persona: $('input-char-persona').value.trim(),
  });
  await updateAvatarPreview();
  await updateChatTitle();
}

function loadTriggerSettings() {
  const m = getTriggerModes();
  $('chk-instant').checked = m.instant;
  $('chk-batch').checked = m.batch;
  $('chk-countdown').checked = m.countdown;
  $('input-countdown-sec').value = m.countdownSec;
}

function saveTriggerSettings() {
  setTriggerModes({
    instant: $('chk-instant').checked,
    batch: $('chk-batch').checked,
    countdown: $('chk-countdown').checked,
    countdownSec: parseInt($('input-countdown-sec').value, 10) || 3,
  });
}

async function openChat() {
  await loadCharConfig();
  await renderChat();
  showView(viewChat);
}

async function openCharSettings() {
  await loadCharConfig();
  loadTriggerSettings();
  showView(viewCharSettings);
}

// ---- 聊天编排 ----
async function getPending() {
  const h = await getHistory();
  let i = h.length - 1;
  while (i >= 0 && h[i].role === 'user') i--;
  return h.slice(i + 1);
}

// 全关时等同「即时」，避免点了没反应
function isInstantMode() {
  const m = getTriggerModes();
  return m.instant || (!m.batch && !m.countdown);
}

function ensureConfigured() {
  const baseUrl = $('input-baseurl').value.trim();
  const apiKey = $('input-apikey').value.trim();
  const model = getCurrentModel();
  if (!baseUrl || !apiKey || !model) {
    toast('请先到「设置」填好接口地址、API Key 和模型名');
    return false;
  }
  return true;
}

async function currentChatPayload(message, priorHistory) {
  const c = await getChar();
  const { entries } = await getMemory();
  return {
    baseUrl: $('input-baseurl').value.trim(),
    apiKey: $('input-apikey').value.trim(),
    model: getCurrentModel(),
    persona: c.persona,
    memory: formatMemory(entries),
    history: Array.isArray(priorHistory) ? priorHistory.slice(-RECENT_HISTORY_LIMIT) : priorHistory,
    message,
  };
}

function setChatSending(sending) {
  chatSending = sending;
  updateGenerateButton();
}

async function updateGenerateButton() {
  const btn = $('btn-batch-send');
  const m = getTriggerModes();
  const pending = await getPending();
  const show = m.batch && !isInstantMode() && pending.length > 0 && !chatSending;
  btn.hidden = !show;
  btn.disabled = chatSending;
}

function clearCountdown() {
  if (countdownTick) { clearInterval(countdownTick); countdownTick = null; }
  countdownSecRemain = 0;
}

function startCountdown() {
  const m = getTriggerModes();
  clearCountdown();
  countdownSecRemain = m.countdownSec;
  countdownTick = setInterval(() => {
    countdownSecRemain -= 1;
    if (countdownSecRemain <= 0) {
      clearCountdown();
      flushQueue();
    }
  }, 1000);
}

// 倒计时只在「有待回复消息 + 无草稿 + 退出输入状态」时启动
async function maybeStartCountdown() {
  const m = getTriggerModes();
  if (chatSending) return;
  if (m.instant) return;
  if (!m.countdown) return;
  const pending = await getPending();
  if (pending.length === 0) return;
  if ($('input-chat').value.trim() !== '') return;
  if (document.activeElement === $('input-chat')) return;
  startCountdown();
}

async function afterFlush() {
  autoSummarizeIfNeeded(); // 后台整理旧内容，不阻塞聊天
  const pending = await getPending();
  if (pending.length === 0) { await updateGenerateButton(); return; }
  if (isInstantMode()) flushQueue();
  else if (getTriggerModes().countdown) await maybeStartCountdown();
  else await updateGenerateButton();
}

// 提交：消息立刻上屏，并按模式决定何时请求 AI
async function submitMessage(text) {
  const msg = (text || '').trim();
  if (!msg) return;

  await mutateHistory((arr) => arr.push({ role: 'user', content: msg }));
  await renderChat();
  $('input-chat').value = '';
  await updateGenerateButton();

  if (isInstantMode()) {
    flushQueue();
  } else if (getTriggerModes().countdown) {
    await maybeStartCountdown();
  }
  // 攒消息手动触发：等待点「生成回复」
}

// 触发：把待回复的用户消息合并成一条请求 AI（请求锁防重复调用）
async function flushQueue() {
  if (chatSending) return;
  const history = await getHistory();
  let i = history.length - 1;
  while (i >= 0 && history[i].role === 'user') i--;
  const pending = history.slice(i + 1);
  if (pending.length === 0) return;
  if (!ensureConfigured()) return;

  clearCountdown();

  const combined = pending.map((m) => m.content).join('\n');
  const priorHistory = history.slice(0, history.length - pending.length);
  const baseIndex = history.length; // 回复要插在 pending 之后
  const payload = await currentChatPayload(combined, priorHistory);

  setChatSending(true);
  await appendTyping();

  let result;
  try {
    result = await requestReply(payload);
  } catch (err) {
    result = { ok: false, reason: '无法连接本地服务：' + (err && err.message ? err.message : err), hints: ['确认本地服务已启动'] };
  }

  removeTyping();
  const replyMsg = (result && result.ok)
    ? { role: 'assistant', content: result.reply }
    : { role: 'assistant', content: '', error: true };
  await mutateHistory((arr) => arr.splice(baseIndex, 0, replyMsg)); // 插到这批消息之后、期间新消息之前
  await renderChat();
  setChatSending(false);
  await afterFlush();
}

async function retryReply(index) {
  if (chatSending) return;
  const history = await getHistory();
  if (index <= 0 || !history[index] || history[index].role !== 'assistant' || !history[index].error) return;

  // 找到这次失败回复对应的连续用户消息（紧邻 index 之前的 user 串）
  let start = index - 1;
  while (start >= 0 && history[start].role === 'user') start--;
  start += 1;
  if (start >= index) return;

  const combined = history.slice(start, index).map((m) => m.content).join('\n');
  const payload = await currentChatPayload(combined, history.slice(0, start));

  setChatSending(true);
  await appendTyping();

  let result;
  try {
    result = await requestReply(payload);
  } catch (err) {
    result = { ok: false, reason: '无法连接本地服务：' + (err && err.message ? err.message : err), hints: ['确认本地服务已启动'] };
  }

  removeTyping();
  const replyMsg = (result && result.ok)
    ? { role: 'assistant', content: result.reply }
    : { role: 'assistant', content: '', error: true };
  await mutateHistory((arr) => {
    if (arr[index] && arr[index].role === 'assistant') arr[index] = replyMsg;
  });
  await renderChat();
  setChatSending(false);
}

// ---- 记忆应用编排 ----
async function openMemory() {
  await renderMemory();
  cancelMemoryForm();
  showView(viewMemory);
}

function openMemoryAdd() {
  editingMemoryId = null;
  renderMemoryForm(null);
}

async function openMemoryEdit(id) {
  const { entries } = await getMemory();
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  editingMemoryId = id;
  renderMemoryForm(e);
}

async function saveMemoryForm() {
  const category = $('memory-category').value;
  const text = $('memory-text').value.trim();
  if (!text) { toast('记忆内容不能为空'); return; }
  try {
    if (editingMemoryId) await updateMemoryEntry(editingMemoryId, { category, text });
    else await addMemoryEntry({ category, text });
    cancelMemoryForm();
    await renderMemory();
    toast('记忆已保存');
  } catch (err) {
    toast('保存失败：' + (err && err.message ? err.message : err));
  }
}

function cancelMemoryForm() {
  editingMemoryId = null;
  const box = $('memory-form');
  box.hidden = true;
  box.innerHTML = '';
}

async function deleteMemoryEntryConfirm(id) {
  try {
    await deleteMemoryEntry(id);
    await renderMemory();
    toast('已删除');
  } catch (err) {
    toast('删除失败：' + (err && err.message ? err.message : err));
  }
}

// 独立记忆服务优先；未填则复用聊天用的 AI 接口
function getEffectiveMemorySettings() {
  const m = getMemorySettings();
  if (m.baseUrl && m.apiKey && m.model) return m;
  const s = getSettings();
  return { baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model };
}

function historyToText(messages) {
  return (messages || []).map((m) => (m.role === 'assistant' ? '角色' : '用户') + '：' + (m.content || '')).join('\n');
}

// 手动「整理」：把尚未总结的聊天内容提炼成记忆
async function summarizeChatToMemory() {
  const ms = getEffectiveMemorySettings();
  if (!ms.baseUrl || !ms.apiKey || !ms.model) {
    toast('请先在「设置」填好记忆服务地址、Key 和模型');
    return;
  }
  const history = await getHistory();
  const { entries, lastSummarizedCount } = await getMemory();
  const content = historyToText(history.slice(lastSummarizedCount));
  if (!content.trim()) { toast('没有需要整理的新内容'); return; }

  toast('正在整理记忆…');
  try {
    const data = await requestMemorySummary({
      baseUrl: ms.baseUrl, apiKey: ms.apiKey, model: ms.model,
      content, existing: formatMemory(entries),
    });
    if (!data.ok) { toast('整理失败：' + (data.reason || '未知错误')); return; }
    const newEntries = data.entries || [];
    await mergeMemoryEntries(newEntries);
    await setLastSummarizedCount(history.length);
    await renderMemory();
    toast('已整理 ' + newEntries.length + ' 条记忆');
  } catch (err) {
    toast('整理失败：' + (err && err.message ? err.message : err));
  }
}

// 自动整理：聊天较长后，把超出最近窗口的旧内容悄悄总结（失败不打扰）
async function autoSummarizeIfNeeded() {
  const history = await getHistory();
  const { entries, lastSummarizedCount } = await getMemory();
  const targetEnd = history.length - RECENT_HISTORY_LIMIT;
  if (targetEnd <= lastSummarizedCount) return;
  if (targetEnd - lastSummarizedCount < AUTO_SUMMARIZE_MIN_NEW) return;
  const ms = getEffectiveMemorySettings();
  if (!ms.baseUrl || !ms.apiKey || !ms.model) return;
  const content = historyToText(history.slice(lastSummarizedCount, targetEnd));
  if (!content.trim()) return;
  try {
    const data = await requestMemorySummary({
      baseUrl: ms.baseUrl, apiKey: ms.apiKey, model: ms.model,
      content, existing: formatMemory(entries),
    });
    if (data.ok) {
      await mergeMemoryEntries(data.entries || []);
      await setLastSummarizedCount(targetEnd);
    }
  } catch (_) { /* 自动整理失败静默 */ }
}

// ===== Cloudflare Worker 一键部署 =====

async function deployCfWorker() {
  const token = $('input-cf-token').value.trim();
  const accountId = $('input-cf-account').value.trim();
  if (!token || !accountId) {
    toast('请先填写 Token 和 Account ID');
    return;
  }

  const workerName = 'clearcall-autopush';
  const btn = $('btn-cf-deploy');
  const status = $('cf-deploy-status');
  btn.disabled = true;
  btn.textContent = '部署中…';
  status.hidden = false;
  status.textContent = '正在连接 Cloudflare…';

  try {
    // 1. 检查 Worker 是否已存在
    const checkResp = await fetch(
      'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/workers/services/' + workerName,
      { headers: { 'Authorization': 'Bearer ' + token } }
    );

    let scriptBody;
    try {
      // 尝试把 worker 文件读进来（inline 嵌入）
      scriptBody = await (await fetch('worker/autopush.js')).text();
    } catch (_) {
      // 如果 fetch 不到（部署后的静态托管环境），用内置 fallback
      scriptBody = WORKER_FALLBACK;
    }

    // 2. 创建或更新 Worker（用 Scripts API）
    // Workers Scripts API: PUT /accounts/{accountId}/workers/scripts/{scriptName}
    const deployResp = await fetch(
      'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/workers/scripts/' + workerName,
      {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/javascript',
        },
        body: scriptBody,
      }
    );

    const deployData = await deployResp.json();
    if (!deployData.success) {
      const msg = (deployData.errors && deployData.errors[0] && deployData.errors[0].message) || '部署失败';
      throw new Error(msg);
    }

    // 3. 获取 subdomain → 构造 Worker URL
    const subResp = await fetch(
      'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/workers/subdomain',
      { headers: { 'Authorization': 'Bearer ' + token } }
    );
    const subData = await subResp.json();
    const subdomain = subData.result && subData.result.subdomain;
    let workerUrl = '';
    if (subdomain) {
      workerUrl = 'https://' + workerName + '.' + subdomain + '.workers.dev';
    } else {
      // 如果没开 subdomain，提示用户手动绑定
      toast('Worker 已部署，但你的账号可能没开启 workers.dev subdomain，请到 Cloudflare 后台手动绑定路由');
      workerUrl = 'https://' + workerName + '.your-subdomain.workers.dev';
    }

    // 4. 保存配置
    const cf = getCfSettings();
    setCfSettings({ ...cf, token, accountId, workerUrl, workerName });
    $('input-cf-worker-url').value = workerUrl;

    status.textContent = '✓ 部署成功！Worker 地址：' + workerUrl;
    toast('Worker 部署成功');
  } catch (err) {
    status.textContent = '部署失败：' + (err && err.message ? err.message : err);
    toast('部署失败：' + (err && err.message ? err.message : err));
  } finally {
    btn.disabled = false;
    btn.textContent = '一键部署 Worker';
  }
}

// Worker 脚本 fallback（内嵌在前端，确保在无文件 fetch 时也能部署）
const WORKER_FALLBACK = String.raw`
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};
const store = new Map();
export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/config' && request.method === 'POST') return await handleConfig(request);
      if (url.pathname === '/pull' && request.method === 'GET') return await handlePull(url);
      if (url.pathname === '/status' && request.method === 'GET') return new Response(JSON.stringify({ ok: true }), { headers: CORS });
      return new Response(JSON.stringify({ ok: false, error: 'not found' }), { status: 404, headers: CORS });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: String(err.message || err) }), { status: 500, headers: CORS });
    }
  },
};
async function handleConfig(request) {
  const b = await request.json();
  const id = String(b.clientId || 'default');
  const cfg = {
    clientId: id, baseUrl: b.baseUrl || '', apiKey: b.apiKey || '', model: b.model || '',
    persona: b.persona || '', memory: b.memory || '', intervalMin: parseInt(b.intervalMin, 10) || 0,
    prompt: b.prompt || '', enabled: b.enabled !== false && parseInt(b.intervalMin, 10) > 0,
    messages: [], nextAt: parseInt(b.intervalMin, 10) > 0 ? Date.now() + parseInt(b.intervalMin, 10) * 60000 : 0,
  };
  store.set(id, cfg);
  return new Response(JSON.stringify({ ok: true, enabled: cfg.enabled }), { headers: CORS });
}
async function handlePull(url) {
  const id = url.searchParams.get('clientId') || 'default';
  const cfg = store.get(id);
  if (!cfg) return new Response(JSON.stringify({ ok: true, messages: [] }), { headers: CORS });
  const msgs = cfg.messages || []; cfg.messages = [];
  if (cfg.enabled && cfg.intervalMin > 0 && msgs.length === 0) {
    try { await generateFor(cfg); const f = cfg.messages.shift(); if (f) msgs.push(f); } catch (_) {}
  }
  return new Response(JSON.stringify({ ok: true, messages: msgs }), { headers: CORS });
}
async function generateFor(cfg) {
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) return;
  const sys = cfg.persona ? ('你正在扮演以下角色：\n' + cfg.persona + '\n\n请根据角色人设，自然地发一句想对用户说的话。') : '请发一句自然的问候。';
  const msgs = [{ role: 'system', content: sys }];
  if (cfg.memory) msgs.push({ role: 'system', content: '用户记忆：\n' + cfg.memory });
  msgs.push({ role: 'user', content: cfg.prompt || '现在你想对我说什么？用一句话回复。' });
  const resp = await fetch(cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
    body: JSON.stringify({ model: cfg.model, messages: msgs, temperature: 0.9, max_tokens: 200 }),
  });
  if (!resp.ok) { cfg.nextAt = Date.now() + 300000; return; }
  const d = await resp.json();
  const c = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
  if (c) { if (!cfg.messages) cfg.messages = []; cfg.messages.push({ content: String(c).trim(), generatedAt: Date.now() }); }
  cfg.nextAt = Date.now() + cfg.intervalMin * 60000;
}
`.trim();

// ===== 主动消息：配置下发到 Worker + 前端定时拉取 =====
async function pushAutopushConfigToWorker(enabled, intervalMin, prompt) {
  const cf = getCfSettings();
  if (!cf.workerUrl) { toast('请先在「设置」里部署 Worker'); return false; }
  const c = await getChar();
  const { entries } = await getMemory();
  const s = getSettings();

  try {
    const resp = await fetch(cf.workerUrl + '/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: CLIENT_ID,
        baseUrl: s.baseUrl,
        apiKey: s.apiKey,
        model: s.model,
        persona: c.persona,
        memory: formatMemory(entries),
        intervalMin: intervalMin || 0,
        prompt: prompt || '',
        enabled: enabled,
      }),
    });
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || '未知错误');
    return true;
  } catch (err) {
    toast('Worker 配置失败：' + (err && err.message ? err.message : err));
    return false;
  }
}

async function pullAutopushMessages() {
  const cf = getCfSettings();
  if (!cf.workerUrl) return [];
  try {
    const resp = await fetch(cf.workerUrl + '/pull?clientId=' + encodeURIComponent(CLIENT_ID));
    const data = await resp.json();
    if (data.ok && Array.isArray(data.messages)) return data.messages;
  } catch (_) { /* 静默 */ }
  return [];
}

// 前端定期拉取主动消息（每 60 秒）
async function pollAutopush() {
  const msgs = await pullAutopushMessages();
  if (!msgs || msgs.length === 0) return;
  // 上屏为角色消息
  await mutateHistory((arr) => {
    msgs.forEach((m) => arr.push({ role: 'assistant', content: m.content, autopush: true }));
  });
  await renderChat();
}

function startAutopushPolling() {
  stopAutopushPolling();
  autopushInterval = setInterval(pollAutopush, 60 * 1000); // 每 60 秒拉一次
  // 立即拉一次
  pollAutopush();
}

function stopAutopushPolling() {
  if (autopushInterval) { clearInterval(autopushInterval); autopushInterval = null; }
}

// 主动消息弹窗
let autopushSelectedMin = 15;
let autopushCustomMin = 30;

async function openAutopushModal() {
  // 重置 UI
  document.querySelectorAll('.interval-tab').forEach((t) => {
    t.classList.toggle('active', parseInt(t.dataset.min, 10) === autopushSelectedMin);
  });
  $('input-autopush-min').value = autopushCustomMin;
  $('interval-custom-row').hidden = autopushSelectedMin !== 0;

  // 检查当前状态
  const cf = getCfSettings();
  const statusRow = $('autopush-status-row');
  const disableBtn = $('btn-autopush-disable');

  if (!cf.workerUrl) {
    statusRow.hidden = false;
    statusRow.textContent = '⚠ 还没部署 Worker，请先到「设置 → 主动消息推送」里一键部署。';
    statusRow.style.background = 'rgba(255, 80, 80, 0.12)';
    disableBtn.hidden = true;
  } else {
    statusRow.hidden = false;
    statusRow.textContent = '✓ Worker 已就绪：' + cf.workerUrl;
    statusRow.style.background = 'rgba(80, 200, 120, 0.12)';
    disableBtn.hidden = false;
  }

  $('modal-autopush').hidden = false;
}

function closeAutopushModal() {
  $('modal-autopush').hidden = true;
}

function saveAutopushSettings() {
  const intervalMin = autopushSelectedMin === 0 ? autopushCustomMin : autopushSelectedMin;
  if (!intervalMin || intervalMin < 1) { toast('请设置有效的间隔时间'); return; }
  const prompt = $('input-autopush-prompt').value.trim();

  pushAutopushConfigToWorker(true, intervalMin, prompt).then((ok) => {
    if (ok) {
      startAutopushPolling();
      closeAutopushModal();
      toast('主动消息已开启，每 ' + intervalMin + ' 分钟尝试生成一次');
    }
  });
}

function disableAutopush() {
  pushAutopushConfigToWorker(false, 0, '').then((ok) => {
    if (ok) {
      stopAutopushPolling();
      closeAutopushModal();
      toast('主动消息已关闭');
    }
  });
}

function togglePlusMenu(force) {
  plusMenuOpen = force !== undefined ? force : !plusMenuOpen;
  $('plus-menu').hidden = !plusMenuOpen;
}

// ===== 事件绑定 =====
$('tab-select').addEventListener('click', () => setModelMode('select'));
$('tab-manual').addEventListener('click', () => setModelMode('manual'));

// 主屏幕应用图标
document.querySelectorAll('.app-icon').forEach((btn) => {
  btn.addEventListener('click', () => {
    const app = btn.dataset.app;
    if (app === 'settings') {
      loadSaved();
      $('result').hidden = true;
      showView(viewSettings);
    } else if (app === 'chat') {
      openChat();
    } else if (app === 'memory') {
      openMemory();
    } else {
      const name = btn.querySelector('.app-name').textContent;
      toast('「' + name + '」功能开发中，请先使用「设置」');
    }
  });
});

$('btn-back').addEventListener('click', () => showView(viewHome));

$('btn-toggle-key').addEventListener('click', () => {
  const inp = $('input-apikey');
  const revealing = inp.type === 'password';
  inp.type = revealing ? 'text' : 'password';
  $('btn-toggle-key').textContent = revealing ? '隐藏' : '显示';
});

// 拉取模型列表
$('btn-fetch-models').addEventListener('click', async () => {
  save();
  const baseUrl = $('input-baseurl').value.trim();
  const apiKey = $('input-apikey').value.trim();
  const btn = $('btn-fetch-models');
  const result = $('result');
  btn.disabled = true;
  btn.textContent = '拉取中…';
  result.hidden = false;
  result.className = 'result loading';
  result.textContent = '正在获取模型列表…';

  try {
    const data = await fetchModels(baseUrl, apiKey);
    if (data.ok) {
      const list = data.models || [];
      populateModels(list);
      setModelMode('select');
      result.className = 'result success';
      result.innerHTML = '';
      const title = document.createElement('div');
      title.className = 'result-title';
      title.textContent = '已获取 ' + list.length + ' 个模型';
      result.appendChild(title);
    } else {
      renderResult(data);
    }
  } catch (err) {
    renderResult({
      ok: false,
      reason: '无法连接本地服务：' + (err && err.message ? err.message : err),
      hints: ['确认本地服务已启动（在终端运行 node server.js 或 npm start）'],
    });
  } finally {
    btn.disabled = false;
    btn.textContent = '拉取模型';
  }
});

// 连接测试
$('btn-test').addEventListener('click', async () => {
  const baseUrl = $('input-baseurl').value.trim();
  const apiKey = $('input-apikey').value.trim();
  const model = getCurrentModel();
  save();

  const result = $('result');
  result.hidden = false;
  result.className = 'result loading';
  result.textContent = '正在测试连接…';

  const btn = $('btn-test');
  btn.disabled = true;
  btn.textContent = '测试中…';

  try {
    const data = await apiTest(baseUrl, apiKey, model);
    renderResult(data);

    // 连接成功后自动拉取一次模型列表，方便下次直接选择
    if (data && data.ok) {
      try {
        const ml = await fetchModels(baseUrl, apiKey);
        if (ml && ml.ok && Array.isArray(ml.models) && ml.models.length) {
          populateModels(ml.models);
        }
      } catch (_) { /* 静默失败 */ }
    }
  } catch (err) {
    renderResult({
      ok: false,
      reason: '无法连接本地服务：' + (err && err.message ? err.message : err),
      hints: ['确认本地服务已启动（在终端运行 node server.js 或 npm start）'],
    });
  } finally {
    btn.disabled = false;
    btn.textContent = '连接测试';
  }
});

// 角色聊天导航
$('btn-chat-back').addEventListener('click', () => showView(viewHome));
$('btn-chat-config').addEventListener('click', openCharSettings);
$('btn-char-settings-back').addEventListener('click', () => showView(viewChat));
$('input-char-name').addEventListener('input', saveCharConfig);
$('input-char-persona').addEventListener('input', saveCharConfig);

// 记忆应用
$('btn-memory-back').addEventListener('click', () => showView(viewHome));
$('btn-memory-summarize').addEventListener('click', summarizeChatToMemory);
$('btn-memory-add').addEventListener('click', openMemoryAdd);
$('btn-toggle-memory-key').addEventListener('click', () => {
  const inp = $('input-memory-apikey');
  const revealing = inp.type === 'password';
  inp.type = revealing ? 'text' : 'password';
  $('btn-toggle-memory-key').textContent = revealing ? '隐藏' : '显示';
});

// 头像
$('btn-upload-avatar').addEventListener('click', () => $('file-avatar').click());
$('file-avatar').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const blob = await fileToAvatar(f);
    await setCharAvatarBlob(blob, 'image/jpeg', f.name);
    await updateAvatarPreview();
    toast('头像已保存');
  } catch (err) {
    toast(err && err.message ? err.message : '头像保存失败');
  }
});
$('btn-clear-avatar').addEventListener('click', async () => {
  try {
    await clearCharAvatar();
    await updateAvatarPreview();
  } catch (err) {
    toast(err && err.message ? err.message : '清除头像失败');
  }
});

// 备份：导出 / 导入
$('btn-export').addEventListener('click', async () => {
  try {
    const backup = await buildBackup();
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'clearcall-备份-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('备份已导出');
  } catch (err) {
    toast('导出失败：' + (err && err.message ? err.message : err));
  }
});

$('btn-import').addEventListener('click', () => $('file-import').click());
$('file-import').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const text = await f.text();
    const data = JSON.parse(text);
    await applyBackup(data);
    loadSaved();
    await loadCharConfig();
    toast('备份已导入');
  } catch (err) {
    toast('导入失败：' + (err && err.message ? err.message : err));
  }
});

// 聊天输入
$('btn-chat-send').addEventListener('click', () => submitMessage($('input-chat').value));
$('input-chat').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitMessage($('input-chat').value);
  }
});
$('btn-batch-send').addEventListener('click', () => flushQueue());
$('input-chat').addEventListener('input', () => {
  if (countdownTick) clearCountdown(); // 新输入重置倒计时
});
$('input-chat').addEventListener('blur', () => maybeStartCountdown());

// 触发模式开关
$('chk-instant').addEventListener('change', saveTriggerSettings);
$('chk-batch').addEventListener('change', saveTriggerSettings);
$('chk-countdown').addEventListener('change', saveTriggerSettings);
$('input-countdown-sec').addEventListener('input', saveTriggerSettings);

// Cloudflare Token 显示/隐藏
$('btn-toggle-cf-token').addEventListener('click', () => {
  const inp = $('input-cf-token');
  const revealing = inp.type === 'password';
  inp.type = revealing ? 'text' : 'password';
  $('btn-toggle-cf-token').textContent = revealing ? '隐藏' : '显示';
});

// CF 设置输入即保存
['input-cf-token', 'input-cf-account', 'input-cf-worker-url'].forEach((id) => {
  $(id).addEventListener('blur', save);
});

// 一键部署 Worker
$('btn-cf-deploy').addEventListener('click', deployCfWorker);

// 加号菜单
$('btn-chat-plus').addEventListener('click', (e) => { e.stopPropagation(); togglePlusMenu(); });
document.addEventListener('click', (e) => {
  if (plusMenuOpen && !$('plus-menu').contains(e.target) && !$('btn-chat-plus').contains(e.target)) {
    togglePlusMenu(false);
  }
});

// 加号菜单 → 主动消息
$('btn-plus-autopush').addEventListener('click', () => {
  togglePlusMenu(false);
  openAutopushModal();
});

// 主动消息弹窗
$('btn-autopush-close').addEventListener('click', closeAutopushModal);
$('modal-autopush').addEventListener('click', (e) => {
  if (e.target.id === 'modal-autopush') closeAutopushModal();
});
document.querySelectorAll('.interval-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    autopushSelectedMin = parseInt(tab.dataset.min, 10);
    document.querySelectorAll('.interval-tab').forEach((t) => t.classList.toggle('active', t === tab));
    $('interval-custom-row').hidden = autopushSelectedMin !== 0;
  });
});
$('input-autopush-min').addEventListener('input', () => {
  autopushCustomMin = parseInt($('input-autopush-min').value, 10) || 30;
});
$('btn-autopush-save').addEventListener('click', saveAutopushSettings);
$('btn-autopush-disable').addEventListener('click', disableAutopush);

// 启动：迁移旧数据 → 读取界面 → 启动主动消息轮询
(async function init() {
  try {
    await migrate();
  } catch (err) {
    toast('旧数据迁移失败：' + (err && err.message ? err.message : err));
  }
  loadSaved();
  try { await loadCharConfig(); } catch (_) {}
  // 如果 Worker URL 已配，启动轮询
  const cf = getCfSettings();
  if (cf.workerUrl) startAutopushPolling();
})();
