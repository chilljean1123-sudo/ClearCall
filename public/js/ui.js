// ===== 界面渲染层 =====
// 只负责 DOM 渲染、页面导航、Toast 提示。不读写 localStorage、不发请求。
// 依赖 store.js（读 getChar/getHistory）与 app.js（retryReply 回调）。

const $ = (id) => document.getElementById(id);

const viewHome = $('view-home');
const viewSettings = $('view-settings');
const viewChat = $('view-chat');
const viewMemory = $('view-memory');
const viewWorldbook = $('view-worldbook');
const viewCharacters = $('view-characters');
const viewCallPicker = $('view-call-picker');
const viewCall = $('view-call');
const viewForum = $('view-forum');
const viewChatStyle = $('view-chat-style');
const viewEmail = $('view-email');
const viewBooks = $('view-books');
const viewDiary = $('view-diary');
const viewSchedule = $('view-schedule');
const viewIconManager = $('view-icon-manager');
const viewMoments = $('view-moments');

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

// 状态栏与主屏幕时钟
function updateTime() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const time = hh + ':' + mm;
  document.querySelectorAll('.status-time').forEach((el) => { el.textContent = time; });
  const clock = $('home-clock-time');
  if (clock) clock.textContent = time;
  const date = $('home-clock-date');
  if (date) {
    const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    date.textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + week[d.getDay()];
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

function findSticker(stickers, key) {
  const k = String(key || '').trim();
  if (!k) return null;
  return (stickers || []).find((s) => s.name === k || s.id === k || s.url === k) || null;
}

function miniMapHTML(label) {
  return '<div class="mini-map"><div class="map-pin"></div>' +
    '<div class="mini-map-label">' + escapeHtml(label || '位置') + '</div></div>';
}

function renderUserAttachment(m, ctx) {
  const row = document.createElement('div');
  row.className = 'msg-row user';

  if (m.kind === 'sticker') {
    const s = m.sticker || {};
    if (s.url) {
      const img = document.createElement('img');
      img.className = 'sticker-img';
      img.src = s.url;
      img.alt = s.name || '表情包';
      row.appendChild(img);
    } else {
      const b = document.createElement('div');
      b.className = 'msg-bubble user-bubble';
      b.textContent = m.content;
      row.appendChild(b);
    }
    return row;
  }

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble user-bubble';

  if (m.kind === 'location') {
    const loc = m.location || {};
    bubble.className += ' location-bubble';
    const map = document.createElement('div');
    map.innerHTML = miniMapHTML(loc.name || '位置');
    bubble.appendChild(map.firstChild);
    const info = document.createElement('div');
    info.className = 'location-info';
    const name = document.createElement('div');
    name.className = 'location-name';
    name.textContent = loc.name || '位置';
    info.appendChild(name);
    if (loc.address) {
      const addr = document.createElement('div');
      addr.className = 'location-addr';
      addr.textContent = loc.address;
      info.appendChild(addr);
    }
    bubble.appendChild(info);
  } else if (m.kind === 'image') {
    bubble.className += ' image-bubble';
    const url = m.imageId && ctx.imageUrls ? ctx.imageUrls[m.imageId] : '';
    if (url) {
      const img = document.createElement('img');
      img.className = 'chat-image';
      img.src = url;
      img.alt = m.description || '图片';
      bubble.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'image-placeholder';
      ph.textContent = '图片';
      bubble.appendChild(ph);
    }
    if (m.description) {
      const desc = document.createElement('div');
      desc.className = 'image-desc';
      desc.textContent = m.description;
      bubble.appendChild(desc);
    }
  } else if (m.kind === 'transfer') {
    const tr = m.transfer || {};
    bubble.className += ' transfer-bubble';
    const label = document.createElement('div');
    label.className = 'transfer-label';
    label.textContent = '转账';
    const amount = document.createElement('div');
    amount.className = 'transfer-amount';
    amount.textContent = '¥' + Number(tr.amount || 0).toFixed(2);
    bubble.appendChild(label);
    bubble.appendChild(amount);
    if (tr.note) {
      const note = document.createElement('div');
      note.className = 'transfer-note';
      note.textContent = tr.note;
      bubble.appendChild(note);
    }
  } else if (m.kind === 'forum') {
    const f = m.forum || {};
    bubble.className += ' forum-bubble';
    const card = document.createElement('div');
    card.className = 'chat-forum-card';
    const label = document.createElement('div');
    label.className = 'chat-forum-card-label';
    label.textContent = '论坛帖子';
    const title = document.createElement('div');
    title.className = 'chat-forum-card-title';
    title.textContent = f.title || (f.excerpt || '分享了一个帖子');
    const excerpt = document.createElement('div');
    excerpt.className = 'chat-forum-card-excerpt';
    excerpt.textContent = (f.authorName ? f.authorName + '：' : '') + (f.excerpt || '');
    card.appendChild(label);
    card.appendChild(title);
    card.appendChild(excerpt);
    bubble.appendChild(card);
  } else {
    bubble.textContent = m.content;
  }

  row.appendChild(bubble);
  return row;
}

function appendAssistantBubble(stack, text) {
  const value = String(text || '').trim();
  if (!value) return;
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble assistant-bubble';
  bubble.textContent = value;
  stack.appendChild(bubble);
}

function appendAssistantSticker(stack, sticker) {
  const img = document.createElement('img');
  img.className = 'sticker-img';
  img.src = sticker.url;
  img.alt = sticker.name || '表情包';
  stack.appendChild(img);
}

// 表情包标记可能和正文混在同一回复里，不能按整段文本匹配。
function renderAssistantPart(stack, part, ctx) {
  const source = String(part || '');
  const marker = /\[\[sticker:([^\]\r\n]*)\]\]/gi;
  let cursor = 0;
  let match;
  while ((match = marker.exec(source))) {
    appendAssistantBubble(stack, source.slice(cursor, match.index));
    const sticker = findSticker(ctx && ctx.stickers, match[1]);
    if (sticker) appendAssistantSticker(stack, sticker);
    else appendAssistantBubble(stack, '[表情包]');
    cursor = marker.lastIndex;
  }
  appendAssistantBubble(stack, source.slice(cursor));
}

function renderMessage(m, index, avatar, name, ctx) {
  if (m.role === 'user') {
    if (m.kind && m.kind !== 'text') return renderUserAttachment(m, ctx || {});
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

  if (m.error) return null;

  const parts = splitReplyIntoBubbles(m.content);
  parts.forEach((part) => renderAssistantPart(stack, part, ctx));

  if (ctx && ctx.voiceEnabled && !m.error) {
    const voice = document.createElement('button');
    voice.type = 'button';
    voice.className = ctx.call ? 'call-voice-btn' : 'chat-voice-btn';
    voice.dataset.speakIndex = String(index);
    voice.textContent = ctx.call ? '收听语音' : '播放语音';
    voice.addEventListener('click', () => {
      if (ctx.call) {
        if (typeof speakCallMessage === 'function') speakCallMessage(index);
      } else if (typeof speakChatMessage === 'function') {
        speakChatMessage(index);
      }
    });
    stack.appendChild(voice);
  }

  row.appendChild(stack);
  return row;
}

// 聊天语音按钮状态：idle | loading | playing | failed | blocked
function setChatVoiceButtonState(index, state) {
  const btn = document.querySelector('.chat-voice-btn[data-speak-index="' + index + '"]');
  if (!btn) return;
  btn.classList.remove('is-loading', 'is-playing', 'is-failed', 'is-blocked');
  if (state === 'loading') {
    btn.textContent = '语音加载中…';
    btn.classList.add('is-loading');
  } else if (state === 'playing') {
    btn.textContent = '正在播放…';
    btn.classList.add('is-playing');
  } else if (state === 'failed') {
    btn.textContent = '重试播放';
    btn.classList.add('is-failed');
  } else if (state === 'blocked') {
    btn.textContent = '点按播放';
    btn.classList.add('is-blocked');
  } else {
    btn.textContent = '播放语音';
  }
}

async function renderMessagesInto(boxId, options) {
  const box = $(boxId);
  if (!box) return;
  box.innerHTML = '';
  const history = await getHistory();
  const c = await getChar();
  const stickers = await getStickers();
  const imageUrls = {};
  for (const m of history) {
    if (m && m.imageId) {
      const url = await getFileUrl(m.imageId);
      if (url) imageUrls[m.imageId] = url;
    }
  }
  const limit = (options && options.limit) || 0;
  const start = limit > 0 ? Math.max(0, history.length - limit) : 0;
  if (!history.length && options && options.call) {
    const tip = document.createElement('div');
    tip.className = 'call-empty';
    tip.textContent = '拨通了，说点什么吧';
    box.appendChild(tip);
    return;
  }
  const ctx = {
    stickers,
    imageUrls,
    call: !!(options && options.call),
    voiceEnabled: !!(c.voice && c.voice.enabled),
  };
  for (let i = start; i < history.length; i++) {
    const row = renderMessage(history[i], i, c.avatar, c.name, ctx);
    if (row) box.appendChild(row);
  }
  renderChatErrorNotice(history, !!(options && options.call));
  box.scrollTop = box.scrollHeight;
}

// 请求失败不占聊天气泡，单独以灰底浮层提示，附原因与重试
function renderChatErrorNotice(history, isCall) {
  const view = isCall ? document.getElementById('view-call') : document.getElementById('view-chat');
  if (!view) return;
  let layer = view.querySelector('.chat-notice-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'chat-notice-layer';
    view.appendChild(layer);
  }
  layer.classList.toggle('call', isCall);
  layer.innerHTML = '';
  const last = history[history.length - 1];
  if (!last || !last.error) {
    layer.hidden = true;
    return;
  }
  layer.hidden = false;

  const notice = document.createElement('div');
  notice.className = 'chat-notice';

  const title = document.createElement('div');
  title.className = 'chat-notice-title';
  title.textContent = '回复失败';
  notice.appendChild(title);

  const text = document.createElement('div');
  text.className = 'chat-notice-text';
  text.textContent = String(last.errorReason || '请求没有成功，请稍后重试。');
  notice.appendChild(text);

  const hints = Array.isArray(last.errorHints) ? last.errorHints.filter(Boolean) : [];
  if (hints.length) {
    const hintEl = document.createElement('div');
    hintEl.className = 'chat-notice-hint';
    hintEl.textContent = hints.join(' · ');
    notice.appendChild(hintEl);
  }

  const actions = document.createElement('div');
  actions.className = 'chat-notice-actions';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'chat-notice-btn';
  retry.textContent = '重试';
  retry.addEventListener('click', () => {
    layer.hidden = true;
    retryReply(history.length - 1);
  });
  actions.appendChild(retry);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'chat-notice-btn ghost';
  close.textContent = '收起';
  close.addEventListener('click', () => { layer.hidden = true; });
  actions.appendChild(close);
  notice.appendChild(actions);

  layer.appendChild(notice);
}

async function renderChat() {
  await renderMessagesInto('chat-messages', {});
}

async function renderCallMessages() {
  await renderMessagesInto('call-messages', { limit: 30, call: true });
}

async function appendTypingTo(boxId, rowId) {
  const c = await getChar();
  const row = document.createElement('div');
  row.className = 'msg-row assistant';
  row.id = rowId;
  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.innerHTML = charAvatarHTML(c.avatar, c.name);
  row.appendChild(avatar);
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble assistant-bubble typing-bubble';
  bubble.textContent = '正在回复…';
  row.appendChild(bubble);
  const box = $(boxId);
  if (!box) return;
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
}

async function appendTyping() {
  await appendTypingTo('chat-messages', 'typing-row');
}

async function appendCallTyping() {
  await appendTypingTo('call-messages', 'call-typing-row');
}

function removeTyping() {
  ['typing-row', 'call-typing-row'].forEach((id) => {
    const t = document.getElementById(id);
    if (t) t.remove();
  });
}

// ===== 电话应用 =====
async function renderCallPicker() {
  const box = $('call-picker-list');
  box.innerHTML = '';
  const { list, activeId } = await getCharacters();
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'call-picker-empty';
    empty.textContent = '还没有角色，先去「角色」应用创建一个吧';
    box.appendChild(empty);
    return;
  }

  const rows = await Promise.all(list.map(async (c) => ({ c, avatar: await getAvatarUrlById(c.avatarId) })));
  rows.forEach(({ c, avatar }) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'call-pick-row';

    const av = document.createElement('div');
    av.className = 'call-pick-avatar';
    av.innerHTML = charAvatarHTML(avatar, c.name);
    row.appendChild(av);

    const main = document.createElement('div');
    main.className = 'call-pick-main';
    const name = document.createElement('div');
    name.className = 'call-pick-name';
    name.textContent = (c.name || '未命名角色') + (c.id === activeId ? ' · 当前' : '');
    main.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'call-pick-meta';
    meta.textContent = (c.voice && c.voice.enabled)
      ? '语音已开启 · ' + (c.voice.voiceId || '默认音色')
      : '未绑定语音';
    main.appendChild(meta);
    row.appendChild(main);

    const action = document.createElement('span');
    action.className = 'call-pick-action';
    action.textContent = '拨打';
    row.appendChild(action);

    row.addEventListener('click', () => {
      if (typeof startCall === 'function') startCall(c.id);
    });
    box.appendChild(row);
  });
}

async function updateCallScreen(c) {
  const avatar = await getAvatarUrlById(c.avatarId);
  $('call-name').textContent = c.name || '角色';
  $('call-avatar').innerHTML = charAvatarHTML(avatar, c.name);
  await renderCallMessages();
}

function setCallStatus(text) {
  $('call-status').textContent = text;
}

function formatCallDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return mm + ':' + ss;
}

function setCallTimer(seconds) {
  $('call-timer').textContent = formatCallDuration(seconds);
}

const CALL_VOICE_LABELS = {
  idle: '收听语音',
  loading: '语音生成中…',
  playing: '播放中…',
  blocked: '点按播放',
  failed: '重试语音',
};

