/**
 * Lumen · 流明阅读 — 设置页面模块（#/settings）
 * 契约：export async function render(root, ctx)
 *
 * 数据：api.settings.get / save / testAI / exportData / importData，api.app.info / openDataFolder
 * 行为：所有修改防抖 400ms 保存；主题即时生效；API Key 留空不修改，可单独清除。
 */

const FALLBACK_ICONS = {
  sparkles: '<path d="m12 4 1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4z"/><path d="M18 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8m-3 3 3 3m-6 0 2 2"/>',
  eye: '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.6"/>',
  eyeOff: '<path d="M4 4l16 16"/><path d="M9.5 5.4A9.9 9.9 0 0 1 12 5c6 0 9.5 7 9.5 7a16 16 0 0 1-3 3.7"/><path d="M6.4 7.9A16.5 16.5 0 0 0 2.5 12S6 19 12 19a9.8 9.8 0 0 0 3.1-.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 13 4 4L19 7"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/>',
  info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.6-.2-1-.6-1.4-.4-.4-.6-.9-.6-1.4 0-1.1.9-2 2-2h2.1A4.1 4.1 0 0 0 21 10.1C21 6.1 17 3 12 3z"/><circle cx="7.5" cy="10" r="1.2"/><circle cx="11" cy="7" r="1.2"/><circle cx="15" cy="9" r="1.2"/>',
  type: '<path d="M4 6h16M12 6v14M8 20h8"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
  download: '<path d="M12 4v11m0 0 4-4m-4 4-4-4"/><path d="M5 19h14"/>',
  upload: '<path d="M12 20V9m0 0-4 4m4-4 4 4"/><path d="M5 5h14"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5"/>',
  dot: '<circle cx="12" cy="12" r="3"/>'
};

const DEFAULT_SETTINGS = {
  ai: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hasApiKey: false, keyHint: '', temperature: 0.3, local: false, available: false },
  translation: { provider: 'auto', target: 'zh-CN' },
  dictionary: { provider: 'auto', oxfordAppId: '', hasOxfordAppKey: false, oxfordKeyHint: '' },
  reader: {
    theme: 'paper',
    fontSize: 19,
    lineHeight: 1.8,
    fontFamily: 'serif',
    contentWidth: 720,
    letterSpacing: 0,
    justify: false,
    highlightVocab: true,
    autoTranslate: true,
    autoAnalyze: true
  },
  general: { hotkey: 'Alt+Shift+D', minimizeToTray: true, dailyGoalMinutes: 30 }
};

const PROVIDERS = [
  { value: 'auto', title: '自动', desc: '优先 AI，失败时回退免费翻译' },
  { value: 'free', title: '免费翻译', desc: 'Google / MyMemory，无需 API Key' },
  { value: 'ai', title: '只用 AI', desc: '使用上面的 AI 接口，需配置 Key' }
];

const DICTIONARY_PROVIDERS = [
  { value: 'auto', title: '自动', desc: '内置优先，未收录再联网' },
  { value: 'free', title: '开放词典', desc: '内置优先，未收录用 dictionaryapi.dev' },
  { value: 'oxford', title: '牛津 API', desc: '牛津优先，需自己的 App ID / Key' }
];

const THEMES = [
  { value: 'paper', title: '纸白' },
  { value: 'sepia', title: '米黄' },
  { value: 'dark', title: '暗色' }
];

const SLIDERS = [
  { key: 'fontSize', label: '字号', min: 15, max: 26, step: 1, unit: 'px', format: (value) => String(value) },
  { key: 'lineHeight', label: '行高', min: 1.3, max: 2.4, step: 0.1, unit: '×', format: (value) => Number(value).toFixed(1) },
  { key: 'contentWidth', label: '版心宽度', min: 520, max: 960, step: 20, unit: 'px', format: (value) => String(value) },
  { key: 'letterSpacing', label: '字距', min: 0, max: 2, step: 0.1, unit: 'px', format: (value) => Number(value).toFixed(1) }
];

const HOTKEY_PRESETS = ['Alt+Shift+D', 'Ctrl+Shift+D', 'Alt+Shift+L', 'Ctrl+Alt+D'];

const TOGGLES = [
  { id: 'set-justify', section: 'reader', key: 'justify', title: '两端对齐', desc: '让正文左右边缘都齐整，版面更像书页' },
  { id: 'set-highlight-vocab', section: 'reader', key: 'highlightVocab', title: '高亮生词', desc: '在正文中给已收藏的单词加一层柔和底色' }
];

const GENERAL_TOGGLE = {
  id: 'set-minimize-tray', section: 'general', key: 'minimizeToTray',
  title: '关闭窗口时最小化到托盘', desc: '保持全局划词快捷键在后台可用'
};

function icon(ctx, name, size = 18) {
  const fn = ctx && ctx.icons && ctx.icons[name];
  if (typeof fn === 'function') {
    try {
      const svg = fn(size);
      if (svg) return svg;
    } catch (err) { /* 降级 */ }
  }
  const path = FALLBACK_ICONS[name] || FALLBACK_ICONS.dot;
  return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size +
    '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
}

