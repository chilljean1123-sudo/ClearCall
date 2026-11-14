// ===== 编排层 / 入口 =====
// 串联 store.js（存取数据）、api.js（调用模型）、ui.js（界面渲染）。
// 负责聊天状态机、回复触发模式、备份导入导出、以及所有事件绑定。

let chatSending = false;
let countdownTick = null;
let countdownSecRemain = 0;
let editingMemoryId = null;
let wbScope = 'global';
let editingWorldbookId = null;

// 通话状态
let callActive = false;
let callCharacterId = null;
let callStartedAt = 0;
let callStartHistoryCount = 0;
let callTimer = null;
let callAudio = null;
let callAudioUrl = '';
let pendingCallMemory = null;
let callSpeechSeq = 0;
let editingCharacterId = null;
let charactersReturnTo = 'home';
let pendingAvatar = null;      // 新建角色时先暂存头像，保存角色后再落库
let pendingAvatarUrl = '';
let pendingRefImage = null;    // 生图参考图，同理暂存
let pendingRefImageUrl = '';
let iconUploadTarget = '';
let pendingChatImage = null;   // 聊天里待发送的相册图片
let pendingChatImageUrl = '';
let toolLocationCoords = null; // 手机定位得到的真实坐标

// 通知与后台保活
let notifyAudio = null;        // 自定义提示音播放器
let keepAliveAudio = null;     // 后台保活用的静音音频
let keepAliveUrl = '';
let keepAliveRetryBound = false;
let notifySwReg = null;

// 最近聊天直接带上；更早的内容交给记忆总结
const RECENT_HISTORY_LIMIT = 20;
const AUTO_SUMMARIZE_MIN_NEW = 20;

// 世界书关键词扫描最近多少条对话
const WORLDBOOK_SCAN_LIMIT = 6;

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
  const v = getVoiceSettings();
  $('input-voice-baseurl').value = v.baseUrl;
  $('input-voice-apikey').value = v.apiKey;
  $('input-voice-model').value = v.model;
  $('input-voice-name').value = v.voice;
  const im = getImageSettings();
  $('input-image-baseurl').value = im.baseUrl;
  $('input-image-apikey').value = im.apiKey;
  $('input-image-model').value = im.model;
  $('input-image-size').value = im.size;
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
  setVoiceSettings({
    baseUrl: $('input-voice-baseurl').value.trim(),
    apiKey: $('input-voice-apikey').value.trim(),
    model: $('input-voice-model').value.trim(),
    voice: $('input-voice-name').value.trim(),
  });
  setImageSettings({
    baseUrl: $('input-image-baseurl').value.trim(),
    apiKey: $('input-image-apikey').value.trim(),
    model: $('input-image-model').value.trim(),
    size: $('input-image-size').value.trim(),
  });
}

// ---- 美化：应用壁纸、单个图标与状态栏开关 ----
async function refreshAppearance() {
  const cfg = await getAppearance();
  const apps = Array.from(document.querySelectorAll('.app-icon')).map((b) => b.dataset.app);
  const iconUrls = {};
  await Promise.all(apps.map(async (app) => {
    iconUrls[app] = await getFileUrl(cfg.icons[app] || null);
  }));
  applyAppearance(cfg, await getFileUrl(cfg.wallpaperId), iconUrls);
}

// ---- 通知：浏览器推送 / 自定义提示音 / 后台保活 ----
function notifySupported() {
  return typeof Notification !== 'undefined';
}

function updateNotifyHint() {
  const el = $('notify-status-hint');
  if (!el) return;
  if (!notifySupported()) {
    el.textContent = '当前浏览器不支持系统通知，请换用 Chrome / Safari 等浏览器。';
    return;
  }
  if (Notification.permission === 'granted') {
    el.textContent = '通知权限已授权；页面切到后台时，角色回复会推送浏览器通知。';
  } else if (Notification.permission === 'denied') {
    el.textContent = '通知权限被拒绝，请在浏览器地址栏的网站设置里重新允许通知。';
  } else {
    el.textContent = '尚未授权通知，首次开启或发送测试通知时会请求权限。';
  }
}

async function loadNotificationSettings() {
  const cfg = await getNotificationConfig();
  const enabled = $('chk-notify-enabled');
  const keepAlive = $('chk-keepalive');
  if (enabled) enabled.checked = cfg.enabled;
  if (keepAlive) keepAlive.checked = cfg.keepAlive;
  const nameEl = $('notify-sound-name');
  if (nameEl) {
    nameEl.textContent = cfg.soundId
      ? '当前提示音：' + (cfg.soundName || '已上传')
      : '未设置，使用系统默认提示音';
  }
  const hasSound = !!cfg.soundId;
  if ($('btn-notify-sound-test')) $('btn-notify-sound-test').disabled = !hasSound;
  if ($('btn-notify-sound-clear')) $('btn-notify-sound-clear').disabled = !hasSound;
  updateNotifyHint();
}

// 注册 Service Worker：移动端浏览器只允许通过 Service Worker 弹通知
async function registerNotifyServiceWorker() {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return null;
  try {
    notifySwReg = await navigator.serviceWorker.register('sw.js');
    return notifySwReg;
  } catch (_) {
    return null;
  }
}

async function ensureNotifyPermission() {
  if (!notifySupported()) {
    toast('当前浏览器不支持系统通知');
    return false;
  }
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') {
    updateNotifyHint();
    toast('通知权限已被拒绝，请在浏览器设置里允许通知');
    return false;
  }
  try {
    const permission = await Notification.requestPermission();
    updateNotifyHint();
    return permission === 'granted';
  } catch (_) {
    updateNotifyHint();
    return false;
  }
}

async function sendBrowserNotification(title, options) {
  if (!notifySupported() || Notification.permission !== 'granted') return false;
  const opts = Object.assign({ tag: 'clearcall-reply' }, options || {});
  try {
    if (!notifySwReg && navigator.serviceWorker) {
      notifySwReg = await navigator.serviceWorker.getRegistration();
    }
    if (notifySwReg && notifySwReg.showNotification) {
      await notifySwReg.showNotification(title, opts);
      return true;
    }
  } catch (_) {}
  try {
    new Notification(title, opts);
    return true;
  } catch (_) {
    return false;
  }
}

function stopNotificationAudio() {
  if (!notifyAudio) return;
  try { notifyAudio.pause(); notifyAudio.currentTime = 0; } catch (_) {}
  notifyAudio = null;
}

async function playNotificationSound() {
  stopNotificationAudio();
  let url = '';
  try { url = await getNotificationSoundUrl(); } catch (_) {}
  if (!url || typeof Audio === 'undefined') return false;
  try {
    const audio = new Audio(url);
    audio.volume = 1;
    notifyAudio = audio;
    audio.onended = () => { if (notifyAudio === audio) notifyAudio = null; };
    await audio.play();
    return true;
  } catch (_) {
    return false;
  }
}

async function testBrowserNotification() {
  const ok = await ensureNotifyPermission();
  if (!ok) return;
  const cfg = await getNotificationConfig();
  const played = cfg.soundId ? await playNotificationSound() : false;
  const sent = await sendBrowserNotification('虚拟手机测试通知', {
    body: '通知已开启，角色回复时会在这里提醒你。',
    tag: 'clearcall-test',
    silent: played,
  });
  if (sent) toast('已发送测试通知');
  else toast('通知发送失败，请允许通知权限后再试');
}

