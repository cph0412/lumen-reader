// Lumen · 应用外壳：路由、侧边栏、主题、全局快捷键
import { icons } from './icons.js';
import {
  toast, confirm, modal, escapeHtml, formatDate, fmtNumber,
  trapFocus, isTypingTarget, friendlyError
} from './ui.js';
import { render as renderLibrary } from './pages/library.js';
import { render as renderReader } from './pages/reader.js';

/* ------------------------------ 常量 ------------------------------ */

const FALLBACK_SETTINGS = {
  ai: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hasApiKey: false, keyHint: '', temperature: 0.3 },
  translation: { provider: 'auto', target: 'zh-CN' },
  reader: {
    theme: 'paper', fontSize: 19, lineHeight: 1.9, fontFamily: 'serif', contentWidth: 700,
    letterSpacing: 0, justify: false, highlightVocab: true, autoTranslate: true, autoAnalyze: true
  },
  general: { hotkey: 'Alt+Space', minimizeToTray: true, dailyGoalMinutes: 20 }
};

const PAGES = {
  library: { label: '书库', icon: 'library', title: '书库' },
  vocab: { label: '生词本', icon: 'layers', title: '生词本' },
  review: { label: '复习', icon: 'rotate', title: '复习' },
  stats: { label: '足迹', icon: 'chart', title: '足迹' },
  settings: { label: '设置', icon: 'settings', title: '设置' }
};

const SECONDARY_MODULES = {
  vocab: './pages/vocab.js',
  review: './pages/review.js',
  stats: './pages/stats.js',
  settings: './pages/settings.js'
};

const NAV_ORDER = ['library', 'vocab', 'review', 'stats'];
const THEME_ORDER = ['paper', 'sepia', 'dark'];
const THEME_LABEL = { paper: '纸白', sepia: '暖褐', dark: '暗夜' };
const KNOWN_ROUTES = ['library', 'read', 'vocab', 'review', 'stats', 'settings'];

/* ------------------------------ 状态 ------------------------------ */

const state = { books: [], settings: null, vocabStats: {} };
const moduleCache = new Map();
const els = {};
let ctx = null;
let currentName = '';
let currentKey = '';
let refreshPromise = null;
let booted = false;

/* ------------------------------ 小工具 ------------------------------ */

