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
let callRingTimer = null;
let callConnected = false;
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
let editingUserProfileId = null; // 正在编辑的「我」的人设
let pendingChatImage = null;   // 聊天里待发送的相册图片
let pendingChatImageUrl = '';
let toolLocationCoords = null; // 手机定位得到的真实坐标
let chatStyleCharacterId = null; // 正在编辑聊天方式的角色

// 通知与后台保活
let notifyAudio = null;        // 自定义提示音播放器
let keepAliveAudio = null;     // 后台保活用的静音音频
let keepAliveUrl = '';
let keepAliveRetryBound = false;
let notifySwReg = null;

// 论坛
let forumTab = 'home';
let forumDetailId = null;
let forumEditingPostId = null;
let forumSharePostId = null;
let forumGenerating = false;

// 小说阅读
let currentBookId = null;
let readerChapterIndex = 0;
let readerParagraph = 0;
let readerCharacterId = null;
let readerSending = false;
let readerAnnotating = false;

// 邮箱
let mailFolder = 'inbox';
let mailDetailId = null;
let mailGenerating = false;
let mailSchedulerTimer = null;

// 日记
let diaryCharacterId = null;
let diaryWriting = false;
let diarySchedulerTimer = null;
let diaryLastCheckAt = 0;

// 日程
let scheduleCharacterId = null;
let scheduleGenerating = false;
let scheduleSchedulerTimer = null;
let scheduleLastCheckAt = 0;

// 动态（朋友圈）
let momentsGenerating = false;
let momentsSchedulerTimer = null;
let momentsLastCheckAt = 0;
let momentsReactionBusy = false;
let pendingMomentImage = null;
let pendingMomentImageUrl = '';

// 最近聊天直接带上；更早的内容交给记忆总结
const RECENT_HISTORY_LIMIT = 20;
const AUTO_SUMMARIZE_MIN_NEW = 20;
// 记忆分层：30 条短期 → 1 条长期；5 条长期 → 1 条核心
const MEMORY_LONG_TERM_BATCH = 30;
const MEMORY_CORE_BATCH = 5;

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
  const apps = Array.from(new Set(Array.from(document.querySelectorAll('.app-icon, .dock-icon')).map((b) => b.dataset.app))).filter(Boolean);
  const iconUrls = {};
  await Promise.all(apps.map(async (app) => {
    iconUrls[app] = await getFileUrl(cfg.icons[app] || null);
  }));
  applyAppearance(cfg, await getFileUrl(cfg.wallpaperId), iconUrls);
  refreshIconManagerIfOpen();
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
  setContactsTab('characters');
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
    remark: $('char-remark-input').value.trim(),
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
      const c = await getCharacter(id);
      const avatarUrl = c ? await getAvatarUrlById(c.avatarId) : '';
      await playCharacterSwitchAnimation(c, avatarUrl);
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

// ---- 通讯录：角色 / 我的 两个窗口切换 ----
async function setContactsTab(tab) {
  const isMe = tab === 'me';
  $('contacts-pane-characters').hidden = isMe;
  $('contacts-pane-me').hidden = !isMe;
  document.querySelectorAll('#view-characters .contacts-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.contactsTab === (isMe ? 'me' : 'characters'));
  });
  const title = $('contacts-title');
  if (title) title.textContent = isMe ? '我的' : '通讯录';
  if (isMe) {
    cancelUserProfileForm();
    await refreshUserProfiles();
  }
}

function openUserProfileAdd() {
  editingUserProfileId = null;
  renderUserProfileForm(null);
}

async function openUserProfileEdit(id) {
  const { list } = await getUserProfiles();
  const p = list.find((x) => x.id === id);
  if (!p) return;
  editingUserProfileId = id;
  renderUserProfileForm(p);
  const box = $('user-profile-form');
  if (box && box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
}

function cancelUserProfileForm() {
  editingUserProfileId = null;
  const box = $('user-profile-form');
  if (!box) return;
  box.hidden = true;
  box.innerHTML = '';
}

async function saveUserProfileForm() {
  const name = $('user-profile-name-input').value.trim();
  const persona = $('user-profile-persona-input').value;
  if (!name) { toast('名字不能为空'); return; }
  try {
    if (editingUserProfileId) {
      await updateUserProfile(editingUserProfileId, { name, persona });
    } else {
      const rec = await addUserProfile({ name, persona });
      await setActiveUserProfile(rec.id);
    }
    editingUserProfileId = null;
    cancelUserProfileForm();
    await refreshUserProfiles();
    toast('人设已保存');
  } catch (err) {
    toast('保存失败：' + (err && err.message ? err.message : err));
  }
}

async function switchActiveUserProfile(id) {
  try {
    await setActiveUserProfile(id);
    await refreshUserProfiles();
    toast('已切换人设');
  } catch (err) {
    toast('切换失败：' + (err && err.message ? err.message : err));
  }
}

async function deleteUserProfileConfirm(id) {
  const { list } = await getUserProfiles();
  const p = list.find((x) => x.id === id);
  if (!p) return;
  const ok = window.confirm('删除人设「' + (p.name || '未命名人设') + '」？');
  if (!ok) return;
  try {
    await deleteUserProfile(id);
    if (editingUserProfileId === id) cancelUserProfileForm();
    await refreshUserProfiles();
    toast('人设已删除');
  } catch (err) {
    toast('删除失败：' + (err && err.message ? err.message : err));
  }
}

async function refreshUserProfiles() {
  const { list, activeId } = await getUserProfiles();
  renderUserProfileList(list, activeId);
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
  callStartedAt = 0;
  if (callTimer) { clearInterval(callTimer); callTimer = null; }
  if (callRingTimer) { clearTimeout(callRingTimer); callRingTimer = null; }
  setCallTimer(0);
  setCallConnected(false);

  $('input-call').value = '';
  await updateCallScreen(c);
  setCallStatus('正在呼叫…');
  showView(viewCall);

  // 模拟真实拨号：等待 2-4 秒后才接通
  const ringDelay = 2000 + Math.floor(Math.random() * 2001);
  callRingTimer = setTimeout(() => {
    callRingTimer = null;
    if (!callActive || callCharacterId !== characterId) return;
    connectCall(c);
  }, ringDelay);
}

function connectCall(character) {
  callStartedAt = Date.now();
  if (callTimer) clearInterval(callTimer);
  callTimer = setInterval(() => {
    setCallTimer(Math.floor((Date.now() - callStartedAt) / 1000));
  }, 1000);
  setCallConnected(true);
  setCallStatus(character && character.voice && character.voice.enabled ? '正在通话 · 语音已开启' : '正在通话');
}

function setCallConnected(connected) {
  callConnected = !!connected;
  viewCall.classList.toggle('ringing', !callConnected);
  const input = $('input-call');
  input.disabled = !callConnected;
  input.placeholder = callConnected ? '说点什么…' : '正在呼叫…';
  $('btn-call-send').disabled = !callConnected;
  $('btn-call-redial').disabled = !callConnected;
  if (!callConnected) setCallTimer(0);
}

function endCall() {
  const characterId = callCharacterId;
  const startCount = callStartHistoryCount;
  callActive = false;
  callCharacterId = null;
  if (callRingTimer) { clearTimeout(callRingTimer); callRingTimer = null; }
  if (callTimer) { clearInterval(callTimer); callTimer = null; }
  setCallTimer(0);
  viewCall.classList.remove('ringing');
  const input = $('input-call');
  input.disabled = false;
  input.placeholder = '说点什么…';
  $('btn-call-send').disabled = false;
  $('btn-call-redial').disabled = false;
  callConnected = false;
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
  if (!callConnected) { toast('还在呼叫中，接通后才能说话'); return; }
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
  if (!callConnected) { toast('还在呼叫中，接通后再试'); return; }
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
  const memoryDoc = await getMemory(id);
  const worldbook = await getWorldbook();
  const world = buildWorldInfo(worldbook, worldbookScanText(priorHistory, message), id);

  let persona = (c && c.persona) || '';
  const stylePrompt = buildChatStylePrompt(c && c.chatStyle);
  if (stylePrompt) persona += '\n\n' + stylePrompt;
  const userProfile = await getActiveUserProfile();
  const userPrompt = buildUserPersonaPrompt(userProfile);
  if (userPrompt) persona += '\n\n' + userPrompt;
  const stickers = id ? await getStickers(id) : [];
  if (stickers.length) persona += '\n\n' + buildStickerPersonaInstruction(stickers);
  const scheduleDoc = id ? await getSchedule(id) : null;
  const schedulePrompt = buildScheduleContextPrompt(scheduleDoc);
  if (schedulePrompt) persona += '\n\n' + schedulePrompt;

  const memory = formatMemoryLayers(memoryDoc);
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

// 让角色知道「我」是谁；只注入身份设定，不要求模型复述
function buildUserPersonaPrompt(profile) {
  if (!profile) return '';
  const name = String(profile.name || '').trim();
  const detail = String(profile.persona || '').trim();
  if (!name && !detail) return '';
  return '【关于对方（用户「我」）】' +
    (name ? '正在和你聊天的人叫「' + name + '」。' : '') +
    (detail ? '对方的设定：' + detail : '') +
    '\n以上是对方的身份信息，理解即可，不要直接复述或解释这段设定。';
}

// 让角色知道可以主动发表情包；名称列表供模型选择
function buildStickerPersonaInstruction(stickers) {
  const names = stickers.slice(0, 50).map((s) => s.name).join('、');
  return '【表情包】你可以在回复中发送表情包。需要发送时，单独输出一行 [[sticker:名称]]，' +
    '名称必须是以下之一：' + names + '。这是客户端内部标记，不是给用户看的文字；' +
    '不要输出 id、URL、Markdown、HTML 或其他代码，不要解释标记，也不要编造列表之外的名称。';
}

// ---- 聊天方式：按角色配置口吻并注入提示词 ----
async function openChatStylePage() {
  const id = await getActiveCharacterId();
  if (!id) {
    toast('先在「角色」应用里创建并选择一个角色');
    return;
  }
  const c = await getCharacter(id);
  if (!c) {
    toast('角色不存在，请重新选择');
    return;
  }
  chatStyleCharacterId = id;
  renderChatStylePage(c);
  showView(viewChatStyle);
}

async function saveChatStyle() {
  if (!chatStyleCharacterId) {
    showView(viewChat);
    return;
  }
  await updateCharacterRecord(chatStyleCharacterId, {
    chatStyle: { options: collectChatStyleOptions() },
  });
  toast('聊天方式已保存，下一条回复生效');
  showView(viewChat);
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
  const plus = $('btn-chat-plus');
  if (plus) plus.setAttribute('aria-expanded', 'true');
  if (view === 'image') setToolImagePreview(pendingChatImageUrl);
}

function resetPendingChatImage() {
  if (pendingChatImageUrl) { URL.revokeObjectURL(pendingChatImageUrl); pendingChatImageUrl = ''; }
  pendingChatImage = null;
}

function closeChatSheet() {
  $('chat-sheet').hidden = true;
  const plus = $('btn-chat-plus');
  if (plus) plus.setAttribute('aria-expanded', 'false');
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
  const characterId = await getActiveCharacterId();
  if (characterId) {
    consolidateMemory(characterId)
      .then((changed) => { if (changed) renderMemory(); })
      .catch(() => {});
  }
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
  consolidateMemory(characterId).catch(() => {});
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
    await consolidateMemory(characterId).catch(() => {});
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
      consolidateMemory(characterId).catch(() => {});
    }
  } catch (_) { /* 自动整理失败静默 */ }
}

// ---- 记忆分层：短期每 30 条 -> 长期，长期每 5 条 -> 核心 ----
function localMemoryDigest(content, max) {
  const lines = String(content || '').split('\n').map((s) => s.trim()).filter(Boolean);
  let text = lines.join('；');
  if (!text) return '';
  if (text.length > max) text = text.slice(0, max) + '…';
  return text;
}

// 优先走记忆摘要服务；未配置或失败时用本地摘要兜底，保证内容不丢
async function summarizeMemoryBatch(content, kind) {
  const raw = String(content || '').trim();
  if (!raw) return '';
  const ms = getEffectiveMemorySettings();
  if (ms.baseUrl && ms.apiKey && ms.model) {
    try {
      const data = await requestMemorySummary({
        baseUrl: ms.baseUrl, apiKey: ms.apiKey, model: ms.model,
        content: raw, existing: '',
      });
      if (data.ok && Array.isArray(data.entries) && data.entries.length) {
        const merged = data.entries.map((e) => e.text).filter(Boolean).join('；').trim();
        if (merged) return merged.slice(0, kind === 'core' ? 600 : 800);
      }
    } catch (_) { /* 走本地兜底 */ }
  }
  return localMemoryDigest(raw, kind === 'core' ? 500 : 700);
}

// 防止并发触发造成重复总结
const memoryConsolidating = new Map();
function consolidateMemory(characterId) {
  if (!characterId) return Promise.resolve(false);
  if (memoryConsolidating.has(characterId)) return memoryConsolidating.get(characterId);
  const task = doConsolidateMemory(characterId).finally(() => memoryConsolidating.delete(characterId));
  memoryConsolidating.set(characterId, task);
  return task;
}

async function doConsolidateMemory(characterId) {
  let changed = false;
  let mem = await getMemory(characterId);

  let guard = 0;
  while (mem.entries.length - mem.longTermSourceCount >= MEMORY_LONG_TERM_BATCH && guard < 5) {
    const start = mem.longTermSourceCount;
    const batch = mem.entries.slice(start, start + MEMORY_LONG_TERM_BATCH);
    const content = batch.map((e) => '[' + (MEMORY_CATEGORY_LABELS[e.category] || e.category) + '] ' + e.text).join('\n');
    const text = await summarizeMemoryBatch(content, 'longTerm');
    if (!text) break;
    await addLongTermMemory({ text, count: batch.length }, characterId);
    await setMemoryTierCounts({ longTermSourceCount: start + batch.length }, characterId);
    changed = true;
    guard += 1;
    mem = await getMemory(characterId);
  }

  guard = 0;
  while (mem.longTerm.length - mem.coreSourceCount >= MEMORY_CORE_BATCH && guard < 3) {
    const start = mem.coreSourceCount;
    const batch = mem.longTerm.slice(start, start + MEMORY_CORE_BATCH);
    const text = await summarizeMemoryBatch(batch.map((x) => x.text).join('\n'), 'core');
    if (!text) break;
    await addCoreMemory({ text }, characterId);
    await setMemoryTierCounts({ coreSourceCount: start + batch.length }, characterId);
    changed = true;
    guard += 1;
    mem = await getMemory(characterId);
  }

  return changed;
}

