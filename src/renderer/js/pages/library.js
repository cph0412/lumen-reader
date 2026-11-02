// Lumen · 书库页面
import { icons } from '../icons.js';
import {
  debounce, clamp, readingMinutes, formatDateFull,
  friendlyError, statusLabel, escapeHtml, truncate
} from '../ui.js';

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'reading', label: '在读' },
  { key: 'unread', label: '未读' },
  { key: 'finished', label: '已读完' }
];

const SAMPLE_HINT = '示例书会在首次启动时由主进程自动加入书架。';

let S = null;

/* ------------------------------ 小工具 ------------------------------ */

function pickRecent(books) {
  const withDate = books.filter((book) => book && book.lastOpenedAt);
  if (!withDate.length) return books[0] || null;
  return withDate.slice().sort((a, b) => new Date(b.lastOpenedAt) - new Date(a.lastOpenedAt))[0];
}

function paletteOf(book) {
  const raw = Number(book.palette);
  if (Number.isInteger(raw) && raw >= 0 && raw <= 5) return raw;
  let hash = 0;
  const id = String(book.id || book.title || '');
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % 6;
}

function percentOf(book) {
  // Always trust the stored position. A book marked "finished" can be re-read
  // from an earlier point, and the old "finished => 100" shortcut would then
  // hide the latest progress forever.
  const percent = Number(book.progress && book.progress.percent);
  return Number.isFinite(percent) ? clamp(percent, 0, 100) : 0;
}

function chapterOf(book) {
  const index = clamp(Number(book.progress && book.progress.chapterIndex) || 0, 0, Math.max(0, (book.chapterCount || 1) - 1));
  const chapter = Array.isArray(book.chapters) ? book.chapters[index] : null;
  return { index, title: (chapter && chapter.title) || '第 ' + (index + 1) + ' 章' };
}

function authorOf(book) {
  const author = String(book.author || '').trim();
  return author || '未知作者';
}

function coverLenClass(title) {
  const length = String(title || '').length;
  if (length > 46) return 'l';
  if (length > 26) return 'm';
  return 's';
}

function coverHtml(book, options = {}) {
  const palette = paletteOf(book);
  const title = String(book.title || '未命名');
  const favorite = book.favorite
    ? '<span class="cover-fav" aria-label="已收藏">' + icons.star(14) + '</span>'
    : '';
  const more = options.more
    ? '<button type="button" class="book-more" data-more="' + escapeHtml(book.id) + '" data-tip="更多操作" aria-label="更多操作">' + icons.more(15) + '</button>'
    : '';
  return '<div class="book-cover palette-' + palette + '" data-len="' + coverLenClass(title) + '">' +
    '<span class="cover-brand">Lumen · ' + (book.language === 'en' ? 'English' : 'Reading') + '</span>' +
    '<div class="cover-title">' + escapeHtml(title) + '</div>' +
    '<span class="cover-rule"></span>' +
    '<span class="cover-author">' + escapeHtml(authorOf(book)) + '</span>' +
    favorite + more + '</div>';
}

function readingStat(book, count) {
  if (count > 0) {
    return '<span class="difficulty" data-tip="本书已收藏 ' + count + ' 个生词" data-tip-pos="top">' +
      icons.sparkles(11) + ' ' + count + ' 生词</span>';
  }
  return '<span class="empty-diff">' + readingMinutes(book.wordCount) + ' 分钟</span>';
}

function greetingOf(date) {
  const hour = date.getHours();
  if (hour < 12) return { word: '早上好', note: '让今天从一页好文字开始。' };
  if (hour < 18) return { word: '下午好', note: '午后适合读一段安静的故事。' };
  return { word: '晚上好', note: '夜色渐深，读几页再睡。' };
}

/* ------------------------------ 骨架屏 ------------------------------ */