const hasApi = () => Boolean(window.lumen);

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && base && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      out[key] = deepMerge(base[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function normalizeSettings(raw) {
  return deepMerge(FALLBACK_SETTINGS, raw && typeof raw === 'object' ? raw : {});
}

function normalizeBooks(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((book) => book && typeof book === 'object' && book.id);
}

function dueCount() {
  const stats = state.vocabStats || {};
  return asNumber(stats.due, asNumber(stats.dueCount, asNumber(stats.dueToday, 0)));
}

function totalWords() {
  const stats = state.vocabStats || {};
  return asNumber(stats.total, asNumber(stats.totalWords, 0));
}

function recentBook() {
  const withDate = state.books.filter((book) => book.lastOpenedAt);
  if (!withDate.length) return state.books[0] || null;
  return withDate.slice().sort((a, b) => new Date(b.lastOpenedAt) - new Date(a.lastOpenedAt))[0];
}

function findBook(id) {
  return state.books.find((book) => book && book.id === id) || null;
}

/* ------------------------------ 主题 ------------------------------ */

function applyTheme(theme) {
  const next = THEME_ORDER.includes(theme) ? theme : 'paper';
  document.documentElement.dataset.theme = next;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'dark' ? '#151513' : '#f6f1e7');
}

function currentTheme() {
  const theme = state.settings && state.settings.reader && state.settings.reader.theme;
  return THEME_ORDER.includes(theme) ? theme : 'paper';
}

async function cycleTheme() {
  if (!hasApi()) return;
  const next = THEME_ORDER[(THEME_ORDER.indexOf(currentTheme()) + 1) % THEME_ORDER.length];
  if (state.settings) state.settings.reader.theme = next;
  applyTheme(next);
  renderSidebar();
  try {
    const saved = await window.lumen.settings.save({ reader: { theme: next } });
    if (saved) state.settings = normalizeSettings(saved);
    toast('已切换为「' + THEME_LABEL[next] + '」主题', 'ok');
  } catch (error) {
    toast('主题保存失败：' + friendlyError(error), 'error');
  }
}

/* ------------------------------ 数据 ------------------------------ */

async function loadState(first = false) {
  const api = window.lumen;
  if (!api) return;
  const [booksResult, settingsResult, statsResult] = await Promise.allSettled([
    api.library.list(),
    api.settings.get(),
    api.vocab.stats()
  ]);
  if (booksResult.status === 'fulfilled') state.books = normalizeBooks(booksResult.value);
  else if (first) state.books = [];
  if (settingsResult.status === 'fulfilled') state.settings = normalizeSettings(settingsResult.value);
  else if (!state.settings) state.settings = normalizeSettings(null);
  if (statsResult.status === 'fulfilled') state.vocabStats = statsResult.value && typeof statsResult.value === 'object' ? statsResult.value : {};
  if (booksResult.status === 'rejected') console.warn('[lumen] library.list failed:', booksResult.reason);
  if (settingsResult.status === 'rejected') console.warn('[lumen] settings.get failed:', settingsResult.reason);
}

async function refreshShell() {
  if (!hasApi()) return;
  if (refreshPromise) return refreshPromise;
  refreshPromise = loadState(false)
    .then(() => { applyTheme(currentTheme()); renderSidebar(); })
    .catch((error) => { console.warn('[lumen] refreshShell failed', error); })
    .finally(() => { refreshPromise = null; });
  return refreshPromise;
}

/* ------------------------------ 路由 ------------------------------ */

function parseRoute() {
  const rawHash = String(location.hash || '').replace(/^#\/?/, '');
  const clean = rawHash.replace(/\/+$/, '');
  const [pathPart] = clean.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const name = segments[0] || 'library';
  const invalid = !KNOWN_ROUTES.includes(name);
  const safeName = invalid ? 'library' : name;
  return {
    name: safeName,
    raw: invalid ? 'library' : (clean || 'library'),
    segments: invalid ? ['library'] : segments,
    invalid,
    bookId: safeName === 'read' ? (segments[1] || null) : null,
    chapterIndex: safeName === 'read' && segments[2] !== undefined && segments[2] !== '' ? Number(segments[2]) : null
  };
}

function normalizePath(path) {
  return String(path == null ? 'library' : path).trim().replace(/^#?\/?/, '').replace(/^#/, '');
}

function navigate(path) {
  const target = normalizePath(path);
  if (!target) return;
  const nextHash = '#/' + target;
  if (location.hash === nextHash) {
    route(true);
    return;
  }
  location.hash = nextHash;
}

function openBook(id, chapter) {
  if (!id) return;
  const chapterPart = Number.isFinite(Number(chapter)) && chapter !== null && chapter !== '' ? '/' + Math.max(0, Math.floor(Number(chapter))) : '';
  navigate('read/' + encodeURIComponent(id) + chapterPart);
}

function lastReadBookId() {
  const book = recentBook();
  return book ? book.id : null;
}

async function route(force = false) {
  const parsed = parseRoute();
  const key = parsed.name + ':' + parsed.raw;
  if (!force && key === currentKey) return;
  currentKey = key;
  currentName = parsed.name;

  if (parsed.invalid) {
    try { history.replaceState(null, '', '#/library'); } catch (error) { /* ignore */ }
  }

  // 通知上一页做清理（保存进度、停止朗读、移除监听）
  try { window.dispatchEvent(new CustomEvent('lumen:route-leave')); } catch (error) { /* ignore */ }
  document.documentElement.dataset.route = parsed.name;
  document.title = (parsed.name === 'read' ? '阅读' : PAGES[parsed.name].title) + ' · Lumen 流明阅读';
  renderSidebar();
  updateTitlebar(parsed);

  els.view.classList.remove('page-enter');
  els.view.innerHTML = '';
  void els.view.offsetWidth;
  els.view.scrollTop = 0;

  try {
    await mountPage(parsed);
  } catch (error) {
    console.error('[lumen] route failed', error);
    renderRouteError(error, parsed);
  }
  if (!els.view.childElementCount) renderRouteError(new Error('页面为空'), parsed);
  els.view.classList.add('page-enter');
  window.__LUMEN_ROUTE__ = { name: parsed.name, raw: parsed.raw, key, at: Date.now() };
}

async function mountPage(parsed) {
  if (!ctx) return;
  if (parsed.name === 'library') return renderLibrary(els.view, ctx);
  if (parsed.name === 'read') return renderReader(els.view, ctx);
  const mod = await loadSecondary(parsed.name);
  if (!mod) { renderModuleMissing(parsed.name); return; }
  return mod.render(els.view, ctx);
}

async function loadSecondary(name) {
  if (moduleCache.has(name)) return moduleCache.get(name);
  const spec = SECONDARY_MODULES[name];
  if (!spec) return null;
  try {
    const mod = await import(spec);
    if (typeof mod.render !== 'function') throw new Error('页面模块缺少 render(root, ctx) 导出');
    moduleCache.set(name, mod);
    return mod;
  } catch (error) {
    console.warn('[lumen] secondary module unavailable:', name, error);
    return null;
  }
}

/* ------------------------------ 页面兜底 ------------------------------ */

function renderModuleMissing(name) {
  const page = PAGES[name] || { label: '页面', icon: 'sparkles' };
  els.view.innerHTML =
    '<div class="page"><div class="empty">' +
    '<div class="empty-icon">' + icons[page.icon](26) + '</div>' +
    '<h3>' + escapeHtml(page.label) + '页面正在接入</h3>' +
    '<p>该模块尚未就绪，可能仍在安装或初始化。稍后重新加载即可。</p>' +
    '<div class="empty-actions"><button type="button" class="btn primary" data-retry>重新加载</button><button type="button" class="btn ghost" data-home>回到书库</button></div>' +
    '</div></div>';
  els.view.querySelector('[data-retry]')?.addEventListener('click', () => route(true));
  els.view.querySelector('[data-home]')?.addEventListener('click', () => navigate('library'));
}

function renderRouteError(error, parsed) {
  const message = friendlyError(error, '页面加载失败，请稍后再试');
  els.view.innerHTML =
    '<div class="page"><div class="empty">' +
    '<div class="empty-icon">' + icons.alert(26) + '</div>' +
    '<h3>页面没能打开</h3>' +
    '<p>' + escapeHtml(message) + '</p>' +
    '<div class="empty-actions"><button type="button" class="btn primary" data-retry>重试</button><button type="button" class="btn ghost" data-home>回到书库</button></div>' +
    '</div></div>';
  els.view.querySelector('[data-retry]')?.addEventListener('click', () => route(true));
  els.view.querySelector('[data-home]')?.addEventListener('click', () => navigate('library'));
}

function renderNoElectron() {
  document.documentElement.dataset.route = 'noop';
  els.sidebarNav.innerHTML = '';
  els.sidebarFoot.innerHTML = '';
  els.windowControls.hidden = true;
  els.titlebarCenter.textContent = '界面预览';
  els.view.innerHTML =
    '<div class="page no-electron"><div class="empty">' +
    '<div class="empty-icon">' + icons.bookOpen(26) + '</div>' +
    '<h3>需要 Electron 环境</h3>' +
    '<p>Lumen 的本地书库、翻译与生词服务运行在 Electron 主进程中。当前页面在普通浏览器里打开，只能看到界面外壳。</p>' +
    '<p class="muted">请在项目根目录运行 <code>npm start</code> 启动完整应用。</p>' +
    '<div class="empty-actions"><button type="button" class="btn primary" data-reload>重新检测</button></div>' +
    '</div></div>';
  els.view.querySelector('[data-reload]')?.addEventListener('click', () => location.reload());
  document.title = '需要 Electron 环境 · Lumen 流明阅读';
}

/* ------------------------------ 侧边栏 / 标题栏 ------------------------------ */

function navItemHtml(name, options = {}) {
  const page = PAGES[name];
  const active = (currentName === 'read' ? 'library' : currentName) === name;
  const badge = options.badge ? '<span class="side-badge">' + escapeHtml(String(options.badge)) + '</span>' : '';
  return '<button type="button" class="side-item' + (active ? ' active' : '') + '" data-nav="' + name + '"' +
    (options.disabled ? ' disabled' : '') +
    ' data-tip="' + escapeHtml(page.label) + '" data-tip-pos="right" aria-label="' + escapeHtml(page.label) + '"' +
    (active ? ' aria-current="page"' : '') + '>' +
    '<span class="side-ico">' + icons[page.icon](20) + '</span>' +
    '<span class="side-label">' + escapeHtml(page.label) + '</span>' + badge + '</button>';
}

function renderSidebar() {
  if (!hasApi() && booted) { els.sidebarNav.innerHTML = ''; els.sidebarFoot.innerHTML = ''; return; }
  const due = dueCount();
  els.sidebarNav.innerHTML = NAV_ORDER.map((name) => navItemHtml(name, {
    badge: name === 'review' && due > 0 ? Math.min(due, 99) : 0
  })).join('');
  const theme = currentTheme();
  els.sidebarFoot.innerHTML =
    navItemHtml('settings', {}) +
    '<button type="button" class="side-item" data-theme-cycle data-tip="切换主题 · ' + THEME_LABEL[theme] + '" data-tip-pos="right" aria-label="切换主题">' +
    '<span class="side-ico">' + icons[theme === 'dark' ? 'sun' : 'moon'](20) + '</span>' +
    '<span class="side-label">' + (theme === 'dark' ? '浅色主题' : '深色主题') + '</span></button>';
}

function updateTitlebar(parsed) {
  const el = els.titlebarCenter;
  if (!el) return;
  if (!hasApi()) { el.textContent = '界面预览'; return; }
  let label = parsed.name === 'read' ? '阅读器' : (PAGES[parsed.name] ? PAGES[parsed.name].label : '');
  if (parsed.name === 'read' && parsed.bookId) {
    const book = findBook(parsed.bookId);
    if (book) label = book.title;
  }
  el.innerHTML = escapeHtml(label) + '<span class="dot"></span><span>流明阅读</span>';
}

/* ------------------------------ 全局键盘 ------------------------------ */

function onGlobalKeydown(event) {
  if (!hasApi() || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
  const digit = Number(event.key);
  if (!Number.isInteger(digit) || digit < 1 || digit > 6) return;
  if (isTypingTarget(event.target)) return;
  event.preventDefault();
  if (digit === 6) {
    const id = lastReadBookId();
    if (id) openBook(id);
    else toast('书架还空着，先导入一本书吧', 'warn');
    return;
  }
  const target = ['library', 'vocab', 'review', 'stats', 'settings'][digit - 1];
  if (target) navigate(target);
}

/* ------------------------------ 事件绑定 ------------------------------ */

function bindApiEvents() {
  const events = window.lumen && window.lumen.events;
  if (!events) return;
  try {
    events.onNavigate?.((data) => {
      if (!data || typeof data !== 'object') return;
      if (data.bookId) { openBook(data.bookId); return; }
      const path = normalizePath(data.route || 'library');
      if (path.startsWith('read/')) navigate(path);
      else if (KNOWN_ROUTES.includes(path.split('/')[0])) navigate(path);
    });
  } catch (error) { console.warn('[lumen] onNavigate unavailable', error); }
  try {
    events.onTheme?.((theme) => {
      if (!THEME_ORDER.includes(theme)) return;
      if (state.settings) state.settings.reader.theme = theme;
      applyTheme(theme);
      renderSidebar();
    });
  } catch (error) { console.warn('[lumen] onTheme unavailable', error); }
  try {
    events.onSettingsChanged?.((saved) => {
      if (!saved || typeof saved !== 'object') return;
      state.settings = normalizeSettings(saved);
      applyTheme(currentTheme());
      renderSidebar();
    });
  } catch (error) { console.warn('[lumen] onSettingsChanged unavailable', error); }
  try {
    events.onQuickLookup?.(() => { /* 划词浮窗由独立窗口处理；主界面无需介入 */ });
  } catch (error) { /* ignore */ }
}

function bindShell() {
  els.sidebar.addEventListener('click', (event) => {
    const themeButton = event.target.closest('[data-theme-cycle]');
    if (themeButton) { cycleTheme(); return; }
    const navButton = event.target.closest('[data-nav]');
    if (!navButton || navButton.disabled) return;
    navigate(navButton.dataset.nav);
  });

  const titlebar = els.titlebar;
  titlebar.addEventListener('dblclick', (event) => {
    if (event.target.closest('.window-controls')) return;
    if (!hasApi()) return;
    window.lumen.app.windowAction('maximize').catch(() => {});
  });

  els.windowControls.querySelectorAll('[data-win]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!hasApi()) return;
      window.lumen.app.windowAction(button.dataset.win).catch(() => {});
    });
  });

  window.addEventListener('keydown', onGlobalKeydown);
  window.addEventListener('hashchange', () => { if (!hasApi()) return; route(false); });
  window.addEventListener('resize', () => {
    const width = window.innerWidth;
    document.documentElement.dataset.width = width < 900 ? 'sm' : width < 1200 ? 'md' : 'lg';
  });
}

function decorateWindowControls() {
  const labels = { minimize: 'minimize', maximize: 'maximize', close: 'close' };
  els.windowControls.querySelectorAll('[data-win]').forEach((button) => {
    button.innerHTML = icons[labels[button.dataset.win]](15);
  });
  if (!hasApi()) els.windowControls.hidden = true;
}

function createCtx() {
  return {
    api: window.lumen,
    navigate,
    toast,
    icons,
    state,
    refreshShell,
    openBook,
    confirm,
    modal,
    escapeHtml,
    formatDate,
    fmtNumber
  };
}

/* ------------------------------ 启动 ------------------------------ */

function bootLoadingHtml() {
  return '<div class="page boot-loading">' +
    '<div class="empty"><span class="spinner lg"></span><p>正在唤醒书库…</p></div>' +
    '</div>';
}

async function boot() {
  els.app = document.getElementById('app');
  els.view = document.getElementById('view');
  els.sidebar = document.getElementById('sidebar');
  els.sidebarNav = document.getElementById('side-nav');
  els.sidebarFoot = document.getElementById('side-foot');
  els.titlebar = document.getElementById('titlebar');
  els.titlebarCenter = document.getElementById('titlebar-center');
  els.windowControls = document.getElementById('window-controls');

  booted = true;
  document.documentElement.dataset.width = window.innerWidth < 900 ? 'sm' : window.innerWidth < 1200 ? 'md' : 'lg';
  decorateWindowControls();
  bindShell();
  ctx = createCtx();

  if (!hasApi()) { renderNoElectron(); return; }

  els.view.innerHTML = bootLoadingHtml();
  try {
    await loadState(true);
  } catch (error) {
    console.warn('[lumen] initial state failed', error);
  }
  applyTheme(currentTheme());
  renderSidebar();
  bindApiEvents();
  await route(true);
}

boot().catch((error) => {
  console.error('[lumen] boot failed', error);
  const view = document.getElementById('view');
  if (view) {
    view.innerHTML = '<div class="page"><div class="empty">' +
      '<div class="empty-icon">' + icons.alert(26) + '</div><h3>应用启动遇到问题</h3>' +
      '<p>' + escapeHtml(error && error.message ? error.message : '未知错误') + '</p>' +
      '<div class="empty-actions"><button class="btn primary" data-reload>重新加载</button></div></div></div>';
    view.querySelector('[data-reload]')?.addEventListener('click', () => location.reload());
  }
});