async function deleteMemoryTierConfirm(kind, id) {
  const label = kind === 'core' ? '核心记忆' : '长期记忆';
  if (!window.confirm('删除这条' + label + '？')) return;
  try {
    if (kind === 'core') await deleteCoreMemory(id);
    else await deleteLongTermMemory(id);
    await renderMemory();
    toast(label + '已删除');
  } catch (err) {
    toast('删除失败：' + (err && err.message ? err.message : err));
  }
}

// 聊天注入：核心记忆 -> 长期记忆 -> 最近 20 条短期记忆
function formatMemoryLayers(mem) {
  if (!mem) return '';
  const parts = [];
  const core = (mem.core || []).map((x) => x.text).filter(Boolean);
  if (core.length) parts.push('【核心记忆】\n' + core.join('\n'));
  const longTerm = (mem.longTerm || []).slice(-10).map((x) => x.text).filter(Boolean);
  if (longTerm.length) parts.push('【长期记忆】\n' + longTerm.join('\n'));
  const short = formatMemory((mem.entries || []).slice(-20));
  if (short) parts.push('【短期记忆】\n' + short);
  return parts.join('\n\n');
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

// ===== 论坛 =====
const FORUM_NPC_NAMES = [
  'momo', '一只小咸鱼', '晚风不渡', '打工人小张', '不吃香菜', '橘子汽水',
  '楼下的猫', '电子木鱼', '摸鱼大师', '深夜诗人', '阿巴阿巴', '今天也很困',
  '热心市民李女士', '键盘侠本侠', '路过的风', '芝士就是力量', '早八人',
  '火锅只吃微辣', '已读乱回', '人间清醒（装的）',
];

let forumProfileImageKind = 'avatar';

function pickForumNames(count) {
  const pool = FORUM_NPC_NAMES.slice();
  const out = [];
  while (pool.length && out.length < count) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

function forumApiConfig(forum) {
  const main = getSettings();
  return {
    baseUrl: forum.settings.baseUrl || main.baseUrl,
    apiKey: forum.settings.apiKey || main.apiKey,
    model: forum.settings.model || main.model,
  };
}

function forumBoundWorldbookText(entries, ids) {
  const set = new Set(ids || []);
  return entries.filter((e) => set.has(e.id))
    .map((e) => {
      const kw = Array.isArray(e.keywords) && e.keywords.length ? '【' + e.keywords.join(' / ') + '】' : '';
      return kw + String(e.content || '');
    })
    .filter(Boolean)
    .slice(0, 20)
    .join('\n')
    .slice(0, 3000);
}

function forumCharacterBriefs(characters) {
  return characters.map((c) => {
    const persona = String(c.persona || '').replace(/\s+/g, ' ').slice(0, 180);
    return '- ' + c.name + '（id: ' + c.id + '）' + (persona ? '：' + persona : '');
  }).join('\n');
}

function parseForumJson(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const direct = JSON.parse(s);
    if (Array.isArray(direct)) return direct;
    if (direct && Array.isArray(direct.posts)) return direct.posts;
    if (direct && Array.isArray(direct.comments)) return direct.comments;
  } catch (_) {}
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try {
      const arr = JSON.parse(s.slice(start, end + 1));
      if (Array.isArray(arr)) return arr;
    } catch (_) {}
  }
  return null;
}

function normalizeGeneratedForumPosts(raw, forum, boundChars, targetCount) {
  const list = Array.isArray(raw) ? raw : [];
  const names = pickForumNames(Math.max(6, list.length + 2));
  const used = new Set();
  const charById = new Map(boundChars.map((c) => [c.id, c]));
  const charByName = new Map(boundChars.map((c) => [c.name, c]));
  const posts = [];

  const nextName = () => {
    for (const n of names) {
      if (!used.has(n)) { used.add(n); return n; }
    }
    let name = '路人' + (used.size + 1);
    while (used.has(name)) name += '1';
    used.add(name);
    return name;
  };

  list.forEach((item) => {
    if (!item) return;
    const content = String(item.content || item.text || '').trim();
    if (!content) return;
    let authorType = item.authorType === 'character' ? 'character' : 'npc';
    let character = null;
    if (authorType === 'character') {
      character = charById.get(String(item.characterId || '')) || charByName.get(String(item.authorName || '')) || null;
      if (!character) authorType = 'npc';
    }
    const authorName = authorType === 'character'
      ? character.name
      : String(item.authorName || '').trim() || nextName();
    if (authorType === 'npc') {
      if (used.has(authorName)) return;
      used.add(authorName);
    }
    posts.push({
      authorType,
      authorId: character ? character.id : null,
      authorName,
      title: String(item.title || '').trim(),
      content,
      likes: Math.floor(Math.random() * 40),
    });
  });

  // 有绑定角色时，尽量保证刷新结果里至少有一条角色帖子
  if (boundChars.length && posts.length && !posts.some((p) => p.authorType === 'character')) {
    const pick = boundChars[Math.floor(Math.random() * boundChars.length)];
    const last = posts[posts.length - 1];
    last.authorType = 'character';
    last.authorId = pick.id;
    last.authorName = pick.name;
  }

  return posts.slice(0, targetCount);
}

function activeForumBoard(forum) {
  return forum.boards.find((b) => b.id === forum.activeBoardId) || forum.boards[0];
}

function forumBoardForPost(forum, post) {
  return forum.boards.find((b) => b.id === post.boardId) || activeForumBoard(forum);
}

function buildForumPostPrompt(forum, boundEntries, boundChars, names, count) {
  const board = activeForumBoard(forum);
  const system = [
    '你是中文网络论坛的内容生成器，熟悉贴吧、豆瓣小组、NGA、虎扑、小红书等社区的真实语感。',
    '只输出一个 JSON 数组，不要 Markdown 代码块，不要任何解释或前后缀。',
    '数组每一项格式：{"authorType":"npc","authorName":"网名","title":"帖子标题","content":"帖子正文"}，',
    '角色发帖用：{"authorType":"character","characterId":"角色id","authorName":"角色名","title":"帖子标题","content":"帖子正文"}。',
    '要求：',
    '1. 标题像真实论坛帖子，不要标题党模板；正文 80-220 字，口语化、有具体细节、有生活气，允许吐槽、反转、玩梗。',
    '2. 路人昵称要像真人网名，不要出现「用户123」「网友A」这类占位名。',
    '3. 角色发帖必须符合角色人设和说话风格，不要替用户发言，也不要写成小说旁白。',
    '4. 禁止 AI 腔、禁止总结式说教、禁止每条都正能量收尾。',
  ].join('\n');

  const wb = forumBoundWorldbookText(boundEntries, forum.settings.worldbookIds);
  const chars = forumCharacterBriefs(boundChars);
  const user = [
    '板块：' + board.title,
    '板块简介：' + (board.subtitle || '无'),
    '路人设定与语气：' + board.npcPrompt,
    '世界书：\n' + (wb || '（无）'),
    '可发帖角色：\n' + (chars || '（无，全部用路人）'),
    '可参考的网名：' + names.join('、'),
    '请生成 ' + count + ' 条帖子。' + (boundChars.length ? '其中至少 1 条由角色发布。' : '全部由路人发布。'),
    '只返回 JSON 数组。',
  ].join('\n');
  return { system, user };
}

function buildForumCommentPrompt(forum, post, existing, names) {
  const board = forumBoardForPost(forum, post);
  const system = [
    '你是中文网络论坛的评论生成器，熟悉贴吧、微博、豆瓣、虎扑的跟帖语感。',
    '只输出一个 JSON 数组，不要 Markdown 代码块，不要解释。',
    '格式：[{"name":"网名","content":"评论内容"}]。',
    '评论要短（5-40 字），像真人随手跟帖：接梗、吐槽、补充细节、玩抽象、偶尔抖机灵。',
    '不要礼貌套话，不要 AI 腔，不要每条都讲道理，不要重复同一个梗。',
  ].join('\n');
  const user = [
    '板块：' + board.title,
    '路人设定与语气：' + board.npcPrompt,
    '帖子作者：' + post.authorName,
    post.title ? '帖子标题：' + post.title : '',
    '帖子正文：' + post.content.slice(0, 1200),
    existing.length ? '已有评论：\n' + existing.map((c) => c.name + '：' + c.content).join('\n') : '',
    '参考网名：' + names.join('、'),
    '请生成 3-4 条新评论，只返回 JSON 数组。',
  ].filter(Boolean).join('\n');
  return { system, user };
}

function hideForumPanels() {
  ['forum-settings', 'forum-compose', 'forum-detail', 'forum-share', 'forum-profile-editor'].forEach((id) => {
    const el = $(id);
    if (el) el.hidden = true;
  });
}

async function refreshForumUI() {
  const forum = await getForum();
  const isMe = forumTab === 'me';
  const header = $('view-forum').querySelector('.forum-header');
  if (header) header.hidden = isMe;
  $('forum-board-tabs').hidden = isMe;
  $('forum-board').hidden = isMe;
  $('forum-refresh').hidden = isMe || forumTab !== 'home';
  const fab = $('view-forum').querySelector('.forum-fab');
  if (fab) fab.hidden = isMe;
  const countInput = $('input-forum-refresh-count');
  if (countInput && document.activeElement !== countInput) {
    countInput.value = String(forum.settings.refreshCount || 3);
  }
  renderForumBoard(forum);
  document.querySelectorAll('.forum-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.forumTab === forumTab);
  });
  await renderForumFeed(forum, forumTab);
}

async function openForum() {
  forumTab = 'home';
  forumDetailId = null;
  hideForumPanels();
  showView(viewForum);
  await refreshForumUI();
}

async function openForumDetail(postId) {
  const forum = await getForum();
  const post = forum.posts.find((p) => p.id === postId);
  if (!post) { toast('帖子不存在或已被删除'); return; }
  forumDetailId = postId;
  await renderForumDetail(forum, post);
  $('forum-detail').hidden = false;
}

async function openForumSettings() {
  const forum = await getForum();
  const entries = await getWorldbook();
  const { list } = await getCharacters();
  await renderForumSettings(forum, entries, list);
  $('forum-settings-hint').textContent = '论坛 API 留空时，会沿用主界面的 AI 接口配置。';
  $('forum-settings').hidden = false;
}

async function openForumCompose(postId) {
  const forum = await getForum();
  forumEditingPostId = postId || null;
  const titleEl = $('forum-compose-title');
  const contentEl = $('forum-compose-content');
  if (postId) {
    const post = forum.posts.find((p) => p.id === postId);
    if (!post || post.authorType !== 'user') { toast('只能编辑自己的帖子'); return; }
    titleEl.value = post.title;
    contentEl.value = post.content;
    $('forum-compose-heading').textContent = '编辑帖子';
  } else {
    titleEl.value = '';
    contentEl.value = '';
    $('forum-compose-heading').textContent = '发帖';
  }
  $('forum-compose').hidden = false;
}

async function submitForumCompose() {
  const title = $('forum-compose-title').value.trim();
  const content = $('forum-compose-content').value.trim();
  if (!content) { toast('正文不能为空'); return; }
  const forum = await getForum();
  try {
    if (forumEditingPostId) {
      await updateForumPost(forumEditingPostId, { title, content });
      const id = forumEditingPostId;
      forumEditingPostId = null;
      $('forum-compose').hidden = true;
      toast('帖子已更新');
      await refreshForumUI();
      if (forumDetailId === id) await openForumDetail(id);
    } else {
      await addForumPosts([{
        authorType: 'user',
        authorId: null,
        authorName: forum.profile.name,
        title,
        content,
      }]);
      forumEditingPostId = null;
      $('forum-compose').hidden = true;
      forumTab = 'home';
      toast('已发帖');
      await refreshForumUI();
    }
  } catch (err) {
    toast('发布失败：' + (err && err.message ? err.message : err));
  }
}

async function deleteForumPostFlow() {
  if (!forumDetailId) return;
  if (!confirm('确定删除这条帖子吗？删除后无法恢复。')) return;
  try {
    await deleteForumPost(forumDetailId);
    forumDetailId = null;
    $('forum-detail').hidden = true;
    toast('帖子已删除');
    await refreshForumUI();
  } catch (err) {
    toast('删除失败：' + (err && err.message ? err.message : err));
  }
}

async function refreshForumPosts() {
  if (forumGenerating) return;
  const btn = $('btn-forum-refresh-go');
  forumGenerating = true;
  if (btn) btn.disabled = true;
  try {
    const forum = await getForum();
    const api = forumApiConfig(forum);
    if (!api.baseUrl || !api.model) {
      toast('请先在论坛设置里填写独立 API，或配置主 AI 接口');
      await openForumSettings();
      return;
    }
    const countInput = $('input-forum-refresh-count');
    let count = parseInt(countInput ? countInput.value : '', 10);
    if (!Number.isFinite(count)) count = forum.settings.refreshCount || 3;
    count = Math.max(1, Math.min(10, count));
    if (countInput) countInput.value = String(count);
    if (count !== forum.settings.refreshCount) {
      await updateForumSettings({ refreshCount: count });
    }
    const { list } = await getCharacters();
    const bound = new Set(forum.settings.characterIds);
    const boundChars = list.filter((c) => bound.has(c.id));
    const entries = await getWorldbook();
    const names = pickForumNames(10);
    const board = activeForumBoard(forum);
    const prompt = buildForumPostPrompt(forum, entries, boundChars, names, count);
    toast('正在生成论坛帖子…');
    const result = await requestForumChat({
      baseUrl: api.baseUrl,
      apiKey: api.apiKey,
      model: api.model,
      system: prompt.system,
      user: prompt.user,
      maxTokens: 1600,
    });
    if (!result || !result.ok) {
      toast('刷新失败：' + ((result && result.reason) || '接口无响应') + ((result && result.message) ? '（' + result.message + '）' : ''));
      return;
    }
    const parsed = parseForumJson(result.reply);
    const posts = normalizeGeneratedForumPosts(parsed, forum, boundChars, count);
    if (!posts.length) {
      toast('AI 没有返回有效帖子，换个模型再试');
      return;
    }
    const added = await addForumPosts(posts);
    for (const p of added) {
      if (p.authorType === 'character' && p.authorId) {
        addMemoryEntry({
          category: 'event',
          text: '在论坛「' + board.title + '」发了帖子《' + (p.title || '无题') + '》：' + p.content.slice(0, 70),
        }, p.authorId).catch(() => {});
      }
    }
    await refreshForumUI();
    $('forum-refresh-body').hidden = true;
    $('forum-refresh').classList.remove('open');
    $('btn-forum-refresh-toggle').setAttribute('aria-expanded', 'false');
    toast('已刷新 ' + added.length + ' 条帖子');
  } catch (err) {
    toast('刷新失败：' + (err && err.message ? err.message : err));
  } finally {
    forumGenerating = false;
    if (btn) btn.disabled = false;
  }
}