// 角色回复通知：仅在页面处于后台、非通话中时推送
async function notifyCharacterReply(characterId, reply) {
  if (callActive) return;
  if (typeof document !== 'undefined' && !document.hidden) return;
  if (!notifySupported() || Notification.permission !== 'granted') return;
  let cfg;
  try { cfg = await getNotificationConfig(); } catch (_) { return; }
  if (!cfg.enabled) return;

  const c = await getCharacter(characterId);
  if (!c) return;
  const body = String(reply || '')
    .replace(/\[\[sticker:[^\]]*\]\]/g, '')
    .replace(/<split>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '发来一条新消息';
  let played = false;
  if (cfg.soundId) played = await playNotificationSound();
  await sendBrowserNotification(c.name || '角色', {
    body,
    tag: 'clearcall-' + characterId,
    silent: played,
  });
}

// 1 秒静音 WAV：循环播放让后台页面尽量不被浏览器挂起
function buildSilentWav(seconds) {
  const sampleRate = 8000;
  const sampleCount = Math.max(1, Math.round(sampleRate * (seconds || 1)));
  const dataSize = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // 字节率
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, dataSize, true);
  return new Blob([buffer], { type: 'audio/wav' });
}

function stopKeepAlive() {
  if (keepAliveAudio) {
    try { keepAliveAudio.pause(); keepAliveAudio.loop = false; } catch (_) {}
    keepAliveAudio.src = '';
    keepAliveAudio = null;
  }
  if (keepAliveUrl) {
    URL.revokeObjectURL(keepAliveUrl);
    keepAliveUrl = '';
  }
}

async function startKeepAlive() {
  if (typeof Audio === 'undefined') return false;
  if (!keepAliveAudio) {
    keepAliveUrl = URL.createObjectURL(buildSilentWav(1));
    const audio = new Audio(keepAliveUrl);
    audio.loop = true;
    audio.volume = 0;
    audio.preload = 'auto';
    keepAliveAudio = audio;
  }
  try {
    await keepAliveAudio.play();
    return true;
  } catch (_) {
    scheduleKeepAliveRetry();
    return false;
  }
}

// 浏览器要求用户手势后才能播放音频：拦截失败时等下一次点击重试
function scheduleKeepAliveRetry() {
  if (keepAliveRetryBound) return;
  keepAliveRetryBound = true;
  const retry = async () => {
    document.removeEventListener('pointerdown', retry);
    document.removeEventListener('touchstart', retry);
    keepAliveRetryBound = false;
    let cfg;
    try { cfg = await getNotificationConfig(); } catch (_) { return; }
    if (cfg.keepAlive) startKeepAlive().catch(() => {});
  };
  document.addEventListener('pointerdown', retry, { once: true });
  document.addEventListener('touchstart', retry, { once: true });
}

async function setKeepAliveEnabled(on) {
  await setNotificationConfig({ keepAlive: !!on });
  if (!on) {
    stopKeepAlive();
    return true;
  }
  const ok = await startKeepAlive();
  if (!ok) toast('浏览器拦截了后台音频，点一下页面即可重试');
  return ok;
}


// ---- 角色应用：新建 / 编辑 / 删除 / 切换 ----
async function openCharacters(returnTo) {
  charactersReturnTo = returnTo || 'home';
  cancelCharacterForm();
  await renderCharactersUI();
  showView(viewCharacters);
}

function openCharacterAdd() {
  editingCharacterId = null;
  resetPendingImages();
  renderCharacterForm(null, '');
}

