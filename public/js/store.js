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

const MEMORY_CATEGORY_LABELS = {
  personal: '个人信息',
  agreement: '约定与待办',
  event: '事件与进展',
  style: '风格偏好',
};

// ---------- Cloudflare Worker 配置（用于主动消息推送） ----------
// 用户自部署 Worker，填入 Token 和 Worker URL 后，系统自动完成配置
const CF_KEYS = {
  token: 'clearcall.cfToken',          // Cloudflare API Token（需具备 Workers Edit + Account Settings Read 权限）
  accountId: 'clearcall.cfAccountId',  // Account ID（设置后可自动部署 Worker）
  workerUrl: 'clearcall.cfWorkerUrl',  // Worker 已部署的 URL（部署后自动填入）
  workerName: 'clearcall.cfWorkerName', // Worker 名称（部署后自动填入）
};

function getCfSettings() {
  return {
    token: localStorage.getItem(CF_KEYS.token) || '',
    accountId: localStorage.getItem(CF_KEYS.accountId) || '',
    workerUrl: localStorage.getItem(CF_KEYS.workerUrl) || '',
    workerName: localStorage.getItem(CF_KEYS.workerName) || '',
  };
}

function setCfSettings(s) {
  localStorage.setItem(CF_KEYS.token, (s && s.token) || '');
  localStorage.setItem(CF_KEYS.accountId, (s && s.accountId) || '');
  localStorage.setItem(CF_KEYS.workerUrl, (s && s.workerUrl) || '');
  localStorage.setItem(CF_KEYS.workerName, (s && s.workerName) || '');
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

// ---------- IndexedDB 基础 ----------
const DB_NAME = 'clearcall';
const DB_VERSION = 1;
const STORE_DOCS = 'documents';   // 各类结构化文档：角色、聊天记录、未来记忆/各 App 存档
const STORE_FILES = 'files';      // 图片等二进制 Blob，用稳定 id 引用
const DOC_CHARACTER = 'character';       // 旧版单角色文档，仅用于迁移
const DOC_CHARACTERS = 'characters';     // 多角色列表：{ activeId, list: [...] }
const DOC_CHAT = 'chatHistory';          // 旧版聊天文档，仅用于迁移
const DOC_CHAT_PREFIX = 'chatHistory:';  // 每个角色各自的聊天记录
const DOC_MEMORY = 'memory';
const DOC_STANDBY = 'standby';           // 待机页背景与每日台词

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
  const db = await openDB();
  const tx = db.transaction(STORE_FILES, 'readwrite');
  tx.objectStore(STORE_FILES).clear();
  await txComplete(tx);
}

