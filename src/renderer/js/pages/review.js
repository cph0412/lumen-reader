/**
 * Lumen · 流明阅读 — 复习页面模块（#/review）
 * 契约：export async function render(root, ctx)
 *
 * 数据：api.vocab.due / review / list，api.stats.overview
 * 交互：空格或点击翻面，1-4 评分；轻柔的卡片切换动效；完成/空/错误态齐全。
 */

const FALLBACK_ICONS = {
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9.5a3.5 3.5 0 0 1 0 5"/><path d="M18.5 7a7 7 0 0 1 0 10"/>',
  flame: '<path d="M12 3c3 4 5 5.5 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2.5-5 .5 1.5 1.5 2 2.5 2 0-2 0-4 0-6z"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 1.8"/>',
  check: '<path d="m5 13 4 4L19 7"/>',
  sparkles: '<path d="m12 4 1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4z"/><path d="M18 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/>',
  'arrow-left': '<path d="M19 12H5m0 0 6-6m-6 6 6 6"/>',
  dot: '<circle cx="12" cy="12" r="3"/>'
};

const RATINGS = [
  { value: 'again', label: '重来', sub: '10 分钟后', key: '1' },
  { value: 'hard', label: '困难', sub: '间隔 1 天', key: '2' },
  { value: 'good', label: '记得', sub: '间隔 ×2.5', key: '3' },
  { value: 'easy', label: '简单', sub: '间隔 ×4', key: '4' }
];