async function openCharacterEdit(id) {
  const c = await getCharacter(id);
  if (!c) return;
  editingCharacterId = id;
  resetPendingImages();
  const avatarUrl = await getAvatarUrlById(c.avatarId);
  const refUrl = await getReferenceImageUrl(id);
  renderCharacterForm(c, avatarUrl, refUrl);
  const box = $('character-form');
  if (box && box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
}

function resetPendingAvatar() {
  if (pendingAvatarUrl) { URL.revokeObjectURL(pendingAvatarUrl); pendingAvatarUrl = ''; }
  pendingAvatar = null;
}

function resetPendingRefImage() {
  if (pendingRefImageUrl) { URL.revokeObjectURL(pendingRefImageUrl); pendingRefImageUrl = ''; }
  pendingRefImage = null;
}

function resetPendingImages() {
  resetPendingAvatar();
  resetPendingRefImage();
}

function cancelCharacterForm() {
  editingCharacterId = null;
  resetPendingImages();
  const box = $('character-form');
  box.hidden = true;
  box.innerHTML = '';
}

// 读取角色表单：基础信息 + 语音绑定 + 生图绑定
function readCharacterForm() {
  return {
    name: $('char-name-input').value.trim(),
    persona: $('char-persona-input').value,
    voice: {
      enabled: $('char-voice-enabled').checked,
      voiceId: $('char-voice-id').value.trim(),
      model: $('char-voice-model').value.trim(),
    },
    image: {
      enabled: $('char-image-enabled').checked,
      prompt: $('char-image-prompt').value,
    },
  };
}

async function saveCharacterForm() {
  const data = readCharacterForm();
  if (!data.name) { toast('角色名字不能为空'); return; }
  try {
    let id = editingCharacterId;
    if (id) {
      await updateCharacterRecord(id, data);
    } else {
      const rec = await addCharacter(data);
      id = rec.id;
    }
    if (pendingAvatar) {
      await setCharacterAvatarBlob(id, pendingAvatar.blob, pendingAvatar.type, pendingAvatar.name);
    }
    if (pendingRefImage) {
      await setCharacterReferenceImage(id, pendingRefImage.blob, pendingRefImage.type, pendingRefImage.name);
    }
    resetPendingImages();
    editingCharacterId = null;
    const box = $('character-form');
    box.hidden = true;
    box.innerHTML = '';
    await renderCharactersUI();
    await updateChatTitle();
    toast('角色已保存');
  } catch (err) {
    toast('保存失败：' + (err && err.message ? err.message : err));
  }
}

async function clearCharacterAvatarForm() {
  try {
    if (editingCharacterId) await clearCharacterAvatar(editingCharacterId);
  } catch (err) {
    toast('清除头像失败：' + (err && err.message ? err.message : err));
    return;
  }
  resetPendingAvatar();
  const preview = $('char-avatar-preview');
  const nameInput = $('char-name-input');
  if (preview) preview.innerHTML = charAvatarHTML('', nameInput ? nameInput.value : '');
  await renderCharactersUI();
}

async function clearCharacterRefImageForm() {
  try {
    if (editingCharacterId) await clearCharacterReferenceImage(editingCharacterId);
  } catch (err) {
    toast('清除参考图失败：' + (err && err.message ? err.message : err));
    return;
  }
  if (pendingRefImageUrl) { URL.revokeObjectURL(pendingRefImageUrl); pendingRefImageUrl = ''; }
  pendingRefImage = null;
  const preview = $('char-ref-preview');
  if (preview) preview.innerHTML = '<span>无</span>';
}

async function switchActiveCharacter(id) {
  try {
    await setActiveCharacter(id);
    await updateChatTitle();
    if (charactersReturnTo === 'chat') {
      await openChat();
      toast('已切换角色');
      return;
    }
    await renderCharactersUI();
    toast('已切换角色');
  } catch (err) {
    toast('切换失败：' + (err && err.message ? err.message : err));
  }
}

async function deleteCharacterConfirm(id) {
  const c = await getCharacter(id);
  if (!c) return;
  const ok = window.confirm('删除角色「' + (c.name || '未命名角色') + '」会同时删除它的聊天记录、记忆和绑定的世界书条目，确定删除？');
  if (!ok) return;
  try {
    await deleteCharacter(id);
    if (editingCharacterId === id) cancelCharacterForm();
    if (wbScope === 'char:' + id) wbScope = 'global';
    await renderCharactersUI();
    await updateChatTitle();
    toast('角色已删除');
  } catch (err) {
    toast('删除失败：' + (err && err.message ? err.message : err));
  }
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
  const { activeId } = await getCharacters();
  if (!activeId) {
    toast('先创建一个角色，再开始聊天');
    await openCharacters('chat');
    openCharacterAdd();
    return;
  }
  await updateChatTitle();
  await renderChat();
  await updateGenerateButton();
  await refreshDirectiveChip();
  showView(viewChat);
}

// ---- 电话编排 ----
async function openCallPicker() {
  clearCountdown();
  await renderCallPicker();
  showView(viewCallPicker);
}

async function startCall(characterId) {
  if (chatSending) { toast('对方正在回复，稍等再拨'); return; }
  const c = await getCharacter(characterId);
  if (!c) { toast('角色不存在'); return; }

  callStartHistoryCount = (await getHistory(characterId)).length;
  await setActiveCharacter(characterId);
  clearCountdown();
  stopCallAudio();
  callActive = true;
  callCharacterId = characterId;
  callStartedAt = Date.now();
  if (callTimer) clearInterval(callTimer);
  setCallTimer(0);
  callTimer = setInterval(() => {
    setCallTimer(Math.floor((Date.now() - callStartedAt) / 1000));
  }, 1000);

  $('input-call').value = '';
  await updateCallScreen(c);
  setCallStatus(c.voice && c.voice.enabled ? '正在通话 · 语音已开启' : '正在通话');
  showView(viewCall);
}

function endCall() {
  const characterId = callCharacterId;
  const startCount = callStartHistoryCount;
  callActive = false;
  callCharacterId = null;
  if (callTimer) { clearInterval(callTimer); callTimer = null; }
  setCallTimer(0);
  setCallStatus('正在通话');
  stopCallAudio();
  showView(viewHome);

  // 通话内容在挂断后写入记忆；若还有回复在路上，等回复落库后再整理
  if (characterId) {
    if (chatSending) pendingCallMemory = { characterId, startCount };
    else rememberCallToMemory(characterId, startCount).catch(() => {});
  }
}

async function sendCallMessage() {
  const input = $('input-call');
  const msg = input.value.trim();
  if (!msg) return;
  if (chatSending) { toast('对方正在回复…'); return; }
  const characterId = await getActiveCharacterId();
  if (!characterId) return;

  stopCallAudio();
  await mutateHistory((arr) => arr.push({ role: 'user', content: msg }), characterId);
  input.value = '';
  await renderCallMessages();
  // 通话模式忽略触发设置：发一条就立即请求回复
  await flushQueue();
}

async function redialCall() {
  if (chatSending) { toast('对方正在回复…'); return; }
  if (!ensureConfigured()) return;
  const characterId = await getActiveCharacterId();
  if (!characterId) return;
  const history = await getHistory(characterId);
  if (!history.length) { toast('还没有可以重拨的对话'); return; }

  if (history[history.length - 1].role === 'assistant') {
    const before = history.length - 2;
    let j = before;
    while (j >= 0 && history[j].role === 'user') j--;
    if (j === before) { toast('没有可以重新生成的消息'); return; }
    await mutateHistory((arr) => {
      if (arr.length && arr[arr.length - 1].role === 'assistant') arr.pop();
    }, characterId);
  }
  const pending = await getPending();
  if (!pending.length) { toast('没有可以重新生成的消息'); return; }

  stopCallAudio();
  await renderCallMessages();
  await flushQueue();
}

function callSpeechText(content) {
  return String(content || '')
    .replace(/\[\[sticker:[^\]]+\]\]/gi, '')
    .replace(/<split>/gi, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function playCallSpeech(character, text, index, manual) {
  const clean = callSpeechText(text);
  if (!clean) {
    if (manual) toast('这条回复没有可朗读的文字');
    return;
  }

  const v = getVoiceSettings();
  const baseUrl = v.baseUrl || getSettings().baseUrl;
  const apiKey = v.apiKey || getSettings().apiKey;
  const model = (character.voice && character.voice.model) || v.model || 'tts-1';
  const voice = (character.voice && character.voice.voiceId) || v.voice || 'alloy';

  if (!baseUrl || !apiKey) {
    setCallVoiceButtonState(index, 'failed');
    if (manual) toast('请先在「设置 → 语音服务」填写接口地址和 Key');
    return;
  }

  stopCallAudio();
  const seq = callSpeechSeq;
  setCallVoiceButtonState(index, 'loading');
  let result;
  try {
    result = await requestSpeech({ baseUrl, apiKey, model, voice, input: clean.slice(0, 2000) });
  } catch (err) {
    result = { ok: false, reason: err && err.message ? err.message : '语音请求失败' };
  }
  if (seq !== callSpeechSeq) return; // 期间挂断或开始了新的朗读

  if (!result || !result.ok) {
    setCallVoiceButtonState(index, 'failed');
    if (manual) toast('语音播放失败：' + ((result && result.reason) || '未知错误'));
    return;
  }

  playCallBlob(result.blob, index);
}

function playCallBlob(blob, index) {
  stopCallAudio();
  let url = '';
  try {
    url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    callAudio = audio;
    callAudioUrl = url;
    audio.addEventListener('ended', () => {
      if (callAudio === audio) {
        callAudio = null;
        callAudioUrl = '';
        URL.revokeObjectURL(url);
        setCallVoiceButtonState(index, 'idle');
      }
    });
    audio.addEventListener('error', () => {
      if (callAudio === audio) {
        callAudio = null;
        callAudioUrl = '';
        URL.revokeObjectURL(url);
        setCallVoiceButtonState(index, 'failed');
      }
    });
    setCallVoiceButtonState(index, 'playing');
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => setCallVoiceButtonState(index, 'blocked'));
    }
  } catch (_) {
    if (url) URL.revokeObjectURL(url);
    callAudio = null;
    callAudioUrl = '';
    setCallVoiceButtonState(index, 'failed');
  }
}

function stopCallAudio() {
  callSpeechSeq += 1;
  if (callAudio) {
    try { callAudio.pause(); } catch (_) {}
    callAudio = null;
  }
  if (callAudioUrl) {
    try { URL.revokeObjectURL(callAudioUrl); } catch (_) {}
    callAudioUrl = '';
  }
  resetCallVoiceButtons();
}