async function generateForumComments() {
  const postId = forumDetailId || ($('forum-detail-body').dataset.postId || '');
  if (!postId) return;
  const btn = $('btn-forum-gen-comments');
  if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
  try {
    const forum = await getForum();
    const post = forum.posts.find((p) => p.id === postId);
    if (!post) { toast('帖子不存在'); return; }
    const api = forumApiConfig(forum);
    if (!api.baseUrl || !api.model) {
      toast('请先在论坛设置里填写独立 API，或配置主 AI 接口');
      return;
    }
    const names = pickForumNames(8);
    const prompt = buildForumCommentPrompt(forum, post, post.comments, names);
    const result = await requestForumChat({
      baseUrl: api.baseUrl,
      apiKey: api.apiKey,
      model: api.model,
      system: prompt.system,
      user: prompt.user,
      maxTokens: 700,
    });
    if (!result || !result.ok) {
      toast('生成评论失败：' + ((result && result.reason) || '接口无响应'));
      return;
    }
    const parsed = parseForumJson(result.reply);
    const list = (Array.isArray(parsed) ? parsed : [])
      .map((item) => {
        if (typeof item === 'string') return { name: names[Math.floor(Math.random() * names.length)], content: item };
        if (!item) return null;
        const content = String(item.content || item.text || '').trim();
        if (!content) return null;
        return { name: String(item.name || '').trim() || names[Math.floor(Math.random() * names.length)], content };
      })
      .filter(Boolean)
      .slice(0, 4);
    if (!list.length) { toast('AI 没有返回有效评论，再试一次'); return; }
    await addForumComments(postId, list);
    await openForumDetail(postId);
    toast('已生成 ' + list.length + ' 条评论');
  } catch (err) {
    toast('生成评论失败：' + (err && err.message ? err.message : err));
  } finally {
    const again = $('btn-forum-gen-comments');
    if (again) { again.disabled = false; again.textContent = '生成评论'; }
  }
}

async function openForumShare(postId) {
  const forum = await getForum();
  const post = forum.posts.find((p) => p.id === postId);
  if (!post) { toast('帖子不存在'); return; }
  forumSharePostId = postId;
  const { list } = await getCharacters();
  await renderForumShareList(list, forum);
  $('forum-share').hidden = false;
}

async function shareForumPostToCharacter(characterId) {
  if (!forumSharePostId) return;
  const forum = await getForum();
  const post = forum.posts.find((p) => p.id === forumSharePostId);
  if (!post) { toast('帖子不存在'); return; }
  const character = await getCharacter(characterId);
  if (!character) { toast('角色不存在'); return; }
  const title = post.title || '无题';
  const excerpt = post.content.replace(/\s+/g, ' ').slice(0, 120);
  try {
    await mutateHistory((arr) => arr.push({
      role: 'user',
      kind: 'forum',
      content: '分享了一个论坛帖子',
      createdAt: Date.now(),
      forum: {
        postId: post.id,
        title,
        authorName: post.authorName,
        excerpt,
      },
    }), characterId);
    addMemoryEntry({
      category: 'event',
      text: '我分享了论坛帖子《' + title + '》（' + post.authorName + '）给你。',
    }, characterId).catch(() => {});
    $('forum-share').hidden = true;
    toast('已发送到「' + character.name + '」的聊天室');
    if ((await getActiveCharacterId()) === characterId) {
      await renderChat();
    }
  } catch (err) {
    toast('分享失败：' + (err && err.message ? err.message : err));
  }
}

async function openForumProfileEditor() {
  const forum = await getForum();
  await renderForumProfileEditor(forum.profile);
  $('forum-profile-editor').hidden = false;
}

async function saveForumProfile() {
  const name = $('forum-profile-name').value.trim();
  if (!name) { toast('昵称不能为空'); return; }
  try {
    await updateForumProfile({
      name,
      signature: $('forum-profile-signature').value.trim(),
    });
    $('forum-profile-editor').hidden = true;
    toast('主页已保存');
    await refreshForumUI();
  } catch (err) {
    toast('保存失败：' + (err && err.message ? err.message : err));
  }
}

function collectForumBoards() {
  return Array.from(document.querySelectorAll('#forum-board-editor-list .forum-board-editor')).map((el) => ({
    id: el.dataset.boardId,
    title: (el.querySelector('.forum-board-title-input').value || '').trim() || '新板块',
    subtitle: (el.querySelector('.forum-board-subtitle-input').value || '').trim(),
    npcPrompt: (el.querySelector('.forum-board-prompt-input').value || '').trim(),
  }));
}

async function saveForumBoardsFromEditors() {
  const boards = collectForumBoards();
  if (boards.length) await saveForumBoards(boards);
}

async function saveForumSettings() {
  const count = Math.max(1, Math.min(10, parseInt($('input-forum-count').value, 10) || 3));
  const worldbookIds = Array.from(document.querySelectorAll('.forum-wb-check:checked')).map((el) => el.dataset.id);
  const characterIds = Array.from(document.querySelectorAll('.forum-char-check:checked')).map((el) => el.dataset.id);
  const boards = collectForumBoards();
  if (!boards.length) {
    $('forum-settings-hint').textContent = '至少保留一个板块。';
    return;
  }
  try {
    await updateForumSettings({
      baseUrl: $('input-forum-base').value.trim(),
      apiKey: $('input-forum-key').value.trim(),
      model: $('input-forum-model').value.trim(),
      refreshCount: count,
      worldbookIds,
      characterIds,
    });
    await saveForumBoards(boards);
    $('forum-settings').hidden = true;
    toast('论坛设置已保存');
    await refreshForumUI();
  } catch (err) {
    $('forum-settings-hint').textContent = '保存失败：' + (err && err.message ? err.message : err);
  }
}

async function addForumBoardFromSettings() {
  try {
    await saveForumBoardsFromEditors();
    await addForumBoard({});
    await openForumSettings();
    toast('已添加板块，填好名称后记得保存');
  } catch (err) {
    toast('添加板块失败：' + (err && err.message ? err.message : err));
  }
}

async function removeForumBoardFromSettings(boardId) {
  const forum = await getForum();
  if (forum.boards.length <= 1) {
    toast('至少保留一个板块');
    return;
  }
  if (!confirm('删除这个板块会同时删除板块内的帖子，确定删除？')) return;
  try {
    await saveForumBoardsFromEditors();
    await deleteForumBoard(boardId);
    await openForumSettings();
    await refreshForumUI();
    toast('板块已删除');
  } catch (err) {
    toast('删除板块失败：' + (err && err.message ? err.message : err));
  }
}

async function pickForumProfileImage(kind) {
  forumProfileImageKind = kind;
  if (kind === 'cover') $('file-forum-cover').click();
  else $('file-forum-avatar').click();
}

async function handleForumProfileFile(kind, file) {
  if (!file) return;
  try {
    const blob = await fileToImage(file, kind === 'cover' ? 1600 : 512);
    await setForumProfileImage(kind, blob, blob.type, file.name);
    const forum = await getForum();
    await renderForumProfileEditor(forum.profile);
    toast(kind === 'cover' ? '背景图已更新' : '头像已更新');
  } catch (err) {
    toast('图片保存失败：' + (err && err.message ? err.message : err));
  }
}

// ---------------- 邮箱 ----------------
function emailApiConfig() {
  const s = getSettings();
  return {
    baseUrl: s.baseUrl || $('input-baseurl').value.trim(),
    apiKey: s.apiKey || $('input-apikey').value.trim(),
    model: s.model || getCurrentModel(),
  };
}

function parseEmailJson(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    const data = JSON.parse(s);
    const subject = String((data && (data.subject || data.title)) || '').trim();
    const body = String((data && (data.body || data.content)) || '').trim();
    if (body.length >= 50) return { subject: subject || '写给你的一封信', body };
  } catch (_) {}
  if (s.length >= 200 && s.indexOf('{') === -1) {
    return { subject: '写给你的一封信', body: s };
  }
  return null;
}

async function buildEmailSystemPrompt(character, characterId) {
  const memoryDoc = await getMemory(characterId);
  const history = await getHistory(characterId);
  const email = await getEmail();
  const lastOut = email.mails.find((m) => m.characterId === characterId && m.direction === 'out');
  const parts = [
    '你正在扮演「' + (character.name || '角色') + '」，用第一人称给用户写一封私人邮件。',
    '【角色人设】',
    (character.persona || '（暂无详细人设，请按角色名字的气质自然发挥）'),
    '【你记得的事】',
    formatMemoryLayers(memoryDoc) || '（暂时没有长期记忆，请从日常写起）',
    '【最近的聊天片段】',
    historyToText(history.slice(-12)) || '（最近没有聊天记录）',
  ];
  if (lastOut) {
    parts.push('【对方最近寄给你的信】');
    parts.push('主题：' + lastOut.subject);
    parts.push('正文：' + lastOut.body.slice(0, 1200));
    parts.push('这封信你还没有回，请在邮件里自然地回应对方，但不要写成逐条回复。');
  }
  parts.push('【写作要求】');
  parts.push('1. 完全用角色的口吻和用词习惯，有情绪、有生活细节，不要像 AI 客服或公文。');
  parts.push('2. 正文 500-1000 个汉字，可以写日常、见闻、思绪或对用户的关心；不要分点罗列。');
  parts.push('3. 不要解释自己在扮演角色，不要提到 AI、模型或提示词，也不要写邮件格式说明。');
  parts.push('4. 只输出 JSON，格式：{"subject":"不超过 20 字的主题","body":"正文"}');
  return parts.join('\n');
}

async function generateCharacterEmail(characterId) {
  const character = await getCharacter(characterId);
  if (!character) throw new Error('角色不存在或已被删除');
  const api = emailApiConfig();
  if (!api.baseUrl || !api.apiKey || !api.model) {
    throw new Error('请先到设置里配置 AI 接口地址、API Key 和模型名');
  }
  const system = await buildEmailSystemPrompt(character, characterId);
  const data = await requestEmailChat({
    baseUrl: api.baseUrl,
    apiKey: api.apiKey,
    model: api.model,
    system,
    user: '请现在写下这封邮件。' + (character.name ? '署名用「' + character.name + '」。' : ''),
    maxTokens: 2600,
  });
  if (!data || !data.ok) throw new Error((data && (data.reason || data.message)) || '邮件生成失败');
  const parsed = parseEmailJson(data.reply);
  if (!parsed) throw new Error('模型没有返回有效的邮件内容，请稍后重试或换模型');

  const mail = await addEmailMail({
    direction: 'in',
    characterId,
    characterName: character.name || '角色',
    subject: parsed.subject,
    body: parsed.body,
    read: false,
    createdAt: Date.now(),
  });
  await addMemoryEntry({
    category: 'event',
    text: '你给用户写了一封邮件《' + parsed.subject + '》，内容大意：' + parsed.body.slice(0, 160) + '…',
  }, characterId);
  return mail;
}

async function refreshMailUI() {
  const email = await getEmail();
  const { list } = await getCharacters();
  document.querySelectorAll('.mail-filter').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mailFolder === mailFolder);
  });
  await renderMailList(email, list, mailFolder);
}

function hideMailPanels() {
  $('mail-detail').hidden = true;
  $('mail-compose').hidden = true;
  $('mail-settings').hidden = true;
}

async function openMail() {
  mailFolder = 'inbox';
  hideMailPanels();
  showView(viewEmail);
  await refreshMailUI();
  runEmailSchedule().catch(() => {});
}

async function openMailDetail(mailId) {
  const [email, { list }] = await Promise.all([getEmail(), getCharacters()]);
  const mail = email.mails.find((m) => m.id === mailId);
  if (!mail) return;
  if (mail.direction === 'in' && !mail.read) await markEmailRead(mailId);
  mailDetailId = mailId;
  await renderMailDetail(mail, list, mailFolder);
  $('mail-detail').hidden = false;
}

function closeMailDetail() {
  $('mail-detail').hidden = true;
  if (viewEmail.classList.contains('active')) refreshMailUI().catch(() => {});
}

async function openMailCompose(options) {
  const { list } = await getCharacters();
  if (!list.length) {
    toast('还没有角色，先到角色应用创建一个');
    return;
  }
  const opt = options || {};
  renderMailComposeOptions(list, opt.characterId);
  $('mail-compose-title').textContent = opt.title || '写邮件';
  $('mail-compose-subject').value = opt.subject || '';
  $('mail-compose-text').value = opt.body || '';
  $('mail-compose-hint').textContent = '';
  $('mail-compose').hidden = false;
}

async function submitMailCompose() {
  const characterId = $('mail-compose-to').value;
  const subject = $('mail-compose-subject').value.trim();
  const body = $('mail-compose-text').value.trim();
  if (!characterId) { toast('请选择收件角色'); return; }
  if (!subject) { toast('请填写邮件主题'); return; }
  if (!body) { toast('请写一点正文再寄出'); return; }
  const character = await getCharacter(characterId);
  if (!character) { toast('角色不存在'); return; }
  await addEmailMail({
    direction: 'out',
    characterId,
    characterName: character.name || '角色',
    subject,
    body,
    read: true,
    createdAt: Date.now(),
  });
  await addMemoryEntry({
    category: 'event',
    text: '你收到了用户寄来的一封邮件《' + subject + '》，内容：' + body.slice(0, 160) + '…',
  }, characterId);
  $('mail-compose').hidden = true;
  mailFolder = 'sent';
  await refreshMailUI();
  toast('邮件已寄出');
}

async function openMailSettings() {
  const [email, { list }] = await Promise.all([getEmail(), getCharacters()]);
  renderMailSettings(email, list);
  const bound = email.settings.characterIds.length;
  $('mail-settings-hint').textContent = bound
    ? '已选择 ' + bound + ' 个角色，每 ' + email.settings.intervalHours + ' 小时检查一次来信。'
    : '还没有选择角色，邮箱不会自动收到来信。';
  $('mail-settings').hidden = false;
}

async function saveMailSettings() {
  const ids = Array.from(document.querySelectorAll('.mail-char-check'))
    .filter((cb) => cb.checked)
    .map((cb) => cb.dataset.characterId);
  let interval = parseInt($('mail-interval-hours').value, 10);
  if (!Number.isFinite(interval)) interval = 24;
  interval = Math.max(1, Math.min(720, interval));
  $('mail-interval-hours').value = String(interval);
  await updateEmailSettings({ characterIds: ids, intervalHours: interval });
  $('mail-settings-hint').textContent = ids.length
    ? '已保存：' + ids.length + ' 个角色，每 ' + interval + ' 小时最多各写一封。'
    : '已保存：暂不自动收信。';
  toast('邮箱设置已保存');
}

async function checkMailNow() {
  const result = await runEmailSchedule({ manual: true });
  if (result.reason === 'unbound') toast('先到邮箱设置里勾选会写信的角色');
  else if (result.reason === 'noapi') toast('请先到设置里配置 AI 接口');
  else if (result.reason === 'busy') toast('上一封还在写，稍等一下');
  else if (!result.generated) toast('暂时没有到时间的新邮件');
  else toast('收到 ' + result.generated + ' 封新邮件');
}

