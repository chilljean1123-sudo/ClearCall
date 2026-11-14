// ===== 编排层 / 入口 =====
// 串联 store.js（存取数据）、api.js（调用模型）、ui.js（界面渲染）。
// 负责聊天状态机、回复触发模式、备份导入导出、以及所有事件绑定。

let chatSending = false;
let countdownTick = null;
let countdownSecRemain = 0;

// ---- 设置页：读取 / 保存配置 ----
function loadSaved() {
  const s = getSettings();
  $('input-baseurl').value = s.baseUrl;
  $('input-apikey').value = s.apiKey;
  $('input-model').value = s.model;
  ensureSelectOption(s.model);
  setModelMode(s.modelMode);
}

function save() {
  setSettings({
    baseUrl: $('input-baseurl').value.trim(),
    apiKey: $('input-apikey').value.trim(),
    model: getCurrentModel(),
    modelMode: getModelMode(),
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
  return {
    baseUrl: $('input-baseurl').value.trim(),
    apiKey: $('input-apikey').value.trim(),
    model: getCurrentModel(),
    persona: c.persona,
    history: priorHistory,
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

// 启动：迁移旧数据 → 读取界面
(async function init() {
  try {
    await migrate();
  } catch (err) {
    toast('旧数据迁移失败：' + (err && err.message ? err.message : err));
  }
  loadSaved();
  try { await loadCharConfig(); } catch (_) {}
})();