async function speakCallMessage(index) {
  const c = await getCharacter(callCharacterId || undefined);
  if (!c) return;
  if (!c.voice || !c.voice.enabled) { toast('该角色还没有开启语音'); return; }
  const history = await getHistory();
  const m = history[index];
  if (!m || m.role !== 'assistant' || m.error) return;
  await playCallSpeech(c, m.content, index, true);
}

async function autoPlayCallReply(reply, index) {
  if (!callActive || !callCharacterId) return;
  const c = await getCharacter(callCharacterId);
  if (!c || !c.voice || !c.voice.enabled) return;
  await playCallSpeech(c, reply, index, false);
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

async function currentChatPayload(message, priorHistory, characterId) {
  const id = characterId || await getActiveCharacterId();
  const c = id ? await getCharacter(id) : null;
  const { entries } = await getMemory(id);
  const worldbook = await getWorldbook();
  const world = buildWorldInfo(worldbook, worldbookScanText(priorHistory, message), id);

  let persona = (c && c.persona) || '';
  const stickers = id ? await getStickers(id) : [];
  if (stickers.length) persona += '\n\n' + buildStickerPersonaInstruction(stickers);

  const memory = formatMemory(entries);
  const directive = id ? await getPendingDirective(id) : '';
  let worldAfter = world.after || '';
  if (directive) {
    worldAfter += (worldAfter ? '\n\n' : '') +
      '【本轮系统指令（最高优先级，越过角色设定）】\n' + directive +
      '\n请严格执行以上指令来调整本轮回复，不要向用户解释这条指令。';
  }

  return {
    baseUrl: $('input-baseurl').value.trim(),
    apiKey: $('input-apikey').value.trim(),
    model: getCurrentModel(),
    persona,
    memory,
    history: Array.isArray(priorHistory) ? priorHistory.slice(-RECENT_HISTORY_LIMIT) : priorHistory,
    message,
    worldBefore: world.before,
    worldAfter,
    worldDepth: world.depth,
    directiveUsed: directive,
  };
}

// 让角色知道可以主动发表情包；名称列表供模型选择
function buildStickerPersonaInstruction(stickers) {
  const names = stickers.slice(0, 50).map((s) => s.name).join('、');
  return '【表情包】你可以在回复中发送表情包。需要发送时，单独输出一行 [[sticker:名称]]，' +
    '名称必须是以下之一：' + names + '。不要解释这个标记，也不要编造列表之外的名称。';
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
  if (callActive) return;
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
  await triggerAfterUserSend();
}

// 消息上屏后按触发模式决定何时请求 AI
async function triggerAfterUserSend() {
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
  // 锁定本次请求所属角色：期间切换角色也不会把回复写错人
  const characterId = await getActiveCharacterId();
  if (!characterId) return;
  const history = await getHistory(characterId);
  let i = history.length - 1;
  while (i >= 0 && history[i].role === 'user') i--;
  const pending = history.slice(i + 1);
  if (pending.length === 0) return;
  if (!ensureConfigured()) return;

  clearCountdown();

  const combined = pending.map((m) => m.content).join('\n');
  const priorHistory = history.slice(0, history.length - pending.length);
  const baseIndex = history.length; // 回复要插在 pending 之后
  const payload = await currentChatPayload(combined, priorHistory, characterId);

  setChatSending(true);
  const inCall = callActive && callCharacterId === characterId;
  if (inCall) await appendCallTyping();
  else await appendTyping();

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
  // 角色可能在等待回复期间被删除：这时丢弃回复，避免重建数据
  const stillExists = !!(await getCharacter(characterId));
  if (stillExists) {
    await mutateHistory((arr) => arr.splice(baseIndex, 0, replyMsg), characterId); // 插到这批消息之后、期间新消息之前
    if (result && result.ok) {
      try {
        const pending = await getPendingDirective(characterId);
        if (pending && pending === payload.directiveUsed) await clearPendingDirective(characterId);
      } catch (_) {}
    }
    if ((await getActiveCharacterId()) === characterId) {
      await refreshDirectiveChip();
      await renderChat();
      if (callActive && callCharacterId === characterId) await renderCallMessages();
    }
    if (result && result.ok && callActive && callCharacterId === characterId) {
      autoPlayCallReply(result.reply, baseIndex).catch(() => {});
    }
    if (result && result.ok) {
      notifyCharacterReply(characterId, result.reply).catch(() => {});
    }
  }
  setChatSending(false);
  if (pendingCallMemory && pendingCallMemory.characterId === characterId) {
    const mem = pendingCallMemory;
    pendingCallMemory = null;
    try { await rememberCallToMemory(mem.characterId, mem.startCount); } catch (_) {}
  }
  await afterFlush();
}

async function retryReply(index) {
  if (chatSending) return;
  const characterId = await getActiveCharacterId();
  if (!characterId) return;
  const history = await getHistory(characterId);
  if (index <= 0 || !history[index] || history[index].role !== 'assistant' || !history[index].error) return;

  // 找到这次失败回复对应的连续用户消息（紧邻 index 之前的 user 串）
  let start = index - 1;
  while (start >= 0 && history[start].role === 'user') start--;
  start += 1;
  if (start >= index) return;

  const combined = history.slice(start, index).map((m) => m.content).join('\n');
  const payload = await currentChatPayload(combined, history.slice(0, start), characterId);

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
  if (await getCharacter(characterId)) {
    await mutateHistory((arr) => {
      if (arr[index] && arr[index].role === 'assistant') arr[index] = replyMsg;
    }, characterId);
    if (result && result.ok) {
      try {
        const pending = await getPendingDirective(characterId);
        if (pending && pending === payload.directiveUsed) await clearPendingDirective(characterId);
      } catch (_) {}
    }
    if ((await getActiveCharacterId()) === characterId) {
      await refreshDirectiveChip();
      await renderChat();
    }
    if (result && result.ok) {
      notifyCharacterReply(characterId, result.reply).catch(() => {});
    }
  }
  setChatSending(false);
}

// ---- 聊天功能抽屉：位置 / 图片 / 表情包 / 转账 / 系统指令 ----
async function openChatSheet(view) {
  if (view === 'location') toolLocationCoords = null;
  await renderChatSheet(view);
  $('chat-sheet').hidden = false;
  if (view === 'image') setToolImagePreview(pendingChatImageUrl);
}

function resetPendingChatImage() {
  if (pendingChatImageUrl) { URL.revokeObjectURL(pendingChatImageUrl); pendingChatImageUrl = ''; }
  pendingChatImage = null;
}

function closeChatSheet() {
  $('chat-sheet').hidden = true;
  resetPendingChatImage();
  toolLocationCoords = null;
}

async function refreshDirectiveChip() {
  const chip = $('directive-chip');
  const text = await getPendingDirective();
  if (!text) {
    chip.hidden = true;
    $('directive-chip-text').textContent = '';
    return;
  }
  chip.hidden = false;
  $('directive-chip-text').textContent = text;
  $('directive-chip-text').title = text;
}

async function sendToolUserMessage(message) {
  const characterId = await getActiveCharacterId();
  if (!characterId) { toast('请先创建角色'); return; }
  await mutateHistory((arr) => arr.push(Object.assign({ role: 'user', createdAt: Date.now() }, message)), characterId);
  closeChatSheet();
  if ((await getActiveCharacterId()) === characterId) {
    await renderChat();
    await triggerAfterUserSend();
  }
}

function requestRealLocation() {
  if (!navigator.geolocation) { toast('当前浏览器不支持定位'); return; }
  toast('正在获取当前位置…');
  navigator.geolocation.getCurrentPosition((pos) => {
    const lat = Number(pos.coords.latitude.toFixed(6));
    const lng = Number(pos.coords.longitude.toFixed(6));
    toolLocationCoords = { lat, lng };
    const nameInput = $('tool-loc-name');
    const addrInput = $('tool-loc-address');
    if (nameInput) nameInput.value = '当前位置';
    if (addrInput) addrInput.value = '纬度 ' + lat + '，经度 ' + lng;
    updateToolLocationPreview('当前位置');
    toast('已获取定位，可直接发送');
  }, (err) => {
    const map = { 1: '定位权限被拒绝', 2: '无法获取位置信息', 3: '定位超时' };
    toast((map[err && err.code] || '定位失败') + '，可发送虚拟地点');
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
}

async function sendToolLocation() {
  const name = $('tool-loc-name').value.trim();
  const address = $('tool-loc-address').value.trim();
  if (!name) { toast('请填写地点名称'); return; }
  const location = { name, address, virtual: !toolLocationCoords };
  if (toolLocationCoords) {
    location.lat = toolLocationCoords.lat;
    location.lng = toolLocationCoords.lng;
  }
  const content = '[位置] ' + name + (address ? '（' + address + '）' : '');
  await sendToolUserMessage({ kind: 'location', content, location });
}

async function sendToolImage() {
  const desc = $('tool-image-desc').value.trim();
  if (!pendingChatImage && !desc) { toast('请选择图片或填写图片描述'); return; }
  let imageId = null;
  try {
    if (pendingChatImage) {
      imageId = genId();
      await putFile({
        id: imageId,
        name: pendingChatImage.name || 'chat-image',
        type: pendingChatImage.type || 'image/jpeg',
        blob: pendingChatImage.blob,
      });
    }
  } catch (err) {
    toast('图片保存失败：' + (err && err.message ? err.message : err));
    return;
  }
  const content = '[图片]' + (desc ? ' ' + desc : '');
  await sendToolUserMessage({ kind: 'image', content, description: desc, imageId });
}

async function sendToolSticker(stickerId) {
  const stickers = await getStickers();
  const s = stickers.find((x) => x.id === stickerId);
  if (!s) return;
  await sendToolUserMessage({
    kind: 'sticker',
    content: '[表情包] ' + s.name,
    sticker: { id: s.id, name: s.name, url: s.url },
  });
}

async function deleteStickerConfirm(stickerId) {
  if (!window.confirm('删除这个表情包？已发送的消息不受影响。')) return;
  try {
    await deleteSticker(null, stickerId);
    await renderChatSheet('sticker');
    toast('已删除表情包');
  } catch (err) {
    toast('删除失败：' + (err && err.message ? err.message : err));
  }
}

async function sendToolTransfer() {
  const amount = parseFloat($('tool-transfer-amount').value);
  const note = $('tool-transfer-note').value.trim();
  if (!Number.isFinite(amount) || amount <= 0) { toast('请输入大于 0 的金额'); return; }
  if (amount > 100000000) { toast('金额过大'); return; }
  const fixed = Math.round(amount * 100) / 100;
  const content = '[转账] ¥' + fixed.toFixed(2) + (note ? ' ' + note : '');
  await sendToolUserMessage({ kind: 'transfer', content, transfer: { amount: fixed, note } });
}

async function applyDirectiveFromTool() {
  const text = $('tool-directive-text').value.trim();
  if (!text) { toast('请填写系统指令'); return; }
  try {
    await setPendingDirective(text);
    closeChatSheet();
    await refreshDirectiveChip();
    toast('已应用，下一轮回复生效');
  } catch (err) {
    toast('保存失败：' + (err && err.message ? err.message : err));
  }
}

async function clearDirective() {
  try {
    await clearPendingDirective();
    await refreshDirectiveChip();
    toast('已清除系统指令');
  } catch (err) {
    toast('清除失败：' + (err && err.message ? err.message : err));
  }
}

// ---- 表情包导入：URL 文本 / txt / docx ----
function extractImageUrls(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s<>"'，。；、）)】]+/gi) || [];
  const seen = new Set();
  const urls = [];
  matches.forEach((raw) => {
    const u = raw.replace(/[.,;:!?]+$/, '');
    if (!seen.has(u)) { seen.add(u); urls.push(u); }
  });
  return urls;
}

async function importStickerText(text) {
  const urls = extractImageUrls(text);
  if (!urls.length) { toast('没有识别到图片链接'); return; }
  try {
    const added = await addStickers(null, urls.map((url) => ({ url })));
    await renderChatSheet('sticker');
    toast(added.length ? '已导入 ' + added.length + ' 个表情包' : '这些链接已经导入过了');
  } catch (err) {
    toast('导入失败：' + (err && err.message ? err.message : err));
  }
}

// docx 是 zip：读中央目录，解出 word/document.xml
async function readZipEntry(file, entryName) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let eocd = -1;
  const min = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 docx 文件');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const fnLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(buf.subarray(off + 46, off + 46 + fnLen));
    if (name === entryName) {
      const lfn = dv.getUint16(localOff + 26, true);
      const lex = dv.getUint16(localOff + 28, true);
      const start = localOff + 30 + lfn + lex;
      const data = buf.subarray(start, start + compSize);
      if (method === 0) return new TextDecoder().decode(data);
      if (method !== 8) throw new Error('docx 使用了不支持的压缩方式');
      if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持解压 docx，请改用 txt');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(stream).text();
    }
    off += 46 + fnLen + extraLen + commentLen;
  }
  throw new Error('docx 缺少内容文件');
}

function xmlToPlainText(xml) {
  return String(xml || '')
    .replace(/<w:p[^>]*>/g, '\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

async function extractDocxText(file) {
  let text = '';
  try { text += xmlToPlainText(await readZipEntry(file, 'word/document.xml')); } catch (_) {}
  try { text += '\n' + (await readZipEntry(file, 'word/_rels/document.xml.rels')); } catch (_) {}
  return text;
}

async function importStickerFile(file) {
  if (!file) return;
  try {
    let text;
    if (/\.docx$/i.test(file.name) || /wordprocessingml/.test(file.type)) {
      text = await extractDocxText(file);
    } else if (/\.txt$/i.test(file.name) || /^text\//.test(file.type)) {
      text = await file.text();
    } else {
      toast('只支持 txt 或 docx 文件');
      return;
    }
    await importStickerText(text);
  } catch (err) {
    toast('文件读取失败：' + (err && err.message ? err.message : err));
  }
}

async function openMemory() {
  const { activeId } = await getCharacters();
  if (!activeId) {
    toast('先在「角色」里创建一个角色');
    await openCharacters('home');
    return;
  }
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

// 通话结束后把新增对话写入记忆：优先走记忆摘要服务，失败时退回本地摘要，避免内容丢失
async function rememberCallToMemory(characterId, startCount) {
  const history = await getHistory(characterId);
  if (history.length <= startCount) return;
  const { entries, lastSummarizedCount } = await getMemory(characterId);
  const from = Math.max(0, Math.min(lastSummarizedCount, history.length));
  const pending = history.slice(from);
  if (!pending.length) return;

  const content = historyToText(pending);
  const ms = getEffectiveMemorySettings();
  let summaryEntries = null;
  if (ms.baseUrl && ms.apiKey && ms.model) {
    try {
      const data = await requestMemorySummary({
        baseUrl: ms.baseUrl, apiKey: ms.apiKey, model: ms.model,
        content, existing: formatMemory(entries),
      });
      if (data.ok && Array.isArray(data.entries) && data.entries.length) {
        summaryEntries = data.entries;
      }
    } catch (_) { /* 摘要失败时走本地兜底 */ }
  }

  // 摘要期间角色可能已被删除，避免把记忆写回已删除的角色
  if (!(await getCharacter(characterId))) return;

  if (summaryEntries) {
    await mergeMemoryEntries(summaryEntries, characterId);
  } else {
    const brief = content.length > 400 ? content.slice(0, 400) + '…' : content;
    await addMemoryEntry({ category: 'event', text: '通话内容：' + brief }, characterId);
  }

  await setLastSummarizedCount(history.length, characterId);
  if ((await getActiveCharacterId()) === characterId) toast('通话内容已写入记忆');
}

// 手动「整理」：把尚未总结的聊天内容提炼成记忆
async function summarizeChatToMemory() {
  const ms = getEffectiveMemorySettings();
  if (!ms.baseUrl || !ms.apiKey || !ms.model) {
    toast('请先在「设置」填好记忆服务地址、Key 和模型');
    return;
  }
  const characterId = await getActiveCharacterId();
  if (!characterId) { toast('请先创建角色'); return; }
  const history = await getHistory(characterId);
  const { entries, lastSummarizedCount } = await getMemory(characterId);
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
    await mergeMemoryEntries(newEntries, characterId);
    await setLastSummarizedCount(history.length, characterId);
    await renderMemory();
    toast('已整理 ' + newEntries.length + ' 条记忆');
  } catch (err) {
    toast('整理失败：' + (err && err.message ? err.message : err));
  }
}

// 自动整理：聊天较长后，把超出最近窗口的旧内容悄悄总结（失败不打扰）
async function autoSummarizeIfNeeded() {
  const characterId = await getActiveCharacterId();
  if (!characterId) return;
  const history = await getHistory(characterId);
  const { entries, lastSummarizedCount } = await getMemory(characterId);
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
      await mergeMemoryEntries(data.entries || [], characterId);
      await setLastSummarizedCount(targetEnd, characterId);
    }
  } catch (_) { /* 自动整理失败静默 */ }
}

// ---- 世界书：触发判定与提示词组装 ----
// 关键词是匹配条件；概率是命中之后的独立随机开关。
function worldbookScanText(priorHistory, message) {
  const recent = Array.isArray(priorHistory) ? priorHistory.slice(-WORLDBOOK_SCAN_LIMIT) : [];
  const chatText = recent.map((m) => (m && m.content) ? String(m.content) : '').join('\n');
  return chatText + '\n' + String(message || '');
}

function worldbookKeywordHit(entry, text) {
  const keywords = Array.isArray(entry.keywords) ? entry.keywords.filter((k) => String(k).trim()) : [];
  if (!keywords.length) return true; // 无关键词 = 无条件触发
  const hay = String(text || '').toLowerCase();
  return keywords.some((k) => hay.includes(String(k).toLowerCase()));
}

function worldbookProbabilityPass(entry) {
  if (!entry.probabilityEnabled) return true; // 未启用概率 = 命中即生效
  const p = Number(entry.probability);
  const percent = Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 100;
  return Math.random() * 100 < percent;
}

// 返回 { before, after, depth: [{ content, depth }] }，已按权重从高到低排列
// 全局条目所有角色都参与匹配；角色条目只匹配绑定的当前角色。
function buildWorldInfo(entries, text, characterId) {
  const matched = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && (e.scope === 'global' || (e.scope === 'character' && characterId && e.characterId === characterId)))
    .filter((e) => String(e.content || '').trim())
    .filter((e) => worldbookKeywordHit(e, text))
    .filter((e) => worldbookProbabilityPass(e))
    .sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0) || (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));

  const before = [];
  const after = [];
  const depth = [];
  matched.forEach((e) => {
    const content = String(e.content).trim();
    if (e.position === 'after') after.push(content);
    else if (e.position === 'depth') depth.push({ content, depth: Math.max(0, parseInt(e.depth, 10) || 0) });
    else before.push(content);
  });
  return { before: before.join('\n\n'), after: after.join('\n\n'), depth };
}

