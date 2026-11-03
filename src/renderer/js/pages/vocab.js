/**
 * Lumen · 流明阅读 — 生词本页面模块（#/vocab）
 * 契约：export async function render(root, ctx)
 *
 * 数据：api.vocab.list / stats / update / remove / exportCsv
 * 设计：复用 base.css 的变量与 .btn/.card/.input/.select/.icon-btn/.empty/.skeleton 等通用类。
 * 图标：优先 ctx.icons[name](size)，缺失时使用本地内联 SVG 降级。
 */

const FALLBACK_ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
  sort: '<path d="M4 7h10M4 12h7M4 17h4"/><path d="M18 6v12m0 0 3-3m-3 3-3-3"/>',
  download: '<path d="M12 4v11m0 0 4-4m-4 4-4-4"/><path d="M5 19h14"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9.5a3.5 3.5 0 0 1 0 5"/><path d="M18.5 7a7 7 0 0 1 0 10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 13 4 4L19 7"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 1.8"/>',
  tag: '<path d="M4 12V5a1 1 0 0 1 1-1h7l8 8-8 8-8-8z"/><circle cx="8.5" cy="8.5" r="1.2"/>',
  'chevron-right': '<path d="m10 6 6 6-6 6"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/>',
  sparkles: '<path d="m12 4 1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4z"/><path d="M18 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z"/>',
  info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>',
  dot: '<circle cx="12" cy="12" r="3"/>'
};

const SORT_OPTIONS = [
  { value: 'recent', label: '最近加入' },
  { value: 'alpha', label: '字母顺序' },
  { value: 'due', label: '按到期时间' }
];

const FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'learning', label: '学习中' },
  { value: 'mastered', label: '已掌握' }
];

/* 艾宾浩斯阶段：与 docs/ENRICHMENT.md 的阶段间隔保持一致（防御式，后端未就绪时也能展示）。 */
const MEMORY_STAGES = [
  { hours: 1 / 12, label: '5 分钟' },
  { hours: 0.5, label: '30 分钟' },
  { hours: 12, label: '12 小时' },
  { hours: 24, label: '1 天' },
  { hours: 48, label: '2 天' },
  { hours: 96, label: '4 天' },
  { hours: 168, label: '7 天' },
  { hours: 360, label: '15 天' },
  { hours: 720, label: '30 天' },
  { hours: 1440, label: '60 天' },
  { hours: 2880, label: '120 天' }
];

const MEMORY_RATING_LABELS = { again: '重来', hard: '困难', good: '良好', easy: '简单' };
const MEMORY_MAX_STAGE = MEMORY_STAGES.length - 1;

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampStage(value) {
  const parsed = toFiniteNumber(value);
  if (parsed == null) return null;
  return Math.max(0, Math.min(MEMORY_MAX_STAGE, Math.round(parsed)));
}

function stageLabelOf(stage) {
  const clamped = clampStage(stage);
  return clamped == null ? '—' : MEMORY_STAGES[clamped].label;
}

function formatHours(hours) {
  const parsed = toFiniteNumber(hours);
  if (parsed == null || parsed <= 0) return '—';
  if (parsed < 1) return Math.max(1, Math.round(parsed * 60)) + ' 分钟';
  if (parsed < 24) return Math.round(parsed * 10) / 10 + ' 小时';
  const days = parsed / 24;
  return (days >= 10 ? Math.round(days) : Math.round(days * 10) / 10) + ' 天';
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (item == null ? '' : String(item).trim()))
    .filter(Boolean);
}

function memoryInfoOf(word) {
  const memory = word && word.memory && typeof word.memory === 'object' ? word.memory : null;
  const srs = word && word.srs && typeof word.srs === 'object' ? word.srs : {};
  const srsInterval = toFiniteNumber(srs.interval);
  return {
    hasMemory: Boolean(memory),
    stage: memory ? clampStage(memory.stage) : null,
    intervalHours: memory
      ? toFiniteNumber(memory.intervalHours)
      : (srsInterval != null ? srsInterval * 24 : null),
    due: String((memory && memory.due) || srs.due || ''),
    lapses: memory ? toFiniteNumber(memory.lapses) : toFiniteNumber(srs.lapses),
    reps: toFiniteNumber(srs.reps),
    history: memory && Array.isArray(memory.history) ? memory.history : []
  };
}

function lexiconHasContent(lexicon) {
  if (!lexicon || typeof lexicon !== 'object') return false;
  const breakdown = typeof lexicon.breakdown === 'string' ? lexicon.breakdown.trim() : '';
  const parts = Array.isArray(lexicon.parts) ? lexicon.parts : [];
  const related = Array.isArray(lexicon.related) ? lexicon.related : [];
  if (parts.length || related.length) return true;
  if (!breakdown) return false;
  // 本地词库没有命中时会把 breakdown 回填为原词，不应把原词当成词根拆解展示。
  const word = typeof lexicon.word === 'string' ? lexicon.word.trim().toLowerCase() : '';
  return !(word && breakdown.toLowerCase() === word);
}