const RATING_VALUES = RATINGS.map((item) => item.value);

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
    reqId: 0
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
      '<section class="review-stage" id="review-stage" aria-live="polite"></section>' +
    '</div>';

  const els = {
    due: root.querySelector('#review-due'),
    streak: root.querySelector('#review-streak'),
    progress: root.querySelector('#review-progress'),
    progressBar: root.querySelector('#review-progress-bar'),
    progressLabel: root.querySelector('#review-progress-label'),
    progressCount: root.querySelector('#review-progress-count'),
    stage: root.querySelector('#review-stage')
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

  async function loadNextDue() {
    try {
      if (!api || !api.vocab || typeof api.vocab.list !== 'function') return;
      const list = await api.vocab.list({ sort: 'due' });
      const now = Date.now();
      const upcoming = (Array.isArray(list) ? list : [])
        .map((word) => (word && word.srs && word.srs.due ? word.srs.due : null))
        .filter((due) => due && new Date(due).getTime() > now)
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
      state.nextDue = upcoming.length ? upcoming[0] : null;
    } catch (err) {
      state.nextDue = null;
    }
    const node = els.stage.querySelector('[data-next-due]');
    if (node) node.textContent = nextDueLabel();
  }

  /* ---- 状态视图 ---------------------------------------------------------- */
  function renderLoading() {
    state.mode = 'loading';
    if (!els.stage) return;
    els.stage.innerHTML = '<div class="review-skeleton" aria-hidden="true">' +
      '<span class="skeleton is-word"></span>' +
      '<span class="skeleton is-line"></span>' +
      '<span class="skeleton is-line is-short"></span>' +
      '<span class="skeleton is-btn"></span>' +
    '</div>';
    paintProgress();
  }

  function renderError(message) {
    state.mode = 'error';
    if (!els.stage) return;
    els.stage.innerHTML = '<div class="review-error">' +
      '<div class="review-error__glyph">' + icon(ctx, 'refresh', 28) + '</div>' +
      '<h2 class="review-error__title">复习队列暂时打不开</h2>' +
      '<p class="review-error__body">' + esc(message || '无法读取到期的单词，请稍后重试。') + '</p>' +
      '<div class="review-actions">' +
        '<button type="button" class="btn primary" id="review-retry">' + icon(ctx, 'refresh', 16) + '<span>重新加载</span></button>' +
        '<button type="button" class="btn ghost" id="review-back">回生词本</button>' +
      '</div>' +
    '</div>';
    const retry = els.stage.querySelector('#review-retry');
    if (retry) retry.addEventListener('click', () => { load(); });
    const back = els.stage.querySelector('#review-back');
    if (back) back.addEventListener('click', () => navigate('vocab'));
    paintProgress();
  }

  function renderEmpty() {
    state.mode = 'empty';
    if (!els.stage) return;
    els.stage.innerHTML = '<div class="review-empty">' +
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
    const library = els.stage.querySelector('#review-library');
    if (library) library.addEventListener('click', () => navigate('library'));
    const vocab = els.stage.querySelector('#review-vocab');
    if (vocab) vocab.addEventListener('click', () => navigate('vocab'));
    paintProgress();
    loadNextDue();
  }

  function ratingButtonsHtml() {
    return RATINGS.map((rating) =>
      '<button type="button" class="rating-btn rating-btn--' + rating.value + '" data-rating="' + rating.value + '" aria-label="' + rating.label + '，间隔 ' + rating.sub + '">' +
        '<span class="kbd">' + rating.key + '</span>' +
        '<span class="rating-btn__label">' + rating.label + '</span>' +
        '<span class="rating-btn__sub">' + rating.sub + '</span>' +
      '</button>'
    ).join('');
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

    els.stage.innerHTML =
      '<article class="flashcard is-entering" id="review-card">' +
        '<div class="flashcard__meta">' +
          '<span class="flashcard__source">' + icon(ctx, 'book', 14) + '<span>' + esc(sourceLabel) + '</span></span>' +
          '<span class="flashcard__due">' + icon(ctx, 'clock', 12) + ' 待复习</span>' +
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
      '<div class="review-rating" id="review-rating" aria-label="复习评分">' + ratingButtonsHtml() + '</div>' +
      '<p class="review-keys-hint">按键 1-4 评分 · 空格翻面</p>';

    const card = els.stage.querySelector('#review-card');
    if (card) {
      window.requestAnimationFrame(() => card.classList.remove('is-entering'));
    }

    const revealButton = els.stage.querySelector('#review-reveal');
    if (revealButton) revealButton.addEventListener('click', reveal);

    const speakButton = els.stage.querySelector('[data-action="speak"]');
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

    els.stage.querySelectorAll('[data-rating]').forEach((button) => {
      button.addEventListener('click', () => rate(button.getAttribute('data-rating')));
    });

    paintProgress();
  }

  function reveal() {
    if (state.revealed || !state.queue.length) return;
    state.revealed = true;
    const card = els.stage.querySelector('.flashcard');
    if (card) card.classList.add('is-revealed');
    const ratingBar = els.stage.querySelector('#review-rating');
    if (ratingBar) ratingBar.classList.add('is-visible');
    const revealButton = els.stage.querySelector('#review-reveal');
    if (revealButton) revealButton.hidden = true;
    const hint = els.stage.querySelector('.flashcard__hint');
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
    const box = els.stage.querySelector('#review-pos');
    if (!box) return;
    box.innerHTML = (parts || []).map((part) => '<span class="flashcard__pos-tag">' + esc(part) + '</span>').join('');
  }

  async function rate(rating) {
    if (!state.revealed || state.busy) return;
    if (RATING_VALUES.indexOf(rating) < 0) return;
    const word = state.queue[0];
    if (!word) return;

    state.busy = true;
    const buttons = Array.from(els.stage.querySelectorAll('[data-rating]'));
    buttons.forEach((button) => { button.disabled = true; });

    try {
      await api.vocab.review(word.id, rating);

      state.ratings[rating] += 1;
      state.roundReviewed += 1;
      state.totalReviewed += 1;
      if (rating !== 'again') state.correct += 1;
      if (rating === 'again') state.againWords.push(word);
      state.dueCount = Math.max(0, state.dueCount - 1);
      paintChips();

      const card = els.stage.querySelector('.flashcard');
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
  function finishRound() {
    state.mode = 'finish';
    state.revealed = false;
    state.busy = false;
    const accuracy = state.totalReviewed > 0
      ? Math.round((state.correct / state.totalReviewed) * 100)
      : 0;
    const againCount = state.againWords.length;

    els.stage.innerHTML = '<div class="review-finish">' +
      '<div class="review-finish__glyph">' + icon(ctx, 'sparkles', 30) + '</div>' +
      '<h2 class="review-finish__title">今天复习完成</h2>' +
      '<p class="review-finish__body">你把 ' + formatNumber(ctx, state.totalReviewed) + ' 个词又往前推了一点。到期的词会按各自的间隔回来找你。</p>' +
      '<div class="review-finish__stats">' +
        '<div class="review-finish__stat"><b>' + formatNumber(ctx, state.totalReviewed) + '</b><span>今日已复习</span></div>' +
        '<div class="review-finish__stat"><b>' + accuracy + '%</b><span>正确率</span></div>' +
        '<div class="review-finish__stat"><b>' + formatNumber(ctx, state.ratings.again) + '</b><span>需要重来</span></div>' +
      '</div>' +
      '<p class="review-next">连续复习 <b>' + formatNumber(ctx, state.streak) + '</b> 天 · 下一次复习：<b data-next-due>' + esc(nextDueLabel()) + '</b></p>' +
      '<div class="review-actions">' +
        (againCount > 0
          ? '<button type="button" class="btn primary" id="review-again-round">' + icon(ctx, 'refresh', 16) + '<span>再复习一轮</span></button>'
          : '<button type="button" class="btn ghost" disabled title="这一轮没有需要重来的单词">再复习一轮</button>') +
        '<button type="button" class="btn ghost" id="review-to-vocab">' + icon(ctx, 'arrowLeft', 16) + '<span>回生词本</span></button>' +
        '<button type="button" class="btn ghost" id="review-to-stats">查看足迹</button>' +
      '</div>' +
    '</div>';

    const againButton = els.stage.querySelector('#review-again-round');
    if (againButton) againButton.addEventListener('click', restartRound);
    const vocabButton = els.stage.querySelector('#review-to-vocab');
    if (vocabButton) vocabButton.addEventListener('click', () => navigate('vocab'));
    const statsButton = els.stage.querySelector('#review-to-stats');
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
    try {
      const [dueList, overview] = await Promise.all([
        api.vocab.due(60),
        api.stats && typeof api.stats.overview === 'function'
          ? api.stats.overview().catch(() => null)
          : Promise.resolve(null)
      ]);
      if (reqId !== state.reqId) return;

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
    if (RATING_VALUES.indexOf(String(event.key)) < 0) return;
    event.preventDefault();
    if (!state.revealed) {
      reveal();
      return;
    }
    rate(RATING_VALUES[Number(event.key) - 1]);
  };
  document.addEventListener('keydown', onKeydown);

  await load();
}
