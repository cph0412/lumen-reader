// Lumen · 通用 UI 工具：转义、toast、modal、confirm、格式化、debounce、焦点圈
import { icons } from './icons.js';

/* ------------------------------ 基础 ------------------------------ */

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

export function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTypingTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  const el = target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
  return Boolean(el);
}

export function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
}

/* ------------------------------ 时间 / 数字 ------------------------------ */

function parseDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function formatDate(iso, style = 'short') {
  const d = parseDate(iso);
  if (!d) return '—';
  const today = startOfDay(new Date());
  const day = startOfDay(d);
  const diffDays = Math.round((today - day) / 86400000);
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays > 1 && diffDays < 7) return diffDays + ' 天前';
  if (style === 'long') {
    return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  }
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return (sameYear ? '' : d.getFullYear() + ' 年 ') + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
}

export function formatDateFull(date = new Date()) {
  const d = parseDate(date) || new Date();
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · ' + weekdays[d.getDay()];
}

export function fmtNumber(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 10000) {
    const k = value / 1000;
    return (k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')) + 'k';
  }
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

export function readingMinutes(wordCount, wpm = 220) {
  const words = Number(wordCount) || 0;
  return Math.max(1, Math.round(words / wpm));
}

/* ------------------------------ debounce / throttle ------------------------------ */

export function debounce(fn, wait = 200, options = {}) {
  let timer = null;
  let lastArgs = null;
  let lastThis = null;
  function invoke() {
    timer = null;
    const args = lastArgs; const self = lastThis;
    lastArgs = lastThis = null;
    fn.apply(self, args || []);
  }
  function debounced(...args) {
    lastArgs = args; lastThis = this;
    if (timer) clearTimeout(timer);
    if (options.leading && !timer) {
      timer = setTimeout(() => { timer = null; }, wait);
      fn.apply(this, args);
      return;
    }
    timer = setTimeout(invoke, wait);
  }
  debounced.cancel = () => { if (timer) clearTimeout(timer); timer = null; lastArgs = lastThis = null; };
  debounced.flush = () => { if (timer) { clearTimeout(timer); invoke(); } };
  debounced.pending = () => Boolean(timer);
  return debounced;
}

export function throttle(fn, wait = 120) {
  let last = 0; let timer = null; let lastArgs = null;
  const invoke = () => { timer = null; last = Date.now(); if (lastArgs) { fn.apply(null, lastArgs); lastArgs = null; } };
  return function throttled(...args) {
    const now = Date.now();
    const remaining = wait - (now - last);
    lastArgs = args;
    if (remaining <= 0) { if (timer) { clearTimeout(timer); timer = null; } invoke(); }
    else if (!timer) timer = setTimeout(invoke, remaining);
  };
}

/* ------------------------------ toast ------------------------------ */

const TONE_META = {
  ok: { icon: 'check', role: 'status' },
  warn: { icon: 'alert', role: 'status' },
  error: { icon: 'alert', role: 'alert' },
  info: { icon: 'info', role: 'status' }
};

function toastStack() {
  let stack = document.getElementById('toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toast-stack';
    stack.className = 'toast-stack';
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
  }
  return stack;
}

export function toast(message, tone = 'ok', options = {}) {
  const text = String(message == null ? '' : message).trim();
  if (!text) return () => {};
  const meta = TONE_META[tone] || TONE_META.ok;
  const stack = toastStack();
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.tone = tone;
  el.setAttribute('role', meta.role);
  el.innerHTML = '<span class="toast-icon">' + icons[meta.icon](16) + '</span><span class="toast-msg">' + escapeHtml(text) + '</span>';
  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    el.classList.remove('is-in');
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 220);
    if (tone === 'error' || tone === 'warn') setTimeout(() => {}, 0);
  };
  const duration = typeof options.duration === 'number' ? options.duration : (tone === 'error' ? 5200 : 3000);
  const timer = setTimeout(close, duration);
  el.addEventListener('click', () => { clearTimeout(timer); close(); });
  return close;
}

/* ------------------------------ 焦点圈 ------------------------------ */

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function trapFocus(container) {
  const previous = document.activeElement;
  const selector = FOCUSABLE;
  function onKeydown(event) {
    if (event.key !== 'Tab') return;
    const nodes = Array.from(container.querySelectorAll(selector)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!nodes.length) { event.preventDefault(); return; }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  }
  container.addEventListener('keydown', onKeydown);
  const firstFocusable = container.querySelector(selector);
  if (firstFocusable) {
    requestAnimationFrame(() => { try { firstFocusable.focus({ preventScroll: true }); } catch (_) {} });
  }
  return function release() {
    container.removeEventListener('keydown', onKeydown);
    if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
      try { previous.focus({ preventScroll: true }); } catch (_) {}
    }
  };
}

