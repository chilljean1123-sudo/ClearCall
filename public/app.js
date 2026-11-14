const $ = (id) => document.getElementById(id);

const KEYS = {
  baseUrl: 'clearcall.baseUrl',
  apiKey: 'clearcall.apiKey',
  model: 'clearcall.model',
  modelMode: 'clearcall.modelMode',
};

const viewHome = $('view-home');
const viewSettings = $('view-settings');

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
