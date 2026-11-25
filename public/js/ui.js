// ===== 界面渲染层 =====
// 只负责 DOM 渲染、页面导航、Toast 提示。不读写 localStorage、不发请求。
// 依赖 store.js（读 getChar/getHistory）与 app.js（retryReply 回调）。

const $ = (id) => document.getElementById(id);

const viewStandby = $('view-standby');
const viewHome = $('view-home');
const viewSettings = $('view-settings');
const viewStandbySettings = $('view-standby-settings');
const viewChat = $('view-chat');
const viewMemory = $('view-memory');
const viewCharSettings = $('view-char-settings');

function showView(view) {
  document.querySelectorAll('.app-view').forEach((el) => el.classList.remove('active'));
  view.classList.add('active');
}

// 页面导航：记住来路，返回时回到上一页
const navStack = [];
function navigate(view) {
  const cur = document.querySelector('.app-view.active');
  if (cur && cur !== view) navStack.push(cur);
  showView(view);
}

function navigateBack(fallback) {
  showView(navStack.pop() || fallback || viewStandby);
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 2200);
}

// 状态栏与待机页时间
function updateTime() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const time = hh + ':' + mm;
  const el = document.querySelector('.status-time');
  if (el) el.textContent = time;
  const st = $('standby-time');
  if (st) st.textContent = time;
  const sd = $('standby-date');
  if (sd) {
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    sd.textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + week;
  }
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
        // 最大边 800px，兼顾清晰度和存储空间；JPEG 质量 0.92 保真
        const max = 800;
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
        }, 'image/jpeg', 0.92);
      };
      img.onerror = () => reject(new Error('图片读取失败'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

// ===== 通用图片处理（返回 Blob，交给 store.js 存入 IndexedDB） =====
// keepAlpha 时保留 PNG/WebP 透明通道，供待机立绘使用
function fileToImageBlob(file, { max = 1600, keepAlpha = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) { reject(new Error('请选择图片文件')); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
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
        const png = keepAlpha && /png|webp/i.test(file.type);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('图片处理失败'));
        }, png ? 'image/png' : 'image/jpeg', 0.9);
      };
      img.onerror = () => reject(new Error('图片读取失败'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

// ===== 待机页渲染 =====
function setStandbyBackground(url) {
  const img = $('standby-bg');
  if (!img) return;
  if (url) { img.src = url; img.hidden = false; }
  else { img.removeAttribute('src'); img.hidden = true; }
}

function setStandbyPortrait(url) {
  const img = $('standby-portrait-img');
  const empty = $('standby-portrait-empty');
  if (!img || !empty) return;
  if (url) { img.src = url; img.hidden = false; empty.hidden = true; }
  else { img.removeAttribute('src'); img.hidden = true; empty.hidden = false; }
}

function setStandbyName(name) {
  const el = $('standby-name');
  if (el) el.textContent = name || '';
}

function setStandbySpeechText(text) {
  const box = $('standby-speech');
  const el = $('standby-speech-text');
  if (!box || !el) return;
  if (text) { el.textContent = text; box.hidden = false; }
  else { el.textContent = ''; box.hidden = true; }
}

// 设置页小预览框
function setStandbyMediaPreview(id, url, emptyText) {
  const box = $(id);
  if (!box) return;
  box.innerHTML = '';
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    box.appendChild(img);
  } else {
    box.textContent = emptyText || '';
  }
}

function renderStandbyRoleList(list, activeId) {
  const box = $('standby-role-list');
  if (!box) return;
  box.innerHTML = '';
  (list || []).forEach((c) => {
    const row = document.createElement('div');
    row.className = 'standby-role-item' + (c.id === activeId ? ' active' : '');
    row.dataset.id = c.id;
    row.dataset.act = 'switch';

    const dot = document.createElement('span');
    dot.className = 'standby-role-dot';
    row.appendChild(dot);

    const name = document.createElement('span');
    name.className = 'standby-role-name';
    name.textContent = c.name || '未命名角色';
    row.appendChild(name);

    const actions = document.createElement('span');
    actions.className = 'standby-role-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'memory-link';
    edit.dataset.act = 'edit';
    edit.textContent = '编辑';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'memory-link danger';
    del.dataset.act = 'delete';
    del.textContent = '删除';
    actions.appendChild(edit);
    actions.appendChild(del);
    row.appendChild(actions);

    box.appendChild(row);
  });
}

function renderStandbyLinesList(lines) {
  const box = $('standby-lines-list');
  if (!box) return;
  box.innerHTML = '';
  if (!lines || !lines.length) {
    const empty = document.createElement('div');
    empty.className = 'memory-empty';
    empty.textContent = '还没有台词，点「重新生成」试试。';
    box.appendChild(empty);
    return;
  }
  lines.forEach((text, index) => {
    const row = document.createElement('div');
    row.className = 'standby-line-item';
    const t = document.createElement('span');
    t.className = 'standby-line-text';
    t.textContent = text;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'memory-link';
    btn.dataset.index = String(index);
    btn.textContent = '重 roll';
    row.appendChild(t);
    row.appendChild(btn);
    box.appendChild(row);
  });
}

// ===== 记忆应用渲染 =====
async function renderMemory() {
  const list = $('memory-list');
  list.innerHTML = '';
  const { entries } = await getMemory();
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'memory-empty';
    empty.textContent = '还没有记忆。点「整理」从聊天里总结，或点「添加记忆」手动写一条。';
    list.appendChild(empty);
    return;
  }
  entries.forEach((e) => list.appendChild(memoryEntryRow(e)));
}

