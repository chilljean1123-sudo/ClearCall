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

// 聊天显示偏好：角色多条回复是否一条一条上屏
const CHAT_PREF_KEYS = {
  sequential: 'clearcall.chat.sequential',
};

function getChatPreferences() {
  return {
    sequential: localStorage.getItem(CHAT_PREF_KEYS.sequential) !== '0',
  };
}

function setChatPreferences(p) {
  localStorage.setItem(CHAT_PREF_KEYS.sequential, (p && p.sequential) ? '1' : '0');
}

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

// 向量记忆（Embedding 接口，用于语义检索）
const EMBEDDING_KEYS = {
  baseUrl: 'clearcall.embeddingBaseUrl',
  apiKey: 'clearcall.embeddingApiKey',
  model: 'clearcall.embeddingModel',
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
  prompt: 'clearcall.imagePrompt',
  negativePrompt: 'clearcall.imageNegativePrompt',
};

// 主动消息推送（云推送 Worker）配置
const CF_KEYS = {
  token: 'clearcall.cfToken',
  accountId: 'clearcall.cfAccountId',
  workerUrl: 'clearcall.cfWorkerUrl',
  workerName: 'clearcall.cfWorkerName',
  intervalMin: 'clearcall.autopushIntervalMin',
  prompt: 'clearcall.autopushPrompt',
  enabled: 'clearcall.autopushEnabled',
  clientId: 'clearcall.autopushClientId',
  lastAt: 'clearcall.autopushLastAt',
};

// 云端备份（GitHub 仓库）配置，只存轻量字段，token 不写进备份文件
const GITHUB_BACKUP_KEYS = {
  token: 'clearcall.githubBackupToken',
  repo: 'clearcall.githubBackupRepo',
  branch: 'clearcall.githubBackupBranch',
  path: 'clearcall.githubBackupPath',
};

function getGithubBackupSettings() {
  return {
    token: localStorage.getItem(GITHUB_BACKUP_KEYS.token) || '',
    repo: localStorage.getItem(GITHUB_BACKUP_KEYS.repo) || '',
    branch: localStorage.getItem(GITHUB_BACKUP_KEYS.branch) || 'main',
    path: localStorage.getItem(GITHUB_BACKUP_KEYS.path) || 'clearcall-backup.json',
  };
}

function setGithubBackupSettings(s) {
  localStorage.setItem(GITHUB_BACKUP_KEYS.token, (s && s.token) || '');
  localStorage.setItem(GITHUB_BACKUP_KEYS.repo, (s && s.repo) || '');
  localStorage.setItem(GITHUB_BACKUP_KEYS.branch, (s && s.branch) || 'main');
  localStorage.setItem(GITHUB_BACKUP_KEYS.path, (s && s.path) || 'clearcall-backup.json');
}

// 工具 API：翻译 / 论坛 / 购物 / 外卖 / 捏捏可各用一套接口，留空即借用聊天接口
const TOOL_API_OPTIONS = [
  { id: 'translate', label: '翻译' },
  { id: 'forum', label: '论坛' },
  { id: 'shop', label: '购物' },
  { id: 'food', label: '外卖' },
  { id: 'pinie', label: '捏捏' },
];

function toolApiKeys(tool) {
  const prefix = 'clearcall.tool.' + tool + '.';
  return { baseUrl: prefix + 'baseUrl', apiKey: prefix + 'apiKey', model: prefix + 'model' };
}

function getToolApiSettings(tool) {
  const keys = toolApiKeys(tool);
  return {
    baseUrl: localStorage.getItem(keys.baseUrl) || '',
    apiKey: localStorage.getItem(keys.apiKey) || '',
    model: localStorage.getItem(keys.model) || '',
  };
}

function setToolApiSettings(tool, s) {
  const keys = toolApiKeys(tool);
  localStorage.setItem(keys.baseUrl, String((s && s.baseUrl) || '').trim());
  localStorage.setItem(keys.apiKey, String((s && s.apiKey) || '').trim());
  localStorage.setItem(keys.model, String((s && s.model) || '').trim());
}

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

// ---------- 多套 AI 接口配置（localStorage） ----------
const API_PROFILE_KEY = 'clearcall.apiProfiles';
const API_ACTIVE_KEY = 'clearcall.apiProfileActive';

function getApiProfiles() {
  try {
    const raw = JSON.parse(localStorage.getItem(API_PROFILE_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map((p) => ({
      id: String((p && p.id) || ''),
      name: String((p && p.name) || '').trim(),
      baseUrl: String((p && p.baseUrl) || ''),
      apiKey: String((p && p.apiKey) || ''),
      model: String((p && p.model) || ''),
      modelMode: (p && p.modelMode) === 'manual' ? 'manual' : 'select',
    })).filter((p) => p.id && p.name);
  } catch (_) {
    return [];
  }
}

function setApiProfiles(list) {
  localStorage.setItem(API_PROFILE_KEY, JSON.stringify(Array.isArray(list) ? list : []));
}

function getActiveApiProfileId() {
  return localStorage.getItem(API_ACTIVE_KEY) || '';
}

function setActiveApiProfileId(id) {
  localStorage.setItem(API_ACTIVE_KEY, id || '');
}

// ---------- 网易云音乐（用户自建 API 地址 + 登录 cookie） ----------
const MUSIC_KEYS = {
  apiBase: 'clearcall.musicApiBase',
  cookie: 'clearcall.musicNeteaseCookie',
  nickname: 'clearcall.musicNeteaseName',
};

function getMusicApiBase() {
  return localStorage.getItem(MUSIC_KEYS.apiBase) || '';
}

function setMusicApiBase(url) {
  localStorage.setItem(MUSIC_KEYS.apiBase, String(url || '').trim().replace(/\/+$/, ''));
}

function getNeteaseCookie() {
  return localStorage.getItem(MUSIC_KEYS.cookie) || '';
}

function setNeteaseCookie(cookie, nickname) {
  localStorage.setItem(MUSIC_KEYS.cookie, String(cookie || ''));
  if (nickname !== undefined) localStorage.setItem(MUSIC_KEYS.nickname, String(nickname || ''));
}

function getNeteaseNickname() {
  return localStorage.getItem(MUSIC_KEYS.nickname) || '';
}

// ---------- 主动消息推送设置（localStorage） ----------
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

function getAutopushSettings() {
  return {
    intervalMin: Math.max(0, parseInt(localStorage.getItem(CF_KEYS.intervalMin) || '0', 10) || 0),
    prompt: localStorage.getItem(CF_KEYS.prompt) || '',
    enabled: localStorage.getItem(CF_KEYS.enabled) === '1',
  };
}

function setAutopushSettings(s) {
  localStorage.setItem(CF_KEYS.intervalMin, String(Math.max(0, (s && s.intervalMin) || 0)));
  localStorage.setItem(CF_KEYS.prompt, (s && s.prompt) || '');
  localStorage.setItem(CF_KEYS.enabled, (s && s.enabled) ? '1' : '0');
}

// 每个浏览器一个稳定 clientId，Worker 用它区分推送对象
function getAutopushClientId() {
  let id = localStorage.getItem(CF_KEYS.clientId);
  if (!id) {
    id = 'cc-' + (genId ? genId() : Date.now().toString(36));
    localStorage.setItem(CF_KEYS.clientId, id);
  }
  return id;
}

// 上次收到主动消息的时间（由前端保存，Worker 保持无状态）
function getAutopushLastAt() {
  return parseInt(localStorage.getItem(CF_KEYS.lastAt) || '0', 10) || 0;
}

function setAutopushLastAt(ts) {
  localStorage.setItem(CF_KEYS.lastAt, String(ts || Date.now()));
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

// ---------- 向量记忆设置（localStorage） ----------
function getEmbeddingSettings() {
  return {
    baseUrl: localStorage.getItem(EMBEDDING_KEYS.baseUrl) || '',
    apiKey: localStorage.getItem(EMBEDDING_KEYS.apiKey) || '',
    model: localStorage.getItem(EMBEDDING_KEYS.model) || '',
  };
}

function setEmbeddingSettings(s) {
  localStorage.setItem(EMBEDDING_KEYS.baseUrl, (s && s.baseUrl) || '');
  localStorage.setItem(EMBEDDING_KEYS.apiKey, (s && s.apiKey) || '');
  localStorage.setItem(EMBEDDING_KEYS.model, (s && s.model) || '');
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
    prompt: localStorage.getItem(IMAGE_KEYS.prompt) || '',
    negativePrompt: localStorage.getItem(IMAGE_KEYS.negativePrompt) || '',
  };
}

function setImageSettings(s) {
  localStorage.setItem(IMAGE_KEYS.baseUrl, (s && s.baseUrl) || '');
  localStorage.setItem(IMAGE_KEYS.apiKey, (s && s.apiKey) || '');
  localStorage.setItem(IMAGE_KEYS.model, (s && s.model) || '');
  localStorage.setItem(IMAGE_KEYS.size, (s && s.size) || '');
  localStorage.setItem(IMAGE_KEYS.prompt, (s && s.prompt) || '');
  localStorage.setItem(IMAGE_KEYS.negativePrompt, (s && s.negativePrompt) || '');
}

// ---------- IndexedDB 基础 ----------
const DB_NAME = 'clearcall';
const DB_VERSION = 1;
const STORE_DOCS = 'documents';   // 各类结构化文档：角色、聊天记录、未来记忆/各 App 存档
const STORE_FILES = 'files';      // 图片等二进制 Blob，用稳定 id 引用
const DOC_CHARACTERS = 'characters';   // 角色列表：{ list: [...], activeId }
const DOC_USER_PROFILES = 'userProfiles'; // 「我」的用户人设，可保存多套：{ list: [...], activeId }
const DOC_CHARACTER = 'character';     // 旧版单角色文档（仅用于迁移 / 兼容旧备份）
const DOC_CHAT = 'chatHistory';        // 旧版聊天文档（迁移用；新数据按角色分仓）
const DOC_MEMORY = 'memory';           // 旧版记忆文档（迁移用；新数据按角色分仓）
const DOC_WORLDBOOK = 'worldbook';
const DOC_STICKERS = 'stickers';       // 表情包按角色分仓：stickers:<角色id>
const DOC_APPEARANCE = 'appearance';   // 美化：主屏壁纸 / 各应用图标 / 状态栏开关
const DOC_NOTIFICATION = 'notification'; // 通知：开关 / 自定义提示音 / 后台保活
const DOC_FORUM = 'forum';             // 论坛：绑定设置 / 主题 / 帖子 / 用户主页
const DOC_ALBUM = 'album';             // 相册：聊天与动态里的照片副本
const DOC_MOMENTS = 'moments';         // 动态（朋友圈）：绑定角色 / 动态 / 点赞 / 评论
const DOC_EMAIL = 'email';             // 邮箱：角色来信 / 已发送 / 定时任务
const DOC_BOOKS = 'books';             // 小说书架：书目列表 / 当前书 / 阅读进度
const DOC_BOOK_PREFIX = 'book:';       // 单本书内容：章节正文 / 批注
const DOC_BOOK_CHAT_PREFIX = 'bookChat:'; // 单本书的阅读讨论，按角色分仓
const DOC_DIARY_PREFIX = 'diary:';     // 角色日记：按角色分仓
const DEFAULT_DIARY_TIME = '22:00';    // 默认每天写日记的时间
const DOC_SCHEDULE_PREFIX = 'schedule:'; // 角色日程：按角色分仓
const DEFAULT_SCHEDULE_TIME = '07:00';   // 默认每天刷新日程的时间
const DOC_GROUPS = 'groups';             // 群聊：群列表与成员
const DOC_GROUP_CHAT_PREFIX = 'groupChat:'; // 群聊记录：按群分仓
const DOC_SHOP = 'shop';               // 商城：按角色分仓的购物车 + 订单记录
const DOC_FOOD = 'food';               // 外卖：按角色分仓的购物车 + 订单记录
const DOC_MUSIC = 'music';             // 音乐：本地歌曲 + 网易云导入曲目
const DOC_PERCEPTION = 'perception';   // 感知：真实时间 / 地点 / 天气
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

// ---------- 余叔叔：常驻手机助手 ----------
const UNCLE_DOC_ID = 'uncle';

async function getUncleMessages() {
  const doc = await getDoc(UNCLE_DOC_ID);
  return doc && Array.isArray(doc.messages) ? doc.messages : [];
}

async function saveUncleMessages(messages) {
  await putDoc({
    id: UNCLE_DOC_ID,
    messages: (Array.isArray(messages) ? messages : []).slice(-200),
    updatedAt: Date.now(),
  });
}

async function clearUncleMessages() {
  await deleteDoc(UNCLE_DOC_ID);
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

// ---------- 相册：把聊天/动态里的照片另存一份，原处删了也不丢 ----------
async function getAlbumPhotos() {
  const doc = await getDoc(DOC_ALBUM);
  const items = doc && Array.isArray(doc.items) ? doc.items : [];
  return items.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// 复制一份 Blob 进相册，源文件被删也不影响；同一张原图只归档一次
async function archivePhoto(fileId, meta) {
  if (!fileId) return null;
  const sourceFileId = (meta && meta.sourceFileId) || fileId;
  const doc = await getDoc(DOC_ALBUM);
  const existing = doc && Array.isArray(doc.items) ? doc.items : [];
  if (existing.some((x) => x && x.sourceFileId === sourceFileId)) return null;
  const file = await getFile(fileId);
  if (!file || !file.blob) return null;
  const copyId = genId();
  await putFile({
    id: copyId,
    name: 'album-' + copyId,
    type: file.type || file.blob.type || 'image/jpeg',
    blob: file.blob,
  });
  const item = {
    id: genId(),
    fileId: copyId,
    sourceFileId,
    source: (meta && meta.source) || 'chat',
    characterId: (meta && meta.characterId) || '',
    caption: String((meta && meta.caption) || '').slice(0, 200),
    createdAt: Date.now(),
  };
  await mutateDoc(DOC_ALBUM, (doc) => {
    if (!Array.isArray(doc.items)) doc.items = [];
    if (doc.items.some((x) => x && x.sourceFileId === sourceFileId)) return;
    doc.items.unshift(item);
  });
  return item;
}

async function deleteAlbumPhoto(id) {
  let removed = null;
  await mutateDoc(DOC_ALBUM, (doc) => {
    if (!Array.isArray(doc.items)) doc.items = [];
    const i = doc.items.findIndex((x) => x.id === id);
    if (i >= 0) removed = doc.items.splice(i, 1)[0];
  });
  if (removed && removed.fileId) {
    revokeFileUrl(removed.fileId);
    try { await deleteFile(removed.fileId); } catch (_) {}
  }
  return removed;
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
const HOME_WIDGET_KEYS = ['small1', 'small2', 'large'];

function normalizeIconIds(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  Object.keys(src).forEach((app) => {
    const id = src[app];
    if (id) out[app] = id;
  });
  return out;
}

function normalizeWidgetIds(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  HOME_WIDGET_KEYS.forEach((key) => {
    if (src[key]) out[key] = src[key];
  });
  return out;
}

// 桌面顺序：应用与小组件混排；页面按容量自动分页
function normalizeHomeItems(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  raw.forEach((item) => {
    const src = item || {};
    if (src.type === 'app' && src.app) {
      const key = 'app:' + src.app;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ type: 'app', app: String(src.app) });
    } else if (src.type === 'widget' && HOME_WIDGET_KEYS.indexOf(src.widget) >= 0) {
      const key = 'widget:' + src.widget;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ type: 'widget', widget: src.widget });
    }
  });
  return out;
}

function normalizeWallpaperFit(value) {
  return value === 'contain' || value === 'auto' ? value : 'cover';
}

function normalizeAppearance(doc) {
  const d = doc || {};
  const color = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : '');
  return {
    wallpaperId: d.wallpaperId || null,
    wallpaperFit: normalizeWallpaperFit(d.wallpaperFit),
    icons: normalizeIconIds(d.icons),
    widgets: normalizeWidgetIds(d.widgets),
    homeItems: normalizeHomeItems(d.homeItems),
    statusBar: d.statusBar !== false,
    bubbleColor: color(d.bubbleColor),
    fontColor: color(d.fontColor),
    fontFamily: String(d.fontFamily || '').trim().slice(0, 160),
    fontFileId: d.fontFileId || null,
    fontFileName: String(d.fontFileName || '').trim().slice(0, 120),
    chatCss: String(d.chatCss || '').slice(0, 20000),
    chatBgColor: color(d.chatBgColor),
    chatBgImageId: d.chatBgImageId || null,
  };
}

