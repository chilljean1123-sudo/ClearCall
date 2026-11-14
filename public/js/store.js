// ===== 数据存取层 =====
// 职责划分：
//   - localStorage：只放少量轻量设置与开关（AI 接口配置、回复触发模式）。
//   - IndexedDB：放聊天记录、角色、图片等大块/结构化数据。
// 不碰 DOM、不发请求。供 app.js（编排）与 ui.js（渲染）调用。

// ---------- localStorage：轻量设置与开关 ----------
const KEYS = {
  baseUrl: 'clearcall.baseUrl',
  apiKey: 'clearcall.apiKey',
  model: 'clearcall.model',
  modelMode: 'clearcall.modelMode',
};

const TRIGGER_KEYS = {
  instant: 'clearcall.trigger.instant',
  batch: 'clearcall.trigger.batch',
  countdown: 'clearcall.trigger.countdown',
  countdownSec: 'clearcall.trigger.countdownSec',
};

// 旧版（纯 localStorage）数据键，用于一次性迁移
const OLD_KEYS = {
  name: 'clearcall.charName',
  avatar: 'clearcall.charAvatar',
  persona: 'clearcall.charPersona',
  history: 'clearcall.chatHistory',
};
const MIGRATED_KEY = 'clearcall.migrated';

// 记忆服务（独立配置，用于整理长期记忆）
const MEMORY_KEYS = {
  baseUrl: 'clearcall.memoryBaseUrl',
  apiKey: 'clearcall.memoryApiKey',
  model: 'clearcall.memoryModel',
};

// 语音服务（TTS 接口，供角色语音绑定使用）
const VOICE_KEYS = {
  baseUrl: 'clearcall.voiceBaseUrl',
  apiKey: 'clearcall.voiceApiKey',
  model: 'clearcall.voiceModel',
  voice: 'clearcall.voiceName',
};

// 生图服务（供角色外观生图 / 参考图绑定使用）
const IMAGE_KEYS = {
  baseUrl: 'clearcall.imageBaseUrl',
  apiKey: 'clearcall.imageApiKey',
  model: 'clearcall.imageModel',
  size: 'clearcall.imageSize',
};

const MEMORY_CATEGORY_LABELS = {
  personal: '个人信息',
  agreement: '约定与待办',
  event: '事件与进展',
  style: '风格偏好',
};

// 世界书注入位置
const WORLDBOOK_POSITION_LABELS = {
  before: '角色设定前',
  after: '角色设定后',
  depth: '指定深度插入',
};

// 世界书条目：内容必填；关键词留空 = 无条件触发；概率开关独立于关键词
function normalizeWorldbookEntry(raw) {
  if (!raw) return null;
  const content = String((raw.content !== undefined ? raw.content : raw.text) || '').trim();
  if (!content) return null;

  let keywords = raw.keywords;
  if (typeof keywords === 'string') keywords = keywords.split(/[,，、\n]/);
  if (!Array.isArray(keywords)) keywords = [];
  keywords = keywords.map((k) => String(k).trim()).filter(Boolean);

  const position = WORLDBOOK_POSITION_LABELS[raw.position] ? raw.position : 'before';
  let depth = parseInt(raw.depth, 10);
  if (!Number.isFinite(depth) || depth < 0) depth = 0;
  let weight = parseFloat(raw.weight);
  if (!Number.isFinite(weight)) weight = 10;
  let probability = parseInt(raw.probability, 10);
  if (!Number.isFinite(probability)) probability = 100;
  probability = Math.max(0, Math.min(100, probability));

  return {
    content,
    keywords,
    position,
    depth,
    weight,
    probabilityEnabled: !!raw.probabilityEnabled,
    probability,
  };
}