// ---- 世界书应用编排 ----
function worldbookScopeCharacterId(scope) {
  return String(scope || '').startsWith('char:') ? scope.slice(5) : null;
}

function worldbookEntryInScope(e, scope) {
  if (scope === 'global') return e.scope === 'global';
  const cid = worldbookScopeCharacterId(scope);
  return !!(cid && e.scope === 'character' && e.characterId === cid);
}

async function openWorldbook() {
  cancelWorldbookForm();
  await renderWorldbookUI();
  showView(viewWorldbook);
}

async function renderWorldbookUI() {
  const { list: characters } = await getCharacters();
  const scopes = [{ key: 'global', label: '全局（所有角色）' }].concat(
    characters.map((c) => ({ key: 'char:' + c.id, label: '角色：' + (c.name || '未命名角色') }))
  );
  if (wbScope !== 'global' && !scopes.some((s) => s.key === wbScope)) wbScope = 'global';
  renderWorldbookScopeSelect(scopes, wbScope);

  const entries = await getWorldbook();
  const list = entries
    .filter((e) => worldbookEntryInScope(e, wbScope))
    .sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0) || (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
  renderWorldbookList(list);
}

function switchWorldbookScope(scope) {
  if (scope !== 'global' && !worldbookScopeCharacterId(scope)) return;
  if (scope === wbScope) return;
  wbScope = scope;
  cancelWorldbookForm();
  renderWorldbookUI();
}