async function getAppearance() {
  return normalizeAppearance(await getDoc(DOC_APPEARANCE));
}

function setAppearance(patch) {
  return mutateDoc(DOC_APPEARANCE, (doc) => {
    const next = Object.assign(normalizeAppearance(doc), patch || {});
    doc.wallpaperId = next.wallpaperId || null;
    doc.wallpaperFit = normalizeWallpaperFit(next.wallpaperFit);
    doc.icons = normalizeIconIds(next.icons);
    doc.widgets = normalizeWidgetIds(next.widgets);
    doc.homeItems = normalizeHomeItems(next.homeItems);
    doc.statusBar = next.statusBar !== false;
    doc.bubbleColor = next.bubbleColor || '';
    doc.fontColor = next.fontColor || '';
    doc.fontFamily = next.fontFamily || '';
    doc.fontFileId = next.fontFileId || null;
    doc.fontFileName = next.fontFileName || '';
    doc.chatCss = String(next.chatCss || '').slice(0, 20000);
    doc.chatBgColor = next.chatBgColor || '';
    doc.chatBgImageId = next.chatBgImageId || null;
  });
}

// 本机字体文件：存 files，外观文档只留引用
async function setAppearanceFontBlob(blob, type, name) {
  const cfg = await getAppearance();
  const oldId = cfg.fontFileId;
  const id = genId();
  await putFile({
    id,
    name: name || 'chat-font',
    type: type || (blob && blob.type) || 'font/ttf',
    blob,
  });
  await setAppearance({ fontFileId: id, fontFileName: name || '自定义字体' });
  if (oldId) {
    revokeFileUrl(oldId);
    try { await deleteFile(oldId); } catch (_) {}
  }
  return id;
}

async function clearAppearanceFont() {
  const cfg = await getAppearance();
  if (cfg.fontFileId) {
    revokeFileUrl(cfg.fontFileId);
    try { await deleteFile(cfg.fontFileId); } catch (_) {}
  }
  await setAppearance({ fontFileId: null, fontFileName: '' });
}

// 聊天背景图：图片存 files，appearance 只留引用；换图或清除时清理旧 Blob
async function setAppearanceChatBgBlob(blob, type, name) {
  const cfg = await getAppearance();
  const oldId = cfg.chatBgImageId;
  const id = genId();
  await putFile({
    id,
    name: name || 'chat-bg',
    type: type || (blob && blob.type) || 'image/jpeg',
    blob,
  });
  await setAppearance({ chatBgImageId: id });
  if (oldId) {
    revokeFileUrl(oldId);
    try { await deleteFile(oldId); } catch (_) {}
  }
  return id;
}

