// ===== 界面渲染层 =====
// 只负责 DOM 渲染、页面导航、Toast 提示。不读写 localStorage、不发请求。
// 依赖 store.js（读 getChar/getHistory）与 app.js（retryReply 回调）。

const $ = (id) => document.getElementById(id);

const viewHome = $('view-home');
const viewSettings = $('view-settings');
const viewChat = $('view-chat');
const viewCharSettings = $('view-char-settings');

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

// ===== 结果渲染（连接测试 / 拉取模型） =====
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

// ===== 角色聊天渲染 =====
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function charAvatarHTML(avatar, name) {
  if (avatar) return '<img class="msg-avatar-img" src="' + avatar + '" alt="" />';
  return '<span>' + escapeHtml((name || '角').trim().charAt(0) || '角') + '</span>';
}

async function updateAvatarPreview() {
  const c = await getChar();
  $('avatar-preview').innerHTML = charAvatarHTML(c.avatar, c.name);
}

async function updateChatTitle() {
  const c = await getChar();
  $('chat-title').textContent = c.name || '角色聊天';
}

function splitReplyIntoBubbles(content) {
  const s = String(content || '');
  if (s.includes('<split>')) {
    return s.split('<split>').map((p) => p.trim()).filter(Boolean);
  }
  return s.split('\n').map((p) => p.trim()).filter(Boolean);
}

function renderMessage(m, index, avatar, name) {
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
  const avatarEl = document.createElement('div');
  avatarEl.className = 'msg-avatar';
  avatarEl.innerHTML = charAvatarHTML(avatar, name);
  row.appendChild(avatarEl);

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
    const parts = splitReplyIntoBubbles(m.content);
    parts.forEach((part) => {
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble assistant-bubble';
      bubble.textContent = part;
      stack.appendChild(bubble);
    });
  }

  row.appendChild(stack);
  return row;
}

async function renderChat() {
  const box = $('chat-messages');
  box.innerHTML = '';
  const history = await getHistory();
  const c = await getChar();
  history.forEach((m, i) => box.appendChild(renderMessage(m, i, c.avatar, c.name)));
  scrollChatToBottom();
}

function scrollChatToBottom() {
  const box = $('chat-messages');
  box.scrollTop = box.scrollHeight;
}

async function appendTyping() {
  const c = await getChar();
  const row = document.createElement('div');
  row.className = 'msg-row assistant';
  row.id = 'typing-row';
  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.innerHTML = charAvatarHTML(c.avatar, c.name);
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

// ===== 头像图片处理（返回 Blob，交给 store.js 存入 IndexedDB） =====
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
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('图片处理失败'));
        }, 'image/jpeg', 0.85);
      };
      img.onerror = () => reject(new Error('图片读取失败'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}
