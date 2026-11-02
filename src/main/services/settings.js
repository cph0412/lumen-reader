'use strict';

// settings.js — 设置服务
// - 深合并默认值，写入时做类型/范围归一化
// - API Key 加密后存 ai.apiKeyEnc（secret 由主进程注入 safeStorage 编解码器）
// - get() 脱敏为 hasApiKey / keyHint；getRaw() 含明文 apiKey，仅主进程使用

const path = require('node:path');
const { createJsonStore } = require('./store');

const DEFAULT_SETTINGS = {
  ai: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.7,
  },
  translation: { provider: 'auto', target: 'zh-CN' },
  reader: {
    theme: 'paper',
    fontSize: 19,
    lineHeight: 1.9,
    fontFamily: 'serif',
    contentWidth: 700,
    letterSpacing: 0,
    justify: false,
    highlightVocab: true,
    autoTranslate: true,
    autoAnalyze: true,
  },
  general: {
    hotkey: 'Alt+Shift+D',
    minimizeToTray: true,
    dailyGoalMinutes: 30,
  },
};

const THEMES = ['paper', 'sepia', 'dark'];
const PROVIDERS = ['auto', 'free', 'ai'];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return patch === undefined ? clone(base) : clone(patch);
  const output = isPlainObject(base) ? clone(base) : {};
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === undefined) continue;
    output[key] = isPlainObject(value) && isPlainObject(output[key]) ? deepMerge(output[key], value) : clone(value);
  }
  return output;
}

