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
  } else {
    bubble.textContent = m.content;
  }

  row.appendChild(bubble);
  return row;
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
      const mm = /^\[\[sticker:(.+?)\]\]$/.exec(part.trim());
      const sticker = mm ? findSticker(ctx && ctx.stickers, mm[1]) : null;
      if (sticker) {
        const img = document.createElement('img');
        img.className = 'sticker-img';
        img.src = sticker.url;
        img.alt = sticker.name;
        stack.appendChild(img);
        return;
      }
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble assistant-bubble';
      bubble.textContent = mm ? '[表情包]' : part;
      stack.appendChild(bubble);
    });
  }

  if (ctx && ctx.call && ctx.voiceEnabled && !m.error) {
    const voice = document.createElement('button');
    voice.type = 'button';
    voice.className = 'call-voice-btn';
    voice.dataset.speakIndex = String(index);
    voice.textContent = '收听语音';
    voice.addEventListener('click', () => {
      if (typeof speakCallMessage === 'function') speakCallMessage(index);
    });
    stack.appendChild(voice);
  }

  row.appendChild(stack);
  return row;
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
    box.appendChild(renderMessage(history[i], i, c.avatar, c.name, ctx));
  }
  box.scrollTop = box.scrollHeight;
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

function renderChatToolMenu(body) {
  const grid = uiEl('div', 'tool-grid');
  [
    ['location', '位置', '地'],
    ['image', '图片', '图'],
    ['sticker', '表情包', '表'],
    ['transfer', '转账', '¥'],
    ['directive', '系统指令', '令'],
  ].forEach(([tool, label, glyph]) => {
    const tile = uiEl('button', 'tool-tile');
    tile.type = 'button';
    tile.dataset.tool = tool;
    tile.appendChild(uiEl('span', 'tool-tile-glyph', glyph));
    tile.appendChild(uiEl('span', '', label));
    grid.appendChild(tile);
  });
  body.appendChild(grid);
  body.appendChild(uiEl('div', 'tool-hint', '位置、图片、表情包和转账会作为消息发送；系统指令不会显示，只影响下一轮回复。'));
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
  else renderChatToolMenu(body);
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
  const rows = await Promise.all(list.map(async (c) => ({ ...c, avatar: await getAvatarUrlById(c.avatarId) })));
  renderCharacterList(rows, activeId);
}

function renderCharacterList(characters, activeId) {
  const box = $('character-list');
  box.innerHTML = '';
  if (!characters.length) {
    const empty = document.createElement('div');
    empty.className = 'memory-empty';
    empty.textContent = '还没有角色。点「新建角色」创建人设；聊天和记忆会按角色分开保存。';
    box.appendChild(empty);
    return;
  }
  characters.forEach((c) => box.appendChild(characterRow(c, c.id === activeId)));
}

function characterRow(c, isActive) {
  const row = document.createElement('div');
  row.className = 'char-item' + (isActive ? ' active' : '');
  row.addEventListener('click', () => switchActiveCharacter(c.id));

  const avatar = document.createElement('div');
  avatar.className = 'char-avatar';
  avatar.innerHTML = charAvatarHTML(c.avatar, c.name);
  row.appendChild(avatar);

  const info = document.createElement('div');
  info.className = 'char-info';

  const nameRow = document.createElement('div');
  nameRow.className = 'char-name-row';
  const name = document.createElement('div');
  name.className = 'char-name';
  name.textContent = c.name || '未命名角色';
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
  persona.textContent = String(c.persona || '').trim() || '未填写人设';
  info.appendChild(persona);

  const actions = document.createElement('div');
  actions.className = 'char-actions';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'memory-link';
  editBtn.textContent = '编辑';
  editBtn.addEventListener('click', (e) => { e.stopPropagation(); openCharacterEdit(c.id); });
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'memory-link danger';
  delBtn.textContent = '删除';
  delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteCharacterConfirm(c.id); });
  actions.appendChild(editBtn);
  actions.appendChild(delBtn);
  info.appendChild(actions);

  row.appendChild(info);
  return row;
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
function renderCharacterForm(character, avatarUrl, refImageUrl) {
  const box = $('character-form');
  box.innerHTML = '';
  box.hidden = false;

  const voice = (character && character.voice) || { enabled: false, voiceId: '', model: '' };
  const image = (character && character.image) || { enabled: false, prompt: '', referenceImageId: null };

  const title = document.createElement('div');
  title.className = 'memory-form-title';
  title.textContent = character ? '编辑角色' : '新建角色';
  box.appendChild(title);

  const name = document.createElement('input');
  name.id = 'char-name-input';
  name.className = 'wb-input';
  name.type = 'text';
  name.placeholder = '角色名字，例如：小助手';
  name.value = (character && character.name) || '';
  box.appendChild(name);

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
        }, 'image/jpeg', 0.85);
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