async function deleteMailFlow() {
  if (!mailDetailId) return;
  if (!confirm('删除这封邮件？')) return;
  await deleteEmailMail(mailDetailId);
  mailDetailId = null;
  closeMailDetail();
  toast('邮件已删除');
}

async function replyCurrentMail() {
  const email = await getEmail();
  const mail = email.mails.find((m) => m.id === mailDetailId);
  if (!mail) return;
  const subject = /^re:/i.test(mail.subject) ? mail.subject : 'Re: ' + mail.subject;
  await openMailCompose({ characterId: mail.characterId, subject, title: '回复邮件' });
}

// 定时调度：处理聊天工具里的定时任务，并按间隔为每个绑定角色生成来信
async function runEmailSchedule(options) {
  const opt = options || {};
  if (mailGenerating) return { generated: 0, reason: 'busy' };
  const email = await getEmail();
  const now = Date.now();
  if (!email.settings.characterIds.length && !email.pending.length) {
    return { generated: 0, reason: 'unbound' };
  }
  const api = emailApiConfig();
  if (!api.baseUrl || !api.apiKey || !api.model) return { generated: 0, reason: 'noapi' };
  if (!opt.force && now - email.settings.lastCheckedAt < 60 * 1000) {
    return { generated: 0, reason: 'throttled' };
  }

  mailGenerating = true;
  let generated = 0;
  let firstError = '';
  try {
    await updateEmailSettings({ lastCheckedAt: now });
    const { list } = await getCharacters();
    const byId = new Map(list.map((c) => [c.id, c]));

    for (const job of email.pending) {
      if (job.dueAt > now) continue;
      if (!byId.has(job.characterId)) { await removeEmailPendingJob(job.id); continue; }
      try {
        await generateCharacterEmail(job.characterId);
        generated += 1;
        await removeEmailPendingJob(job.id);
      } catch (err) {
        firstError = firstError || (err && err.message ? err.message : String(err));
      }
    }

    const intervalMs = email.settings.intervalHours * 3600 * 1000;
    let count = 0;
    for (const id of email.settings.characterIds) {
      if (count >= 2) break;
      if (!byId.has(id)) continue;
      const latest = email.mails
        .filter((m) => m.characterId === id && m.direction === 'in')
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      if (latest && now - latest.createdAt < intervalMs) continue;
      try {
        await generateCharacterEmail(id);
        generated += 1;
        count += 1;
      } catch (err) {
        firstError = firstError || (err && err.message ? err.message : String(err));
      }
    }

    if (generated && viewEmail.classList.contains('active')) await refreshMailUI();
    return { generated, reason: firstError && !generated ? 'error' : 'ok', error: firstError };
  } finally {
    mailGenerating = false;
  }
}

function startMailScheduler() {
  if (mailSchedulerTimer) return;
  runEmailSchedule().catch(() => {});
  mailSchedulerTimer = setInterval(() => { runEmailSchedule().catch(() => {}); }, 2 * 60 * 1000);
}

async function sendMailNowFromTool() {
  const characterId = $('tool-mail-character').value;
  if (!characterId) { toast('请选择发信角色'); return; }
  if (mailGenerating) { toast('上一封还在写，稍等一下'); return; }
  closeChatSheet();
  mailGenerating = true;
  toast('角色正在写信…');
  try {
    const mail = await generateCharacterEmail(characterId);
    if (viewEmail.classList.contains('active')) await refreshMailUI();
    toast('收到一封新邮件《' + mail.subject + '》');
  } catch (err) {
    toast('邮件生成失败：' + (err && err.message ? err.message : err));
  } finally {
    mailGenerating = false;
  }
}

async function scheduleMailFromTool() {
  const characterId = $('tool-mail-character').value;
  if (!characterId) { toast('请选择发信角色'); return; }
  let hours = parseInt($('tool-mail-delay-hours').value, 10);
  if (!Number.isFinite(hours)) hours = 24;
  hours = Math.max(1, Math.min(720, hours));
  await addEmailPendingJob({ characterId, dueAt: Date.now() + hours * 3600 * 1000 });
  closeChatSheet();
  toast('已安排 ' + hours + ' 小时后送达邮箱');
}

// ---------------- 日记 ----------------
function parseDiaryJson(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    const data = JSON.parse(s);
    const body = String((data && (data.body || data.content)) || '').trim();
    const title = String((data && data.title) || '').trim();
    const mood = String((data && data.mood) || '').trim();
    const todos = (Array.isArray(data && data.todos) ? data.todos : [])
      .map((t) => (t && typeof t === 'object') ? (t.text || t.todo || t.title) : t)
      .map((t) => String(t || '').trim())
      .filter(Boolean)
      .slice(0, 6);
    if (body.length >= 100) return { title: title || '今天的日记', mood, body, todos };
  } catch (_) {}
  if (s.length >= 200 && s.indexOf('{') === -1) {
    return { title: '今天的日记', mood: '', body: s, todos: [] };
  }
  return null;
}

async function buildDiarySystemPrompt(character, characterId) {
  const memoryDoc = await getMemory(characterId);
  const history = await getHistory(characterId);
  const now = new Date();
  const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const dateText = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 ' + week[now.getDay()];
  const parts = [
    '你正在扮演「' + (character.name || '角色') + '」，现在要写一篇只给自己看的日记。',
    '【角色人设】',
    (character.persona || '（暂无详细人设，请按角色名字的气质自然发挥）'),
    '【你记得的事】',
    formatMemoryLayers(memoryDoc) || '（暂时没有长期记忆，请从今天的生活写起）',
    '【最近的聊天片段】',
    historyToText(history.slice(-12)) || '（最近没有聊天记录）',
    '【今天的日期】',
    dateText,
    '【写作要求】',
    '1. 用第一人称，完全符合角色的口吻、用词和情绪，不要像 AI 助手或作文。',
    '2. 正文 500-800 个汉字，写今天发生的事、自己的感受和想法，要有具体生活细节。',
    '3. 最后列出 2-5 条明日计划，要具体、可执行，不要空话。',
    '4. 不要解释自己正在扮演角色，不要提到 AI、模型或提示词。',
    '5. 只输出 JSON，格式：{"title":"不超过 18 字的标题","mood":"两三个字的今日心情","body":"正文","todos":["明日计划1","明日计划2"]}',
  ];
  return parts.join('\n');
}

// 生成一篇日记并写入存储与角色记忆
async function generateCharacterDiary(characterId) {
  const character = await getCharacter(characterId);
  if (!character) throw new Error('角色不存在或已被删除');
  const api = emailApiConfig();
  if (!api.baseUrl || !api.apiKey || !api.model) {
    throw new Error('请先到设置里配置 AI 接口地址、API Key 和模型名');
  }
  const system = await buildDiarySystemPrompt(character, characterId);
  const data = await requestDiaryChat({
    baseUrl: api.baseUrl,
    apiKey: api.apiKey,
    model: api.model,
    system,
    user: '请现在写下今天的日记。',
    maxTokens: 2600,
  });
  if (!data || !data.ok) throw new Error((data && (data.reason || data.message)) || '日记生成失败');
  const parsed = parseDiaryJson(data.reply);
  if (!parsed) throw new Error('模型没有返回有效的日记内容，请稍后重试或换模型');

  const entry = await addDiaryEntry(characterId, {
    date: diaryDateKey(),
    title: parsed.title,
    mood: parsed.mood,
    body: parsed.body,
    todos: parsed.todos.map((text) => ({ text, done: false })),
    createdAt: Date.now(),
  });
  const plans = entry.todos.map((t) => t.text).join('、') || '暂无';
  await addMemoryEntry({
    category: 'event',
    text: '你写下了今天的日记《' + entry.title + '》，心情：' + (entry.mood || '平静') + '。明日计划：' + plans + '。',
  }, characterId);
  return { character, entry };
}

async function refreshDiaryPage(characterId) {
  const id = characterId || diaryCharacterId || await getActiveCharacterId();
  if (!id) return;
  const [character, diary] = await Promise.all([getCharacter(id), getDiary(id)]);
  if (!character) return;
  diaryCharacterId = id;
  renderDiaryPage(character, diary);
}

async function openDiary(characterId) {
  const id = characterId || await getActiveCharacterId();
  if (!id) {
    toast('先在「角色」应用里创建并选择一个角色');
    return;
  }
  diaryCharacterId = id;
  await refreshDiaryPage(id);
  showView(viewDiary);
  hidePhoneNotice();
  runDiarySchedule().catch(() => {});
}

async function notifyDiaryWritten(character, entry) {
  const name = (character && character.name) || '角色';
  const title = name + ' 写完了今天的日记';
  const text = (entry.title ? '《' + entry.title + '》' : '') + (entry.mood ? ' 心情：' + entry.mood : '') + ' 点开看看。';
  showPhoneNotice({ title, text, characterId: character.id });
  toast(title);
  if (!document.hidden) return;
  let cfg;
  try { cfg = await getNotificationConfig(); } catch (_) { return; }
  if (!cfg.enabled) return;
  let played = false;
  if (cfg.soundId) played = await playNotificationSound();
  await sendBrowserNotification(title, {
    body: text,
    tag: 'clearcall-diary-' + character.id,
    silent: played,
  });
}

async function writeDiaryNow(characterId, options) {
  const id = characterId || await getActiveCharacterId();
  if (!id) { toast('先创建并选择一个角色'); return null; }
  if (diaryWriting) { toast('上一篇还在写，稍等一下'); return null; }
  diaryWriting = true;
  const opt = options || {};
  if (!opt.silent) toast('正在写日记…');
  try {
    const { character, entry } = await generateCharacterDiary(id);
    if (viewDiary.classList.contains('active') && diaryCharacterId === id) {
      await refreshDiaryPage(id);
    }
    await notifyDiaryWritten(character, entry);
    return entry;
  } catch (err) {
    toast('日记生成失败：' + (err && err.message ? err.message : err));
    return null;
  } finally {
    diaryWriting = false;
  }
}

// 定时检查：每个开启定时的角色每天最多一篇，每次最多写 2 篇
async function runDiarySchedule(options) {
  const opt = options || {};
  if (diaryWriting) return { generated: 0, reason: 'busy' };
  const now = Date.now();
  if (!opt.force && now - diaryLastCheckAt < 60 * 1000) return { generated: 0, reason: 'throttled' };
  diaryLastCheckAt = now;

  const { list } = await getCharacters();
  if (!list.length) return { generated: 0, reason: 'nocharacters' };
  const api = emailApiConfig();
  if (!api.baseUrl || !api.apiKey || !api.model) return { generated: 0, reason: 'noapi' };

  const today = diaryDateKey();
  const nowDate = new Date();
  const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();
  const due = [];
  for (const c of list) {
    const diary = await getDiary(c.id);
    if (!diary.enabled || diary.lastWrittenDate === today) continue;
    const [hh, mm] = diary.time.split(':').map((x) => parseInt(x, 10) || 0);
    if (nowMinutes < hh * 60 + mm) continue;
    due.push(c);
  }
  if (!due.length) return { generated: 0, reason: 'none' };

  diaryWriting = true;
  let generated = 0;
  let firstError = '';
  try {
    for (const c of due.slice(0, 2)) {
      try {
        const { character, entry } = await generateCharacterDiary(c.id);
        generated += 1;
        if (viewDiary.classList.contains('active') && diaryCharacterId === c.id) {
          await refreshDiaryPage(c.id);
        }
        await notifyDiaryWritten(character, entry);
      } catch (err) {
        firstError = firstError || (err && err.message ? err.message : String(err));
      }
    }
    return { generated, reason: firstError && !generated ? 'error' : 'ok', error: firstError };
  } finally {
    diaryWriting = false;
  }
}

function startDiaryScheduler() {
  if (diarySchedulerTimer) return;
  runDiarySchedule().catch(() => {});
  diarySchedulerTimer = setInterval(() => { runDiarySchedule().catch(() => {}); }, 2 * 60 * 1000);
}

async function saveDiarySettingsFromTool() {
  const id = await getActiveCharacterId();
  if (!id) { toast('请先创建角色'); return; }
  const enabled = $('tool-diary-enabled').checked;
  const time = $('tool-diary-time').value || '22:00';
  await updateDiarySettings(id, { enabled, time });
  toast(enabled ? '已开启：每天 ' + time + ' 写日记' : '已关闭定时日记');
}

async function writeDiaryNowFromTool() {
  const id = await getActiveCharacterId();
  if (!id) { toast('请先创建角色'); return; }
  closeChatSheet();
  await writeDiaryNow(id);
}

async function openDiaryFromTool() {
  const id = await getActiveCharacterId();
  closeChatSheet();
  await openDiary(id);
}

// ---------------- 日程 ----------------
function parseScheduleJson(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    const data = JSON.parse(s);
    const raw = Array.isArray(data) ? data : (data.items || data.schedule || data.list || []);
    const items = raw
      .map(normalizeScheduleItem)
      .filter(Boolean)
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, 12);
    if (items.length) return items;
  } catch (_) {}
  return null;
}

function scheduleWorldbookText(entries, characterId) {
  const rows = (entries || [])
    .filter((e) => e.scope !== 'character' || !e.characterId || e.characterId === characterId)
    .slice(0, 40)
    .map((e) => '· ' + (e.title || '设定') + '：' + String(e.content || '').replace(/\s+/g, ' ').trim())
    .filter((row) => row.length > 4);
  return rows.join('\n').slice(0, 3000);
}

async function buildScheduleSystemPrompt(character, characterId) {
  const memoryDoc = await getMemory(characterId);
  const history = await getHistory(characterId);
  const worldbook = await getWorldbook();
  const now = new Date();
  const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const dateText = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 ' + week[now.getDay()];
  const parts = [
    '你正在为角色「' + (character.name || '角色') + '」安排今天（' + dateText + '）的日程。',
    '【角色人设】',
    (character.persona || '（暂无详细人设，请按角色名字与气质合理推断）'),
    '【角色世界书】',
    scheduleWorldbookText(worldbook, characterId) || '（暂无世界书，按人设合理推断）',
    '【你记得的事】',
    formatMemoryLayers(memoryDoc) || '（暂时没有长期记忆）',
    '【最近的聊天片段】',
    historyToText(history.slice(-8)) || '（最近没有聊天记录）',
    '【生成要求】',
    '1. 从角色真实生活视角出发，安排 6-9 个覆盖全天的时间段，从起床到睡前。',
    '2. 必须符合人设的职业、性格、作息、所在世界和关系状态；有工作、上课、通勤就写具体内容。',
    '3. 时间用 24 小时制 HH:MM，时间段不重叠，按时间升序，跨度不要出现空档太多。',
    '4. 每个条目写清楚在做什么，具体、有生活感，不要空泛；地点和备注可以为空字符串。',
    '5. 不要提到 AI、模型、提示词，也不要解释生成过程。',
    '6. 只输出 JSON，格式：{"items":[{"start":"07:30","end":"08:10","title":"洗漱吃早饭","place":"家","note":""}]}',
  ];
  return parts.join('\n');
}