// 从表单/文件文本里拆出关键词（支持中英文逗号、顿号、换行）
function parseWorldbookKeywords(text) {
  return String(text || '')
    .split(/[,，、\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
}

// ---------- AI 接口设置（localStorage） ----------
function getSettings() {
  return {
    baseUrl: localStorage.getItem(KEYS.baseUrl) || '',
    apiKey: localStorage.getItem(KEYS.apiKey) || '',
    model: localStorage.getItem(KEYS.model) || '',
    modelMode: localStorage.getItem(KEYS.modelMode) || 'select',
  };
}

function setSettings(s) {
  localStorage.setItem(KEYS.baseUrl, (s && s.baseUrl) || '');
  localStorage.setItem(KEYS.apiKey, (s && s.apiKey) || '');
  localStorage.setItem(KEYS.model, (s && s.model) || '');
  localStorage.setItem(KEYS.modelMode, (s && s.modelMode) || 'select');
}

// ---------- 回复触发模式（localStorage 开关） ----------
function getTriggerModes() {
  return {
    instant: localStorage.getItem(TRIGGER_KEYS.instant) === '1',
    batch: localStorage.getItem(TRIGGER_KEYS.batch) === '1',
    countdown: localStorage.getItem(TRIGGER_KEYS.countdown) === '1',
    countdownSec: Math.max(1, parseInt(localStorage.getItem(TRIGGER_KEYS.countdownSec) || '3', 10) || 3),
  };
}

function setTriggerModes(m) {
  localStorage.setItem(TRIGGER_KEYS.instant, (m && m.instant) ? '1' : '0');
  localStorage.setItem(TRIGGER_KEYS.batch, (m && m.batch) ? '1' : '0');
  localStorage.setItem(TRIGGER_KEYS.countdown, (m && m.countdown) ? '1' : '0');
  localStorage.setItem(TRIGGER_KEYS.countdownSec, String(Math.max(1, (m && m.countdownSec) || 3)));
}

// ---------- 记忆服务设置（localStorage） ----------
function getMemorySettings() {
  return {
    baseUrl: localStorage.getItem(MEMORY_KEYS.baseUrl) || '',
    apiKey: localStorage.getItem(MEMORY_KEYS.apiKey) || '',
    model: localStorage.getItem(MEMORY_KEYS.model) || '',
  };
}

function setMemorySettings(s) {
  localStorage.setItem(MEMORY_KEYS.baseUrl, (s && s.baseUrl) || '');
  localStorage.setItem(MEMORY_KEYS.apiKey, (s && s.apiKey) || '');
  localStorage.setItem(MEMORY_KEYS.model, (s && s.model) || '');
}

// ---------- 语音服务设置（localStorage） ----------
function getVoiceSettings() {
  return {
    baseUrl: localStorage.getItem(VOICE_KEYS.baseUrl) || '',
    apiKey: localStorage.getItem(VOICE_KEYS.apiKey) || '',
    model: localStorage.getItem(VOICE_KEYS.model) || '',
    voice: localStorage.getItem(VOICE_KEYS.voice) || '',
  };
}

function setVoiceSettings(s) {
  localStorage.setItem(VOICE_KEYS.baseUrl, (s && s.baseUrl) || '');
  localStorage.setItem(VOICE_KEYS.apiKey, (s && s.apiKey) || '');
  localStorage.setItem(VOICE_KEYS.model, (s && s.model) || '');
  localStorage.setItem(VOICE_KEYS.voice, (s && s.voice) || '');
}

// ---------- 生图服务设置（localStorage） ----------
function getImageSettings() {
  return {
    baseUrl: localStorage.getItem(IMAGE_KEYS.baseUrl) || '',
    apiKey: localStorage.getItem(IMAGE_KEYS.apiKey) || '',
    model: localStorage.getItem(IMAGE_KEYS.model) || '',
    size: localStorage.getItem(IMAGE_KEYS.size) || '',
  };
}

function setImageSettings(s) {
  localStorage.setItem(IMAGE_KEYS.baseUrl, (s && s.baseUrl) || '');
  localStorage.setItem(IMAGE_KEYS.apiKey, (s && s.apiKey) || '');
  localStorage.setItem(IMAGE_KEYS.model, (s && s.model) || '');
  localStorage.setItem(IMAGE_KEYS.size, (s && s.size) || '');
}

// ---------- IndexedDB 基础 ----------
const DB_NAME = 'clearcall';
const DB_VERSION = 1;
const STORE_DOCS = 'documents';   // 各类结构化文档：角色、聊天记录、未来记忆/各 App 存档
const STORE_FILES = 'files';      // 图片等二进制 Blob，用稳定 id 引用
const DOC_CHARACTERS = 'characters';   // 角色列表：{ list: [...], activeId }
const DOC_CHARACTER = 'character';     // 旧版单角色文档（仅用于迁移 / 兼容旧备份）
const DOC_CHAT = 'chatHistory';        // 旧版聊天文档（迁移用；新数据按角色分仓）
const DOC_MEMORY = 'memory';           // 旧版记忆文档（迁移用；新数据按角色分仓）
const DOC_WORLDBOOK = 'worldbook';
const DOC_STICKERS = 'stickers';       // 表情包按角色分仓：stickers:<角色id>
const DOC_APPEARANCE = 'appearance';   // 美化：主屏壁纸 / 各应用图标 / 状态栏开关
const DOC_NOTIFICATION = 'notification'; // 通知：开关 / 自定义提示音 / 后台保活
const LEGACY_CHARACTER_ID = 'character';

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('当前浏览器不支持本地数据库（IndexedDB），无法保存数据'));
  }
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DOCS)) db.createObjectStore(STORE_DOCS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_FILES)) db.createObjectStore(STORE_FILES, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { _dbPromise = null; reject(req.error); };
    req.onblocked = () => { _dbPromise = null; reject(new Error('数据库被其他标签页占用，请关闭其它标签页后重试')); };
  });
  return _dbPromise;
}

function friendlyError(e) {
  if (e && e.name === 'QuotaExceededError') {
    return new Error('存储空间不足：浏览器本地空间已满，请删除部分内容或换个浏览器后重试');
  }
  if (e && e.name === 'VersionError') {
    return new Error('数据库版本冲突，请刷新页面重试');
  }
  return e || new Error('数据库操作失败');
}

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(friendlyError(req.error));
  });
}

function txComplete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(friendlyError(tx.error));
    tx.onabort = () => reject(friendlyError(tx.error || new Error('事务中止')));
  });
}

async function getDoc(id) {
  const db = await openDB();
  const tx = db.transaction(STORE_DOCS, 'readonly');
  return await idbRequest(tx.objectStore(STORE_DOCS).get(id));
}

async function hasDoc(id) {
  return !!(await getDoc(id));
}

async function putDoc(doc) {
  if (!doc || !doc.id) throw new Error('文档缺少 id');
  const db = await openDB();
  const tx = db.transaction(STORE_DOCS, 'readwrite');
  tx.objectStore(STORE_DOCS).put(doc);
  await txComplete(tx);
}

async function deleteDoc(id) {
  const db = await openDB();
  const tx = db.transaction(STORE_DOCS, 'readwrite');
  tx.objectStore(STORE_DOCS).delete(id);
  await txComplete(tx);
}

async function getFile(id) {
  const db = await openDB();
  const tx = db.transaction(STORE_FILES, 'readonly');
  return await idbRequest(tx.objectStore(STORE_FILES).get(id));
}

// 聊天图片的对象 URL 缓存：同一文件多次渲染只创建一次
const _fileUrlCache = new Map();

async function getFileUrl(id) {
  if (!id) return '';
  if (_fileUrlCache.has(id)) return _fileUrlCache.get(id);
  const f = await getFile(id);
  if (!f || !f.blob) return '';
  const url = URL.createObjectURL(f.blob);
  _fileUrlCache.set(id, url);
  return url;
}

function revokeFileUrl(id) {
  const url = _fileUrlCache.get(id);
  if (url) { URL.revokeObjectURL(url); _fileUrlCache.delete(id); }
}