function setCallVoiceButtonState(index, state) {
  const btn = document.querySelector('#call-messages .call-voice-btn[data-speak-index="' + index + '"]');
  if (!btn) return;
  btn.classList.toggle('loading', state === 'loading');
  btn.classList.toggle('playing', state === 'playing');
  btn.disabled = state === 'loading';
  btn.textContent = CALL_VOICE_LABELS[state] || CALL_VOICE_LABELS.idle;
}

function resetCallVoiceButtons() {
  document.querySelectorAll('#call-messages .call-voice-btn').forEach((btn) => {
    btn.classList.remove('loading', 'playing');
    btn.disabled = false;
    btn.textContent = CALL_VOICE_LABELS.idle;
  });
}

// ===== 聊天功能抽屉：菜单 + 位置 / 图片 / 表情 / 转账 / 系统指令 =====
const CHAT_TOOL_TITLES = {
  menu: '更多功能',
  location: '发送位置',
  image: '发送图片',
  sticker: '表情包',
  transfer: '转账',
  directive: '系统指令',
  mail: '发邮件',
  style: '聊天方式',
  diary: '日记',
};

function uiEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function toolActionButton(id, text, primary) {
  const b = uiEl('button', 'fetch-btn', text);
  b.type = 'button';
  b.id = id;
  if (primary === false) b.style.opacity = '0.85';
  return b;
}

const CHAT_TOOL_ICON_SVGS = {
  location: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 22s7-6.1 7-13a7 7 0 1 0-14 0c0 6.9 7 13 7 13Z"/><circle cx="12" cy="9" r="2.8" fill="var(--tool-cutout)"/></svg>',
  image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2.8"/><circle cx="8" cy="9" r="1.8" fill="currentColor"/><path d="m5 18 5-5 3 3 2-2 4 4" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sticker: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><circle cx="8" cy="9" r="1.5" fill="var(--tool-cutout)"/><circle cx="16" cy="9" r="1.5" fill="var(--tool-cutout)"/><path d="M7.5 14c1 2 2.5 3 4.5 3s3.5-1 4.5-3" fill="none" stroke="var(--tool-cutout)" stroke-width="2.3" stroke-linecap="round"/></svg>',
  transfer: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 5h12V1l6 6-6 6V9H3V5Zm18 14H9v4l-6-6 6-6v4h12v4Z"/></svg>',
  directive: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="20" height="18" rx="3" fill="currentColor"/><path d="m7 8 4 4-4 4M13 16h4" fill="none" stroke="var(--tool-cutout)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="3" fill="currentColor"/><path d="m4 7 8 6 8-6" fill="none" stroke="var(--tool-cutout)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  style: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="8" cy="6" r="3" fill="var(--tool-cutout)" stroke="currentColor" stroke-width="2.4"/><circle cx="16" cy="12" r="3" fill="var(--tool-cutout)" stroke="currentColor" stroke-width="2.4"/><circle cx="10" cy="18" r="3" fill="var(--tool-cutout)" stroke="currentColor" stroke-width="2.4"/></svg>',
  diary: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 2h15v20H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3Z"/><path d="M7 2v20M10 7h6M10 11h6M10 15h4" fill="none" stroke="var(--tool-cutout)" stroke-width="2.3" stroke-linecap="round"/></svg>',
};

function renderChatToolMenu(body) {
  const grid = uiEl('div', 'tool-grid');
  [
    ['location', '位置'],
    ['image', '图片'],
    ['sticker', '表情包'],
    ['transfer', '转账'],
    ['directive', '系统指令'],
    ['mail', '邮件'],
    ['style', '聊天方式'],
    ['diary', '日记'],
  ].forEach(([tool, label]) => {
    const tile = uiEl('button', 'tool-tile');
    tile.type = 'button';
    tile.dataset.tool = tool;
    const glyph = uiEl('span', 'tool-tile-glyph tool-icon-' + tool);
    glyph.innerHTML = CHAT_TOOL_ICON_SVGS[tool];
    tile.appendChild(glyph);
    tile.appendChild(uiEl('span', '', label));
    grid.appendChild(tile);
  });
  body.appendChild(grid);
  body.appendChild(uiEl('div', 'tool-hint', '位置、图片、表情包、转账、邮件和日记会进入对应页面；聊天方式按当前角色设置口吻；系统指令不会显示，只影响下一轮回复。'));
}

function renderLocationTool(body) {
  const map = uiEl('div', 'mini-map');
  const pin = uiEl('div', 'map-pin');
  const label = uiEl('div', 'mini-map-label', '模拟地图预览');
  label.id = 'tool-loc-preview-label';
  map.appendChild(pin);
  map.appendChild(label);
  body.appendChild(map);

  const presets = uiEl('div', 'tool-presets');
  [
    ['咖啡馆', '梧桐路 18 号 · 一楼'],
    ['公司', '科技园 A 座 12 层'],
    ['学校', '大学城 东门'],
    ['公园', '滨河公园 南门'],
    ['家', '幸福里 3 栋'],
  ].forEach(([name, addr]) => {
    const b = uiEl('button', 'tool-preset', name);
    b.type = 'button';
    b.dataset.locPreset = name;
    b.dataset.locAddress = addr;
    presets.appendChild(b);
  });
  body.appendChild(presets);

  const name = uiEl('input', 'wb-input');
  name.id = 'tool-loc-name';
  name.type = 'text';
  name.placeholder = '地点名称，例如：星巴克（人民路店）';
  body.appendChild(name);

  const addr = uiEl('input', 'wb-input');
  addr.id = 'tool-loc-address';
  addr.type = 'text';
  addr.placeholder = '详细地址（可留空）';
  body.appendChild(addr);

  const actions = uiEl('div', 'tool-actions');
  const real = toolActionButton('btn-tool-loc-real', '使用当前定位');
  const send = toolActionButton('btn-tool-loc-send', '发送位置');
  actions.appendChild(real);
  actions.appendChild(send);
  body.appendChild(actions);
  body.appendChild(uiEl('div', 'tool-hint', '真实定位需要浏览器授权（HTTPS 或 localhost）；未授权时可直接发送上面的虚拟地点。'));
}

function renderImageTool(body) {
  const preview = uiEl('div', 'image-preview', '尚未选择图片');
  preview.id = 'tool-image-preview';
  body.appendChild(preview);

  const actions = uiEl('div', 'tool-actions');
  const pick = toolActionButton('btn-tool-image-pick', '选择相册图片');
  const clear = toolActionButton('btn-tool-image-clear', '清除');
  actions.appendChild(pick);
  actions.appendChild(clear);
  body.appendChild(actions);

  const desc = uiEl('textarea', 'wb-textarea');
  desc.id = 'tool-image-desc';
  desc.rows = 3;
  desc.placeholder = '图片描述，例如：一只趴在窗台上的橘猫';
  body.appendChild(desc);

  const send = toolActionButton('btn-tool-image-send', '发送图片');
  const row = uiEl('div', 'tool-actions');
  row.appendChild(send);
  body.appendChild(row);
  body.appendChild(uiEl('div', 'tool-hint', '相册图片仅在本机预览；AI 读取的是你填写的图片描述。'));
}

async function renderStickerTool(body) {
  const stickers = await getStickers();
  const grid = uiEl('div', 'sticker-grid');
  grid.id = 'sticker-grid';
  if (!stickers.length) {
    grid.appendChild(uiEl('div', 'sticker-empty', '当前角色还没有表情包，先导入一批吧'));
  } else {
    stickers.forEach((s) => {
      const tile = uiEl('div', 'sticker-tile');
      tile.dataset.stickerSend = s.id;
      tile.title = s.name;
      const img = document.createElement('img');
      img.src = s.url;
      img.alt = s.name;
      tile.appendChild(img);
      const del = uiEl('button', 'sticker-del', '×');
      del.type = 'button';
      del.dataset.stickerDel = s.id;
      del.title = '删除';
      tile.appendChild(del);
      grid.appendChild(tile);
    });
  }
  body.appendChild(grid);

  body.appendChild(uiEl('div', 'tool-section-title', '批量导入图片 URL'));
  const ta = uiEl('textarea', 'wb-textarea');
  ta.id = 'sticker-import-text';
  ta.rows = 4;
  ta.placeholder = '每行一个图片 URL，也可以粘贴含图片链接的文本';
  body.appendChild(ta);

  const actions = uiEl('div', 'tool-actions');
  actions.appendChild(toolActionButton('btn-sticker-import-text', '识别并导入'));
  actions.appendChild(toolActionButton('btn-sticker-import-file', '从 txt / docx 导入'));
  body.appendChild(actions);
  body.appendChild(uiEl('div', 'tool-hint', '导入后自动绑定当前角色；角色回复时也可能主动发送这些表情包。'));
}

function renderTransferTool(body) {
  const amount = uiEl('input', 'wb-input');
  amount.id = 'tool-transfer-amount';
  amount.type = 'number';
  amount.min = '0.01';
  amount.step = '0.01';
  amount.placeholder = '金额，例如：52.00';
  body.appendChild(amount);

  const note = uiEl('input', 'wb-input');
  note.id = 'tool-transfer-note';
  note.type = 'text';
  note.placeholder = '转账备注（可留空）';
  body.appendChild(note);

  const row = uiEl('div', 'tool-actions');
  row.appendChild(toolActionButton('btn-tool-transfer-send', '发送转账'));
  body.appendChild(row);
  body.appendChild(uiEl('div', 'tool-hint', '虚拟转账，仅作为聊天内容展示，不产生真实支付。'));
}

async function renderDirectiveTool(body) {
  const current = await getPendingDirective();
  const ta = uiEl('textarea', 'wb-textarea');
  ta.id = 'tool-directive-text';
  ta.rows = 4;
  ta.placeholder = '例如：下一轮回复更冷淡一点，只回一句话，不要主动提问';
  ta.value = current || '';
  body.appendChild(ta);

  const row = uiEl('div', 'tool-actions');
  row.appendChild(toolActionButton('btn-tool-directive-apply', '应用指令'));
  body.appendChild(row);
  body.appendChild(uiEl('div', 'tool-hint', '系统指令会越过角色设定，作为最高优先级要求注入下一轮回复，然后自动清除。'));
}

async function renderMailTool(body) {
  const { list, activeId } = await getCharacters();
  if (!list.length) {
    body.appendChild(uiEl('div', 'tool-hint', '还没有角色。先到角色应用创建一个人设，才能让他给你写信。'));
    return;
  }

  const toField = uiEl('div', 'field');
  toField.appendChild(uiEl('span', 'field-label', '发信角色'));
  const select = uiEl('select');
  select.id = 'tool-mail-character';
  list.forEach((c) => {
    const opt = uiEl('option', '', c.name || '未命名角色');
    opt.value = c.id;
    if (c.id === activeId) opt.selected = true;
    select.appendChild(opt);
  });
  toField.appendChild(select);
  body.appendChild(toField);

  const delayField = uiEl('div', 'field');
  delayField.appendChild(uiEl('span', 'field-label', '定时发送（小时）'));
  const delay = uiEl('input');
  delay.id = 'tool-mail-delay-hours';
  delay.type = 'number';
  delay.min = '1';
  delay.max = '720';
  delay.step = '1';
  delay.value = '24';
  delayField.appendChild(delay);
  body.appendChild(delayField);

  const row = uiEl('div', 'tool-actions');
  row.appendChild(toolActionButton('btn-tool-mail-now', '现在就发一篇'));
  row.appendChild(toolActionButton('btn-tool-mail-schedule', '按定时发送', false));
  body.appendChild(row);
  body.appendChild(uiEl('div', 'tool-hint', '邮件会出现在邮箱应用里，内容按角色人设和记忆来写，约 500-1000 字。定时任务在页面打开时检查并送达。'));
}

async function renderDiaryTool(body) {
  const characterId = await getActiveCharacterId();
  if (!characterId) {
    body.appendChild(uiEl('div', 'tool-hint', '还没有角色。先到角色应用创建一个人设，才能让他写日记。'));
    return;
  }
  const character = await getCharacter(characterId);
  const diary = await getDiary(characterId);
  const name = (character && character.name) || '角色';

  const hero = uiEl('div', 'diary-tool-hero');
  hero.appendChild(uiEl('div', 'diary-tool-hero-title', name + '的日记本'));
  hero.appendChild(uiEl('div', 'diary-tool-hero-note', '在谁的聊天框打开，就写谁的日记。'));
  body.appendChild(hero);

  const toggle = uiEl('label', 'diary-tool-toggle');
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.id = 'tool-diary-enabled';
  enabled.checked = diary.enabled;
  toggle.appendChild(enabled);
  toggle.appendChild(uiEl('span', 'diary-tool-toggle-text', '每天定时写一篇'));
  body.appendChild(toggle);

  const timeField = uiEl('div', 'field');
  timeField.appendChild(uiEl('span', 'field-label', '每天写日记的时间'));
  const time = document.createElement('input');
  time.type = 'time';
  time.id = 'tool-diary-time';
  time.value = diary.time;
  timeField.appendChild(time);
  body.appendChild(timeField);

  const actions = uiEl('div', 'tool-actions');
  actions.appendChild(toolActionButton('btn-tool-diary-now', '现在写一篇'));
  actions.appendChild(toolActionButton('btn-tool-diary-open', '打开日记本', false));
  body.appendChild(actions);

  const saveRow = uiEl('div', 'tool-actions');
  saveRow.appendChild(toolActionButton('btn-tool-diary-save', '保存定时', false));
  body.appendChild(saveRow);
  body.appendChild(uiEl('div', 'tool-hint', '现在写一篇约 500-800 字，写下今天的感想和明日计划；写完会在小手机上弹出通知，并记入角色记忆。定时任务在页面打开或回到前台时检查。'));
}

