const $ = (id) => document.getElementById(id);

const KEYS = {
  baseUrl: 'clearcall.baseUrl',
  apiKey: 'clearcall.apiKey',
  model: 'clearcall.model',
  modelMode: 'clearcall.modelMode',
};

const viewHome = $('view-home');
const viewSettings = $('view-settings');
const viewChat = $('view-chat');

function showView(view) {
  document.querySelectorAll('.app-view').forEach((el) => el.classList.remove('active'));
  view.classList.add('active');
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 2200);
}

// 状态栏时间
function updateTime() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  document.querySelector('.status-time').textContent = hh + ':' + mm;
}
updateTime();
setInterval(updateTime, 30000);

// ===== 模型名：选择 / 手动填写 两种模式 =====
function getModelMode() {
  return $('tab-select').classList.contains('active') ? 'select' : 'manual';
}

function setModelMode(mode) {
  const isSelect = mode === 'select';
  $('tab-select').classList.toggle('active', isSelect);
  $('tab-manual').classList.toggle('active', !isSelect);
  $('wrap-select').hidden = !isSelect;
  $('wrap-manual').hidden = isSelect;
}

function getCurrentModel() {
  return getModelMode() === 'select' ? $('select-model').value.trim() : $('input-model').value.trim();
}

function ensureSelectOption(value) {
  if (!value) return;
  const sel = $('select-model');
  if (!Array.from(sel.options).some((o) => o.value === value)) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    sel.appendChild(opt);
  }
  sel.value = value;
}

function populateModels(models) {
  const sel = $('select-model');
  const prev = sel.value;
  sel.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = models.length ? '请选择一个模型' : '未获取到模型，请切到「手动填写」';
  sel.appendChild(empty);
  models.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    sel.appendChild(opt);
  });
  if (prev) ensureSelectOption(prev);
}

$('tab-select').addEventListener('click', () => setModelMode('select'));
$('tab-manual').addEventListener('click', () => setModelMode('manual'));

// ===== 读取 / 保存配置 =====
function loadSaved() {
  $('input-baseurl').value = localStorage.getItem(KEYS.baseUrl) || '';
  $('input-apikey').value = localStorage.getItem(KEYS.apiKey) || '';
  const model = localStorage.getItem(KEYS.model) || '';
  $('input-model').value = model;
  ensureSelectOption(model);
  setModelMode(localStorage.getItem(KEYS.modelMode) || 'select');
}

function save() {
  localStorage.setItem(KEYS.baseUrl, $('input-baseurl').value.trim());
  localStorage.setItem(KEYS.apiKey, $('input-apikey').value.trim());
  localStorage.setItem(KEYS.model, getCurrentModel());
  localStorage.setItem(KEYS.modelMode, getModelMode());
}