function memoryEntryRow(e) {
  const row = document.createElement('div');
  row.className = 'memory-item';

  const head = document.createElement('div');
  head.className = 'memory-item-head';
  const chip = document.createElement('span');
  chip.className = 'memory-chip';
  chip.textContent = MEMORY_CATEGORY_LABELS[e.category] || e.category;
  head.appendChild(chip);

  const actions = document.createElement('span');
  actions.className = 'memory-item-actions';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'memory-link';
  editBtn.textContent = '编辑';
  editBtn.addEventListener('click', () => openMemoryEdit(e.id));
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'memory-link danger';
  delBtn.textContent = '删除';
  delBtn.addEventListener('click', () => deleteMemoryEntryConfirm(e.id));
  actions.appendChild(editBtn);
  actions.appendChild(delBtn);
  head.appendChild(actions);
  row.appendChild(head);

  const text = document.createElement('div');
  text.className = 'memory-item-text';
  text.textContent = e.text;
  row.appendChild(text);

  return row;
}

// 渲染「添加 / 编辑」表单；entry 为空表示新增
function renderMemoryForm(entry) {
  const box = $('memory-form');
  box.innerHTML = '';
  box.hidden = false;

  const title = document.createElement('div');
  title.className = 'memory-form-title';
  title.textContent = entry ? '编辑记忆' : '添加记忆';
  box.appendChild(title);

  const sel = document.createElement('select');
  sel.id = 'memory-category';
  sel.className = 'memory-select';
  Object.keys(MEMORY_CATEGORY_LABELS).forEach((k) => {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = MEMORY_CATEGORY_LABELS[k];
    sel.appendChild(o);
  });
  sel.value = (entry && entry.category) || 'personal';
  box.appendChild(sel);

  const ta = document.createElement('textarea');
  ta.id = 'memory-text';
  ta.className = 'memory-textarea';
  ta.rows = 3;
  ta.placeholder = '一句话记录，例如：用户叫小明，喜欢喝美式咖啡';
  ta.value = (entry && entry.text) || '';
  box.appendChild(ta);

  const btns = document.createElement('div');
  btns.className = 'memory-form-actions';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'fetch-btn';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', saveMemoryForm);
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'fetch-btn';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', cancelMemoryForm);
  btns.appendChild(saveBtn);
  btns.appendChild(cancelBtn);
  box.appendChild(btns);
}