function revokeAllFileUrls() {
  _fileUrlCache.forEach((url) => URL.revokeObjectURL(url));
  _fileUrlCache.clear();
}

async function putFile(file) {
  if (!file || !file.id) throw new Error('文件缺少 id');
  const db = await openDB();
  const tx = db.transaction(STORE_FILES, 'readwrite');
  tx.objectStore(STORE_FILES).put(file);
  await txComplete(tx);
}

async function deleteFile(id) {
  const db = await openDB();
  const tx = db.transaction(STORE_FILES, 'readwrite');
  tx.objectStore(STORE_FILES).delete(id);
  await txComplete(tx);
}

async function clearFiles() {
  revokeAllFileUrls();
  const db = await openDB();
  const tx = db.transaction(STORE_FILES, 'readwrite');
  tx.objectStore(STORE_FILES).clear();
  await txComplete(tx);
}

function genId() {
  if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// ---------- 美化（IndexedDB） ----------
// 壁纸与各应用图标图片存 files，appearance 只存引用 id；状态栏开关是轻量设置。
function normalizeIconIds(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  Object.keys(src).forEach((app) => {
    const id = src[app];
    if (id) out[app] = id;
  });
  return out;
}

function normalizeAppearance(doc) {
  const d = doc || {};
  return {
    wallpaperId: d.wallpaperId || null,
    icons: normalizeIconIds(d.icons),
    statusBar: d.statusBar !== false,
  };
}

async function getAppearance() {
  return normalizeAppearance(await getDoc(DOC_APPEARANCE));
}

function setAppearance(patch) {
  return mutateDoc(DOC_APPEARANCE, (doc) => {
    const next = Object.assign(normalizeAppearance(doc), patch || {});
    doc.wallpaperId = next.wallpaperId || null;
    doc.icons = normalizeIconIds(next.icons);
    doc.statusBar = next.statusBar !== false;
  });
}

// 仅主屏幕壁纸
async function setAppearanceImageBlob(kind, blob, type, name) {
  if (kind !== 'wallpaper') throw new Error('请使用 setAppearanceIconBlob 设置单个图标');
  const cfg = await getAppearance();
  const oldId = cfg.wallpaperId;
  const id = genId();
  await putFile({ id, name: name || kind, type: type || (blob && blob.type) || 'image/jpeg', blob });
  await setAppearance({ wallpaperId: id });
  if (oldId) {
    try { await deleteFile(oldId); } catch (_) {}
    revokeFileUrl(oldId);
  }
  return id;
}

async function clearAppearanceImage(kind) {
  if (kind !== 'wallpaper') throw new Error('请使用 clearAppearanceIcon 恢复单个图标');
  const cfg = await getAppearance();
  const oldId = cfg.wallpaperId;
  await setAppearance({ wallpaperId: null });
  if (oldId) {
    try { await deleteFile(oldId); } catch (_) {}
    revokeFileUrl(oldId);
  }
}

// 单个应用图标：只替换该 app 的图标，并清理旧图
async function setAppearanceIconBlob(app, blob, type, name) {
  if (!app) throw new Error('缺少应用标识');
  const cfg = await getAppearance();
  const oldId = cfg.icons[app];
  const id = genId();
  await putFile({ id, name: name || ('icon-' + app), type: type || (blob && blob.type) || 'image/png', blob });
  const icons = Object.assign({}, cfg.icons);
  icons[app] = id;
  await setAppearance({ icons });
  if (oldId) {
    try { await deleteFile(oldId); } catch (_) {}
    revokeFileUrl(oldId);
  }
  return id;
}

async function clearAppearanceIcon(app) {
  if (!app) return;
  const cfg = await getAppearance();
  const oldId = cfg.icons[app];
  if (!oldId) return;
  const icons = Object.assign({}, cfg.icons);
  delete icons[app];
  await setAppearance({ icons });
  try { await deleteFile(oldId); } catch (_) {}
  revokeFileUrl(oldId);
}

async function getAppearanceIconUrl(app) {
  const cfg = await getAppearance();
  return getFileUrl(cfg.icons[app]);
}

// ---------- 通知（IndexedDB） ----------
// 通知开关与保活开关是轻量设置；提示音 Blob 存 files，文档只存引用。
function normalizeNotification(doc) {
  const d = doc || {};
  return {
    enabled: !!d.enabled,
    keepAlive: !!d.keepAlive,
    soundId: d.soundId || null,
    soundName: d.soundName || '',
    soundType: d.soundType || '',
  };
}

async function getNotificationConfig() {
  return normalizeNotification(await getDoc(DOC_NOTIFICATION));
}

function setNotificationConfig(patch) {
  return mutateDoc(DOC_NOTIFICATION, (doc) => {
    const next = Object.assign(normalizeNotification(doc), patch || {});
    doc.enabled = !!next.enabled;
    doc.keepAlive = !!next.keepAlive;
    doc.soundId = next.soundId || null;
    doc.soundName = next.soundName || '';
    doc.soundType = next.soundType || '';
  });
}

async function setNotificationSound(blob, type, name) {
  if (!blob) throw new Error('缺少提示音文件');
  const cfg = await getNotificationConfig();
  const oldId = cfg.soundId;
  const id = genId();
  await putFile({ id, name: name || 'notification-sound', type: type || blob.type || 'audio/mpeg', blob });
  await setNotificationConfig({ soundId: id, soundName: name || '提示音', soundType: type || blob.type || '' });
  if (oldId) {
    try { await deleteFile(oldId); } catch (_) {}
    revokeFileUrl(oldId);
  }
  return id;
}

async function clearNotificationSound() {
  const cfg = await getNotificationConfig();
  if (!cfg.soundId) return;
  await setNotificationConfig({ soundId: null, soundName: '', soundType: '' });
  try { await deleteFile(cfg.soundId); } catch (_) {}
  revokeFileUrl(cfg.soundId);
}

async function getNotificationSoundUrl() {
  const cfg = await getNotificationConfig();
  return getFileUrl(cfg.soundId);
}

// 在一个事务里完成「读-改-写」，避免并发写丢字段
function mutateDoc(id, mutator) {
  return new Promise((resolve, reject) => {
    openDB().then((db) => {
      const tx = db.transaction(STORE_DOCS, 'readwrite');
      const store = tx.objectStore(STORE_DOCS);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const doc = getReq.result || { id };
        mutator(doc);
        store.put(doc);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(friendlyError(tx.error));
      tx.onabort = () => reject(friendlyError(tx.error || new Error('事务中止')));
    }).catch(reject);
  });
}

// ---------- 角色（IndexedDB，多角色） ----------
// 角色列表存在 characters 文档里：{ list: [{id,name,persona,avatarId}], activeId }
// 头像图片以 Blob 存在 files，角色记录只存 avatarId 引用；聊天 / 记忆按角色 id 分仓。

function normalizeCharacterVoice(raw) {
  const v = raw || {};
  return {
    enabled: !!v.enabled,
    voiceId: String(v.voiceId || '').trim(),
    model: String(v.model || '').trim(),
  };
}

function normalizeCharacterImage(raw) {
  const v = raw || {};
  return {
    enabled: !!v.enabled,
    prompt: String(v.prompt || ''),
    referenceImageId: v.referenceImageId || null,
  };
}

function normalizeCharacter(raw, fallbackId) {
  if (!raw) return null;
  return {
    id: raw.id || fallbackId || genId(),
    name: String(raw.name || '').trim(),
    persona: String(raw.persona || ''),
    avatarId: raw.avatarId || null,
    voice: normalizeCharacterVoice(raw.voice),
    image: normalizeCharacterImage(raw.image),
    createdAt: raw.createdAt || Date.now(),
    updatedAt: raw.updatedAt || Date.now(),
  };
}

async function getCharacters() {
  const doc = await getDoc(DOC_CHARACTERS);
  const list = (doc && Array.isArray(doc.list))
    ? doc.list.map((c) => normalizeCharacter(c)).filter(Boolean)
    : [];
  let activeId = (doc && doc.activeId) || null;
  if (!list.some((c) => c.id === activeId)) activeId = list.length ? list[0].id : null;
  return { list, activeId };
}

async function getActiveCharacterId() {
  const { activeId } = await getCharacters();
  return activeId;
}

async function getActiveCharacter() {
  const { list, activeId } = await getCharacters();
  return list.find((c) => c.id === activeId) || null;
}

async function getCharacter(id) {
  if (!id) return null;
  const { list } = await getCharacters();
  return list.find((c) => c.id === id) || null;
}

async function setActiveCharacter(id) {
  await mutateDoc(DOC_CHARACTERS, (doc) => {
    if (!Array.isArray(doc.list)) doc.list = [];
    if (doc.list.some((c) => c.id === id)) doc.activeId = id;
  });
}

async function addCharacter({ name, persona, voice, image } = {}) {
  const record = normalizeCharacter({ name, persona, avatarId: null, voice, image });
  await mutateDoc(DOC_CHARACTERS, (doc) => {
    if (!Array.isArray(doc.list)) doc.list = [];
    doc.list.push(record);
    if (!doc.activeId) doc.activeId = record.id;
  });
  return record;
}

async function updateCharacterRecord(id, patch) {
  await mutateDoc(DOC_CHARACTERS, (doc) => {
    if (!Array.isArray(doc.list)) doc.list = [];
    const c = doc.list.find((x) => x.id === id);
    if (!c) return;
    if (patch.name !== undefined) c.name = String(patch.name || '').trim();
    if (patch.persona !== undefined) c.persona = String(patch.persona || '');
    if (patch.avatarId !== undefined) c.avatarId = patch.avatarId || null;
    if (patch.voice !== undefined) c.voice = normalizeCharacterVoice(Object.assign({}, c.voice, patch.voice));
    if (patch.image !== undefined) c.image = normalizeCharacterImage(Object.assign({}, c.image, patch.image));
    c.updatedAt = Date.now();
  });
}

// 头像对象 URL 缓存：avatarId -> url
const _avatarUrls = new Map();

function revokeAvatarUrl(avatarId) {
  const url = _avatarUrls.get(avatarId);
  if (url) { URL.revokeObjectURL(url); _avatarUrls.delete(avatarId); }
}

function revokeAllAvatarUrls() {
  _avatarUrls.forEach((url) => URL.revokeObjectURL(url));
  _avatarUrls.clear();
}

async function getAvatarUrlById(avatarId) {
  if (!avatarId) return '';
  if (_avatarUrls.has(avatarId)) return _avatarUrls.get(avatarId);
  const f = await getFile(avatarId);
  if (!f || !f.blob) return '';
  const url = URL.createObjectURL(f.blob);
  _avatarUrls.set(avatarId, url);
  return url;
}

async function getCharacterAvatarUrl(id) {
  const c = await getCharacter(id);
  return c ? getAvatarUrlById(c.avatarId) : '';
}

async function setCharacterAvatarBlob(characterId, blob, type, name) {
  const c = await getCharacter(characterId);
  if (!c) throw new Error('角色不存在');
  const id = genId();
  await putFile({ id, name: name || 'avatar', type: type || (blob && blob.type) || 'image/jpeg', blob });
  await updateCharacterRecord(characterId, { avatarId: id });
  if (c.avatarId) {
    revokeAvatarUrl(c.avatarId);
    try { await deleteFile(c.avatarId); } catch (_) {}
  }
  return id;
}

async function clearCharacterAvatar(characterId) {
  const c = await getCharacter(characterId);
  if (!c) return;
  await updateCharacterRecord(characterId, { avatarId: null });
  if (c.avatarId) {
    revokeAvatarUrl(c.avatarId);
    try { await deleteFile(c.avatarId); } catch (_) {}
  }
}

// 生图参考图：同样以 Blob 存 files，角色记录只存 image.referenceImageId
async function setCharacterReferenceImage(characterId, blob, type, name) {
  const c = await getCharacter(characterId);
  if (!c) throw new Error('角色不存在');
  const oldId = c.image && c.image.referenceImageId;
  const id = genId();
  await putFile({ id, name: name || 'reference', type: type || (blob && blob.type) || 'image/jpeg', blob });
  await updateCharacterRecord(characterId, { image: { referenceImageId: id } });
  if (oldId) {
    revokeAvatarUrl(oldId);
    try { await deleteFile(oldId); } catch (_) {}
  }
  return id;
}

async function clearCharacterReferenceImage(characterId) {
  const c = await getCharacter(characterId);
  if (!c) return;
  const oldId = c.image && c.image.referenceImageId;
  await updateCharacterRecord(characterId, { image: { referenceImageId: null } });
  if (oldId) {
    revokeAvatarUrl(oldId);
    try { await deleteFile(oldId); } catch (_) {}
  }
}

async function getReferenceImageUrl(characterId) {
  const c = await getCharacter(characterId);
  const id = c && c.image && c.image.referenceImageId;
  return id ? getAvatarUrlById(id) : '';
}

// 删除角色：连同它的聊天、记忆、绑定的世界书条目一起清理
async function deleteCharacter(id) {
  const c = await getCharacter(id);
  if (!c) return;
  if (c.avatarId) {
    revokeAvatarUrl(c.avatarId);
    try { await deleteFile(c.avatarId); } catch (_) {}
  }
  const refId = c.image && c.image.referenceImageId;
  if (refId) {
    revokeAvatarUrl(refId);
    try { await deleteFile(refId); } catch (_) {}
  }
  // 聊天里发送过的图片文件也一并清理，避免孤儿 Blob
  const chatDoc = await getDoc(chatDocId(id));
  if (chatDoc && Array.isArray(chatDoc.messages)) {
    for (const m of chatDoc.messages) {
      if (m && m.imageId) {
        revokeFileUrl(m.imageId);
        try { await deleteFile(m.imageId); } catch (_) {}
      }
    }
  }
  try { await deleteDoc(chatDocId(id)); } catch (_) {}
  try { await deleteDoc(memoryDocId(id)); } catch (_) {}
  try { await deleteDoc(stickerDocId(id)); } catch (_) {}

  const wb = await getWorldbook();
  if (wb.some((e) => e.scope === 'character' && e.characterId === id)) {
    await putDoc({ id: DOC_WORLDBOOK, entries: wb.filter((e) => !(e.scope === 'character' && e.characterId === id)) });
  }

  await mutateDoc(DOC_CHARACTERS, (doc) => {
    if (!Array.isArray(doc.list)) doc.list = [];
    doc.list = doc.list.filter((x) => x.id !== id);
    if (doc.activeId === id || !doc.list.some((x) => x.id === doc.activeId)) {
      doc.activeId = doc.list.length ? doc.list[0].id : null;
    }
  });
}

// 当前角色（聊天、记忆默认都取当前角色）
async function getChar() {
  const c = await getActiveCharacter();
  if (!c) return { id: null, name: '', persona: '', avatar: '' };
  return { ...c, avatar: await getAvatarUrlById(c.avatarId) };
}

// ---------- 聊天记录（IndexedDB，按角色分仓） ----------
function chatDocId(characterId) { return DOC_CHAT + ':' + characterId; }

async function getHistory(characterId) {
  const id = characterId || await getActiveCharacterId();
  if (!id) return [];
  const doc = await getDoc(chatDocId(id));
  const arr = doc && doc.messages;
  return Array.isArray(arr) ? arr : [];
}

// 原子地修改聊天记录，避免并发写入丢消息
async function mutateHistory(mutator, characterId) {
  const id = characterId || await getActiveCharacterId();
  if (!id) throw new Error('请先创建角色');
  return mutateDoc(chatDocId(id), (doc) => {
    if (!Array.isArray(doc.messages)) doc.messages = [];
    mutator(doc.messages);
  });
}

// 系统指令：只对当前角色生效，下次回复时注入并清除
async function getPendingDirective(characterId) {
  const id = characterId || await getActiveCharacterId();
  if (!id) return '';
  const doc = await getDoc(chatDocId(id));
  return (doc && typeof doc.directive === 'string') ? doc.directive : '';
}

async function setPendingDirective(text, characterId) {
  const id = characterId || await getActiveCharacterId();
  if (!id) throw new Error('请先创建角色');
  const t = String(text || '').trim();
  await mutateDoc(chatDocId(id), (doc) => {
    if (t) doc.directive = t;
    else delete doc.directive;
  });
}

async function clearPendingDirective(characterId) {
  return setPendingDirective('', characterId);
}

// ---------- 表情包（IndexedDB，按角色分仓） ----------
// 只存远程图片 URL 和名称，不把表情包图片下载进本地库。
function stickerDocId(characterId) { return DOC_STICKERS + ':' + characterId; }

function normalizeSticker(raw) {
  if (!raw) return null;
  const url = String(raw.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  let name = String(raw.name || '').trim();
  if (!name) {
    // 从 URL 末段推导名称，不依赖 URL 构造函数（兼容旧环境）
    const path = url.split('#')[0].split('?')[0].replace(/^https?:\/\/[^/]+/i, '');
    const last = path.split('/').filter(Boolean).pop() || '';
    try { name = decodeURIComponent(last).replace(/\.[a-z0-9]+$/i, ''); } catch (_) { name = last; }
  }
  name = name.replace(/[\[\]\r\n]/g, ' ').trim().slice(0, 40) || '表情包';
  return {
    id: raw.id || genId(),
    name,
    url,
    createdAt: raw.createdAt || Date.now(),
  };
}

async function getStickers(characterId) {
  const id = characterId || await getActiveCharacterId();
  if (!id) return [];
  const doc = await getDoc(stickerDocId(id));
  const items = doc && doc.items;
  return Array.isArray(items) ? items.map(normalizeSticker).filter(Boolean) : [];
}

// 批量导入；按 URL 去重，重名自动加序号，返回新增条目
async function addStickers(characterId, items) {
  const id = characterId || await getActiveCharacterId();
  if (!id) throw new Error('请先创建角色');
  const incoming = (Array.isArray(items) ? items : []).map(normalizeSticker).filter(Boolean);
  const added = [];
  await mutateDoc(stickerDocId(id), (doc) => {
    if (!Array.isArray(doc.items)) doc.items = [];
    const urls = new Set(doc.items.map((x) => x.url));
    const names = new Set(doc.items.map((x) => x.name));
    incoming.forEach((s) => {
      if (urls.has(s.url)) return;
      let n = s.name;
      let k = 2;
      while (names.has(n)) { n = s.name + '（' + k + '）'; k++; }
      s.name = n;
      urls.add(s.url);
      names.add(n);
      doc.items.push(s);
      added.push(s);
    });
  });
  return added;
}

async function deleteSticker(characterId, stickerId) {
  const id = characterId || await getActiveCharacterId();
  if (!id) throw new Error('请先创建角色');
  await mutateDoc(stickerDocId(id), (doc) => {
    if (!Array.isArray(doc.items)) doc.items = [];
    doc.items = doc.items.filter((x) => x.id !== stickerId);
  });
}

// ---------- 记忆（IndexedDB，按角色分仓） ----------
// 每条记忆用稳定 id 存，分类 + 一句话事实；以后加向量检索可按 id/text 扩展。
function memoryDocId(characterId) { return DOC_MEMORY + ':' + characterId; }

async function getMemory(characterId) {
  const id = characterId || await getActiveCharacterId();
  if (!id) return { entries: [], lastSummarizedCount: 0 };
  const doc = await getDoc(memoryDocId(id));
  return {
    entries: (doc && Array.isArray(doc.entries)) ? doc.entries : [],
    lastSummarizedCount: (doc && typeof doc.lastSummarizedCount === 'number') ? doc.lastSummarizedCount : 0,
  };
}

async function mutateMemory(mutator, characterId) {
  const id = characterId || await getActiveCharacterId();
  if (!id) throw new Error('请先创建角色');
  return mutateDoc(memoryDocId(id), (doc) => {
    if (!Array.isArray(doc.entries)) doc.entries = [];
    if (typeof doc.lastSummarizedCount !== 'number') doc.lastSummarizedCount = 0;
    mutator(doc);
  });
}

async function addMemoryEntry({ category, text }, characterId) {
  const entry = { id: genId(), category: category || 'personal', text: (text || '').trim(), createdAt: Date.now(), updatedAt: Date.now() };
  if (!entry.text) return entry;
  await mutateMemory((doc) => doc.entries.push(entry), characterId);
  return entry;
}

async function updateMemoryEntry(id, { category, text }, characterId) {
  await mutateMemory((doc) => {
    const e = doc.entries.find((x) => x.id === id);
    if (!e) return;
    if (category) e.category = category;
    if (text !== undefined) e.text = (text || '').trim();
    e.updatedAt = Date.now();
  }, characterId);
}

async function deleteMemoryEntry(id, characterId) {
  await mutateMemory((doc) => {
    doc.entries = doc.entries.filter((x) => x.id !== id);
  }, characterId);
}

async function setLastSummarizedCount(n, characterId) {
  await mutateMemory((doc) => { doc.lastSummarizedCount = n; }, characterId);
}

// 合并新总结：同类别且文字一致的去重，其余追加
async function mergeMemoryEntries(newEntries, characterId) {
  await mutateMemory((doc) => {
    (newEntries || []).forEach((n) => {
      const text = (n && n.text) ? String(n.text).trim() : '';
      if (!text) return;
      const category = (n && n.category) || 'personal';
      const dup = doc.entries.some((e) => e.category === category && e.text.trim() === text);
      if (!dup) doc.entries.push({ id: genId(), category, text, createdAt: Date.now(), updatedAt: Date.now() });
    });
  }, characterId);
}

// 把记忆条目格式化成发给 AI 的文本
function formatMemory(entries) {
  if (!Array.isArray(entries) || !entries.length) return '';
  return entries.map((e) => '[' + (MEMORY_CATEGORY_LABELS[e.category] || e.category) + '] ' + e.text).join('\n');
}

// ---------- 世界书（IndexedDB） ----------
// 条目统一存一个文档，用 scope 区分「全局」与「角色绑定」；角色绑定只匹配当前角色。
async function getWorldbook() {
  const doc = await getDoc(DOC_WORLDBOOK);
  const arr = doc && doc.entries;
  return Array.isArray(arr) ? arr : [];
}

function mutateWorldbook(mutator) {
  return mutateDoc(DOC_WORLDBOOK, (doc) => {
    if (!Array.isArray(doc.entries)) doc.entries = [];
    mutator(doc);
  });
}

function buildWorldbookRecord(raw, scope) {
  const e = normalizeWorldbookEntry(raw);
  if (!e) return null;
  const now = Date.now();
  const isChar = scope === 'character';
  return {
    id: (raw && raw.id) || genId(),
    scope: isChar ? 'character' : 'global',
    characterId: isChar ? ((raw && raw.characterId) || null) : null,
    ...e,
    createdAt: (raw && raw.createdAt) || now,
    updatedAt: now,
  };
}

async function addWorldbookEntry(entry) {
  const record = buildWorldbookRecord(entry, entry && entry.scope);
  if (!record) throw new Error('条目内容不能为空');
  await mutateWorldbook((doc) => doc.entries.push(record));
  return record;
}

async function addWorldbookEntries(list) {
  const records = (Array.isArray(list) ? list : [])
    .map((x) => buildWorldbookRecord(x, x && x.scope))
    .filter(Boolean);
  if (!records.length) return [];
  await mutateWorldbook((doc) => doc.entries.push(...records));
  return records;
}

async function updateWorldbookEntry(id, patch) {
  await mutateWorldbook((doc) => {
    const e = doc.entries.find((x) => x.id === id);
    if (!e) return;
    const n = normalizeWorldbookEntry({ ...e, ...patch });
    if (!n) return;
    const scope = (patch && (patch.scope === 'character' || patch.scope === 'global')) ? patch.scope : e.scope;
    const characterId = scope === 'character'
      ? ((patch && patch.characterId !== undefined) ? patch.characterId : e.characterId) || null
      : null;
    Object.assign(e, n, { scope, characterId, updatedAt: Date.now() });
  });
}

async function deleteWorldbookEntry(id) {
  await mutateWorldbook((doc) => {
    doc.entries = doc.entries.filter((x) => x.id !== id);
  });
}

// ---------- 备份：构建 / 应用 ----------
function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  try {
    const bytes = atob(m[2]);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: m[1] });
  } catch (_) { return null; }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function buildBackup() {
  const settings = getSettings();
  const trigger = getTriggerModes();
  const memorySettings = getMemorySettings();
  const voiceSettings = getVoiceSettings();
  const imageSettings = getImageSettings();
  const { list, activeId } = await getCharacters();
  const files = {};
  const characters = [];
  const chats = {};
  const directives = {};
  const stickers = {};
  const memories = {};

  for (const c of list) {
    const chatDoc = (await getDoc(chatDocId(c.id))) || {};
    const messages = Array.isArray(chatDoc.messages) ? chatDoc.messages : [];
    const fileIds = [c.avatarId, c.image && c.image.referenceImageId].filter(Boolean);
    messages.forEach((m) => { if (m && m.imageId) fileIds.push(m.imageId); });
    for (const fileId of fileIds) {
      const f = await getFile(fileId);
      if (f && f.blob) {
        files[fileId] = { name: f.name || 'image', type: f.type || 'image/jpeg', data: await blobToDataUrl(f.blob) };
      }
    }
    characters.push({
      id: c.id,
      name: c.name,
      persona: c.persona,
      avatarId: c.avatarId || null,
      voice: c.voice,
      image: c.image,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    });

    chats[c.id] = messages;
    directives[c.id] = chatDoc.directive || '';
    stickers[c.id] = await getStickers(c.id);
    const memDoc = (await getDoc(memoryDocId(c.id))) || {};
    memories[c.id] = {
      entries: Array.isArray(memDoc.entries) ? memDoc.entries : [],
      lastSummarizedCount: memDoc.lastSummarizedCount || 0,
    };
  }

  const wbDoc = (await getDoc(DOC_WORLDBOOK)) || {};
  const appearance = await getAppearance();
  const notification = await getNotificationConfig();
  const appearanceFileIds = [appearance.wallpaperId, ...Object.values(appearance.icons), notification.soundId].filter(Boolean);
  for (const fileId of appearanceFileIds) {
    const f = await getFile(fileId);
    if (f && f.blob) {
      files[fileId] = { name: f.name || 'image', type: f.type || 'image/jpeg', data: await blobToDataUrl(f.blob) };
    }
  }
  return {
    app: 'clearcall',
    version: 2,
    exportedAt: new Date().toISOString(),
    settings,
    trigger,
    memorySettings,
    voiceSettings,
    imageSettings,
    appearance,
    notification,
    characters,
    activeId,
    chats,
    directives,
    stickers,
    memories,
    worldbook: {
      entries: Array.isArray(wbDoc.entries) ? wbDoc.entries : [],
    },
    files,
  };
}