async function renderChatSheet(view) {
  const key = CHAT_TOOL_TITLES[view] ? view : 'menu';
  $('chat-sheet-title').textContent = CHAT_TOOL_TITLES[key];
  const body = $('chat-sheet-body');
  body.innerHTML = '';
  if (key === 'location') renderLocationTool(body);
  else if (key === 'image') renderImageTool(body);
  else if (key === 'sticker') await renderStickerTool(body);
  else if (key === 'transfer') renderTransferTool(body);
  else if (key === 'directive') await renderDirectiveTool(body);
  else if (key === 'mail') await renderMailTool(body);
  else if (key === 'diary') await renderDiaryTool(body);
  else renderChatToolMenu(body);
}

// ===== 聊天方式（按角色） =====
function renderChatStylePage(character) {
  const name = (character && character.name) || '角色';
  $('chat-style-title').textContent = name + '的聊天方式';
  $('chat-style-hero-note').textContent = '只影响「' + name + '」的聊天，下一轮回复开始生效。';
  const grid = $('chat-style-grid');
  grid.innerHTML = '';
  const selected = new Set((character && character.chatStyle && character.chatStyle.options) || []);
  CHAT_STYLE_OPTIONS.forEach((opt) => {
    const card = document.createElement('label');
    card.className = 'chat-style-card';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = opt.id;
    input.checked = selected.has(opt.id);
    input.dataset.group = opt.group || '';
    if (input.checked) card.classList.add('selected');
    const text = uiEl('span', 'chat-style-card-text');
    text.appendChild(uiEl('span', 'chat-style-card-title', opt.title));
    text.appendChild(uiEl('span', 'chat-style-card-desc', opt.desc));
    card.appendChild(input);
    card.appendChild(text);
    grid.appendChild(card);
  });
  updateChatStylePreview();
}

function collectChatStyleOptions() {
  return Array.from(document.querySelectorAll('#chat-style-grid input[type="checkbox"]:checked'))
    .map((input) => input.value);
}

function updateChatStylePreview() {
  const prompt = buildChatStylePrompt({ options: collectChatStyleOptions() });
  $('chat-style-preview').textContent = prompt || '未选择时不会额外注入，角色按原人设说话。';
}

// ===== 日记（iOS 备忘录风格） =====
function diaryEntryDateText(entry) {
  const raw = (entry && entry.date) || '';
  const d = new Date(raw + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return raw;
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + week[d.getDay()];
}

function diaryNoteCard(entry) {
  const card = uiEl('article', 'diary-note');
  const head = uiEl('div', 'diary-note-head');
  head.appendChild(uiEl('span', 'diary-note-date', diaryEntryDateText(entry)));
  if (entry.mood) head.appendChild(uiEl('span', 'diary-note-mood', entry.mood));
  card.appendChild(head);

  card.appendChild(uiEl('h2', 'diary-note-title', entry.title || '没有标题的一天'));
  if (entry.body) card.appendChild(uiEl('div', 'diary-note-text', entry.body));

  if (entry.todos && entry.todos.length) {
    const section = uiEl('div', 'diary-todo-section');
    const sectionHead = uiEl('div', 'diary-todo-head');
    sectionHead.appendChild(uiEl('span', 'diary-todo-head-icon'));
    sectionHead.appendChild(uiEl('span', '', '明日计划'));
    section.appendChild(sectionHead);
    entry.todos.forEach((todo) => {
      const row = uiEl('label', 'diary-todo' + (todo.done ? ' done' : ''));
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!todo.done;
      input.dataset.diaryTodo = todo.id;
      input.dataset.diaryEntry = entry.id;
      row.appendChild(input);
      row.appendChild(uiEl('span', 'diary-todo-text', todo.text));
      section.appendChild(row);
    });
    card.appendChild(section);
  }

  const foot = uiEl('div', 'diary-note-foot');
  const del = uiEl('button', 'diary-note-del', '删除');
  del.type = 'button';
  del.dataset.diaryDel = entry.id;
  foot.appendChild(del);
  card.appendChild(foot);
  return card;
}

function renderDiaryPage(character, diary) {
  const name = (character && character.name) || '角色';
  $('diary-title').textContent = name + '的日记';
  const body = $('diary-body');
  body.innerHTML = '';
  if (!diary || !diary.entries.length) {
    const empty = uiEl('div', 'diary-empty');
    empty.appendChild(uiEl('div', 'diary-empty-title', '还没有日记'));
    empty.appendChild(uiEl('div', 'diary-empty-text', '让 ' + name + ' 现在写一篇，这里就会多一页备忘录。'));
    body.appendChild(empty);
    return;
  }
  diary.entries.forEach((entry) => body.appendChild(diaryNoteCard(entry)));
}

// ===== 日程 =====
function scheduleNowClock() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function renderSchedulePage(character, schedule) {
  const name = (character && character.name) || '角色';
  $('schedule-title').textContent = name + '的日程';
  const body = $('schedule-body');
  if (!body) return;
  body.innerHTML = '';

  const now = new Date();
  const todayKey = diaryDateKey(now);
  const weekNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  const hero = uiEl('div', 'schedule-today');
  const heroMain = uiEl('div', 'schedule-today-main');
  heroMain.appendChild(uiEl('div', 'schedule-today-day', String(now.getDate())));
  const heroMeta = uiEl('div', 'schedule-today-meta');
  heroMeta.appendChild(uiEl('div', 'schedule-today-week', weekNames[now.getDay()] + ' · 今天'));
  heroMeta.appendChild(uiEl('div', 'schedule-today-month', now.getFullYear() + ' 年 ' + (now.getMonth() + 1) + ' 月'));
  heroMain.appendChild(heroMeta);
  hero.appendChild(heroMain);
  hero.appendChild(uiEl('div', 'schedule-today-char', name));
  body.appendChild(hero);

  // 真实日历月视图
  const cal = uiEl('div', 'schedule-cal');
  cal.appendChild(uiEl('div', 'schedule-cal-title', now.getFullYear() + ' 年 ' + (now.getMonth() + 1) + ' 月'));
  const week = uiEl('div', 'schedule-cal-week');
  ['日', '一', '二', '三', '四', '五', '六'].forEach((w) => week.appendChild(uiEl('span', '', w)));
  cal.appendChild(week);
  const grid = uiEl('div', 'schedule-cal-grid');
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const prevMonthDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  for (let i = firstDay - 1; i >= 0; i -= 1) {
    grid.appendChild(uiEl('div', 'schedule-cal-day muted', String(prevMonthDays - i)));
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    grid.appendChild(uiEl('div', 'schedule-cal-day' + (d === now.getDate() ? ' today' : ''), String(d)));
  }
  cal.appendChild(grid);
  body.appendChild(cal);

  const agenda = uiEl('div', 'schedule-agenda');
  const agendaHead = uiEl('div', 'schedule-agenda-head');
  agendaHead.appendChild(uiEl('div', 'schedule-agenda-title', '今日安排'));
  const items = (schedule && schedule.date === todayKey) ? (schedule.items || []) : [];
  agendaHead.appendChild(uiEl('div', 'schedule-agenda-note', items.length ? '共 ' + items.length + ' 项' : '待生成'));
  agenda.appendChild(agendaHead);

  if (!items.length) {
    agenda.appendChild(uiEl('div', 'schedule-empty', '今天还没有日程。点右上角「刷新」，让 ' + name + ' 按人设和世界书安排今天。'));
  } else {
    const clock = scheduleNowClock();
    items.forEach((item) => {
      const isNow = clock >= item.start && clock < item.end;
      const row = uiEl('div', 'schedule-item' + (isNow ? ' now' : ''));
      const time = uiEl('div', 'schedule-item-time');
      time.appendChild(uiEl('span', 'schedule-item-time-start', item.start));
      time.appendChild(uiEl('span', 'schedule-item-time-end', item.end));
      row.appendChild(time);
      const main = uiEl('div', 'schedule-item-body');
      const title = uiEl('div', 'schedule-item-title');
      title.appendChild(document.createTextNode(item.title));
      if (isNow) title.appendChild(uiEl('span', 'schedule-item-now-tag', '进行中'));
      main.appendChild(title);
      const meta = [item.place, item.note].filter(Boolean).join(' · ');
      if (meta) main.appendChild(uiEl('div', 'schedule-item-meta', meta));
      row.appendChild(main);
      agenda.appendChild(row);
    });
  }

  // 定时刷新设置（按角色保存）
  const cfg = schedule || {};
  const settings = uiEl('details', 'drawer schedule-settings');
  const head = uiEl('summary', 'drawer-head');
  head.appendChild(uiEl('span', 'drawer-title', '定时刷新'));
  head.appendChild(uiEl('span', 'drawer-arrow'));
  settings.appendChild(head);
  const settingsBody = uiEl('div', 'drawer-body');
  const autoRow = uiEl('label', 'schedule-settings-row');
  autoRow.appendChild(uiEl('span', '', '每天自动刷新'));
  const autoInput = document.createElement('input');
  autoInput.type = 'checkbox';
  autoInput.id = 'schedule-auto-enabled';
  autoInput.checked = !!cfg.enabled;
  autoRow.appendChild(autoInput);
  settingsBody.appendChild(autoRow);
  const timeField = uiEl('label', 'field');
  timeField.appendChild(uiEl('span', 'field-label', '刷新时间'));
  const timeInput = document.createElement('input');
  timeInput.type = 'time';
  timeInput.id = 'input-schedule-time';
  timeInput.value = cfg.time || '07:00';
  timeField.appendChild(timeInput);
  settingsBody.appendChild(timeField);
  const saveBtn = uiEl('button', 'fetch-btn', '保存设置');
  saveBtn.type = 'button';
  saveBtn.id = 'btn-schedule-save';
  settingsBody.appendChild(saveBtn);
  settingsBody.appendChild(uiEl('p', 'schedule-hint', '到点后会参考人设、世界书和记忆重新生成本日日程，并把角色当前时段在做什么带进聊天。'));
  settings.appendChild(settingsBody);
  agenda.appendChild(settings);
  body.appendChild(agenda);
}

// 小手机内的通知横幅（写日记等应用完成时提示）
let phoneNoticeTimer = null;

function showPhoneNotice(options) {
  const box = $('phone-notice');
  if (!box) return;
  const opt = options || {};
  $('phone-notice-title').textContent = opt.title || '通知';
  $('phone-notice-text').textContent = opt.text || '';
  box.dataset.characterId = opt.characterId || '';
  box.dataset.target = opt.target || '';
  box.hidden = false;
  box.classList.remove('show');
  void box.offsetWidth;
  box.classList.add('show');
  clearTimeout(phoneNoticeTimer);
  phoneNoticeTimer = setTimeout(() => { box.hidden = true; }, 5200);
}

function hidePhoneNotice() {
  const box = $('phone-notice');
  if (!box) return;
  clearTimeout(phoneNoticeTimer);
  box.hidden = true;
}

function updateToolLocationPreview(name) {
  const label = $('tool-loc-preview-label');
  if (label) label.textContent = name || '模拟地图预览';
}

function setToolImagePreview(url) {
  const box = $('tool-image-preview');
  if (!box) return;
  box.innerHTML = '';
  if (!url) { box.textContent = '尚未选择图片'; return; }
  const img = document.createElement('img');
  img.src = url;
  img.alt = '待发送图片';
  box.appendChild(img);
}

// ===== 角色应用渲染 =====
async function renderCharactersUI() {
  const { list, activeId } = await getCharacters();
  const rows = await Promise.all(list.map(async (c) => ({
    ...c,
    avatar: await getAvatarUrlById(c.avatarId),
    personaImage: await getCharacterPersonaImageUrl(c.id),
  })));
  renderCharacterList(rows, activeId);
}

function renderCharacterList(characters, activeId) {
  const box = $('character-list');
  box.innerHTML = '';
  box.classList.add('char-card-row');
  if (!characters.length) {
    const empty = document.createElement('div');
    empty.className = 'memory-empty';
    empty.textContent = '还没有联系人。点「新建联系人」创建人设；聊天和记忆会按联系人分开保存。';
    box.appendChild(empty);
    return;
  }
  characters.forEach((c) => box.appendChild(characterCard(c, c.id === activeId)));
}

// 卡包卡片：正面只放名字和虚化人设图，点击进入大图，再次点击 3D 翻到设定背面
function characterCard(c, isActive) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'char-card' + (isActive ? ' active' : '');
  card.dataset.characterId = c.id;

  const media = c.personaImage || c.avatar;
  const bg = document.createElement('span');
  bg.className = 'char-card-bg';
  if (media) {
    const img = document.createElement('img');
    img.src = media;
    img.alt = '';
    bg.appendChild(img);
  } else {
    bg.classList.add('char-card-bg-fallback');
    bg.innerHTML = charAvatarHTML('', c.name);
  }
  card.appendChild(bg);

  const name = document.createElement('span');
  name.className = 'char-card-name';
  name.textContent = c.name || '未命名角色';
  card.appendChild(name);

  if (isActive) {
    const chip = document.createElement('span');
    chip.className = 'char-card-chip';
    chip.textContent = '当前';
    card.appendChild(chip);
  }

  card.addEventListener('click', () => openCharacterCardViewer(c, { isActive }));
  return card;
}

function ensureCharacterCardViewer() {
  let viewer = document.getElementById('char-card-viewer');
  if (viewer) return viewer;

  viewer = document.createElement('div');
  viewer.className = 'char-card-viewer';
  viewer.id = 'char-card-viewer';
  viewer.hidden = true;
  viewer.innerHTML = [
    '<div class="char-card-stage">',
    '  <div class="char-card-flip" id="char-card-flip">',
    '    <div class="char-card-face char-card-face-front" id="char-card-face-front">',
    '      <img class="char-card-full" id="char-card-full" alt="" />',
    '      <div class="char-card-full-fallback" id="char-card-full-fallback" hidden></div>',
    '      <div class="char-card-full-shade"></div>',
    '      <div class="char-card-full-name" id="char-card-full-name"></div>',
    '      <div class="char-card-full-hint">轻点卡片查看设定</div>',
    '    </div>',
    '    <div class="char-card-face char-card-face-back">',
    '      <div class="char-card-back-head">',
    '        <div class="char-card-back-name" id="char-card-back-name"></div>',
    '        <div class="char-card-back-remark" id="char-card-back-remark" hidden></div>',
    '      </div>',
    '      <div class="char-card-back-body" id="char-card-back-body"></div>',
    '      <div class="char-card-back-actions" id="char-card-back-actions"></div>',
    '    </div>',
    '  </div>',
    '  <button type="button" class="char-card-close" id="char-card-close" aria-label="关闭">',
    '    <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.4 5 5 6.4l5.6 5.6L5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6 6.4 5Z"/></svg>',
    '  </button>',
    '  <div class="char-card-viewer-tip">再点一次卡片翻到背面</div>',
    '</div>',
  ].join('');
  document.body.appendChild(viewer);

  viewer.addEventListener('click', (e) => {
    if (e.target === viewer) closeCharacterCardViewer();
  });
  document.getElementById('char-card-close').addEventListener('click', closeCharacterCardViewer);
  document.getElementById('char-card-flip').addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    const flip = document.getElementById('char-card-flip');
    flip.classList.toggle('flipped');
  });
  return viewer;
}