// 生成当天日程并写入存储与角色记忆
async function generateCharacterSchedule(characterId) {
  const character = await getCharacter(characterId);
  if (!character) throw new Error('角色不存在或已被删除');
  const api = emailApiConfig();
  if (!api.baseUrl || !api.apiKey || !api.model) {
    throw new Error('请先到设置里配置 AI 接口地址、API Key 和模型名');
  }
  const system = await buildScheduleSystemPrompt(character, characterId);
  const data = await requestScheduleChat({
    baseUrl: api.baseUrl,
    apiKey: api.apiKey,
    model: api.model,
    system,
    user: '请生成今天的日程。',
    maxTokens: 1800,
  });
  if (!data || !data.ok) throw new Error((data && (data.reason || data.message)) || '日程生成失败');
  const items = parseScheduleJson(data.reply);
  if (!items) throw new Error('模型没有返回有效的日程，请稍后重试或换模型');

  await saveSchedule(characterId, { date: diaryDateKey(), items });
  await addMemoryEntry({
    category: 'event',
    text: '你今天的时间安排：' + items.map((i) => i.start + '-' + i.end + ' ' + i.title).join('；') + '。',
  }, characterId);
  return { character, items };
}

async function refreshSchedulePage(characterId) {
  const id = characterId || scheduleCharacterId || await getActiveCharacterId();
  if (!id) return;
  const [character, schedule] = await Promise.all([getCharacter(id), getSchedule(id)]);
  if (!character) return;
  scheduleCharacterId = id;
  renderSchedulePage(character, schedule);
}

async function openSchedule() {
  const id = await getActiveCharacterId();
  if (!id) {
    toast('先在「角色」应用里创建并选择一个角色');
    return;
  }
  scheduleCharacterId = id;
  await refreshSchedulePage(id);
  showView(viewSchedule);
  runScheduleSchedule().catch(() => {});
}

async function refreshScheduleNow() {
  const id = scheduleCharacterId || await getActiveCharacterId();
  if (!id) { toast('请先选择一个角色'); return; }
  if (scheduleGenerating) { toast('日程还在生成，稍等一下'); return; }
  if (!ensureConfigured()) return;
  scheduleGenerating = true;
  const btn = $('btn-schedule-refresh');
  if (btn) btn.disabled = true;
  toast('正在安排今天的日程…');
  try {
    await generateCharacterSchedule(id);
    await refreshSchedulePage(id);
    toast('日程已更新');
  } catch (err) {
    toast('日程生成失败：' + (err && err.message ? err.message : err));
  } finally {
    scheduleGenerating = false;
    if (btn) btn.disabled = false;
  }
}

async function saveScheduleSettingsFromPage() {
  const id = scheduleCharacterId || await getActiveCharacterId();
  if (!id) { toast('请先选择角色'); return; }
  const enabled = $('schedule-auto-enabled').checked;
  const time = $('input-schedule-time').value || '07:00';
  await updateScheduleSettings(id, { enabled, time });
  toast(enabled ? '已开启：每天 ' + time + ' 自动刷新日程' : '已关闭自动刷新日程');
  await refreshSchedulePage(id);
}

// 定时检查：每个开启定时的角色每天最多生成一次，每次最多 2 个
async function runScheduleSchedule(options) {
  const opt = options || {};
  if (scheduleGenerating) return { generated: 0, reason: 'busy' };
  const now = Date.now();
  if (!opt.force && now - scheduleLastCheckAt < 60 * 1000) return { generated: 0, reason: 'throttled' };
  scheduleLastCheckAt = now;

  const { list } = await getCharacters();
  if (!list.length) return { generated: 0, reason: 'nocharacters' };
  const api = emailApiConfig();
  if (!api.baseUrl || !api.apiKey || !api.model) return { generated: 0, reason: 'noapi' };

  const today = diaryDateKey();
  const nowDate = new Date();
  const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();
  const due = [];
  for (const c of list) {
    const s = await getSchedule(c.id);
    if (!s.enabled || s.lastRunDate === today) continue;
    const [hh, mm] = s.time.split(':').map((x) => parseInt(x, 10) || 0);
    if (nowMinutes < hh * 60 + mm) continue;
    due.push(c);
  }
  if (!due.length) return { generated: 0, reason: 'none' };

  scheduleGenerating = true;
  let generated = 0;
  let firstError = '';
  try {
    for (const c of due.slice(0, 2)) {
      try {
        await generateCharacterSchedule(c.id);
        generated += 1;
        if (viewSchedule.classList.contains('active') && scheduleCharacterId === c.id) {
          await refreshSchedulePage(c.id);
        }
      } catch (err) {
        firstError = firstError || (err && err.message ? err.message : String(err));
      }
    }
    return { generated, reason: firstError && !generated ? 'error' : 'ok', error: firstError };
  } finally {
    scheduleGenerating = false;
  }
}

function startScheduleScheduler() {
  if (scheduleSchedulerTimer) return;
  runScheduleSchedule().catch(() => {});
  scheduleSchedulerTimer = setInterval(() => { runScheduleSchedule().catch(() => {}); }, 2 * 60 * 1000);
}

// 把角色「此刻在做什么」注入聊天 system，让回复带上当前状态
function buildScheduleContextPrompt(schedule) {
  if (!schedule || schedule.date !== diaryDateKey() || !Array.isArray(schedule.items) || !schedule.items.length) return '';
  const d = new Date();
  const clock = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const nowItem = schedule.items.find((i) => clock >= i.start && clock < i.end);
  const nextItem = schedule.items.find((i) => i.start > clock);
  const lines = ['【你今天的日程（内部参考）】', '现在是 ' + clock + '。'];
  if (nowItem) {
    lines.push('这个时间段你正在：' + nowItem.title +
      (nowItem.place ? '（' + nowItem.place + '）' : '') + '，' + nowItem.start + '-' + nowItem.end + '。');
  } else {
    lines.push('这个时间段没有明确安排，可能在休息或自由活动。');
  }
  if (nextItem) lines.push('接下来 ' + nextItem.start + ' 你要去' + nextItem.title + '。');
  lines.push('今天的安排：' + schedule.items.map((i) => i.start + '-' + i.end + ' ' + i.title).join('；') + '。');
  lines.push('让当前在做什么自然影响语气和话题（在忙、刚结束、正准备出门等）；不要逐条汇报日程，也不要提到日程表、系统或设定。');
  return lines.join('\n');
}


$('tab-select').addEventListener('click', () => setModelMode('select'));
$('tab-manual').addEventListener('click', () => setModelMode('manual'));

// 论坛事件
$('btn-forum-back').addEventListener('click', () => showView(viewHome));
$('btn-forum-settings').addEventListener('click', () => openForumSettings());
$('btn-forum-settings-close').addEventListener('click', () => { $('forum-settings').hidden = true; });
$('btn-forum-settings-save').addEventListener('click', saveForumSettings);
$('btn-forum-board-add').addEventListener('click', addForumBoardFromSettings);
$('forum-board-editor-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-board-remove]');
  if (btn) removeForumBoardFromSettings(btn.dataset.boardRemove);
});
$('forum-board-tabs').addEventListener('click', async (e) => {
  const chip = e.target.closest('[data-board-id]');
  if (!chip) return;
  await setActiveForumBoard(chip.dataset.boardId);
  forumTab = 'home';
  hideForumPanels();
  await refreshForumUI();
  $('forum-scroll').scrollTop = 0;
});
$('btn-forum-refresh-toggle').addEventListener('click', () => {
  const body = $('forum-refresh-body');
  const open = body.hidden;
  body.hidden = !open;
  $('forum-refresh').classList.toggle('open', open);
  $('btn-forum-refresh-toggle').setAttribute('aria-expanded', String(open));
});
$('btn-forum-refresh-go').addEventListener('click', refreshForumPosts);
$('btn-forum-compose').addEventListener('click', () => openForumCompose());
$('btn-forum-compose-cancel').addEventListener('click', () => {
  forumEditingPostId = null;
  $('forum-compose').hidden = true;
});
$('btn-forum-compose-submit').addEventListener('click', submitForumCompose);
$('btn-forum-detail-back').addEventListener('click', () => {
  forumDetailId = null;
  $('forum-detail').hidden = true;
});
$('btn-forum-share').addEventListener('click', () => {
  if (forumDetailId) openForumShare(forumDetailId);
});
$('btn-forum-share-close').addEventListener('click', () => { $('forum-share').hidden = true; });
$('btn-forum-profile-close').addEventListener('click', () => { $('forum-profile-editor').hidden = true; });
$('btn-forum-profile-save').addEventListener('click', saveForumProfile);

$('btn-forum-avatar-pick').addEventListener('click', () => pickForumProfileImage('avatar'));
$('btn-forum-cover-pick').addEventListener('click', () => pickForumProfileImage('cover'));
$('btn-forum-avatar-clear').addEventListener('click', async () => {
  try {
    await clearForumProfileImage('avatar');
    const forum = await getForum();
    await renderForumProfileEditor(forum.profile);
    toast('头像已清除');
  } catch (err) { toast('清除失败：' + (err && err.message ? err.message : err)); }
});
$('btn-forum-cover-clear').addEventListener('click', async () => {
  try {
    await clearForumProfileImage('cover');
    const forum = await getForum();
    await renderForumProfileEditor(forum.profile);
    toast('背景图已清除');
  } catch (err) { toast('清除失败：' + (err && err.message ? err.message : err)); }
});
$('file-forum-avatar').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  handleForumProfileFile('avatar', f);
});
$('file-forum-cover').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  handleForumProfileFile('cover', f);
});

document.querySelectorAll('.forum-tab').forEach((btn) => {
  btn.addEventListener('click', async () => {
    forumTab = btn.dataset.forumTab;
    hideForumPanels();
    await refreshForumUI();
  });
});

$('forum-feed').addEventListener('click', (e) => {
  if (e.target.closest('#btn-forum-edit-profile')) {
    openForumProfileEditor();
    return;
  }
  const card = e.target.closest('[data-post-id]');
  if (card) openForumDetail(card.dataset.postId);
});

$('forum-detail-body').addEventListener('click', (e) => {
  if (e.target.closest('#btn-forum-gen-comments')) { generateForumComments(); return; }
  if (e.target.closest('#btn-forum-edit-post')) { openForumCompose(forumDetailId); return; }
  if (e.target.closest('#btn-forum-delete-post')) { deleteForumPostFlow(); }
});

$('forum-share-list').addEventListener('click', (e) => {
  const row = e.target.closest('[data-character-id]');
  if (row) shareForumPostToCharacter(row.dataset.characterId);
});

// 邮箱事件
$('btn-mail-back').addEventListener('click', () => showView(viewHome));
$('btn-mail-settings').addEventListener('click', openMailSettings);
$('btn-mail-settings-close').addEventListener('click', () => { $('mail-settings').hidden = true; });
$('btn-mail-settings-save').addEventListener('click', saveMailSettings);
$('btn-mail-check').addEventListener('click', checkMailNow);
$('btn-mail-compose').addEventListener('click', () => openMailCompose());
$('btn-mail-compose-close').addEventListener('click', () => { $('mail-compose').hidden = true; });
$('btn-mail-send').addEventListener('click', submitMailCompose);
$('btn-mail-detail-back').addEventListener('click', closeMailDetail);
$('btn-mail-delete').addEventListener('click', deleteMailFlow);
document.querySelectorAll('.mail-filter').forEach((btn) => {
  btn.addEventListener('click', async () => {
    mailFolder = btn.dataset.mailFolder;
    await refreshMailUI();
  });
});
$('mail-list').addEventListener('click', (e) => {
  const row = e.target.closest('[data-mail-id]');
  if (row) openMailDetail(row.dataset.mailId);
});
$('mail-detail-body').addEventListener('click', (e) => {
  if (e.target.closest('#btn-mail-reply')) replyCurrentMail();
});

// ===== 小说：书架 / 阅读 / 角色批注 =====
function showBooksLibrary() {
  $('books-library').hidden = false;
  $('books-reader').hidden = true;
  $('reader-toc').hidden = true;
  $('reader-discuss').hidden = true;
}

async function refreshBooksUI() {
  const books = await getBooks();
  renderBooksLibrary(books);
}

async function openBooks() {
  currentBookId = null;
  showBooksLibrary();
  showView(viewBooks);
  await refreshBooksUI();
}

async function openBook(bookId) {
  const book = await getBook(bookId);
  if (!book || !book.chapters.length) {
    toast('这本书没有可阅读的章节');
    return;
  }
  const books = await getBooks();
  const meta = books.list.find((b) => b.id === bookId);
  currentBookId = bookId;
  readerChapterIndex = Math.min((meta && meta.progress.chapterIndex) || 0, book.chapters.length - 1);
  readerParagraph = Math.min((meta && meta.progress.paragraph) || 0, (book.chapters[readerChapterIndex].paragraphs.length || 1) - 1);
  await setActiveBook(bookId);
  $('books-library').hidden = true;
  $('books-reader').hidden = false;
  $('reader-toc').hidden = true;
  $('reader-discuss').hidden = true;
  await renderReader({ top: true });
}

async function saveReaderProgress() {
  if (!currentBookId) return;
  await updateBookProgress(currentBookId, { chapterIndex: readerChapterIndex, paragraph: readerParagraph });
}

async function renderReader(opts) {
  if (!currentBookId) return;
  const book = await getBook(currentBookId);
  if (!book || !book.chapters.length) {
    currentBookId = null;
    showBooksLibrary();
    await refreshBooksUI();
    return;
  }
  readerChapterIndex = Math.max(0, Math.min(readerChapterIndex, book.chapters.length - 1));
  const paragraphs = book.chapters[readerChapterIndex].paragraphs;
  readerParagraph = Math.max(0, Math.min(readerParagraph, paragraphs.length - 1));
  const scroller = $('reader-scroll');
  const keepTop = opts && typeof opts.scrollTop === 'number' ? opts.scrollTop : null;
  renderReaderChapter(book, readerChapterIndex, readerParagraph);
  renderReaderToc(book, readerChapterIndex);
  if (keepTop !== null) {
    scroller.scrollTop = keepTop;
  } else if (opts && opts.top === false) {
    const el = document.querySelector('#reader-content .reader-p.current');
    if (el) el.scrollIntoView({ block: 'center' });
  } else {
    scroller.scrollTop = 0;
  }
}

async function selectReaderParagraph(index) {
  if (!currentBookId) return;
  const top = $('reader-scroll').scrollTop;
  readerParagraph = Math.max(0, index);
  await saveReaderProgress();
  await renderReader({ scrollTop: top });
}