async function openWorldbookAdd() {
  editingWorldbookId = null;
  const { list } = await getCharacters();
  const defaultBind = worldbookScopeCharacterId(wbScope) || 'global';
  renderWorldbookForm(null, list, defaultBind);
}

async function openWorldbookEdit(id) {
  const entries = await getWorldbook();
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  editingWorldbookId = id;
  const { list } = await getCharacters();
  renderWorldbookForm(e, list);
}

function cancelWorldbookForm() {
  editingWorldbookId = null;
  const box = $('wb-form');
  box.hidden = true;
  box.innerHTML = '';
}

function readWorldbookForm() {
  const content = $('wb-content').value.trim();
  if (!content) { toast('条目内容不能为空'); return null; }

  const position = $('wb-position').value;
  const depth = Math.max(0, parseInt($('wb-depth').value, 10) || 0);
  let weight = parseFloat($('wb-weight').value);
  if (!Number.isFinite(weight)) weight = 10;
  let probability = parseInt($('wb-probability').value, 10);
  if (!Number.isFinite(probability)) probability = 100;
  probability = Math.max(0, Math.min(100, probability));

  const characterId = ($('wb-bind').value && $('wb-bind').value !== 'global') ? $('wb-bind').value : null;
  return {
    scope: characterId ? 'character' : 'global',
    characterId,
    content,
    keywords: parseWorldbookKeywords($('wb-keywords').value),
    position: WORLDBOOK_POSITION_LABELS[position] ? position : 'before',
    depth,
    weight,
    probabilityEnabled: $('wb-prob-enabled').checked,
    probability,
  };
}

