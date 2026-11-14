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

// ---------- IndexedDB 基础 ----------
const DB_NAME = 'clearcall';
const DB_VERSION = 1;
const STORE_DOCS = 'documents';   // 各类结构化文档：角色、聊天记录、未来记忆/各 App 存档
const STORE_FILES = 'files';      // 图片等二进制 Blob，用稳定 id 引用
const DOC_CHARACTER = 'character';
const DOC_CHAT = 'chatHistory';
const DOC_MEMORY = 'memory';
const DOC_WORLDBOOK = 'worldbook';

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

function updateCharacter(patch) {
  return mutateDoc(DOC_CHARACTER, (doc) => {
    if (doc.name === undefined) doc.name = '';
    if (doc.persona === undefined) doc.persona = '';
    if (doc.avatarId === undefined) doc.avatarId = null;
    Object.assign(doc, patch);
  });
}

// ---------- 角色（IndexedDB） ----------
// 头像图片以 Blob 存在 files，角色文档只存 avatarId 引用；显示时再转对象 URL。
let _avatarCache = { id: null, url: '' };

function revokeAvatarCache() {
  if (_avatarCache.url) { URL.revokeObjectURL(_avatarCache.url); _avatarCache.url = ''; }
  _avatarCache.id = null;
}

async function getAvatarUrl() {
  const doc = await getDoc(DOC_CHARACTER);
  const id = (doc && doc.avatarId) || null;
  if (!id) { revokeAvatarCache(); return ''; }
  if (_avatarCache.id === id && _avatarCache.url) return _avatarCache.url;
  const f = await getFile(id);
  if (!f || !f.blob) { revokeAvatarCache(); return ''; }
  revokeAvatarCache();
  _avatarCache.id = id;
  _avatarCache.url = URL.createObjectURL(f.blob);
  return _avatarCache.url;
}

async function getChar() {
  const doc = await getDoc(DOC_CHARACTER);
  return {
    name: (doc && doc.name) || '',
    persona: (doc && doc.persona) || '',
    avatar: await getAvatarUrl(),
  };
}

async function setChar(patch) {
  await updateCharacter(patch || {});
}

async function setCharAvatarBlob(blob, type, name) {
  const id = genId();
  await putFile({ id, name: name || 'avatar', type: type || (blob && blob.type) || 'image/jpeg', blob });
  const old = await getDoc(DOC_CHARACTER);
  const oldId = old && old.avatarId;
  await updateCharacter({ avatarId: id });
  if (oldId) { try { await deleteFile(oldId); } catch (_) {} }
  revokeAvatarCache();
  return id;
}

async function clearCharAvatar() {
  const old = await getDoc(DOC_CHARACTER);
  const oldId = old && old.avatarId;
  await updateCharacter({ avatarId: null });
  if (oldId) { try { await deleteFile(oldId); } catch (_) {} }
  revokeAvatarCache();
}

// ---------- 聊天记录（IndexedDB） ----------
async function getHistory() {
  const doc = await getDoc(DOC_CHAT);
  const arr = doc && doc.messages;
  return Array.isArray(arr) ? arr : [];
}

// 原子地修改聊天记录，避免并发写入丢消息
function mutateHistory(mutator) {
  return mutateDoc(DOC_CHAT, (doc) => {
    if (!Array.isArray(doc.messages)) doc.messages = [];
    mutator(doc.messages);
  });
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
  return {
    id: (raw && raw.id) || genId(),
    scope: scope === 'character' ? 'character' : 'global',
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
    Object.assign(e, n, { updatedAt: Date.now() });
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
  const charDoc = (await getDoc(DOC_CHARACTER)) || {};
  const chatDoc = (await getDoc(DOC_CHAT)) || {};
  const memDoc = (await getDoc(DOC_MEMORY)) || {};
  const wbDoc = (await getDoc(DOC_WORLDBOOK)) || {};
  const files = {};
  const avatarId = charDoc.avatarId || null;
  if (avatarId) {
    const f = await getFile(avatarId);
    if (f && f.blob) {
      files[avatarId] = { name: f.name || 'avatar', type: f.type || 'image/jpeg', data: await blobToDataUrl(f.blob) };
    }
  }
  return {
    app: 'clearcall',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    trigger,
    memorySettings,
    character: { name: charDoc.name || '', persona: charDoc.persona || '', avatarId },
    chatHistory: Array.isArray(chatDoc.messages) ? chatDoc.messages : [],
    memory: {
      entries: Array.isArray(memDoc.entries) ? memDoc.entries : [],
      lastSummarizedCount: memDoc.lastSummarizedCount || 0,
    },
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

  // 图片：先清空旧文件，再写入备份里的（Blob），避免残留孤儿文件
  await clearFiles();
  const files = data.files || {};
  for (const id of Object.keys(files)) {
    const f = files[id] || {};
    const blob = dataUrlToBlob(f.data);
    if (blob) await putFile({ id, name: f.name || 'image', type: f.type || blob.type, blob });
  }

  const c = data.character || {};
  await putDoc({ id: DOC_CHARACTER, name: c.name || '', persona: c.persona || '', avatarId: c.avatarId || null });
  await putDoc({ id: DOC_CHAT, messages: Array.isArray(data.chatHistory) ? data.chatHistory : [] });

  const mem = data.memory || {};
  await putDoc({ id: DOC_MEMORY, entries: Array.isArray(mem.entries) ? mem.entries : [], lastSummarizedCount: mem.lastSummarizedCount || 0 });

  const wb = data.worldbook || {};
  const wbEntries = (Array.isArray(wb.entries) ? wb.entries : [])
    .map((x) => buildWorldbookRecord(x, x && x.scope))
    .filter(Boolean);
  await putDoc({ id: DOC_WORLDBOOK, entries: wbEntries });

  revokeAvatarCache();
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