function icon(ctx, name, size = 18) {
  const fn = ctx && ctx.icons && ctx.icons[name];
  if (typeof fn === 'function') {
    try {
      const svg = fn(size);
      if (svg) return svg;
    } catch (err) { /* 忽略图标异常，走降级 */ }
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
  if (style === 'long') {
    return date.getFullYear() + ' 年 ' + (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日';
  }
  return (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日';
}

function formatNumber(ctx, n) {
  if (ctx && typeof ctx.fmtNumber === 'function') {
    try { return ctx.fmtNumber(n); } catch (err) { /* noop */ }
  }
  return String(n == null ? 0 : n);
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

/* ---- 语音合成 ------------------------------------------------------------ */
const speech = (() => {
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

  function speak(text) {
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

  return { speak };
})();

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
  const confirmDialog = async (options) => {
    if (ctx && typeof ctx.confirm === 'function') {
      try { return await ctx.confirm(options); } catch (err) { /* fall through */ }
    }
    try {
      const text = [options.title, options.body].filter(Boolean).join('\n\n');
      return typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(text)
        : false;
    } catch (err) {
      return false;
    }
  };

  const state = {
    query: '',
    sort: 'recent',
    filter: 'all',
    words: [],
    stats: null,
    loading: true,
    exporting: false,
    openId: null,
    noteTimer: null,
    searchTimer: null,
    reqId: 0,
    lexiconById: {}
  };

  root.innerHTML =
    '<div class="vocab-page page">' +
      '<header class="vocab-head">' +
        '<div class="vocab-head-top">' +
          '<div>' +
            '<p class="vocab-eyebrow">Vocabulary</p>' +
            '<h1 class="vocab-title">生词本</h1>' +
            '<p class="vocab-lede">读到一个词，收藏它，然后它会在这里等你。</p>' +
          '</div>' +
          '<div class="vocab-head-actions">' +
            '<button type="button" class="btn" id="vocab-export">' + icon(ctx, 'download', 16) + '<span>导出 CSV</span></button>' +
          '</div>' +
        '</div>' +
        '<div class="vocab-meta">' +
          '<div class="vocab-stats" role="group" aria-label="生词统计">' +
            '<div class="vocab-stat"><span class="vocab-stat__num" id="vocab-total">—</span><span class="vocab-stat__label">总词数</span></div>' +
            '<div class="vocab-stat vocab-stat--due"><span class="vocab-stat__num" id="vocab-due">—</span><span class="vocab-stat__label">待复习</span></div>' +
            '<div class="vocab-stat vocab-stat--mastered"><span class="vocab-stat__num" id="vocab-mastered">—</span><span class="vocab-stat__label">已掌握</span></div>' +
          '</div>' +
          '<div class="vocab-toolbar">' +
            '<label class="vocab-search">' + icon(ctx, 'search', 16) +
              '<input class="input" id="vocab-search" type="search" autocomplete="off" spellcheck="false" placeholder="搜索单词、释义或来源…" aria-label="搜索生词">' +
            '</label>' +
            '<div class="vocab-sort">' + icon(ctx, 'sort', 16) +
              '<select class="select" id="vocab-sort" aria-label="排序方式">' +
                SORT_OPTIONS.map((o) => '<option value="' + o.value + '">' + o.label + '</option>').join('') +
              '</select>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="vocab-filters">' +
          '<div class="vocab-seg" role="tablist" aria-label="筛选生词">' +
            FILTERS.map((f) =>
              '<button type="button" class="vocab-seg__btn' + (f.value === 'all' ? ' is-on' : '') + '" role="tab" data-filter="' + f.value + '" aria-selected="' + (f.value === 'all') + '">' +
                f.label + '<span class="vocab-seg__count" data-count="' + f.value + '"></span>' +
              '</button>'
            ).join('') +
          '</div>' +
          '<span class="vocab-filter-note" id="vocab-filter-note"></span>' +
        '</div>' +
      '</header>' +
      '<section class="vocab-table" id="vocab-table" aria-live="polite">' +
        '<div class="vocab-table-head" aria-hidden="true">' +
          '<span>单词</span><span>释义</span><span>来源</span><span>加入</span><span>掌握</span><span>到期</span><span></span>' +
        '</div>' +
        '<div class="vocab-rows" id="vocab-rows"></div>' +
      '</section>' +
      '<div class="vocab-drawer-backdrop" id="vocab-backdrop" hidden></div>' +
      '<aside class="vocab-drawer" id="vocab-drawer" aria-hidden="true" aria-label="生词详情"></aside>' +
    '</div>';

  const els = {
    total: root.querySelector('#vocab-total'),
    due: root.querySelector('#vocab-due'),
    mastered: root.querySelector('#vocab-mastered'),
    search: root.querySelector('#vocab-search'),
    sort: root.querySelector('#vocab-sort'),
    exportBtn: root.querySelector('#vocab-export'),
    filters: root.querySelector('.vocab-seg'),
    filterNote: root.querySelector('#vocab-filter-note'),
    table: root.querySelector('#vocab-table'),
    rows: root.querySelector('#vocab-rows'),
    backdrop: root.querySelector('#vocab-backdrop'),
    drawer: root.querySelector('#vocab-drawer')
  };
  if (els.sort) els.sort.value = state.sort;

  /* ---- 骨架 / 状态渲染 -------------------------------------------------- */
  function skeletonHtml() {
    let rows = '';
    for (let i = 0; i < 7; i += 1) {
      rows += '<div class="vocab-skeleton-row">' +
        '<span class="skeleton is-word"></span>' +
        '<span class="skeleton"></span>' +
        '<span class="skeleton is-dot"></span>' +
        '<span class="skeleton"></span>' +
        '<span class="skeleton is-dot"></span>' +
        '<span class="skeleton"></span>' +
        '<span class="skeleton"></span>' +
      '</div>';
    }
    return '<div class="vocab-skeleton" aria-hidden="true">' + rows + '</div>';
  }

  function emptyHtml(kind) {
    if (kind === 'search') {
      return '<div class="vocab-empty">' +
        '<div class="vocab-empty__glyph">' + icon(ctx, 'search', 28) + '</div>' +
        '<p class="vocab-empty__quote">没有找到匹配的生词</p>' +
        '<p class="vocab-empty__hint">试试更短的关键词，或者切换筛选条件。</p>' +
        '<div class="vocab-empty__actions"><button type="button" class="btn ghost" data-empty-action="reset">清除筛选</button></div>' +
      '</div>';
    }
    if (kind === 'filter') {
      return '<div class="vocab-empty">' +
        '<div class="vocab-empty__glyph">' + icon(ctx, 'tag', 28) + '</div>' +
        '<p class="vocab-empty__quote">这个分组里还没有单词</p>' +
        '<p class="vocab-empty__hint">阅读时划选单词即可收藏，复习几轮后它们会进入不同的掌握阶段。</p>' +
        '<div class="vocab-empty__actions"><button type="button" class="btn ghost" data-empty-action="reset">查看全部生词</button></div>' +
      '</div>';
    }
    return '<div class="vocab-empty">' +
      '<div class="vocab-empty__glyph">' + icon(ctx, 'book', 28) + '</div>' +
      '<p class="vocab-empty__quote">“读到一个词，收藏它，然后它会在这里等你。”</p>' +
      '<p class="vocab-empty__hint">打开一本书，划选不认识的英文单词，点击「收藏」就能把它带回来。</p>' +
      '<div class="vocab-empty__actions">' +
        '<button type="button" class="btn primary" data-empty-action="library">' + icon(ctx, 'book', 16) + '<span>去书库</span></button>' +
        '<button type="button" class="btn ghost" data-empty-action="review">去复习</button>' +
      '</div>' +
    '</div>';
  }

  function errorHtml(message) {
    return '<div class="vocab-error">' +
      '<div class="vocab-empty__glyph">' + icon(ctx, 'refresh', 26) + '</div>' +
      '<p class="vocab-error__title">生词本暂时没有回应</p>' +
      '<p class="vocab-error__body">' + esc(message || '无法读取生词数据。请确认应用已正确启动。') + '</p>' +
      '<button type="button" class="btn" data-empty-action="retry">' + icon(ctx, 'refresh', 16) + '<span>重新加载</span></button>' +
    '</div>';
  }

  /* ---- 数据整理 ---------------------------------------------------------- */
  function masteryOf(word) {
    const value = Number(word && word.mastery);
    return Number.isFinite(value) ? Math.max(0, Math.min(5, value)) : 0;
  }

  function matchesFilter(word) {
    if (state.filter === 'learning') return masteryOf(word) < 4;
    if (state.filter === 'mastered') return masteryOf(word) >= 4;
    return true;
  }

  function matchesQuery(word) {
    const query = state.query.trim().toLowerCase();
    if (!query) return true;
    const haystack = [
      word.word,
      word.normalized,
      word.translation,
      word.phonetic,
      word.source && word.source.bookTitle,
      word.source && word.source.chapterTitle
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.indexOf(query) >= 0;
  }

  function sortWords(words) {
    const list = words.slice();
    if (state.sort === 'alpha') {
      list.sort((a, b) => String(a.word || '').localeCompare(String(b.word || ''), 'en'));
    } else if (state.sort === 'due') {
      list.sort((a, b) => {
        const da = a && a.srs && a.srs.due ? new Date(a.srs.due).getTime() : Number.MAX_SAFE_INTEGER;
        const db = b && b.srs && b.srs.due ? new Date(b.srs.due).getTime() : Number.MAX_SAFE_INTEGER;
        return da - db;
      });
    } else {
      list.sort((a, b) => {
        const da = a && a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const db = b && b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return db - da;
      });
    }
    return list;
  }

  function dueInfo(word) {
    if (!word) return { tone: 'none', label: '—', title: '' };
    if (masteryOf(word) >= 4) {
      return { tone: 'mastered', label: '已掌握', title: '这个单词已经掌握' };
    }
    const raw = word.srs && word.srs.due;
    const dueDate = raw ? new Date(raw) : null;
    if (!dueDate || Number.isNaN(dueDate.getTime())) {
      return { tone: 'none', label: '未排程', title: '还没有复习计划' };
    }
    const diff = dueDate.getTime() - Date.now();
    if (diff <= 0) {
      return { tone: 'due', label: '待复习', title: '已到期：' + formatDate(ctx, dueDate.toISOString(), 'short') };
    }
    const day = 24 * 60 * 60 * 1000;
    if (diff < day) {
      return { tone: 'soon', label: '今天', title: '今天到期' };
    }
    if (diff < day * 2) {
      return { tone: 'soon', label: '明天', title: '明天到期' };
    }
    if (diff < day * 30) {
      return { tone: 'later', label: Math.round(diff / day) + ' 天后', title: '到期：' + formatDate(ctx, dueDate.toISOString(), 'short') };
    }
    return { tone: 'later', label: formatDate(ctx, dueDate.toISOString(), 'short'), title: '到期：' + formatDate(ctx, dueDate.toISOString(), 'long') };
  }

  function masteryDots(word) {
    const value = masteryOf(word);
    let dots = '';
    for (let i = 1; i <= 5; i += 1) {
      dots += '<i class="' + (i <= value ? 'is-on' : '') + '"></i>';
    }
    return '<span class="vocab-mastery" title="掌握度 ' + value + '/5">' + dots +
      '<span class="vocab-mastery__value">' + value + '/5</span></span>';
  }

  function rowHtml(word) {
    const due = dueInfo(word);
    const phonetic = word.phonetic
      ? '<span class="vocab-phon">' + esc(word.phonetic) + '</span>'
      : '<span class="vocab-phon">—</span>';
    const bookTitle = word.source && word.source.bookTitle;
    const rawChapter = word.source && word.source.chapterTitle;
    const chapterTitle = rawChapter && rawChapter !== bookTitle ? rawChapter : '';
    const sourceHtml = bookTitle
      ? '<span class="vocab-source__book">' + esc(bookTitle) + '</span>' +
        (chapterTitle ? '<span class="vocab-source__chap">' + esc(chapterTitle) + '</span>' : '')
      : '<span class="vocab-muted">手动添加</span>';
    const stage = word.memory && typeof word.memory === 'object' ? clampStage(word.memory.stage) : null;
    const stageDot = stage == null ? '' :
      '<span class="vocab-stage" title="艾宾浩斯阶段 ' + (stage + 1) + '/' + (MEMORY_MAX_STAGE + 1) + '" aria-label="记忆阶段 ' + (stage + 1) + '"></span>';

    return '<article class="vocab-row" role="button" tabindex="0" data-id="' + esc(word.id) + '" aria-label="查看 ' + esc(word.word) + ' 的详情">' +
      '<div class="vocab-row__word"><span class="vocab-word">' + esc(word.word) + '</span>' + phonetic + '</div>' +
      '<div class="vocab-row__trans vocab-trans">' + esc(word.translation || '暂无释义') + '</div>' +
      '<div class="vocab-row__source vocab-source">' + sourceHtml + '</div>' +
      '<div class="vocab-row__added vocab-date">' + esc(formatDate(ctx, word.createdAt, 'short') || '—') + '</div>' +
      '<div class="vocab-row__mastery">' + masteryDots(word) + '</div>' +
      '<div class="vocab-row__due">' + stageDot + '<span class="vocab-due vocab-due--' + due.tone + '" title="' + esc(due.title) + '">' + esc(due.label) + '</span></div>' +
      '<div class="vocab-acts">' +
        '<button type="button" class="icon-btn vocab-act-speak" data-act="speak" title="朗读发音" aria-label="朗读 ' + esc(word.word) + '">' + icon(ctx, 'speaker', 16) + '</button>' +
        '<button type="button" class="icon-btn vocab-act-del" data-act="delete" title="删除生词" aria-label="删除 ' + esc(word.word) + '">' + icon(ctx, 'trash', 16) + '</button>' +
      '</div>' +
    '</article>';
  }

  /* ---- 统计与计数 -------------------------------------------------------- */
  function statsNumbers() {
    const stats = state.stats || {};
    const words = state.words;
    const localMastered = words.filter((w) => masteryOf(w) >= 4).length;
    const localLearning = words.length - localMastered;
    return {
      total: Number.isFinite(Number(stats.total)) ? Number(stats.total) : words.length,
      due: Number.isFinite(Number(stats.due)) ? Number(stats.due) : words.filter((w) => dueInfo(w).tone === 'due').length,
      mastered: Number.isFinite(Number(stats.mastered)) ? Number(stats.mastered) : localMastered,
      learning: Number.isFinite(Number(stats.learning)) ? Number(stats.learning) : localLearning,
      new: Number.isFinite(Number(stats.new)) ? Number(stats.new) : words.filter((w) => masteryOf(w) === 0).length,
      reviewedToday: Number(stats.reviewedToday) || 0,
      addedToday: Number(stats.addedToday) || 0,
      streak: Number(stats.streak) || 0
    };
  }

  function paintHeader() {
    const numbers = statsNumbers();
    if (els.total) els.total.textContent = formatNumber(ctx, numbers.total);
    if (els.due) els.due.textContent = formatNumber(ctx, numbers.due);
    if (els.mastered) els.mastered.textContent = formatNumber(ctx, numbers.mastered);

    const counts = {
      all: numbers.total,
      learning: numbers.learning + numbers.new,
      mastered: numbers.mastered
    };
    root.querySelectorAll('.vocab-seg__count').forEach((node) => {
      const key = node.getAttribute('data-count');
      node.textContent = counts[key] == null ? '' : formatNumber(ctx, counts[key]);
    });

    if (els.filterNote) {
      const parts = [];
      if (numbers.addedToday > 0) parts.push('今天新增 ' + formatNumber(ctx, numbers.addedToday) + ' 个');
      if (numbers.reviewedToday > 0) parts.push('今天复习 ' + formatNumber(ctx, numbers.reviewedToday) + ' 个');
      els.filterNote.textContent = parts.join(' · ');
    }
  }

  /* ---- 列表渲染 ---------------------------------------------------------- */
  function visibleWords() {
    return sortWords(state.words.filter((word) => matchesFilter(word) && matchesQuery(word)));
  }

  function paintList() {
    if (!els.rows) return;
    if (state.loading) {
      els.table.classList.remove('is-loading');
      els.rows.innerHTML = skeletonHtml();
      return;
    }
    if (!state.words.length) {
      els.rows.innerHTML = emptyHtml(state.query.trim() ? 'search' : (state.filter !== 'all' ? 'filter' : 'empty'));
      return;
    }
    const list = visibleWords();
    if (!list.length) {
      els.rows.innerHTML = emptyHtml(state.query.trim() ? 'search' : 'filter');
      return;
    }
    els.rows.innerHTML = list.map(rowHtml).join('');
  }

  function bindEmptyActions() {
    els.rows.addEventListener('click', async (event) => {
      const trigger = event.target.closest('[data-empty-action]');
      if (!trigger) return;
      const action = trigger.getAttribute('data-empty-action');
      if (action === 'library') {
        navigate('library');
        return;
      }
      if (action === 'review') {
        navigate('review');
        return;
      }
      if (action === 'reset') {
        state.filter = 'all';
        state.query = '';
        if (els.search) els.search.value = '';
        syncFilterButtons();
        await load();
        return;
      }
      if (action === 'retry') {
        await load();
      }
    });

    els.rows.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('.vocab-row');
      if (row && event.target === row) {
        event.preventDefault();
        openDrawer(row.getAttribute('data-id'));
      }
    });

    els.rows.addEventListener('click', onRowClick);
  }

  function onRowClick(event) {
    const actionBtn = event.target.closest('[data-act]');
    const row = event.target.closest('.vocab-row');
    if (!row) return;
    const id = row.getAttribute('data-id');
    if (actionBtn) {
      event.stopPropagation();
      const action = actionBtn.getAttribute('data-act');
      if (action === 'speak') speakWordById(id, actionBtn);
      if (action === 'delete') removeWordById(id, actionBtn);
      return;
    }
    openDrawer(id);
  }

  async function speakWordById(id, button) {
    const word = findWord(id);
    if (!word) return;
    try {
      button.classList.add('is-speaking');
      await speech.speak(word.word);
    } catch (err) {
      toast(err && err.message ? err.message : '朗读失败', 'warn');
    } finally {
      button.classList.remove('is-speaking');
    }
  }

  function findWord(id) {
    return state.words.find((word) => word.id === id) || null;
  }

  async function removeWordById(id, trigger) {
    const word = findWord(id);
    if (!word) return;
    const ok = await confirmDialog({
      title: '删除「' + word.word + '」？',
      body: '它会从生词本移除，相关的复习记录也会一起删除。此操作无法撤销。',
      confirmText: '删除',
      danger: true
    });
    if (!ok) return;
    if (trigger) trigger.disabled = true;
    try {
      await api.vocab.remove(id);
      state.words = state.words.filter((item) => item.id !== id);
      if (state.openId === id) closeDrawer();
      paintHeader();
      paintList();
      toast('已删除「' + word.word + '」', 'ok');
      load({ silent: true });
    } catch (err) {
      toast('删除失败：' + (err && err.message ? err.message : '未知错误'), 'error');
      if (trigger) trigger.disabled = false;
    }
  }

  function syncFilterButtons() {
    root.querySelectorAll('.vocab-seg__btn').forEach((button) => {
      const isOn = button.getAttribute('data-filter') === state.filter;
      button.classList.toggle('is-on', isOn);
      button.setAttribute('aria-selected', String(isOn));
    });
  }

  /* ---- 抽屉 -------------------------------------------------------------- */
  function tagChipsHtml(tags) {
    const list = Array.isArray(tags) ? tags : [];
    return list.map((tag) =>
      '<span class="vd-tag">' + esc(tag) +
        '<button type="button" data-remove-tag="' + esc(tag) + '" aria-label="移除标签 ' + esc(tag) + '">×</button>' +
      '</span>'
    ).join('');
  }

  function relativeTime(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const diff = date.getTime() - Date.now();
    if (diff <= 0) return '已到期';
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < hour) return Math.max(1, Math.round(diff / minute)) + ' 分钟后';
    if (diff < day) return Math.round(diff / hour) + ' 小时后';
    if (diff < day * 30) return Math.round(diff / day) + ' 天后';
    return '稍后';
  }

  function memoryBlockHtml(word) {
    const info = memoryInfoOf(word);
    const stage = info.stage;
    let segments = '';
    for (let i = 0; i <= MEMORY_MAX_STAGE; i += 1) {
      segments += '<i class="' + (stage != null && i <= stage ? 'is-on' : '') + '"></i>';
    }
    const dueDate = formatDate(ctx, info.due, 'short');
    const dueRelative = relativeTime(info.due);
    const dueText = info.due
      ? '<b>' + esc(dueRelative || dueDate || '已排程') + '</b>' +
        (dueDate ? '<span>' + esc(dueDate) + '</span>' : '')
      : '<b>未排程</b><span>复习一次后开始计时</span>';
    const intervalText = info.intervalHours != null
      ? formatHours(info.intervalHours)
      : (stage == null ? '—' : stageLabelOf(stage));
    const history = info.history.slice(-4).reverse();
    const historyHtml = history.length
      ? '<ol class="vd-memory-history">' + history.map((entry) => {
          const rating = entry && entry.rating && MEMORY_RATING_LABELS[entry.rating] ? entry.rating : '';
          const entryStage = clampStage(entry && entry.stage);
          const at = entry && entry.at ? formatDate(ctx, entry.at, 'short') : '';
          return '<li>' +
            '<span class="vd-memory-history__rating' + (rating ? ' is-' + rating : '') + '">' + esc(rating ? MEMORY_RATING_LABELS[rating] : '复习') + '</span>' +
            '<span class="vd-memory-history__stage">阶段 ' + (entryStage == null ? '—' : (entryStage + 1) + '/' + (MEMORY_MAX_STAGE + 1)) + '</span>' +
            '<time>' + esc(at || '—') + '</time>' +
          '</li>';
        }).join('') + '</ol>'
      : '<p class="vd-memory-empty">还没有复习记录。复习一次后，这里会显示阶段与评分的变化。</p>';

    return '<div class="vd-memory">' +
      '<div class="vd-block-head">' +
        '<span class="vd-label">记忆</span>' +
        '<span class="vd-memory-badge">艾宾浩斯 ' + (stage == null ? '—' : (stage + 1) + '/' + (MEMORY_MAX_STAGE + 1)) + '</span>' +
      '</div>' +
      '<div class="vd-memory-bars" aria-hidden="true">' + segments + '</div>' +
      '<div class="vd-memory-grid">' +
        '<div class="vd-memory-fact"><span>当前阶段</span><b>' + (stage == null ? '—' : (stage + 1) + '<i>/' + (MEMORY_MAX_STAGE + 1) + '</i>') + '</b></div>' +
        '<div class="vd-memory-fact"><span>下次复习</span>' + dueText + '</div>' +
        '<div class="vd-memory-fact"><span>本次间隔</span><b>' + esc(intervalText) + '</b></div>' +
        '<div class="vd-memory-fact"><span>遗忘 / 复习</span><b>' + formatNumber(ctx, info.lapses == null ? 0 : info.lapses) + ' / ' + formatNumber(ctx, info.reps == null ? 0 : info.reps) + '</b></div>' +
      '</div>' +
      historyHtml +
    '</div>';
  }

  function partChipsHtml(parts) {
    return (Array.isArray(parts) ? parts : []).map((part) => {
      const type = part && part.type;
      const tone = type === 'prefix' ? 'prefix' : (type === 'suffix' ? 'suffix' : 'root');
      const typeLabel = tone === 'prefix' ? '前缀' : (tone === 'suffix' ? '后缀' : '词根');
      const note = part && typeof part.note === 'string' ? part.note.trim() : '';
      return '<span class="vd-part vd-part--' + tone + '"' + (note ? ' title="' + esc(note) + '"' : '') + '>' +
        '<em>' + typeLabel + '</em>' +
        '<b>' + esc(part && part.text) + '</b>' +
        (part && part.meaning ? '<span>' + esc(part.meaning) + '</span>' : '') +
      '</span>';
    }).join('');
  }

  function relatedChipsHtml(words) {
    const list = stringList(words).slice(0, 8);
    if (!list.length) return '';
    return '<div class="vd-related-row">' +
      '<span class="vd-related-label">同词族</span>' +
      list.map((item) =>
        '<button type="button" class="vd-related" data-related="' + esc(item) + '" title="复制 ' + esc(item) + '">' + esc(item) + '</button>'
      ).join('') +
    '</div>';
  }

  function lexiconBodyHtml(lexicon) {
    if (!lexiconHasContent(lexicon)) {
      return '<p class="vd-muted-line">正在分析词根与词缀…</p>';
    }
    const word = typeof lexicon.word === 'string' ? lexicon.word.trim().toLowerCase() : '';
    const rawBreakdown = typeof lexicon.breakdown === 'string' ? lexicon.breakdown.trim() : '';
    const breakdown = word && rawBreakdown.toLowerCase() === word ? '' : rawBreakdown;
    return (breakdown ? '<p class="vd-lex-breakdown">' + esc(breakdown) + '</p>' : '') +
      (Array.isArray(lexicon.parts) && lexicon.parts.length
        ? '<div class="vd-parts">' + partChipsHtml(lexicon.parts) + '</div>'
        : '') +
      relatedChipsHtml(lexicon.related);
  }

  function lexiconBlockHtml(word) {
    const saved = state.lexiconById[word.id] || (lexiconHasContent(word.lexicon) ? word.lexicon : null);
    return '<div class="vd-block vd-lexicon" id="vd-lexicon" data-loading="' + (saved ? 'false' : 'true') + '">' +
      '<div class="vd-block-head">' +
        '<span class="vd-label">词根词缀</span>' +
        '<span class="vd-block-aside" id="vd-lexicon-aside">' + (saved ? '本地词库' : '') + '</span>' +
      '</div>' +
      '<div class="vd-lexicon-body" id="vd-lexicon-body">' +
        (saved ? lexiconBodyHtml(saved) : '<p class="vd-muted-line">正在分析词根与词缀…</p>') +
      '</div>' +
    '</div>';
  }

  function hasMnemonic(word) {
    return Boolean(
      (typeof word.mnemonic === 'string' && word.mnemonic.trim()) ||
      stringList(word.associations).length
    );
  }

  function mnemonicBodyHtml(word) {
    const mnemonic = typeof word.mnemonic === 'string' ? word.mnemonic.trim() : '';
    const associations = stringList(word.associations);
    const family = stringList(word._wordFamily);
    if (!mnemonic && !associations.length) {
      return '<p class="vd-mnemonic-empty">还没有联想记忆。可以自己写一句，也可以让 AI 按谐音、场景或词根帮你编一个。</p>';
    }
    return (mnemonic ? '<p class="vd-mnemonic-text">' + esc(mnemonic) + '</p>' : '') +
      (associations.length
        ? '<div class="vd-assoc-list">' + associations.map((item) => '<span class="vd-assoc">' + esc(item) + '</span>').join('') + '</div>'
        : '') +
      (family.length ? relatedChipsHtml(family) : '');
  }

  function mnemonicBlockHtml(word) {
    return '<div class="vd-block vd-mnemonic" id="vd-mnemonic">' +
      '<div class="vd-block-head">' +
        '<span class="vd-label">联想记忆</span>' +
        '<button type="button" class="btn ghost vd-mnemonic-btn" data-vd="mnemonic">' +
          icon(ctx, 'sparkles', 14) + '<span>' + (hasMnemonic(word) ? '重新生成' : 'AI 生成联想') + '</span>' +
        '</button>' +
      '</div>' +
      '<div class="vd-mnemonic-body" id="vd-mnemonic-body">' + mnemonicBodyHtml(word) + '</div>' +
    '</div>';
  }

  function mergeWordUpdate(id, updated) {
    if (!updated || typeof updated !== 'object') return;
    const index = state.words.findIndex((item) => item.id === id);
    if (index < 0) return;
    const localFamily = state.words[index]._wordFamily;
    state.words[index] = Object.assign({}, state.words[index], updated);
    if (localFamily && !state.words[index]._wordFamily) state.words[index]._wordFamily = localFamily;
  }

  async function copyRelatedWord(rawText) {
    const value = String(rawText == null ? '' : rawText).trim();
    if (!value) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        toast('已复制「' + value + '」', 'ok');
        return;
      }
    } catch (err) { /* 剪贴板不可用时给出提示，不打断阅读 */ }
    toast('「' + value + '」· 可手动复制', 'warn');
  }

  async function loadLexicon(word) {
    if (!els.drawer) return;
    if (lexiconHasContent(state.lexiconById[word.id])) return;
    if (lexiconHasContent(word.lexicon)) {
      state.lexiconById[word.id] = word.lexicon;
      return;
    }
    const block = els.drawer.querySelector('#vd-lexicon');
    const body = els.drawer.querySelector('#vd-lexicon-body');
    const aside = els.drawer.querySelector('#vd-lexicon-aside');
    const available = Boolean(api && api.lookup && typeof api.lookup.lexicon === 'function');
    if (!available) {
      if (block) {
        block.classList.add('is-unavailable');
        block.setAttribute('data-loading', 'false');
      }
      if (body) body.innerHTML = '<p class="vd-muted-line">当前版本暂不提供词根词缀分析。</p>';
      if (aside) aside.textContent = '';
      return;
    }
    if (body) body.innerHTML = '<p class="vd-muted-line">正在分析词根与词缀…</p>';
    try {
      const result = await api.lookup.lexicon(word.word);
      if (state.openId !== word.id) return;
      if (!lexiconHasContent(result)) {
        if (block) block.setAttribute('data-loading', 'false');
        if (body) body.innerHTML = '<p class="vd-muted-line">这个单词没有匹配到可靠的词根词缀。</p>';
        if (aside) aside.textContent = '本地词库';
        return;
      }
      state.lexiconById[word.id] = result;
      if (body) body.innerHTML = lexiconBodyHtml(result);
      if (aside) aside.textContent = '本地词库';
      if (block) block.setAttribute('data-loading', 'false');
    } catch (err) {
      if (state.openId !== word.id) return;
      if (block) block.setAttribute('data-loading', 'false');
      if (body) {
        body.innerHTML = '<p class="vd-muted-line is-error">词根分析暂时失败。' +
          '<button type="button" class="vd-retry" data-mem-action="retry-lexicon">重试</button></p>';
      }
    }
  }

  async function generateMnemonic(word, button) {
    if (!api || !api.lookup || typeof api.lookup.mnemonic !== 'function') {
      toast('当前版本暂不支持 AI 联想生成', 'warn');
      return;
    }
    const body = els.drawer ? els.drawer.querySelector('#vd-mnemonic-body') : null;
    if (button) {
      button.disabled = true;
      button.classList.add('is-busy');
      button.innerHTML = icon(ctx, 'refresh', 14) + '<span>生成中…</span>';
    }
    if (body) body.innerHTML = '<p class="vd-muted-line">AI 正在编织联想，请稍候…</p>';
    try {
      const result = await api.lookup.mnemonic({
        word: word.word,
        translation: word.translation || '',
        context: word.context || ''
      });
      if (state.openId !== word.id) return;
      const mnemonic = result && typeof result.mnemonic === 'string' ? result.mnemonic.trim() : '';
      const associations = stringList(result && result.associations);
      const family = stringList(result && result.wordFamily);
      if (!mnemonic && !associations.length) {
        throw new Error('AI 没有返回可以展示的联想内容');
      }
      word.mnemonic = mnemonic;
      word.associations = associations;
      if (family.length) word._wordFamily = family;
      if (body) body.innerHTML = mnemonicBodyHtml(word);

      const patch = { mnemonic: mnemonic, associations: associations };
      const lexicon = state.lexiconById[word.id] || (lexiconHasContent(word.lexicon) ? word.lexicon : null);
      if (lexiconHasContent(lexicon)) patch.lexicon = lexicon;
      try {
        const updated = await api.vocab.update(word.id, patch);
        mergeWordUpdate(word.id, updated);
        toast('联想记忆已生成并保存', 'ok');
      } catch (saveErr) {
        toast('联想已生成，但保存失败：' + (saveErr && saveErr.message ? saveErr.message : '未知错误'), 'warn');
      }
    } catch (err) {
      const code = err && err.code;
      const message = err && err.message ? err.message : '未知错误';
      if (code === 'NO_AI_KEY') {
        if (body) {
          body.innerHTML = '<div class="vd-ai-hint">' + icon(ctx, 'info', 14) +
            '<span>AI 联想需要 API Key。去设置里配置后回来再试。</span>' +
            '<button type="button" class="btn ghost vd-ai-hint__btn" data-mem-action="settings">去设置</button>' +
          '</div>' + (hasMnemonic(word) ? mnemonicBodyHtml(word) : '');
        }
        toast('还没有配置 AI Key，去设置里填写后即可生成联想', 'warn');
      } else {
        if (body) {
          body.innerHTML = '<p class="vd-muted-line is-error">生成失败：' + esc(message) + '</p>' +
            (hasMnemonic(word) ? mnemonicBodyHtml(word) : '');
        }
        toast('生成失败：' + message, 'error');
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.classList.remove('is-busy');
        button.innerHTML = icon(ctx, 'sparkles', 14) +
          '<span>' + (hasMnemonic(word) ? '重新生成' : 'AI 生成联想') + '</span>';
      }
    }
  }

  function drawerHtml(word) {
    const sourceParts = Array.from(new Set([word.source && word.source.bookTitle, word.source && word.source.chapterTitle].filter(Boolean)));
    const sourceLabel = sourceParts.length ? sourceParts.join(' · ') : '手动添加';
    const due = dueInfo(word);
    const context = word.context
      ? '<blockquote class="vd-context">' + highlightWord(word.context, word.word, esc) + '</blockquote>'
      : '<p class="vd-context-trans">还没有原句。阅读时收藏可以自动带上上下文。</p>';
    const contextTranslation = word.contextTranslation
      ? '<p class="vd-context-trans">' + esc(word.contextTranslation) + '</p>'
      : '';

    return '<div class="vd-head">' +
        '<div class="vd-source">' + icon(ctx, 'book', 14) + '<span>' + esc(sourceLabel) + '</span></div>' +
        '<button type="button" class="icon-btn" data-vd="close" aria-label="关闭详情">' + icon(ctx, 'x', 18) + '</button>' +
      '</div>' +
      '<div class="vd-scroll">' +
        '<div class="vd-word">' + esc(word.word) + '</div>' +
        '<div class="vd-sub">' +
          '<span class="vd-phon">' + esc(word.phonetic || '暂无音标') + '</span>' +
          '<button type="button" class="btn ghost vd-speak" data-vd="speak">' + icon(ctx, 'speaker', 15) + '<span>朗读</span></button>' +
        '</div>' +
        '<p class="vd-trans">' + esc(word.translation || '暂无释义') + '</p>' +
        context + contextTranslation +
        memoryBlockHtml(word) +
        lexiconBlockHtml(word) +
        mnemonicBlockHtml(word) +
        '<div class="vd-field">' +
          '<label class="vd-label" for="vd-note">笔记</label>' +
          '<textarea class="input vd-note" id="vd-note" rows="4" placeholder="写下你的记忆线索：搭配、场景、词根…">' + esc(word.note || '') + '</textarea>' +
          '<p class="vd-hint" id="vd-note-state"></p>' +
        '</div>' +
        '<div class="vd-field">' +
          '<label class="vd-label" for="vd-tag-input">标签</label>' +
          '<div class="vd-tags" id="vd-tags">' + tagChipsHtml(word.tags) + '</div>' +
          '<input class="input vd-tag-input" id="vd-tag-input" type="text" autocomplete="off" placeholder="输入标签，回车添加">' +
        '</div>' +
      '</div>' +
      '<div class="vd-foot">' +
        '<button type="button" class="btn ghost vd-danger" data-vd="delete">' + icon(ctx, 'trash', 15) + '<span>删除单词</span></button>' +
        '<span class="vd-foot-date">加入于 ' + esc(formatDate(ctx, word.createdAt, 'long') || '—') + ' · ' + esc(due.label) + '</span>' +
      '</div>';
  }

  function openDrawer(id) {
    const word = findWord(id);
    if (!word) return;
    state.openId = id;
    if (!els.drawer) return;
    els.drawer.innerHTML = drawerHtml(word);
    els.drawer.classList.add('is-open');
    els.drawer.setAttribute('aria-hidden', 'false');
    if (els.backdrop) {
      els.backdrop.hidden = false;
      requestAnimationFrame(() => els.backdrop.classList.add('is-open'));
    }
    if (typeof document !== 'undefined' && document.body) {
      document.body.style.overflow = 'hidden';
    }
    bindDrawer(word);
    const closeButton = els.drawer.querySelector('[data-vd="close"]');
    if (closeButton) closeButton.focus({ preventScroll: true });
  }

  function closeDrawer() {
    state.openId = null;
    if (!els.drawer) return;
    els.drawer.classList.remove('is-open');
    els.drawer.setAttribute('aria-hidden', 'true');
    if (els.backdrop) {
      els.backdrop.classList.remove('is-open');
      window.setTimeout(() => {
        if (!els.backdrop.classList.contains('is-open')) els.backdrop.hidden = true;
      }, 240);
    }
    if (typeof document !== 'undefined' && document.body) {
      document.body.style.overflow = '';
    }
  }

  function bindDrawer(word) {
    const drawer = els.drawer;
    const note = drawer.querySelector('#vd-note');
    const noteState = drawer.querySelector('#vd-note-state');
    const tagsBox = drawer.querySelector('#vd-tags');
    const tagInput = drawer.querySelector('#vd-tag-input');

    drawer.querySelectorAll('[data-vd]').forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.getAttribute('data-vd');
        if (action === 'close') closeDrawer();
        if (action === 'speak') {
          try {
            button.classList.add('is-speaking');
            await speech.speak(word.word);
          } catch (err) {
            toast(err && err.message ? err.message : '朗读失败', 'warn');
          } finally {
            button.classList.remove('is-speaking');
          }
        }
        if (action === 'delete') removeWordById(word.id, button);
        if (action === 'mnemonic') generateMnemonic(word, button);
      });
    });

    if (note) {
      note.addEventListener('input', () => {
        if (noteState) {
          noteState.className = 'vd-hint';
          noteState.textContent = '正在保存…';
        }
        if (state.noteTimer) window.clearTimeout(state.noteTimer);
        state.noteTimer = window.setTimeout(async () => {
          try {
            const updated = await api.vocab.update(word.id, { note: note.value });
            word.note = note.value;
            if (updated && updated.note != null) word.note = updated.note;
            if (noteState) {
              noteState.className = 'vd-hint is-ok';
              noteState.textContent = '已保存';
            }
          } catch (err) {
            if (noteState) {
              noteState.className = 'vd-hint is-error';
              noteState.textContent = '保存失败：' + (err && err.message ? err.message : '未知错误');
            }
          }
        }, 650);
      });
    }

    async function persistTags(nextTags) {
      try {
        await api.vocab.update(word.id, { tags: nextTags });
        word.tags = nextTags.slice();
        if (tagsBox) tagsBox.innerHTML = tagChipsHtml(nextTags);
        bindTagRemove();
      } catch (err) {
        toast('标签保存失败：' + (err && err.message ? err.message : '未知错误'), 'error');
      }
    }

    function bindTagRemove() {
      if (!tagsBox) return;
      tagsBox.querySelectorAll('[data-remove-tag]').forEach((button) => {
        button.addEventListener('click', () => {
          const tag = button.getAttribute('data-remove-tag');
          const next = (Array.isArray(word.tags) ? word.tags : []).filter((item) => item !== tag);
          persistTags(next);
        });
      });
    }

    if (tagInput) {
      tagInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const value = tagInput.value.trim().replace(/^#/, '');
        if (!value) return;
        const current = Array.isArray(word.tags) ? word.tags : [];
        if (current.indexOf(value) >= 0) {
          tagInput.value = '';
          return;
        }
        tagInput.value = '';
        persistTags(current.concat(value));
      });
    }

    bindTagRemove();

    /* 记忆 / 词根 / 联想：related chips、去设置、重试词根 */
    const scrollArea = drawer.querySelector('.vd-scroll');
    if (scrollArea) {
      scrollArea.addEventListener('click', (event) => {
        const related = event.target.closest('[data-related]');
        if (related) {
          copyRelatedWord(related.getAttribute('data-related'));
          return;
        }
        const actionNode = event.target.closest('[data-mem-action]');
        if (!actionNode) return;
        const memAction = actionNode.getAttribute('data-mem-action');
        if (memAction === 'settings') {
          navigate('settings');
          return;
        }
        if (memAction === 'retry-lexicon') {
          delete state.lexiconById[word.id];
          const body = drawer.querySelector('#vd-lexicon-body');
          if (body) body.innerHTML = '<p class="vd-muted-line">正在重新分析词根与词缀…</p>';
          loadLexicon(word);
        }
      });
    }
    loadLexicon(word);
  }

  /* ---- 加载 -------------------------------------------------------------- */
  async function load(options) {
    const opts = options || {};
    if (!api || !api.vocab || typeof api.vocab.list !== 'function') {
      state.loading = false;
      if (els.rows) els.rows.innerHTML = errorHtml('无法连接到生词本服务。请确认通过 Lumen 桌面应用打开，或稍后重试。');
      return;
    }
    const reqId = ++state.reqId;
    if (!opts.silent) {
      state.loading = true;
      paintList();
    }
    if (els.table) els.table.classList.add('is-loading');

    try {
      const filter = {};
      if (state.query.trim()) filter.query = state.query.trim();
      filter.sort = state.sort;

      const [wordsResult, statsResult] = await Promise.all([
        api.vocab.list(filter),
        typeof api.vocab.stats === 'function'
          ? api.vocab.stats().catch(() => null)
          : Promise.resolve(null)
      ]);
      if (reqId !== state.reqId) return;
      state.words = Array.isArray(wordsResult) ? wordsResult : [];
      state.stats = statsResult || state.stats;
      state.loading = false;
      paintHeader();
      paintList();
    } catch (err) {
      if (reqId !== state.reqId) return;
      state.loading = false;
      if (els.rows) els.rows.innerHTML = errorHtml(err && err.message ? err.message : '读取生词失败');
    } finally {
      if (reqId === state.reqId && els.table) els.table.classList.remove('is-loading');
    }
  }

  /* ---- 事件绑定 ---------------------------------------------------------- */
  bindEmptyActions();

  if (els.search) {
    els.search.addEventListener('input', () => {
      state.query = els.search.value || '';
      if (state.searchTimer) window.clearTimeout(state.searchTimer);
      state.searchTimer = window.setTimeout(() => { load({ silent: true }); }, 280);
    });
    els.search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && els.search.value) {
        els.search.value = '';
        state.query = '';
        load({ silent: true });
      }
    });
  }

  if (els.sort) {
    els.sort.addEventListener('change', () => {
      state.sort = els.sort.value;
      load({ silent: true });
    });
  }

  if (els.filters) {
    els.filters.addEventListener('click', (event) => {
      const button = event.target.closest('.vocab-seg__btn');
      if (!button) return;
      const value = button.getAttribute('data-filter');
      if (!value || value === state.filter) return;
      state.filter = value;
      syncFilterButtons();
      paintList();
    });
  }

  if (els.exportBtn) {
    els.exportBtn.addEventListener('click', async () => {
      if (state.exporting) return;
      if (!api || !api.vocab || typeof api.vocab.exportCsv !== 'function') {
        toast('当前环境不支持导出', 'warn');
        return;
      }
      state.exporting = true;
      els.exportBtn.disabled = true;
      try {
        const result = await api.vocab.exportCsv();
        if (result && result.saved) {
          toast('已导出到 ' + (result.path || '数据目录'), 'ok');
        } else {
          toast('已取消导出', 'warn');
        }
      } catch (err) {
        toast('导出失败：' + (err && err.message ? err.message : '未知错误'), 'error');
      } finally {
        state.exporting = false;
        els.exportBtn.disabled = false;
      }
    });
  }

  if (els.backdrop) {
    els.backdrop.addEventListener('click', closeDrawer);
  }

  const onKeydown = (event) => {
    if (!root.isConnected) {
      document.removeEventListener('keydown', onKeydown);
      return;
    }
    if (event.key !== 'Escape') return;
    if (state.openId) {
      event.preventDefault();
      closeDrawer();
    }
  };
  document.addEventListener('keydown', onKeydown);

  await load();
}