async function saveWorldbookForm() {
  const data = readWorldbookForm();
  if (!data) return;
  try {
    if (editingWorldbookId) await updateWorldbookEntry(editingWorldbookId, data);
    else await addWorldbookEntry(data);
    wbScope = data.characterId ? 'char:' + data.characterId : 'global';
    cancelWorldbookForm();
    await renderWorldbookUI();
    toast('条目已保存');
  } catch (err) {
    toast('保存失败：' + (err && err.message ? err.message : err));
  }
}

async function deleteWorldbookConfirm(id) {
  try {
    await deleteWorldbookEntry(id);
    await renderWorldbookUI();
    toast('已删除');
  } catch (err) {
    toast('删除失败：' + (err && err.message ? err.message : err));
  }
}

async function exportWorldbook() {
  try {
    const entries = (await getWorldbook()).filter((e) => worldbookEntryInScope(e, wbScope));
    if (!entries.length) { toast('当前列表没有条目'); return; }
    let label = '全局';
    if (wbScope !== 'global') {
      const c = await getCharacter(worldbookScopeCharacterId(wbScope));
      label = (c && c.name) || '角色';
    }
    const data = {
      app: 'clearcall-worldbook',
      version: 1,
      scope: wbScope,
      exportedAt: new Date().toISOString(),
      entries,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '世界书-' + label + '-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('世界书已导出');
  } catch (err) {
    toast('导出失败：' + (err && err.message ? err.message : err));
  }
}

async function importWorldbookFile(e) {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const raw = Array.isArray(data) ? data : (data && Array.isArray(data.entries) ? data.entries : null);
    if (!raw) throw new Error('文件里没有世界书条目');
    const characterId = worldbookScopeCharacterId(wbScope);
    const items = raw.map((x) => Object.assign({}, x, {
      id: undefined,
      scope: characterId ? 'character' : 'global',
      characterId,
    }));
    const added = await addWorldbookEntries(items);
    if (!added.length) throw new Error('没有有效条目（内容不能为空）');
    await renderWorldbookUI();
    toast('已导入 ' + added.length + ' 条');
  } catch (err) {
    toast('导入失败：' + (err && err.message ? err.message : err));
  }
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
      loadTriggerSettings();
      refreshAppearance();
      loadNotificationSettings().catch(() => {});
      $('result').hidden = true;
      showView(viewSettings);
    } else if (app === 'chat') {
      openChat();
    } else if (app === 'phone') {
      openCallPicker();
    } else if (app === 'characters') {
      openCharacters('home');
    } else if (app === 'memory') {
      openMemory();
    } else if (app === 'worldbook') {
      openWorldbook();
    } else {
      const name = btn.querySelector('.app-name').textContent;
      toast('「' + name + '」功能开发中，请先使用「设置」');
    }
  });
});

$('btn-back').addEventListener('click', () => { save(); showView(viewHome); });

function bindKeyToggle(inputId, btnId) {
  const btn = $(btnId);
  btn.addEventListener('click', () => {
    const inp = $(inputId);
    const revealing = inp.type === 'password';
    inp.type = revealing ? 'text' : 'password';
    btn.textContent = revealing ? '隐藏' : '显示';
  });
}
bindKeyToggle('input-apikey', 'btn-toggle-key');
bindKeyToggle('input-memory-apikey', 'btn-toggle-memory-key');
bindKeyToggle('input-voice-apikey', 'btn-toggle-voice-key');
bindKeyToggle('input-image-apikey', 'btn-toggle-image-key');

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
$('btn-chat-back').addEventListener('click', () => { closeChatSheet(); showView(viewHome); });
$('btn-chat-config').addEventListener('click', () => openCharacters('chat'));

// 角色应用
$('btn-characters-back').addEventListener('click', () => showView(viewHome));
$('btn-character-add').addEventListener('click', openCharacterAdd);
$('file-char-avatar').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const blob = await fileToAvatar(f);
    pendingAvatar = { blob, type: 'image/jpeg', name: f.name };
    if (pendingAvatarUrl) URL.revokeObjectURL(pendingAvatarUrl);
    pendingAvatarUrl = URL.createObjectURL(blob);
    const preview = $('char-avatar-preview');
    const nameInput = $('char-name-input');
    if (preview) preview.innerHTML = charAvatarHTML(pendingAvatarUrl, nameInput ? nameInput.value : '');
    toast('头像已选择，保存角色后生效');
  } catch (err) {
    toast(err && err.message ? err.message : '头像读取失败');
  }
});
$('file-char-ref').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const blob = await fileToReferenceImage(f);
    if (pendingRefImageUrl) URL.revokeObjectURL(pendingRefImageUrl);
    pendingRefImage = { blob, type: 'image/jpeg', name: f.name };
    pendingRefImageUrl = URL.createObjectURL(blob);
    const preview = $('char-ref-preview');
    if (preview) preview.innerHTML = '<img class="msg-avatar-img" src="' + pendingRefImageUrl + '" alt="" />';
    toast('参考图已选择，保存角色后生效');
  } catch (err) {
    toast(err && err.message ? err.message : '参考图读取失败');
  }
});

// 记忆应用
$('btn-memory-back').addEventListener('click', () => showView(viewHome));
$('btn-memory-summarize').addEventListener('click', summarizeChatToMemory);
$('btn-memory-add').addEventListener('click', openMemoryAdd);

// 世界书应用
$('btn-wb-back').addEventListener('click', () => showView(viewHome));
$('btn-wb-add').addEventListener('click', openWorldbookAdd);
$('btn-wb-export').addEventListener('click', exportWorldbook);
$('btn-wb-import').addEventListener('click', () => $('file-wb-import').click());
$('file-wb-import').addEventListener('change', importWorldbookFile);
$('wb-scope-select').addEventListener('change', (e) => switchWorldbookScope(e.target.value));

// 美化：壁纸 / 图标壁纸 / 状态栏
$('btn-wallpaper-pick').addEventListener('click', () => $('file-wallpaper').click());
$('btn-wallpaper-clear').addEventListener('click', async () => {
  try {
    await clearAppearanceImage('wallpaper');
    await refreshAppearance();
    toast('已恢复默认壁纸');
  } catch (err) {
    toast('恢复失败：' + (err && err.message ? err.message : err));
  }
});
$('file-wallpaper').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const blob = await fileToWallpaper(f);
    await setAppearanceImageBlob('wallpaper', blob, blob.type, f.name);
    await refreshAppearance();
    toast('壁纸已更新');
  } catch (err) {
    toast('壁纸设置失败：' + (err && err.message ? err.message : err));
  }
});