function openCharacterCardViewer(c, opts) {
  const viewer = ensureCharacterCardViewer();
  const image = c.personaImage || c.avatar || '';
  const full = document.getElementById('char-card-full');
  const fallback = document.getElementById('char-card-full-fallback');
  if (image) {
    full.src = image;
    full.hidden = false;
    fallback.hidden = true;
  } else {
    full.hidden = true;
    full.removeAttribute('src');
    fallback.hidden = false;
    fallback.innerHTML = charAvatarHTML('', c.name);
  }
  document.getElementById('char-card-full-name').textContent = c.name || '未命名角色';

  const remark = String(c.remark || '').trim();
  const remarkEl = document.getElementById('char-card-back-remark');
  remarkEl.textContent = remark ? '备注：' + remark : '';
  remarkEl.hidden = !remark;
  document.getElementById('char-card-back-name').textContent = c.name || '未命名角色';

  const body = document.getElementById('char-card-back-body');
  body.innerHTML = '';
  const persona = document.createElement('p');
  persona.className = 'char-card-persona';
  persona.textContent = String(c.persona || '').trim() || '还没有填写人设。';
  body.appendChild(persona);

  const meta = document.createElement('div');
  meta.className = 'char-card-meta';
  const chips = [];
  if (opts && opts.isActive) chips.push('当前聊天角色');
  if (c.voice && c.voice.enabled) chips.push('语音已开启');
  if (c.image && c.image.enabled) chips.push('外观生图已开启');
  chips.forEach((text) => {
    const chip = document.createElement('span');
    chip.className = 'char-card-meta-chip';
    chip.textContent = text;
    meta.appendChild(chip);
  });
  if (chips.length) body.appendChild(meta);

  const actions = document.getElementById('char-card-back-actions');
  actions.innerHTML = '';
  if (!(opts && opts.isActive)) {
    const useBtn = document.createElement('button');
    useBtn.type = 'button';
    useBtn.className = 'fetch-btn';
    useBtn.textContent = '设为当前角色';
    useBtn.addEventListener('click', async () => {
      const id = c.id;
      closeCharacterCardViewer();
      if (typeof switchActiveCharacter === 'function') await switchActiveCharacter(id);
    });
    actions.appendChild(useBtn);
  }
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'fetch-btn';
  editBtn.textContent = '编辑资料';
  editBtn.addEventListener('click', () => {
    closeCharacterCardViewer();
    if (typeof openCharacterEdit === 'function') openCharacterEdit(c.id);
  });
  actions.appendChild(editBtn);

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'fetch-btn fetch-btn-ghost';
  delBtn.textContent = '删除';
  delBtn.addEventListener('click', () => {
    closeCharacterCardViewer();
    if (typeof deleteCharacterConfirm === 'function') deleteCharacterConfirm(c.id);
  });
  actions.appendChild(delBtn);

  const flip = document.getElementById('char-card-flip');
  flip.classList.remove('flipped');
  viewer.hidden = false;
  viewer.classList.add('open');
}

function closeCharacterCardViewer() {
  const viewer = document.getElementById('char-card-viewer');
  if (!viewer) return;
  viewer.classList.remove('open');
  viewer.hidden = true;
  const flip = document.getElementById('char-card-flip');
  if (flip) flip.classList.remove('flipped');
}

// 表单里的抽屉：标题行常驻，内容点击才展开
function formDrawer(title) {
  const d = document.createElement('details');
  d.className = 'drawer drawer-form';
  const head = document.createElement('summary');
  head.className = 'drawer-head';
  const t = document.createElement('span');
  t.className = 'drawer-title';
  t.textContent = title;
  const arrow = document.createElement('span');
  arrow.className = 'drawer-arrow';
  head.appendChild(t);
  head.appendChild(arrow);
  d.appendChild(head);
  const body = document.createElement('div');
  body.className = 'drawer-body';
  d.appendChild(body);
  return { root: d, body };
}

// 渲染「新建 / 编辑角色」表单；character 为空表示新增
function renderCharacterForm(character, avatarUrl, refImageUrl, personaUrl) {
  const box = $('character-form');
  box.innerHTML = '';
  box.hidden = false;

  const voice = (character && character.voice) || { enabled: false, voiceId: '', model: '' };
  const image = (character && character.image) || { enabled: false, prompt: '', referenceImageId: null };

  const title = document.createElement('div');
  title.className = 'memory-form-title';
  title.textContent = character ? '编辑联系人' : '新建联系人';
  box.appendChild(title);

  const name = document.createElement('input');
  name.id = 'char-name-input';
  name.className = 'wb-input';
  name.type = 'text';
  name.placeholder = '联系人名字，例如：小助手';
  name.value = (character && character.name) || '';
  box.appendChild(name);

  const remark = document.createElement('input');
  remark.id = 'char-remark-input';
  remark.className = 'wb-input';
  remark.type = 'text';
  remark.placeholder = '备注（可选），例如：老板 / 阿罗';
  remark.value = (character && character.remark) || '';
  box.appendChild(remark);

  const avatarRow = document.createElement('div');
  avatarRow.className = 'avatar-row';
  const preview = document.createElement('span');
  preview.className = 'avatar-preview';
  preview.id = 'char-avatar-preview';
  preview.innerHTML = charAvatarHTML(avatarUrl || '', (character && character.name) || '');
  avatarRow.appendChild(preview);

  const uploadBtn = document.createElement('button');
  uploadBtn.type = 'button';
  uploadBtn.className = 'fetch-btn';
  uploadBtn.textContent = '上传头像';
  uploadBtn.addEventListener('click', () => $('file-char-avatar').click());
  avatarRow.appendChild(uploadBtn);

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'fetch-btn';
  clearBtn.textContent = '清除';
  clearBtn.addEventListener('click', clearCharacterAvatarForm);
  avatarRow.appendChild(clearBtn);
  box.appendChild(avatarRow);

  // 人设大图：卡包卡片背景与看图模式优先使用，未上传时自动回退头像
  const personaRow = document.createElement('div');
  personaRow.className = 'avatar-row';
  const personaPreview = document.createElement('span');
  personaPreview.className = 'ref-preview persona-preview';
  personaPreview.id = 'char-persona-preview';
  personaPreview.innerHTML = personaUrl
    ? '<img class="msg-avatar-img" src="' + personaUrl + '" alt="" />'
    : '<span>无</span>';
  personaRow.appendChild(personaPreview);

  const personaUpload = document.createElement('button');
  personaUpload.type = 'button';
  personaUpload.className = 'fetch-btn';
  personaUpload.textContent = '上传人设大图';
  personaUpload.addEventListener('click', () => $('file-char-persona').click());
  personaRow.appendChild(personaUpload);

  const personaClear = document.createElement('button');
  personaClear.type = 'button';
  personaClear.className = 'fetch-btn';
  personaClear.textContent = '清除';
  personaClear.addEventListener('click', clearCharacterPersonaForm);
  personaRow.appendChild(personaClear);
  box.appendChild(personaRow);

  name.addEventListener('input', () => {
    if (!preview.querySelector('img')) preview.innerHTML = charAvatarHTML('', name.value);
  });

  const persona = document.createElement('textarea');
  persona.id = 'char-persona-input';
  persona.className = 'wb-textarea';
  persona.rows = 5;
  persona.placeholder = '角色人设，例如：你是一个温柔耐心的助手，用中文回复…';
  persona.value = (character && character.persona) || '';
  box.appendChild(persona);

  // 语音绑定抽屉
  const voiceDrawer = formDrawer('语音绑定' + (voice.enabled ? '（已启用）' : ''));
  const voiceEnabled = document.createElement('label');
  voiceEnabled.className = 'wb-check';
  const voiceChk = document.createElement('input');
  voiceChk.type = 'checkbox';
  voiceChk.id = 'char-voice-enabled';
  voiceChk.checked = !!voice.enabled;
  const voiceChkText = document.createElement('span');
  voiceChkText.textContent = '为此角色启用语音';
  voiceEnabled.appendChild(voiceChk);
  voiceEnabled.appendChild(voiceChkText);
  voiceDrawer.body.appendChild(voiceEnabled);

  const voiceId = document.createElement('input');
  voiceId.id = 'char-voice-id';
  voiceId.className = 'wb-input';
  voiceId.type = 'text';
  voiceId.placeholder = '音色 / Voice ID，留空用设置里的默认音色';
  voiceId.value = voice.voiceId || '';
  voiceDrawer.body.appendChild(voiceId);

  const voiceModel = document.createElement('input');
  voiceModel.id = 'char-voice-model';
  voiceModel.className = 'wb-input';
  voiceModel.type = 'text';
  voiceModel.placeholder = '语音模型，留空用设置里的默认模型';
  voiceModel.value = voice.model || '';
  voiceDrawer.body.appendChild(voiceModel);

  const voiceHint = document.createElement('span');
  voiceHint.className = 'field-hint';
  voiceHint.textContent = '接口地址与 Key 在「设置 → 语音服务」里配置。';
  voiceDrawer.body.appendChild(voiceHint);
  box.appendChild(voiceDrawer.root);

  // 生图绑定抽屉
  const imageDrawer = formDrawer('生图绑定' + (image.enabled ? '（已启用）' : ''));
  const imageEnabled = document.createElement('label');
  imageEnabled.className = 'wb-check';
  const imageChk = document.createElement('input');
  imageChk.type = 'checkbox';
  imageChk.id = 'char-image-enabled';
  imageChk.checked = !!image.enabled;
  const imageChkText = document.createElement('span');
  imageChkText.textContent = '为此角色启用外观生图';
  imageEnabled.appendChild(imageChk);
  imageEnabled.appendChild(imageChkText);
  imageDrawer.body.appendChild(imageEnabled);

  const prompt = document.createElement('textarea');
  prompt.id = 'char-image-prompt';
  prompt.className = 'wb-textarea';
  prompt.rows = 3;
  prompt.placeholder = '外观提示词，例如：银色长发、红色眼睛、黑色风衣…';
  prompt.value = image.prompt || '';
  imageDrawer.body.appendChild(prompt);

  const refRow = document.createElement('div');
  refRow.className = 'avatar-row';
  const refPreview = document.createElement('span');
  refPreview.className = 'ref-preview';
  refPreview.id = 'char-ref-preview';
  refPreview.innerHTML = refImageUrl
    ? '<img class="msg-avatar-img" src="' + refImageUrl + '" alt="" />'
    : '<span>无</span>';
  refRow.appendChild(refPreview);

  const refUpload = document.createElement('button');
  refUpload.type = 'button';
  refUpload.className = 'fetch-btn';
  refUpload.textContent = '上传参考图';
  refUpload.addEventListener('click', () => $('file-char-ref').click());
  refRow.appendChild(refUpload);

  const refClear = document.createElement('button');
  refClear.type = 'button';
  refClear.className = 'fetch-btn';
  refClear.textContent = '清除';
  refClear.addEventListener('click', clearCharacterRefImageForm);
  refRow.appendChild(refClear);
  imageDrawer.body.appendChild(refRow);

  const imageHint = document.createElement('span');
  imageHint.className = 'field-hint';
  imageHint.textContent = '外观提示词和参考图会随角色保存；接口地址与 Key 在「设置 → 生图服务」里配置。';
  imageDrawer.body.appendChild(imageHint);
  box.appendChild(imageDrawer.root);

  const btns = document.createElement('div');
  btns.className = 'wb-form-actions';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'fetch-btn';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', saveCharacterForm);
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'fetch-btn';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', cancelCharacterForm);
  btns.appendChild(saveBtn);
  btns.appendChild(cancelBtn);
  box.appendChild(btns);

  // ---- 轻量卡片式重排：只调整层级与分组，保留全部字段、ID 与事件 ----
  const pane = document.querySelector('.characters-body');
  if (pane) pane.classList.add('char-form-open');

  title.className = 'char-sheet-title';
  const headWrap = document.createElement('div');
  headWrap.className = 'char-sheet-head';
  const sub = document.createElement('div');
  sub.className = 'char-sheet-sub';
  sub.textContent = character ? '修改后保存即可生效' : '填写角色档案，保存后开始聊天';
  box.insertBefore(headWrap, title);
  headWrap.appendChild(title);
  headWrap.appendChild(sub);

  const mainCard = document.createElement('div');
  mainCard.className = 'char-form-card';
  box.insertBefore(mainCard, name);

  const cardHead = document.createElement('div');
  cardHead.className = 'char-form-card-head';
  const cardTitle = document.createElement('div');
  cardTitle.className = 'char-form-card-title';
  cardTitle.textContent = '角色档案';
  const cardSub = document.createElement('div');
  cardSub.className = 'char-form-card-sub';
  cardSub.textContent = '头像、人设大图与基础资料';
  cardHead.appendChild(cardTitle);
  cardHead.appendChild(cardSub);
  mainCard.appendChild(cardHead);

  const photoRow = document.createElement('div');
  photoRow.className = 'char-photo-row';
  mainCard.appendChild(photoRow);

  const avatarLabel = document.createElement('div');
  avatarLabel.className = 'char-photo-label';
  avatarLabel.textContent = '角色头像';
  avatarRow.insertBefore(avatarLabel, preview);
  avatarRow.className = 'char-photo-card';
  uploadBtn.className = 'char-photo-btn';
  clearBtn.className = 'char-photo-btn ghost';
  photoRow.appendChild(avatarRow);

  const personaLabel = document.createElement('div');
  personaLabel.className = 'char-photo-label';
  personaLabel.textContent = '人设大图';
  personaRow.insertBefore(personaLabel, personaPreview);
  personaRow.className = 'char-photo-card';
  personaUpload.className = 'char-photo-btn';
  personaClear.className = 'char-photo-btn ghost';
  photoRow.appendChild(personaRow);

  const fields = document.createElement('div');
  fields.className = 'char-form-fields';
  const wrapField = (control, labelText) => {
    const fieldEl = document.createElement('div');
    fieldEl.className = 'char-field';
    const labelEl = document.createElement('div');
    labelEl.className = 'char-field-label';
    labelEl.textContent = labelText;
    fieldEl.appendChild(labelEl);
    fieldEl.appendChild(control);
    fields.appendChild(fieldEl);
  };
  wrapField(name, '角色名');
  wrapField(remark, '备注');
  wrapField(persona, '人设');
  mainCard.appendChild(fields);

  const voiceCard = document.createElement('div');
  voiceCard.className = 'char-bind-card';
  box.insertBefore(voiceCard, voiceDrawer.root);
  voiceCard.appendChild(voiceDrawer.root);

  const imageCard = document.createElement('div');
  imageCard.className = 'char-bind-card';
  box.insertBefore(imageCard, imageDrawer.root);
  imageCard.appendChild(imageDrawer.root);

  btns.className = 'char-form-actions';
  saveBtn.className = 'char-primary-btn';
  cancelBtn.className = 'char-ghost-btn';
  btns.innerHTML = '';
  btns.appendChild(cancelBtn);
  btns.appendChild(saveBtn);
  box.classList.add('char-sheet');
  if (box.scrollIntoView) box.scrollIntoView({ block: 'start' });
}