async function goReaderChapter(index) {
  if (!currentBookId) return;
  const book = await getBook(currentBookId);
  if (!book) return;
  readerChapterIndex = Math.max(0, Math.min(index, book.chapters.length - 1));
  readerParagraph = 0;
  await saveReaderProgress();
  $('reader-toc').hidden = true;
  await renderReader({ top: true });
}

async function getReaderCharacter() {
  const { list, activeId } = await getCharacters();
  if (!list.length) return null;
  const pick = list.find((c) => c.id === readerCharacterId)
    || list.find((c) => c.id === activeId)
    || list[0];
  readerCharacterId = pick.id;
  return pick;
}

async function loadReaderChatPanel() {
  if (!currentBookId) return;
  const { list } = await getCharacters();
  const character = await getReaderCharacter();
  renderReaderCharacters(list, character ? character.id : '');
  if (!character) {
    renderReaderChat([], '', false);
    return;
  }
  const messages = await getBookChat(currentBookId, character.id);
  renderReaderChat(messages, character.name, readerSending);
}

async function openReaderDiscuss() {
  if (!currentBookId) return;
  $('reader-discuss').hidden = false;
  await loadReaderChatPanel();
}

async function readingUserName() {
  try {
    const forum = await getForum();
    return (forum.profile && forum.profile.name) || '我';
  } catch (_) {
    return '我';
  }
}

function readingRange(paragraphCount, current) {
  return {
    from: Math.max(0, current - 6),
    to: Math.min(paragraphCount - 1, current + 6),
  };
}

async function buildReadingSystem(book, chapterIndex, paragraph, character) {
  const chapter = book.chapters[chapterIndex];
  const userName = await readingUserName();
  const range = readingRange(chapter.paragraphs.length, paragraph);
  const lines = [];
  lines.push('【当前阅读范围：第 ' + (range.from + 1) + ' 段 ~ 第 ' + (range.to + 1) + ' 段】');
  lines.push('--- 当前阅读范围开始 ---');
  for (let i = range.from; i <= range.to; i++) {
    lines.push('[' + (i + 1) + ']' + (i === paragraph ? ' ▶' : '') + ' ' + chapter.paragraphs[i]);
  }
  lines.push('--- 当前阅读范围结束 ---');

  const rangeAnnotations = (book.annotations || []).filter((a) => a.chapterIndex === chapterIndex && a.paragraph >= range.from && a.paragraph <= range.to);
  const annotationText = rangeAnnotations.length
    ? rangeAnnotations.map((a) => '- ID=' + a.id + ' 段落=' + (a.paragraph + 1) + ' 角色=' + a.characterName + '：' + a.text).join('\n')
    : '（这次范围内还没有批注）';

  let memoryText = '';
  try {
    const memory = await getMemory(character.id);
    const entries = (memory.entries || []).slice(-6).map((e) => e.text).filter(Boolean);
    if (entries.length) memoryText = '你记得：' + entries.join('；');
  } catch (_) {}

  return [
    '你正在这场共读里扮演「' + character.name + '」。',
    character.persona ? '角色人设：' + character.persona : '',
    buildChatStylePrompt(character.chatStyle),
    memoryText,
    '',
    '<reading_context>',
    '你正在和' + userName + '一起阅读电子书《' + book.title + '》。',
    '当前章节：' + chapter.title,
    '',
    '以下是' + userName + '当前阅读位置附近的正文（每段前使用真实段落序号）：',
    lines.join('\n'),
    '',
    '以下批注仅来自这次正文范围内的段落（包含可操作的 ID、段落号、角色名和内容）：',
    annotationText,
    '</reading_context>',
    '',
    '<reading_instruction>',
    userName + '想和你讨论当前读到的内容。正文里会明确标出用户当前正在阅读的段落范围，请优先围绕这些段落自然回复，可以引用书中内容、分享看法、提问等。',
    '回复简短自然，像朋友间的讨论，不要写长文分析。',
    '如果你认为需要新增、删除或修改当前章节批注，请先正常聊天，再只在回复末尾追加动作尾注。',
    '动作尾注每行一条，只能使用以下格式：',
    '- 【新增批注 段落=N】批注内容',
    '- 【删除批注 ID=批注ID】',
    '- 【修改批注 ID=批注ID】新的批注内容',
    '动作尾注不要穿插在正文中；如果不需要操作批注，就不要输出动作尾注。',
    '禁止用星号（*）或括号包裹动作描写、神态描写或旁白。',
    '请用中文回复。',
    '</reading_instruction>',
  ].join('\n');
}

async function buildReadingUserMessage(mode, text, character) {
  const userName = await readingUserName();
  if (mode === 'annotate') {
    return '（请阅读当前范围，先简短说说你的感受，再给 2-4 个值得标记的段落添加批注。）';
  }
  const messages = await getBookChat(currentBookId, character.id);
  const recent = messages.slice(-10).map((m) => (m.role === 'user' ? userName : character.name) + '：' + m.text).join('\n');
  return (recent ? '我们之前的讨论：\n' + recent + '\n\n' : '') + userName + '：' + text;
}

function parseReadingActions(reply) {
  const kept = [];
  const actions = [];
  String(reply || '').split(/\r?\n/).forEach((line) => {
    const m = /^\s*(?:[-*]\s*)?【(新增批注|删除批注|修改批注)\s*([^】]*)】\s*(.*)$/.exec(line);
    if (!m) { kept.push(line); return; }
    const params = m[2] || '';
    const content = (m[3] || '').trim();
    if (m[1] === '新增批注') {
      const pm = /段落\s*=\s*(\d+)/.exec(params);
      if (pm && content) actions.push({ type: 'add', paragraph: parseInt(pm[1], 10) - 1, text: content });
    } else {
      const im = /ID\s*=\s*([^\s】]+)/.exec(params);
      if (im) actions.push({ type: m[1] === '删除批注' ? 'delete' : 'update', id: im[1], text: content });
    }
  });
  return { text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(), actions };
}

async function applyReadingActions(book, chapterIndex, character, actions) {
  const chapter = book.chapters[chapterIndex];
  const bookId = book.bookId || book.id;
  let changed = 0;
  for (const action of actions) {
    if (action.type === 'add') {
      if (!Number.isInteger(action.paragraph) || action.paragraph < 0 || action.paragraph >= chapter.paragraphs.length) continue;
      const exists = (book.annotations || []).some((a) => a.characterId === character.id
        && a.chapterIndex === chapterIndex
        && a.paragraph === action.paragraph
        && a.text === action.text);
      if (exists) continue;
      await addBookAnnotation(bookId, {
        characterId: character.id,
        characterName: character.name,
        chapterIndex,
        paragraph: action.paragraph,
        text: action.text.slice(0, 300),
      });
      changed++;
      continue;
    }
    const target = (book.annotations || []).find((a) => a.id === action.id
      && a.characterId === character.id
      && a.chapterIndex === chapterIndex);
    if (!target) continue;
    if (action.type === 'delete') {
      await deleteBookAnnotation(bookId, action.id);
      changed++;
    } else if (action.text) {
      await updateBookAnnotation(bookId, action.id, { text: action.text.slice(0, 300) });
      changed++;
    }
  }
  return changed;
}

async function rememberReading(character, book, chapter, summary) {
  const excerpt = String(summary || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  try {
    const userName = await readingUserName();
    await addMemoryEntry({
      category: 'event',
      text: '和' + userName + '一起读《' + book.title + '》·' + chapter.title + (excerpt ? '，聊到：' + excerpt : ''),
    }, character.id);
  } catch (_) {}
}

async function requestReadingReply(mode, text) {
  if (!currentBookId) throw new Error('还没有打开小说');
  const book = await getBook(currentBookId);
  if (!book) throw new Error('这本书不存在了');
  const chapter = book.chapters[readerChapterIndex];
  if (!chapter) throw new Error('当前章节不存在');
  const character = await getReaderCharacter();
  if (!character) throw new Error('请先在角色应用创建角色');
  const settings = getSettings();
  const model = getCurrentModel() || settings.model;
  if (!settings.baseUrl || !settings.apiKey || !model) {
    throw new Error('请先在设置里填写 AI 接口地址、Key 和模型');
  }
  const system = await buildReadingSystem(book, readerChapterIndex, readerParagraph, character);
  const user = await buildReadingUserMessage(mode, text, character);
  const result = await requestReadingChat({
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model,
    system,
    user,
    maxTokens: 1000,
  });
  if (!result || !result.ok) {
    const reason = (result && result.reason) || '阅读请求失败';
    const message = result && result.message ? '：' + result.message : '';
    throw new Error(reason + message);
  }
  return { book, chapter, character, reply: String(result.reply || '') };
}

async function sendReaderChat() {
  if (readerSending || !currentBookId) return;
  const input = $('reader-chat-text');
  const text = input.value.trim();
  if (!text) { toast('先写点什么再发送'); return; }
  const character = await getReaderCharacter();
  if (!character) { toast('请先在角色应用创建角色'); return; }
  readerSending = true;
  $('reader-chat-text').value = '';
  $('btn-reader-send').disabled = true;
  await appendBookChat(currentBookId, character.id, { role: 'user', text });
  await loadReaderChatPanel();
  renderReaderChat(await getBookChat(currentBookId, character.id), character.name, true);
  try {
    const { book, chapter, reply } = await requestReadingReply('chat', text);
    const parsed = parseReadingActions(reply);
    const changed = await applyReadingActions(book, readerChapterIndex, character, parsed.actions);
    if (parsed.text) {
      await appendBookChat(currentBookId, character.id, { role: 'character', text: parsed.text });
      await rememberReading(character, book, chapter, parsed.text);
    }
    await loadReaderChatPanel();
    await renderReader({ scrollTop: $('reader-scroll').scrollTop });
    if (changed) toast('已更新 ' + changed + ' 条批注');
  } catch (err) {
    toast('发送失败：' + (err && err.message ? err.message : err));
    await loadReaderChatPanel();
  } finally {
    readerSending = false;
    $('btn-reader-send').disabled = false;
  }
}

async function generateChapterAnnotations() {
  if (readerAnnotating || !currentBookId) return;
  const character = await getReaderCharacter();
  if (!character) { toast('请先在角色应用创建角色'); return; }
  readerAnnotating = true;
  const btn = $('btn-reader-annotate');
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '正在批注…';
  try {
    const { book, chapter, reply } = await requestReadingReply('annotate', '');
    const parsed = parseReadingActions(reply);
    const changed = await applyReadingActions(book, readerChapterIndex, character, parsed.actions);
    if (parsed.text) {
      await appendBookChat(currentBookId, character.id, { role: 'character', text: parsed.text });
      await rememberReading(character, book, chapter, parsed.text);
    }
    await renderReader({ scrollTop: $('reader-scroll').scrollTop });
    if (changed) toast(character.name + ' 添加/更新了 ' + changed + ' 条批注');
    else toast(character.name + ' 这次没有添加批注');
  } catch (err) {
    toast('批注失败：' + (err && err.message ? err.message : err));
  } finally {
    readerAnnotating = false;
    btn.disabled = false;
    btn.textContent = oldText || '角色批注本章';
  }
}

async function handleBookFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  const importBtns = [$('btn-books-import'), $('btn-books-import-main')];
  importBtns.forEach((b) => { if (b) b.disabled = true; });
  let lastId = null;
  for (const file of list) {
    try {
      toast('正在解析《' + file.name + '》…');
      const info = await parseBookFile(file);
      const meta = await importBook(info);
      lastId = meta.id;
      toast('已导入《' + meta.title + '》，共 ' + meta.chapterCount + ' 章');
    } catch (err) {
      toast('导入失败：' + (err && err.message ? err.message : err));
    }
  }
  importBtns.forEach((b) => { if (b) b.disabled = false; });
  await refreshBooksUI();
  if (lastId) await openBook(lastId);
  $('file-book-import').value = '';
}

async function deleteBookFlow(bookId) {
  const book = await getBook(bookId);
  const title = book ? book.title : '这本书';
  if (!confirm('删除《' + title + '》？阅读进度、批注和讨论都会一起清除。')) return;
  await deleteBook(bookId);
  if (currentBookId === bookId) {
    currentBookId = null;
    showBooksLibrary();
  }
  await refreshBooksUI();
  toast('已删除《' + title + '》');
}

// 小说事件
$('btn-books-back').addEventListener('click', async () => {
  if (!$('books-reader').hidden) {
    showBooksLibrary();
    await refreshBooksUI();
  } else {
    showView(viewHome);
  }
});

[$('btn-books-import'), $('btn-books-import-main')].forEach((btn) => {
  if (btn) btn.addEventListener('click', () => $('file-book-import').click());
});

$('file-book-import').addEventListener('change', (e) => {
  handleBookFiles(e.target.files);
});

$('books-list').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-book-delete]');
  if (del) {
    await deleteBookFlow(del.dataset.bookDelete);
    return;
  }
  const card = e.target.closest('[data-book-id]');
  if (card) await openBook(card.dataset.bookId);
});

$('reader-content').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-annotation-delete]');
  if (del) {
    if (!currentBookId) return;
    await deleteBookAnnotation(currentBookId, del.dataset.annotationDelete);
    await renderReader({ scrollTop: $('reader-scroll').scrollTop });
    return;
  }
  const p = e.target.closest('[data-paragraph]');
  if (p) await selectReaderParagraph(parseInt(p.dataset.paragraph, 10) || 0);
});

$('btn-reader-prev').addEventListener('click', () => goReaderChapter(readerChapterIndex - 1));
$('btn-reader-next').addEventListener('click', () => goReaderChapter(readerChapterIndex + 1));

$('btn-reader-toc').addEventListener('click', async () => {
  if (!currentBookId) return;
  const book = await getBook(currentBookId);
  if (!book) return;
  renderReaderToc(book, readerChapterIndex);
  $('reader-toc').hidden = false;
});
$('btn-reader-toc-close').addEventListener('click', () => { $('reader-toc').hidden = true; });
$('reader-toc-list').addEventListener('click', (e) => {
  const item = e.target.closest('[data-chapter-index]');
  if (item) goReaderChapter(parseInt(item.dataset.chapterIndex, 10) || 0);
});

$('btn-reader-discuss').addEventListener('click', openReaderDiscuss);
$('btn-reader-discuss-close').addEventListener('click', () => { $('reader-discuss').hidden = true; });
$('reader-character').addEventListener('change', async (e) => {
  readerCharacterId = e.target.value;
  await loadReaderChatPanel();
});
$('btn-reader-send').addEventListener('click', sendReaderChat);
$('reader-chat-text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendReaderChat();
  }
});

$('btn-reader-annotate').addEventListener('click', generateChapterAnnotations);