async function applyBackup(data) {
  if (!data || data.app !== 'clearcall') throw new Error('这不是本应用的备份文件');

  setSettings(data.settings || {});
  setTriggerModes(data.trigger || {});
  setMemorySettings(data.memorySettings || {});
  setVoiceSettings(data.voiceSettings || {});
  setImageSettings(data.imageSettings || {});

  // 统一成多角色结构；同时兼容旧版（version 1）单角色备份
  let characters;
  let activeId;
  let chats;
  let memories;
  let directives = {};
  let stickers = {};
  if (Array.isArray(data.characters)) {
    characters = data.characters.map((c) => normalizeCharacter(c)).filter(Boolean);
    activeId = data.activeId || (characters[0] && characters[0].id) || null;
    chats = data.chats || {};
    memories = data.memories || {};
    directives = data.directives || {};
    stickers = data.stickers || {};
  } else {
    const c = data.character || {};
    const id = LEGACY_CHARACTER_ID;
    characters = [normalizeCharacter({ id, name: c.name || '', persona: c.persona || '', avatarId: c.avatarId || null })];
    activeId = id;
    chats = { [id]: Array.isArray(data.chatHistory) ? data.chatHistory : [] };
    memories = {
      [id]: {
        entries: (data.memory && Array.isArray(data.memory.entries)) ? data.memory.entries : [],
        lastSummarizedCount: (data.memory && data.memory.lastSummarizedCount) || 0,
      },
    };
  }
  if (!characters.some((c) => c.id === activeId)) activeId = characters[0] ? characters[0].id : null;

  revokeAllAvatarUrls();

  // 图片：先清空旧文件，再写入备份里的（Blob），避免残留孤儿文件
  await clearFiles();
  const files = data.files || {};
  for (const id of Object.keys(files)) {
    const f = files[id] || {};
    const blob = dataUrlToBlob(f.data);
    if (blob) await putFile({ id, name: f.name || 'image', type: f.type || blob.type, blob });
  }

  await putDoc({ id: DOC_CHARACTERS, list: characters, activeId });
  const appearance = normalizeAppearance(data.appearance);
  await putDoc({
    id: DOC_APPEARANCE,
    wallpaperId: appearance.wallpaperId,
    icons: appearance.icons,
    statusBar: appearance.statusBar,
  });
  const notification = normalizeNotification(data.notification);
  await putDoc({
    id: DOC_NOTIFICATION,
    enabled: notification.enabled,
    keepAlive: notification.keepAlive,
    soundId: notification.soundId,
    soundName: notification.soundName,
    soundType: notification.soundType,
  });
  for (const c of characters) {
    const chat = chats[c.id];
    await putDoc({
      id: chatDocId(c.id),
      messages: Array.isArray(chat) ? chat : [],
      directive: directives[c.id] || '',
    });
    await putDoc({
      id: stickerDocId(c.id),
      items: Array.isArray(stickers[c.id]) ? stickers[c.id].map(normalizeSticker).filter(Boolean) : [],
    });
    const mem = memories[c.id] || {};
    await putDoc({
      id: memoryDocId(c.id),
      entries: Array.isArray(mem.entries) ? mem.entries : [],
      lastSummarizedCount: mem.lastSummarizedCount || 0,
    });
  }

  const wb = data.worldbook || {};
  const fallbackCharId = characters[0] ? characters[0].id : null;
  const wbEntries = (Array.isArray(wb.entries) ? wb.entries : [])
    .map((x) => {
      const scope = (x && x.scope === 'character') ? 'character' : 'global';
      const withId = scope === 'character'
        ? Object.assign({}, x, { characterId: (x && x.characterId) || fallbackCharId })
        : x;
      return buildWorldbookRecord(withId, scope);
    })
    .filter(Boolean);
  await putDoc({ id: DOC_WORLDBOOK, entries: wbEntries });

  // 清理旧版单角色文档，避免残留
  try { await deleteDoc(DOC_CHARACTER); } catch (_) {}
  try { await deleteDoc(DOC_CHAT); } catch (_) {}
  try { await deleteDoc(DOC_MEMORY); } catch (_) {}
}