async function clearAppearanceChatBgImage() {
  const cfg = await getAppearance();
  const oldId = cfg.chatBgImageId;
  await setAppearance({ chatBgImageId: null });
  if (oldId) {
    revokeFileUrl(oldId);
    try { await deleteFile(oldId); } catch (_) {}
  }
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

// 桌面小组件：图片存 files，widgets 只留引用；换图或移除时清理旧 Blob
async function setAppearanceWidgetBlob(key, blob, type, name) {
  if (HOME_WIDGET_KEYS.indexOf(key) < 0) throw new Error('未知的小组件');
  const cfg = await getAppearance();
  const oldId = cfg.widgets[key];
  const id = genId();
  await putFile({ id, name: name || ('widget-' + key), type: type || (blob && blob.type) || 'image/jpeg', blob });
  const widgets = Object.assign({}, cfg.widgets);
  widgets[key] = id;
  await setAppearance({ widgets });
  if (oldId) {
    try { await deleteFile(oldId); } catch (_) {}
    revokeFileUrl(oldId);
  }
  return id;
}

async function clearAppearanceWidgetImage(key) {
  if (HOME_WIDGET_KEYS.indexOf(key) < 0) return;
  const cfg = await getAppearance();
  const oldId = cfg.widgets[key];
  if (!oldId) return;
  const widgets = Object.assign({}, cfg.widgets);
  delete widgets[key];
  await setAppearance({ widgets });
  try { await deleteFile(oldId); } catch (_) {}
  revokeFileUrl(oldId);
}

// 从桌面移除小组件，同时清掉图片
async function removeHomeWidget(key) {
  if (HOME_WIDGET_KEYS.indexOf(key) < 0) return;
  const cfg = await getAppearance();
  const oldId = cfg.widgets[key];
  const homeItems = cfg.homeItems.filter((it) => !(it.type === 'widget' && it.widget === key));
  const widgets = Object.assign({}, cfg.widgets);
  delete widgets[key];
  await setAppearance({ homeItems, widgets });
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
  const wx = d.wxpusher || {};
  return {
    enabled: !!d.enabled,
    keepAlive: !!d.keepAlive,
    soundId: d.soundId || null,
    soundName: d.soundName || '',
    soundType: d.soundType || '',
    mode: d.mode === 'wxpusher' ? 'wxpusher' : 'native',
    wxpusher: {
      spt: typeof wx.spt === 'string' ? wx.spt : '',
    },
  };
}

async function getNotificationConfig() {
  return normalizeNotification(await getDoc(DOC_NOTIFICATION));
}

function setNotificationConfig(patch) {
  return mutateDoc(DOC_NOTIFICATION, (doc) => {
    const next = Object.assign(normalizeNotification(doc), patch || {});
    if (patch && patch.wxpusher) {
      next.wxpusher = Object.assign({}, normalizeNotification(doc).wxpusher, patch.wxpusher);
    }
    doc.enabled = !!next.enabled;
    doc.keepAlive = !!next.keepAlive;
    doc.soundId = next.soundId || null;
    doc.soundName = next.soundName || '';
    doc.soundType = next.soundType || '';
    doc.mode = next.mode === 'wxpusher' ? 'wxpusher' : 'native';
    doc.wxpusher = { spt: next.wxpusher && next.wxpusher.spt ? String(next.wxpusher.spt) : '' };
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

// ---------- 论坛（IndexedDB） ----------
// 论坛是独立应用：绑定世界书 / 角色、独立 API、板块主题、路人提示词、帖子与用户主页。
const DEFAULT_FORUM_THEME = {
  title: '闲聊广场',
  subtitle: '今天的瓜，比昨天甜一点',
  npcPrompt: '你是一群爱逛中文论坛的普通网友，说话口语化、有网感，会玩梗但不低俗。',
};
const DEFAULT_FORUM_BOARD_ID = 'board-main';
const DEFAULT_FORUM_PROFILE = {
  name: '我',
  signature: '这个人很懒，什么都没有写。',
  avatarId: null,
  coverId: null,
};

function normalizeForumTheme(raw) {
  const d = raw || {};
  return {
    title: String(d.title || DEFAULT_FORUM_THEME.title).trim() || DEFAULT_FORUM_THEME.title,
    subtitle: String(d.subtitle !== undefined ? d.subtitle : DEFAULT_FORUM_THEME.subtitle).trim(),
    npcPrompt: String(d.npcPrompt || DEFAULT_FORUM_THEME.npcPrompt).trim() || DEFAULT_FORUM_THEME.npcPrompt,
  };
}

function normalizeForumBoard(raw) {
  const d = raw || {};
  const theme = normalizeForumTheme(d);
  return {
    id: d.id || genId(),
    title: theme.title,
    subtitle: theme.subtitle,
    npcPrompt: theme.npcPrompt,
  };
}

function normalizeForumSettings(raw) {
  const d = raw || {};
  const count = parseInt(d.refreshCount, 10);
  return {
    baseUrl: String(d.baseUrl || ''),
    apiKey: String(d.apiKey || ''),
    model: String(d.model || ''),
    worldbookIds: Array.isArray(d.worldbookIds) ? d.worldbookIds.map(String) : [],
    characterIds: Array.isArray(d.characterIds) ? d.characterIds.map(String) : [],
    refreshCount: Number.isFinite(count) ? Math.max(1, Math.min(10, count)) : 3,
  };
}

function normalizeForumComment(raw) {
  if (!raw) return null;
  const content = String(raw.content || '').trim();
  if (!content) return null;
  return {
    id: raw.id || genId(),
    name: String(raw.name || '路人').trim() || '路人',
    content,
    createdAt: raw.createdAt || Date.now(),
  };
}

function normalizeForumPost(raw, fallbackBoardId) {
  if (!raw) return null;
  const content = String(raw.content || '').trim();
  if (!content) return null;
  const type = raw.authorType === 'character' || raw.authorType === 'user' ? raw.authorType : 'npc';
  return {
    id: raw.id || genId(),
    boardId: String(raw.boardId || fallbackBoardId || ''),
    authorType: type,
    authorId: raw.authorId || null,
    authorName: String(raw.authorName || (type === 'user' ? '我' : '路人')).trim() || '路人',
    title: String(raw.title || '').trim(),
    content,
    createdAt: raw.createdAt || Date.now(),
    likes: Math.max(0, parseInt(raw.likes, 10) || 0),
    comments: (Array.isArray(raw.comments) ? raw.comments : []).map(normalizeForumComment).filter(Boolean),
  };
}

function normalizeForumProfile(raw) {
  const d = raw || {};
  return {
    name: String(d.name || DEFAULT_FORUM_PROFILE.name).trim() || DEFAULT_FORUM_PROFILE.name,
    signature: String(d.signature !== undefined ? d.signature : DEFAULT_FORUM_PROFILE.signature),
    avatarId: d.avatarId || null,
    coverId: d.coverId || null,
  };
}

function normalizeForum(doc) {
  const d = doc || {};
  let boards = Array.isArray(d.boards) ? d.boards.map(normalizeForumBoard).filter(Boolean) : [];
  if (!boards.length) boards = [normalizeForumBoard(Object.assign({ id: DEFAULT_FORUM_BOARD_ID }, d.theme || DEFAULT_FORUM_THEME))];
  const boardIds = new Set(boards.map((b) => b.id));
  const activeBoardId = boardIds.has(d.activeBoardId) ? d.activeBoardId : boards[0].id;
  const posts = (Array.isArray(d.posts) ? d.posts : [])
    .map((p) => normalizeForumPost(p, boards[0].id))
    .filter(Boolean)
    .map((p) => {
      if (!boardIds.has(p.boardId)) p.boardId = boards[0].id;
      return p;
    });
  return {
    settings: normalizeForumSettings(d.settings),
    boards,
    activeBoardId,
    profile: normalizeForumProfile(d.profile),
    posts,
  };
}

async function getForum() {
  return normalizeForum(await getDoc(DOC_FORUM));
}

// 兼容旧数据：把单份 theme 迁移成 boards，并给旧帖子补上 boardId
function ensureForumBoards(doc) {
  let boards = Array.isArray(doc.boards) ? doc.boards.map(normalizeForumBoard).filter(Boolean) : [];
  if (!boards.length) boards = [normalizeForumBoard(Object.assign({ id: DEFAULT_FORUM_BOARD_ID }, doc.theme || DEFAULT_FORUM_THEME))];
  doc.boards = boards;
  if (!boards.some((b) => b.id === doc.activeBoardId)) doc.activeBoardId = boards[0].id;
  delete doc.theme;
  if (!Array.isArray(doc.posts)) doc.posts = [];
  const boardIds = new Set(boards.map((b) => b.id));
  doc.posts = doc.posts
    .map((p) => normalizeForumPost(p, boards[0].id))
    .filter(Boolean)
    .map((p) => {
      if (!boardIds.has(p.boardId)) p.boardId = boards[0].id;
      return p;
    });
}

function mutateForum(mutator) {
  return mutateDoc(DOC_FORUM, (doc) => {
    if (!Array.isArray(doc.posts)) doc.posts = [];
    if (!doc.settings) doc.settings = normalizeForumSettings();
    ensureForumBoards(doc);
    if (!doc.profile) doc.profile = normalizeForumProfile();
    mutator(doc);
  });
}

async function updateForumSettings(patch) {
  await mutateForum((doc) => {
    doc.settings = normalizeForumSettings(Object.assign(normalizeForumSettings(doc.settings), patch || {}));
  });
}

async function updateForumTheme(patch) {
  await mutateForum((doc) => {
    const board = doc.boards.find((b) => b.id === doc.activeBoardId);
    if (board) Object.assign(board, normalizeForumTheme(Object.assign({}, board, patch || {})));
  });
}

async function setActiveForumBoard(boardId) {
  await mutateForum((doc) => {
    if (doc.boards.some((b) => b.id === boardId)) doc.activeBoardId = boardId;
  });
}

async function addForumBoard(patch) {
  let board = null;
  await mutateForum((doc) => {
    board = normalizeForumBoard(patch);
    doc.boards.push(board);
    doc.activeBoardId = board.id;
  });
  return board;
}

async function updateForumBoard(boardId, patch) {
  await mutateForum((doc) => {
    const board = doc.boards.find((b) => b.id === boardId);
    if (!board) return;
    Object.assign(board, normalizeForumTheme(Object.assign({}, board, patch || {})));
    board.id = boardId;
  });
}

async function saveForumBoards(boards) {
  await mutateForum((doc) => {
    const list = (Array.isArray(boards) ? boards : []).map(normalizeForumBoard).filter(Boolean);
    if (!list.length) return;
    doc.boards = list;
    if (!list.some((b) => b.id === doc.activeBoardId)) doc.activeBoardId = list[0].id;
    const ids = new Set(list.map((b) => b.id));
    doc.posts.forEach((p) => {
      if (!ids.has(p.boardId)) p.boardId = list[0].id;
    });
  });
}

async function deleteForumBoard(boardId) {
  await mutateForum((doc) => {
    if (doc.boards.length <= 1) return;
    doc.boards = doc.boards.filter((b) => b.id !== boardId);
    doc.posts = doc.posts.filter((p) => p.boardId !== boardId);
    if (doc.activeBoardId === boardId) doc.activeBoardId = doc.boards[0].id;
  });
}

async function updateForumProfile(patch) {
  await mutateForum((doc) => {
    doc.profile = normalizeForumProfile(Object.assign(normalizeForumProfile(doc.profile), patch || {}));
  });
}

async function addForumPosts(posts) {
  let list = [];
  await mutateForum((doc) => {
    list = (Array.isArray(posts) ? posts : [])
      .map((p) => normalizeForumPost(p, doc.activeBoardId))
      .filter(Boolean);
    doc.posts = list.concat(doc.posts);
  });
  return list;
}

async function updateForumPost(postId, patch) {
  await mutateForum((doc) => {
    const p = doc.posts.find((x) => x.id === postId);
    if (!p) return;
    if (patch && patch.title !== undefined) p.title = String(patch.title || '').trim();
    if (patch && patch.content !== undefined) p.content = String(patch.content || '').trim();
  });
}

async function deleteForumPost(postId) {
  await mutateForum((doc) => {
    doc.posts = doc.posts.filter((x) => x.id !== postId);
  });
}

async function addForumComments(postId, comments) {
  const list = (Array.isArray(comments) ? comments : []).map(normalizeForumComment).filter(Boolean);
  if (!list.length) return [];
  await mutateForum((doc) => {
    const p = doc.posts.find((x) => x.id === postId);
    if (p) p.comments = p.comments.concat(list);
  });
  return list;
}

async function setForumProfileImage(kind, blob, type, name) {
  if (!blob) throw new Error('缺少图片文件');
  const field = kind === 'cover' ? 'coverId' : 'avatarId';
  const forum = await getForum();
  const oldId = forum.profile[field];
  const id = genId();
  await putFile({ id, name: name || ('forum-' + field), type: type || blob.type || 'image/jpeg', blob });
  await updateForumProfile({ [field]: id });
  if (oldId) {
    revokeFileUrl(oldId);
    try { await deleteFile(oldId); } catch (_) {}
  }
  return id;
}

async function clearForumProfileImage(kind) {
  const field = kind === 'cover' ? 'coverId' : 'avatarId';
  const forum = await getForum();
  const oldId = forum.profile[field];
  if (!oldId) return;
  await updateForumProfile({ [field]: null });
  revokeFileUrl(oldId);
  try { await deleteFile(oldId); } catch (_) {}
}

// ---------- 动态（朋友圈，IndexedDB） ----------
// 动态必须带图：imageId 指向 files 里的真实图片；没有生图时用 imageDesc 文字描述图。
function normalizeMomentLike(raw) {
  if (!raw) return null;
  const type = raw.authorType === 'character' ? 'character' : 'user';
  const name = String(raw.name || (type === 'user' ? '我' : '角色')).trim();
  return {
    id: raw.id || genId(),
    authorType: type,
    characterId: raw.characterId || null,
    name: name || (type === 'user' ? '我' : '角色'),
  };
}

function normalizeMomentComment(raw) {
  if (!raw) return null;
  const content = String(raw.content || raw.text || '').trim();
  if (!content) return null;
  const type = raw.authorType === 'character' || raw.authorType === 'user' ? raw.authorType : 'npc';
  return {
    id: raw.id || genId(),
    authorType: type,
    authorId: raw.authorId || null,
    characterId: raw.characterId || raw.authorId || null,
    name: String(raw.name || (type === 'user' ? '我' : '路人')).trim() || '路人',
    content,
    createdAt: raw.createdAt || Date.now(),
  };
}

function normalizeMomentPost(raw) {
  if (!raw) return null;
  const text = String(raw.text || raw.content || '').trim();
  const imageId = raw.imageId || null;
  const imageDesc = String(raw.imageDesc || '').trim();
  if (!text && !imageId && !imageDesc) return null;
  const type = raw.authorType === 'character' ? 'character' : 'user';
  return {
    id: raw.id || genId(),
    authorType: type,
    authorId: raw.authorId || null,
    authorName: String(raw.authorName || (type === 'user' ? '我' : '角色')).trim() || (type === 'user' ? '我' : '角色'),
    text,
    imageId,
    imageDesc,
    createdAt: Number(raw.createdAt) || Date.now(),
    likes: (Array.isArray(raw.likes) ? raw.likes : []).map(normalizeMomentLike).filter(Boolean),
    comments: (Array.isArray(raw.comments) ? raw.comments : []).map(normalizeMomentComment).filter(Boolean)
      .sort((a, b) => a.createdAt - b.createdAt),
  };
}

function normalizeMomentSettings(raw) {
  const d = raw || {};
  const ids = (Array.isArray(d.characterIds) ? d.characterIds : []).filter(Boolean);
  let interval = parseInt(d.intervalHours, 10);
  if (!Number.isFinite(interval)) interval = 24;
  interval = Math.max(1, Math.min(720, interval));
  const lastPostAt = {};
  if (d.lastPostAt && typeof d.lastPostAt === 'object') {
    Object.keys(d.lastPostAt).forEach((key) => {
      const v = Number(d.lastPostAt[key]);
      if (Number.isFinite(v) && v > 0) lastPostAt[key] = v;
    });
  }
  return {
    characterIds: Array.from(new Set(ids)),
    intervalHours: interval,
    lastCheckedAt: Number(d.lastCheckedAt) || 0,
    lastPostAt,
  };
}

function normalizeMomentProfile(raw) {
  const d = raw || {};
  return {
    coverId: d.coverId || null,
    coverTouched: !!d.coverTouched,
  };
}

function normalizeMoments(doc) {
  const d = doc || {};
  return {
    settings: normalizeMomentSettings(d.settings),
    profile: normalizeMomentProfile(d.profile),
    posts: (Array.isArray(d.posts) ? d.posts : [])
      .map(normalizeMomentPost)
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 200),
  };
}

async function getMoments() {
  return normalizeMoments(await getDoc(DOC_MOMENTS));
}

function mutateMoments(mutator) {
  return mutateDoc(DOC_MOMENTS, (doc) => {
    const base = normalizeMoments(doc);
    doc.settings = base.settings;
    doc.profile = base.profile;
    doc.posts = base.posts;
    mutator(doc);
    doc.settings = normalizeMomentSettings(doc.settings);
    doc.profile = normalizeMomentProfile(doc.profile);
    doc.posts = (Array.isArray(doc.posts) ? doc.posts : [])
      .map(normalizeMomentPost)
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 200);
  });
}

async function updateMomentSettings(patch) {
  const p = patch || {};
  await mutateMoments((doc) => {
    const s = normalizeMomentSettings(doc.settings);
    if (p.characterIds !== undefined) {
      s.characterIds = Array.from(new Set((Array.isArray(p.characterIds) ? p.characterIds : []).filter(Boolean)));
    }
    if (p.intervalHours !== undefined) {
      let v = parseInt(p.intervalHours, 10);
      if (!Number.isFinite(v)) v = 24;
      s.intervalHours = Math.max(1, Math.min(720, v));
    }
    if (p.lastCheckedAt !== undefined) s.lastCheckedAt = Number(p.lastCheckedAt) || 0;
    if (p.lastPostAt && typeof p.lastPostAt === 'object') {
      Object.keys(p.lastPostAt).forEach((key) => {
        const v = Number(p.lastPostAt[key]);
        if (Number.isFinite(v) && v > 0) s.lastPostAt[key] = v;
      });
    }
    doc.settings = s;
  });
}

// 动态背景图：独立于论坛主页背景，存 files，文档只留引用
async function setMomentsCover(blob, type, name) {
  if (!blob) throw new Error('缺少图片文件');
  const moments = await getMoments();
  const oldId = moments.profile.coverId;
  const id = genId();
  await putFile({ id, name: name || 'moments-cover', type: type || blob.type || 'image/jpeg', blob });
  await mutateMoments((doc) => {
    doc.profile = { coverId: id, coverTouched: true };
  });
  if (oldId) {
    revokeFileUrl(oldId);
    try { await deleteFile(oldId); } catch (_) {}
  }
  return id;
}

async function clearMomentsCover() {
  const moments = await getMoments();
  const oldId = moments.profile.coverId;
  await mutateMoments((doc) => {
    doc.profile = { coverId: null, coverTouched: true };
  });
  if (oldId) {
    revokeFileUrl(oldId);
    try { await deleteFile(oldId); } catch (_) {}
  }
}

async function addMomentPost(post) {
  let record = null;
  await mutateMoments((doc) => {
    record = normalizeMomentPost(Object.assign({ createdAt: Date.now() }, post || {}));
    if (!record) return;
    doc.posts.unshift(record);
    if (record.authorType === 'character' && record.authorId) {
      doc.settings.lastPostAt[record.authorId] = record.createdAt;
    }
  });
  if (!record) throw new Error('动态内容为空');
  return record;
}

async function addMomentComments(postId, comments) {
  const list = (Array.isArray(comments) ? comments : []).map(normalizeMomentComment).filter(Boolean);
  if (!list.length) return [];
  await mutateMoments((doc) => {
    const p = doc.posts.find((x) => x.id === postId);
    if (p) p.comments = p.comments.concat(list);
  });
  return list;
}

async function addMomentLike(postId, like) {
  const record = normalizeMomentLike(like);
  if (!record) return;
  await mutateMoments((doc) => {
    const p = doc.posts.find((x) => x.id === postId);
    if (!p) return;
    const exists = p.likes.some((l) => {
      if (l.authorType !== record.authorType) return false;
      if (record.authorType === 'character') return l.characterId === record.characterId;
      return true;
    });
    if (!exists) p.likes.push(record);
  });
}

async function toggleMomentLike(postId, like) {
  const record = normalizeMomentLike(like);
  if (!record) return false;
  let added = false;
  await mutateMoments((doc) => {
    const p = doc.posts.find((x) => x.id === postId);
    if (!p) return;
    const idx = p.likes.findIndex((l) => {
      if (l.authorType !== record.authorType) return false;
      if (record.authorType === 'character') return l.characterId === record.characterId;
      return true;
    });
    if (idx >= 0) p.likes.splice(idx, 1);
    else { p.likes.push(record); added = true; }
  });
  return added;
}

async function deleteMomentPost(postId) {
  let imageId = null;
  await mutateMoments((doc) => {
    const target = doc.posts.find((x) => x.id === postId);
    if (target) imageId = target.imageId || null;
    doc.posts = doc.posts.filter((x) => x.id !== postId);
  });
  if (imageId) {
    revokeFileUrl(imageId);
    try { await deleteFile(imageId); } catch (_) {}
  }
}

async function deleteMomentComment(postId, commentId) {
  await mutateMoments((doc) => {
    const p = doc.posts.find((x) => x.id === postId);
    if (p) p.comments = p.comments.filter((c) => c.id !== commentId);
  });
}

// ---------- 邮箱（IndexedDB） ----------
// 每个角色会按间隔给用户写信；也支持用户在聊天工具里预约定时发信。
const DEFAULT_EMAIL_SETTINGS = { intervalHours: 24 };

function normalizeEmailSettings(raw) {
  const d = raw || {};
  let interval = parseInt(d.intervalHours, 10);
  if (!Number.isFinite(interval)) interval = DEFAULT_EMAIL_SETTINGS.intervalHours;
  interval = Math.max(1, Math.min(720, interval));
  return {
    characterIds: Array.isArray(d.characterIds)
      ? Array.from(new Set(d.characterIds.filter(Boolean)))
      : [],
    intervalHours: interval,
    lastCheckedAt: Number(d.lastCheckedAt) || 0,
  };
}

function normalizeEmailMail(raw) {
  if (!raw) return null;
  const body = String(raw.body || '').trim();
  if (!body) return null;
  const direction = raw.direction === 'out' ? 'out' : 'in';
  return {
    id: raw.id || genId(),
    characterId: raw.characterId || null,
    characterName: String(raw.characterName || '').trim() || '角色',
    direction,
    subject: String(raw.subject || '').trim() || '(无主题)',
    body,
    createdAt: Number(raw.createdAt) || Date.now(),
    read: direction === 'out' ? true : !!raw.read,
  };
}

function normalizeEmailPending(raw) {
  if (!raw || !raw.characterId) return null;
  const dueAt = Number(raw.dueAt);
  if (!Number.isFinite(dueAt)) return null;
  return {
    id: raw.id || genId(),
    characterId: raw.characterId,
    dueAt,
    createdAt: Number(raw.createdAt) || Date.now(),
  };
}

function normalizeEmail(doc) {
  const d = doc || {};
  const mails = (Array.isArray(d.mails) ? d.mails : [])
    .map(normalizeEmailMail)
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);
  return {
    settings: normalizeEmailSettings(d.settings),
    mails,
    pending: (Array.isArray(d.pending) ? d.pending : []).map(normalizeEmailPending).filter(Boolean),
  };
}

async function getEmail() {
  return normalizeEmail(await getDoc(DOC_EMAIL));
}

function mutateEmail(mutator) {
  return mutateDoc(DOC_EMAIL, (doc) => {
    doc.settings = normalizeEmailSettings(doc.settings);
    if (!Array.isArray(doc.mails)) doc.mails = [];
    if (!Array.isArray(doc.pending)) doc.pending = [];
    mutator(doc);
    if (doc.mails.length > 400) doc.mails.length = 400;
  });
}

async function updateEmailSettings(patch) {
  await mutateEmail((doc) => {
    doc.settings = normalizeEmailSettings(Object.assign(normalizeEmailSettings(doc.settings), patch || {}));
  });
}

async function addEmailMail(mail) {
  let added = null;
  await mutateEmail((doc) => {
    added = normalizeEmailMail(mail);
    if (!added) return;
    doc.mails.unshift(added);
  });
  return added;
}

async function markEmailRead(mailId) {
  await mutateEmail((doc) => {
    const m = doc.mails.find((x) => x.id === mailId);
    if (m) m.read = true;
  });
}

async function deleteEmailMail(mailId) {
  await mutateEmail((doc) => {
    doc.mails = doc.mails.filter((x) => x.id !== mailId);
  });
}

async function addEmailPendingJob(job) {
  let record = null;
  await mutateEmail((doc) => {
    record = normalizeEmailPending(job);
    if (record) doc.pending.push(record);
  });
  return record;
}

async function removeEmailPendingJob(jobId) {
  await mutateEmail((doc) => {
    doc.pending = doc.pending.filter((x) => x.id !== jobId);
  });
}

// ---------- 小说：书架 / 章节 / 批注 / 阅读讨论 ----------
function normalizeBookProgress(raw) {
  const d = raw || {};
  return {
    chapterIndex: Math.max(0, parseInt(d.chapterIndex, 10) || 0),
    paragraph: Math.max(0, parseInt(d.paragraph, 10) || 0),
  };
}

function normalizeBookMeta(raw) {
  if (!raw) return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;
  return {
    id,
    title: String(raw.title || '未命名小说').trim() || '未命名小说',
    author: String(raw.author || '').trim(),
    format: ['epub', 'txt', 'pdf'].includes(raw.format) ? raw.format : 'txt',
    chapterCount: Math.max(0, parseInt(raw.chapterCount, 10) || 0),
    addedAt: Number(raw.addedAt) || Date.now(),
    progress: normalizeBookProgress(raw.progress),
  };
}

function normalizeBookAnnotation(raw) {
  if (!raw) return null;
  const text = String(raw.text || '').trim();
  if (!text) return null;
  return {
    id: raw.id || genId(),
    characterId: raw.characterId || null,
    characterName: String(raw.characterName || '角色').trim() || '角色',
    chapterIndex: Math.max(0, parseInt(raw.chapterIndex, 10) || 0),
    paragraph: Math.max(0, parseInt(raw.paragraph, 10) || 0),
    text,
    createdAt: Number(raw.createdAt) || Date.now(),
  };
}

function normalizeBookChapter(raw, index) {
  const d = raw || {};
  const paragraphs = Array.isArray(d.paragraphs)
    ? d.paragraphs.map((p) => String(p || '').trim()).filter(Boolean)
    : [];
  return {
    id: d.id || genId(),
    title: String(d.title || '').trim() || ('第 ' + (index + 1) + ' 章'),
    paragraphs,
  };
}

function normalizeBookDoc(doc) {
  const d = doc || {};
  return {
    id: d.id || (DOC_BOOK_PREFIX + (d.bookId || genId())),
    bookId: d.bookId || String(d.id || '').replace(DOC_BOOK_PREFIX, ''),
    title: String(d.title || '未命名小说').trim() || '未命名小说',
    author: String(d.author || '').trim(),
    format: ['epub', 'txt', 'pdf'].includes(d.format) ? d.format : 'txt',
    chapters: (Array.isArray(d.chapters) ? d.chapters : []).map(normalizeBookChapter),
    annotations: (Array.isArray(d.annotations) ? d.annotations : []).map(normalizeBookAnnotation).filter(Boolean),
    createdAt: Number(d.createdAt) || Date.now(),
    updatedAt: Number(d.updatedAt) || Date.now(),
  };
}

function normalizeBookChatDoc(doc) {
  const d = doc || {};
  const chats = {};
  const src = (d.chats && typeof d.chats === 'object') ? d.chats : {};
  Object.keys(src).forEach((cid) => {
    const list = Array.isArray(src[cid]) ? src[cid] : [];
    chats[cid] = list.map((m) => ({
      role: m && m.role === 'user' ? 'user' : 'character',
      text: String((m && m.text) || '').trim(),
      createdAt: Number(m && m.createdAt) || Date.now(),
    })).filter((m) => m.text);
  });
  return { id: d.id || '', chats };
}

function normalizeBooks(doc) {
  const d = doc || {};
  const list = (Array.isArray(d.list) ? d.list : []).map(normalizeBookMeta).filter(Boolean);
  const activeId = list.some((b) => b.id === d.activeId) ? d.activeId : (list[0] ? list[0].id : null);
  return { list, activeId };
}

async function getBooks() {
  return normalizeBooks(await getDoc(DOC_BOOKS));
}

async function mutateBooks(mutator) {
  return mutateDoc(DOC_BOOKS, (doc) => {
    if (!Array.isArray(doc.list)) doc.list = [];
    mutator(doc);
  });
}

async function setActiveBook(bookId) {
  await mutateBooks((doc) => {
    if (doc.list.some((b) => b.id === bookId)) doc.activeId = bookId;
  });
}

async function getBook(bookId) {
  if (!bookId) return null;
  const doc = await getDoc(DOC_BOOK_PREFIX + bookId);
  return doc ? normalizeBookDoc(doc) : null;
}

function bookMetaFromImport(id, info) {
  const chapters = Array.isArray(info.chapters) ? info.chapters : [];
  return normalizeBookMeta({
    id,
    title: info.title,
    author: info.author,
    format: info.format,
    chapterCount: chapters.length,
    addedAt: Date.now(),
    progress: { chapterIndex: 0, paragraph: 0 },
  });
}

async function importBook(info) {
  const chapters = (Array.isArray(info && info.chapters) ? info.chapters : []).map(normalizeBookChapter).filter((c) => c.paragraphs.length);
  if (!chapters.length) throw new Error('没有解析到可阅读的正文');
  const id = genId();
  const now = Date.now();
  await putDoc({
    id: DOC_BOOK_PREFIX + id,
    bookId: id,
    title: (info && info.title) || '未命名小说',
    author: (info && info.author) || '',
    format: (info && info.format) || 'txt',
    chapters,
    annotations: [],
    createdAt: now,
    updatedAt: now,
  });
  const meta = bookMetaFromImport(id, Object.assign({}, info, { chapters }));
  await mutateBooks((doc) => {
    doc.list.unshift(meta);
    doc.activeId = id;
  });
  return meta;
}

async function deleteBook(bookId) {
  await mutateBooks((doc) => {
    doc.list = doc.list.filter((b) => b.id !== bookId);
    if (doc.activeId === bookId) doc.activeId = doc.list[0] ? doc.list[0].id : null;
  });
  try { await deleteDoc(DOC_BOOK_PREFIX + bookId); } catch (_) {}
  try { await deleteDoc(DOC_BOOK_CHAT_PREFIX + bookId); } catch (_) {}
}

async function updateBookProgress(bookId, progress) {
  await mutateBooks((doc) => {
    const b = doc.list.find((x) => x.id === bookId);
    if (b) b.progress = normalizeBookProgress(progress);
  });
}

async function addBookAnnotation(bookId, annotation) {
  let added = null;
  await mutateDoc(DOC_BOOK_PREFIX + bookId, (doc) => {
    if (!Array.isArray(doc.annotations)) doc.annotations = [];
    added = normalizeBookAnnotation(annotation);
    if (added) doc.annotations.push(added);
    doc.updatedAt = Date.now();
  });
  return added;
}

async function updateBookAnnotation(bookId, annotationId, patch) {
  await mutateDoc(DOC_BOOK_PREFIX + bookId, (doc) => {
    if (!Array.isArray(doc.annotations)) doc.annotations = [];
    const a = doc.annotations.find((x) => x.id === annotationId);
    if (!a) return;
    if (patch && patch.text !== undefined) a.text = String(patch.text || '').trim();
    if (patch && patch.paragraph !== undefined) a.paragraph = Math.max(0, parseInt(patch.paragraph, 10) || 0);
    doc.updatedAt = Date.now();
  });
}

async function deleteBookAnnotation(bookId, annotationId) {
  await mutateDoc(DOC_BOOK_PREFIX + bookId, (doc) => {
    if (!Array.isArray(doc.annotations)) doc.annotations = [];
    doc.annotations = doc.annotations.filter((x) => x.id !== annotationId);
    doc.updatedAt = Date.now();
  });
}

async function getBookChat(bookId, characterId) {
  const doc = normalizeBookChatDoc(await getDoc(DOC_BOOK_CHAT_PREFIX + bookId));
  return doc.chats[characterId] || [];
}

async function appendBookChat(bookId, characterId, message) {
  const text = String((message && message.text) || '').trim();
  if (!text) return;
  const docId = DOC_BOOK_CHAT_PREFIX + bookId;
  await mutateDoc(docId, (doc) => {
    if (!doc.chats || typeof doc.chats !== 'object') doc.chats = {};
    if (!Array.isArray(doc.chats[characterId])) doc.chats[characterId] = [];
    doc.chats[characterId].push({
      role: message.role === 'user' ? 'user' : 'character',
      text,
      createdAt: Date.now(),
    });
    if (doc.chats[characterId].length > 200) doc.chats[characterId] = doc.chats[characterId].slice(-200);
  });
}

async function clearBookChat(bookId, characterId) {
  const docId = DOC_BOOK_CHAT_PREFIX + bookId;
  await mutateDoc(docId, (doc) => {
    if (!doc.chats || typeof doc.chats !== 'object') doc.chats = {};
    doc.chats[characterId] = [];
  });
}

async function getBooksBackup() {
  const { list, activeId } = await getBooks();
  const docs = {};
  const chats = {};
  for (const meta of list) {
    const book = await getBook(meta.id);
    if (book) docs[meta.id] = book;
    const chatDoc = normalizeBookChatDoc(await getDoc(DOC_BOOK_CHAT_PREFIX + meta.id));
    chats[meta.id] = chatDoc.chats;
  }
  return { list, activeId, docs, chats };
}

async function applyBooksBackup(data) {
  const old = await getBooks();
  for (const b of old.list) {
    try { await deleteDoc(DOC_BOOK_PREFIX + b.id); } catch (_) {}
    try { await deleteDoc(DOC_BOOK_CHAT_PREFIX + b.id); } catch (_) {}
  }
  const src = data || {};
  const list = (Array.isArray(src.list) ? src.list : []).map(normalizeBookMeta).filter(Boolean);
  const docs = src.docs || {};
  const chats = src.chats || {};
  for (const meta of list) {
    const book = normalizeBookDoc(docs[meta.id] || { id: DOC_BOOK_PREFIX + meta.id, bookId: meta.id, title: meta.title });
    book.id = DOC_BOOK_PREFIX + meta.id;
    book.bookId = meta.id;
    book.chapters = book.chapters.filter((c) => c.paragraphs.length);
    if (!book.chapters.length) continue;
    await putDoc(book);
    const chatDoc = normalizeBookChatDoc({ id: DOC_BOOK_CHAT_PREFIX + meta.id, chats: chats[meta.id] || {} });
    await putDoc({ id: DOC_BOOK_CHAT_PREFIX + meta.id, chats: chatDoc.chats });
  }
  const activeId = list.some((b) => b.id === src.activeId) ? src.activeId : (list[0] ? list[0].id : null);
  await putDoc({ id: DOC_BOOKS, list, activeId });
}

// ---------- 日记（IndexedDB，按角色分仓） ----------
// 每个角色一本日记：{ enabled, time, lastWrittenDate, entries: [{ date, title, mood, body, todos }] }
function diaryDocId(characterId) { return DOC_DIARY_PREFIX + characterId; }

function diaryDateKey(input) {
  const d = input instanceof Date ? input : new Date(input || Date.now());
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function normalizeDiaryTime(value) {
  const t = String(value || '').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : DEFAULT_DIARY_TIME;
}

function normalizeDiaryTodo(raw) {
  if (raw && typeof raw === 'object') {
    const text = String(raw.text || '').trim();
    if (!text) return null;
    return { id: raw.id || genId(), text, done: !!raw.done };
  }
  const text = String(raw || '').trim();
  return text ? { id: genId(), text, done: false } : null;
}

function normalizeDiaryEntry(raw) {
  if (!raw) return null;
  const title = String(raw.title || '').trim();
  const body = String(raw.body || '').trim();
  if (!title && !body) return null;
  return {
    id: raw.id || genId(),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date || '')) ? String(raw.date) : diaryDateKey(),
    title: title || '没有标题的一天',
    mood: String(raw.mood || '').trim(),
    body,
    todos: (Array.isArray(raw.todos) ? raw.todos : []).map(normalizeDiaryTodo).filter(Boolean),
    createdAt: Number(raw.createdAt) || Date.now(),
  };
}