function genId() {
  if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
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
// 角色列表存在 characters 文档；聊天记录按 role 各自存 chatHistory:<id>。
// 头像 / 待机立绘 / 说话立绘都以 Blob 存在 files，角色文档只存图片 id。

let _charsCache = null;
const _imageUrlCache = new Map(); // 图片 id -> objectURL

async function getImageUrl(id) {
  if (!id) return '';
  if (_imageUrlCache.has(id)) return _imageUrlCache.get(id);
  const f = await getFile(id);
  if (!f || !f.blob) return '';
  const url = URL.createObjectURL(f.blob);
  _imageUrlCache.set(id, url);
  return url;
}

function revokeImageUrl(id) {
  if (id && _imageUrlCache.has(id)) {
    URL.revokeObjectURL(_imageUrlCache.get(id));
    _imageUrlCache.delete(id);
  }
}

function revokeAllImageUrls() {
  _imageUrlCache.forEach((u) => URL.revokeObjectURL(u));
  _imageUrlCache.clear();
}

function normalizeChar(c) {
  return {
    id: c.id || genId(),
    name: typeof c.name === 'string' ? c.name : '',
    persona: typeof c.persona === 'string' ? c.persona : '',
    avatarId: c.avatarId || null,
    idleImageId: c.idleImageId || null,
    speakImageId: c.speakImageId || null,
  };
}

async function loadCharacters() {
  if (_charsCache) return _charsCache;
  let doc = await getDoc(DOC_CHARACTERS);
  if (!doc || !Array.isArray(doc.list) || !doc.list.length) {
    // 从旧版单角色文档迁移出第一个角色
    const old = (await getDoc(DOC_CHARACTER)) || {};
    const id = genId();
    doc = {
      id: DOC_CHARACTERS,
      activeId: id,
      list: [normalizeChar({ id, name: old.name, persona: old.persona, avatarId: old.avatarId })],
    };
    await putDoc(doc);
    // 旧版聊天记录归到第一个角色
    const oldChat = await getDoc(DOC_CHAT);
    if (oldChat && Array.isArray(oldChat.messages) && oldChat.messages.length) {
      await putDoc({ id: DOC_CHAT_PREFIX + id, messages: oldChat.messages });
    }
  }
  doc.list = doc.list.map(normalizeChar);
  if (!doc.list.some((c) => c.id === doc.activeId)) doc.activeId = doc.list[0].id;
  _charsCache = doc;
  return doc;
}

async function saveCharacters(doc) {
  _charsCache = doc;
  await putDoc(doc);
}

async function getCharacters() {
  const doc = await loadCharacters();
  return { list: doc.list.map((c) => ({ ...c })), activeId: doc.activeId };
}

async function getActiveCharDoc() {
  const doc = await loadCharacters();
  return doc.list.find((c) => c.id === doc.activeId) || doc.list[0];
}

async function getChar() {
  const c = await getActiveCharDoc();
  return { id: c.id, name: c.name, persona: c.persona, avatar: await getImageUrl(c.avatarId) };
}

async function setChar(patch) {
  const doc = await loadCharacters();
  const c = doc.list.find((x) => x.id === doc.activeId);
  if (!c) return;
  if (patch && patch.name !== undefined) c.name = patch.name;
  if (patch && patch.persona !== undefined) c.persona = patch.persona;
  await saveCharacters(doc);
}

async function setActiveCharacter(id) {
  const doc = await loadCharacters();
  if (!doc.list.some((c) => c.id === id)) return false;
  doc.activeId = id;
  await saveCharacters(doc);
  return true;
}

async function addCharacter(name) {
  const doc = await loadCharacters();
  const c = normalizeChar({ id: genId(), name: name || '' });
  doc.list.push(c);
  doc.activeId = c.id;
  await saveCharacters(doc);
  return c.id;
}

async function deleteCharacter(id) {
  const doc = await loadCharacters();
  if (doc.list.length <= 1) throw new Error('至少保留一个角色');
  const target = doc.list.find((c) => c.id === id);
  if (!target) return;
  doc.list = doc.list.filter((c) => c.id !== id);
  if (doc.activeId === id) doc.activeId = doc.list[0].id;
  await saveCharacters(doc);
  await deleteDoc(DOC_CHAT_PREFIX + id);
  for (const key of ['avatarId', 'idleImageId', 'speakImageId']) {
    if (target[key]) {
      try { await deleteFile(target[key]); } catch (_) {}
      revokeImageUrl(target[key]);
    }
  }
  await clearStandbyLines(id);
}

// kind: 'avatar' 头像 | 'idle' 待机立绘 | 'speak' 说话立绘
const CHAR_IMAGE_FIELDS = { avatar: 'avatarId', idle: 'idleImageId', speak: 'speakImageId' };

async function setCharImage(kind, blob, type, name) {
  const field = CHAR_IMAGE_FIELDS[kind];
  if (!field) throw new Error('未知图片类型');
  const doc = await loadCharacters();
  const c = doc.list.find((x) => x.id === doc.activeId);
  if (!c) throw new Error('没有可用的角色');
  const id = genId();
  await putFile({ id, name: name || kind, type: type || (blob && blob.type) || 'image/png', blob });
  const oldId = c[field];
  c[field] = id;
  await saveCharacters(doc);
  if (oldId) {
    try { await deleteFile(oldId); } catch (_) {}
    revokeImageUrl(oldId);
  }
  return id;
}

async function clearCharImage(kind) {
  const field = CHAR_IMAGE_FIELDS[kind];
  if (!field) throw new Error('未知图片类型');
  const doc = await loadCharacters();
  const c = doc.list.find((x) => x.id === doc.activeId);
  if (!c) return;
  const oldId = c[field];
  c[field] = null;
  await saveCharacters(doc);
  if (oldId) {
    try { await deleteFile(oldId); } catch (_) {}
    revokeImageUrl(oldId);
  }
}

async function setCharAvatarBlob(blob, type, name) {
  return setCharImage('avatar', blob, type, name);
}

async function clearCharAvatar() {
  return clearCharImage('avatar');
}

// ---------- 角色聊天记录（IndexedDB，按角色隔离） ----------
async function getActiveCharId() {
  return (await loadCharacters()).activeId;
}

async function getHistory() {
  const id = await getActiveCharId();
  const doc = await getDoc(DOC_CHAT_PREFIX + id);
  const arr = doc && doc.messages;
  return Array.isArray(arr) ? arr : [];
}

// 原子地修改聊天记录，避免并发写入丢消息
function mutateHistory(mutator) {
  return getActiveCharId().then((id) => mutateDoc(DOC_CHAT_PREFIX + id, (doc) => {
    if (!Array.isArray(doc.messages)) doc.messages = [];
    mutator(doc.messages);
  }));
}

// ---------- 待机页：背景与每日台词 ----------
function todayKey() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

async function getStandby() {
  const doc = (await getDoc(DOC_STANDBY)) || {};
  return {
    backgroundId: doc.backgroundId || null,
    linesByChar: (doc.linesByChar && typeof doc.linesByChar === 'object') ? doc.linesByChar : {},
  };
}

function mutateStandby(mutator) {
  return mutateDoc(DOC_STANDBY, (doc) => {
    if (!doc.backgroundId) doc.backgroundId = null;
    if (!doc.linesByChar || typeof doc.linesByChar !== 'object') doc.linesByChar = {};
    mutator(doc);
  });
}

async function getStandbyLines(charId) {
  const s = await getStandby();
  const rec = s.linesByChar[charId];
  if (!rec || !Array.isArray(rec.lines)) return { date: '', lines: [] };
  return { date: rec.date || '', lines: rec.lines.filter((x) => typeof x === 'string' && x.trim()) };
}

async function setStandbyLines(charId, date, lines) {
  await mutateStandby((doc) => {
    doc.linesByChar[charId] = { date, lines: (lines || []).filter(Boolean).slice(0, 5) };
  });
}

async function setStandbyLine(charId, index, text) {
  const clean = String(text || '').trim();
  if (!clean) return;
  await mutateStandby((doc) => {
    const rec = doc.linesByChar[charId];
    if (!rec || !Array.isArray(rec.lines)) return;
    if (index < 0 || index >= rec.lines.length) return;
    rec.lines[index] = clean;
  });
}

async function clearStandbyLines(charId) {
  await mutateStandby((doc) => { delete doc.linesByChar[charId]; });
}

async function getStandbyBackgroundUrl() {
  const s = await getStandby();
  return getImageUrl(s.backgroundId);
}

async function setStandbyBackgroundBlob(blob, type, name) {
  const s = await getStandby();
  const id = genId();
  await putFile({ id, name: name || 'standby-bg', type: type || (blob && blob.type) || 'image/jpeg', blob });
  await mutateStandby((doc) => { doc.backgroundId = id; });
  if (s.backgroundId) {
    try { await deleteFile(s.backgroundId); } catch (_) {}
    revokeImageUrl(s.backgroundId);
  }
  return id;
}

async function clearStandbyBackground() {
  const s = await getStandby();
  await mutateStandby((doc) => { doc.backgroundId = null; });
  if (s.backgroundId) {
    try { await deleteFile(s.backgroundId); } catch (_) {}
    revokeImageUrl(s.backgroundId);
  }
}

// ---------- 记忆（IndexedDB） ----------
// 每条记忆用稳定 id 存，分类 + 一句话事实；以后加向量检索可按 id/text 扩展。
async function getMemory() {
  const doc = await getDoc(DOC_MEMORY);
  return {
    entries: (doc && Array.isArray(doc.entries)) ? doc.entries : [],
    lastSummarizedCount: (doc && typeof doc.lastSummarizedCount === 'number') ? doc.lastSummarizedCount : 0,
  };
}

function mutateMemory(mutator) {
  return mutateDoc(DOC_MEMORY, (doc) => {
    if (!Array.isArray(doc.entries)) doc.entries = [];
    if (typeof doc.lastSummarizedCount !== 'number') doc.lastSummarizedCount = 0;
    mutator(doc);
  });
}

async function addMemoryEntry({ category, text }) {
  const entry = { id: genId(), category: category || 'personal', text: (text || '').trim(), createdAt: Date.now(), updatedAt: Date.now() };
  if (!entry.text) return entry;
  await mutateMemory((doc) => doc.entries.push(entry));
  return entry;
}

async function updateMemoryEntry(id, { category, text }) {
  await mutateMemory((doc) => {
    const e = doc.entries.find((x) => x.id === id);
    if (!e) return;
    if (category) e.category = category;
    if (text !== undefined) e.text = (text || '').trim();
    e.updatedAt = Date.now();
  });
}

async function deleteMemoryEntry(id) {
  await mutateMemory((doc) => {
    doc.entries = doc.entries.filter((x) => x.id !== id);
  });
}

async function setLastSummarizedCount(n) {
  await mutateMemory((doc) => { doc.lastSummarizedCount = n; });
}

// 合并新总结：同类别且文字一致的去重，其余追加
async function mergeMemoryEntries(newEntries) {
  await mutateMemory((doc) => {
    (newEntries || []).forEach((n) => {
      const text = (n && n.text) ? String(n.text).trim() : '';
      if (!text) return;
      const category = (n && n.category) || 'personal';
      const dup = doc.entries.some((e) => e.category === category && e.text.trim() === text);
      if (!dup) doc.entries.push({ id: genId(), category, text, createdAt: Date.now(), updatedAt: Date.now() });
    });
  });
}

// 把记忆条目格式化成发给 AI 的文本
function formatMemory(entries) {
  if (!Array.isArray(entries) || !entries.length) return '';
  return entries.map((e) => '[' + (MEMORY_CATEGORY_LABELS[e.category] || e.category) + '] ' + e.text).join('\n');
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
  const cfSettings = getCfSettings();
  const charsDoc = await loadCharacters();
  const standby = await getStandby();
  const memDoc = (await getDoc(DOC_MEMORY)) || {};

  const characters = charsDoc.list.map((c) => ({ ...c }));
  const imageIds = new Set();
  characters.forEach((c) => [c.avatarId, c.idleImageId, c.speakImageId].forEach((id) => { if (id) imageIds.add(id); }));
  if (standby.backgroundId) imageIds.add(standby.backgroundId);

  const files = {};
  for (const id of imageIds) {
    const f = await getFile(id);
    if (f && f.blob) {
      files[id] = { name: f.name || 'image', type: f.type || 'image/jpeg', data: await blobToDataUrl(f.blob) };
    }
  }

  const chats = {};
  for (const c of characters) {
    const d = await getDoc(DOC_CHAT_PREFIX + c.id);
    chats[c.id] = (d && Array.isArray(d.messages)) ? d.messages : [];
  }

  return {
    app: 'clearcall',
    version: 2,
    exportedAt: new Date().toISOString(),
    settings,
    trigger,
    memorySettings,
    cfSettings,
    characters: { activeId: charsDoc.activeId, list: characters },
    chats,
    standby,
    memory: {
      entries: Array.isArray(memDoc.entries) ? memDoc.entries : [],
      lastSummarizedCount: memDoc.lastSummarizedCount || 0,
    },
    files,
  };
}

async function applyBackup(data) {
  if (!data || data.app !== 'clearcall') throw new Error('这不是本应用的备份文件');

  setSettings(data.settings || {});
  setTriggerModes(data.trigger || {});
  setMemorySettings(data.memorySettings || {});
  setCfSettings(data.cfSettings || {});

  // 图片：先清空旧文件，再写入备份里的（Blob），避免残留孤儿文件
  await clearFiles();
  const files = data.files || {};
  for (const id of Object.keys(files)) {
    const f = files[id] || {};
    const blob = dataUrlToBlob(f.data);
    if (blob) await putFile({ id, name: f.name || 'image', type: f.type || blob.type, blob });
  }

  if (data.version >= 2 && data.characters && Array.isArray(data.characters.list) && data.characters.list.length) {
    const list = data.characters.list.map(normalizeChar);
    let activeId = data.characters.activeId;
    if (!list.some((c) => c.id === activeId)) activeId = list[0].id;
    _charsCache = null;
    await putDoc({ id: DOC_CHARACTERS, activeId, list });
    for (const c of list) {
      const msgs = (data.chats && data.chats[c.id]) || [];
      await putDoc({ id: DOC_CHAT_PREFIX + c.id, messages: Array.isArray(msgs) ? msgs : [] });
    }
    const sb = data.standby || {};
    await putDoc({
      id: DOC_STANDBY,
      backgroundId: sb.backgroundId || null,
      linesByChar: (sb.linesByChar && typeof sb.linesByChar === 'object') ? sb.linesByChar : {},
    });
  } else {
    // 兼容旧版 v1 备份：单角色 + 单份聊天记录
    const c = data.character || {};
    const id = genId();
    _charsCache = null;
    await putDoc({ id: DOC_CHARACTERS, activeId: id, list: [normalizeChar({ id, name: c.name, persona: c.persona, avatarId: c.avatarId })] });
    await putDoc({ id: DOC_CHAT_PREFIX + id, messages: Array.isArray(data.chatHistory) ? data.chatHistory : [] });
    await putDoc({ id: DOC_STANDBY, backgroundId: null, linesByChar: {} });
  }

  const mem = data.memory || {};
  await putDoc({ id: DOC_MEMORY, entries: Array.isArray(mem.entries) ? mem.entries : [], lastSummarizedCount: mem.lastSummarizedCount || 0 });

  _charsCache = null;
  revokeAllImageUrls();
}

// ---------- 旧数据迁移 ----------
async function migrate() {
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