// ---------- 旧数据迁移 ----------
async function migrate() {
  await migrateLegacyLocalStorage();
  await migrateToCharacters();
}

async function migrateLegacyLocalStorage() {
  if (localStorage.getItem(MIGRATED_KEY) === '1') return;

  const oldName = localStorage.getItem(OLD_KEYS.name);
  const oldPersona = localStorage.getItem(OLD_KEYS.persona);
  const oldAvatar = localStorage.getItem(OLD_KEYS.avatar);
  const oldHistory = localStorage.getItem(OLD_KEYS.history);

  const hasOld = oldName !== null || oldPersona !== null || oldAvatar !== null || oldHistory !== null;
  if (!hasOld) { localStorage.setItem(MIGRATED_KEY, '1'); return; }

  // 仅在目标尚不存在时写入，避免覆盖已迁移的数据
  if (!(await hasDoc(DOC_CHARACTER))) {
    let avatarId = null;
    if (oldAvatar) {
      const blob = dataUrlToBlob(oldAvatar);
      if (blob) {
        avatarId = genId();
        await putFile({ id: avatarId, name: 'avatar', type: blob.type || 'image/jpeg', blob });
      }
    }
    await putDoc({ id: DOC_CHARACTER, name: oldName || '', persona: oldPersona || '', avatarId });
  }

  if (!(await hasDoc(DOC_CHAT)) && oldHistory !== null) {
    let arr = [];
    try { arr = JSON.parse(oldHistory); } catch (_) { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    await putDoc({ id: DOC_CHAT, messages: arr });
  }

  // 迁移成功后清理旧键，避免重复
  Object.keys(OLD_KEYS).forEach((k) => localStorage.removeItem(OLD_KEYS[k]));
  localStorage.setItem(MIGRATED_KEY, '1');
}

// 单角色结构 → 多角色结构：旧数据归到 id='character' 的角色
async function migrateToCharacters() {
  if (await hasDoc(DOC_CHARACTERS)) return;

  const legacyChar = await getDoc(DOC_CHARACTER);
  const legacyChat = await getDoc(DOC_CHAT);
  const legacyMem = await getDoc(DOC_MEMORY);
  const wbDoc = await getDoc(DOC_WORLDBOOK);
  const wbEntries = Array.isArray(wbDoc && wbDoc.entries) ? wbDoc.entries : [];
  const hasCharScope = wbEntries.some((e) => e && e.scope === 'character');

  const hasLegacy = !!(legacyChar || legacyChat || legacyMem || hasCharScope);
  const list = [];
  let activeId = null;

  if (hasLegacy) {
    const id = LEGACY_CHARACTER_ID;
    list.push(normalizeCharacter({
      id,
      name: (legacyChar && legacyChar.name) || '',
      persona: (legacyChar && legacyChar.persona) || '',
      avatarId: (legacyChar && legacyChar.avatarId) || null,
    }));
    activeId = id;

    if (legacyChat && !(await hasDoc(chatDocId(id)))) {
      await putDoc({ id: chatDocId(id), messages: Array.isArray(legacyChat.messages) ? legacyChat.messages : [] });
    }
    if (legacyMem && !(await hasDoc(memoryDocId(id)))) {
      await putDoc({
        id: memoryDocId(id),
        entries: Array.isArray(legacyMem.entries) ? legacyMem.entries : [],
        lastSummarizedCount: legacyMem.lastSummarizedCount || 0,
      });
    }
    if (hasCharScope) {
      await putDoc({
        id: DOC_WORLDBOOK,
        entries: wbEntries.map((e) => (e && e.scope === 'character' ? Object.assign({}, e, { characterId: e.characterId || id }) : e)),
      });
    }

    // 旧文档迁移完成后清理，避免重复迁移
    try { await deleteDoc(DOC_CHARACTER); } catch (_) {}
    try { await deleteDoc(DOC_CHAT); } catch (_) {}
    try { await deleteDoc(DOC_MEMORY); } catch (_) {}
  }

  await putDoc({ id: DOC_CHARACTERS, list, activeId });
}