function normalizeDiaryDoc(doc) {
  const d = doc || {};
  return {
    enabled: !!d.enabled,
    time: normalizeDiaryTime(d.time),
    lastWrittenDate: String(d.lastWrittenDate || '').slice(0, 10),
    entries: (Array.isArray(d.entries) ? d.entries : [])
      .map(normalizeDiaryEntry)
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt),
  };
}

async function getDiary(characterId) {
  const id = characterId || await getActiveCharacterId();
  if (!id) return normalizeDiaryDoc(null);
  return normalizeDiaryDoc(await getDoc(diaryDocId(id)));
}

function mutateDiary(characterId, mutator) {
  if (!characterId) return Promise.reject(new Error('请先创建角色'));
  return mutateDoc(diaryDocId(characterId), (doc) => {
    const base = normalizeDiaryDoc(doc);
    doc.enabled = base.enabled;
    doc.time = base.time;
    doc.lastWrittenDate = base.lastWrittenDate;
    doc.entries = base.entries;
    mutator(doc);
    doc.entries = (Array.isArray(doc.entries) ? doc.entries : [])
      .map(normalizeDiaryEntry)
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 200);
  });
}

async function updateDiarySettings(characterId, patch) {
  await mutateDiary(characterId, (doc) => {
    if (patch.enabled !== undefined) doc.enabled = !!patch.enabled;
    if (patch.time !== undefined) doc.time = normalizeDiaryTime(patch.time);
    if (patch.lastWrittenDate !== undefined) doc.lastWrittenDate = String(patch.lastWrittenDate || '').slice(0, 10);
  });
}

