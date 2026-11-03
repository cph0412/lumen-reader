/**
 * Lumen · 流明阅读 — 复习页面模块（#/review）
 * 契约：export async function render(root, ctx)
 *
 * 数据：api.vocab.due / review / list / schedule（可选），api.stats.overview
 * 记忆：艾宾浩斯记忆曲线（R = e^(-t/S) 的示意衰减），阶段随当前卡平滑更新。
 * 交互：空格或点击翻面，1-4 评分；轻柔的卡片切换动效；完成/空/错误态齐全。
 *
 * 防御式读取：memory / schedule 均可能缺席，全部以本地默认间隔兜底，不向用户报错。
 */

const FALLBACK_ICONS = {
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9.5a3.5 3.5 0 0 1 0 5"/><path d="M18.5 7a7 7 0 0 1 0 10"/>',
  flame: '<path d="M12 3c3 4 5 5.5 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2.5-5 .5 1.5 1.5 2 2.5 2 0-2 0-4 0-6z"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 1.8"/>',
  check: '<path d="m5 13 4 4L19 7"/>',
  chart: '<path d="M4 20h16"/><path d="M7 20v-6"/><path d="M12 20V8"/><path d="M17 20v-9"/>',
  sparkles: '<path d="m12 4 1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4z"/><path d="M18 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/>',
  arrowLeft: '<path d="M19 12H5m0 0 6-6m-6 6 6 6"/>',
  chevronDown: '<path d="M6 9.5l6 6 6-6"/>',
  dot: '<circle cx="12" cy="12" r="3"/>'
};

const RATINGS = [
  { value: 'again', label: '重来', key: '1' },
  { value: 'hard', label: '困难', key: '2' },
  { value: 'good', label: '记得', key: '3' },
  { value: 'easy', label: '简单', key: '4' }
];

const RATING_VALUES = RATINGS.map((item) => item.value);
const RATING_KEYS = RATINGS.map((item) => item.key);
const RATING_LABELS = { again: '重来', hard: '困难', good: '记得', easy: '简单' };

/* 内置艾宾浩斯阶段（小时）：5 分钟 → 120 天。后端 vocab.schedule() 缺席时兜底。 */
const FALLBACK_INTERVALS = [
  { stage: 0, hours: 1 / 12, label: '5 分钟' },
  { stage: 1, hours: 0.5, label: '30 分钟' },
  { stage: 2, hours: 12, label: '12 小时' },
  { stage: 3, hours: 24, label: '1 天' },
  { stage: 4, hours: 48, label: '2 天' },
  { stage: 5, hours: 96, label: '4 天' },
  { stage: 6, hours: 168, label: '7 天' },
  { stage: 7, hours: 360, label: '15 天' },
  { stage: 8, hours: 720, label: '30 天' },
  { stage: 9, hours: 1440, label: '60 天' },
  { stage: 10, hours: 2880, label: '120 天' }
];

const FALLBACK_SCHEDULE = {
  intervals: FALLBACK_INTERVALS,
  maxStage: FALLBACK_INTERVALS.length - 1,
  source: 'fallback'
};

/* 曲线绘图区（viewBox 坐标） */
const CHART = { w: 260, h: 126, padL: 12, padR: 12, padT: 12, padB: 32, decay: 3 };

/* ---- 纯函数工具 ---------------------------------------------------------- */
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampStage(value, maxStage) {
  const number = toNumber(value);
  const max = toNumber(maxStage);
  const top = max !== null && max > 0 ? max : FALLBACK_SCHEDULE.maxStage;
  const stage = number !== null ? Math.round(number) : 0;
  return Math.min(Math.max(0, stage), top);
}

function hoursLabel(hours) {
  const value = toNumber(hours);
  if (value === null || value <= 0) return '稍后';
  if (value < 1) return Math.max(1, Math.round(value * 60)) + ' 分钟';
  if (value < 24) {
    const rounded = Math.round(value * 10) / 10;
    return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)) + ' 小时';
  }
  return Math.max(1, Math.round(value / 24)) + ' 天';
}

/** 后端标签可能是「5分钟」，统一成「5 分钟」以与内置兜底一致。 */
function normalizeIntervalLabel(label, hours) {
  const text = typeof label === 'string' ? label.trim() : '';
  if (!text) return hoursLabel(hours);
  return text.replace(/^(\d+(?:\.\d+)?)\s*(分钟|小时|天)$/, '$1 $2');
}

function normalizeSchedule(raw) {
  const source = raw && typeof raw === 'object' ? raw : null;
  const list = source && Array.isArray(source.intervals) ? source.intervals : null;
  const cleaned = [];
  const seen = Object.create(null);
  if (list) {
    list.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const stage = toNumber(item.stage);
      const hours = toNumber(item.hours);
      if (stage === null || stage < 0 || hours === null || hours <= 0) return;
      const key = String(Math.round(stage));
      if (seen[key]) return;
      seen[key] = true;
      cleaned.push({ stage: Math.round(stage), hours, label: normalizeIntervalLabel(item.label, hours) });
    });
  }
  if (cleaned.length < 2) {
    return { intervals: FALLBACK_INTERVALS.slice(), maxStage: FALLBACK_SCHEDULE.maxStage, source: 'fallback' };
  }
  cleaned.sort((a, b) => a.stage - b.stage);
  const declared = toNumber(source && source.maxStage);
  const lastStage = cleaned[cleaned.length - 1].stage;
  const maxStage = Math.max(declared !== null && declared >= 0 ? Math.round(declared) : 0, lastStage);
  return { intervals: cleaned, maxStage, source: 'api' };
}