// ===== 主屏幕应用图标 =====
document.querySelectorAll('.app-icon').forEach((btn) => {
  btn.addEventListener('click', () => {
    const app = btn.dataset.app;
    if (app === 'settings') {
      loadSaved();
      $('result').hidden = true;
      showView(viewSettings);
    } else if (app === 'chat') {
      openChat();
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

// ===== 结果渲染 =====
function renderResult(data) {
  const result = $('result');
  result.innerHTML = '';

  if (data.ok) {
    result.className = 'result success';
    const title = document.createElement('div');
    title.className = 'result-title';
    title.textContent = '连接成功';
    result.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'result-meta';
    const latency = data.latency != null ? data.latency + ' ms' : '';
    meta.textContent = ('模型 ' + (data.model || '') + ' · 耗时 ' + latency).trim();
    result.appendChild(meta);

    const reply = document.createElement('div');
    reply.className = 'result-reply';
    reply.textContent = '模型返回：' + (data.reply || '');
    result.appendChild(reply);
  } else {
    result.className = 'result error';
    const title = document.createElement('div');
    title.className = 'result-title';
    title.textContent = '连接失败';
    result.appendChild(title);

    const reason = document.createElement('div');
    reason.className = 'result-reason';
    reason.textContent = '原因：' + (data.reason || '未知错误');
    result.appendChild(reason);

    if (data.message) {
      const raw = document.createElement('div');
      raw.className = 'result-raw';
      raw.textContent = '服务商返回：' + data.message;
      result.appendChild(raw);
    }

    if (Array.isArray(data.hints) && data.hints.length) {
      const label = document.createElement('div');
      label.className = 'hint-label';
      label.textContent = '下一步检查：';
      result.appendChild(label);

      const ul = document.createElement('ul');
      ul.className = 'result-hints';
      data.hints.forEach((h) => {
        const li = document.createElement('li');
        li.textContent = h;
        ul.appendChild(li);
      });
      result.appendChild(ul);
    }
  }
}

// ===== 拉取模型列表 =====
async function fetchModelList() {
  const baseUrl = $('input-baseurl').value.trim();
  const apiKey = $('input-apikey').value.trim();
  const res = await fetch('/api/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl, apiKey }),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (_) {
    return {
      ok: false,
      reason: '本地服务返回异常（HTTP ' + res.status + '）',
      hints: res.status === 504 ? ['请求耗时过长被网关中断，通常是服务商响应太慢', '稍后重试，或换个模型再试'] : ['查看终端日志'],
    };
  }
}

$('btn-fetch-models').addEventListener('click', async () => {
  save();
  const btn = $('btn-fetch-models');
  const result = $('result');
  btn.disabled = true;
  btn.textContent = '拉取中…';
  result.hidden = false;
  result.className = 'result loading';
  result.textContent = '正在获取模型列表…';

  try {
    const data = await fetchModelList();
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
      const hint = document.createElement('div');
      hint.className = 'result-meta';
      hint.textContent = '请在下方「模型名」下拉框里选择。';
      result.appendChild(hint);
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

// ===== 连接测试 =====
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
    const res = await fetch('/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, apiKey, model }),
    });
    let data;
    try {
      data = await res.json();
    } catch (_) {
      data = {
        ok: false,
        reason: '本地服务返回异常（HTTP ' + res.status + '）',
        hints: res.status === 504
          ? ['请求耗时过长被网关中断，通常是服务商响应太慢', '稍后重试，或换个模型再试']
          : ['查看终端日志'],
      };
    }
    renderResult(data);

    // 连接成功后自动拉取一次模型列表，方便下次直接选择
    if (data && data.ok) {
      try {
        const ml = await fetchModelList();
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

// ===== 角色聊天 =====
const CHAT_KEYS = {
  name: 'clearcall.charName',
  avatar: 'clearcall.charAvatar',
  persona: 'clearcall.charPersona',
  history: 'clearcall.chatHistory',
};

let chatSending = false;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getChar() {
  return {
    name: localStorage.getItem(CHAT_KEYS.name) || '',
    avatar: localStorage.getItem(CHAT_KEYS.avatar) || '',
    persona: localStorage.getItem(CHAT_KEYS.persona) || '',
  };
}

function getHistory() {
  try {
    const arr = JSON.parse(localStorage.getItem(CHAT_KEYS.history) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}

function setHistory(arr) {
  localStorage.setItem(CHAT_KEYS.history, JSON.stringify(arr));
}

function charAvatarHTML(avatar, name) {
  if (avatar) return '<img class="msg-avatar-img" src="' + avatar + '" alt="" />';
  return '<span>' + escapeHtml((name || '角').trim().charAt(0) || '角') + '</span>';
}

function updateAvatarPreview() {
  $('avatar-preview').innerHTML = charAvatarHTML(getChar().avatar, getChar().name);
}

function updateChatTitle() {
  $('chat-title').textContent = getChar().name || '角色聊天';
}

function loadCharConfig() {
  const c = getChar();
  $('input-char-name').value = c.name;
  $('input-char-persona').value = c.persona;
  updateAvatarPreview();
  updateChatTitle();
}

function saveCharConfig() {
  localStorage.setItem(CHAT_KEYS.name, $('input-char-name').value.trim());
  localStorage.setItem(CHAT_KEYS.persona, $('input-char-persona').value.trim());
  updateAvatarPreview();
  updateChatTitle();
}

function openChat() {
  loadCharConfig();
  renderChat();
  $('chat-config').hidden = true;
  showView(viewChat);
}

function scrollChatToBottom() {
  const box = $('chat-messages');
  box.scrollTop = box.scrollHeight;
}

function renderMessage(m, index) {
  if (m.role === 'user') {
    const row = document.createElement('div');
    row.className = 'msg-row user';
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble user-bubble';
    bubble.textContent = m.content;
    row.appendChild(bubble);
    return row;
  }

  const row = document.createElement('div');
  row.className = 'msg-row assistant';
  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.innerHTML = charAvatarHTML(getChar().avatar, getChar().name);
  row.appendChild(avatar);

  const stack = document.createElement('div');
  stack.className = 'msg-stack';

  if (m.error) {
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble assistant-bubble error-bubble';
    bubble.textContent = '回复失败';
    stack.appendChild(bubble);
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'retry-btn';
    retry.textContent = '重试';
    retry.dataset.index = String(index);
    retry.addEventListener('click', () => retryReply(index));
    stack.appendChild(retry);
  } else {
    const lines = String(m.content || '').split('\n').map((s) => s.trim()).filter(Boolean);
    lines.forEach((line) => {
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble assistant-bubble';
      bubble.textContent = line;
      stack.appendChild(bubble);
    });
  }

  row.appendChild(stack);
  return row;
}

function renderChat() {
  const box = $('chat-messages');
  box.innerHTML = '';
  getHistory().forEach((m, i) => box.appendChild(renderMessage(m, i)));
  scrollChatToBottom();
}

function setChatSending(sending) {
  chatSending = sending;
  $('btn-chat-send').disabled = sending;
  $('btn-chat-send').textContent = sending ? '发送中' : '发送';
  $('input-chat').disabled = sending;
}

function appendTyping() {
  const row = document.createElement('div');
  row.className = 'msg-row assistant';
  row.id = 'typing-row';
  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.innerHTML = charAvatarHTML(getChar().avatar, getChar().name);
  row.appendChild(avatar);
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble assistant-bubble typing-bubble';
  bubble.textContent = '正在回复…';
  row.appendChild(bubble);
  $('chat-messages').appendChild(row);
  scrollChatToBottom();
}

function removeTyping() {
  const t = document.getElementById('typing-row');
  if (t) t.remove();
}

async function requestReply(payload) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (_) {
    return {
      ok: false,
      reason: '本地服务返回异常（HTTP ' + res.status + '）',
      hints: res.status === 504 ? ['请求耗时过长被网关中断，通常是服务商响应太慢', '稍后重试，或换个模型再试'] : ['查看终端日志'],
    };
  }
}

function currentChatPayload(message, priorHistory) {
  return {
    baseUrl: $('input-baseurl').value.trim(),
    apiKey: $('input-apikey').value.trim(),
    model: getCurrentModel(),
    persona: getChar().persona,
    history: priorHistory,
    message,
  };
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

async function sendChatMessage(text) {
  const msg = (text || '').trim();
  if (!msg) return;
  if (chatSending) return;
  if (!ensureConfigured()) return;

  const history = getHistory();
  const payload = currentChatPayload(msg, history.slice());

  history.push({ role: 'user', content: msg });
  setHistory(history);
  $('input-chat').value = '';
  renderChat();
  setChatSending(true);
  appendTyping();

  let result;
  try {
    result = await requestReply(payload);
  } catch (err) {
    result = { ok: false, reason: '无法连接本地服务：' + (err && err.message ? err.message : err), hints: ['确认本地服务已启动'] };
  }

  removeTyping();
  const current = getHistory();
  if (result && result.ok) {
    current.push({ role: 'assistant', content: result.reply });
  } else {
    current.push({ role: 'assistant', content: '', error: true });
  }
  setHistory(current);
  renderChat();
  setChatSending(false);
}

async function retryReply(index) {
  if (chatSending) return;
  const history = getHistory();
  if (index <= 0 || !history[index - 1] || history[index - 1].role !== 'user') return;

  const userMsg = history[index - 1].content;
  const payload = currentChatPayload(userMsg, history.slice(0, index - 1));

  setChatSending(true);
  appendTyping();

  let result;
  try {
    result = await requestReply(payload);
  } catch (err) {
    result = { ok: false, reason: '无法连接本地服务：' + (err && err.message ? err.message : err), hints: ['确认本地服务已启动'] };
  }

  removeTyping();
  const current = getHistory();
  current[index] = (result && result.ok)
    ? { role: 'assistant', content: result.reply }
    : { role: 'assistant', content: '', error: true };
  setHistory(current);
  renderChat();
  setChatSending(false);
}

function fileToAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) { reject(new Error('请选择图片文件')); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 200;
        let w = img.width;
        let h = img.height;
        if (w > max || h > max) {
          const s = Math.min(max / w, max / h);
          w = Math.round(w * s);
          h = Math.round(h * s);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('图片读取失败'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

$('btn-chat-back').addEventListener('click', () => showView(viewHome));
$('btn-chat-config').addEventListener('click', () => {
  const el = $('chat-config');
  el.hidden = !el.hidden;
});
$('input-char-name').addEventListener('input', saveCharConfig);
$('input-char-persona').addEventListener('input', saveCharConfig);
$('btn-upload-avatar').addEventListener('click', () => $('file-avatar').click());
$('file-avatar').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const url = await fileToAvatar(f);
    localStorage.setItem(CHAT_KEYS.avatar, url);
    updateAvatarPreview();
  } catch (err) {
    toast(err && err.message ? err.message : '头像上传失败');
  }
});
$('btn-clear-avatar').addEventListener('click', () => {
  localStorage.removeItem(CHAT_KEYS.avatar);
  updateAvatarPreview();
});
$('btn-chat-send').addEventListener('click', () => sendChatMessage($('input-chat').value));
$('input-chat').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage($('input-chat').value);
  }
});