async function addDiaryEntry(characterId, entry) {
  const record = normalizeDiaryEntry(entry);
  if (!record) throw new Error('日记内容为空');
  await mutateDiary(characterId, (doc) => {
    doc.entries.unshift(record);
    doc.lastWrittenDate = record.date;
  });
  return record;
}

async function deleteDiaryEntry(characterId, entryId) {
  await mutateDiary(characterId, (doc) => {
    doc.entries = doc.entries.filter((e) => e.id !== entryId);
  });
}

async function toggleDiaryTodo(characterId, entryId, todoId) {
  await mutateDiary(characterId, (doc) => {
    const entry = doc.entries.find((e) => e.id === entryId);
    if (!entry) return;
    const todo = (entry.todos || []).find((t) => t.id === todoId);
    if (todo) todo.done = !todo.done;
  });
}

// ===== 日程 =====
function scheduleDocId(characterId) { return DOC_SCHEDULE_PREFIX + characterId; }

function normalizeClock(value) {
  const s = String(value || '').trim().replace(/：/g, ':').replace(/\s+/g, '');
  let m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) m = s.match(/^(\d{1,2})点(\d{1,2})?分?$/);
  if (!m) return '';
  const h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (!(h >= 0 && h <= 23) || !(min >= 0 && min <= 59)) return '';
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

function addClockMinutes(clock, minutes) {
  const [h, m] = clock.split(':').map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

function normalizeScheduleTime(value) {
  return normalizeClock(value) || DEFAULT_SCHEDULE_TIME;
}

function normalizeScheduleItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title || raw.activity || raw.what || raw.name || raw.task || raw.content || raw.desc || raw['内容'] || '').trim();
  let startRaw = raw.start || raw.begin || raw.from || raw.time || raw.startTime || raw['开始时间'] || '';
  let endRaw = raw.end || raw.until || raw.to || raw.endTime || raw['结束时间'] || '';
  // 有些模型会写成 "07:30-08:10"，拆开用
  const range = String(startRaw).match(/^\s*(\d{1,2}[:：]\d{2})\s*[-–—~～至到]\s*(\d{1,2}[:：]\d{2})\s*$/);
  if (range) {
    startRaw = range[1];
    endRaw = endRaw || range[2];
  }
  const start = normalizeClock(startRaw);
  if (!title || !start) return null;
  let end = normalizeClock(endRaw);
  if (!end || end <= start) end = addClockMinutes(start, 60);
  return {
    start,
    end,
    title,
    place: String(raw.place || raw.location || raw['地点'] || '').trim(),
    note: String(raw.note || raw.detail || raw['备注'] || '').trim(),
  };
}

function normalizeScheduleDoc(doc) {
  const d = doc || {};
  return {
    enabled: !!d.enabled,
    time: normalizeScheduleTime(d.time),
    lastRunDate: String(d.lastRunDate || '').slice(0, 10),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(d.date || '')) ? String(d.date) : '',
    items: (Array.isArray(d.items) ? d.items : [])
      .map(normalizeScheduleItem)
      .filter(Boolean)
      .sort((a, b) => a.start.localeCompare(b.start)),
    updatedAt: Number(d.updatedAt) || 0,
  };
}

async function getSchedule(characterId) {
  const id = characterId || await getActiveCharacterId();
  if (!id) return normalizeScheduleDoc(null);
  return normalizeScheduleDoc(await getDoc(scheduleDocId(id)));
}

function mutateSchedule(characterId, mutator) {
  if (!characterId) return Promise.reject(new Error('请先创建角色'));
  return mutateDoc(scheduleDocId(characterId), (doc) => {
    const base = normalizeScheduleDoc(doc);
    doc.enabled = base.enabled;
    doc.time = base.time;
    doc.lastRunDate = base.lastRunDate;
    doc.date = base.date;
    doc.items = base.items;
    mutator(doc);
    doc.items = (Array.isArray(doc.items) ? doc.items : [])
      .map(normalizeScheduleItem)
      .filter(Boolean)
      .sort((a, b) => a.start.localeCompare(b.start));
    doc.updatedAt = Date.now();
  });
}

async function updateScheduleSettings(characterId, patch) {
  await mutateSchedule(characterId, (doc) => {
    if (patch.enabled !== undefined) doc.enabled = !!patch.enabled;
    if (patch.time !== undefined) doc.time = normalizeScheduleTime(patch.time);
    if (patch.lastRunDate !== undefined) doc.lastRunDate = String(patch.lastRunDate || '').slice(0, 10);
  });
}

async function saveSchedule(characterId, payload) {
  const items = (Array.isArray(payload && payload.items) ? payload.items : [])
    .map(normalizeScheduleItem)
    .filter(Boolean)
    .sort((a, b) => a.start.localeCompare(b.start));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String((payload && payload.date) || '')) ? payload.date : diaryDateKey();
  await mutateSchedule(characterId, (doc) => {
    doc.date = date;
    doc.items = items;
    doc.lastRunDate = date;
  });
  return { date, items };
}

// ===== 群聊 =====
function normalizeGroupActivity(raw) {
  const a = raw || {};
  return {
    enabled: !!a.enabled,
    minutes: Math.max(1, Math.min(1440, parseInt(a.minutes, 10) || 10)),
    lastAt: Number(a.lastAt) || 0,
    lastSpeakerId: String(a.lastSpeakerId || ''),
  };
}