function stageInfoFor(schedule, stage) {
  const intervals = schedule && Array.isArray(schedule.intervals) ? schedule.intervals : FALLBACK_INTERVALS;
  let fallback = intervals[0] || FALLBACK_INTERVALS[0];
  for (let i = 0; i < intervals.length; i += 1) {
    const item = intervals[i];
    if (!item) continue;
    if (item.stage === stage) return item;
    if (item.stage < stage) fallback = item;
  }
  return fallback;
}

function stageName(stage) {
  return '第 ' + (Math.max(0, Math.round(Number(stage) || 0)) + 1) + ' 阶段';
}

/** 旧数据兜底：无 memory 时按 srs / mastery 估算阶段。 */
function deriveStage(word, schedule) {
  const maxStage = schedule.maxStage;
  const memory = word && word.memory && typeof word.memory === 'object' ? word.memory : null;
  if (memory && toNumber(memory.stage) !== null) return clampStage(memory.stage, maxStage);
  const srs = word && word.srs && typeof word.srs === 'object' ? word.srs : null;
  const days = srs ? toNumber(srs.interval) : null;
  if (days !== null && days > 0) {
    const hours = days * 24;
    let stage = 0;
    (schedule.intervals || []).forEach((item) => {
      if (item && item.hours <= hours + 1e-6) stage = Math.max(stage, item.stage);
    });
    return clampStage(stage, maxStage);
  }
  const mastery = word ? toNumber(word.mastery) : null;
  if (mastery !== null) return clampStage(Math.round(mastery * 2), maxStage);
  return 0;
}

function readMemory(word, schedule) {
  const maxStage = schedule.maxStage;
  const raw = word && word.memory && typeof word.memory === 'object' ? word.memory : null;
  const stage = raw && toNumber(raw.stage) !== null ? clampStage(raw.stage, maxStage) : deriveStage(word, schedule);
  const info = stageInfoFor(schedule, stage);
  const rawHours = raw ? toNumber(raw.intervalHours) : null;
  const intervalHours = rawHours !== null && rawHours > 0 ? rawHours : (info ? info.hours : 0);
  const due = raw && typeof raw.due === 'string' && raw.due
    ? raw.due
    : (word && word.srs && typeof word.srs.due === 'string' ? word.srs.due : null);
  const history = raw && Array.isArray(raw.history) ? raw.history : [];
  const srs = word && word.srs && typeof word.srs === 'object' ? word.srs : null;
  const reps = srs ? toNumber(srs.reps) : null;
  const lapses = raw && toNumber(raw.lapses) !== null
    ? Number(raw.lapses)
    : (srs && toNumber(srs.lapses) !== null ? Number(srs.lapses) : 0);
  const lastRating = raw && typeof raw.lastRating === 'string' && RATING_LABELS[raw.lastRating]
    ? raw.lastRating
    : null;
  return {
    stage,
    stageInfo: info,
    intervalHours,
    intervalLabel: info && info.label ? info.label : hoursLabel(intervalHours),
    due,
    lastRating,
    lapses,
    reviews: history.length > 0 ? history.length : (reps !== null && reps > 0 ? reps : 0),
    hasMemory: Boolean(raw)
  };
}

/** 评分 → 目标阶段（与后端 Ebbinghaus 映射保持一致）。 */
function ratingPreview(rating, currentStage, schedule) {
  const maxStage = schedule.maxStage;
  const stage = clampStage(currentStage, maxStage);
  let target = stage;
  if (rating === 'again') target = 0;
  else if (rating === 'hard') target = Math.max(0, stage - 1);
  else if (rating === 'easy') target = Math.min(maxStage, stage + 2);
  else target = Math.min(maxStage, stage + 1);
  const info = stageInfoFor(schedule, target);
  const hours = info ? info.hours : 0;
  return { stage: target, hours, label: info && info.label ? info.label : hoursLabel(hours) };
}

/* ---- 页面级小工具 -------------------------------------------------------- */
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

function formatDate(ctx, iso, style) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  if (ctx && typeof ctx.formatDate === 'function') {
    try { return ctx.formatDate(iso, style); } catch (err) { /* noop */ }
  }
  return (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日';
}

function formatNumber(ctx, value) {
  if (ctx && typeof ctx.fmtNumber === 'function') {
    try { return ctx.fmtNumber(value); } catch (err) { /* noop */ }
  }
  return String(value == null ? 0 : value);
}