// ===== 通讯录：我的主页（用户人设，可多套） =====
function renderUserProfileList(profiles, activeId) {
  const box = $('user-profile-list');
  box.innerHTML = '';
  if (!profiles.length) {
    const empty = document.createElement('div');
    empty.className = 'memory-empty';
    empty.textContent = '还没有人设。点「新建人设」写下你的名字和自我介绍，聊天时会作为「我」注入。';
    box.appendChild(empty);
    return;
  }
  profiles.forEach((p) => {
    const isActive = p.id === activeId;
    const row = document.createElement('div');
    row.className = 'char-item' + (isActive ? ' active' : '');
    row.addEventListener('click', () => switchActiveUserProfile(p.id));

    const avatar = document.createElement('div');
    avatar.className = 'char-avatar';
    avatar.innerHTML = charAvatarHTML('', p.name || '我');
    row.appendChild(avatar);

    const info = document.createElement('div');
    info.className = 'char-info';

    const nameRow = document.createElement('div');
    nameRow.className = 'char-name-row';
    const name = document.createElement('div');
    name.className = 'char-name';
    name.textContent = p.name || '未命名人设';
    nameRow.appendChild(name);
    if (isActive) {
      const chip = document.createElement('span');
      chip.className = 'char-active-chip';
      chip.textContent = '当前';
      nameRow.appendChild(chip);
    }
    info.appendChild(nameRow);

    const persona = document.createElement('div');
    persona.className = 'char-persona';
    persona.textContent = String(p.persona || '').trim() || '未填写人设';
    info.appendChild(persona);

    const actions = document.createElement('div');
    actions.className = 'char-actions';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'memory-link';
    editBtn.textContent = '编辑';
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); openUserProfileEdit(p.id); });
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'memory-link danger';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteUserProfileConfirm(p.id); });
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    info.appendChild(actions);

    row.appendChild(info);
    box.appendChild(row);
  });
}

// 渲染「新建 / 编辑我的人设」表单；profile 为空表示新增
function renderUserProfileForm(profile) {
  const box = $('user-profile-form');
  box.innerHTML = '';
  box.hidden = false;

  const title = document.createElement('div');
  title.className = 'memory-form-title';
  title.textContent = profile ? '编辑人设' : '新建人设';
  box.appendChild(title);

  const name = document.createElement('input');
  name.id = 'user-profile-name-input';
  name.className = 'wb-input';
  name.type = 'text';
  name.placeholder = '你的名字，聊天里的称呼';
  name.value = (profile && profile.name) || '';
  box.appendChild(name);

  const persona = document.createElement('textarea');
  persona.id = 'user-profile-persona-input';
  persona.className = 'wb-textarea';
  persona.rows = 6;
  persona.placeholder = '关于你：身份、性格、习惯、和联系人的关系…例如：25 岁设计师，话不多但很会接梗。';
  persona.value = (profile && profile.persona) || '';
  box.appendChild(persona);

  const btns = document.createElement('div');
  btns.className = 'wb-form-actions';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'fetch-btn';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', saveUserProfileForm);
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'fetch-btn';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', cancelUserProfileForm);
  btns.appendChild(saveBtn);
  btns.appendChild(cancelBtn);
  box.appendChild(btns);
}

// 聊天室切换角色过场：头像 + 名字 + 备注，结束后再切窗口
let charSwitchTimer = null;
function playCharacterSwitchAnimation(character, avatarUrl) {
  const overlay = $('char-switch-overlay');
  if (!overlay) return Promise.resolve();
  if (charSwitchTimer) { clearTimeout(charSwitchTimer); charSwitchTimer = null; }

  const avatar = $('char-switch-avatar');
  const name = $('char-switch-name');
  const remark = $('char-switch-remark');
  if (avatar) avatar.innerHTML = charAvatarHTML(avatarUrl || '', character && character.name);
  if (name) name.textContent = (character && character.name) || '联系人';

  const note = character ? String(character.remark || '').trim() : '';
  if (remark) {
    remark.textContent = note;
    remark.hidden = !note;
  }

  overlay.hidden = false;
  overlay.classList.remove('play');
  void overlay.offsetWidth;
  overlay.classList.add('play');

  return new Promise((resolve) => {
    charSwitchTimer = setTimeout(() => {
      charSwitchTimer = null;
      overlay.classList.remove('play');
      overlay.hidden = true;
      resolve();
    }, 1500);
  });
}

// ===== 头像 / 参考图处理（返回 Blob，交给 store.js 存入 IndexedDB） =====
function fileToImage(file, max) {
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

function fileToAvatar(file) {
  return fileToImage(file, 200);
}

function fileToReferenceImage(file) {
  return fileToImage(file, 512);
}

function fileToWallpaper(file) {
  return fileToImage(file, 1600);
}

function fileToCustomIcon(file) {
  return fileToImage(file, 512);
}

// ===== 美化：壁纸 / 单个应用图标 / 状态栏 =====
function applyAppearance(cfg, wallpaperUrl, iconUrls) {
  const home = $('view-home');
  if (wallpaperUrl) {
    home.style.backgroundImage = 'url("' + wallpaperUrl + '")';
    home.classList.add('has-wallpaper');
  } else {
    home.style.backgroundImage = '';
    home.classList.remove('has-wallpaper');
  }

  const urls = iconUrls || {};
  document.querySelectorAll('.app-icon, .dock-icon').forEach((btn) => {
    const glyph = btn.querySelector('.app-glyph');
    if (!glyph) return;
    const url = urls[btn.dataset.app];
    if (url) {
      glyph.classList.add('custom-icon');
      glyph.style.backgroundImage = 'url("' + url + '")';
    } else {
      glyph.classList.remove('custom-icon');
      glyph.style.backgroundImage = '';
    }
  });

  document.body.classList.toggle('statusbar-off', !!(cfg && cfg.statusBar === false));
  const chk = $('chk-statusbar');
  if (chk) chk.checked = !(cfg && cfg.statusBar === false);

  applyChatAppearance(cfg);

  renderAppearancePreview(wallpaperUrl, urls);
}

// 气泡颜色 / 聊天字体 / 字体颜色：只写到聊天与通话窗口，不影响其它页面
function applyChatAppearance(cfg) {
  const targets = [$('view-chat'), $('view-call')].filter(Boolean);
  const setOrRemove = (el, name, value) => {
    if (value) el.style.setProperty(name, value);
    else el.style.removeProperty(name);
  };
  targets.forEach((el) => {
    setOrRemove(el, '--user-bubble-bg', cfg && cfg.bubbleColor);
    setOrRemove(el, '--chat-font-color', cfg && cfg.fontColor);
    setOrRemove(el, '--chat-font-family', cfg && cfg.fontFamily);
  });

  const bubble = $('input-bubble-color');
  const bubbleLabel = $('bubble-color-value');
  const fontColor = $('input-font-color');
  const fontColorLabel = $('font-color-value');
  const font = $('input-chat-font');
  const bubbleValue = (cfg && cfg.bubbleColor) || '#d8b8c4';
  const fontColorValue = (cfg && cfg.fontColor) || '#3a3a40';
  if (bubble) bubble.value = bubbleValue;
  if (bubbleLabel) bubbleLabel.textContent = (cfg && cfg.bubbleColor) ? bubbleValue : '默认';
  if (fontColor) fontColor.value = fontColorValue;
  if (fontColorLabel) fontColorLabel.textContent = (cfg && cfg.fontColor) ? fontColorValue : '默认';
  if (font) font.value = (cfg && cfg.fontFamily) || '';
}

function renderAppearancePreview(wallpaperUrl) {
  const wp = $('wallpaper-preview');
  if (wp) {
    wp.style.backgroundImage = wallpaperUrl ? 'url("' + wallpaperUrl + '")' : '';
    wp.classList.toggle('has-image', !!wallpaperUrl);
  }
}

// ===== 应用图标管理（独立窗口，逐个应用编辑） =====
let iconManagerTarget = '';

function iconManagerApps() {
  const seen = new Set();
  const apps = [];
  document.querySelectorAll('.app-icon, .dock-icon').forEach((btn) => {
    const app = btn.dataset.app;
    if (!app || seen.has(app)) return;
    seen.add(app);
    const nameEl = btn.querySelector('.app-name');
    apps.push({
      id: app,
      name: nameEl ? nameEl.textContent : app,
      glyph: btn.querySelector('.app-glyph'),
    });
  });
  return apps;
}

function buildIconPreview(glyph, url) {
  const preview = document.createElement('span');
  preview.className = 'icon-manager-glyph';
  if (url) {
    preview.classList.add('custom-icon');
    preview.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
  } else if (glyph) {
    preview.innerHTML = glyph.innerHTML;
    glyph.classList.forEach((name) => {
      if (name === 'accent' || name.startsWith('glyph-')) preview.classList.add(name);
    });
  }
  return preview;
}

async function renderIconManagerGrid() {
  const grid = $('icon-manager-grid');
  if (!grid) return;
  const cfg = await getAppearance();
  grid.innerHTML = '';
  for (const app of iconManagerApps()) {
    const url = await getFileUrl(cfg.icons[app.id] || null);
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'icon-manager-tile';
    tile.dataset.iconApp = app.id;
    tile.appendChild(buildIconPreview(app.glyph, url));
    const label = document.createElement('span');
    label.className = 'icon-manager-tile-name';
    label.textContent = app.name;
    tile.appendChild(label);
    if (url) tile.classList.add('has-custom');
    grid.appendChild(tile);
  }
}

async function openIconManager() {
  iconManagerTarget = '';
  $('icon-manager-detail').hidden = true;
  $('icon-manager-grid').hidden = false;
  $('icon-manager-title').textContent = '应用图标';
  await renderIconManagerGrid();
  showView(viewIconManager);
}

async function renderIconManagerDetail(app) {
  iconManagerTarget = app;
  const grid = $('icon-manager-grid');
  const detail = $('icon-manager-detail');
  const target = iconManagerApps().find((x) => x.id === app);
  if (!target) { iconManagerTarget = ''; return; }
  const cfg = await getAppearance();
  const url = await getFileUrl(cfg.icons[app] || null);
  grid.hidden = true;
  detail.hidden = false;
  $('icon-manager-title').textContent = target.name;
  $('icon-manager-app-name').textContent = target.name;
  const preview = $('icon-manager-preview');
  preview.innerHTML = '';
  preview.className = 'icon-manager-preview' + (url ? ' has-image' : '');
  preview.style.backgroundImage = url ? 'url("' + url.replace(/"/g, '%22') + '")' : '';
  if (!url) preview.appendChild(buildIconPreview(target.glyph, null));
  $('btn-icon-manager-clear').disabled = !url;
}

function closeIconManagerDetail() {
  iconManagerTarget = '';
  $('icon-manager-detail').hidden = true;
  $('icon-manager-grid').hidden = false;
  $('icon-manager-title').textContent = '应用图标';
  renderIconManagerGrid();
}

function refreshIconManagerIfOpen() {
  if (!viewIconManager || !viewIconManager.classList.contains('active')) return;
  if (iconManagerTarget) renderIconManagerDetail(iconManagerTarget);
  else renderIconManagerGrid();
}

// ===== 记忆应用渲染 =====
async function renderMemory() {
  const list = $('memory-list');
  const { entries, longTerm, core } = await getMemory();
  list.innerHTML = '';
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'memory-empty';
    empty.textContent = '还没有短期记忆。点「整理」从聊天里总结，或点「添加」手动写一条。';
    list.appendChild(empty);
  } else {
    entries.forEach((e) => list.appendChild(memoryEntryRow(e)));
  }
  renderMemoryTierList('memory-long-list', longTerm, '还没有长期记忆。短期记忆每满 30 条会自动总结一条。', 'longTerm');
  renderMemoryTierList('memory-core-list', core, '还没有核心记忆。长期记忆每满 5 条会自动总结一条。', 'core');
}