function skeletonHtml() {
  const cards = Array.from({ length: 5 }, () =>
    '<div class="sk-book"><div class="sk-cover"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div>').join('');
  return '<div class="page library-page skeleton-library" aria-busy="true" aria-label="正在加载书库">' +
    '<div class="sk-head">' +
    '<div class="sk-head-left"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text" style="margin-top:7px;width:150px"></div></div>' +
    '<div class="skeleton sk-tools"></div>' +
    '</div>' +
    '<div class="sk-continue"></div>' +
    '<div class="sk-section"><div class="skeleton" style="width:120px;height:20px;border-radius:6px"></div><div class="skeleton" style="width:240px;height:29px;border-radius:999px"></div></div>' +
    '<div class="sk-grid">' + cards + '</div>' +
    '</div>';
}

/* ------------------------------ 页面 HTML ------------------------------ */

function statsLineHtml(state) {
  const stats = state.vocabStats || {};
  const total = Number(stats.total || stats.totalWords || 0) || 0;
  const due = Number(stats.due || stats.dueCount || stats.dueToday || 0) || 0;
  const parts = [];
  const books = Array.isArray(state.books) ? state.books.length : 0;
  if (books > 0) parts.push('书架 <strong>' + books + '</strong> 本');
  if (total > 0) parts.push('已收藏 <strong>' + total + '</strong> 个生词');
  if (due > 0) parts.push('待复习 <strong>' + due + '</strong> 个');
  if (!parts.length) return '选中任意词句，即刻看到中文翻译与 AI 语境解析。';
  return parts.join('<span class="sep"></span>');
}

function heroHtml(st) {
  const recent = pickRecent(st.books);
  if (recent) return continueHtml(st, recent);
  return welcomeHtml(st);
}

function continueHtml(st, book) {
  const percent = percentOf(book);
  const chapter = chapterOf(book);
  const totalChapters = Math.max(1, Number(book.chapterCount) || (Array.isArray(book.chapters) ? book.chapters.length : 1));
  const remaining = Math.max(1, Math.ceil((Number(book.wordCount) || 0) * (1 - percent / 100) / 220));
  const started = percent > 0 || Boolean(book.lastOpenedAt);
  const actionLabel = started ? '继续阅读' : '开始阅读';
  const lastRead = book.lastOpenedAt ? st.ctx.formatDate(book.lastOpenedAt, 'short') : '尚未开始';
  const favorite = book.favorite ? '<span class="sep"></span><span>已收藏</span>' : '';
  const metaLeft = started ? '上次阅读 ' + escapeHtml(lastRead) : '还没有开始读';
  const metaRight = started ? '约剩 ' + remaining + ' 分钟' : '全书约 ' + remaining + ' 分钟';
  return '<article class="continue-card">' +
    '<div class="continue-cover">' + coverHtml(book) + '</div>' +
    '<div class="continue-body">' +
    '<div class="continue-eyebrow"><span class="pulse"></span>' + actionLabel + '</div>' +
    '<h2 class="continue-title">' + escapeHtml(book.title || '未命名') + '</h2>' +
    '<div class="continue-author">' + escapeHtml(authorOf(book)) + '</div>' +
    '<div class="continue-chapter"><span class="chip static">第 ' + (chapter.index + 1) + ' / ' + totalChapters + ' 章</span>' +
    '<span class="chapter-name">' + escapeHtml(chapter.title) + '</span></div>' +
    '<div class="continue-meter"><div class="progress"><i style="width:' + percent + '%"></i></div>' +
    '<span class="percent">' + Math.round(percent) + '%</span></div>' +
    '<div class="continue-meta"><span>' + metaLeft + '</span><span class="sep"></span>' +
    '<span>' + metaRight + '</span>' + favorite + '</div>' +
    '</div>' +
    '<div class="continue-cta"><button type="button" class="btn primary" data-act="continue" data-id="' + escapeHtml(book.id) + '">' + actionLabel + ' ' + icons.arrowRight(16) + '</button></div>' +
    '</article>';
}