function highlightWord(rawText, word, esc) {
  const text = String(rawText || '');
  if (!text) return '';
  const needle = String(word || '').trim();
  if (!needle) return esc(text);
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return esc(text);
  return esc(text.slice(0, index)) +
    '<mark>' + esc(text.slice(index, index + needle.length)) + '</mark>' +
    esc(text.slice(index + needle.length));
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/* ---- 语音合成 ------------------------------------------------------------ */
function createSpeech() {
  let warmed = false;

  function ensureVoices() {
    if (warmed || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    warmed = true;
    try {
      const prime = () => { window.speechSynthesis.getVoices(); };
      prime();
      window.speechSynthesis.addEventListener('voiceschanged', prime, { once: true });
    } catch (err) { /* noop */ }
  }

  return {
    speak(text) {
      return new Promise((resolve, reject) => {
        if (!text) { reject(new Error('没有可朗读的文本')); return; }
        if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
          reject(new Error('当前环境不支持语音朗读'));
          return;
        }
        try {
          ensureVoices();
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(String(text));
          utterance.lang = 'en-US';
          utterance.rate = 0.9;
          const voices = window.speechSynthesis.getVoices() || [];
          const preferred =
            voices.find((v) => /en-US/i.test(v.lang) && /(samantha|aria|jenny|zira|female|natural)/i.test(v.name)) ||
            voices.find((v) => /en-US/i.test(v.lang)) ||
            voices.find((v) => /^en/i.test(v.lang));
          if (preferred) utterance.voice = preferred;
          utterance.onend = () => resolve();
          utterance.onerror = (event) => reject(new Error(event && event.error ? '朗读失败：' + event.error : '朗读失败'));
          window.speechSynthesis.speak(utterance);
        } catch (err) {
          reject(err instanceof Error ? err : new Error('朗读失败'));
        }
      });
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
  const navigate = (route) => {
    if (ctx && typeof ctx.navigate === 'function') {
      try { ctx.navigate(route); } catch (err) { /* noop */ }
    }
  };

  const speech = createSpeech();
  const state = {
    mode: 'loading',
    queue: [],
    dueCount: 0,
    streak: 0,
    todayReviewed: 0,
    round: 1,
    roundReviewed: 0,
    totalReviewed: 0,
    correct: 0,
    ratings: { again: 0, hard: 0, good: 0, easy: 0 },
    againWords: [],
    revealed: false,
    busy: false,
    nextDue: null,
    dictionary: new Map(),
    reqId: 0,
    /* 记忆曲线相关 */
    schedule: normalizeSchedule(null),
    scheduleKey: '',
    memory: null,
    currentWordId: null,
    sideMounted: false,
    stageCounts: Object.create(null)
  };

  root.innerHTML =
    '<div class="review-page page">' +
      '<header class="review-head">' +
        '<div class="review-head-top">' +
          '<div>' +
            '<p class="review-eyebrow">Review</p>' +
            '<h1 class="review-title">今日复习</h1>' +
            '<p class="review-lede">先想，再翻面。间隔重复会把记忆一点点加固。</p>' +
          '</div>' +
          '<div class="review-chips">' +
            '<div class="review-chip review-chip--due"><span class="review-chip__num" id="review-due">—</span><span class="review-chip__label">个到期</span></div>' +
            '<div class="review-chip review-chip--streak"><span class="review-chip__num" id="review-streak">0</span><span class="review-chip__label">连续天数</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="review-progress" role="progressbar" aria-label="复习进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="review-progress">' +
          '<span class="review-progress__bar" id="review-progress-bar"></span>' +
        '</div>' +
        '<div class="review-progress-meta">' +
          '<span id="review-progress-label">正在准备今日队列…</span>' +
          '<span id="review-progress-count"></span>' +
        '</div>' +
      '</header>' +
      '<section class="review-stage" id="review-stage" aria-live="polite">' +
        '<div class="review-layout" id="review-layout">' +
          '<div class="review-main" id="review-main"></div>' +
          '<aside class="review-side" id="review-side" hidden aria-label="记忆曲线"></aside>' +
        '</div>' +
      '</section>' +
    '</div>';

  const els = {
    page: root.querySelector('.review-page'),
    due: root.querySelector('#review-due'),
    streak: root.querySelector('#review-streak'),
    progress: root.querySelector('#review-progress'),
    progressBar: root.querySelector('#review-progress-bar'),
    progressLabel: root.querySelector('#review-progress-label'),
    progressCount: root.querySelector('#review-progress-count'),
    stage: root.querySelector('#review-stage'),
    layout: root.querySelector('#review-layout'),
    main: root.querySelector('#review-main'),
    side: root.querySelector('#review-side')
  };

  /* ---- 顶部信息 ---------------------------------------------------------- */
  function paintChips() {
    if (els.due) els.due.textContent = formatNumber(ctx, state.dueCount);
    if (els.streak) els.streak.textContent = formatNumber(ctx, state.streak);
  }

  function paintProgress() {
    const remaining = state.queue.length;
    const total = state.roundReviewed + remaining;
    const percent = total > 0 ? Math.round((state.roundReviewed / total) * 100) : 0;
    if (els.progressBar) els.progressBar.style.width = percent + '%';
    if (els.progress) els.progress.setAttribute('aria-valuenow', String(percent));
    if (els.progressLabel) {
      if (state.mode === 'review') {
        els.progressLabel.textContent = '第 ' + state.round + ' 轮 · 已复习 ' + state.roundReviewed + ' / ' + total;
      } else if (state.mode === 'finish') {
        els.progressLabel.textContent = '今日复习完成';
      } else if (state.mode === 'empty') {
        els.progressLabel.textContent = '今天没有到期单词';
      } else {
        els.progressLabel.textContent = '正在准备今日队列…';
      }
    }
    if (els.progressCount) {
      els.progressCount.textContent = state.totalReviewed > 0
        ? '今日累计 ' + state.totalReviewed + ' 个 · 连续 ' + state.streak + ' 天'
        : '';
    }
  }

  /* ---- 下一次复习时间 ---------------------------------------------------- */
  function nextDueLabel() {
    if (!state.nextDue) return '暂无排程';
    const date = new Date(state.nextDue);
    if (Number.isNaN(date.getTime())) return '暂无排程';
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const diffDays = Math.round((startTarget - startToday) / dayMs);
    const time = String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    if (diffDays === 0) return '今天 ' + time;
    if (diffDays === 1) return '明天 ' + time;
    if (diffDays < 7) return diffDays + ' 天后（' + formatDate(ctx, date.toISOString(), 'short') + ' ' + time + '）';
    return formatDate(ctx, date.toISOString(), 'short') + ' ' + time;
  }

  function dueText(iso) {
    if (!iso) return '待安排';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '待安排';
    const diff = date.getTime() - Date.now();
    if (diff <= 0) return '已到期';
    const minutes = Math.round(diff / 60000);
    if (minutes < 60) return minutes + ' 分钟后';
    const hours = Math.round(diff / 3600000);
    if (hours < 24) return hours + ' 小时后';
    const days = Math.round(diff / 86400000);
    if (days <= 1) return '明天';
    if (days < 30) return days + ' 天后';
    return formatDate(ctx, iso, 'short');
  }

  async function loadNextDue() {
    try {
      if (!api || !api.vocab || typeof api.vocab.list !== 'function') return;
      const list = await api.vocab.list({ sort: 'due' });
      const now = Date.now();
      const upcoming = (Array.isArray(list) ? list : [])
        .map((word) => {
          if (!word) return null;
          if (word.memory && word.memory.due) return word.memory.due;
          return word.srs && word.srs.due ? word.srs.due : null;
        })
        .filter((due) => due && new Date(due).getTime() > now)
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
      state.nextDue = upcoming.length ? upcoming[0] : null;
    } catch (err) {
      state.nextDue = null;
    }
    const node = root.querySelector('[data-next-due]');
    if (node) node.textContent = nextDueLabel();
  }

  async function loadSchedule() {
    try {
      if (api && api.vocab && typeof api.vocab.schedule === 'function') {
        return normalizeSchedule(await api.vocab.schedule());
      }
    } catch (err) { /* 后端未就绪时静默兜底 */ }
    return normalizeSchedule(null);
  }

  /* ---- 记忆曲线卡片 ------------------------------------------------------ */
  function chartGeom() {
    const maxStage = Math.max(1, state.schedule.maxStage);
    const plotW = CHART.w - CHART.padL - CHART.padR;
    const plotH = CHART.h - CHART.padT - CHART.padB;
    return {
      maxStage,
      x(stage) {
        const clamped = Math.min(Math.max(0, Number(stage) || 0), maxStage);
        return CHART.padL + (clamped / maxStage) * plotW;
      },
      y(rate) {
        const value = Math.min(Math.max(0, Number(rate) || 0), 1);
        return CHART.padT + (1 - value) * plotH;
      },
      rate(stage) {
        const clamped = Math.min(Math.max(0, Number(stage) || 0), maxStage);
        return Math.exp(-CHART.decay * (clamped / maxStage));
      }
    };
  }

  function memoryChartMarkup() {
    const geom = chartGeom();
    const steps = 64;
    const points = [];
    for (let i = 0; i <= steps; i += 1) {
      const stage = (i / steps) * geom.maxStage;
      points.push((i === 0 ? 'M' : 'L') + geom.x(stage).toFixed(2) + ' ' + geom.y(geom.rate(stage)).toFixed(2));
    }
    const curvePath = points.join(' ');
    const baseY = geom.y(0).toFixed(2);
    const areaPath = curvePath + ' L ' + geom.x(geom.maxStage).toFixed(2) + ' ' + baseY +
      ' L ' + geom.x(0).toFixed(2) + ' ' + baseY + ' Z';
    const grid = [1, 0.5].map((rate) =>
      '<line class="memory-chart__grid" x1="' + CHART.padL + '" y1="' + geom.y(rate).toFixed(2) +
      '" x2="' + (CHART.w - CHART.padR) + '" y2="' + geom.y(rate).toFixed(2) + '" />'
    ).join('');
    const dots = [];
    for (let stage = 0; stage <= geom.maxStage; stage += 1) {
      dots.push('<circle class="memory-chart__dot" data-stage="' + stage + '" cx="' + geom.x(stage).toFixed(2) +
        '" cy="' + geom.y(geom.rate(stage)).toFixed(2) + '" r="1.7" />');
    }
    return '<svg class="memory-chart" viewBox="0 0 ' + CHART.w + ' ' + CHART.h +
      '" role="img" aria-label="艾宾浩斯记忆保持率衰减曲线" title="保持率 R = e^(−t/S)；圆点对应当前记忆阶段">' +
      '<defs><linearGradient id="memory-area-gradient" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" class="memory-chart__stop-top" />' +
        '<stop offset="100%" class="memory-chart__stop-bottom" />' +
      '</linearGradient></defs>' +
      grid +
      '<path class="memory-chart__area" d="' + areaPath + '" fill="url(#memory-area-gradient)" />' +
      '<path class="memory-chart__curve" d="' + curvePath + '" />' +
      '<g class="memory-chart__dots">' + dots.join('') + '</g>' +
      '<line class="memory-chart__base" x1="' + CHART.padL + '" y1="' + baseY +
        '" x2="' + (CHART.w - CHART.padR) + '" y2="' + baseY + '" />' +
      '<circle class="memory-chart__halo" id="memory-halo" cx="' + geom.x(0).toFixed(2) +
        '" cy="' + geom.y(1).toFixed(2) + '" r="8" />' +
      '<circle class="memory-chart__marker" id="memory-marker" cx="' + geom.x(0).toFixed(2) +
        '" cy="' + geom.y(1).toFixed(2) + '" r="3.6" />' +
      '<text class="memory-chart__axis" x="' + CHART.padL + '" y="' + (CHART.h - 8) + '">刚复习</text>' +
      '<text class="memory-chart__axis" x="' + (CHART.w - CHART.padR) + '" y="' + (CHART.h - 8) +
        '" text-anchor="end">更久之后</text>' +
    '</svg>';
  }

  function mountSide() {
    if (!els.side || state.sideMounted) return;
    state.sideMounted = true;
    els.side.innerHTML =
      '<section class="memory-card" id="memory-card" aria-label="艾宾浩斯记忆曲线">' +
        '<header class="memory-card__head">' +
          '<div class="memory-card__titles">' +
            '<p class="memory-card__eyebrow">Ebbinghaus</p>' +
            '<h2 class="memory-card__title">记忆曲线</h2>' +
          '</div>' +
          '<button type="button" class="memory-card__toggle" id="memory-toggle" aria-expanded="true" aria-controls="memory-body" title="收起曲线">' +
            icon(ctx, 'chevronDown', 16) +
          '</button>' +
        '</header>' +
        '<div class="memory-card__body" id="memory-body">' +
          memoryChartMarkup() +
          '<dl class="memory-stats">' +
            '<div class="memory-stat"><dt>当前阶段</dt><dd id="memory-stage">—</dd></div>' +
            '<div class="memory-stat"><dt>下次复习</dt><dd id="memory-due">—</dd></div>' +
            '<div class="memory-stat"><dt>已复习次数</dt><dd id="memory-reviews">—</dd></div>' +
          '</dl>' +
          '<p class="memory-card__note" id="memory-note">评估这张卡的记忆保持率</p>' +
        '</div>' +
      '</section>';

    const toggle = els.side.querySelector('#memory-toggle');
    const card = els.side.querySelector('#memory-card');
    if (toggle && card) {
      toggle.addEventListener('click', () => {
        const collapsed = card.classList.toggle('is-collapsed');
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        toggle.setAttribute('title', collapsed ? '展开曲线' : '收起曲线');
      });
    }
  }

  function showSide() {
    if (!els.side) return;
    mountSide();
    els.side.hidden = false;
    if (els.layout) els.layout.classList.add('has-side');
    if (els.page) els.page.classList.add('is-wide');
  }

  function hideSide() {
    state.memory = null;
    if (els.side) els.side.hidden = true;
    if (els.layout) els.layout.classList.remove('has-side');
    if (els.page) els.page.classList.remove('is-wide');
  }

  function paintMemory(word) {
    if (!els.side) return;
    if (!word) { hideSide(); return; }
    showSide();
    const model = readMemory(word, state.schedule);
    state.memory = model;

    const geom = chartGeom();
    const marker = els.side.querySelector('#memory-marker');
    const halo = els.side.querySelector('#memory-halo');
    const cx = geom.x(model.stage).toFixed(2);
    const cy = geom.y(geom.rate(model.stage)).toFixed(2);
    if (marker) { marker.setAttribute('cx', cx); marker.setAttribute('cy', cy); }
    if (halo) { halo.setAttribute('cx', cx); halo.setAttribute('cy', cy); }

    els.side.querySelectorAll('.memory-chart__dot').forEach((dot) => {
      const stage = Number(dot.getAttribute('data-stage'));
      dot.classList.toggle('is-current', stage === model.stage);
      dot.classList.toggle('is-past', stage < model.stage);
    });

    const stageEl = els.side.querySelector('#memory-stage');
    if (stageEl) stageEl.textContent = stageName(model.stage) + ' · ' + model.intervalLabel;
    const dueEl = els.side.querySelector('#memory-due');
    if (dueEl) dueEl.textContent = dueText(model.due);
    const reviewsEl = els.side.querySelector('#memory-reviews');
    if (reviewsEl) reviewsEl.textContent = model.reviews > 0 ? model.reviews + ' 次' : '首次';

    const note = els.side.querySelector('#memory-note');
    if (note) {
      const bits = [];
      if (!model.hasMemory) bits.push('尚无记忆记录 · 按阶段预估');
      else if (model.lastRating) bits.push('最近评分：' + RATING_LABELS[model.lastRating]);
      else bits.push('还没有评分记录');
      if (model.lapses > 0) bits.push('遗忘 ' + model.lapses + ' 次');
      note.textContent = bits.join(' · ');
    }
  }

  /* ---- 状态视图 ---------------------------------------------------------- */
  function renderLoading() {
    state.mode = 'loading';
    hideSide();
    if (!els.main) return;
    els.main.innerHTML = '<div class="review-skeleton" aria-hidden="true">' +
      '<span class="skeleton is-word"></span>' +
      '<span class="skeleton is-line"></span>' +
      '<span class="skeleton is-line is-short"></span>' +
      '<span class="skeleton is-btn"></span>' +
    '</div>';
    paintProgress();
  }

  function renderError(message) {
    state.mode = 'error';
    hideSide();
    if (!els.main) return;
    els.main.innerHTML = '<div class="review-error">' +
      '<div class="review-error__glyph">' + icon(ctx, 'refresh', 28) + '</div>' +
      '<h2 class="review-error__title">复习队列暂时打不开</h2>' +
      '<p class="review-error__body">' + esc(message || '无法读取到期的单词，请稍后重试。') + '</p>' +
      '<div class="review-actions">' +
        '<button type="button" class="btn primary" id="review-retry">' + icon(ctx, 'refresh', 16) + '<span>重新加载</span></button>' +
        '<button type="button" class="btn ghost" id="review-back">回生词本</button>' +
      '</div>' +
    '</div>';
    const retry = els.main.querySelector('#review-retry');
    if (retry) retry.addEventListener('click', () => { load(); });
    const back = els.main.querySelector('#review-back');
    if (back) back.addEventListener('click', () => navigate('vocab'));
    paintProgress();
  }

  function renderEmpty() {
    state.mode = 'empty';
    hideSide();
    if (!els.main) return;
    els.main.innerHTML = '<div class="review-empty">' +
      '<div class="review-empty__glyph">' + icon(ctx, 'clock', 28) + '</div>' +
      '<h2 class="review-empty__title">今天没有到期单词</h2>' +
      '<p class="review-empty__body">间隔重复正在为你安排下一次相遇。去读几页新的，或者让记忆休息一会儿。</p>' +
      '<p class="review-next">下一次复习：<b data-next-due>' + esc(nextDueLabel()) + '</b></p>' +
      '<div class="review-empty__meta">' +
        '<span class="chip static">' + icon(ctx, 'flame', 13) + ' 连续 ' + formatNumber(ctx, state.streak) + ' 天</span>' +
        '<span class="chip static">今日已复习 ' + formatNumber(ctx, Math.max(state.totalReviewed, state.todayReviewed)) + ' 个</span>' +
      '</div>' +
      '<div class="review-actions">' +
        '<button type="button" class="btn primary" id="review-library">' + icon(ctx, 'book', 16) + '<span>去书库</span></button>' +
        '<button type="button" class="btn ghost" id="review-vocab">回生词本</button>' +
      '</div>' +
    '</div>';
    const library = els.main.querySelector('#review-library');
    if (library) library.addEventListener('click', () => navigate('library'));
    const vocab = els.main.querySelector('#review-vocab');
    if (vocab) vocab.addEventListener('click', () => navigate('vocab'));
    paintProgress();
    loadNextDue();
  }

  function ratingButtonsHtml(word) {
    const model = readMemory(word, state.schedule);
    return RATINGS.map((rating) => {
      const preview = ratingPreview(rating.value, model.stage, state.schedule);
      const aria = rating.label + '，' + preview.label + '后复习';
      return '<button type="button" class="rating-btn rating-btn--' + rating.value + '" data-rating="' + rating.value + '" data-target-stage="' + preview.stage + '" aria-label="' + esc(aria) + '">' +
        '<span class="kbd">' + rating.key + '</span>' +
        '<span class="rating-btn__label">' + rating.label + '</span>' +
        '<span class="rating-btn__sub">' + esc(preview.label + '后') + '</span>' +
      '</button>';
    }).join('');
  }

  /* ---- 复习卡片 ---------------------------------------------------------- */
  function renderCard() {
    const word = state.queue[0];
    if (!word) {
      finishRound();
      return;
    }
    state.mode = 'review';
    state.revealed = false;
    state.busy = false;
    state.currentWordId = word.id;
    const model = readMemory(word, state.schedule);
    state.memory = model;

    const sourceParts = Array.from(new Set([word.source && word.source.bookTitle, word.source && word.source.chapterTitle].filter(Boolean)));
    const sourceLabel = sourceParts.length ? sourceParts.join(' · ') : '手动添加';
    const origin = word.context
      ? '<p class="flashcard__origin">' + highlightWord(word.context, word.word, esc) + '</p>'
      : '';
    const answerContext = word.contextTranslation
      ? '<p class="flashcard__context-trans">' + esc(word.contextTranslation) + '</p>'
      : '';
    const note = word.note
      ? '<p class="flashcard__note">笔记：' + esc(word.note) + '</p>'
      : '';
    const stageChip = '<span class="flashcard__due" data-stage="' + model.stage + '" title="艾宾浩斯记忆阶段 · ' +
      esc(model.intervalLabel) + '">' + icon(ctx, 'clock', 12) + ' ' +
      esc(stageName(model.stage) + ' · ' + model.intervalLabel + '后') + '</span>';

    els.main.innerHTML =
      '<article class="flashcard is-entering" id="review-card">' +
        '<div class="flashcard__meta">' +
          '<span class="flashcard__source">' + icon(ctx, 'book', 14) + '<span>' + esc(sourceLabel) + '</span></span>' +
          stageChip +
        '</div>' +
        '<div class="flashcard__word-row">' +
          '<h2 class="flashcard__word">' + esc(word.word) + '</h2>' +
          '<button type="button" class="icon-btn flashcard__speak" data-action="speak" aria-label="朗读 ' + esc(word.word) + '" title="朗读">' + icon(ctx, 'speaker', 17) + '</button>' +
        '</div>' +
        '<div class="flashcard__phon">' + esc(word.phonetic || '暂无音标') + '</div>' +
        origin +
        '<div class="flashcard__answer" id="review-answer">' +
          '<div class="flashcard__answer-inner">' +
            '<div class="flashcard__divider">答案</div>' +
            '<p class="flashcard__trans">' + esc(word.translation || '暂无释义') + '</p>' +
            answerContext +
            '<div class="flashcard__pos" id="review-pos"></div>' +
            note +
          '</div>' +
        '</div>' +
        '<div class="flashcard__footer">' +
          '<span class="flashcard__hint">先在心里说出意思，再翻面核对 · <kbd class="kbd">空格</kbd></span>' +
          '<button type="button" class="btn primary flashcard__reveal" id="review-reveal">显示答案<span class="kbd">Space</span></button>' +
        '</div>' +
      '</article>' +
      '<div class="review-rating" id="review-rating" aria-label="复习评分">' + ratingButtonsHtml(word) + '</div>' +
      '<p class="review-keys-hint">按键 1-4 评分 · 空格翻面</p>';

    paintMemory(word);

    const card = els.main.querySelector('#review-card');
    if (card) {
      window.requestAnimationFrame(() => card.classList.remove('is-entering'));
    }

    const revealButton = els.main.querySelector('#review-reveal');
    if (revealButton) revealButton.addEventListener('click', reveal);

    const speakButton = els.main.querySelector('[data-action="speak"]');
    if (speakButton) {
      speakButton.addEventListener('click', async () => {
        try {
          speakButton.classList.add('is-speaking');
          await speech.speak(word.word);
        } catch (err) {
          toast(err && err.message ? err.message : '朗读失败', 'warn');
        } finally {
          speakButton.classList.remove('is-speaking');
        }
      });
    }

    els.main.querySelectorAll('[data-rating]').forEach((button) => {
      button.addEventListener('click', () => rate(button.getAttribute('data-rating')));
    });

    paintProgress();
  }

  function reveal() {
    if (state.revealed || !state.queue.length) return;
    state.revealed = true;
    const card = els.main.querySelector('.flashcard');
    if (card) card.classList.add('is-revealed');
    const ratingBar = els.main.querySelector('#review-rating');
    if (ratingBar) ratingBar.classList.add('is-visible');
    const revealButton = els.main.querySelector('#review-reveal');
    if (revealButton) revealButton.hidden = true;
    const hint = els.main.querySelector('.flashcard__hint');
    if (hint) hint.innerHTML = '按键 1-4 评分，或点击下方按钮';
    ensurePartOfSpeech(state.queue[0]);
  }

  async function ensurePartOfSpeech(word) {
    if (!word || !api || !api.lookup || typeof api.lookup.dictionary !== 'function') return;
    const key = word.normalized || word.word;
    const cached = state.dictionary.get(key);
    if (cached) {
      paintPartOfSpeech(cached, word);
      return;
    }
    try {
      const dictionary = await api.lookup.dictionary(word.word);
      const meanings = dictionary && Array.isArray(dictionary.meanings) ? dictionary.meanings : [];
      const seen = [];
      meanings.forEach((meaning) => {
        const pos = meaning && meaning.partOfSpeech;
        if (pos && seen.indexOf(pos) < 0) seen.push(pos);
      });
      const parts = seen.slice(0, 3);
      state.dictionary.set(key, parts);
      paintPartOfSpeech(parts, word);
    } catch (err) {
      state.dictionary.set(key, []);
    }
  }

  function paintPartOfSpeech(parts, word) {
    if (!state.queue.length || state.queue[0] !== word) return;
    const box = els.main.querySelector('#review-pos');
    if (!box) return;
    box.innerHTML = (parts || []).map((part) => '<span class="flashcard__pos-tag">' + esc(part) + '</span>').join('');
  }

  async function rate(rating) {
    if (!state.revealed || state.busy) return;
    if (RATING_VALUES.indexOf(rating) < 0) return;
    const word = state.queue[0];
    if (!word) return;

    state.busy = true;
    const buttons = Array.from(els.main.querySelectorAll('[data-rating]'));
    buttons.forEach((button) => { button.disabled = true; });

    try {
      const result = await api.vocab.review(word.id, rating);

      /* 优先采用后端返回的 memory，后端未就绪时按评分映射预估，保持完成页可用。 */
      const current = state.memory && state.currentWordId === word.id
        ? state.memory
        : readMemory(word, state.schedule);
      const preview = ratingPreview(rating, current.stage, state.schedule);
      const nextMemory = result && result.memory && typeof result.memory === 'object' ? result.memory : null;
      const finalStage = nextMemory && toNumber(nextMemory.stage) !== null
        ? clampStage(nextMemory.stage, state.schedule.maxStage)
        : preview.stage;
      state.stageCounts[String(finalStage)] = (state.stageCounts[String(finalStage)] || 0) + 1;
      if (nextMemory) word.memory = nextMemory;
      if (result && result.srs && typeof result.srs === 'object') word.srs = result.srs;

      state.ratings[rating] += 1;
      state.roundReviewed += 1;
      state.totalReviewed += 1;
      if (rating !== 'again') state.correct += 1;
      if (rating === 'again') state.againWords.push(word);
      state.dueCount = Math.max(0, state.dueCount - 1);
      paintChips();

      const card = els.main.querySelector('.flashcard');
      if (card) card.classList.add('is-leaving');
      await sleep(170);
      state.queue.shift();
      state.busy = false;
      renderCard();
    } catch (err) {
      state.busy = false;
      buttons.forEach((button) => { button.disabled = false; });
      if (err && err.code === 'NOT_FOUND') {
        toast('这个词已经不在生词本里，已跳过', 'warn');
        state.queue.shift();
        renderCard();
        return;
      }
      toast('评分保存失败：' + (err && err.message ? err.message : '未知错误'), 'error');
    }
  }

  /* ---- 完成态 ------------------------------------------------------------ */
  function stageDistributionHtml() {
    const entries = Object.keys(state.stageCounts)
      .map((key) => ({ stage: Number(key), count: Number(state.stageCounts[key]) || 0 }))
      .filter((item) => Number.isFinite(item.stage) && item.count > 0)
      .sort((a, b) => a.stage - b.stage);
    if (!entries.length) return '';
    const total = entries.reduce((sum, item) => sum + item.count, 0);
    const maxCount = entries.reduce((max, item) => Math.max(max, item.count), 1);
    return '<div class="review-dist" aria-label="今日复习阶段分布">' +
      '<div class="review-dist__head">' +
        '<span class="review-dist__title">今日阶段分布</span>' +
        '<span class="review-dist__total">共 ' + formatNumber(ctx, total) + ' 次评分</span>' +
      '</div>' +
      '<ul class="review-dist__list">' +
        entries.map((item) => {
          const width = Math.max(6, Math.round((item.count / maxCount) * 100));
          return '<li class="review-dist__row">' +
            '<span class="review-dist__label">' + esc(stageName(item.stage)) + '</span>' +
            '<span class="review-dist__track"><i class="review-dist__bar" style="width:' + width + '%"></i></span>' +
            '<span class="review-dist__count">' + formatNumber(ctx, item.count) + '</span>' +
          '</li>';
        }).join('') +
      '</ul>' +
      '<p class="review-dist__note">按评分后的记忆阶段统计；重来的词会重新入队。</p>' +
    '</div>';
  }

  function finishRound() {
    state.mode = 'finish';
    state.revealed = false;
    state.busy = false;
    hideSide();
    const accuracy = state.totalReviewed > 0
      ? Math.round((state.correct / state.totalReviewed) * 100)
      : 0;
    const againCount = state.againWords.length;

    els.main.innerHTML = '<div class="review-finish">' +
      '<div class="review-finish__glyph">' + icon(ctx, 'sparkles', 30) + '</div>' +
      '<h2 class="review-finish__title">今天复习完成</h2>' +
      '<p class="review-finish__body">你把 ' + formatNumber(ctx, state.totalReviewed) + ' 个词又往前推了一点。到期的词会按各自的间隔回来找你。</p>' +
      '<div class="review-finish__stats">' +
        '<div class="review-finish__stat"><b>' + formatNumber(ctx, state.totalReviewed) + '</b><span>今日已复习</span></div>' +
        '<div class="review-finish__stat"><b>' + accuracy + '%</b><span>正确率</span></div>' +
        '<div class="review-finish__stat"><b>' + formatNumber(ctx, state.ratings.again) + '</b><span>需要重来</span></div>' +
      '</div>' +
      stageDistributionHtml() +
      '<p class="review-next">连续复习 <b>' + formatNumber(ctx, state.streak) + '</b> 天 · 下一次复习：<b data-next-due>' + esc(nextDueLabel()) + '</b></p>' +
      '<div class="review-actions">' +
        (againCount > 0
          ? '<button type="button" class="btn primary" id="review-again-round">' + icon(ctx, 'refresh', 16) + '<span>再复习一轮</span></button>'
          : '<button type="button" class="btn ghost" disabled title="这一轮没有需要重来的单词">再复习一轮</button>') +
        '<button type="button" class="btn ghost" id="review-to-vocab">' + icon(ctx, 'arrowLeft', 16) + '<span>回生词本</span></button>' +
        '<button type="button" class="btn ghost" id="review-to-stats">查看足迹</button>' +
      '</div>' +
    '</div>';

    const againButton = els.main.querySelector('#review-again-round');
    if (againButton) againButton.addEventListener('click', restartRound);
    const vocabButton = els.main.querySelector('#review-to-vocab');
    if (vocabButton) vocabButton.addEventListener('click', () => navigate('vocab'));
    const statsButton = els.main.querySelector('#review-to-stats');
    if (statsButton) statsButton.addEventListener('click', () => navigate('stats'));

    paintProgress();
    loadNextDue();
  }

  function restartRound() {
    if (!state.againWords.length) return;
    state.queue = state.againWords.slice();
    state.againWords = [];
    state.round += 1;
    state.roundReviewed = 0;
    state.mode = 'review';
    renderCard();
  }

  /* ---- 加载 -------------------------------------------------------------- */
  async function load() {
    if (!api || !api.vocab || typeof api.vocab.due !== 'function') {
      renderError('无法连接到复习服务。请确认通过 Lumen 桌面应用打开，或稍后重试。');
      return;
    }
    const reqId = ++state.reqId;
    renderLoading();
    state.stageCounts = Object.create(null);
    try {
      const [dueList, overview, schedule] = await Promise.all([
        api.vocab.due(60),
        api.stats && typeof api.stats.overview === 'function'
          ? api.stats.overview().catch(() => null)
          : Promise.resolve(null),
        loadSchedule()
      ]);
      if (reqId !== state.reqId) return;

      state.schedule = schedule;
      const scheduleKey = schedule.source + ':' + schedule.maxStage + ':' + schedule.intervals.length;
      if (state.scheduleKey && state.scheduleKey !== scheduleKey && state.sideMounted) {
        state.sideMounted = false;
        if (els.side) els.side.innerHTML = '';
      }
      state.scheduleKey = scheduleKey;

      const words = Array.isArray(dueList) ? dueList : [];
      state.queue = words;
      state.dueCount = words.length;

      let streak = overview && Number.isFinite(Number(overview.streak)) ? Number(overview.streak) : NaN;
      if (!Number.isFinite(streak) && api.vocab && typeof api.vocab.stats === 'function') {
        try {
          const vocabStats = await api.vocab.stats();
          streak = Number(vocabStats && vocabStats.streak) || 0;
        } catch (err) { streak = 0; }
      }
      state.streak = Number.isFinite(streak) ? Math.max(0, streak) : 0;
      state.todayReviewed = overview && overview.today ? Number(overview.today.reviews) || 0 : 0;
      paintChips();

      if (!words.length) {
        renderEmpty();
        return;
      }
      renderCard();
    } catch (err) {
      if (reqId !== state.reqId) return;
      renderError(err && err.message ? err.message : '读取复习队列失败');
    }
  }

  /* ---- 全局键盘 ---------------------------------------------------------- */
  const onKeydown = (event) => {
    if (!root.isConnected) {
      document.removeEventListener('keydown', onKeydown);
      return;
    }
    const target = event.target;
    const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (target && target.isContentEditable)) return;
    if (state.mode !== 'review') return;

    if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault();
      if (!state.revealed) reveal();
      return;
    }
    const ratingIndex = RATING_KEYS.indexOf(String(event.key));
    if (ratingIndex < 0) return;
    event.preventDefault();
    if (!state.revealed) {
      reveal();
      return;
    }
    rate(RATING_VALUES[ratingIndex]);
  };
  document.addEventListener('keydown', onKeydown);

  await load();
}