// 长期 / 核心记忆：系统自动总结，可删除不准确的一条
function renderMemoryTierList(boxId, items, emptyText, kind) {
  const box = $(boxId);
  if (!box) return;
  box.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'memory-empty';
    empty.textContent = emptyText;
    box.appendChild(empty);
    return;
  }
  items.slice().reverse().forEach((item) => {
    const row = document.createElement('div');
    row.className = 'memory-tier-item';

    const head = document.createElement('div');
    head.className = 'memory-item-head';
    const chip = document.createElement('span');
    chip.className = 'memory-chip';
    chip.textContent = kind === 'core' ? '核心' : '长期';
    head.appendChild(chip);

    const meta = document.createElement('span');
    meta.className = 'memory-tier-meta';
    meta.textContent = item.createdAt ? new Date(item.createdAt).toLocaleDateString('zh-CN') : '';
    head.appendChild(meta);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'memory-link danger';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', () => deleteMemoryTierConfirm(kind, item.id));
    head.appendChild(delBtn);
    row.appendChild(head);

    const text = document.createElement('div');
    text.className = 'memory-item-text';
    text.textContent = item.text;
    row.appendChild(text);

    box.appendChild(row);
  });
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

// ===== 世界书渲染 =====
// 世界书当前列表：用下拉选择全局 / 某个角色，避免角色多时顶栏挤满
function renderWorldbookScopeSelect(scopes, active) {
  const sel = $('wb-scope-select');
  sel.innerHTML = '';
  scopes.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.key;
    opt.textContent = s.label;
    sel.appendChild(opt);
  });
  sel.value = active;
}

function wbChip(text, kind) {
  const span = document.createElement('span');
  span.className = 'wb-chip' + (kind ? ' ' + kind : '');
  span.textContent = text;
  return span;
}

function worldbookEntryRow(e) {
  const row = document.createElement('div');
  row.className = 'wb-item';

  const head = document.createElement('div');
  head.className = 'wb-item-head';
  head.appendChild(wbChip('权重 ' + (Number(e.weight) || 0), 'weight'));
  head.appendChild(wbChip(WORLDBOOK_POSITION_LABELS[e.position] || WORLDBOOK_POSITION_LABELS.before));
  if (e.position === 'depth') head.appendChild(wbChip('深度 ' + (Number(e.depth) || 0)));
  if (e.probabilityEnabled) head.appendChild(wbChip('概率 ' + (Number(e.probability) || 0) + '%', 'prob'));

  const actions = document.createElement('span');
  actions.className = 'wb-item-actions';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'memory-link';
  editBtn.textContent = '编辑';
  editBtn.addEventListener('click', () => openWorldbookEdit(e.id));
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'memory-link danger';
  delBtn.textContent = '删除';
  delBtn.addEventListener('click', () => deleteWorldbookConfirm(e.id));
  actions.appendChild(editBtn);
  actions.appendChild(delBtn);
  head.appendChild(actions);
  row.appendChild(head);

  const kw = document.createElement('div');
  kw.className = 'wb-keywords';
  const keywords = Array.isArray(e.keywords) ? e.keywords.filter(Boolean) : [];
  kw.textContent = keywords.length ? '关键词：' + keywords.join(' / ') : '关键词：无（无条件触发）';
  row.appendChild(kw);

  const text = document.createElement('div');
  text.className = 'wb-item-text';
  text.textContent = e.content;
  row.appendChild(text);

  return row;
}

function renderWorldbookList(entries) {
  const list = $('wb-list');
  list.innerHTML = '';
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'wb-empty';
    empty.textContent = '这个列表还没有条目。点「添加条目」新建，或「导入」JSON 文件。';
    list.appendChild(empty);
    return;
  }
  entries.forEach((e) => list.appendChild(worldbookEntryRow(e)));
}

// 渲染「新建 / 编辑」表单；entry 为空表示新增；characters 用于「绑定角色」下拉
function renderWorldbookForm(entry, characters, defaultBind) {
  const box = $('wb-form');
  box.innerHTML = '';
  box.hidden = false;

  const title = document.createElement('div');
  title.className = 'memory-form-title';
  title.textContent = entry ? '编辑条目' : '新建条目';
  box.appendChild(title);

  // 绑定角色：选择全局或已创建好的角色
  const bindRow = document.createElement('div');
  bindRow.className = 'wb-inline';
  const bindLabel = document.createElement('span');
  bindLabel.className = 'wb-label';
  bindLabel.textContent = '绑定';
  const bind = document.createElement('select');
  bind.id = 'wb-bind';
  bind.className = 'wb-select';
  const globalOpt = document.createElement('option');
  globalOpt.value = 'global';
  globalOpt.textContent = '全局（所有角色）';
  bind.appendChild(globalOpt);
  (characters || []).forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = '角色：' + (c.name || '未命名角色');
    bind.appendChild(opt);
  });
  const currentBind = entry
    ? (entry.scope === 'character' ? entry.characterId : 'global')
    : (defaultBind || 'global');
  bind.value = currentBind;
  if (!bind.value) bind.value = 'global';
  bindRow.appendChild(bindLabel);
  bindRow.appendChild(bind);
  box.appendChild(bindRow);

  const ta = document.createElement('textarea');
  ta.id = 'wb-content';
  ta.className = 'wb-textarea';
  ta.rows = 4;
  ta.placeholder = '触发后注入提示词的内容，例如：这个世界里魔法真实存在，法师受雇于公会…';
  ta.value = (entry && entry.content) || '';
  box.appendChild(ta);

  const kw = document.createElement('input');
  kw.id = 'wb-keywords';
  kw.className = 'wb-input';
  kw.type = 'text';
  kw.placeholder = '关键词，用逗号分隔；留空表示无条件触发';
  kw.value = entry && Array.isArray(entry.keywords) ? entry.keywords.join('，') : '';
  box.appendChild(kw);

  const posRow = document.createElement('div');
  posRow.className = 'wb-inline';
  const pos = document.createElement('select');
  pos.id = 'wb-position';
  pos.className = 'wb-select';
  Object.keys(WORLDBOOK_POSITION_LABELS).forEach((k) => {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = WORLDBOOK_POSITION_LABELS[k];
    pos.appendChild(o);
  });
  pos.value = (entry && entry.position) || 'before';
  posRow.appendChild(pos);

  const depth = document.createElement('input');
  depth.id = 'wb-depth';
  depth.className = 'wb-input wb-num';
  depth.type = 'number';
  depth.min = '0';
  depth.step = '1';
  depth.placeholder = '深度';
  depth.value = entry && entry.depth != null ? entry.depth : 0;
  depth.hidden = pos.value !== 'depth';
  pos.addEventListener('change', () => { depth.hidden = pos.value !== 'depth'; });
  posRow.appendChild(depth);
  box.appendChild(posRow);

  const weightRow = document.createElement('div');
  weightRow.className = 'wb-inline';
  const weightLabel = document.createElement('span');
  weightLabel.className = 'wb-label';
  weightLabel.textContent = '权重';
  const weight = document.createElement('input');
  weight.id = 'wb-weight';
  weight.className = 'wb-input wb-num';
  weight.type = 'number';
  weight.step = '1';
  weight.value = entry && entry.weight != null ? entry.weight : 10;
  const weightHint = document.createElement('span');
  weightHint.className = 'wb-unit';
  weightHint.textContent = '数字越大越优先';
  weightRow.appendChild(weightLabel);
  weightRow.appendChild(weight);
  weightRow.appendChild(weightHint);
  box.appendChild(weightRow);

  const probRow = document.createElement('div');
  probRow.className = 'wb-inline';
  const probLabel = document.createElement('label');
  probLabel.className = 'wb-check';
  const probChk = document.createElement('input');
  probChk.type = 'checkbox';
  probChk.id = 'wb-prob-enabled';
  probChk.checked = !!(entry && entry.probabilityEnabled);
  const probText = document.createElement('span');
  probText.textContent = '启用触发概率';
  probLabel.appendChild(probChk);
  probLabel.appendChild(probText);
  probRow.appendChild(probLabel);

  const prob = document.createElement('input');
  prob.id = 'wb-probability';
  prob.className = 'wb-input wb-num';
  prob.type = 'number';
  prob.min = '0';
  prob.max = '100';
  prob.step = '1';
  prob.value = entry && entry.probability != null ? entry.probability : 100;
  prob.disabled = !probChk.checked;
  probChk.addEventListener('change', () => { prob.disabled = !probChk.checked; });
  probRow.appendChild(prob);

  const unit = document.createElement('span');
  unit.className = 'wb-unit';
  unit.textContent = '%';
  probRow.appendChild(unit);
  box.appendChild(probRow);

  const depthHint = document.createElement('span');
  depthHint.className = 'wb-unit';
  depthHint.textContent = '深度 0 = 紧贴最新消息前；数字越大越靠前。';
  box.appendChild(depthHint);

  const btns = document.createElement('div');
  btns.className = 'wb-form-actions';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'fetch-btn';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', saveWorldbookForm);
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'fetch-btn';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', cancelWorldbookForm);
  btns.appendChild(saveBtn);
  btns.appendChild(cancelBtn);
  box.appendChild(btns);
}

// ===== 论坛 =====
function formatForumTime(ts) {
  const t = Number(ts) || 0;
  if (!t) return '';
  const diff = Date.now() - t;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 7 * 24 * 60 * 60 * 1000) return Math.floor(diff / 86400000) + ' 天前';
  const d = new Date(t);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

function forumAvatarEl(name, url, type) {
  const el = document.createElement('div');
  el.className = 'forum-avatar' + (type === 'npc' || type === 'user' ? ' ' + type : '');
  if (url) el.style.backgroundImage = 'url("' + String(url).replace(/"/g, '%22') + '")';
  else el.textContent = String(name || '路').trim().slice(0, 1) || '路';
  return el;
}

async function forumAvatarUrlForPost(post, forum, cache) {
  if (!post) return '';
  if (post.authorType === 'user') return getFileUrl(forum.profile.avatarId);
  if (post.authorType === 'character' && post.authorId) {
    if (!Object.prototype.hasOwnProperty.call(cache, post.authorId)) {
      const c = await getCharacter(post.authorId);
      cache[post.authorId] = c ? await getAvatarUrlById(c.avatarId) : '';
    }
    return cache[post.authorId] || '';
  }
  return '';
}

function buildForumPostCard(post, avatarUrl) {
  const card = document.createElement('article');
  card.className = 'forum-post';
  card.dataset.postId = post.id;

  const head = document.createElement('div');
  head.className = 'forum-post-head';
  head.appendChild(forumAvatarEl(post.authorName, avatarUrl, post.authorType));

  const meta = document.createElement('div');
  meta.className = 'forum-post-meta';
  const author = document.createElement('div');
  author.className = 'forum-post-author';
  const name = document.createElement('span');
  name.textContent = post.authorName;
  author.appendChild(name);
  const badge = document.createElement('span');
  badge.className = 'forum-badge ' + post.authorType;
  badge.textContent = post.authorType === 'character' ? '角色' : (post.authorType === 'user' ? '我' : '路人');
  author.appendChild(badge);
  meta.appendChild(author);
  const time = document.createElement('div');
  time.className = 'forum-post-time';
  time.textContent = formatForumTime(post.createdAt);
  meta.appendChild(time);
  head.appendChild(meta);
  card.appendChild(head);

  if (post.title) {
    const title = document.createElement('div');
    title.className = 'forum-post-title';
    title.textContent = post.title;
    card.appendChild(title);
  }
  const content = document.createElement('div');
  content.className = 'forum-post-content';
  content.textContent = post.content;
  card.appendChild(content);

  const foot = document.createElement('div');
  foot.className = 'forum-post-foot';
  const c1 = document.createElement('span');
  c1.className = 'forum-foot-item';
  c1.textContent = '💬 ' + post.comments.length;
  const c2 = document.createElement('span');
  c2.className = 'forum-foot-item';
  c2.textContent = '♡ ' + post.likes;
  foot.appendChild(c1);
  foot.appendChild(c2);
  card.appendChild(foot);
  return card;
}

async function renderForumFeed(forum, tab) {
  const feed = $('forum-feed');
  if (!feed) return;
  feed.innerHTML = '';
  if (tab === 'me') {
    feed.appendChild(await buildForumProfileView(forum));
    return;
  }

  let posts = forum.posts.slice();
  if (tab === 'home') {
    posts = posts.filter((p) => p.boardId === forum.activeBoardId);
  } else if (tab === 'following') {
    const bound = new Set(forum.settings.characterIds);
    posts = posts.filter((p) => p.authorType === 'character' && bound.has(p.authorId));
  }

  if (!posts.length) {
    const empty = document.createElement('div');
    empty.className = 'forum-empty';
    const strong = document.createElement('strong');
    strong.textContent = tab === 'following' ? '还没有角色发帖' : '论坛还很安静';
    const p = document.createElement('div');
    p.textContent = tab === 'following'
      ? '去设置里绑定角色，点刷新就会生成角色帖子。'
      : '展开模块下方的「刷新帖子」生成路人帖子，或点「＋」自己发一帖。';
    empty.appendChild(strong);
    empty.appendChild(p);
    feed.appendChild(empty);
    return;
  }

  const cache = {};
  for (const post of posts) {
    const url = await forumAvatarUrlForPost(post, forum, cache);
    feed.appendChild(buildForumPostCard(post, url));
  }
}