function normalizeGroup(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const memberIds = [];
  (Array.isArray(raw.memberIds) ? raw.memberIds : []).forEach((id) => {
    const v = String(id || '').trim();
    if (v && memberIds.indexOf(v) === -1) memberIds.push(v);
  });
  return {
    id: String(raw.id || genId()),
    name: String(raw.name || '').trim().slice(0, 30) || '新群聊',
    memberIds,
    activity: normalizeGroupActivity(raw.activity),
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

async function getGroups() {
  const doc = await getDoc(DOC_GROUPS);
  return (doc && Array.isArray(doc.list) ? doc.list : [])
    .map(normalizeGroup)
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

async function getGroup(id) {
  if (!id) return null;
  const list = await getGroups();
  return list.find((g) => g.id === id) || null;
}

async function addGroup({ name, memberIds, activity } = {}) {
  const record = normalizeGroup({ name, memberIds, activity });
  await mutateDoc(DOC_GROUPS, (doc) => {
    if (!Array.isArray(doc.list)) doc.list = [];
    doc.list.push(record);
  });
  return record;
}

async function updateGroup(id, patch) {
  const p = patch || {};
  await mutateDoc(DOC_GROUPS, (doc) => {
    if (!Array.isArray(doc.list)) doc.list = [];
    const g = doc.list.find((x) => x.id === id);
    if (!g) return;
    if (p.name !== undefined) g.name = String(p.name || '').trim().slice(0, 30) || '新群聊';
    if (p.memberIds !== undefined) {
      const next = [];
      (Array.isArray(p.memberIds) ? p.memberIds : []).forEach((mid) => {
        const v = String(mid || '').trim();
        if (v && next.indexOf(v) === -1) next.push(v);
      });
      g.memberIds = next;
    }
    if (p.activity !== undefined) {
      g.activity = normalizeGroupActivity(Object.assign({}, g.activity, p.activity));
    }
    g.updatedAt = Date.now();
  });
}

function groupChatDocId(groupId) { return DOC_GROUP_CHAT_PREFIX + groupId; }

async function deleteGroup(id) {
  if (!id) return;
  await mutateDoc(DOC_GROUPS, (doc) => {
    if (!Array.isArray(doc.list)) doc.list = [];
    doc.list = doc.list.filter((g) => g.id !== id);
  });
  try { await deleteDoc(groupChatDocId(id)); } catch (_) {}
}

async function getGroupHistory(groupId) {
  if (!groupId) return [];
  const doc = await getDoc(groupChatDocId(groupId));
  return doc && Array.isArray(doc.messages) ? doc.messages : [];
}

async function mutateGroupHistory(groupId, mutator) {
  if (!groupId) throw new Error('群聊不存在');
  return mutateDoc(groupChatDocId(groupId), (doc) => {
    if (!Array.isArray(doc.messages)) doc.messages = [];
    mutator(doc.messages);
  });
}

async function clearGroupHistory(groupId) {
  if (!groupId) return;
  await putDoc({ id: groupChatDocId(groupId), messages: [] });
}

// ===== 商城 =====
// 购物车按角色分仓，订单集中保存并保留角色名快照（删除角色不影响历史订单）。
function normalizeShopItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim();
  const price = Number(String(raw.price === undefined || raw.price === null ? '' : raw.price).replace(/[^\d.]/g, ''));
  if (!name || !isFinite(price) || price < 0) return null;
  return {
    id: String(raw.id || genId()),
    name: name.slice(0, 60),
    price: Math.round(price * 100) / 100,
    desc: String(raw.desc || '').trim().slice(0, 200),
    tag: String(raw.tag || '').trim().slice(0, 20),
    qty: Math.max(1, Math.min(99, parseInt(raw.qty, 10) || 1)),
  };
}

function normalizeShopOrder(raw) {
  const d = raw || {};
  const items = (Array.isArray(d.items) ? d.items : []).map(normalizeShopItem).filter(Boolean);
  const total = items.reduce((sum, it) => sum + it.price * it.qty, 0);
  return {
    id: String(d.id || genId()),
    characterId: String(d.characterId || ''),
    characterName: String(d.characterName || '角色').slice(0, 40),
    items,
    total: Math.round(total * 100) / 100,
    address: String(d.address || '').trim().slice(0, 200),
    days: Math.max(1, Math.min(30, parseInt(d.days, 10) || 3)),
    createdAt: Number(d.createdAt) || Date.now(),
  };
}

function normalizeShop(doc) {
  const d = doc || {};
  const carts = {};
  if (d.carts && typeof d.carts === 'object') {
    Object.keys(d.carts).forEach((cid) => {
      const items = (Array.isArray(d.carts[cid]) ? d.carts[cid] : []).map(normalizeShopItem).filter(Boolean);
      if (items.length) carts[cid] = items;
    });
  }
  return {
    carts,
    orders: (Array.isArray(d.orders) ? d.orders : [])
      .map(normalizeShopOrder)
      .filter((o) => o.items.length),
  };
}

async function getShop() {
  return normalizeShop(await getDoc(DOC_SHOP));
}

function mutateShop(mutator) {
  return mutateDoc(DOC_SHOP, (doc) => {
    const base = normalizeShop(doc);
    doc.carts = base.carts;
    doc.orders = base.orders;
    mutator(doc);
    const next = normalizeShop(doc);
    doc.carts = next.carts;
    doc.orders = next.orders;
  });
}

async function getShopCart(characterId) {
  const id = characterId || await getActiveCharacterId();
  if (!id) return [];
  const shop = await getShop();
  return shop.carts[id] || [];
}

// 同名同价视为同一件商品，只累加数量
async function addShopCartItem(characterId, product) {
  const id = characterId || await getActiveCharacterId();
  if (!id) throw new Error('请先选择一个联系人');
  const item = normalizeShopItem(product);
  if (!item) throw new Error('商品信息不完整，暂时不能加入购物车');
  await mutateShop((doc) => {
    if (!Array.isArray(doc.carts[id])) doc.carts[id] = [];
    const existing = doc.carts[id].find((x) => x.name === item.name && x.price === item.price);
    if (existing) existing.qty = Math.min(99, existing.qty + 1);
    else doc.carts[id].push({ ...item, qty: 1 });
  });
  return getShopCart(id);
}

async function updateShopCartQty(characterId, itemId, qty) {
  const id = characterId || await getActiveCharacterId();
  if (!id) throw new Error('请先选择一个联系人');
  const next = Math.max(1, Math.min(99, parseInt(qty, 10) || 1));
  await mutateShop((doc) => {
    const items = doc.carts[id] || [];
    const item = items.find((x) => x.id === itemId);
    if (item) item.qty = next;
  });
  return getShopCart(id);
}

async function removeShopCartItem(characterId, itemId) {
  const id = characterId || await getActiveCharacterId();
  if (!id) throw new Error('请先选择一个联系人');
  await mutateShop((doc) => {
    if (Array.isArray(doc.carts[id])) doc.carts[id] = doc.carts[id].filter((x) => x.id !== itemId);
  });
  return getShopCart(id);
}

async function clearShopCart(characterId) {
  const id = characterId || await getActiveCharacterId();
  if (!id) return [];
  await mutateShop((doc) => { delete doc.carts[id]; });
  return [];
}

// 结算：把该角色购物车转成订单，并清空购物车
async function createShopOrder(payload) {
  const p = payload || {};
  const id = p.characterId || await getActiveCharacterId();
  if (!id) throw new Error('请先选择一个联系人');
  const shop = await getShop();
  const items = shop.carts[id] || [];
  if (!items.length) throw new Error('购物车还是空的');
  const order = normalizeShopOrder({
    characterId: id,
    characterName: p.characterName,
    items,
    address: p.address,
    days: p.days,
  });
  await mutateShop((doc) => {
    doc.orders.unshift(order);
    delete doc.carts[id];
  });
  return order;
}

// ===== 外卖 =====
// 与商城同一套结构：按角色分仓购物车 + 订单，额外记录预计送达分钟数
function normalizeFoodOrder(raw) {
  const base = normalizeShopOrder(raw);
  return {
    ...base,
    minutes: Math.max(5, Math.min(180, parseInt(raw && raw.minutes, 10) || 30)),
  };
}

function normalizeFood(doc) {
  const d = doc || {};
  const carts = {};
  if (d.carts && typeof d.carts === 'object') {
    Object.keys(d.carts).forEach((cid) => {
      const items = (Array.isArray(d.carts[cid]) ? d.carts[cid] : []).map(normalizeShopItem).filter(Boolean);
      if (items.length) carts[cid] = items;
    });
  }
  return {
    carts,
    orders: (Array.isArray(d.orders) ? d.orders : [])
      .map(normalizeFoodOrder)
      .filter((o) => o.items.length),
  };
}

async function getFood() {
  return normalizeFood(await getDoc(DOC_FOOD));
}

function mutateFood(mutator) {
  return mutateDoc(DOC_FOOD, (doc) => {
    const base = normalizeFood(doc);
    doc.carts = base.carts;
    doc.orders = base.orders;
    mutator(doc);
    const next = normalizeFood(doc);
    doc.carts = next.carts;
    doc.orders = next.orders;
  });
}

async function getFoodCart(characterId) {
  const id = characterId || await getActiveCharacterId();
  if (!id) return [];
  const food = await getFood();
  return food.carts[id] || [];
}

async function addFoodCartItem(characterId, product) {
  const id = characterId || await getActiveCharacterId();
  if (!id) throw new Error('请先选择一个联系人');
  const item = normalizeShopItem(product);
  if (!item) throw new Error('商品信息不完整，暂时不能加入购物车');
  await mutateFood((doc) => {
    if (!Array.isArray(doc.carts[id])) doc.carts[id] = [];
    const existing = doc.carts[id].find((x) => x.name === item.name && x.price === item.price);
    if (existing) existing.qty = Math.min(99, existing.qty + 1);
    else doc.carts[id].push({ ...item, qty: 1 });
  });
  return getFoodCart(id);
}

async function updateFoodCartQty(characterId, itemId, qty) {
  const id = characterId || await getActiveCharacterId();
  if (!id) throw new Error('请先选择一个联系人');
  const next = Math.max(1, Math.min(99, parseInt(qty, 10) || 1));
  await mutateFood((doc) => {
    const items = doc.carts[id] || [];
    const item = items.find((x) => x.id === itemId);
    if (item) item.qty = next;
  });
  return getFoodCart(id);
}

async function removeFoodCartItem(characterId, itemId) {
  const id = characterId || await getActiveCharacterId();
  if (!id) throw new Error('请先选择一个联系人');
  await mutateFood((doc) => {
    if (Array.isArray(doc.carts[id])) doc.carts[id] = doc.carts[id].filter((x) => x.id !== itemId);
  });
  return getFoodCart(id);
}

async function createFoodOrder(payload) {
  const p = payload || {};
  const id = p.characterId || await getActiveCharacterId();
  if (!id) throw new Error('请先选择一个联系人');
  const food = await getFood();
  const items = food.carts[id] || [];
  if (!items.length) throw new Error('购物车还是空的');
  const order = normalizeFoodOrder({
    characterId: id,
    characterName: p.characterName,
    items,
    address: p.address,
    minutes: p.minutes,
  });
  await mutateFood((doc) => {
    doc.orders.unshift(order);
    delete doc.carts[id];
  });
  return order;
}

// ===== 音乐 =====
function normalizeMusicTrack(raw) {
  const t = raw || {};
  const name = String(t.name || '').trim();
  if (!name) return null;
  return {
    id: String(t.id || genId()),
    name,
    artist: String(t.artist || '').trim(),
    album: String(t.album || '').trim(),
    source: t.source === 'netease' ? 'netease' : 'local',
    fileId: t.fileId ? String(t.fileId) : null,
    neteaseId: t.neteaseId != null ? String(t.neteaseId) : null,
    cover: String(t.cover || ''),
    lyrics: String(t.lyrics || ''),
    playlistName: String(t.playlistName || ''),
    addedAt: Number(t.addedAt) || Date.now(),
  };
}

function normalizeMusic(doc) {
  const d = doc || {};
  return {
    tracks: (Array.isArray(d.tracks) ? d.tracks : [])
      .map(normalizeMusicTrack)
      .filter(Boolean),
  };
}

async function getMusicLibrary() {
  return normalizeMusic(await getDoc(DOC_MUSIC));
}

async function addMusicTracks(list) {
  const incoming = (Array.isArray(list) ? list : []).map(normalizeMusicTrack).filter(Boolean);
  if (!incoming.length) return [];
  await mutateDoc(DOC_MUSIC, (doc) => {
    const base = normalizeMusic(doc);
    const known = new Set(base.tracks.map((t) => (t.source === 'netease' && t.neteaseId) ? 'n' + t.neteaseId : 'l' + t.name + '|' + t.artist));
    incoming.forEach((t) => {
      const key = (t.source === 'netease' && t.neteaseId) ? 'n' + t.neteaseId : 'l' + t.name + '|' + t.artist;
      if (!known.has(key)) {
        known.add(key);
        base.tracks.unshift(t);
      }
    });
    doc.tracks = base.tracks;
  });
  return getMusicLibrary();
}

// 本地歌曲：音频 Blob 存 files，曲目只留 fileId
async function addLocalMusicTrack({ name, artist, blob, type, lyrics }) {
  if (!blob) throw new Error('没有读到歌曲文件');
  const fileId = genId();
  await putFile({ id: fileId, name: name || 'music', type: type || blob.type || 'audio/mpeg', blob });
  const track = normalizeMusicTrack({
    id: 'track-' + fileId,
    name: name || '未命名歌曲',
    artist: artist || '本地歌曲',
    source: 'local',
    fileId,
    lyrics: lyrics || '',
  });
  await mutateDoc(DOC_MUSIC, (doc) => {
    const base = normalizeMusic(doc);
    base.tracks.unshift(track);
    doc.tracks = base.tracks;
  });
  return track;
}

async function updateMusicTrack(id, patch) {
  await mutateDoc(DOC_MUSIC, (doc) => {
    const base = normalizeMusic(doc);
    const track = base.tracks.find((t) => t.id === id);
    if (track) Object.assign(track, patch || {});
    doc.tracks = base.tracks;
  });
}

async function removeMusicTrack(id) {
  let fileId = null;
  await mutateDoc(DOC_MUSIC, (doc) => {
    const base = normalizeMusic(doc);
    const track = base.tracks.find((t) => t.id === id);
    fileId = track && track.fileId;
    doc.tracks = base.tracks.filter((t) => t.id !== id);
  });
  if (fileId) {
    try { await deleteFile(fileId); } catch (_) {}
    revokeFileUrl(fileId);
  }
}

// ---------- 感知：真实时间 / 地点 / 天气（IndexedDB） ----------
function normalizePerception(doc) {
  const d = doc || {};
  const loc = d.location && typeof d.location === 'object' ? d.location : {};
  const weather = d.weather && typeof d.weather === 'object' ? d.weather : {};
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    timeEnabled: !!d.timeEnabled,
    locationEnabled: !!d.locationEnabled,
    batteryEnabled: !!d.batteryEnabled,
    usageEnabled: !!d.usageEnabled,
    sleepEnabled: !!d.sleepEnabled,
    location: {
      lat: num(loc.lat),
      lng: num(loc.lng),
      label: String(loc.label || '').trim(),
      at: num(loc.at) || 0,
    },
    weather: {
      address: String(weather.address || '').trim(),
      text: String(weather.text || '').trim(),
      temp: num(weather.temp),
      code: num(weather.code),
      updatedAt: num(weather.updatedAt) || 0,
    },
    lastActiveAt: num(d.lastActiveAt) || 0,
    lastByChar: (d.lastByChar && typeof d.lastByChar === 'object') ? Object.assign({}, d.lastByChar) : {},
  };
}

async function getPerception() {
  return normalizePerception(await getDoc(DOC_PERCEPTION));
}

function setPerception(patch) {
  return mutateDoc(DOC_PERCEPTION, (doc) => {
    const base = normalizePerception(doc);
    const next = Object.assign({}, base, patch || {});
    next.location = Object.assign({}, base.location, (patch && patch.location) || {});
    next.weather = Object.assign({}, base.weather, (patch && patch.weather) || {});
    next.lastByChar = Object.assign({}, base.lastByChar, (patch && patch.lastByChar) || {});
    doc.timeEnabled = !!next.timeEnabled;
    doc.locationEnabled = !!next.locationEnabled;
    doc.batteryEnabled = !!next.batteryEnabled;
    doc.usageEnabled = !!next.usageEnabled;
    doc.sleepEnabled = !!next.sleepEnabled;
    doc.location = next.location;
    doc.weather = next.weather;
    doc.lastActiveAt = next.lastActiveAt || 0;
    doc.lastByChar = next.lastByChar;
  });
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

// 角色说话方式：勾选后把对应提示词注入聊天 system
const CHAT_STYLE_OPTIONS = [
  { id: 'short', title: '短回复与留气口', desc: '留气口，别一轮说满', prompt: '回复短一些，通常一到两句，别一轮把话说完，给对方留出接话的气口。' },
  { id: 'older', group: 'age', title: '年上 / 关系位置', desc: '更年长或自认更懂', prompt: '你在关系里偏年长，更成熟、更懂一些，可以照顾和提点对方，但不要说教，也别居高临下。' },
  { id: 'younger', group: 'age', title: '年下 / 关系位置', desc: '更年轻或更后一步', prompt: '你在关系里偏年轻，更直接、更有活力，偶尔依赖或撒娇，但不幼稚、不装可爱。' },
  { id: 'internetGood', group: 'internet', title: '网感好', desc: '懂梗但不刷屏', prompt: '你网感好，懂梗也会接梗，但别刷屏，不要堆网络流行语，自然带过就好。' },
  { id: 'internetPoor', group: 'internet', title: '网感较差', desc: '慢半拍地理解', prompt: '你网感稍慢，反应半拍，偶尔把梗理解偏，但语气认真自然，不要刻意装傻。' },
  { id: 'pingpong', title: '你来我往', desc: '回应，再递回去', prompt: '聊天要你来我往：先回应对方说的内容，再把话题轻轻递回去，别自说自话。' },
  { id: 'proactive', title: '主动型', desc: '主动表达，尊重反馈', prompt: '你可以主动表达自己的想法和情绪，也尊重对方的反馈，不替对方做决定。' },
  { id: 'guiding', title: '引导型', desc: '给路标，不替人做主', prompt: '你可以给方向、给路标，但不替对方做主，多用邀请式的提问让对方自己选。' },
  { id: 'terse', title: '话少 / 精准', desc: '短，但不空', prompt: '你话少但精准，句子短，不空洞、不敷衍，每一句都要有信息。' },
  { id: 'gentle', title: '温柔 / 柔和', desc: '照顾情绪但不客服', prompt: '你温柔柔和，先照顾对方的情绪，但不做客服式讨好，不机械道歉。' },
  { id: 'teasing', title: '损友 / 轻微互怼', desc: '顺手开玩笑', prompt: '你可以像损友一样轻微互怼、顺手开玩笑，但不攻击痛点，对方认真时就收住。' },
];

function normalizeCharacterChatStyle(raw) {
  const d = raw || {};
  const valid = new Set(CHAT_STYLE_OPTIONS.map((o) => o.id));
  const options = Array.isArray(d.options)
    ? Array.from(new Set(d.options.map((x) => String(x)))).filter((x) => valid.has(x))
    : [];
  return { options };
}

function buildChatStylePrompt(style) {
  const options = (style && Array.isArray(style.options)) ? style.options : [];
  const picked = CHAT_STYLE_OPTIONS.filter((o) => options.includes(o.id));
  if (!picked.length) return '';
  return '【说话方式（本轮必须遵守）】\n' + picked.map((o) => '- ' + o.prompt).join('\n');
}

// ---- 角色语言 / 时区 / 距离 ----
const CHARACTER_LANGUAGE_OPTIONS = [
  { id: 'zh', label: '中文' },
  { id: 'ko', label: '韩语' },
  { id: 'en', label: '英语' },
  { id: 'ja', label: '日语' },
];

const CHARACTER_TIMEZONE_OPTIONS = [
  { id: 'Asia/Shanghai', label: '北京时间（UTC+8）' },
  { id: 'Asia/Seoul', label: '首尔（UTC+9）' },
  { id: 'Asia/Tokyo', label: '东京（UTC+9）' },
  { id: 'Asia/Bangkok', label: '曼谷（UTC+7）' },
  { id: 'Europe/London', label: '伦敦（UTC+0）' },
  { id: 'Europe/Paris', label: '巴黎（UTC+1）' },
  { id: 'America/New_York', label: '纽约（UTC-5）' },
  { id: 'America/Los_Angeles', label: '洛杉矶（UTC-8）' },
  { id: 'Australia/Sydney', label: '悉尼（UTC+11）' },
];

const CHARACTER_DISTANCE_OPTIONS = [
  {
    id: 'same-city',
    label: '同城',
    prompt: '你和 user 在同一座城市，见面方便。聊天时可以自然提到附近的店、路和天气；user 不提出见面时，不要强行约见面。',
  },
  {
    id: 'long-distance',
    label: '异地',
    prompt: '你和 user 不在同一座城市，见面不容易。可以提到距离、车票和想见面，但只有 user 主动提出时才可以讨论或答应见面；user 不提出时，不要强行安排见面，也不要假装已经见过面。见面本身有不确定性，不要承诺具体日期。',
  },
  {
    id: 'parallel',
    label: '平行世界',
    prompt: '你和 user 处在平行世界，现实中无法见面。不要提出见面、不要约线下、不要描述已经见面的场景，也不要说「下次去找你」这类话。你们的互动只能发生在聊天和通话里。',
  },
];

function normalizeCharacterLanguage(value) {
  return CHARACTER_LANGUAGE_OPTIONS.some((o) => o.id === value) ? value : 'zh';
}

function normalizeCharacterTimezone(value) {
  return CHARACTER_TIMEZONE_OPTIONS.some((o) => o.id === value) ? value : 'Asia/Shanghai';
}

function normalizeCharacterDistance(value) {
  return CHARACTER_DISTANCE_OPTIONS.some((o) => o.id === value) ? value : 'same-city';
}

// 把语言、时区、距离写进 system，约束聊天与通话
function buildCharacterLocalePrompt(character) {
  if (!character) return '';
  const language = CHARACTER_LANGUAGE_OPTIONS.find((o) => o.id === character.language) || CHARACTER_LANGUAGE_OPTIONS[0];
  const timezone = CHARACTER_TIMEZONE_OPTIONS.find((o) => o.id === character.timezone) || CHARACTER_TIMEZONE_OPTIONS[0];
  const distance = CHARACTER_DISTANCE_OPTIONS.find((o) => o.id === character.distance) || CHARACTER_DISTANCE_OPTIONS[0];

  let localTime = '';
  try {
    const now = new Date();
    const date = new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone.id, month: '2-digit', day: '2-digit',
    }).format(now);
    const time = new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone.id, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(now);
    localTime = date + ' ' + time;
  } catch (_) { localTime = ''; }

  return [
    '【语言与时区（本轮必须遵守）】',
    '- 你平时说' + language.label + '。回复必须用' + language.label + '，不要因为 user 用什么语言就跟着切换；只有 user 明确要求换语言时才换。',
    '- 你所在时区：' + timezone.label + (localTime ? '，当地时间 ' + localTime : '') + '。作息、问候和节日都按这个时间走。',
    '【你和 user 的距离】',
    '- ' + distance.prompt,
  ].join('\n');
}