function welcomeHtml() {
  return '<section class="hero">' +
    '<div class="hero-copy">' +
    '<span class="eyebrow">' + icons.sparkles(12) + ' Lumen · 流明阅读</span>' +
    '<h2 class="hero-title">把每一页，<br><em>读成自己的语言。</em></h2>' +
    '<p class="hero-sub">导入一本英文原著。选中词语或句子的瞬间，中文翻译、词典释义与 AI 语境解析就会浮现；一键收藏成生词，让偶遇变成真正的掌握。</p>' +
    '<div class="hero-actions">' +
    '<button type="button" class="btn primary" data-act="import">' + icons.plus(16) + ' 导入第一本 TXT</button>' +
    '<button type="button" class="btn" data-act="samples">' + icons.bookOpen(16) + ' 加载示例书</button>' +
    '</div>' +
    '<div class="hero-note">' + icons.info(14) + ' 支持拖拽 .txt 文件到窗口任意位置</div>' +
    '</div>' +
    '<div class="hero-art" aria-hidden="true">' +
    '<div class="art-card"></div><div class="art-card"></div>' +
    '<span class="art-quote">“</span>' +
    '<span class="art-mark">A room without books is like a body without a soul.</span>' +
    '</div>' +
    '</section>';
}

function filtersHtml(st) {
  return '<div class="segmented" role="tablist" aria-label="筛选书架">' +
    FILTERS.map((filter) =>
      '<button type="button" role="tab" data-filter="' + filter.key + '" class="' + (st.filter === filter.key ? 'active' : '') + '" aria-selected="' + (st.filter === filter.key) + '">' + filter.label + '</button>'
    ).join('') +
    '</div>' +
    '<button type="button" class="chip ' + (st.favOnly ? 'active' : '') + '" data-act="fav-filter" aria-pressed="' + st.favOnly + '">' +
    icons.star(13) + ' 收藏</button>';
}

function pageHtml(st) {
  const greeting = greetingOf(new Date());
  return '<div class="page library-page">' +
    '<header class="library-head">' +
    '<div class="greet">' +
    '<div class="greet-date">' + icons.calendar(13) + formatDateFull() + '</div>' +
    '<h1 class="greet-title">' + greeting.word + '，<em>' + greeting.note + '</em></h1>' +
    '<div class="greet-sub">' + statsLineHtml(st.ctx.state) + '</div>' +
    '</div>' +
    '<div class="library-tools">' +
    '<label class="search-field">' +
    '<span class="search-ico">' + icons.search(15) + '</span>' +
    '<input type="search" id="library-search" class="input" placeholder="搜索书名或作者" autocomplete="off" spellcheck="false" aria-label="搜索书名或作者" value="' + escapeHtml(st.query) + '" />' +
    '<kbd class="kbd">Ctrl K</kbd>' +
    '</label>' +
    '<button type="button" class="btn primary import-btn" data-act="import">' + icons.plus(16) + ' 导入 TXT</button>' +
    '</div>' +
    '</header>' +
    '<section id="library-hero">' + heroHtml(st) + '</section>' +
    '<section class="shelf" aria-label="我的书架">' +
    '<div class="shelf-head">' +
    '<div class="shelf-title-row"><h2>我的书架</h2><span class="shelf-count" id="shelf-count"></span></div>' +
    '<div class="shelf-filters">' + filtersHtml(st) + '</div>' +
    '</div>' +
    '<div class="book-grid" id="book-grid"></div>' +
    '</section>' +
    '<div class="drop-overlay" id="drop-overlay" aria-hidden="true">' +
    '<div class="drop-inner">' +
    '<span class="drop-icon">' + icons.upload(26) + '</span>' +
    '<h3>松手即可导入</h3>' +
    '<p>英文原著 TXT 会被复制到 Lumen 书库，原文件不会移动。</p>' +
    '<div class="drop-formats"><span class="chip static">.txt</span><span class="chip static">UTF-8</span><span class="chip static">UTF-16</span><span class="chip static">GB18030</span></div>' +
    '</div>' +
    '</div>' +
    '</div>';
}

