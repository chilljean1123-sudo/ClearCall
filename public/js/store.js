// ===== 数据存取层 =====
// 只负责 localStorage 的读写，不碰 DOM、不发请求。
// 供 app.js（编排）与 ui.js（渲染）调用。

const KEYS = {
  baseUrl: 'clearcall.baseUrl',
  apiKey: 'clearcall.apiKey',
  model: 'clearcall.model',
  modelMode: 'clearcall.modelMode',
};

const CHAT_KEYS = {
  name: 'clearcall.charName',
  avatar: 'clearcall.charAvatar',
  persona: 'clearcall.charPersona',
  history: 'clearcall.chatHistory',
};

const TRIGGER_KEYS = {
  instant: 'clearcall.trigger.instant',
  batch: 'clearcall.trigger.batch',
  countdown: 'clearcall.trigger.countdown',
  countdownSec: 'clearcall.trigger.countdownSec',
};

// ---- AI 接口设置 ----
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

// ---- 角色 ----
function getChar() {
  return {
    name: localStorage.getItem(CHAT_KEYS.name) || '',
    avatar: localStorage.getItem(CHAT_KEYS.avatar) || '',
    persona: localStorage.getItem(CHAT_KEYS.persona) || '',
  };
}

function setCharName(name) { localStorage.setItem(CHAT_KEYS.name, name || ''); }
function setCharPersona(persona) { localStorage.setItem(CHAT_KEYS.persona, persona || ''); }
function setCharAvatar(dataUrl) { localStorage.setItem(CHAT_KEYS.avatar, dataUrl); }
function clearCharAvatar() { localStorage.removeItem(CHAT_KEYS.avatar); }

// ---- 聊天记录 ----
function getHistory() {
  try {
    const arr = JSON.parse(localStorage.getItem(CHAT_KEYS.history) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}

function setHistory(arr) {
  localStorage.setItem(CHAT_KEYS.history, JSON.stringify(arr));
}

// ---- 回复触发模式 ----
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