function asString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asNumber(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function asBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitize(input) {
  const source = isPlainObject(input) ? input : {};
  const ai = isPlainObject(source.ai) ? source.ai : {};
  const translation = isPlainObject(source.translation) ? source.translation : {};
  const reader = isPlainObject(source.reader) ? source.reader : {};
  const general = isPlainObject(source.general) ? source.general : {};

  return {
    ai: {
      baseUrl: asString(ai.baseUrl, DEFAULT_SETTINGS.ai.baseUrl).replace(/\/+$/, ''),
      model: asString(ai.model, DEFAULT_SETTINGS.ai.model),
      temperature: asNumber(ai.temperature, DEFAULT_SETTINGS.ai.temperature, 0, 2),
    },
    translation: {
      provider: PROVIDERS.indexOf(translation.provider) === -1 ? DEFAULT_SETTINGS.translation.provider : translation.provider,
      target: asString(translation.target, DEFAULT_SETTINGS.translation.target),
    },
    reader: {
      theme: THEMES.indexOf(reader.theme) === -1 ? DEFAULT_SETTINGS.reader.theme : reader.theme,
      fontSize: Math.round(asNumber(reader.fontSize, DEFAULT_SETTINGS.reader.fontSize, 12, 40)),
      lineHeight: Math.round(asNumber(reader.lineHeight, DEFAULT_SETTINGS.reader.lineHeight, 1.2, 2.8) * 10) / 10,
      fontFamily: reader.fontFamily === 'sans' ? 'sans' : 'serif',
      contentWidth: Math.round(asNumber(reader.contentWidth, DEFAULT_SETTINGS.reader.contentWidth, 520, 1000)),
      letterSpacing: Math.round(asNumber(reader.letterSpacing, DEFAULT_SETTINGS.reader.letterSpacing, -1, 3) * 10) / 10,
      justify: asBoolean(reader.justify, DEFAULT_SETTINGS.reader.justify),
      highlightVocab: asBoolean(reader.highlightVocab, DEFAULT_SETTINGS.reader.highlightVocab),
      autoTranslate: asBoolean(reader.autoTranslate, DEFAULT_SETTINGS.reader.autoTranslate),
      autoAnalyze: asBoolean(reader.autoAnalyze, DEFAULT_SETTINGS.reader.autoAnalyze),
    },
    general: {
      hotkey: asString(general.hotkey, DEFAULT_SETTINGS.general.hotkey),
      minimizeToTray: asBoolean(general.minimizeToTray, DEFAULT_SETTINGS.general.minimizeToTray),
      dailyGoalMinutes: Math.round(asNumber(general.dailyGoalMinutes, DEFAULT_SETTINGS.general.dailyGoalMinutes, 1, 480)),
    },
  };
}

function isLocalBaseUrl(baseUrl) {
  try {
    const host = new URL(String(baseUrl || '')).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host.endsWith('.localhost');
  } catch (err) {
    return false;
  }
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '********';
  return key.slice(0, 3) + '****' + key.slice(-4);
}

function createSettingsService(options) {
  const opts = options || {};
  const dataDir = opts.dataDir;
  if (!dataDir) throw new TypeError('createSettingsService 需要 dataDir');
  const secret = opts.secret && typeof opts.secret === 'object' ? opts.secret : null;
  const store = opts.store || createJsonStore({
    filePath: path.join(dataDir, 'settings.json'),
    defaults: function () { return {}; },
  });

  function readStored() {
    const data = store.read();
    return isPlainObject(data) ? data : {};
  }

  function encryptKey(plain) {
    if (!plain) return '';
    if (secret && typeof secret.encrypt === 'function') {
      try {
        const encrypted = secret.encrypt(plain);
        if (Buffer.isBuffer(encrypted)) return 'encb64:' + encrypted.toString('base64');
        if (typeof encrypted === 'string' && encrypted) {
          // 主进程 secret 可能已自行带上 enc:/encb64:/b64: 前缀，避免重复包裹
          if (/^(?:enc|encb64|b64):/.test(encrypted)) return encrypted;
          return 'enc:' + encrypted;
        }
      } catch (err) {
        // 加密不可用时退回本地混淆，至少不落明文
      }
    }
    return 'b64:' + Buffer.from(plain, 'utf8').toString('base64');
  }

  function decryptKey(stored) {
    if (typeof stored !== 'string' || !stored) return '';
    if (stored.indexOf('b64:') === 0) {
      return Buffer.from(stored.slice(4), 'base64').toString('utf8');
    }
    if (stored.indexOf('encb64:') === 0) {
      if (!secret || typeof secret.decrypt !== 'function') return '';
      const raw = Buffer.from(stored.slice(7), 'base64');
      try {
        const out = secret.decrypt(raw);
        return typeof out === 'string' ? out : String(out || '');
      } catch (err) {
        try {
          const out = secret.decrypt(raw.toString('base64'));
          return typeof out === 'string' ? out : String(out || '');
        } catch (secondError) {
          return '';
        }
      }
    }
    if (secret && typeof secret.decrypt === 'function') {
      // 主进程注入的编码器可能是「带前缀完整值」风格（如 'enc:...'），
      // 也可能只接收裸密文，这里两种都尝试。
      let full = null;
      try { full = secret.decrypt(stored); } catch (err) { full = null; }
      if (typeof full === 'string' && full && full !== stored) return full;
      if (stored.indexOf('enc:') === 0) {
        try {
          const out = secret.decrypt(stored.slice(4));
          if (typeof out === 'string' && out) return out;
        } catch (err) { /* 忽略 */ }
      }
      return typeof full === 'string' ? full : '';
    }
    if (stored.indexOf('enc:') === 0) return ''; // 没有 secret 无法解密
    return stored; // 旧版本明文
  }

  function storedKey(stored) {
    const ai = isPlainObject(stored.ai) ? stored.ai : {};
    const decrypted = decryptKey(ai.apiKeyEnc);
    if (decrypted) return decrypted;
    return typeof ai.apiKey === 'string' ? ai.apiKey : '';
  }

  function get() {
    const stored = readStored();
    const clean = sanitize(stored);
    const key = storedKey(stored);
    const local = isLocalBaseUrl(clean.ai.baseUrl);
    return {
      ai: {
        baseUrl: clean.ai.baseUrl,
        model: clean.ai.model,
        temperature: clean.ai.temperature,
        hasApiKey: Boolean(key),
        local,
        available: Boolean(key) || local,
        keyHint: maskKey(key),
      },
      translation: clean.translation,
      reader: clean.reader,
      general: clean.general,
    };
  }

  function getRaw() {
    const stored = readStored();
    const clean = sanitize(stored);
    return {
      ai: {
        baseUrl: clean.ai.baseUrl,
        model: clean.ai.model,
        temperature: clean.ai.temperature,
        apiKey: storedKey(stored),
        local: isLocalBaseUrl(clean.ai.baseUrl),
        available: Boolean(storedKey(stored)) || isLocalBaseUrl(clean.ai.baseUrl),
      },
      translation: clean.translation,
      reader: clean.reader,
      general: clean.general,
    };
  }

  function save(patch) {
    const incoming = isPlainObject(patch) ? patch : {};
    const stored = readStored();
    const current = sanitize(stored);
    const aiPatch = isPlainObject(incoming.ai) ? incoming.ai : {};

    const merged = sanitize({
      ai: Object.assign({}, current.ai, {
        baseUrl: aiPatch.baseUrl === undefined ? current.ai.baseUrl : aiPatch.baseUrl,
        model: aiPatch.model === undefined ? current.ai.model : aiPatch.model,
        temperature: aiPatch.temperature === undefined ? current.ai.temperature : aiPatch.temperature,
      }),
      translation: deepMerge(current.translation, incoming.translation || {}),
      reader: deepMerge(current.reader, incoming.reader || {}),
      general: deepMerge(current.general, incoming.general || {}),
    });

    const next = { ai: merged.ai, translation: merged.translation, reader: merged.reader, general: merged.general };
    const existing = isPlainObject(stored.ai) ? stored.ai : {};
    const clearRequested = aiPatch.clearApiKey === true || incoming.clearApiKey === true;
    const plainKey = typeof aiPatch.apiKey === 'string' ? aiPatch.apiKey.trim() : '';

    if (clearRequested) {
      // 明确清除
    } else if (plainKey) {
      next.ai.apiKeyEnc = encryptKey(plainKey);
    } else if (typeof existing.apiKeyEnc === 'string' && existing.apiKeyEnc) {
      next.ai.apiKeyEnc = existing.apiKeyEnc;
    } else if (typeof existing.apiKey === 'string' && existing.apiKey) {
      // 迁移旧版本明文
      next.ai.apiKeyEnc = encryptKey(existing.apiKey);
    }

    store.write(next);
    return get();
  }

  return {
    get: get,
    getRaw: getRaw,
    save: save,
    dataDir: dataDir,
    defaults: function () { return clone(DEFAULT_SETTINGS); },
  };
}

module.exports = { createSettingsService, DEFAULT_SETTINGS, deepMerge, sanitize };