// 双语输出：仅非中文角色启用，原文在前、简体中文译文在后，用单个竖线分隔
function buildCharacterBilingualPrompt(character) {
  if (!character) return '';
  const language = normalizeCharacterLanguage(character.language);
  if (language === 'zh') return '';
  return [
    '【双语输出规则（仅非中文角色使用，中文角色忽略此规则)】',
    '**双语输出作用范围**：聊天消息正文、[语音条:...]中的语音内容文字、[引用:原文片段]后面的回复内容、[内心]...[/内心]中的内心想法。当本轮回复使用非中文语言时，以上内容必须使用“原文|对应的简体中文译文”的格式输出',
    '**格式要求**：',
    '- 原文在前，简体中文译文在后，中间只使用一个竖线 |',
    '- 如果内容本来就是中文，则不要添加 |译文',
    '- 不要改动原有富媒体指令格式，只在其中的文本内容内部追加 |中文译文',
    '- [引用:...] 中引用锚点(引用原文）保持原格式，不需要翻译；只翻译其后的回复内容',
  ].join('\n');
}

function normalizeCharacter(raw, fallbackId) {
  if (!raw) return null;
  return {
    id: raw.id || fallbackId || genId(),
    name: String(raw.name || '').trim(),
    remark: String(raw.remark || '').trim(),
    persona: String(raw.persona || ''),
    avatarId: raw.avatarId || null,
    personaImageId: raw.personaImageId || null,
    voice: normalizeCharacterVoice(raw.voice),
    image: normalizeCharacterImage(raw.image),
    chatStyle: normalizeCharacterChatStyle(raw.chatStyle),
    language: normalizeCharacterLanguage(raw.language),
    timezone: normalizeCharacterTimezone(raw.timezone),
    distance: normalizeCharacterDistance(raw.distance),
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

async function addCharacter({ name, remark, persona, voice, image, language, timezone, distance } = {}) {
  const record = normalizeCharacter({ name, remark, persona, avatarId: null, voice, image, language, timezone, distance });
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
    if (patch.remark !== undefined) c.remark = String(patch.remark || '').trim();
    if (patch.persona !== undefined) c.persona = String(patch.persona || '');
    if (patch.avatarId !== undefined) c.avatarId = patch.avatarId || null;
    if (patch.personaImageId !== undefined) c.personaImageId = patch.personaImageId || null;
    if (patch.voice !== undefined) c.voice = normalizeCharacterVoice(Object.assign({}, c.voice, patch.voice));
    if (patch.image !== undefined) c.image = normalizeCharacterImage(Object.assign({}, c.image, patch.image));
    if (patch.chatStyle !== undefined) c.chatStyle = normalizeCharacterChatStyle(patch.chatStyle);
    if (patch.language !== undefined) c.language = normalizeCharacterLanguage(patch.language);
    if (patch.timezone !== undefined) c.timezone = normalizeCharacterTimezone(patch.timezone);
    if (patch.distance !== undefined) c.distance = normalizeCharacterDistance(patch.distance);
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

// 角色人设大图：单独一个 Blob 字段，缺省时由界面回退到头像
async function setCharacterPersonaImage(characterId, blob, type, name) {
  const c = await getCharacter(characterId);
  if (!c) throw new Error('角色不存在');
  const oldId = c.personaImageId;
  const id = genId();
  await putFile({ id, name: name || 'persona', type: type || (blob && blob.type) || 'image/jpeg', blob });
  await updateCharacterRecord(characterId, { personaImageId: id });
  if (oldId) {
    revokeAvatarUrl(oldId);
    try { await deleteFile(oldId); } catch (_) {}
  }
  return id;
}

async function clearCharacterPersonaImage(characterId) {
  const c = await getCharacter(characterId);
  if (!c) return;
  const oldId = c.personaImageId;
  await updateCharacterRecord(characterId, { personaImageId: null });
  if (oldId) {
    revokeAvatarUrl(oldId);
    try { await deleteFile(oldId); } catch (_) {}
  }
}

async function getCharacterPersonaImageUrl(characterId) {
  const c = await getCharacter(characterId);
  return c && c.personaImageId ? getAvatarUrlById(c.personaImageId) : '';
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
  if (c.personaImageId) {
    revokeAvatarUrl(c.personaImageId);
    try { await deleteFile(c.personaImageId); } catch (_) {}
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
  try { await deleteDoc(diaryDocId(id)); } catch (_) {}
  try { await deleteDoc(scheduleDocId(id)); } catch (_) {}

  // 论坛里解绑该角色；已发布的帖子保留作者名快照，避免内容凭空消失
  try {
    await mutateForum((doc) => {
      if (doc.settings && Array.isArray(doc.settings.characterIds)) {
        doc.settings.characterIds = doc.settings.characterIds.filter((x) => x !== id);
      }
    });
  } catch (_) {}

  // 邮箱里解绑该角色；历史邮件保留角色名快照
  try {
    await mutateEmail((doc) => {
      doc.settings.characterIds = doc.settings.characterIds.filter((x) => x !== id);
      doc.pending = doc.pending.filter((x) => x.characterId !== id);
    });
  } catch (_) {}

  // 动态里解绑该角色；已发布的动态保留作者名快照
  try {
    await mutateMoments((doc) => {
      doc.settings.characterIds = doc.settings.characterIds.filter((x) => x !== id);
      delete doc.settings.lastPostAt[id];
    });
  } catch (_) {}

  // 群聊里移除该成员；群聊消息保留名字快照
  try {
    await mutateDoc(DOC_GROUPS, (doc) => {
      if (!Array.isArray(doc.list)) doc.list = [];
      doc.list.forEach((g) => {
        if (Array.isArray(g.memberIds)) g.memberIds = g.memberIds.filter((x) => x !== id);
      });
    });
  } catch (_) {}

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

// ---------- 我（用户人设，可保存多套） ----------
// 存在 userProfiles 文档：{ list: [{ id, name, persona }], activeId }
// 当前人设由 app.js 注入聊天 system，让角色知道「我」是谁。
function normalizeUserProfile(raw) {
  if (!raw) return null;
  return {
    id: raw.id || genId(),
    name: String(raw.name || '').trim(),
    persona: String(raw.persona || ''),
    avatarId: raw.avatarId || null,
    createdAt: raw.createdAt || Date.now(),
    updatedAt: raw.updatedAt || Date.now(),
  };
}

async function getUserProfiles() {
  const doc = await getDoc(DOC_USER_PROFILES);
  const list = (doc && Array.isArray(doc.list))
    ? doc.list.map((p) => normalizeUserProfile(p)).filter(Boolean)
    : [];
  let activeId = (doc && doc.activeId) || null;
  if (!list.some((p) => p.id === activeId)) activeId = list.length ? list[0].id : null;
  return { list, activeId };
}

async function getActiveUserProfile() {
  const { list, activeId } = await getUserProfiles();
  return list.find((p) => p.id === activeId) || null;
}

async function addUserProfile({ name, persona } = {}) {
  const record = normalizeUserProfile({ name, persona });
  await mutateDoc(DOC_USER_PROFILES, (doc) => {
    if (!Array.isArray(doc.list)) doc.list = [];
    doc.list.push(record);
    if (!doc.activeId) doc.activeId = record.id;
  });
  return record;
}

async function updateUserProfile(id, patch) {
  await mutateDoc(DOC_USER_PROFILES, (doc) => {
    if (!Array.isArray(doc.list)) doc.list = [];
    const p = doc.list.find((x) => x.id === id);
    if (!p) return;
    if (patch.name !== undefined) p.name = String(patch.name || '').trim();
    if (patch.persona !== undefined) p.persona = String(patch.persona || '');
    if (patch.avatarId !== undefined) p.avatarId = patch.avatarId || null;
    p.updatedAt = Date.now();
  });
}

// 「我」的头像：存 files，人设记录只留 avatarId
async function setUserProfileAvatar(id, blob, type, name) {
  if (!blob) throw new Error('缺少图片文件');
  const { list } = await getUserProfiles();
  const profile = list.find((p) => p.id === id);
  if (!profile) throw new Error('人设不存在');
  const oldId = profile.avatarId;
  const fileId = genId();
  await putFile({ id: fileId, name: name || 'user-avatar', type: type || blob.type || 'image/jpeg', blob });
  await updateUserProfile(id, { avatarId: fileId });
  if (oldId) {
    revokeAvatarUrl(oldId);
    try { await deleteFile(oldId); } catch (_) {}
  }
  return fileId;
}

async function clearUserProfileAvatar(id) {
  const { list } = await getUserProfiles();
  const profile = list.find((p) => p.id === id);
  if (!profile || !profile.avatarId) return;
  const oldId = profile.avatarId;
  await updateUserProfile(id, { avatarId: null });
  revokeAvatarUrl(oldId);
  try { await deleteFile(oldId); } catch (_) {}
}

async function setActiveUserProfile(id) {
  await mutateDoc(DOC_USER_PROFILES, (doc) => {
    if (!Array.isArray(doc.list)) doc.list = [];
    if (doc.list.some((p) => p.id === id)) doc.activeId = id;
  });
}

async function deleteUserProfile(id) {
  let avatarId = null;
  await mutateDoc(DOC_USER_PROFILES, (doc) => {
    if (!Array.isArray(doc.list)) doc.list = [];
    const target = doc.list.find((p) => p.id === id);
    if (target) avatarId = target.avatarId || null;
    doc.list = doc.list.filter((p) => p.id !== id);
    if (doc.activeId === id || !doc.list.some((p) => p.id === doc.activeId)) {
      doc.activeId = doc.list.length ? doc.list[0].id : null;
    }
  });
  if (avatarId) {
    revokeAvatarUrl(avatarId);
    try { await deleteFile(avatarId); } catch (_) {}
  }
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
  if (!id) return { entries: [], longTerm: [], core: [], lastSummarizedCount: 0, longTermSourceCount: 0, coreSourceCount: 0 };
  const doc = await getDoc(memoryDocId(id));
  const entries = (doc && Array.isArray(doc.entries)) ? doc.entries : [];
  const longTerm = (doc && Array.isArray(doc.longTerm)) ? doc.longTerm : [];
  return {
    entries,
    longTerm,
    core: (doc && Array.isArray(doc.core)) ? doc.core : [],
    lastSummarizedCount: (doc && typeof doc.lastSummarizedCount === 'number') ? doc.lastSummarizedCount : 0,
    longTermSourceCount: Math.min((doc && typeof doc.longTermSourceCount === 'number') ? doc.longTermSourceCount : 0, entries.length),
    coreSourceCount: Math.min((doc && typeof doc.coreSourceCount === 'number') ? doc.coreSourceCount : 0, longTerm.length),
    vecModel: (doc && typeof doc.vecModel === 'string') ? doc.vecModel : '',
  };
}

async function mutateMemory(mutator, characterId) {
  const id = characterId || await getActiveCharacterId();
  if (!id) throw new Error('请先创建角色');
  return mutateDoc(memoryDocId(id), (doc) => {
    if (!Array.isArray(doc.entries)) doc.entries = [];
    if (!Array.isArray(doc.longTerm)) doc.longTerm = [];
    if (!Array.isArray(doc.core)) doc.core = [];
    if (typeof doc.lastSummarizedCount !== 'number') doc.lastSummarizedCount = 0;
    if (typeof doc.longTermSourceCount !== 'number') doc.longTermSourceCount = 0;
    if (typeof doc.coreSourceCount !== 'number') doc.coreSourceCount = 0;
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
    if (text !== undefined) {
      e.text = (text || '').trim();
      delete e.vec; // 内容变了，旧向量作废，等下次补建
    }
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

// ---------- 长期记忆 / 核心记忆 ----------
// 长期记忆：每 30 条短期记忆总结一条；核心记忆：每 5 条长期记忆总结一条。
async function addLongTermMemory({ text, count }, characterId) {
  const value = String(text || '').trim();
  if (!value) return null;
  const record = { id: genId(), text: value, count: Number(count) || 0, createdAt: Date.now() };
  await mutateMemory((doc) => doc.longTerm.push(record), characterId);
  return record;
}

async function addCoreMemory({ text }, characterId) {
  const value = String(text || '').trim();
  if (!value) return null;
  const record = { id: genId(), text: value, createdAt: Date.now() };
  await mutateMemory((doc) => doc.core.push(record), characterId);
  return record;
}

async function deleteLongTermMemory(id, characterId) {
  await mutateMemory((doc) => {
    doc.longTerm = doc.longTerm.filter((x) => x.id !== id);
  }, characterId);
}

async function deleteCoreMemory(id, characterId) {
  await mutateMemory((doc) => {
    doc.core = doc.core.filter((x) => x.id !== id);
  }, characterId);
}

async function setMemoryTierCounts(patch, characterId) {
  await mutateMemory((doc) => {
    if (patch.longTermSourceCount !== undefined) doc.longTermSourceCount = Math.max(0, Number(patch.longTermSourceCount) || 0);
    if (patch.coreSourceCount !== undefined) doc.coreSourceCount = Math.max(0, Number(patch.coreSourceCount) || 0);
  }, characterId);
}

// ---------- 向量记忆（语义索引） ----------
// 每条记忆的向量存在记录自身的 vec 字段；vecModel 记录生成向量用的模型，
// 换了 embedding 模型后旧向量会被整体重建，避免不同模型的空间混用。
async function saveMemoryVectors(model, pairs, characterId) {
  const list = (Array.isArray(pairs) ? pairs : []).filter((p) => p && p.id && Array.isArray(p.vec) && p.vec.length);
  if (!list.length) return;
  await mutateMemory((doc) => {
    if (model) doc.vecModel = model;
    const byId = new Map(list.map((p) => [p.id, p.vec]));
    ['entries', 'longTerm', 'core'].forEach((key) => {
      (doc[key] || []).forEach((record) => {
        const vec = byId.get(record.id);
        if (vec) record.vec = vec;
      });
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
  const cfSettings = getCfSettings();
  const autopush = getAutopushSettings();
  const { list, activeId } = await getCharacters();
  const userProfiles = await getUserProfiles();
  const files = {};
  const characters = [];
  const chats = {};
  const directives = {};
  const stickers = {};
  const memories = {};
  const diaries = {};
  const schedules = {};
  const groups = await getGroups();
  const groupChats = {};
  for (const g of groups) groupChats[g.id] = await getGroupHistory(g.id);

  for (const c of list) {
    const chatDoc = (await getDoc(chatDocId(c.id))) || {};
    const messages = Array.isArray(chatDoc.messages) ? chatDoc.messages : [];
    const fileIds = [c.avatarId, c.personaImageId, c.image && c.image.referenceImageId].filter(Boolean);
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
      remark: c.remark,
      persona: c.persona,
      avatarId: c.avatarId || null,
      personaImageId: c.personaImageId || null,
      voice: c.voice,
      image: c.image,
      chatStyle: c.chatStyle,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    });

    chats[c.id] = messages;
    directives[c.id] = chatDoc.directive || '';
    stickers[c.id] = await getStickers(c.id);
    diaries[c.id] = await getDiary(c.id);
    schedules[c.id] = await getSchedule(c.id);
    const memDoc = (await getDoc(memoryDocId(c.id))) || {};
    memories[c.id] = {
      entries: Array.isArray(memDoc.entries) ? memDoc.entries : [],
      longTerm: Array.isArray(memDoc.longTerm) ? memDoc.longTerm : [],
      core: Array.isArray(memDoc.core) ? memDoc.core : [],
      lastSummarizedCount: memDoc.lastSummarizedCount || 0,
      longTermSourceCount: memDoc.longTermSourceCount || 0,
      coreSourceCount: memDoc.coreSourceCount || 0,
    };
  }

  const wbDoc = (await getDoc(DOC_WORLDBOOK)) || {};
  const appearance = await getAppearance();
  const notification = await getNotificationConfig();
  const forum = await getForum();
  const moments = await getMoments();
  const email = await getEmail();
  const books = await getBooksBackup();
  const music = await getMusicLibrary();
  const appearanceFileIds = [
    appearance.wallpaperId,
    appearance.fontFileId,
    appearance.chatBgImageId,
    ...Object.values(appearance.icons),
    ...Object.values(appearance.widgets),
    notification.soundId,
    forum.profile.avatarId,
    forum.profile.coverId,
    moments.profile.coverId,
    ...(userProfiles.list || []).map((p) => p.avatarId),
    ...moments.posts.map((p) => p.imageId),
    ...music.tracks.map((t) => t.fileId),
  ].filter(Boolean);
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
    cfSettings,
    autopush,
    appearance,
    notification,
    forum,
    moments,
    email,
    books,
    music,
    characters,
    activeId,
    userProfiles,
    chats,
    directives,
    stickers,
    memories,
    diaries,
    schedules,
    groups,
    groupChats,
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
  setCfSettings(data.cfSettings || {});
  setAutopushSettings(data.autopush || {});

  // 统一成多角色结构；同时兼容旧版（version 1）单角色备份
  let characters;
  let activeId;
  let chats;
  let memories;
  let directives = {};
  let stickers = {};
  const diaries = data.diaries || {};
  const schedules = data.schedules || {};
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
  // 「我」的人设：旧备份没有这一项时按空列表处理
  const userProfiles = data.userProfiles || {};
  const userProfileList = (Array.isArray(userProfiles.list) ? userProfiles.list : [])
    .map((p) => normalizeUserProfile(p)).filter(Boolean);
  let activeUserProfileId = userProfiles.activeId || null;
  if (!userProfileList.some((p) => p.id === activeUserProfileId)) {
    activeUserProfileId = userProfileList[0] ? userProfileList[0].id : null;
  }
  await putDoc({ id: DOC_USER_PROFILES, list: userProfileList, activeId: activeUserProfileId });
  const appearance = normalizeAppearance(data.appearance);
  await putDoc({
    id: DOC_APPEARANCE,
    wallpaperId: appearance.wallpaperId,
    wallpaperFit: appearance.wallpaperFit,
    icons: appearance.icons,
    widgets: appearance.widgets,
    homeItems: appearance.homeItems,
    statusBar: appearance.statusBar,
    bubbleColor: appearance.bubbleColor,
    fontColor: appearance.fontColor,
    fontFamily: appearance.fontFamily,
    fontFileId: appearance.fontFileId,
    fontFileName: appearance.fontFileName,
    chatCss: appearance.chatCss,
    chatBgColor: appearance.chatBgColor,
    chatBgImageId: appearance.chatBgImageId,
  });
  const notification = normalizeNotification(data.notification);
  await putDoc({
    id: DOC_NOTIFICATION,
    enabled: notification.enabled,
    keepAlive: notification.keepAlive,
    soundId: notification.soundId,
    soundName: notification.soundName,
    soundType: notification.soundType,
    mode: notification.mode,
    wxpusher: notification.wxpusher,
  });
  const forum = normalizeForum(data.forum);
  await putDoc({
    id: DOC_FORUM,
    settings: forum.settings,
    boards: forum.boards,
    activeBoardId: forum.activeBoardId,
    profile: forum.profile,
    posts: forum.posts,
  });
  const moments = normalizeMoments(data.moments);
  await putDoc({
    id: DOC_MOMENTS,
    settings: moments.settings,
    profile: moments.profile,
    posts: moments.posts,
  });
  const email = normalizeEmail(data.email);
  await putDoc({
    id: DOC_EMAIL,
    settings: email.settings,
    mails: email.mails,
    pending: email.pending,
  });
  await applyBooksBackup(data.books);
  const music = normalizeMusic(data.music);
  await putDoc({ id: DOC_MUSIC, tracks: music.tracks });
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
      longTerm: Array.isArray(mem.longTerm) ? mem.longTerm : [],
      core: Array.isArray(mem.core) ? mem.core : [],
      lastSummarizedCount: mem.lastSummarizedCount || 0,
      longTermSourceCount: mem.longTermSourceCount || 0,
      coreSourceCount: mem.coreSourceCount || 0,
    });
    const diary = normalizeDiaryDoc(diaries[c.id]);
    await putDoc({
      id: diaryDocId(c.id),
      enabled: diary.enabled,
      time: diary.time,
      lastWrittenDate: diary.lastWrittenDate,
      entries: diary.entries,
    });
    const schedule = normalizeScheduleDoc(schedules[c.id]);
    await putDoc({
      id: scheduleDocId(c.id),
      enabled: schedule.enabled,
      time: schedule.time,
      lastRunDate: schedule.lastRunDate,
      date: schedule.date,
      items: schedule.items,
      updatedAt: schedule.updatedAt,
    });
  }

  const wb = data.worldbook || {};
  const groupList = (Array.isArray(data.groups) ? data.groups : []).map(normalizeGroup).filter(Boolean);
  await putDoc({ id: DOC_GROUPS, list: groupList });
  const groupChats = data.groupChats || {};
  for (const g of groupList) {
    await putDoc({
      id: groupChatDocId(g.id),
      messages: Array.isArray(groupChats[g.id]) ? groupChats[g.id] : [],
    });
  }

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

// 一键还原：删除整个本地数据库，并清空本机保存的接口配置等设置
async function resetAllData() {
  revokeAllFileUrls();
  try {
    if (_dbPromise) {
      const db = await _dbPromise.catch(() => null);
      if (db && typeof db.close === 'function') db.close();
    }
  } catch (_) {}
  _dbPromise = null;

  if (typeof indexedDB !== 'undefined') {
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(friendlyError(req.error));
      req.onblocked = () => reject(new Error('还有别的页面占用着数据，关掉后再试'));
    });
  }

  try { localStorage.clear(); } catch (_) {}
}