/* ------------------------------ modal / confirm ------------------------------ */

function modalRoot() {
  let root = document.getElementById('modal-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'modal-root';
    root.className = 'modal-root';
    document.body.appendChild(root);
  }
  return root;
}

export function modal(html, options = {}) {
  const host = modalRoot();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const title = options.title
    ? '<header class="modal-head"><div class="modal-title-wrap"><span class="modal-eyebrow">' + escapeHtml(options.eyebrow || 'Lumen') + '</span><h2 class="modal-title">' + escapeHtml(options.title) + '</h2></div><button type="button" class="icon-btn modal-x" aria-label="关闭">' + icons.x(17) + '</button></header>'
    : '';
  overlay.innerHTML = '<section class="modal ' + (options.className || '') + '" role="dialog" aria-modal="true"' +
    (options.title ? ' aria-label="' + escapeHtml(options.title) + '"' : '') + '>' + title +
    '<div class="modal-body">' + html + '</div></section>';
  host.appendChild(overlay);
  const dialog = overlay.querySelector('.modal');
  let released = false;
  const release = trapFocus(dialog);
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => overlay.classList.add('is-in'));

  function close(result) {
    if (released) return;
    released = true;
    overlay.classList.remove('is-in');
    setTimeout(() => overlay.remove(), 180);
    document.body.style.overflow = previousOverflow;
    document.removeEventListener('keydown', onKey);
    release();
    if (typeof options.onClose === 'function') options.onClose(result);
  }
  function onKey(event) {
    if (event.key === 'Escape' && options.dismissible !== false) { event.stopPropagation(); close(undefined); }
  }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay && options.dismissible !== false) close(undefined);
  });
  overlay.querySelector('.modal-x')?.addEventListener('click', () => close(undefined));

  return { close, root: dialog, overlay };
}

export function confirm(opts = {}) {
  const title = escapeHtml(opts.title || '确认操作');
  const body = escapeHtml(opts.body || '');
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; resolve(value); };
    const m = modal(
      '<p class="modal-copy">' + body + '</p>' +
      '<footer class="modal-foot">' +
      '<button type="button" class="btn ghost" data-confirm="no">' + escapeHtml(opts.cancelText || '取消') + '</button>' +
      '<button type="button" class="btn ' + (opts.danger ? 'danger' : 'primary') + '" data-confirm="yes">' + escapeHtml(opts.confirmText || '确定') + '</button>' +
      '</footer>',
      { title, className: 'modal--confirm', onClose: () => finish(false) }
    );
    m.root.querySelector('[data-confirm="no"]')?.addEventListener('click', () => { finish(false); m.close(); });
    m.root.querySelector('[data-confirm="yes"]')?.addEventListener('click', () => { finish(true); m.close(); });
    requestAnimationFrame(() => {
      const yes = m.root.querySelector('[data-confirm="yes"]');
      const no = m.root.querySelector('[data-confirm="no"]');
      ((opts.danger ? no : yes) || yes)?.focus({ preventScroll: true });
    });
  });
}

/* ------------------------------ 其它小工具 ------------------------------ */

export function friendlyError(error, fallback = '操作失败，请稍后再试') {
  if (!error) return fallback;
  const code = error.code || '';
  const map = {
    NO_AI_KEY: '尚未配置 AI 密钥，请前往设置',
    NETWORK: '网络不可用，请检查网络连接',
    NOT_FOUND: '内容不存在或已被移除',
    INVALID_FILE: '文件无法识别，请选择 UTF-8 / TXT 英文原著',
    TIMEOUT: '请求超时，请稍后重试',
    EMPTY: '没有找到可用的内容'
  };
  return map[code] || error.message || fallback;
}

export function statusLabel(status) {
  return ({ unread: '未读', reading: '在读', finished: '已读完' })[status] || '未读';
}

export function wordCountOf(text) {
  const matches = String(text || '').match(/[A-Za-z][A-Za-z'’-]*/g);
  return matches ? matches.length : 0;
}

export function truncate(text, max = 80) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}