// 主屏幕应用图标（含底部 Dock）
document.querySelectorAll('.app-icon, .dock-icon').forEach((btn) => {
  btn.addEventListener('click', () => {
    const app = btn.dataset.app;
    if (app === 'forum') {
      openForum();
    } else if (app === 'moments') {
      openMoments();
    } else if (app === 'mail') {
      openMail();
    } else if (app === 'books') {
      openBooks();
    } else if (app === 'schedule') {
      openSchedule();
    } else if (app === 'settings') {
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
$('btn-chat-style-back').addEventListener('click', () => showView(viewChat));
$('btn-chat-style-save').addEventListener('click', saveChatStyle);
$('btn-diary-back').addEventListener('click', () => showView(viewChat));
$('btn-schedule-back').addEventListener('click', () => showView(viewHome));
$('btn-schedule-refresh').addEventListener('click', () => { refreshScheduleNow().catch(() => {}); });
$('schedule-body').addEventListener('click', (e) => {
  if (e.target.closest('#btn-schedule-save')) saveScheduleSettingsFromPage().catch(() => {});
});
$('btn-diary-write').addEventListener('click', () => writeDiaryNow(diaryCharacterId).catch(() => {}));
$('chat-style-grid').addEventListener('change', (e) => {
  const input = e.target.closest('input[type="checkbox"]');
  if (!input) return;
  if (input.checked && input.dataset.group) {
    document.querySelectorAll('#chat-style-grid input[data-group="' + input.dataset.group + '"]')
      .forEach((other) => {
        if (other !== input) {
          other.checked = false;
          other.closest('.chat-style-card').classList.remove('selected');
        }
      });
  }
  input.closest('.chat-style-card').classList.toggle('selected', input.checked);
  updateChatStylePreview();
});

// 通讯录
$('btn-characters-back').addEventListener('click', () => showView(viewHome));
$('btn-character-add').addEventListener('click', openCharacterAdd);
$('btn-user-profile-add').addEventListener('click', openUserProfileAdd);
document.querySelectorAll('#view-characters .contacts-tab').forEach((btn) => {
  btn.addEventListener('click', () => { setContactsTab(btn.dataset.contactsTab).catch(() => {}); });
});
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

$('btn-icon-manager').addEventListener('click', () => openIconManager());
$('btn-icon-manager-back').addEventListener('click', () => {
  if (iconManagerTarget) closeIconManagerDetail();
  else showView(viewSettings);
});
$('btn-icon-manager-detail-back').addEventListener('click', () => closeIconManagerDetail());
$('icon-manager-grid').addEventListener('click', (e) => {
  const tile = e.target.closest('[data-icon-app]');
  if (tile) renderIconManagerDetail(tile.dataset.iconApp);
});
$('btn-icon-manager-upload').addEventListener('click', () => {
  if (!iconManagerTarget) return;
  iconUploadTarget = iconManagerTarget;
  $('file-icon-custom').click();
});
$('btn-icon-manager-clear').addEventListener('click', async () => {
  if (!iconManagerTarget) return;
  try {
    await clearAppearanceIcon(iconManagerTarget);
    await refreshAppearance();
    toast('图标已恢复默认');
  } catch (err) {
    toast('恢复失败：' + (err && err.message ? err.message : err));
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

// 聊天气泡颜色 / 字体 / 字体颜色
$('input-bubble-color').addEventListener('change', async () => {
  try {
    await setAppearance({ bubbleColor: $('input-bubble-color').value });
    await refreshAppearance();
    toast('气泡颜色已更新');
  } catch (err) {
    toast('气泡颜色保存失败：' + (err && err.message ? err.message : err));
  }
});
$('btn-bubble-color-clear').addEventListener('click', async () => {
  try {
    await setAppearance({ bubbleColor: '' });
    await refreshAppearance();
    toast('已恢复默认气泡颜色');
  } catch (err) {
    toast('恢复失败：' + (err && err.message ? err.message : err));
  }
});
$('input-font-color').addEventListener('change', async () => {
  try {
    await setAppearance({ fontColor: $('input-font-color').value });
    await refreshAppearance();
    toast('字体颜色已更新');
  } catch (err) {
    toast('字体颜色保存失败：' + (err && err.message ? err.message : err));
  }
});
$('btn-font-color-clear').addEventListener('click', async () => {
  try {
    await setAppearance({ fontColor: '' });
    await refreshAppearance();
    toast('已恢复默认字体颜色');
  } catch (err) {
    toast('恢复失败：' + (err && err.message ? err.message : err));
  }
});
$('input-chat-font').addEventListener('change', async () => {
  try {
    await setAppearance({ fontFamily: $('input-chat-font').value.trim() });
    await refreshAppearance();
    toast('聊天字体已更新');
  } catch (err) {
    toast('字体保存失败：' + (err && err.message ? err.message : err));
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
  if (tool) {
    if (tool.dataset.tool === 'style') {
      closeChatSheet();
      await openChatStylePage();
      return;
    }
    await openChatSheet(tool.dataset.tool);
    return;
  }

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
  else if (btn.id === 'btn-tool-mail-now') await sendMailNowFromTool();
  else if (btn.id === 'btn-tool-mail-schedule') await scheduleMailFromTool();
  else if (btn.id === 'btn-tool-diary-save') await saveDiarySettingsFromTool();
  else if (btn.id === 'btn-tool-diary-now') await writeDiaryNowFromTool();
  else if (btn.id === 'btn-tool-diary-open') await openDiaryFromTool();
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

// 日记：勾选明日计划 / 删除某一篇
$('diary-body').addEventListener('change', async (e) => {
  const box = e.target.closest('[data-diary-todo]');
  if (!box || !diaryCharacterId) return;
  await toggleDiaryTodo(diaryCharacterId, box.dataset.diaryEntry, box.dataset.diaryTodo);
  const row = box.closest('.diary-todo');
  if (row) row.classList.toggle('done', box.checked);
});
$('diary-body').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-diary-del]');
  if (!del || !diaryCharacterId) return;
  if (!confirm('删除这篇日记？')) return;
  await deleteDiaryEntry(diaryCharacterId, del.dataset.diaryDel);
  await refreshDiaryPage(diaryCharacterId);
  toast('日记已删除');
});

// ---------------- 动态（朋友圈） ----------------
function parseMomentJson(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    const data = JSON.parse(s);
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch (_) {
    return null;
  }
}

function b64ToBlob(b64, mime) {
  const bin = atob(String(b64 || ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'image/png' });
}

function momentCommentFallbacks(character) {
  const name = (character && character.name) || '角色';
  return [
    { name: '小鹿', content: '这张图的氛围感绝了，今天状态很好呀。' },
    { name: '阿柚', content: '好久没见你发动态了，蹲一个后续～' },
    { name: '橘子汽水', content: '「' + name + '」最近是不是遇到什么开心事了？' },
  ];
}

function normalizeMomentComments(raw, character) {
  let list = Array.isArray(raw) ? raw : [];
  list = list.map((c) => {
    if (typeof c === 'string') return { name: '', content: c };
    if (!c || typeof c !== 'object') return null;
    return { name: String(c.name || c.author || '').trim(), content: String(c.content || c.text || c.comment || '').trim() };
  }).filter((c) => c && c.content);
  const out = list.slice(0, 5).map((c) => ({
    authorType: 'npc',
    name: c.name || '路人',
    content: c.content.slice(0, 120),
  }));
  if (out.length < 3) {
    momentCommentFallbacks(character).slice(0, 3 - out.length).forEach((c) => out.push({
      authorType: 'npc',
      name: c.name,
      content: c.content,
    }));
  }
  return out.slice(0, 5);
}

async function momentsIdentity() {
  const profile = await getActiveUserProfile();
  let avatarUrl = '';
  try {
    const forum = await getForum();
    avatarUrl = await getFileUrl(forum.profile.avatarId);
  } catch (_) {}
  return {
    name: (profile && profile.name) || '我',
    avatarUrl,
  };
}

async function refreshMomentsUI() {
  const [moments, charsDoc, identity, forum] = await Promise.all([
    getMoments(),
    getCharacters(),
    momentsIdentity(),
    getForum().catch(() => null),
  ]);
  $('moments-user-name').textContent = identity.name;
  const avatarEl = $('moments-user-avatar');
  avatarEl.innerHTML = '';
  if (identity.avatarUrl) {
    const img = document.createElement('img');
    img.src = identity.avatarUrl;
    img.alt = '';
    avatarEl.appendChild(img);
  } else {
    avatarEl.textContent = identity.name.slice(0, 1);
  }
  let coverUrl = '';
  try {
    coverUrl = await getFileUrl(forum && forum.profile ? forum.profile.coverId : null);
  } catch (_) {}
  $('moments-cover-bg').style.backgroundImage = coverUrl ? 'url("' + coverUrl.replace(/"/g, '%22') + '")' : '';

  const boundCount = moments.settings.characterIds.filter((id) => charsDoc.list.some((c) => c.id === id)).length;
  $('moments-status').textContent = boundCount
    ? '已绑定 ' + boundCount + ' 个角色，每 ' + moments.settings.intervalHours + ' 小时最多发一条动态。'
    : '还没有绑定角色，到「设置」里勾选后，他们会定时发布动态。';

  await renderMomentsFeed(moments, identity, charsDoc.list);
  if (!$('moments-settings').hidden) renderMomentsSettings(moments, charsDoc.list);
}

async function openMoments() {
  hidePhoneNotice();
  showView(viewMoments);
  await refreshMomentsUI();
  runMomentsSchedule().catch(() => {});
}

async function openMomentsSettings() {
  const [moments, charsDoc] = await Promise.all([getMoments(), getCharacters()]);
  renderMomentsSettings(moments, charsDoc.list);
  $('moments-settings').hidden = false;
}

function setMomentComposePreview(url) {
  const box = $('moments-compose-preview');
  box.style.backgroundImage = url ? 'url("' + url.replace(/"/g, '%22') + '")' : '';
  box.classList.toggle('has-image', !!url);
  box.textContent = url ? '' : '尚未选择图片';
  $('btn-moments-compose-image-clear').disabled = !url;
}

function clearPendingMomentImage() {
  if (pendingMomentImageUrl) {
    URL.revokeObjectURL(pendingMomentImageUrl);
    pendingMomentImageUrl = '';
  }
  pendingMomentImage = null;
  setMomentComposePreview('');
}

async function buildMomentSystemPrompt(character, characterId) {
  const memoryDoc = await getMemory(characterId);
  const history = await getHistory(characterId);
  return [
    '你正在扮演「' + (character.name || '角色') + '」，现在要在朋友圈发一条动态。',
    '【角色人设】',
    (character.persona || '（暂无详细人设，请按角色名字的气质自然发挥）'),
    buildChatStylePrompt(character.chatStyle),
    '【你记得的事】',
    formatMemoryLayers(memoryDoc) || '（暂时没有长期记忆，请从日常生活写起）',
    '【最近的聊天片段】',
    historyToText(history.slice(-12)) || '（最近没有聊天记录）',
    '【发布要求】',
    '1. 用第一人称，完全符合角色的口吻和生活方式，不要像 AI 助手或广告文案。',
    '2. 正文 40-120 个汉字，像真实朋友圈，不要标题、不要分点列举。',
    '3. 必须配图：imagePrompt 写一段给生图模型的画面描述（场景、主体、光线、构图、风格），画面里不要出现文字；imageDesc 写 30-60 个字的中文画面描述，给看不到图片的人看。',
    '4. comments 生成 3-5 条与角色生活相关的路人评论，每条 8-25 个字，名字像真实网友，不要复读正文，也不要都夸同一件事。',
    '5. 不要解释自己在扮演角色，不要提到 AI、模型或提示词。',
    '6. 只输出 JSON，格式：{"text":"正文","imagePrompt":"生图画面描述","imageDesc":"中文画面描述","comments":[{"name":"网友名","content":"评论"}]}',
  ].join('\n');
}

async function generateCharacterMoment(characterId) {
  const character = await getCharacter(characterId);
  if (!character) throw new Error('角色不存在或已被删除');
  const api = emailApiConfig();
  if (!api.baseUrl || !api.apiKey || !api.model) {
    throw new Error('请先到设置里配置 AI 接口地址、API Key 和模型名');
  }
  const system = await buildMomentSystemPrompt(character, characterId);
  const data = await requestMomentChat({
    baseUrl: api.baseUrl,
    apiKey: api.apiKey,
    model: api.model,
    system,
    user: '请现在发布一条朋友圈动态。',
    maxTokens: 1800,
  });
  if (!data || !data.ok) throw new Error((data && (data.reason || data.message)) || '动态生成失败');
  const parsed = parseMomentJson(data.reply);
  if (!parsed) throw new Error('模型没有返回有效的动态内容，请稍后重试或换模型');

  const text = String(parsed.text || parsed.content || '').trim();
  if (!text) throw new Error('模型返回的动态正文为空，请稍后重试');

  let imageId = null;
  let imageDesc = String(parsed.imageDesc || parsed.image_description || '').trim();
  const imageSettings = getImageSettings();
  const imagePrompt = String(parsed.imagePrompt || parsed.image_prompt || '').trim();
  const imageBound = character.image && character.image.enabled
    && imageSettings.baseUrl && imageSettings.apiKey && imageSettings.model;
  if (imageBound) {
    try {
      const prompt = [character.image.prompt, imagePrompt].filter(Boolean).join('，');
      const result = await requestImageGenerate({
        baseUrl: imageSettings.baseUrl,
        apiKey: imageSettings.apiKey,
        model: imageSettings.model,
        prompt: prompt || text,
        size: imageSettings.size,
      });
      if (result && result.ok) {
        let blob = null;
        if (result.b64) blob = b64ToBlob(result.b64, result.mime);
        else if (result.url) {
          const res = await fetch(result.url);
          if (res.ok) blob = await res.blob();
        }
        if (blob) {
          imageId = genId();
          await putFile({ id: imageId, name: 'moment-' + imageId, type: blob.type || 'image/png', blob });
        }
      }
    } catch (_) { /* 生图失败时退回文字描述图 */ }
  }
  if (!imageId && !imageDesc) {
    imageDesc = '一张与这条动态相配的生活画面：' + text.slice(0, 48);
  }

  const comments = normalizeMomentComments(parsed.comments, character);
  const post = await addMomentPost({
    authorType: 'character',
    authorId: character.id,
    authorName: character.name || '角色',
    text,
    imageId,
    imageDesc,
  });
  if (comments.length) {
    const now = Date.now();
    await addMomentComments(post.id, comments.map((c, i) => Object.assign({ createdAt: now + i }, c)));
  }
  await addMemoryEntry({
    category: 'event',
    text: '你在朋友圈发了一条动态：' + text.slice(0, 80) + (imageId ? '（配了图片）' : '（文字配图：' + imageDesc.slice(0, 40) + '）') + '。',
  }, character.id);
  return post;
}

function parseMomentReaction(text) {
  const data = parseMomentJson(text);
  if (!data) return null;
  const comment = String(data.comment || data.reply || '').trim();
  const chat = String(data.chat || data.message || '').trim();
  if (!comment && !chat) return null;
  return { comment, chat };
}

async function buildMomentReactionPrompt(character, characterId, post, userComment) {
  const memoryDoc = await getMemory(characterId);
  const history = await getHistory(characterId);
  const parts = [
    '你正在扮演「' + (character.name || '角色') + '」，正在刷朋友圈。',
    '【角色人设】',
    (character.persona || '（暂无详细人设，请按角色名字的气质自然发挥）'),
    buildChatStylePrompt(character.chatStyle),
    '【你记得的事】',
    formatMemoryLayers(memoryDoc) || '（暂时没有长期记忆）',
    '【最近的聊天片段】',
    historyToText(history.slice(-10)) || '（最近没有聊天记录）',
    '【这条动态】',
    '作者：' + (post.authorName || '我'),
    '正文：' + (post.text || '（没有文字，只有图片）'),
  ];
  if (post.imageDesc) parts.push('配图：' + post.imageDesc);
  if (userComment) {
    parts.push('【用户刚刚的评论】');
    parts.push(userComment.content);
    parts.push('【要求】');
    parts.push('1. 在聊天室主动发一条消息回应用户的评论，可以顺着评论聊下去、表达情绪或追问，30-90 个字。');
    parts.push('2. 完全用角色的口吻，不要像客服，不要提到 AI 或提示词。');
    parts.push('3. 只输出 JSON，格式：{"chat":"聊天室里说的话"}');
  } else {
    parts.push('【要求】');
    parts.push('1. 给这条动态点个赞。');
    parts.push('2. 写一条符合角色口吻的评论，10-40 个字，不要空泛夸赞。');
    parts.push('3. 再在聊天室主动发一条消息讨论这条动态，30-90 个字，可以调侃、关心或追问。');
    parts.push('4. 只输出 JSON，格式：{"comment":"朋友圈评论","chat":"聊天室里说的话"}');
  }
  return parts.join('\n');
}

async function appendProactiveChatMessage(characterId, content) {
  const text = String(content || '').trim();
  if (!text) return;
  await mutateHistory((arr) => {
    arr.push({ role: 'assistant', content: text, createdAt: Date.now() });
  }, characterId);
  const { activeId } = await getCharacters();
  const chattingHere = viewChat.classList.contains('active') && activeId === characterId;
  if (chattingHere) {
    try { await renderChat(); } catch (_) {}
  } else {
    const c = await getCharacter(characterId);
    showPhoneNotice({
      title: ((c && c.name) || '角色') + ' 发来消息',
      text: text.length > 52 ? text.slice(0, 52) + '…' : text,
      characterId,
      target: 'chat',
    });
  }
  notifyCharacterReply(characterId, text).catch(() => {});
}

async function reactToUserMoment(post) {
  if (momentsReactionBusy) return;
  momentsReactionBusy = true;
  try {
    const [moments, charsDoc, api] = [await getMoments(), await getCharacters(), emailApiConfig()];
    const bound = charsDoc.list.filter((c) => moments.settings.characterIds.includes(c.id));
    if (!bound.length) return;
    if (!api.baseUrl || !api.apiKey || !api.model) return;
    const character = bound[Math.floor(Math.random() * bound.length)];
    const system = await buildMomentReactionPrompt(character, character.id, post, null);
    const data = await requestMomentChat({
      baseUrl: api.baseUrl,
      apiKey: api.apiKey,
      model: api.model,
      system,
      user: '请现在看看用户刚发的这条动态，按格式回复。',
      maxTokens: 900,
    });
    if (!data || !data.ok) return;
    const parsed = parseMomentReaction(data.reply);
    if (!parsed) return;

    await addMomentLike(post.id, { authorType: 'character', characterId: character.id, name: character.name || '角色' });
    if (parsed.comment) {
      await addMomentComments(post.id, [{
        authorType: 'character',
        authorId: character.id,
        name: character.name || '角色',
        content: parsed.comment.slice(0, 120),
        createdAt: Date.now(),
      }]);
    }
    if (parsed.chat) await appendProactiveChatMessage(character.id, parsed.chat);
    await addMemoryEntry({
      category: 'event',
      text: '你发了朋友圈「' + (post.text || '一张图片').slice(0, 60) + '」，' + (character.name || '角色')
        + ' 点了赞' + (parsed.comment ? '并评论：' + parsed.comment : '') + (parsed.chat ? '，还在聊天里和你聊起这件事。' : '。'),
    }, character.id);
    if (viewMoments.classList.contains('active')) await refreshMomentsUI();
  } catch (_) {
    /* 角色反应失败不影响动态本身 */
  } finally {
    momentsReactionBusy = false;
  }
}

async function discussMomentComment(post, comment) {
  const character = await getCharacter(post.authorId);
  if (!character) return;
  const api = emailApiConfig();
  if (!api.baseUrl || !api.apiKey || !api.model) return;
  const system = await buildMomentReactionPrompt(character, character.id, post, comment);
  const data = await requestMomentChat({
    baseUrl: api.baseUrl,
    apiKey: api.apiKey,
    model: api.model,
    system,
    user: '请现在回应这条评论。',
    maxTokens: 700,
  });
  if (!data || !data.ok) return;
  const parsed = parseMomentReaction(data.reply);
  if (!parsed || !parsed.chat) return;
  await appendProactiveChatMessage(character.id, parsed.chat);
  await addMemoryEntry({
    category: 'event',
    text: '用户在朋友圈评论了你的动态「' + (post.text || '').slice(0, 40) + '」：' + comment.content.slice(0, 60)
      + '。你在聊天里回应：' + parsed.chat.slice(0, 80),
  }, character.id);
}

async function submitMomentPost() {
  const text = $('moments-compose-text').value.trim();
  if (!text && !pendingMomentImage) { toast('写点文字或选一张配图再发布'); return; }
  const identity = await momentsIdentity();
  let imageId = null;
  try {
    if (pendingMomentImage) {
      const blob = await fileToImage(pendingMomentImage, 1280);
      imageId = genId();
      await putFile({ id: imageId, name: 'moment-user-' + imageId, type: blob.type || 'image/jpeg', blob });
    }
  } catch (err) {
    toast('配图保存失败：' + (err && err.message ? err.message : err));
    return;
  }
  let post;
  try {
    post = await addMomentPost({
      authorType: 'user',
      authorName: identity.name,
      text,
      imageId,
      imageDesc: '',
    });
  } catch (err) {
    toast('发布失败：' + (err && err.message ? err.message : err));
    return;
  }
  $('moments-compose-text').value = '';
  clearPendingMomentImage();
  $('moments-compose-panel').hidden = true;
  toast('动态已发布');
  await refreshMomentsUI();
  reactToUserMoment(post).catch(() => {});
}

async function addUserMomentComment(postId, text) {
  const content = String(text || '').trim();
  if (!content) return;
  const [moments, identity] = [await getMoments(), await momentsIdentity()];
  const post = moments.posts.find((p) => p.id === postId);
  if (!post) return;
  const added = await addMomentComments(postId, [{
    authorType: 'user',
    name: identity.name,
    content: content.slice(0, 200),
    createdAt: Date.now(),
  }]);
  await refreshMomentsUI();
  if (post.authorType === 'character' && post.authorId) {
    await addMemoryEntry({
      category: 'event',
      text: '用户在朋友圈评论了你的动态「' + (post.text || '').slice(0, 40) + '」：' + content.slice(0, 60),
    }, post.authorId);
    discussMomentComment(post, added[0]).catch(() => {});
  }
}

async function publishMomentNow() {
  if (momentsGenerating) { toast('还在发布上一条，稍等一下'); return; }
  const [moments, charsDoc] = [await getMoments(), await getCharacters()];
  const bound = charsDoc.list.filter((c) => moments.settings.characterIds.includes(c.id));
  if (!bound.length) {
    toast('先在动态设置里勾选一个角色');
    openMomentsSettings().catch(() => {});
    return;
  }
  const character = bound[Math.floor(Math.random() * bound.length)];
  momentsGenerating = true;
  $('moments-status').textContent = '「' + (character.name || '角色') + '」正在拍照片、写动态…';
  try {
    await generateCharacterMoment(character.id);
    await refreshMomentsUI();
    toast('「' + (character.name || '角色') + '」发布了一条动态');
  } catch (err) {
    toast('发布失败：' + (err && err.message ? err.message : err));
    await refreshMomentsUI();
  } finally {
    momentsGenerating = false;
  }
}

async function runMomentsSchedule(options) {
  const opt = options || {};
  if (momentsGenerating) return { generated: 0, reason: 'busy' };
  const now = Date.now();
  if (!opt.force && now - momentsLastCheckAt < 60 * 1000) return { generated: 0, reason: 'throttled' };
  momentsLastCheckAt = now;

  const [moments, charsDoc, api] = [await getMoments(), await getCharacters(), emailApiConfig()];
  if (!api.baseUrl || !api.apiKey || !api.model) return { generated: 0, reason: 'noapi' };
  const bound = charsDoc.list.filter((c) => moments.settings.characterIds.includes(c.id));
  if (!bound.length) return { generated: 0, reason: 'none' };

  const intervalMs = moments.settings.intervalHours * 3600 * 1000;
  const due = bound.filter((c) => now - (moments.settings.lastPostAt[c.id] || 0) >= intervalMs);
  if (!due.length) return { generated: 0, reason: 'none' };

  momentsGenerating = true;
  let generated = 0;
  let firstPost = null;
  try {
    for (const c of due.slice(0, 2)) {
      try {
        const post = await generateCharacterMoment(c.id);
        generated++;
        if (!firstPost) firstPost = { post, character: c };
      } catch (_) { /* 单个角色失败不影响其它角色 */ }
    }
    await updateMomentSettings({ lastCheckedAt: Date.now() });
  } finally {
    momentsGenerating = false;
  }
  if (generated) {
    if (firstPost) {
      showPhoneNotice({
        title: '动态 · ' + (firstPost.character.name || '角色') + ' 发布了新动态',
        text: (firstPost.post.text || '发了一条带图动态').slice(0, 52),
        characterId: firstPost.character.id,
        target: 'moments',
      });
    }
    if (viewMoments.classList.contains('active')) await refreshMomentsUI();
  }
  return { generated };
}

function startMomentsScheduler() {
  if (momentsSchedulerTimer) return;
  runMomentsSchedule().catch(() => {});
  momentsSchedulerTimer = setInterval(() => { runMomentsSchedule().catch(() => {}); }, 2 * 60 * 1000);
}

$('btn-moments-back').addEventListener('click', () => showView(viewHome));
$('btn-moments-settings').addEventListener('click', () => { openMomentsSettings().catch(() => {}); });
$('btn-moments-settings-close').addEventListener('click', () => { $('moments-settings').hidden = true; });
$('btn-moments-settings-save').addEventListener('click', async () => {
  const ids = Array.from(document.querySelectorAll('.moment-char-check:checked')).map((el) => el.dataset.characterId);
  let interval = parseInt($('moments-interval-hours').value, 10);
  if (!Number.isFinite(interval)) interval = 24;
  try {
    await updateMomentSettings({ characterIds: ids, intervalHours: interval });
    $('moments-settings').hidden = true;
    await refreshMomentsUI();
    toast(ids.length ? '已绑定 ' + ids.length + ' 个角色' : '已停止定时发布动态');
  } catch (err) {
    toast('保存失败：' + (err && err.message ? err.message : err));
  }
});
$('btn-moments-publish-now').addEventListener('click', publishMomentNow);
$('btn-moments-compose').addEventListener('click', () => {
  $('moments-compose-panel').hidden = false;
});
$('btn-moments-compose-close').addEventListener('click', () => {
  $('moments-compose-panel').hidden = true;
});
$('btn-moments-compose-submit').addEventListener('click', submitMomentPost);
$('btn-moments-compose-image').addEventListener('click', () => $('file-moment-image').click());
$('btn-moments-compose-image-clear').addEventListener('click', clearPendingMomentImage);
$('file-moment-image').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (!f.type.startsWith('image/')) { toast('请选择图片文件'); return; }
  if (pendingMomentImageUrl) URL.revokeObjectURL(pendingMomentImageUrl);
  pendingMomentImage = f;
  pendingMomentImageUrl = URL.createObjectURL(f);
  setMomentComposePreview(pendingMomentImageUrl);
});

$('moments-feed').addEventListener('click', async (e) => {
  const like = e.target.closest('[data-moment-like]');
  if (like) {
    const identity = await momentsIdentity();
    await toggleMomentLike(like.dataset.momentLike, { authorType: 'user', name: identity.name });
    await refreshMomentsUI();
    return;
  }
  const toggle = e.target.closest('[data-moment-comment-toggle]');
  if (toggle) {
    const form = $('moments-feed').querySelector('[data-moment-comment-form="' + toggle.dataset.momentCommentToggle + '"]');
    if (form) {
      form.hidden = !form.hidden;
      if (!form.hidden) {
        const input = form.querySelector('input');
        if (input) input.focus();
      }
    }
    return;
  }
  const send = e.target.closest('[data-moment-comment-send]');
  if (send) {
    const postId = send.dataset.momentCommentSend;
    const input = $('moments-feed').querySelector('[data-moment-comment-input="' + postId + '"]');
    const text = input ? input.value.trim() : '';
    if (!text) { toast('先写一句评论'); return; }
    if (input) input.value = '';
    await addUserMomentComment(postId, text);
    return;
  }
  const delComment = e.target.closest('[data-moment-comment-delete]');
  if (delComment) {
    await deleteMomentComment(delComment.dataset.momentCommentPost, delComment.dataset.momentCommentDelete);
    await refreshMomentsUI();
    return;
  }
  const del = e.target.closest('[data-moment-delete]');
  if (del) {
    if (!window.confirm('删除这条动态？')) return;
    await deleteMomentPost(del.dataset.momentDelete);
    await refreshMomentsUI();
    toast('动态已删除');
  }
});

$('moments-feed').addEventListener('keydown', (e) => {
  const input = e.target.closest('[data-moment-comment-input]');
  if (!input) return;
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    const postId = input.dataset.momentCommentInput;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addUserMomentComment(postId, text).catch(() => {});
  }
});

$('phone-notice').addEventListener('click', () => {
  const box = $('phone-notice');
  const characterId = box.dataset.characterId;
  const target = box.dataset.target;
  hidePhoneNotice();
  if (target === 'moments') { openMoments().catch(() => {}); return; }
  if (target === 'chat' && characterId) {
    setActiveCharacter(characterId).then(() => openChat()).catch(() => {});
    return;
  }
  if (characterId) openDiary(characterId).catch(() => {});
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
  startMailScheduler();
  startDiaryScheduler();
  startScheduleScheduler();
  startMomentsScheduler();
})();

// 回到前台时补检查一次邮箱 / 日记定时任务
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  runEmailSchedule().catch(() => {});
  runDiarySchedule().catch(() => {});
  runScheduleSchedule().catch(() => {});
  runMomentsSchedule().catch(() => {});
});