function escapeHtml(ctx, value) {
  if (ctx && typeof ctx.escapeHtml === 'function') {
    try { return ctx.escapeHtml(value == null ? '' : String(value)); } catch (err) { /* noop */ }
  }
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function num(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  return Number.isFinite(Number(fallback)) ? Number(fallback) : 0;
}

function isLocalAiUrl(url) {
  const value = typeof url === 'string' ? url.trim() : '';
  if (!value) return false;
  try {
    const host = new URL(/^https?:\/\//i.test(value) ? value : 'http://' + value).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' ||
      host === '::1' || host === '[::1]' || host.endsWith('.localhost');
  } catch (err) {
    return /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(value);
  }
}

function aiReady(ai) {
  return Boolean(ai && (ai.available || ai.hasApiKey || ai.local));
}

function aiStatusLabel(ai) {
  if (!aiReady(ai)) return '未配置';
  return ai && ai.local ? '本地模型' : '已配置';
}

function dictionaryStatus(dict) {
  if (!dict) return '未配置';
  if (dict.provider === 'free') return '内置 + 开放词典';
  if (dict.provider === 'oxford') return dict.hasOxfordAppKey ? '牛津 API' : '缺少凭证';
  return dict.hasOxfordAppKey ? '自动 · 内置 + 牛津' : '自动 · 内置优先';
}

function dictionaryStatusTone(dict) {
  if (dict && dict.provider === 'oxford' && !dict.hasOxfordAppKey) return ' is-error';
  return ' is-ok';
}

function dictionaryProviderHint(dict) {
  if (!dict) return '';
  if (dict.provider === 'free') {
    return '内置词典优先；未收录时使用开放词典 dictionaryapi.dev。牛津凭证会保存，但不会参与查询。';
  }
  if (dict.provider === 'oxford') {
    return dict.hasOxfordAppKey
      ? '牛津 API 优先；失败时回退内置词典或开放词典。'
      : '已选择牛津 API，但还没有 App Key；查询会回退内置词典或开放词典，请先填写凭证。';
  }
  return dict.hasOxfordAppKey
    ? '内置词典优先；未收录时用牛津 API，再失败回退开放词典。'
    : '内置词典优先；未收录时使用开放词典。填入牛津凭证后，会先查牛津。';
}

function normalizeKey(raw) {
  const key = raw && typeof raw === 'string' ? raw : '';
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  const allowed = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape',
    'Tab', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Space'];
  if (allowed.indexOf(key) >= 0) return key;
  if (/^F\d{1,2}$/.test(key)) return key;
  return '';
}

function deepMerge(target, patch) {
  Object.keys(patch || {}).forEach((key) => {
    const value = patch[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const base = target[key] && typeof target[key] === 'object' && !Array.isArray(target[key]) ? target[key] : {};
      target[key] = deepMerge(base, value);
    } else {
      target[key] = value;
    }
  });
  return target;
}

function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const ai = source.ai || {};
  const translation = source.translation || {};
  const dictionary = source.dictionary || {};
  const reader = source.reader || {};
  const general = source.general || {};
  const baseUrl = typeof ai.baseUrl === 'string' && ai.baseUrl ? ai.baseUrl : DEFAULT_SETTINGS.ai.baseUrl;
  const hasApiKey = Boolean(ai.hasApiKey);
  const local = typeof ai.local === 'boolean' ? ai.local : isLocalAiUrl(baseUrl);
  const available = typeof ai.available === 'boolean' ? ai.available : (hasApiKey || local);
  return {
    ai: {
      baseUrl: baseUrl,
      model: typeof ai.model === 'string' && ai.model ? ai.model : DEFAULT_SETTINGS.ai.model,
      hasApiKey: hasApiKey,
      keyHint: typeof ai.keyHint === 'string' ? ai.keyHint : '',
      temperature: num(ai.temperature, DEFAULT_SETTINGS.ai.temperature),
      local: local,
      available: available
    },
    translation: {
      provider: ['auto', 'free', 'ai'].indexOf(translation.provider) >= 0 ? translation.provider : DEFAULT_SETTINGS.translation.provider,
      target: typeof translation.target === 'string' ? translation.target : DEFAULT_SETTINGS.translation.target
    },
    dictionary: {
      provider: ['auto', 'free', 'oxford'].indexOf(dictionary.provider) >= 0 ? dictionary.provider : DEFAULT_SETTINGS.dictionary.provider,
      oxfordAppId: typeof dictionary.oxfordAppId === 'string' ? dictionary.oxfordAppId : '',
      hasOxfordAppKey: Boolean(dictionary.hasOxfordAppKey),
      oxfordKeyHint: typeof dictionary.oxfordKeyHint === 'string' ? dictionary.oxfordKeyHint : ''
    },
    reader: {
      theme: ['paper', 'sepia', 'dark'].indexOf(reader.theme) >= 0 ? reader.theme : DEFAULT_SETTINGS.reader.theme,
      fontSize: num(reader.fontSize, DEFAULT_SETTINGS.reader.fontSize),
      lineHeight: num(reader.lineHeight, DEFAULT_SETTINGS.reader.lineHeight),
      fontFamily: reader.fontFamily === 'sans' ? 'sans' : 'serif',
      contentWidth: num(reader.contentWidth, DEFAULT_SETTINGS.reader.contentWidth),
      letterSpacing: num(reader.letterSpacing, DEFAULT_SETTINGS.reader.letterSpacing),
      justify: Boolean(reader.justify),
      highlightVocab: reader.highlightVocab !== false,
      autoTranslate: Boolean(reader.autoTranslate),
      autoAnalyze: Boolean(reader.autoAnalyze)
    },
    general: {
      hotkey: typeof general.hotkey === 'string' && general.hotkey ? general.hotkey : DEFAULT_SETTINGS.general.hotkey,
      minimizeToTray: general.minimizeToTray !== false,
      dailyGoalMinutes: num(general.dailyGoalMinutes, DEFAULT_SETTINGS.general.dailyGoalMinutes)
    }
  };
}

export async function render(root, ctx) {
  const api = ctx && ctx.api;
  const esc = (value) => escapeHtml(ctx, value);
  const toast = (message, tone) => {
    if (ctx && typeof ctx.toast === 'function') {
      try { ctx.toast(message, tone); return; } catch (err) { /* noop */ }
    }
  };
  const confirmDialog = async (options) => {
    if (ctx && typeof ctx.confirm === 'function') {
      try { return await ctx.confirm(options); } catch (err) { /* fall through */ }
    }
    try {
      return typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm([options.title, options.body].filter(Boolean).join('\n\n'))
        : false;
    } catch (err) {
      return false;
    }
  };

  const state = {
    settings: null,
    info: null,
    pending: {},
    timer: null,
    saveChain: Promise.resolve(),
    savedTimer: null,
    keyVisible: false,
    loading: true,
    dictStateTimer: null
  };

  root.innerHTML = '<div class="settings-page page" id="settings-page"></div>';
  const page = root.querySelector('#settings-page');

  /* ---- 保存状态 ---------------------------------------------------------- */
  function setSaved(mode, text) {
    const el = page.querySelector('#set-saved');
    if (!el) return;
    el.className = 'settings-saved is-visible' + (mode ? ' is-' + mode : '');
    el.innerHTML = icon(ctx, mode === 'error' ? 'x' : 'check', 13) + '<span>' + esc(text) + '</span>';
    if (state.savedTimer) window.clearTimeout(state.savedTimer);
    if (mode !== 'saving') {
      state.savedTimer = window.setTimeout(() => {
        el.classList.remove('is-visible');
      }, 1900);
    }
  }

  function queueSave(patch, immediate) {
    state.pending = deepMerge(state.pending || {}, patch);
    if (state.timer) window.clearTimeout(state.timer);
    state.timer = window.setTimeout(flushSave, immediate ? 0 : 400);
  }

  async function flushPendingNow() {
    if (state.timer) {
      window.clearTimeout(state.timer);
      state.timer = null;
    }
    flushSave();
    try { await state.saveChain; } catch (err) { /* noop */ }
  }

  function flushSave() {
    const patch = state.pending;
    state.pending = {};
    const keys = Object.keys(patch);
    if (!keys.length) return;
    state.saveChain = state.saveChain.then(async () => {
      if (!api || !api.settings || typeof api.settings.save !== 'function') {
        setSaved('error', '无法保存');
        return;
      }
      setSaved('saving', '保存中…');
      try {
        const saved = await api.settings.save(patch);
        if (saved && typeof saved === 'object') {
          state.settings = normalizeSettings(saved);
          if (ctx.state) ctx.state.settings = state.settings;
          updateBehaviorUi();
          updateKeyHint();
          updateDictionaryUi();
        }
        setSaved('', '已保存');
      } catch (err) {
        setSaved('error', '保存失败');
        toast('设置保存失败：' + (err && err.message ? err.message : '未知错误'), 'error');
      }
    }).catch(() => {});
  }

  /* ---- 主题 -------------------------------------------------------------- */
  function applyTheme(theme) {
    if (typeof document === 'undefined' || !document.documentElement) return;
    document.documentElement.dataset.theme = theme;
  }

  function updateKeyHint() {
    const hint = page.querySelector('#set-key-hint');
    const status = page.querySelector('#ai-status');
    if (!hint) return;
    const ai = state.settings.ai;
    const ready = aiReady(ai);

    if (status) {
      status.textContent = aiStatusLabel(ai);
      status.className = 'settings-card-status' + (ready ? ' is-ok' : '');
    }

    updateBehaviorHint();

    if (ai.hasApiKey) {
      hint.innerHTML = '已保存 Key：<b>' + esc(ai.keyHint || '••••••') + '</b> · 输入新的 Key 可替换，留空不会修改原来的 Key。';
    } else if (ai.local) {
      hint.innerHTML = '当前 Base URL 指向本地模型，<b>无需 API Key</b> 即可进行语境解析（例如 Ollama）。';
    } else if (ai.available) {
      hint.innerHTML = 'AI 服务已可用（由主进程检测），也可以补充 API Key。';
    } else {
      hint.innerHTML = '尚未保存 Key · 没有 Key 时仍可使用免费翻译；本地模型（如 Ollama）无需 Key。';
    }

    const input = page.querySelector('#set-api-key');
    if (input) {
      input.placeholder = ai.hasApiKey
        ? '已保存，输入新 Key 可替换'
        : (ai.local ? '本地模型无需 Key' : 'sk-…');
    }
  }

  function updateDictionaryUi() {
    if (!state.settings || !state.settings.dictionary) return;
    const dict = state.settings.dictionary;

    const status = page.querySelector('#dict-status');
    if (status) {
      status.textContent = dictionaryStatus(dict);
      status.className = 'settings-card-status' + dictionaryStatusTone(dict);
    }

    const note = page.querySelector('#dict-provider-note');
    if (note) note.textContent = dictionaryProviderHint(dict);

    const hint = page.querySelector('#dict-key-hint');
    if (hint) {
      if (dict.hasOxfordAppKey) {
        hint.innerHTML = '已保存 App Key：<b>' + esc(dict.oxfordKeyHint || '••••••') +
          '</b> · 输入新的 Key 可替换，留空不会修改原来的 Key。';
      } else {
        hint.innerHTML = '还没有保存 App Key。牛津凭证只保存在本机，不会上传到任何 Lumen 服务器。';
      }
    }

    const keyInput = page.querySelector('#set-oxford-key');
    if (keyInput) {
      keyInput.placeholder = dict.hasOxfordAppKey ? '已保存，输入新 Key 可替换' : '填入牛津 App Key';
    }

    const credentials = page.querySelector('#dict-credentials');
    if (credentials) credentials.classList.toggle('is-dim', dict.provider === 'free');

    page.querySelectorAll('input[name="dictionary-provider"]').forEach((input) => {
      const choice = input.closest('.settings-choice');
      if (choice) choice.classList.toggle('is-on', Boolean(input.checked));
    });
  }

  function updateBehaviorUi() {
    const reader = state.settings && state.settings.reader ? state.settings.reader : {};
    page.querySelectorAll('[data-behavior]').forEach((group) => {
      const key = group.getAttribute('data-behavior');
      const value = Boolean(reader[key]);
      group.querySelectorAll('[data-value]').forEach((button) => {
        const active = (button.getAttribute('data-value') === '1') === value;
        button.classList.toggle('is-on', active);
        button.setAttribute('aria-checked', String(active));
      });
    });
  }

  function updateBehaviorHint() {
    const hint = page.querySelector('#behavior-hint');
    const summary = page.querySelector('#behavior-summary');
    if (!hint || !state.settings) return;
    const reader = state.settings.reader;
    const ai = state.settings.ai;
    const ready = aiReady(ai);
    if (summary) {
      summary.textContent = (reader.autoTranslate ? '自动翻译' : '手动翻译') + ' · ' +
        (ready ? (reader.autoAnalyze ? '自动解析' : '自动解析已关闭') : 'AI 未配置');
    }
    if (!ready) {
      hint.innerHTML = icon(ctx, 'info', 13) + '<span>AI 尚未配置：自动解析暂不会生效，但翻译、词典和生词本仍可正常使用。配置 Key 或本地模型后会按这里的设置执行。</span>';
    } else if (reader.autoAnalyze) {
      hint.innerHTML = icon(ctx, 'sparkles', 13) + '<span>已开启自动解析：每次划词都会请求 AI，适合精读。额度敏感时建议切换为「关闭自动」，只在点击卡片里的「解析」时请求。</span>';
    } else {
      hint.innerHTML = icon(ctx, 'info', 13) + '<span>已关闭自动解析：划词只显示翻译和词典；需要语境解析时，点击卡片中的「解析」按钮即可，不会自动消耗额度。</span>';
    }
    hint.classList.toggle('is-warn', !ready);
  }

  function pctFor(spec, value) {
    const ratio = (Number(value) - spec.min) / (spec.max - spec.min);
    return Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  }

  function updateRangeFill(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    const ratio = max > min ? (value - min) / (max - min) : 0;
    const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
    input.style.setProperty('--pct', pct + '%');
  }

  /* ---- 片段 -------------------------------------------------------------- */
  function behaviorChoice(key, value, onLabel, offLabel) {
    return '<div class="settings-behavior-seg" role="radiogroup" data-behavior="' + key + '" aria-label="' + (key === 'autoTranslate' ? '自动翻译' : '自动 AI 解析') + '">' +
      '<button type="button" data-value="1" class="' + (value ? 'is-on' : '') + '">' + onLabel + '</button>' +
      '<button type="button" data-value="0" class="' + (!value ? 'is-on' : '') + '">' + offLabel + '</button>' +
      '</div>';
  }

  function lookupBehaviorHtml(settings) {
    const reader = settings.reader;
    const ready = aiReady(settings.ai);
    const summary = (reader.autoTranslate ? '自动翻译' : '手动翻译') + ' · ' +
      (ready ? (reader.autoAnalyze ? '自动解析' : '自动解析已关闭') : 'AI 未配置');
    return '<div class="settings-behavior" aria-label="划词行为">' +
      '<div class="settings-behavior-head">' +
        '<div class="settings-behavior-copy">' +
          '<span class="settings-behavior-kicker">On selection</span>' +
          '<h3>划词之后</h3>' +
          '<p>决定选中文本时自动做什么，以及什么时候消耗 AI 额度。</p>' +
        '</div>' +
        '<span class="settings-behavior-summary" id="behavior-summary">' + esc(summary) + '</span>' +
      '</div>' +
      '<div class="settings-behavior-row">' +
        '<div class="settings-behavior-copy">' +
          '<span class="settings-behavior-title">立即显示翻译</span>' +
          '<span class="settings-behavior-desc">选中单词或句子后弹出卡片；手动模式只显示「翻译选区」按钮。</span>' +
        '</div>' +
        behaviorChoice('autoTranslate', reader.autoTranslate, '自动', '手动') +
      '</div>' +
      '<div class="settings-behavior-row">' +
        '<div class="settings-behavior-copy">' +
          '<span class="settings-behavior-title">自动 AI 语境解析</span>' +
          '<span class="settings-behavior-desc">开启后每次划词都会请求 AI，会消耗额度；关闭后点击「解析」才请求。</span>' +
        '</div>' +
        behaviorChoice('autoAnalyze', reader.autoAnalyze, '自动', '关闭自动') +
      '</div>' +
      '<p class="settings-behavior-hint" id="behavior-hint"></p>' +
    '</div>';
  }

  function aiSection(settings) {
    const ai = settings.ai;
    return '<section class="settings-card" aria-label="AI 语境解析">' +
      '<div class="settings-card-head">' +
        '<span class="settings-card-icon">' + icon(ctx, 'sparkles', 17) + '</span>' +
        '<div class="settings-card-copy"><h2>AI 语境解析</h2><p>支持 OpenAI 兼容接口与本地模型（如 Ollama），解释单词在句子里的确切含义、语气与搭配。</p></div>' +
        '<span class="settings-card-status' + (aiReady(ai) ? ' is-ok' : '') + '" id="ai-status">' + aiStatusLabel(ai) + '</span>' +
      '</div>' +
      '<div class="settings-body">' +
        '<div class="settings-grid-2">' +
          '<label class="settings-field"><span class="settings-label">Base URL</span>' +
            '<input class="input" id="set-base-url" type="text" spellcheck="false" autocomplete="off" value="' + esc(ai.baseUrl) + '" placeholder="https://api.deepseek.com/v1">' +
          '</label>' +
          '<label class="settings-field"><span class="settings-label">模型</span>' +
            '<input class="input" id="set-model" type="text" spellcheck="false" autocomplete="off" value="' + esc(ai.model) + '" placeholder="deepseek-chat">' +
          '</label>' +
        '</div>' +
        '<div class="settings-field">' +
          '<span class="settings-label">API Key</span>' +
          '<div class="settings-key-row">' +
            '<div class="settings-input-wrap">' +
              '<input class="input" id="set-api-key" type="password" autocomplete="off" spellcheck="false" placeholder="' + (ai.hasApiKey ? '已保存，输入新 Key 可替换' : (ai.local ? '本地模型无需 Key' : 'sk-…')) + '">' +
              '<span class="settings-key-tools">' +
                '<button type="button" class="icon-btn" id="set-key-eye" aria-label="显示或隐藏 API Key" title="显示 / 隐藏">' + icon(ctx, 'eye', 15) + '</button>' +
                '<button type="button" class="icon-btn" id="set-key-clear" aria-label="清除已保存的 API Key" title="清除已保存的 Key">' + icon(ctx, 'x', 15) + '</button>' +
              '</span>' +
            '</div>' +
            '<button type="button" class="btn" id="set-test-ai">' + icon(ctx, 'refresh', 15) + '<span>测试连接</span></button>' +
          '</div>' +
          '<p class="settings-hint" id="set-key-hint"></p>' +
          '<p class="settings-result" id="set-test-result" role="status"></p>' +
        '</div>' +
        lookupBehaviorHtml(settings) +
        '<div class="settings-note settings-note--privacy">' + icon(ctx, 'key', 15) +
          '<span><b>安全存储：</b>Key 由系统 safeStorage 加密后仅保存在本机，不会发往除你填写的 AI 服务之外的任何地方。测试连接会实际发起一次最小请求。</span>' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  function dictionarySection(settings) {
    const dict = settings.dictionary;
    const choices = DICTIONARY_PROVIDERS.map((item) =>
      '<label class="settings-choice' + (item.value === dict.provider ? ' is-on' : '') + '">' +
        '<input type="radio" name="dictionary-provider" value="' + item.value + '"' + (item.value === dict.provider ? ' checked' : '') + '>' +
        '<span class="settings-choice__title">' + item.title + '</span>' +
        '<span class="settings-choice__desc">' + item.desc + '</span>' +
      '</label>'
    ).join('');

    return '<section class="settings-card" aria-label="词典">' +
      '<div class="settings-card-head">' +
        '<span class="settings-card-icon settings-card-icon--sage">' + icon(ctx, 'book', 17) + '</span>' +
        '<div class="settings-card-copy"><h2>词典</h2><p>内置约 9 万词条（cigen / TOEFL / 不择手段）优先、离线可用；未收录时用开放词典，牛津 API 需要你自己的商业凭证。</p></div>' +
        '<span class="settings-card-status' + dictionaryStatusTone(dict) + '" id="dict-status">' + esc(dictionaryStatus(dict)) + '</span>' +
      '</div>' +
      '<div class="settings-body">' +
        '<div class="settings-field">' +
          '<span class="settings-label">词典来源</span>' +
          '<div class="settings-choice-row" role="radiogroup" aria-label="词典来源">' + choices + '</div>' +
          '<p class="settings-hint" id="dict-provider-note">' + esc(dictionaryProviderHint(dict)) + '</p>' +
        '</div>' +
        '<div class="settings-dict-creds" id="dict-credentials">' +
          '<div class="settings-grid-2">' +
            '<label class="settings-field"><span class="settings-label">牛津 App ID</span>' +
              '<input class="input" id="set-oxford-app-id" type="text" spellcheck="false" autocomplete="off" value="' + esc(dict.oxfordAppId) + '" placeholder="例如 4d2a1b3c">' +
            '</label>' +
            '<div class="settings-field">' +
              '<span class="settings-label">牛津 App Key</span>' +
              '<div class="settings-input-wrap">' +
                '<input class="input" id="set-oxford-key" type="password" autocomplete="off" spellcheck="false" placeholder="' + (dict.hasOxfordAppKey ? '已保存，输入新 Key 可替换' : '填入牛津 App Key') + '">' +
                '<span class="settings-key-tools">' +
                  '<button type="button" class="icon-btn" id="set-oxford-eye" aria-label="显示或隐藏牛津 App Key" title="显示 / 隐藏">' + icon(ctx, 'eye', 15) + '</button>' +
                  '<button type="button" class="icon-btn" id="set-oxford-clear" aria-label="清除已保存的牛津 App Key" title="清除已保存的 App Key">' + icon(ctx, 'x', 15) + '</button>' +
                '</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="settings-dict-actions">' +
            '<div class="settings-dict-actions__copy">' +
              '<p class="settings-hint" id="dict-key-hint"></p>' +
              '<p class="settings-result" id="dict-key-state" role="status"></p>' +
            '</div>' +
            '<button type="button" class="btn" id="set-test-dict">' + icon(ctx, 'refresh', 15) + '<span>测试连接</span></button>' +
          '</div>' +
          '<p class="settings-result" id="dict-test-result" role="status"></p>' +
        '</div>' +
        '<div class="settings-note settings-note--warn">' + icon(ctx, 'info', 15) +
          '<span><b>关于牛津词典：</b>牛津词典是商业 API，需要你自行在牛津官网申请 App ID 与 App Key，Lumen 不内置牛津数据，也不代申请。未填写凭证时会使用免费的 dictionaryapi.dev 开放词典（释义为英文）。</span>' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  function translationSection(settings) {
    const provider = settings.translation.provider;
    const choices = PROVIDERS.map((item) =>
      '<label class="settings-choice' + (item.value === provider ? ' is-on' : '') + '">' +
        '<input type="radio" name="translation-provider" value="' + item.value + '"' + (item.value === provider ? ' checked' : '') + '>' +
        '<span class="settings-choice__title">' + item.title + '</span>' +
        '<span class="settings-choice__desc">' + item.desc + '</span>' +
      '</label>'
    ).join('');

    return '<section class="settings-card" aria-label="翻译">' +
      '<div class="settings-card-head">' +
        '<span class="settings-card-icon settings-card-icon--sage">' + icon(ctx, 'type', 17) + '</span>' +
        '<div class="settings-card-copy"><h2>翻译</h2><p>选中文本时的默认翻译方式，目标语言为简体中文。</p></div>' +
      '</div>' +
      '<div class="settings-body">' +
        '<div class="settings-choice-row" role="radiogroup" aria-label="翻译方式">' + choices + '</div>' +
        '<div class="settings-note settings-note--warn">' + icon(ctx, 'info', 15) +
          '<span><b>隐私提示：</b>免费翻译会把选中的英文发送到 Google / MyMemory 的公共接口。如果内容敏感，请把翻译方式切换为「只用 AI」，或关闭自动翻译。</span>' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  function themeCards(settings) {
    return THEMES.map((theme) =>
      '<label class="settings-theme-card' + (theme.value === settings.reader.theme ? ' is-on' : '') + '" data-theme-value="' + theme.value + '">' +
        '<input type="radio" name="reader-theme" value="' + theme.value + '"' + (theme.value === settings.reader.theme ? ' checked' : '') + '>' +
        '<span class="settings-theme-preview settings-theme-preview--' + theme.value + '" aria-hidden="true"><i></i><i></i><i></i><b></b></span>' +
        '<span class="settings-theme-copy"><span class="settings-theme-name">' + theme.title + '</span>' +
          '<span class="settings-theme-mark">' + icon(ctx, 'check', 10) + '</span>' +
        '</span>' +
      '</label>'
    ).join('');
  }

  function sliderHtml(spec, value) {
    const pct = pctFor(spec, value);
    return '<div class="settings-slider">' +
      '<div class="settings-slider-head">' +
        '<span class="settings-label">' + spec.label + '</span>' +
        '<span class="settings-slider-value"><b data-value-for="' + spec.key + '">' + spec.format(value) + '</b> ' + spec.unit + '</span>' +
      '</div>' +
      '<input class="settings-range" type="range" min="' + spec.min + '" max="' + spec.max + '" step="' + spec.step + '" value="' + value + '" ' +
        'data-slider-key="' + spec.key + '" aria-label="' + spec.label + '" style="--pct:' + pct + '%">' +
    '</div>';
  }

  function toggleHtml(item, settings) {
    const section = settings[item.section] || {};
    const checked = Boolean(section[item.key]);
    return '<div class="settings-toggle-row">' +
      '<div class="settings-toggle-copy">' +
        '<span class="settings-toggle-title">' + item.title + '</span>' +
        '<span class="settings-toggle-desc">' + item.desc + '</span>' +
      '</div>' +
      '<label class="toggle">' +
        '<input type="checkbox" id="' + item.id + '" data-section="' + item.section + '" data-key="' + item.key + '"' + (checked ? ' checked' : '') + ' aria-label="' + item.title + '">' +
        '<span class="toggle-track"></span>' +
      '</label>' +
    '</div>';
  }

  function readingSection(settings) {
    const reader = settings.reader;
    return '<section class="settings-card" aria-label="阅读偏好">' +
      '<div class="settings-card-head">' +
        '<span class="settings-card-icon">' + icon(ctx, 'palette', 17) + '</span>' +
        '<div class="settings-card-copy"><h2>阅读偏好</h2><p>主题、排版与正文的阅读手感，改动会立刻应用到阅读器。</p></div>' +
      '</div>' +
      '<div class="settings-body">' +
        '<div class="settings-field"><span class="settings-label">主题</span>' +
          '<div class="settings-theme-row" role="radiogroup" aria-label="阅读主题">' + themeCards(settings) + '</div>' +
        '</div>' +
        '<div class="settings-slider-grid">' +
          SLIDERS.map((spec) => sliderHtml(spec, reader[spec.key])).join('') +
        '</div>' +
        '<div class="settings-font-row">' +
          '<div class="settings-seg" role="group" aria-label="正文字体">' +
            '<button type="button" data-font="serif" class="' + (reader.fontFamily === 'serif' ? 'is-on' : '') + '">衬线</button>' +
            '<button type="button" data-font="sans" class="' + (reader.fontFamily === 'sans' ? 'is-on' : '') + '">无衬线</button>' +
          '</div>' +
          '<p class="settings-font-sample" data-font="' + reader.fontFamily + '">The quiet <b>lumen</b> of an afternoon.</p>' +
        '</div>' +
        '<div class="settings-toggle-list">' + TOGGLES.map((item) => toggleHtml(item, settings)).join('') + '</div>' +
      '</div>' +
    '</section>';
  }

  function generalSection(settings) {
    const general = settings.general;
    const goal = general.dailyGoalMinutes;
    const goalPct = Math.round(((goal - 5) / (120 - 5)) * 100);
    const presets = HOTKEY_PRESETS.map((preset) =>
      '<button type="button" class="settings-preset" data-preset="' + preset + '">' + preset + '</button>'
    ).join('');

    return '<section class="settings-card" aria-label="通用">' +
      '<div class="settings-card-head">' +
        '<span class="settings-card-icon settings-card-icon--ink">' + icon(ctx, 'target', 17) + '</span>' +
        '<div class="settings-card-copy"><h2>通用</h2><p>全局划词、托盘行为与每日目标。</p></div>' +
      '</div>' +
      '<div class="settings-body">' +
        '<div class="settings-field">' +
          '<span class="settings-label">全局划词快捷键</span>' +
          '<div class="settings-hotkey-row">' +
            '<input class="settings-hotkey-input" id="set-hotkey" type="text" readonly value="' + esc(general.hotkey) + '" aria-label="全局划词快捷键，点击后按下组合键">' +
            '<div class="settings-presets">' + presets + '</div>' +
          '</div>' +
          '<p class="settings-hint">点击上方输入框，然后直接按下新的组合键（需包含 Ctrl / Alt / Shift）。在任意应用中选中英文即可呼出划词浮窗。</p>' +
        '</div>' +
        '<div class="settings-toggle-list">' + toggleHtml(GENERAL_TOGGLE, settings) + '</div>' +
        '<div class="settings-field">' +
          '<div class="settings-slider-head">' +
            '<span class="settings-label">每日阅读目标</span>' +
            '<span class="settings-slider-value"><b id="set-goal-value">' + goal + '</b> 分钟</span>' +
          '</div>' +
          '<input class="settings-range" id="set-daily-goal" type="range" min="5" max="120" step="5" value="' + goal + '" aria-label="每日阅读目标分钟" style="--pct:' + goalPct + '%">' +
          '<p class="settings-hint">目标会显示在「足迹」页的进度环里，用来衡量每天读了多少。</p>' +
        '</div>' +
        '<div class="settings-note">' + icon(ctx, 'info', 15) +
          '<span><b>开机自启：</b>当前版本不会自动写入系统开机启动项，需要时请在系统的「启动应用」中手动添加 Lumen。关闭窗口后仍可驻留托盘，保证划词快捷键随时可用。</span>' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  function dataSection(settings, info) {
    const version = info && info.version ? info.version : '—';
    const platform = info && info.platform ? info.platform : (api && api.platform ? api.platform : 'win32');
    const dataDir = info && info.dataDir ? info.dataDir : '尚未获取到数据目录';
    return '<section class="settings-card" aria-label="数据">' +
      '<div class="settings-card-head">' +
        '<span class="settings-card-icon settings-card-icon--sage">' + icon(ctx, 'book', 17) + '</span>' +
        '<div class="settings-card-copy"><h2>数据</h2><p>书库、生词、笔记与统计都保存在本机数据目录。</p></div>' +
      '</div>' +
      '<div class="settings-body">' +
        '<div class="settings-data-actions">' +
          '<button type="button" class="btn" id="set-open-data">' + icon(ctx, 'folder', 15) + '<span>打开数据目录</span></button>' +
          '<button type="button" class="btn ghost" id="set-export">' + icon(ctx, 'download', 15) + '<span>导出备份</span></button>' +
          '<button type="button" class="btn ghost" id="set-import">' + icon(ctx, 'upload', 15) + '<span>导入备份</span></button>' +
        '</div>' +
        '<div class="settings-data-foot">' +
          '<span>数据目录：<span class="settings-path" id="set-data-dir">' + esc(dataDir) + '</span></span>' +
          '<span>备份包含书库索引、生词、笔记与统计；导入会把备份合并到当前数据，同名条目以备份为准。</span>' +
        '</div>' +
        '<div class="settings-about">' +
          '<span>Lumen · 流明阅读 <b id="set-version">' + esc(version) + '</b></span>' +
          '<span class="chip" id="set-platform">' + esc(platform) + '</span>' +
          '<span>把每一页，读成自己的语言。</span>' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  function pageHtml() {
    const settings = state.settings;
    return '<div class="settings-head">' +
        '<div>' +
          '<p class="settings-eyebrow">Settings</p>' +
          '<h1 class="settings-title">设置</h1>' +
          '<p class="settings-lede">调校你的阅读体验。所有修改都会自动保存，主题会即时生效。</p>' +
        '</div>' +
        '<span class="settings-saved" id="set-saved" aria-live="polite">' + icon(ctx, 'check', 13) + '<span>已保存</span></span>' +
      '</div>' +
      aiSection(settings) +
      dictionarySection(settings) +
      translationSection(settings) +
      readingSection(settings) +
      generalSection(settings) +
      dataSection(settings, state.info);
  }

  /* ---- 绑定 -------------------------------------------------------------- */
  function bind() {
    const settings = state.settings;

    /* AI 基础字段 */
    const baseUrl = page.querySelector('#set-base-url');
    if (baseUrl) {
      baseUrl.addEventListener('input', () => {
        const nextUrl = baseUrl.value.trim();
        state.settings.ai.baseUrl = nextUrl;
        state.settings.ai.local = isLocalAiUrl(nextUrl);
        state.settings.ai.available = Boolean(state.settings.ai.hasApiKey || state.settings.ai.local);
        updateKeyHint();
        queueSave({ ai: { baseUrl: nextUrl } });
      });
    }

    const model = page.querySelector('#set-model');
    if (model) {
      model.addEventListener('input', () => {
        state.settings.ai.model = model.value.trim();
        queueSave({ ai: { model: model.value.trim() } });
      });
    }

    /* API Key */
    const keyInput = page.querySelector('#set-api-key');
    const eyeButton = page.querySelector('#set-key-eye');
    let keySavePromise = Promise.resolve();

    async function saveApiKey(value) {
      if (!api || !api.settings || typeof api.settings.save !== 'function') {
        setSaved('error', '无法保存');
        return false;
      }
      setSaved('saving', '正在保存 Key…');
      try {
        const saved = await api.settings.save({ ai: { apiKey: value } });
        if (saved && typeof saved === 'object') {
          state.settings = normalizeSettings(saved);
          updateKeyHint();
        }
        setSaved('', 'Key 已保存');
        toast('API Key 已保存', 'ok');
        return true;
      } catch (err) {
        setSaved('error', 'Key 保存失败');
        toast('API Key 保存失败：' + (err && err.message ? err.message : '未知错误'), 'error');
        return false;
      }
    }

    function commitKey() {
      if (!keyInput) return;
      const value = keyInput.value.trim();
      if (!value) return;
      keyInput.value = '';
      keyInput.type = 'password';
      state.keyVisible = false;
      if (eyeButton) {
        eyeButton.innerHTML = icon(ctx, 'eye', 15);
        eyeButton.setAttribute('aria-label', '显示 API Key');
      }
      keySavePromise = saveApiKey(value);
    }

    if (keyInput) {
      keyInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commitKey();
        }
      });
      keyInput.addEventListener('blur', commitKey);
    }

    if (eyeButton && keyInput) {
      eyeButton.addEventListener('click', () => {
        state.keyVisible = !state.keyVisible;
        keyInput.type = state.keyVisible ? 'text' : 'password';
        eyeButton.innerHTML = icon(ctx, state.keyVisible ? 'eyeOff' : 'eye', 15);
        eyeButton.setAttribute('aria-label', state.keyVisible ? '隐藏 API Key' : '显示 API Key');
        keyInput.focus({ preventScroll: true });
      });
    }

    const clearButton = page.querySelector('#set-key-clear');
    if (clearButton) {
      clearButton.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: '清除已保存的 API Key？',
          body: (state.settings.ai.local
            ? '当前 Base URL 指向本地模型，清除后仍可继续使用 AI 语境解析。免费翻译不受影响。'
            : '清除后 AI 语境解析将不可用，直到重新填写 Key。若使用本地模型，请把 Base URL 指向 localhost。免费翻译不受影响。'),
          confirmText: '清除',
          danger: true
        });
        if (!ok) return;
        if (keyInput && keyInput.value.trim()) commitKey();
        try { await keySavePromise; } catch (err) { /* noop */ }
        await flushPendingNow();
        if (keyInput) keyInput.value = '';
        try {
          if (api && api.settings && typeof api.settings.clearApiKey === 'function') {
            await api.settings.clearApiKey();
          } else if (api && api.settings && typeof api.settings.save === 'function') {
            await api.settings.save({ ai: { clearApiKey: true } });
          } else {
            toast('当前环境不支持清除 Key', 'warn');
            return;
          }
          state.settings.ai.hasApiKey = false;
          state.settings.ai.keyHint = '';
          state.settings.ai.local = isLocalAiUrl(state.settings.ai.baseUrl);
          state.settings.ai.available = state.settings.ai.local;
          updateKeyHint();
          setSaved('', '已清除 Key');
          toast(state.settings.ai.local ? 'API Key 已清除 · 本地模型仍可使用' : 'API Key 已清除', 'ok');
        } catch (err) {
          toast('清除失败：' + (err && err.message ? err.message : '未知错误'), 'error');
        }
      });
    }

    /* 测试连接 */
    const testButton = page.querySelector('#set-test-ai');
    const testResult = page.querySelector('#set-test-result');
    if (testButton) {
      testButton.addEventListener('click', async () => {
        if (!api || !api.settings || typeof api.settings.testAI !== 'function') {
          if (testResult) {
            testResult.className = 'settings-result is-error';
            testResult.textContent = '当前环境不支持测试连接。';
          }
          return;
        }
        if (keyInput && keyInput.value.trim()) commitKey();
        try { await keySavePromise; } catch (err) { /* noop */ }
        await flushPendingNow();
        const original = testButton.innerHTML;
        testButton.disabled = true;
        testButton.innerHTML = icon(ctx, 'refresh', 15) + '<span>测试中…</span>';
        if (testResult) {
          testResult.className = 'settings-result';
          testResult.textContent = '正在连接 ' + (state.settings.ai.baseUrl || 'AI 服务') + ' …';
        }
        try {
          const result = await api.settings.testAI();
          if (result && result.ok) {
            const latency = result.latency != null ? ' · ' + result.latency + ' ms' : '';
            if (testResult) {
              testResult.className = 'settings-result is-ok';
              testResult.textContent = '连接成功' + latency + (result.message ? ' · ' + result.message : '');
            }
            toast('AI 连接正常', 'ok');
          } else {
            if (testResult) {
              testResult.className = 'settings-result is-error';
              testResult.textContent = '连接失败：' + (result && result.message ? result.message : '未知错误');
            }
          }
        } catch (err) {
          const code = err && err.code;
          const message = code === 'NO_AI_KEY'
            ? '还没有有效的 API Key，请先填写并保存；使用本地模型时请确认 Base URL 指向 localhost。'
            : '连接失败：' + (err && err.message ? err.message : '未知错误');
          if (testResult) {
            testResult.className = 'settings-result is-error';
            testResult.textContent = message;
          }
        } finally {
          testButton.disabled = false;
          testButton.innerHTML = original;
        }
      });
    }

    /* 词典 */
    page.querySelectorAll('input[name="dictionary-provider"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        const provider = input.value;
        if (['auto', 'free', 'oxford'].indexOf(provider) < 0) return;
        state.settings.dictionary.provider = provider;
        updateDictionaryUi();
        queueSave({ dictionary: { provider: provider } });
      });
    });

    const oxfordAppIdInput = page.querySelector('#set-oxford-app-id');
    if (oxfordAppIdInput) {
      oxfordAppIdInput.addEventListener('input', () => {
        const value = oxfordAppIdInput.value.trim();
        state.settings.dictionary.oxfordAppId = value;
        queueSave({ dictionary: { oxfordAppId: value } });
      });
    }

    const oxfordKeyInput = page.querySelector('#set-oxford-key');
    const oxfordEye = page.querySelector('#set-oxford-eye');
    let oxfordKeyVisible = false;
    let oxfordSavePromise = Promise.resolve();

    function setOxfordState(mode, text) {
      const el = page.querySelector('#dict-key-state');
      if (!el) return;
      el.className = 'settings-result' + (mode ? ' is-' + mode : '');
      el.textContent = text || '';
      if (state.dictStateTimer) window.clearTimeout(state.dictStateTimer);
      if (mode !== 'saving' && text) {
        state.dictStateTimer = window.setTimeout(() => {
          if (el.textContent === text) el.textContent = '';
        }, 2600);
      }
    }

    async function saveOxfordKey(value) {
      if (!api || !api.settings || typeof api.settings.save !== 'function') {
        setOxfordState('error', '当前环境无法保存凭证');
        return false;
      }
      setOxfordState('saving', '正在保存 App Key…');
      try {
        const saved = await api.settings.save({ dictionary: { oxfordAppKey: value } });
        if (saved && typeof saved === 'object') {
          state.settings = normalizeSettings(saved);
          if (ctx.state) ctx.state.settings = state.settings;
        }
        updateDictionaryUi();
        setOxfordState('ok', 'App Key 已保存');
        toast('牛津 App Key 已保存', 'ok');
        return true;
      } catch (err) {
        setOxfordState('error', 'App Key 保存失败');
        toast('牛津 App Key 保存失败：' + (err && err.message ? err.message : '未知错误'), 'error');
        return false;
      }
    }

    function commitOxfordKey() {
      if (!oxfordKeyInput) return;
      const value = oxfordKeyInput.value.trim();
      if (!value) return;
      oxfordKeyInput.value = '';
      oxfordKeyInput.type = 'password';
      oxfordKeyVisible = false;
      if (oxfordEye) {
        oxfordEye.innerHTML = icon(ctx, 'eye', 15);
        oxfordEye.setAttribute('aria-label', '显示或隐藏牛津 App Key');
      }
      oxfordSavePromise = saveOxfordKey(value);
    }

    if (oxfordKeyInput) {
      oxfordKeyInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commitOxfordKey();
        }
      });
      oxfordKeyInput.addEventListener('blur', commitOxfordKey);
    }

    if (oxfordEye && oxfordKeyInput) {
      oxfordEye.addEventListener('click', () => {
        oxfordKeyVisible = !oxfordKeyVisible;
        oxfordKeyInput.type = oxfordKeyVisible ? 'text' : 'password';
        oxfordEye.innerHTML = icon(ctx, oxfordKeyVisible ? 'eyeOff' : 'eye', 15);
        oxfordEye.setAttribute('aria-label', oxfordKeyVisible ? '隐藏牛津 App Key' : '显示牛津 App Key');
        oxfordKeyInput.focus({ preventScroll: true });
      });
    }

    const oxfordClearButton = page.querySelector('#set-oxford-clear');
    if (oxfordClearButton) {
      oxfordClearButton.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: '清除已保存的牛津 App Key？',
          body: '清除后词典会回退到开放词典（dictionaryapi.dev），需要重新填写 App Key 才能再使用牛津数据。',
          confirmText: '清除',
          danger: true
        });
        if (!ok) return;
        if (oxfordKeyInput && oxfordKeyInput.value.trim()) commitOxfordKey();
        try { await oxfordSavePromise; } catch (err) { /* noop */ }
        await flushPendingNow();
        if (oxfordKeyInput) oxfordKeyInput.value = '';
        try {
          const saved = await api.settings.save({ dictionary: { clearOxfordKey: true } });
          if (saved && typeof saved === 'object') {
            state.settings = normalizeSettings(saved);
            if (ctx.state) ctx.state.settings = state.settings;
          }
          updateDictionaryUi();
          setOxfordState('ok', 'App Key 已清除');
          toast('牛津 App Key 已清除', 'ok');
        } catch (err) {
          toast('清除失败：' + (err && err.message ? err.message : '未知错误'), 'error');
        }
      });
    }

    const testDictionaryButton = page.querySelector('#set-test-dict');
    const dictionaryTestResult = page.querySelector('#dict-test-result');
    if (testDictionaryButton) {
      testDictionaryButton.addEventListener('click', async () => {
        if (!api || !api.settings || typeof api.settings.testDictionary !== 'function') {
          if (dictionaryTestResult) {
            dictionaryTestResult.className = 'settings-result is-error';
            dictionaryTestResult.textContent = '当前版本不支持测试词典连接。';
          }
          return;
        }
        if (oxfordKeyInput && oxfordKeyInput.value.trim()) commitOxfordKey();
        try { await oxfordSavePromise; } catch (err) { /* noop */ }
        await flushPendingNow();
        const original = testDictionaryButton.innerHTML;
        testDictionaryButton.disabled = true;
        testDictionaryButton.innerHTML = icon(ctx, 'refresh', 15) + '<span>测试中…</span>';
        if (dictionaryTestResult) {
          dictionaryTestResult.className = 'settings-result';
          dictionaryTestResult.textContent = '正在测试词典连接…';
        }
        try {
          const result = await api.settings.testDictionary();
          if (result && result.ok) {
            const provider = result.provider ||
              (state.settings.dictionary.hasOxfordAppKey && state.settings.dictionary.provider !== 'free' ? 'oxford' : 'free');
            const providerLabel = provider === 'oxford' ? '牛津词典' : (provider === 'free' ? '开放词典' : String(provider));
            if (dictionaryTestResult) {
              dictionaryTestResult.className = 'settings-result is-ok';
              dictionaryTestResult.textContent = '连接成功 · ' + providerLabel + (result.message ? ' · ' + result.message : '');
            }
            toast('词典连接正常', 'ok');
          } else {
            if (dictionaryTestResult) {
              dictionaryTestResult.className = 'settings-result is-error';
              dictionaryTestResult.textContent = '连接失败：' + (result && result.message ? result.message : '未知错误');
            }
          }
        } catch (err) {
          if (dictionaryTestResult) {
            dictionaryTestResult.className = 'settings-result is-error';
            dictionaryTestResult.textContent = '连接失败：' + (err && err.message ? err.message : '未知错误');
          }
        } finally {
          testDictionaryButton.disabled = false;
          testDictionaryButton.innerHTML = original;
        }
      });
    }

    /* 翻译方式 */
    page.querySelectorAll('input[name="translation-provider"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        const provider = input.value;
        state.settings.translation.provider = provider;
        page.querySelectorAll('.settings-choice').forEach((choice) => {
          const radio = choice.querySelector('input');
          choice.classList.toggle('is-on', Boolean(radio && radio.checked));
        });
        queueSave({ translation: { provider: provider } });
      });
    });

    /* 主题 */
    page.querySelectorAll('input[name="reader-theme"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        const theme = input.value;
        state.settings.reader.theme = theme;
        page.querySelectorAll('.settings-theme-card').forEach((card) => {
          const radio = card.querySelector('input');
          card.classList.toggle('is-on', Boolean(radio && radio.checked));
        });
        applyTheme(theme);
        queueSave({ reader: { theme: theme } });
      });
    });

    /* 滑块 */
    page.querySelectorAll('.settings-range[data-slider-key]').forEach((input) => {
      updateRangeFill(input);
      input.addEventListener('input', () => {
        const key = input.getAttribute('data-slider-key');
        const spec = SLIDERS.find((item) => item.key === key);
        if (!spec) return;
        const value = Number(input.value);
        const label = page.querySelector('[data-value-for="' + key + '"]');
        if (label) label.textContent = spec.format(value);
        updateRangeFill(input);
        state.settings.reader[key] = value;
        const patch = { reader: {} };
        patch.reader[key] = value;
        queueSave(patch);
      });
    });

    /* 字体 */
    page.querySelectorAll('.settings-seg [data-font]').forEach((button) => {
      button.addEventListener('click', () => {
        const font = button.getAttribute('data-font');
        if (font !== 'serif' && font !== 'sans') return;
        if (state.settings.reader.fontFamily === font) return;
        state.settings.reader.fontFamily = font;
        page.querySelectorAll('.settings-seg [data-font]').forEach((item) => {
          item.classList.toggle('is-on', item.getAttribute('data-font') === font);
        });
        const sample = page.querySelector('.settings-font-sample');
        if (sample) sample.setAttribute('data-font', font);
        queueSave({ reader: { fontFamily: font } });
      });
    });

    /* 划词行为：自动 / 手动 */
    page.querySelectorAll('[data-behavior]').forEach((group) => {
      group.addEventListener('click', (event) => {
        const button = event.target.closest('[data-value]');
        if (!button) return;
        const key = group.getAttribute('data-behavior');
        if (key !== 'autoTranslate' && key !== 'autoAnalyze') return;
        const value = button.getAttribute('data-value') === '1';
        if (state.settings.reader[key] === value) return;
        state.settings.reader[key] = value;
        if (ctx.state) ctx.state.settings = state.settings;
        if (key === 'autoAnalyze' && value && !aiReady(state.settings.ai)) {
          toast('AI 尚未配置，自动解析暂时不会触发', 'warn');
        }
        updateBehaviorUi();
        updateBehaviorHint();
        queueSave({ reader: { [key]: value } });
      });
    });

    /* 开关 */
    TOGGLES.forEach((item) => {
      const input = page.querySelector('#' + item.id);
      if (!input) return;
      input.addEventListener('change', () => {
        const patch = {};
        patch[item.section] = {};
        patch[item.section][item.key] = input.checked;
        if (item.section === 'reader' && item.key === 'autoAnalyze' && input.checked) {
          const provider = state.settings.translation.provider;
          if (provider === 'free') {
            toast('免费翻译无法提供 AI 解析，切换为「自动」或「只用 AI」后生效', 'warn');
          }
        }
        queueSave(patch);
      });
    });

    /* 快捷键 */
    const hotkeyInput = page.querySelector('#set-hotkey');
    if (hotkeyInput) {
      hotkeyInput.addEventListener('keydown', (event) => {
        event.preventDefault();
        if (['Control', 'Shift', 'Alt', 'Meta'].indexOf(event.key) >= 0) return;
        const key = normalizeKey(event.key);
        if (!key) return;
        const mods = [];
        if (event.ctrlKey) mods.push('Ctrl');
        if (event.altKey) mods.push('Alt');
        if (event.shiftKey) mods.push('Shift');
        if (event.metaKey) mods.push('Meta');
        if (!mods.length) {
          toast('快捷键需要包含 Ctrl / Alt / Shift 中的至少一个', 'warn');
          return;
        }
        const combo = mods.join('+') + '+' + key;
        hotkeyInput.value = combo;
        state.settings.general.hotkey = combo;
        queueSave({ general: { hotkey: combo } }, true);
      });
    }

    page.querySelectorAll('[data-preset]').forEach((button) => {
      button.addEventListener('click', () => {
        const preset = button.getAttribute('data-preset');
        if (!preset) return;
        if (hotkeyInput) hotkeyInput.value = preset;
        state.settings.general.hotkey = preset;
        queueSave({ general: { hotkey: preset } }, true);
      });
    });

    /* 每日目标 */
    const goalInput = page.querySelector('#set-daily-goal');
    const goalValue = page.querySelector('#set-goal-value');
    if (goalInput) {
      updateRangeFill(goalInput);
      goalInput.addEventListener('input', () => {
        const value = Number(goalInput.value);
        if (goalValue) goalValue.textContent = String(value);
        updateRangeFill(goalInput);
        state.settings.general.dailyGoalMinutes = value;
        queueSave({ general: { dailyGoalMinutes: value } });
      });
    }

    /* 数据 */
    const openDataButton = page.querySelector('#set-open-data');
    if (openDataButton) {
      openDataButton.addEventListener('click', async () => {
        if (!api || !api.app || typeof api.app.openDataFolder !== 'function') {
          toast('当前环境不支持打开数据目录', 'warn');
          return;
        }
        openDataButton.disabled = true;
        try {
          await api.app.openDataFolder();
        } catch (err) {
          toast('打开失败：' + (err && err.message ? err.message : '未知错误'), 'error');
        } finally {
          openDataButton.disabled = false;
        }
      });
    }

    const exportButton = page.querySelector('#set-export');
    if (exportButton) {
      exportButton.addEventListener('click', async () => {
        if (!api || !api.settings || typeof api.settings.exportData !== 'function') {
          toast('当前环境不支持导出备份', 'warn');
          return;
        }
        exportButton.disabled = true;
        try {
          const result = await api.settings.exportData();
          if (result && result.saved) {
            toast('备份已导出到 ' + (result.path || '所选位置'), 'ok');
          } else {
            toast('已取消导出', 'warn');
          }
        } catch (err) {
          toast('导出失败：' + (err && err.message ? err.message : '未知错误'), 'error');
        } finally {
          exportButton.disabled = false;
        }
      });
    }

    const importButton = page.querySelector('#set-import');
    if (importButton) {
      importButton.addEventListener('click', async () => {
        if (!api || !api.settings || typeof api.settings.importData !== 'function') {
          toast('当前环境不支持导入备份', 'warn');
          return;
        }
        const ok = await confirmDialog({
          title: '导入备份？',
          body: '备份会合并到当前数据，同名条目以备份为准。建议先导出一份当前数据。',
          confirmText: '导入',
          danger: false
        });
        if (!ok) return;
        importButton.disabled = true;
        try {
          const result = await api.settings.importData();
          if (result && result.imported) {
            toast(result.message || '备份已导入', 'ok');
            if (ctx && typeof ctx.refreshShell === 'function') {
              try { await ctx.refreshShell(); } catch (err) { /* noop */ }
            }
          } else {
            toast(result && result.message ? result.message : '已取消导入', 'warn');
          }
        } catch (err) {
          const code = err && err.code;
          toast('导入失败：' + (code === 'INVALID_FILE' || code === 'INVALID_BACKUP' ? '所选文件夹不是有效的 Lumen 备份' : (err && err.message ? err.message : '未知错误')), 'error');
        } finally {
          importButton.disabled = false;
        }
      });
    }
  }

  /* ---- 错误 / 骨架 ------------------------------------------------------- */
  function renderSkeleton() {
    page.innerHTML = '<div class="settings-skeleton" aria-hidden="true">' +
      '<div class="settings-skeleton-card"><span class="skeleton is-title"></span><span class="skeleton is-row"></span><span class="skeleton is-row"></span></div>' +
      '<div class="settings-skeleton-card"><span class="skeleton is-title"></span><span class="skeleton is-row"></span></div>' +
      '<div class="settings-skeleton-card"><span class="skeleton is-title"></span><span class="skeleton is-row"></span><span class="skeleton is-row"></span></div>' +
    '</div>';
  }

  function renderError(message) {
    page.innerHTML = '<header class="settings-head">' +
        '<div><p class="settings-eyebrow">Settings</p><h1 class="settings-title">设置</h1>' +
        '<p class="settings-lede">调校你的阅读体验。所有修改都会自动保存，主题会即时生效。</p></div>' +
      '</header>' +
      '<div class="settings-error">' +
        '<div class="settings-error__glyph">' + icon(ctx, 'refresh', 26) + '</div>' +
        '<h2>设置暂时打不开</h2>' +
        '<p>' + esc(message || '无法读取设置数据，请确认通过 Lumen 桌面应用打开。') + '</p>' +
        '<button type="button" class="btn" id="set-retry">' + icon(ctx, 'refresh', 16) + '<span>重新加载</span></button>' +
      '</div>';
    const retry = page.querySelector('#set-retry');
    if (retry) retry.addEventListener('click', () => { load(); });
  }

  /* ---- 加载 -------------------------------------------------------------- */
  async function load() {
    renderSkeleton();
    let settings = null;
    let info = null;

    if (api && api.settings && typeof api.settings.get === 'function') {
      try {
        settings = await api.settings.get();
      } catch (err) {
        settings = null;
      }
    }
    if (!settings) {
      settings = ctx && ctx.state && ctx.state.settings ? ctx.state.settings : null;
    }

    if (api && api.app && typeof api.app.info === 'function') {
      try {
        info = await api.app.info();
      } catch (err) {
        info = null;
      }
    }

    if (!settings) {
      renderError('无法读取设置数据，请确认通过 Lumen 桌面应用打开。');
      return;
    }

    state.settings = normalizeSettings(settings);
    if (ctx.state) ctx.state.settings = state.settings;
    state.info = info || (api && api.platform ? { platform: api.platform } : null);
    applyTheme(state.settings.reader.theme);

    page.innerHTML = pageHtml();
    updateKeyHint();
    updateBehaviorUi();
    updateDictionaryUi();
    bind();
  }

  await load();
}