/* ------------------------------ 书架渲染 ------------------------------ */

function sortedBooks(books) {
  const weight = { reading: 0, unread: 1, finished: 2 };
  return books.slice().sort((a, b) => {
    const statusDiff = (weight[a.status] === undefined ? 3 : weight[a.status]) - (weight[b.status] === undefined ? 3 : weight[b.status]);
    if (statusDiff !== 0) return statusDiff;
    const aDate = new Date(a.lastOpenedAt || a.addedAt || 0).getTime() || 0;
    const bDate = new Date(b.lastOpenedAt || b.addedAt || 0).getTime() || 0;
    return bDate - aDate;
  });
}

function filteredBooks(st) {
  const query = st.query.trim().toLowerCase();
  return st.books.filter((book) => {
    if (st.favOnly && !book.favorite) return false;
    if (st.filter !== 'all' && book.status !== st.filter) return false;
    if (query) {
      const haystack = (String(book.title || '') + ' ' + String(book.author || '')).toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function bookCardHtml(st, book) {
  const percent = percentOf(book);
  const count = st.vocabByBook.get(book.id) || 0;
  const status = book.status || 'unread';
  const statusClass = ['reading', 'finished'].includes(status) ? status : 'unread';
  return '<article class="book' + (book.favorite ? ' has-fav' : '') + '" data-id="' + escapeHtml(book.id) + '" tabindex="0" role="button" aria-label="打开《' + escapeHtml(book.title || '未命名') + '》">' +
    coverHtml(book, { more: true }) +
    '<div class="book-info">' +
    '<h3 class="book-title">' + escapeHtml(book.title || '未命名') + '</h3>' +
    '<div class="book-author">' + escapeHtml(authorOf(book)) + '</div>' +
    '<div class="book-meter"><div class="progress"><i style="width:' + percent + '%"></i></div>' +
    '<span class="pct">' + (percent > 0 ? Math.round(percent) + '%' : '—') + '</span></div>' +
    '<div class="book-foot"><span class="status ' + statusClass + '"><i></i>' + statusLabel(status) + '</span>' +
    readingStat(book, count) + '</div>' +
    '</div>' +
    '</article>';
}

function emptyShelfHtml(st) {
  if (!st.books.length) {
    return '<div class="empty" style="grid-column:1/-1">' +
      '<div class="empty-icon">' + icons.bookOpen(26) + '</div>' +
      '<h3>书架还空着</h3>' +
      '<p>导入一本英文原著，或先加载示例书。支持拖拽文件到窗口任意位置，Lumen 会妥善保存编码与章节。</p>' +
      '<div class="empty-actions">' +
      '<button type="button" class="btn primary" data-act="import">' + icons.plus(16) + ' 导入第一本 TXT</button>' +
      '<button type="button" class="btn" data-act="samples">' + icons.bookOpen(16) + ' 加载示例书</button>' +
      '</div>' +
      '<p class="muted" style="margin-top:14px;font-size:11px">' + SAMPLE_HINT + '</p>' +
      '</div>';
  }
  return '<div class="empty sm" style="grid-column:1/-1">' +
    '<div class="empty-icon">' + icons.search(20) + '</div>' +
    '<h3>没有找到符合条件的书</h3>' +
    '<p>试试换一个关键词，或清除筛选条件。</p>' +
    '<div class="empty-actions"><button type="button" class="btn sm" data-act="clear-filters">清除筛选</button></div>' +
    '</div>';
}

function paintShelf(st) {
  const grid = st.root.querySelector('#book-grid');
  const countEl = st.root.querySelector('#shelf-count');
  if (!grid) return;
  const list = sortedBooks(filteredBooks(st));
  grid.innerHTML = list.length ? list.map((book) => bookCardHtml(st, book)).join('') : emptyShelfHtml(st);
  if (countEl) {
    countEl.textContent = st.query.trim() || st.favOnly || st.filter !== 'all'
      ? list.length + ' / ' + st.books.length + ' 本'
      : st.books.length + ' 本';
  }
  st.root.querySelectorAll('[data-filter]').forEach((button) => {
    const active = button.dataset.filter === st.filter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  const favButton = st.root.querySelector('[data-act="fav-filter"]');
  if (favButton) {
    favButton.classList.toggle('active', st.favOnly);
    favButton.setAttribute('aria-pressed', String(st.favOnly));
  }
}

/* ------------------------------ 事件 ------------------------------ */

function add(st, target, type, handler, options) {
  target.addEventListener(type, handler, options);
  st.cleanups.push(() => target.removeEventListener(type, handler, options));
}

function setBtnBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.idleHtml = button.innerHTML;
    button.classList.add('is-busy');
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span> ' + (label || '处理中…');
  } else {
    button.classList.remove('is-busy');
    button.disabled = false;
    if (button.dataset.idleHtml) button.innerHTML = button.dataset.idleHtml;
  }
}

function closeMenu(st) {
  if (st.menuCleanup) { st.menuCleanup(); st.menuCleanup = null; }
  if (st.menu) { st.menu.remove(); st.menu = null; }
}

function bookMenuHtml(book) {
  const favLabel = book.favorite ? '取消收藏' : '加入收藏';
  const statusLabelText = book.status === 'finished' ? '标记为在读' : '标记为已读完';
  return '<div class="menu-title">《' + escapeHtml(truncate(book.title || '未命名', 18)) + '》</div>' +
    '<button type="button" class="menu-item" data-menu="open">' + icons.bookOpen(15) + '继续阅读<span class="menu-extra">' + Math.round(percentOf(book)) + '%</span></button>' +
    '<button type="button" class="menu-item" data-menu="fav">' + icons.star(15) + favLabel + '</button>' +
    '<button type="button" class="menu-item" data-menu="status">' + icons.check(15) + statusLabelText + '</button>' +
    '<div class="menu-sep"></div>' +
    '<button type="button" class="menu-item danger" data-menu="remove">' + icons.trash(15) + '从书架移除</button>';
}

function openBookMenu(st, book, anchor) {
  if (!book) return;
  closeMenu(st);
  const menu = document.createElement('div');
  menu.className = 'menu book-menu';
  menu.innerHTML = bookMenuHtml(book);
  document.body.appendChild(menu);
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  let left = anchor.right - width;
  let top = anchor.bottom + 8;
  left = clamp(left, 12, Math.max(12, window.innerWidth - width - 12));
  if (top + height > window.innerHeight - 12) top = Math.max(12, anchor.top - height - 8);
  menu.style.left = Math.round(left) + 'px';
  menu.style.top = Math.round(top) + 'px';
  st.menu = menu;
  const onMenuClick = (event) => {
    const item = event.target.closest('[data-menu]');
    if (!item) return;
    event.stopPropagation();
    handleMenuAction(st, book, item.dataset.menu);
  };
  menu.addEventListener('click', onMenuClick);
  const onOutside = (event) => {
    if (!menu.contains(event.target)) closeMenu(st);
  };
  const timer = setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
  st.menuCleanup = () => {
    clearTimeout(timer);
    document.removeEventListener('mousedown', onOutside, true);
    menu.removeEventListener('click', onMenuClick);
  };
}

function updateBook(st, updated) {
  if (!updated || !updated.id) return;
  const index = st.books.findIndex((book) => book.id === updated.id);
  if (index >= 0) st.books[index] = updated;
  else st.books.unshift(updated);
  st.ctx.state.books = st.books;
}

async function handleMenuAction(st, book, action) {
  closeMenu(st);
  const ctx = st.ctx;
  if (action === 'open') { ctx.openBook(book.id); return; }
  if (action === 'fav') {
    try {
      const updated = await ctx.api.library.setFavorite(book.id, !book.favorite);
      updateBook(st, updated);
      ctx.toast(updated && updated.favorite ? '已加入收藏' : '已取消收藏', 'ok');
      await ctx.refreshShell().catch(() => {});
      if (!st.alive) return;
      paint(st);
    } catch (error) {
      ctx.toast(friendlyError(error, '收藏失败'), 'error');
    }
    return;
  }
  if (action === 'status') {
    const next = book.status === 'finished' ? 'reading' : 'finished';
    try {
      const updated = await ctx.api.library.setStatus(book.id, next);
      updateBook(st, updated);
      ctx.toast(next === 'finished' ? '已标记为读完' : '已标记为在读', 'ok');
      await ctx.refreshShell().catch(() => {});
      if (!st.alive) return;
      paint(st);
    } catch (error) {
      ctx.toast(friendlyError(error, '更新状态失败'), 'error');
    }
    return;
  }
  if (action === 'remove') {
    const ok = await ctx.confirm({
      title: '从书架移除？',
      body: '《' + (book.title || '未命名') + '》将从书架移除。阅读进度与已收藏的生词不会删除。',
      confirmText: '移除',
      danger: true
    });
    if (!ok || !st.alive) return;
    try {
      await ctx.api.library.remove(book.id);
      st.books = st.books.filter((item) => item.id !== book.id);
      ctx.state.books = st.books;
      ctx.toast('已从书架移除', 'ok');
      await ctx.refreshShell().catch(() => {});
      if (!st.alive) return;
      paint(st);
    } catch (error) {
      ctx.toast(friendlyError(error, '移除失败'), 'error');
    }
  }
}

async function reloadBooks(st) {
  const books = await st.ctx.api.library.list();
  st.books = Array.isArray(books) ? books.filter((book) => book && book.id) : [];
  st.ctx.state.books = st.books;
  await st.ctx.refreshShell().catch(() => {});
  if (!st.alive) return;
  paint(st);
  loadVocabCounts(st);
}

async function importBooks(st) {
  if (st.importing) return;
  st.importing = true;
  const button = st.root.querySelector('[data-act="import"]');
  setBtnBusy(button, true, '导入中…');
  try {
    const result = await st.ctx.api.library.importFiles();
    if (!result || result.canceled) return;
    const imported = Array.isArray(result.imported) ? result.imported : [];
    const errors = Array.isArray(result.errors) ? result.errors : [];
    if (imported.length) st.ctx.toast('已导入 ' + imported.length + ' 本书', 'ok');
    if (errors.length) st.ctx.toast(errors.length + ' 个文件未能导入：' + errors[0], 'warn', { duration: 6200 });
    if (!imported.length && !errors.length) st.ctx.toast('没有找到可导入的 TXT 文件', 'warn');
    if (imported.length) await reloadBooks(st);
  } catch (error) {
    st.ctx.toast(friendlyError(error, '导入失败'), 'error');
  } finally {
    st.importing = false;
    setBtnBusy(st.root.querySelector('[data-act="import"]'), false);
  }
}

async function importDropped(st, files) {
  if (!files.length || st.importing) return;
  const paths = [];
  files.forEach((file) => {
    try {
      const filePath = st.ctx.api.app.getPathForFile(file);
      if (filePath) paths.push(filePath);
    } catch (error) { /* ignore */ }
  });
  if (!paths.length) { st.ctx.toast('无法读取拖入的文件路径', 'error'); return; }
  st.importing = true;
  showDrop(st, true, true);
  try {
    const result = await st.ctx.api.library.importPaths(paths);
    showDrop(st, false);
    const imported = Array.isArray(result && result.imported) ? result.imported : [];
    const errors = Array.isArray(result && result.errors) ? result.errors : [];
    if (imported.length) st.ctx.toast('已导入 ' + imported.length + ' 本书', 'ok');
    if (errors.length) st.ctx.toast(errors.length + ' 个文件未能导入：' + errors[0], 'warn', { duration: 6200 });
    if (imported.length) await reloadBooks(st);
  } catch (error) {
    showDrop(st, false);
    st.ctx.toast(friendlyError(error, '导入失败'), 'error');
  } finally {
    st.importing = false;
  }
}

async function loadSamples(st) {
  const button = st.root.querySelector('[data-act="samples"]');
  setBtnBusy(button, true, '加载中…');
  try {
    const books = await st.ctx.api.library.list();
    st.books = Array.isArray(books) ? books.filter((book) => book && book.id) : [];
    st.ctx.state.books = st.books;
    await st.ctx.refreshShell().catch(() => {});
    if (!st.alive) return;
    if (!st.books.length) st.ctx.toast('示例书还没有准备好，请稍后重试', 'warn');
    else st.ctx.toast('示例书已就绪，开始阅读吧', 'ok');
    paint(st);
    loadVocabCounts(st);
  } catch (error) {
    st.ctx.toast(friendlyError(error, '加载示例书失败'), 'error');
  } finally {
    setBtnBusy(st.root.querySelector('[data-act="samples"]'), false);
  }
}

function showDrop(st, on, importing = false) {
  const overlay = st.root.querySelector('#drop-overlay');
  if (!overlay) return;
  overlay.classList.toggle('is-on', Boolean(on));
  overlay.setAttribute('aria-hidden', String(!on));
  const inner = overlay.querySelector('.drop-inner');
  if (inner && on && importing) {
    inner.innerHTML = '<span class="drop-icon"><span class="spinner lg"></span></span><h3>正在导入…</h3><p>正在复制并解析章节，请稍候。</p>';
  } else if (inner && on) {
    inner.innerHTML = '<span class="drop-icon">' + icons.upload(26) + '</span>' +
      '<h3>松手即可导入</h3><p>英文原著 TXT 会被复制到 Lumen 书库，原文件不会移动。</p>' +
      '<div class="drop-formats"><span class="chip static">.txt</span><span class="chip static">UTF-8</span><span class="chip static">UTF-16</span><span class="chip static">GB18030</span></div>';
  }
  st.dragging = Boolean(on);
}

function hasFileDrag(event) {
  const types = event.dataTransfer && event.dataTransfer.types;
  if (!types) return false;
  return Array.from(types).includes('Files');
}

/* ------------------------------ 挂载 ------------------------------ */

export async function render(root, ctx) {
  teardown();
  const st = {
    root,
    ctx,
    books: Array.isArray(ctx.state.books) ? ctx.state.books.slice() : null,
    query: '',
    filter: 'all',
    favOnly: false,
    vocabByBook: new Map(),
    menu: null,
    menuCleanup: null,
    importing: false,
    dragging: false,
    alive: true,
    cleanups: []
  };
  S = st;
  root.scrollTop = 0;
  root.innerHTML = skeletonHtml();

  // Always read the latest books when the library mounts. Reading progress is
  // saved by the reader just before route-leave; the shared boot-time snapshot
  // would otherwise show a stale percentage until the app is restarted.
  let books = null;
  try {
    books = await ctx.api.library.list();
    ctx.state.books = Array.isArray(books) ? books.filter((book) => book && book.id) : [];
  } catch (error) {
    console.warn('[lumen] library list failed', error);
    books = Array.isArray(st.books) ? st.books : [];
    st.loadError = error;
  }
  if (!st.alive) return;
  st.books = Array.isArray(books) ? books.filter((book) => book && book.id) : [];

  paint(st);
  bindEvents(st);
  loadVocabCounts(st);
  if (st.loadError) ctx.toast(friendlyError(st.loadError, '书库加载失败，请稍后重试'), 'error');
}

function paint(st) {
  st.root.innerHTML = pageHtml(st);
  const search = st.root.querySelector('#library-search');
  if (search) {
    search.value = st.query;
    const onInput = debounce(() => {
      if (!st.alive) return;
      st.query = search.value;
      paintShelf(st);
    }, 140);
    add(st, search, 'input', onInput);
    add(st, search, 'keydown', (event) => {
      if (event.key === 'Escape') {
        search.value = '';
        st.query = '';
        paintShelf(st);
        event.stopPropagation();
      }
    });
  }
  paintShelf(st);
}

function bindEvents(st) {
  add(st, st.root, 'click', (event) => {
    const actionEl = event.target.closest('[data-act]');
    if (actionEl) {
      const action = actionEl.dataset.act;
      if (action === 'import') importBooks(st);
      else if (action === 'samples') loadSamples(st);
      else if (action === 'continue') st.ctx.openBook(actionEl.dataset.id);
      else if (action === 'fav-filter') { st.favOnly = !st.favOnly; paintShelf(st); }
      else if (action === 'clear-filters') { st.filter = 'all'; st.favOnly = false; st.query = ''; const search = st.root.querySelector('#library-search'); if (search) search.value = ''; paintShelf(st); }
      return;
    }
    const filterEl = event.target.closest('[data-filter]');
    if (filterEl) { st.filter = filterEl.dataset.filter; paintShelf(st); return; }
    const moreEl = event.target.closest('[data-more]');
    if (moreEl) {
      event.stopPropagation();
      const book = st.books.find((item) => item.id === moreEl.dataset.more);
      openBookMenu(st, book, moreEl.getBoundingClientRect());
      return;
    }
    const card = event.target.closest('.book');
    if (card) st.ctx.openBook(card.dataset.id);
  });

  add(st, st.root, 'contextmenu', (event) => {
    const card = event.target.closest('.book');
    if (!card) return;
    event.preventDefault();
    const book = st.books.find((item) => item.id === card.dataset.id);
    openBookMenu(st, book, new DOMRect(event.clientX, event.clientY, 0, 0));
  });

  add(st, st.root, 'keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('.book');
    if (!card) return;
    event.preventDefault();
    st.ctx.openBook(card.dataset.id);
  });

  add(st, st.root, 'scroll', () => closeMenu(st), { passive: true });

  add(st, window, 'keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 'k' && !event.altKey) {
      event.preventDefault();
      const search = st.root.querySelector('#library-search');
      if (search) { search.focus(); search.select(); }
    }
    if (event.key === 'Escape') closeMenu(st);
  });

  // 全窗口拖拽导入
  const onDragOver = (event) => {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    if (!st.dragging) showDrop(st, true);
  };
  add(st, document, 'dragover', onDragOver);
  add(st, document, 'dragleave', (event) => {
    if (!st.dragging) return;
    if (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight) {
      showDrop(st, false);
    }
  });
  add(st, document, 'drop', (event) => {
    if (!hasFileDrag(event)) { showDrop(st, false); return; }
    event.preventDefault();
    showDrop(st, false);
    const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
    importDropped(st, files);
  });

  st.onLeave = () => teardown();
  window.addEventListener('lumen:route-leave', st.onLeave);
}

async function loadVocabCounts(st) {
  try {
    const words = await st.ctx.api.vocab.list();
    if (!st.alive) return;
    const map = new Map();
    if (Array.isArray(words)) {
      words.forEach((word) => {
        const id = word && word.source && word.source.bookId;
        if (id) map.set(id, (map.get(id) || 0) + 1);
      });
    }
    st.vocabByBook = map;
    paintShelf(st);
  } catch (error) {
    // 生词计数是增强信息，失败时静默
  }
}

function teardown() {
  const st = S;
  if (!st) return;
  S = null;
  st.alive = false;
  try { window.removeEventListener('lumen:route-leave', st.onLeave); } catch (error) { /* ignore */ }
  closeMenu(st);
  (st.cleanups || []).forEach((cleanup) => { try { cleanup(); } catch (error) { /* ignore */ } });
  st.cleanups = [];
}

window.addEventListener('lumen:route-leave', () => { if (S) teardown(); });