$('icon-custom-list').addEventListener('click', (e) => {
  const pick = e.target.closest('[data-icon-pick]');
  if (pick) {
    iconUploadTarget = pick.dataset.iconPick;
    $('file-icon-custom').click();
    return;
  }
  const clear = e.target.closest('[data-icon-clear]');
  if (clear) {
    const app = clear.dataset.iconClear;
    clearAppearanceIcon(app).then(refreshAppearance).then(() => toast('图标已恢复默认')).catch((err) => {
      toast('恢复失败：' + (err && err.message ? err.message : err));
    });
  }
});
$('file-icon-custom').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  const app = iconUploadTarget;
  iconUploadTarget = '';
  e.target.value = '';
  if (!f || !app) return;
  try {
    const blob = await fileToCustomIcon(f);
    await setAppearanceIconBlob(app, blob, blob.type, f.name);
    await refreshAppearance();
    toast('图标已更新');
  } catch (err) {
    toast('图标设置失败：' + (err && err.message ? err.message : err));
  }
});

$('chk-statusbar').addEventListener('change', async () => {
  try {
    await setAppearance({ statusBar: $('chk-statusbar').checked });
    await refreshAppearance();
  } catch (err) {
    toast('状态栏设置失败：' + (err && err.message ? err.message : err));
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
    loadTriggerSettings();
    await refreshAppearance();
    await loadNotificationSettings().catch(() => {});
    try {
      const ncfg = await getNotificationConfig();
      if (ncfg.keepAlive) startKeepAlive().catch(() => {});
      else stopKeepAlive();
    } catch (_) {}
    wbScope = 'global';
    await updateChatTitle();
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

// ---- 电话事件 ----
$('btn-call-picker-back').addEventListener('click', () => showView(viewHome));
$('btn-call-hangup').addEventListener('click', endCall);
$('btn-call-send').addEventListener('click', sendCallMessage);
$('input-call').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendCallMessage();
  }
});
$('btn-call-redial').addEventListener('click', redialCall);

$('btn-chat-plus').addEventListener('click', () => openChatSheet('menu'));
$('btn-chat-sheet-close').addEventListener('click', closeChatSheet);
$('chat-sheet-backdrop').addEventListener('click', closeChatSheet);
$('btn-directive-clear').addEventListener('click', clearDirective);

// 功能抽屉内的按钮统一走事件委托（面板内容会重绘）
$('chat-sheet-body').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-sticker-del]');
  if (del) { await deleteStickerConfirm(del.dataset.stickerDel); return; }

  const sticker = e.target.closest('[data-sticker-send]');
  if (sticker) { await sendToolSticker(sticker.dataset.stickerSend); return; }

  const preset = e.target.closest('[data-loc-preset]');
  if (preset) {
    $('tool-loc-name').value = preset.dataset.locPreset || '';
    $('tool-loc-address').value = preset.dataset.locAddress || '';
    updateToolLocationPreview(preset.dataset.locPreset || '');
    return;
  }

  const tool = e.target.closest('[data-tool]');
  if (tool) { await openChatSheet(tool.dataset.tool); return; }

  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.id === 'btn-tool-loc-real') requestRealLocation();
  else if (btn.id === 'btn-tool-loc-send') await sendToolLocation();
  else if (btn.id === 'btn-tool-image-pick') $('file-chat-image').click();
  else if (btn.id === 'btn-tool-image-clear') { resetPendingChatImage(); setToolImagePreview(''); }
  else if (btn.id === 'btn-tool-image-send') await sendToolImage();
  else if (btn.id === 'btn-sticker-import-text') await importStickerText($('sticker-import-text').value);
  else if (btn.id === 'btn-sticker-import-file') $('file-sticker-import').click();
  else if (btn.id === 'btn-tool-transfer-send') await sendToolTransfer();
  else if (btn.id === 'btn-tool-directive-apply') await applyDirectiveFromTool();
});

$('file-chat-image').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const blob = await fileToImage(f, 720);
    resetPendingChatImage();
    pendingChatImage = { blob, type: 'image/jpeg', name: f.name };
    pendingChatImageUrl = URL.createObjectURL(blob);
    setToolImagePreview(pendingChatImageUrl);
  } catch (err) {
    toast(err && err.message ? err.message : '图片读取失败');
  }
});

$('file-sticker-import').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (f) await importStickerFile(f);
});
$('input-chat').addEventListener('input', () => {
  if (countdownTick) clearCountdown(); // 新输入重置倒计时
});
$('input-chat').addEventListener('blur', () => maybeStartCountdown());

// 触发模式开关
$('chk-instant').addEventListener('change', saveTriggerSettings);
$('chk-batch').addEventListener('change', saveTriggerSettings);
$('chk-countdown').addEventListener('change', saveTriggerSettings);
$('input-countdown-sec').addEventListener('input', saveTriggerSettings);

// 通知：开关 / 测试 / 提示音 / 后台保活
$('chk-notify-enabled').addEventListener('change', async () => {
  const on = $('chk-notify-enabled').checked;
  if (on) {
    const ok = await ensureNotifyPermission();
    if (!ok) {
      $('chk-notify-enabled').checked = false;
      await setNotificationConfig({ enabled: false });
      updateNotifyHint();
      return;
    }
  }
  await setNotificationConfig({ enabled: on });
  updateNotifyHint();
  toast(on ? '通知已开启：页面在后台时会推送角色回复' : '通知已关闭');
});

$('btn-notify-test').addEventListener('click', () => {
  testBrowserNotification().catch(() => toast('测试通知发送失败'));
});

$('btn-notify-sound-pick').addEventListener('click', () => $('file-notify-sound').click());

$('file-notify-sound').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (f.type && !/^audio\//.test(f.type)) {
    toast('请选择音频文件');
    return;
  }
  try {
    await setNotificationSound(f, f.type || 'audio/mpeg', f.name || '提示音');
    await loadNotificationSettings();
    toast('提示音已保存');
  } catch (err) {
    toast('提示音保存失败：' + (err && err.message ? err.message : err));
  }
});

$('btn-notify-sound-test').addEventListener('click', async () => {
  const played = await playNotificationSound();
  if (!played) toast('提示音播放失败，请先点一下页面后重试');
});

$('btn-notify-sound-clear').addEventListener('click', async () => {
  try {
    await clearNotificationSound();
    stopNotificationAudio();
    await loadNotificationSettings();
    toast('提示音已清除');
  } catch (err) {
    toast('清除失败：' + (err && err.message ? err.message : err));
  }
});

$('chk-keepalive').addEventListener('change', async () => {
  try {
    await setKeepAliveEnabled($('chk-keepalive').checked);
  } catch (err) {
    toast('后台保活设置失败：' + (err && err.message ? err.message : err));
  }
});

// 启动：迁移旧数据 → 读取界面
(async function init() {
  try {
    await migrate();
  } catch (err) {
    toast('旧数据迁移失败：' + (err && err.message ? err.message : err));
  }
  loadSaved();
  loadTriggerSettings();
  try { await refreshAppearance(); } catch (_) {}
  try { await updateChatTitle(); } catch (_) {}
  registerNotifyServiceWorker().catch(() => {});
  try {
    const ncfg = await getNotificationConfig();
    if (ncfg.keepAlive) scheduleKeepAliveRetry(); // 等首次点击后启动静音音频
  } catch (_) {}
})();