async function buildForumProfileView(forum) {
  const wrap = document.createElement('div');
  const profile = forum.profile;

  const card = document.createElement('div');
  card.className = 'forum-profile';
  const cover = document.createElement('div');
  cover.className = 'forum-profile-cover';
  const coverUrl = await getFileUrl(profile.coverId);
  if (coverUrl) cover.style.backgroundImage = 'url("' + coverUrl.replace(/"/g, '%22') + '")';
  card.appendChild(cover);

  const body = document.createElement('div');
  body.className = 'forum-profile-body';
  const avatar = document.createElement('div');
  avatar.className = 'forum-profile-avatar';
  const avatarUrl = await getFileUrl(profile.avatarId);
  if (avatarUrl) avatar.style.backgroundImage = 'url("' + avatarUrl.replace(/"/g, '%22') + '")';
  else avatar.textContent = String(profile.name || '我').slice(0, 1);
  body.appendChild(avatar);

  const name = document.createElement('div');
  name.className = 'forum-profile-name';
  name.textContent = profile.name;
  body.appendChild(name);
  const sign = document.createElement('div');
  sign.className = 'forum-profile-sign';
  sign.textContent = profile.signature || '还没有个性签名';
  body.appendChild(sign);

  const actions = document.createElement('div');
  actions.className = 'forum-profile-actions';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'fetch-btn';
  edit.id = 'btn-forum-edit-profile';
  edit.textContent = '编辑主页';
  actions.appendChild(edit);
  body.appendChild(actions);

  const myPosts = forum.posts.filter((p) => p.authorType === 'user');
  const stats = document.createElement('div');
  stats.className = 'forum-profile-stats';
  stats.innerHTML = '<span><strong>' + myPosts.length + '</strong>帖子</span>' +
    '<span><strong>' + forum.settings.characterIds.length + '</strong>关注</span>';
  body.appendChild(stats);
  card.appendChild(body);
  wrap.appendChild(card);

  const heading = document.createElement('div');
  heading.className = 'forum-comments-title';
  heading.style.margin = '16px 2px 8px';
  heading.textContent = '我的帖子';
  wrap.appendChild(heading);

  if (!myPosts.length) {
    const empty = document.createElement('div');
    empty.className = 'forum-empty';
    empty.textContent = '还没发过帖子，回首页点「＋」发第一帖。';
    wrap.appendChild(empty);
  } else {
    for (const post of myPosts) {
      wrap.appendChild(buildForumPostCard(post, avatarUrl));
    }
  }
  return wrap;
}

async function renderForumDetail(forum, post) {
  const box = $('forum-detail-body');
  if (!box) return;
  box.innerHTML = '';
  box.dataset.postId = post.id;

  const cache = {};
  const avatarUrl = await forumAvatarUrlForPost(post, forum, cache);

  const head = document.createElement('div');
  head.className = 'forum-post-head';
  head.appendChild(forumAvatarEl(post.authorName, avatarUrl, post.authorType));
  const meta = document.createElement('div');
  meta.className = 'forum-post-meta';
  const author = document.createElement('div');
  author.className = 'forum-post-author';
  const name = document.createElement('span');
  name.textContent = post.authorName;
  author.appendChild(name);
  const badge = document.createElement('span');
  badge.className = 'forum-badge ' + post.authorType;
  badge.textContent = post.authorType === 'character' ? '角色' : (post.authorType === 'user' ? '我' : '路人');
  author.appendChild(badge);
  meta.appendChild(author);
  const time = document.createElement('div');
  time.className = 'forum-post-time';
  time.textContent = formatForumTime(post.createdAt);
  meta.appendChild(time);
  head.appendChild(meta);
  box.appendChild(head);

  if (post.title) {
    const title = document.createElement('h2');
    title.className = 'forum-detail-title';
    title.textContent = post.title;
    box.appendChild(title);
  }
  const content = document.createElement('div');
  content.className = 'forum-detail-content';
  content.textContent = post.content;
  box.appendChild(content);

  const actions = document.createElement('div');
  actions.className = 'forum-detail-actions';
  const gen = document.createElement('button');
  gen.type = 'button';
  gen.className = 'fetch-btn';
  gen.id = 'btn-forum-gen-comments';
  gen.textContent = '生成评论';
  actions.appendChild(gen);
  if (post.authorType === 'user') {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'fetch-btn';
    edit.id = 'btn-forum-edit-post';
    edit.textContent = '编辑';
    actions.appendChild(edit);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'fetch-btn';
    del.id = 'btn-forum-delete-post';
    del.textContent = '删除';
    actions.appendChild(del);
  }
  box.appendChild(actions);

  const comments = document.createElement('div');
  comments.className = 'forum-comments';
  const title = document.createElement('div');
  title.className = 'forum-comments-title';
  title.textContent = '评论 ' + post.comments.length;
  comments.appendChild(title);
  if (!post.comments.length) {
    const empty = document.createElement('div');
    empty.className = 'forum-empty';
    empty.style.padding = '18px 0';
    empty.textContent = '还没有评论，点「生成评论」看看网友怎么说。';
    comments.appendChild(empty);
  } else {
    post.comments.forEach((c) => {
      const item = document.createElement('div');
      item.className = 'forum-comment';
      const n = document.createElement('span');
      n.className = 'forum-comment-name';
      n.textContent = c.name;
      const text = document.createElement('span');
      text.className = 'forum-comment-text';
      text.textContent = c.content;
      item.appendChild(n);
      item.appendChild(text);
      comments.appendChild(item);
    });
  }
  box.appendChild(comments);
}

async function renderForumSettings(forum, worldbook, characters) {
  $('input-forum-base').value = forum.settings.baseUrl || '';
  $('input-forum-key').value = forum.settings.apiKey || '';
  $('input-forum-model').value = forum.settings.model || '';
  $('input-forum-count').value = forum.settings.refreshCount || 3;
  renderForumBoardEditors(forum.boards);

  const wbBox = $('forum-worldbook-list');
  wbBox.innerHTML = '';
  if (!worldbook.length) {
    const empty = document.createElement('div');
    empty.className = 'field-hint';
    empty.textContent = '世界书里还没有条目，可以先去世界书应用添加。';
    wbBox.appendChild(empty);
  } else {
    const bound = new Set(forum.settings.worldbookIds);
    worldbook.forEach((entry) => {
      const row = document.createElement('label');
      row.className = 'forum-check-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'forum-wb-check';
      cb.dataset.id = entry.id;
      cb.checked = bound.has(entry.id);
      const text = document.createElement('span');
      text.textContent = String(entry.content || '').replace(/\s+/g, ' ').slice(0, 46) || '（空条目）';
      const sub = document.createElement('span');
      sub.className = 'forum-check-sub';
      sub.textContent = entry.scope === 'global' ? '全局' : '角色';
      row.appendChild(cb);
      row.appendChild(text);
      row.appendChild(sub);
      wbBox.appendChild(row);
    });
  }

  const charBox = $('forum-character-list');
  charBox.innerHTML = '';
  if (!characters.length) {
    const empty = document.createElement('div');
    empty.className = 'field-hint';
    empty.textContent = '还没有角色，可以先去角色应用创建。';
    charBox.appendChild(empty);
  } else {
    const bound = new Set(forum.settings.characterIds);
    characters.forEach((c) => {
      const row = document.createElement('label');
      row.className = 'forum-check-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'forum-char-check';
      cb.dataset.id = c.id;
      cb.checked = bound.has(c.id);
      const text = document.createElement('span');
      text.textContent = c.name;
      const sub = document.createElement('span');
      sub.className = 'forum-check-sub';
      sub.textContent = String(c.persona || '').replace(/\s+/g, ' ').slice(0, 20);
      row.appendChild(cb);
      row.appendChild(text);
      row.appendChild(sub);
      charBox.appendChild(row);
    });
  }
}

function renderForumBoardEditors(boards) {
  const box = $('forum-board-editor-list');
  if (!box) return;
  box.innerHTML = '';
  boards.forEach((board, index) => {
    const card = document.createElement('div');
    card.className = 'forum-board-editor';
    card.dataset.boardId = board.id;

    const head = document.createElement('div');
    head.className = 'forum-board-editor-head';
    const label = document.createElement('span');
    label.textContent = '板块 ' + (index + 1);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'forum-board-remove';
    del.dataset.boardRemove = board.id;
    del.textContent = '删除';
    head.appendChild(label);
    head.appendChild(del);
    card.appendChild(head);

    const title = document.createElement('input');
    title.type = 'text';
    title.className = 'forum-board-title-input';
    title.placeholder = '板块名称';
    title.value = board.title;
    card.appendChild(title);

    const subtitle = document.createElement('input');
    subtitle.type = 'text';
    subtitle.className = 'forum-board-subtitle-input';
    subtitle.placeholder = '一句话简介';
    subtitle.value = board.subtitle || '';
    card.appendChild(subtitle);

    const prompt = document.createElement('textarea');
    prompt.className = 'forum-board-prompt-input';
    prompt.rows = 3;
    prompt.placeholder = '这个板块的路人发言风格';
    prompt.value = board.npcPrompt || '';
    card.appendChild(prompt);

    box.appendChild(card);
  });
}

async function renderForumShareList(characters, forum) {
  const box = $('forum-share-list');
  if (!box) return;
  box.innerHTML = '';
  if (!characters.length) {
    const empty = document.createElement('div');
    empty.className = 'forum-empty';
    empty.textContent = '还没有角色，先去角色应用创建一个吧。';
    box.appendChild(empty);
    return;
  }
  const bound = new Set(forum.settings.characterIds);
  const sorted = characters.slice().sort((a, b) => {
    const av = bound.has(a.id) ? 0 : 1;
    const bv = bound.has(b.id) ? 0 : 1;
    return av - bv;
  });
  for (const c of sorted) {
    const url = await getAvatarUrlById(c.avatarId);
    const row = document.createElement('div');
    row.className = 'forum-share-row';
    row.dataset.characterId = c.id;
    row.appendChild(forumAvatarEl(c.name, url, 'character'));
    const info = document.createElement('div');
    info.className = 'forum-share-name';
    info.textContent = c.name;
    if (bound.has(c.id)) {
      const sub = document.createElement('div');
      sub.className = 'forum-share-sub';
      sub.textContent = '已绑定论坛';
      info.appendChild(sub);
    }
    row.appendChild(info);
    box.appendChild(row);
  }
}

async function renderForumProfileEditor(profile) {
  $('forum-profile-name').value = profile.name || '';
  $('forum-profile-signature').value = profile.signature || '';
  const avatarUrl = await getFileUrl(profile.avatarId);
  const coverUrl = await getFileUrl(profile.coverId);
  const av = $('forum-profile-avatar-preview');
  const cv = $('forum-profile-cover-preview');
  av.style.backgroundImage = avatarUrl ? 'url("' + avatarUrl.replace(/"/g, '%22') + '")' : '';
  av.textContent = avatarUrl ? '' : String(profile.name || '我').slice(0, 1);
  cv.style.backgroundImage = coverUrl ? 'url("' + coverUrl.replace(/"/g, '%22') + '")' : '';
}

function renderForumBoard(forum) {
  const board = forum.boards.find((b) => b.id === forum.activeBoardId) || forum.boards[0];
  $('forum-board-title').textContent = board.title;
  $('forum-board-desc').textContent = board.subtitle || '这个板块还没有简介';
  $('forum-header-title').textContent = board.title;

  const tabs = $('forum-board-tabs');
  if (!tabs) return;
  tabs.innerHTML = '';
  forum.boards.forEach((b) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'forum-board-chip' + (b.id === board.id ? ' active' : '');
    btn.dataset.boardId = b.id;
    btn.textContent = b.title;
    tabs.appendChild(btn);
  });
}

// ===== 邮箱渲染 =====
function formatMailTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
}

function mailSnippet(body) {
  return String(body || '').replace(/\s+/g, ' ').trim();
}

function mailAvatarEl(name, url) {
  const el = document.createElement('span');
  el.className = 'mail-avatar';
  if (url) el.style.backgroundImage = 'url("' + url + '")';
  else el.textContent = String(name || '?').slice(0, 1);
  return el;
}

async function renderMailList(email, characters, folder) {
  const list = $('mail-list');
  list.innerHTML = '';
  const charMap = new Map(characters.map((c) => [c.id, c]));
  const avatars = {};
  await Promise.all(characters.map(async (c) => {
    avatars[c.id] = await getAvatarUrlById(c.avatarId);
  }));

  const mails = email.mails.filter((m) => (folder === 'sent' ? m.direction === 'out' : m.direction === 'in'));
  if (!mails.length) {
    const empty = uiEl('div', 'mail-empty');
    empty.appendChild(uiEl('div', 'mail-empty-title', folder === 'sent' ? '还没有寄出的信' : '收件箱空空的'));
    empty.appendChild(uiEl('div', 'mail-empty-text', folder === 'sent'
      ? '点右下角「＋」给角色写一封，或在聊天工具的「邮件」里让他先写给你。'
      : '到邮箱设置里勾选角色，或去聊天工具的「邮件」里让角色现在就写一篇。'));
    list.appendChild(empty);
    return;
  }

  mails.forEach((m) => {
    const c = charMap.get(m.characterId);
    const displayName = m.direction === 'out'
      ? '发给 ' + (c ? (c.name || '角色') : m.characterName)
      : (c ? (c.name || '角色') : m.characterName);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'mail-row' + (m.direction === 'in' && !m.read ? ' unread' : '');
    row.dataset.mailId = m.id;

    row.appendChild(mailAvatarEl(displayName, m.direction === 'out' ? '' : (c ? avatars[c.id] : '')));

    const main = uiEl('span', 'mail-main');
    const top = uiEl('span', 'mail-row-top');
    top.appendChild(uiEl('span', 'mail-sender', displayName));
    top.appendChild(uiEl('span', 'mail-time', formatMailTime(m.createdAt)));
    main.appendChild(top);
    main.appendChild(uiEl('span', 'mail-subject', m.subject));
    main.appendChild(uiEl('span', 'mail-snippet', mailSnippet(m.body).slice(0, 80)));
    row.appendChild(main);

    if (m.direction === 'in' && !m.read) row.appendChild(uiEl('span', 'mail-dot'));
    list.appendChild(row);
  });
}

async function renderMailDetail(mail, characters, folder) {
  const body = $('mail-detail-body');
  body.innerHTML = '';
  const c = characters.find((x) => x.id === mail.characterId);
  const name = mail.direction === 'out' ? '我' : (c ? c.name : mail.characterName);
  const avatar = mail.direction === 'out' ? '' : (c ? await getAvatarUrlById(c.avatarId) : '');
  const targetName = c ? (c.name || '角色') : mail.characterName;

  body.appendChild(uiEl('div', 'mail-detail-subject', mail.subject));

  const meta = uiEl('div', 'mail-detail-meta');
  meta.appendChild(mailAvatarEl(name, avatar));
  const info = uiEl('div', 'mail-main');
  info.appendChild(uiEl('div', 'mail-detail-from', name));
  info.appendChild(uiEl('div', 'mail-detail-to', formatMailTime(mail.createdAt) + ' · ' + (mail.direction === 'out' ? '收件人：' + targetName : '收件人：我')));
  meta.appendChild(info);
  body.appendChild(meta);

  body.appendChild(uiEl('div', 'mail-detail-text', mail.body));

  if (mail.direction === 'in' && folder !== 'sent') {
    const reply = uiEl('button', 'mail-reply-btn', '回复这封信');
    reply.type = 'button';
    reply.id = 'btn-mail-reply';
    body.appendChild(reply);
  }
}

function renderMailComposeOptions(characters, selectedId) {
  const sel = $('mail-compose-to');
  sel.innerHTML = '';
  characters.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name || '未命名角色';
    if (c.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  });
  if (!sel.value && characters.length) sel.value = characters[0].id;
}

function renderMailSettings(email, characters) {
  const box = $('mail-character-list');
  box.innerHTML = '';
  if (!characters.length) {
    box.appendChild(uiEl('div', 'field-hint', '还没有角色，先到角色应用创建角色。'));
  } else {
    const bound = new Set(email.settings.characterIds);
    characters.forEach((c) => {
      const row = document.createElement('label');
      row.className = 'forum-check-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'mail-char-check';
      cb.dataset.characterId = c.id;
      cb.checked = bound.has(c.id);
      row.appendChild(cb);
      row.appendChild(uiEl('span', '', c.name || '未命名角色'));
      box.appendChild(row);
    });
  }
  $('mail-interval-hours').value = String(email.settings.intervalHours || 24);
}

// ===== 小说渲染 =====
function bookFormatLabel(format) {
  if (format === 'epub') return 'EPUB';
  if (format === 'pdf') return 'PDF';
  return 'TXT';
}

function bookProgressPercent(meta) {
  const total = Math.max(1, meta.chapterCount || 1);
  const idx = Math.min(total, (meta.progress && meta.progress.chapterIndex) || 0);
  return Math.max(2, Math.min(100, Math.round((idx / total) * 100)));
}

function bookProgressText(meta) {
  const total = meta.chapterCount || 0;
  const idx = Math.min(total, ((meta.progress && meta.progress.chapterIndex) || 0) + 1);
  if (!total) return '暂无章节';
  return '第 ' + idx + ' / ' + total + ' 章';
}

function renderBooksLibrary(books) {
  const list = $('books-list');
  list.innerHTML = '';
  if (!books.list.length) {
    const empty = uiEl('div', 'books-empty');
    const strong = uiEl('strong', '', '书架还是空的');
    empty.appendChild(strong);
    empty.appendChild(document.createTextNode('点上方「导入小说」选择 TXT / EPUB / PDF 文件。导入后可以逐章阅读，让角色陪你讨论、写批注。'));
    list.appendChild(empty);
    return;
  }
  books.list.forEach((meta) => {
    const card = document.createElement('div');
    card.className = 'book-card';
    card.dataset.bookId = meta.id;

    const cover = uiEl('div', 'book-cover', String(meta.title || '书').slice(0, 4));
    card.appendChild(cover);

    const main = uiEl('div', 'book-main');
    main.appendChild(uiEl('div', 'book-title', meta.title));
    const metaText = [meta.author, bookFormatLabel(meta.format), bookProgressText(meta)].filter(Boolean).join(' · ');
    main.appendChild(uiEl('div', 'book-meta', metaText));
    const bar = uiEl('div', 'book-progress');
    const fill = uiEl('i');
    fill.style.width = bookProgressPercent(meta) + '%';
    bar.appendChild(fill);
    main.appendChild(bar);
    card.appendChild(main);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'book-delete';
    del.dataset.bookDelete = meta.id;
    del.setAttribute('aria-label', '删除这本书');
    del.textContent = '×';
    card.appendChild(del);

    list.appendChild(card);
  });
}

function renderReaderChapter(book, chapterIndex, currentParagraph) {
  const chapter = book.chapters[chapterIndex];
  if (!chapter) return;
  $('reader-chapter-head').textContent = chapter.title;
  $('reader-chapter-title').textContent = chapter.title;
  const content = $('reader-content');
  content.innerHTML = '';
  const annotations = (book.annotations || []).filter((a) => a.chapterIndex === chapterIndex);
  const byParagraph = new Map();
  annotations.forEach((a) => {
    if (!byParagraph.has(a.paragraph)) byParagraph.set(a.paragraph, []);
    byParagraph.get(a.paragraph).push(a);
  });

  chapter.paragraphs.forEach((text, i) => {
    const p = document.createElement('div');
    p.className = 'reader-p' + (i === currentParagraph ? ' current' : '');
    p.dataset.paragraph = String(i);
    const num = uiEl('span', 'reader-num', String(i + 1));
    p.appendChild(num);
    p.appendChild(document.createTextNode(text));
    const list = byParagraph.get(i);
    if (list && list.length) {
      p.appendChild(uiEl('span', 'reader-badge', '批注 ' + list.length));
    }
    content.appendChild(p);

    if (list && list.length) {
      const box = uiEl('div', 'reader-annotations');
      box.dataset.annotationsFor = String(i);
      list.forEach((a) => {
        const item = uiEl('div', 'reader-annotation');
        item.dataset.annotationId = a.id;
        item.appendChild(uiEl('span', 'reader-annotation-name', a.characterName));
        item.appendChild(uiEl('span', 'reader-annotation-text', a.text));
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'reader-annotation-del';
        del.dataset.annotationDelete = a.id;
        del.setAttribute('aria-label', '删除批注');
        del.textContent = '×';
        item.appendChild(del);
        box.appendChild(item);
      });
      content.appendChild(box);
    }
  });

  const prev = $('btn-reader-prev');
  const next = $('btn-reader-next');
  if (prev) prev.disabled = chapterIndex <= 0;
  if (next) next.disabled = chapterIndex >= book.chapters.length - 1;
}

function renderReaderToc(book, chapterIndex) {
  const box = $('reader-toc-list');
  box.innerHTML = '';
  $('reader-toc-count').textContent = '共 ' + book.chapters.length + ' 章';
  book.chapters.forEach((chapter, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'reader-toc-item' + (i === chapterIndex ? ' active' : '');
    btn.dataset.chapterIndex = String(i);
    btn.appendChild(uiEl('span', 'reader-toc-index', String(i + 1)));
    btn.appendChild(uiEl('span', 'reader-toc-name', chapter.title));
    box.appendChild(btn);
  });
}

function renderReaderCharacters(characters, selectedId) {
  const sel = $('reader-character');
  sel.innerHTML = '';
  if (!characters.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '还没有角色，先到角色应用创建';
    sel.appendChild(opt);
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  characters.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name || '未命名角色';
    sel.appendChild(opt);
  });
  const pick = characters.some((c) => c.id === selectedId) ? selectedId : characters[0].id;
  sel.value = pick;
}

// ===== 动态（朋友圈）渲染 =====
function momentTimeText(ts) {
  const t = Number(ts) || 0;
  if (!t) return '';
  const diff = Date.now() - t;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
  const d = new Date(t);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return hh + ':' + mm;
  const diffDay = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (diffDay === 1) return '昨天 ' + hh + ':' + mm;
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hh + ':' + mm;
}

function momentAvatarEl(name, url) {
  const el = uiEl('div', 'moment-avatar');
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    el.appendChild(img);
  } else {
    el.textContent = String(name || '?').slice(0, 1);
  }
  return el;
}

async function buildMomentCard(post, identity, charMap, avatarMap) {
  const card = uiEl('div', 'moment-card');
  card.dataset.momentId = post.id;

  const isUser = post.authorType === 'user';
  let avatar = '';
  if (isUser) avatar = identity.avatarUrl || '';
  else if (post.authorId) avatar = avatarMap[post.authorId] || '';

  card.appendChild(momentAvatarEl(post.authorName, avatar));

  const main = uiEl('div', 'moment-main');
  main.appendChild(uiEl('div', 'moment-author', post.authorName));

  if (post.text) main.appendChild(uiEl('div', 'moment-text', post.text));

  if (post.imageId) {
    const url = await getFileUrl(post.imageId);
    if (url) {
      const img = document.createElement('img');
      img.className = 'moment-image';
      img.src = url;
      img.alt = post.imageDesc || '动态图片';
      main.appendChild(img);
    }
  } else if (post.imageDesc) {
    const desc = uiEl('div', 'moment-image-desc');
    desc.appendChild(uiEl('span', 'moment-image-desc-label', '文字配图'));
    desc.appendChild(uiEl('p', '', post.imageDesc));
    main.appendChild(desc);
  }

  const metaRow = uiEl('div', 'moment-meta-row');
  metaRow.appendChild(uiEl('span', 'moment-time', momentTimeText(post.createdAt)));
  const actions = uiEl('div', 'moment-actions');

  const userLiked = post.likes.some((l) => l.authorType === 'user');
  const likeBtn = uiEl('button', 'moment-action-btn' + (userLiked ? ' active' : ''), '赞');
  likeBtn.type = 'button';
  likeBtn.dataset.momentLike = post.id;
  actions.appendChild(likeBtn);

  const commentBtn = uiEl('button', 'moment-action-btn', '评论');
  commentBtn.type = 'button';
  commentBtn.dataset.momentCommentToggle = post.id;
  actions.appendChild(commentBtn);

  if (isUser) {
    const delBtn = uiEl('button', 'moment-action-btn danger', '删除');
    delBtn.type = 'button';
    delBtn.dataset.momentDelete = post.id;
    actions.appendChild(delBtn);
  }
  metaRow.appendChild(actions);
  main.appendChild(metaRow);

  if (post.likes.length) {
    const likeRow = uiEl('div', 'moment-likes');
    likeRow.appendChild(uiEl('span', 'moment-heart', '♥'));
    likeRow.appendChild(document.createTextNode(post.likes.map((l) => l.name).join('、')));
    main.appendChild(likeRow);
  }

  if (post.comments.length) {
    const comments = uiEl('div', 'moment-comments');
    post.comments.forEach((c) => {
      const row = uiEl('div', 'moment-comment');
      const name = uiEl('span', 'moment-comment-name', c.name + '：');
      row.appendChild(name);
      row.appendChild(document.createTextNode(c.content));
      if (c.authorType === 'user') {
        const del = uiEl('button', 'moment-comment-del', '删除');
        del.type = 'button';
        del.dataset.momentCommentDelete = c.id;
        del.dataset.momentCommentPost = post.id;
        row.appendChild(del);
      }
      comments.appendChild(row);
    });
    main.appendChild(comments);
  }

  const form = uiEl('div', 'moment-comment-form');
  form.hidden = true;
  form.dataset.momentCommentForm = post.id;
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '回复 ' + post.authorName + '…';
  input.dataset.momentCommentInput = post.id;
  const send = uiEl('button', '', '发送');
  send.type = 'button';
  send.dataset.momentCommentSend = post.id;
  form.appendChild(input);
  form.appendChild(send);
  main.appendChild(form);

  card.appendChild(main);
  return card;
}

async function renderMomentsFeed(moments, identity, characters) {
  const feed = $('moments-feed');
  if (!feed) return;
  feed.innerHTML = '';
  const posts = (moments && moments.posts) || [];
  if (!posts.length) {
    const empty = uiEl('div', 'moments-empty');
    empty.appendChild(uiEl('div', '', '这里还没有动态'));
    empty.appendChild(uiEl('div', '', '点右下角「＋」发布第一条，或到设置里绑定角色，让他们按间隔发动态。'));
    feed.appendChild(empty);
    return;
  }
  const charMap = new Map((characters || []).map((c) => [c.id, c]));
  const avatarMap = {};
  await Promise.all((characters || []).map(async (c) => {
    avatarMap[c.id] = await getAvatarUrlById(c.avatarId);
  }));
  for (const post of posts) {
    feed.appendChild(await buildMomentCard(post, identity, charMap, avatarMap));
  }
}

function renderMomentsSettings(moments, characters) {
  const box = $('moments-character-list');
  if (!box) return;
  box.innerHTML = '';
  if (!characters.length) {
    box.appendChild(uiEl('div', 'field-hint', '还没有角色，先到角色应用创建角色。'));
  } else {
    const bound = new Set(moments.settings.characterIds);
    characters.forEach((c) => {
      const row = document.createElement('label');
      row.className = 'forum-check-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'moment-char-check';
      cb.dataset.characterId = c.id;
      cb.checked = bound.has(c.id);
      row.appendChild(cb);
      row.appendChild(uiEl('span', '', c.name || '未命名角色'));
      box.appendChild(row);
    });
  }
  $('moments-interval-hours').value = String(moments.settings.intervalHours || 24);
}

function renderReaderChat(messages, characterName, typing) {
  const box = $('reader-chat');
  box.innerHTML = '';
  if (!messages.length && !typing) {
    const empty = uiEl('div', 'reader-chat-empty');
    empty.appendChild(document.createTextNode('读到有意思的地方，就和' + (characterName || '角色') + '聊聊。'));
    box.appendChild(empty);
    return;
  }
  messages.forEach((m) => {
    const row = uiEl('div', 'reader-msg ' + (m.role === 'user' ? 'user' : 'character'));
    row.appendChild(uiEl('span', 'reader-msg-name', m.role === 'user' ? '我' : (characterName || '角色')));
    row.appendChild(uiEl('div', 'reader-msg-bubble', m.text));
    box.appendChild(row);
  });
  if (typing) {
    const row = uiEl('div', 'reader-msg character typing');
    row.appendChild(uiEl('span', 'reader-msg-name', characterName || '角色'));
    row.appendChild(uiEl('div', 'reader-msg-bubble', '正在读你划到的地方…'));
    box.appendChild(row);
  }
  box.scrollTop = box.scrollHeight;
}
