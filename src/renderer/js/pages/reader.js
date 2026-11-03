// Lumen · 阅读器：沉浸式阅读、划词翻译、AI 语境解析、TTS、进度保存
import { icons } from '../icons.js';
import {
  debounce, throttle, clamp, escapeHtml as esc,
  friendlyError, isTypingTarget, truncate
} from '../ui.js';

const DEFAULT_READER = {
  theme: 'paper', fontSize: 19, lineHeight: 1.9, fontFamily: 'serif', contentWidth: 700,
  letterSpacing: 0, justify: false, highlightVocab: true, autoTranslate: true, autoAnalyze: true
};

const PROVIDER_LABEL = {
  'google-free': 'Google 翻译',
  mymemory: 'MyMemory',
  ai: 'AI 翻译',
  dictionary: '词典',
  cache: '本地缓存'
};

const KIND_META = {
  word: { label: '单词', kicker: 'WORD', icon: 'translate' },
  phrase: { label: '短语', kicker: 'PHRASE', icon: 'quote' },
  sentence: { label: '句子', kicker: 'SENTENCE', icon: 'quote' },
  paragraph: { label: '段落', kicker: 'PARAGRAPH', icon: 'quote' }
};

let S = null;
let pendingJump = null;

/* ------------------------------ 工具 ------------------------------ */

function parseHash() {
  const raw = String(location.hash || '').replace(/^#\/?/, '');
  const clean = raw.replace(/\/+$/, '');
  const segments = clean.split('/').filter(Boolean);
  if (segments[0] !== 'read') return { bookId: null, chapterIndex: null };
  const bookId = segments[1] ? decodeURIComponent(segments[1]) : null;
  const chapterIndex = segments[2] !== undefined && segments[2] !== '' && Number.isFinite(Number(segments[2]))
    ? Math.max(0, Math.floor(Number(segments[2])))
    : null;
  return { bookId, chapterIndex };
}

function readerSettings(ctx) {
  const source = ctx.state && ctx.state.settings && ctx.state.settings.reader ? ctx.state.settings.reader : {};
  const settings = {};
  Object.keys(DEFAULT_READER).forEach((key) => { settings[key] = source[key] !== undefined ? source[key] : DEFAULT_READER[key]; });
  settings.fontSize = clamp(Number(settings.fontSize) || 19, 15, 28);
  settings.lineHeight = clamp(Number(settings.lineHeight) || 1.9, 1.3, 2.5);
  settings.contentWidth = clamp(Number(settings.contentWidth) || 700, 560, 820);
  settings.letterSpacing = clamp(Number(settings.letterSpacing) || 0, -1, 2);
  return settings;
}

// 本地模型（Ollama / LM Studio 等）即使没有 Key，只要主进程探测到可用也视为已就绪
function hasApiKey(st) {
  const ai = st.ctx.state && st.ctx.state.settings && st.ctx.state.settings.ai;
  if (!ai) return false;
  return Boolean(ai.hasApiKey || ai.available || ai.local);
}

function normalizeRect(rect) {
  if (!rect) return { left: window.innerWidth / 2, right: window.innerWidth / 2, top: window.innerHeight / 2, bottom: window.innerHeight / 2, width: 0, height: 0 };
  return {
    left: Number(rect.left) || 0, right: Number(rect.right) || 0,
    top: Number(rect.top) || 0, bottom: Number(rect.bottom) || 0,
    width: Number(rect.width) || 0, height: Number(rect.height) || 0
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
}

function splitParagraphs(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return [];
  const byBlank = normalized.split(/\n\s*\n+/).map((line) => line.trim()).filter(Boolean);
  if (byBlank.length > 1) return byBlank;
  const lines = normalized.split(/\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  return [normalized];
}

function detectKind(text) {
  const value = String(text || '').trim();
  const words = value.split(/\s+/).filter(Boolean);
  if (!words.length) return 'word';
  if (words.length <= 1 && value.length <= 48) return 'word';
  if (words.length <= 3 && value.length <= 44 && !/[.!?。！？;；:：]$/.test(value)) return 'word';
  if (words.length <= 9 && value.length <= 96) return 'phrase';
  if (words.length <= 60) return 'sentence';
  return 'paragraph';
}

function contextForRange(st, range) {
  try {
    let node = range.commonAncestorContainer;
    if (node && node.nodeType === 3) node = node.parentElement;
    const para = node && node.closest ? node.closest('.para') : null;
    if (!para) return '';
    return truncate(paraText(para), 360);
  } catch (error) {
    return '';
  }
}

function paraText(para) {
  if (!para) return '';
  const body = para.querySelector && para.querySelector('.para-body');
  const raw = body ? body.textContent : para.textContent;
  return String(raw || '').replace(/\s+/g, ' ').trim();
}

function readingMinutes(wordCount) {
  const words = Number(wordCount) || 0;
  return Math.max(1, Math.round(words / 220));
}

function providerLabel(provider) {
  return PROVIDER_LABEL[provider] || '翻译服务';
}

function chaptersOf(book, chapter) {
  if (book && Array.isArray(book.chapters) && book.chapters.length) return book.chapters;
  return [{ index: chapter.index, title: chapter.title, wordCount: chapter.wordCount }];
}

// 单章书（解析器切出来只有一章时）章节名常是 "Section 1"，展示时回退为书名。
function chapterDisplayTitle(book, chapter) {
  if (!book || !chapter) return '';
  const raw = String(chapter.title || '').trim();
  const singleChapter = Number(book.chapterCount || 1) <= 1;
  if (singleChapter && /^Section \d+$/i.test(raw)) return String(book.title || raw);
  return raw || ('第 ' + (Number(chapter.index) + 1) + ' 章');
}

function chapterTitleAt(book, chapter, index) {
  const target = Number(index);
  if (!Number.isFinite(target)) return null;
  const list = book && Array.isArray(book.chapters) ? book.chapters : [];
  const item = list.find((entry) => Number(entry && entry.index) === target);
  if (!item) return null;
  return chapterDisplayTitle(book, item);
}

// 单章书正文首部常混入书名与 "by 作者" 等 front matter，阅读时跳过。
function isFrontMatterParagraph(st, paragraph) {
  if (Number(st.chapter.index) !== 0) return false;
  const normalized = String(paragraph || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  const title = String(st.book.title || '').replace(/\s+/g, ' ').trim();
  const author = String(st.book.author || '').replace(/\s+/g, ' ').trim();
  const lower = normalized.toLowerCase();
  if (title && lower === title.toLowerCase()) return true;
  if (author && lower === author.toLowerCase()) return true;
  if (author && lower.startsWith(('by ' + author).toLowerCase())) return true;
  return false;
}

function toolbarHtml(st) {
  const book = st.book;
  const chapter = st.chapter;
  const total = Math.max(1, Number(book.chapterCount) || Number(chapter.total) || 1);
  const theme = st.settings.theme || 'paper';
  const displayTitle = chapterDisplayTitle(book, chapter);
  const bookmarked = st.bookmarks.some((item) => Number(item.chapterIndex) === Number(chapter.index));
  return '<header class="reader-top" id="reader-top">' +
    '<div class="reader-top-left">' +
    '<button type="button" class="icon-btn" data-act="back" data-tip="返回书库" aria-label="返回书库">' + icons.arrowLeft(18) + '</button>' +
    '<button type="button" class="icon-btn" data-act="toc" data-tip="目录" aria-label="目录">' + icons.list(18) + '</button>' +
    '</div>' +
    '<div class="reader-top-title">' +
    '<span class="reader-book">' + esc(book.title || '未命名') + '</span>' +
    '<span class="reader-chapter-line"><span class="idx">' + (Number(chapter.index) + 1) + ' / ' + total + '</span>' +
    '<span class="name">' + esc(displayTitle) + '</span></span>' +
    '</div>' +
    '<div class="reader-actions">' +
    '<button type="button" class="icon-btn" data-act="search" data-tip="书内搜索 · Ctrl F" aria-label="书内搜索">' + icons.search(17) + '</button>' +
    '<button type="button" class="icon-btn fontsize-btn" data-act="font-minus" data-tip="缩小字号" aria-label="缩小字号">A−</button>' +
    '<button type="button" class="icon-btn fontsize-btn" data-act="font-plus" data-tip="放大字号" aria-label="放大字号">A+</button>' +
    '<span class="divider vert" aria-hidden="true"></span>' +
    '<button type="button" class="icon-btn" data-act="theme" data-tip="切换颜色主题" aria-label="切换颜色主题">' + (theme === 'dark' ? icons.sun(17) : icons.moon(17)) + '</button>' +
    '<button type="button" class="icon-btn" data-act="focus" data-tip="专注模式 · F" aria-label="专注模式">' + icons.focus(17) + '</button>' +
    '<button type="button" class="icon-btn" data-act="tts" data-tip="朗读 · T" aria-label="朗读">' + icons.volume(17) + '</button>' +
    '<button type="button" class="icon-btn' + (bookmarked ? ' active' : '') + '" data-act="bookmark" data-tip="书签" aria-label="书签">' +
    (bookmarked ? icons.bookmarkFilled(17) : icons.bookmark(17)) + '</button>' +
    '<button type="button" class="icon-btn" data-act="notes" data-tip="笔记与生词" aria-label="笔记与生词">' + icons.note(17) + '</button>' +
    '<span class="reader-more-wrap"><button type="button" class="icon-btn" data-act="more" data-tip="更多" aria-label="更多">' + icons.more(17) + '</button></span>' +
    '</div>' +
    '</header>';
}

function tocDrawerHtml(st) {
  const book = st.book;
  const chapter = st.chapter;
  const total = Math.max(1, Number(book.chapterCount) || Number(chapter.total) || 1);
  const chapters = chaptersOf(book, chapter);
  const items = chapters.map((item, position) => {
    const index = Number(item.index !== undefined ? item.index : position);
    const active = index === Number(chapter.index);
    const itemTitle = chapterDisplayTitle(book, { index, title: item.title, wordCount: item.wordCount });
    return '<button type="button" class="toc-item' + (active ? ' active' : '') + '" data-chapter="' + index + '"' + (active ? ' aria-current="true"' : '') + '>' +
      '<span class="toc-index">' + String(index + 1).padStart(2, '0') + '</span>' +
      '<span class="toc-name">' + esc(itemTitle) + '</span>' +
      '<span class="toc-words">' + (item.wordCount ? st.ctx.fmtNumber(item.wordCount) : '') + '</span>' +
      '</button>';
  }).join('');
  return '<aside class="drawer drawer--toc" id="toc-drawer" aria-hidden="true" aria-label="目录">' +
    '<div class="drawer-head"><div class="drawer-title-wrap"><span class="drawer-kicker">Contents</span><span class="drawer-title">目录</span></div>' +
    '<button type="button" class="icon-btn sm" data-act="close-drawers" aria-label="关闭目录">' + icons.x(16) + '</button></div>' +
    '<div class="drawer-body">' +
    '<div class="toc-summary">' +
    '<div class="toc-summary-row"><span class="toc-summary-label">全书进度</span><span class="toc-summary-value" id="toc-percent">0%</span></div>' +
    '<div class="progress" id="toc-progress"><i id="toc-bar" style="width:0%"></i></div>' +
    '<div class="toc-summary-meta">' + total + ' 章 · ' + st.ctx.fmtNumber(book.wordCount || 0) + ' 词 · 约 ' + readingMinutes(book.wordCount) + ' 分钟</div>' +
    '</div>' +
    '<div class="toc-list">' + items + '</div>' +
    '</div>' +
    '<div class="drawer-foot">' + icons.keyboard(12) + ' ← → 切换章节 · 点击目录跳转</div>' +
    '</aside>';
}

function noteItemHtml(st, note) {
  const color = ['amber', 'rose', 'sage', 'sky'].includes(note.color) ? note.color : 'amber';
  const body = note.note ? '<div class="note-body">' + esc(note.note) + '</div>' : '';
  const chapterLabel = chapterTitleAt(st.book, st.chapter, note.chapterIndex) ||
    note.chapterTitle || ('第 ' + (Number(note.chapterIndex) + 1) + ' 章');
  return '<div class="note-item" data-color="' + color + '" data-note="' + esc(note.id) + '">' +
    '<div class="note-quote">' + esc(truncate(note.text || '', 160)) + '</div>' + body +
    '<div class="note-meta"><span>' + esc(chapterLabel) + '</span><span class="dot"></span><span>' + esc(st.ctx.formatDate(note.createdAt, 'short')) + '</span></div>' +
    '<button type="button" class="note-remove" data-note-remove="' + esc(note.id) + '" data-tip="删除笔记" aria-label="删除笔记">' + icons.trash(13) + '</button>' +
    '</div>';
}

function vocabItemHtml(st, word) {
  const source = word.source || {};
  return '<div class="vocab-item" data-vocab="' + esc(word.id) + '">' +
    '<div class="vocab-word"><b>' + esc(word.word || '') + '</b>' + (word.phonetic ? '<span class="phonetic">' + esc(word.phonetic) + '</span>' : '') + '</div>' +
    '<div class="vocab-translation">' + esc(word.translation || '') + '</div>' +
    '<div class="vocab-source">' + esc(source.chapterTitle || source.bookTitle || '') + '</div>' +
    '<button type="button" class="vocab-remove" data-vocab-remove="' + esc(word.id) + '" data-tip="移除生词" aria-label="移除生词">' + icons.trash(13) + '</button>' +
    '</div>';
}

function notesDrawerHtml(st) {
  return '<aside class="drawer drawer--notes" id="notes-drawer" aria-hidden="true" aria-label="笔记与生词">' +
    '<div class="drawer-head"><div class="drawer-title-wrap"><span class="drawer-kicker">Marginalia</span><span class="drawer-title">笔记与生词</span></div>' +
    '<button type="button" class="icon-btn sm" data-act="close-drawers" aria-label="关闭笔记">' + icons.x(16) + '</button></div>' +
    '<div class="drawer-body">' +
    '<section class="drawer-section">' +
    '<div class="drawer-section-head">' + icons.note(12) + '本书笔记<span class="count" id="notes-count">' + st.notes.length + '</span></div>' +
    '<div id="notes-list">' + notesListHtml(st) + '</div>' +
    '</section>' +
    '<section class="drawer-section">' +
    '<div class="drawer-section-head">' + icons.layers(12) + '本书生词<span class="count" id="vocab-count">' + st.vocabWords.length + '</span></div>' +
    '<div id="vocab-list">' + vocabListHtml(st) + '</div>' +
    '</section>' +
    '</div>' +
    '<div class="drawer-foot">' + icons.info(12) + ' 共 ' + (st.notes.length + st.vocabWords.length) + ' 条阅读记录</div>' +
    '</aside>';
}

function notesListHtml(st) {
  if (!st.notes.length) {
    return '<div class="drawer-empty">' + icons.note(20) + '<span>还没有笔记。选中文字后点击「高亮 / 笔记」记录你的想法。</span></div>';
  }
  return st.notes.map((note) => noteItemHtml(st, note)).join('');
}

function vocabListHtml(st) {
  if (!st.vocabWords.length) {
    return '<div class="drawer-empty">' + icons.layers(20) + '<span>还没有生词。选中单词，在浮层里点「收藏生词」即可。</span></div>';
  }
  return st.vocabWords.map((word) => vocabItemHtml(st, word)).join('');
}

function buildVocabRegex(st) {
  const words = [];
  const seen = new Set();
  st.vocabAll.forEach((item) => {
    const word = String(item && (item.normalized || item.word) || '').trim();
    if (!word || word.length < 2 || seen.has(word.toLowerCase())) return;
    seen.add(word.toLowerCase());
    words.push(esc(word));
  });
  if (!words.length) return null;
  words.sort((a, b) => b.length - a.length);
  const pattern = words.slice(0, 240).map((word) => escapeRegex(word)).join('|');
  try {
    return new RegExp('(?<![A-Za-z])(' + pattern + ')(?![A-Za-z])', 'gi');
  } catch (error) {
    return null;
  }
}

function highlightText(st, escapedText, regex) {
  if (!regex) return escapedText;
  return escapedText.replace(regex, (match) =>
    '<mark class="vocab-hit" data-word="' + match + '">' + match + '</mark>');
}

function paragraphsHtml(st) {
  let paragraphs = splitParagraphs(st.chapter.text);
  if (Number(st.chapter.index) === 0) {
    paragraphs = paragraphs.filter((paragraph) => !isFrontMatterParagraph(st, paragraph));
  }
  if (!paragraphs.length) {
    return '<div class="chapter-empty">' +
      '<div class="empty-icon">' + icons.bookOpen(24) + '</div>' +
      '<h3>本章暂无内容</h3>' +
      '<p>这一章可能是空的，或者文件在解析时丢失了正文。试试前往下一章。</p>' +
      '</div>';
  }
  const regex = st.settings.highlightVocab ? buildVocabRegex(st) : null;
  return paragraphs.map((text, index) => {
    let html = highlightText(st, esc(text).replace(/\n/g, ' '), regex);
    const lead = Number(st.chapter.index) === 0 && index === 0 ? ' para--lead' : '';
    return '<p class="para' + lead + '" data-index="' + index + '">' +
      '<span class="para-body">' + html + '</span>' +
      '<button type="button" class="para-translate" data-para="' + index + '" title="翻译本段" aria-label="翻译本段">译</button>' +
      '</p>';
  }).join('');
}

function chapterFootHtml(st) {
  const chapter = st.chapter;
  const percent = Math.round(clamp(computeBookPercent(st), 0, 100));
  const prevDisabled = chapter.prev === null || chapter.prev === undefined;
  const nextDisabled = chapter.next === null || chapter.next === undefined;
  const prevTitle = prevDisabled ? '已是第一章' : (chapterTitleAt(st.book, chapter, chapter.prev) || ('第 ' + (Number(chapter.prev) + 1) + ' 章'));
  const nextTitle = nextDisabled ? '已是最后一章' : (chapterTitleAt(st.book, chapter, chapter.next) || ('第 ' + (Number(chapter.next) + 1) + ' 章'));
  return '<div class="chapter-end">' + esc(st.book.title || '') + '</div>' +
    '<footer class="chapter-foot">' +
    '<button type="button" class="chapter-nav-btn prev" data-act="prev"' + (prevDisabled ? ' disabled' : '') + '>' +
    '<span class="nav-label">' + icons.chevronLeft(13) + '上一章</span>' +
    '<span class="nav-title">' + esc(prevTitle) + '</span></button>' +
    '<span class="chapter-foot-meta" id="chapter-foot-meta">全书 ' + percent + '%</span>' +
    '<button type="button" class="chapter-nav-btn next" data-act="next"' + (nextDisabled ? ' disabled' : '') + '>' +
    '<span class="nav-label">下一章' + icons.chevronRight(13) + '</span>' +
    '<span class="nav-title">' + esc(nextTitle) + '</span></button>' +
    '</footer>';
}

function searchPanelHtml() {
  return '<div class="reader-search" id="reader-search" role="dialog" aria-label="书内搜索">' +
    '<div class="search-row"><span class="search-ico">' + icons.search(17) + '</span>' +
    '<input type="search" id="reader-search-input" placeholder="在整本书中搜索…" autocomplete="off" spellcheck="false" aria-label="搜索整本书" />' +
    '<kbd class="kbd">Esc</kbd>' +
    '<button type="button" class="icon-btn sm" data-act="search-close" aria-label="关闭搜索">' + icons.x(16) + '</button></div>' +
    '<div class="search-meta" id="search-meta">' + icons.info(12) + ' 输入至少 2 个字符开始搜索</div>' +
    '<div class="search-results" id="search-results"></div>' +
    '<div class="search-foot"><span class="row"><span class="kbd">Enter</span> 搜索</span><span class="row"><span class="kbd">Esc</span> 关闭</span>' +
    '<span class="grow"></span><button type="button" class="icon-btn sm" data-act="search-retry" data-tip="重新搜索" aria-label="重新搜索">' + icons.refresh(14) + '</button></div>' +
    '</div>';
}

function readerHtml(st) {
  return '<div class="reader" id="reader" data-justify="' + (st.settings.justify ? 'true' : 'false') + '" data-font="' + (st.settings.fontFamily === 'sans' ? 'sans' : 'serif') + '" data-focus="off">' +
    toolbarHtml(st) +
    '<div class="reader-progress" role="progressbar" aria-label="全书阅读进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="reader-progress-fill" id="reader-progress-fill" style="width:0%"></div></div>' +
    '<div class="reader-stage">' +
    '<div class="reader-scrim" id="reader-scrim"></div>' +
    tocDrawerHtml(st) +
    '<div class="reader-scroll" id="reader-scroll">' +
    '<article class="reader-paper" id="reader-paper">' +
    '<header class="chapter-head">' +
    '<div class="chapter-kicker">Chapter ' + (Number(st.chapter.index) + 1) + '</div>' +
    '<h1 class="chapter-title">' + esc(chapterDisplayTitle(st.book, st.chapter)) + '</h1>' +
    '<div class="chapter-meta"><span>' + st.ctx.fmtNumber(st.chapter.wordCount || 0) + ' 词</span><span class="sep"></span>' +
    '<span>约 ' + readingMinutes(st.chapter.wordCount) + ' 分钟</span><span class="sep"></span>' +
    '<span>' + st.ctx.fmtNumber(st.book.wordCount || 0) + ' 词全书</span>' +
    '<span class="chip static">' + (hasApiKey(st) ? 'AI 已就绪' : 'AI 未配置') + '</span>' +
    '</div>' +
    '<div class="chapter-rule"></div>' +
    '</header>' +
    '<div class="reader-content" id="reader-content">' + paragraphsHtml(st) + '</div>' +
    chapterFootHtml(st) +
    '</article>' +
    '</div>' +
    notesDrawerHtml(st) +
    '</div>' +
    searchPanelHtml() +
    '<div class="lookup" id="lookup" hidden aria-live="polite"></div>' +
    '<button type="button" class="select-pill" id="select-pill" data-act="select-pill">' + icons.translate(13) + ' 翻译选区</button>' +
    '</div>';
}

function loadingHtml() {
  let lines = '';
  for (let i = 0; i < 13; i += 1) {
    lines += '<div class="skeleton skeleton-text" style="width:' + (86 + (i * 7) % 14) + '%"></div>';
  }
  return '<div class="reader-loading" aria-busy="true" aria-label="正在加载章节">' +
    '<div class="reader-skeleton-top"><div class="skeleton" style="width:28px"></div><div class="skeleton" style="width:30%"></div><div class="grow"></div><div class="skeleton" style="width:180px"></div></div>' +
    '<div class="reader-skeleton-body"><div class="reader-skeleton-paper">' +
    '<div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text" style="width:30%"></div>' +
    lines + '</div></div></div>';
}

function errorHtml(error) {
  const network = error && (error.code === 'NETWORK' || error.code === 'TIMEOUT');
  const message = friendlyError(error, '章节加载失败，请稍后再试');
  return '<div class="reader-error-wrap"><div class="empty">' +
    '<div class="empty-icon">' + (network ? icons.wifiOff(26) : icons.alert(26)) + '</div>' +
    '<h3>' + (network ? '网络似乎断开了' : '这一章没能打开') + '</h3>' +
    '<p>' + esc(message) + '</p>' +
    '<div class="empty-actions">' +
    '<button type="button" class="btn primary" data-act="retry-error">重新加载</button>' +
    '<button type="button" class="btn ghost" data-act="back-library">返回书库</button>' +
    '</div></div></div>';
}

function missingHtml() {
  return '<div class="reader-error-wrap"><div class="empty">' +
    '<div class="empty-icon">' + icons.book(26) + '</div>' +
    '<h3>没有找到这本书</h3>' +
    '<p>地址里缺少书籍标识，可能来自一个失效的阅读链接。</p>' +
    '<div class="empty-actions"><button type="button" class="btn primary" data-act="back-library">回到书库</button></div>' +
    '</div></div>';
}

function cacheEls(st) {
  const root = st.root;
  st.els = {
    reader: root.querySelector('#reader'),
    top: root.querySelector('#reader-top'),
    progress: root.querySelector('.reader-progress'),
    progressFill: root.querySelector('#reader-progress-fill'),
    scroll: root.querySelector('#reader-scroll'),
    content: root.querySelector('#reader-content'),
    paper: root.querySelector('#reader-paper'),
    tocDrawer: root.querySelector('#toc-drawer'),
    notesDrawer: root.querySelector('#notes-drawer'),
    scrim: root.querySelector('#reader-scrim'),
    tocPercent: root.querySelector('#toc-percent'),
    tocBar: root.querySelector('#toc-bar'),
    footMeta: root.querySelector('#chapter-foot-meta'),
    search: root.querySelector('#reader-search'),
    searchInput: root.querySelector('#reader-search-input'),
    searchResults: root.querySelector('#search-results'),
    searchMeta: root.querySelector('#search-meta'),
    lookup: root.querySelector('#lookup'),
    selectPill: root.querySelector('#select-pill'),
    bookmarkBtn: root.querySelector('[data-act="bookmark"]'),
    ttsBtn: root.querySelector('[data-act="tts"]'),
    themeBtn: root.querySelector('[data-act="theme"]')
  };
}

function applyReaderVars(st) {
  const settings = st.settings;
  const el = st.els.reader;
  el.style.setProperty('--read-font-size', settings.fontSize + 'px');
  el.style.setProperty('--read-line-height', String(settings.lineHeight));
  el.style.setProperty('--read-letter-spacing', settings.letterSpacing + 'px');
  el.style.setProperty('--read-width', settings.contentWidth + 'px');
  el.dataset.justify = settings.justify ? 'true' : 'false';
  el.dataset.font = settings.fontFamily === 'sans' ? 'sans' : 'serif';
}


/* ------------------------------ 划词卡片模板 ------------------------------ */

function lookupErrorHtml(error, retryLabel) {
  const network = error && (error.code === 'NETWORK' || error.code === 'TIMEOUT');
  const message = friendlyError(error, '翻译服务暂时不可用');
  return '<div class="lookup-error">' +
    '<div class="lookup-error-row">' + (network ? icons.wifiOff(15) : icons.alert(15)) +
    '<div>' + esc(message) + (network ? '<br>阅读与本地词典不受影响。' : '') + '</div></div>' +
    '<button type="button" class="btn sm" data-act="lookup-retry">' + esc(retryLabel || '重新翻译') + '</button>' +
    '</div>';
}

function translationSectionHtml(st, L) {
  const result = L.result || {};
  const translation = String(result.translation || '').trim();
  return '<section class="lookup-section lookup-section--translation">' +
    '<div class="lookup-label">' + icons.translate(12) + '翻译</div>' +
    '<div class="lookup-translation">' + (translation ? esc(translation) : '未获取到译文') + '</div>' +
    '</section>';
}

function dictChipRow(label, values, max) {
  if (!Array.isArray(values) || !values.length) return '';
  return '<div class="dict-relations"><span class="dict-relations-label">' + label + '</span>' +
    values.slice(0, max || 6).map((item) => '<span class="dict-relation">' + esc(item) + '</span>').join('') +
    '</div>';
}

function dictionarySectionHtml(L) {
  const dictionary = L.result && L.result.dictionary;
  if (!dictionary) return '';
  const meanings = Array.isArray(dictionary.meanings) ? dictionary.meanings : [];
  const hasDetail = dictionary.note || dictionary.mnemonic || dictionary.roots ||
    (Array.isArray(dictionary.phrases) && dictionary.phrases.length) ||
    (Array.isArray(dictionary.examples) && dictionary.examples.length) ||
    (Array.isArray(dictionary.synonyms) && dictionary.synonyms.length);
  if (!meanings.length && !hasDetail) return '';
  const source = dictionary.sourceLabel || (dictionary.source === 'oxford' ? '牛津词典' : (dictionary.source === 'free' ? '开放词典' : (dictionary.source === 'local' ? '内置词典' : '词典')));
  const items = meanings.slice(0, 5).map((meaning) => {
    const syn = Array.isArray(meaning.synonyms) ? meaning.synonyms : [];
    const ant = Array.isArray(meaning.antonyms) ? meaning.antonyms : [];
    const zh = meaning.definitionZh || '';
    const en = meaning.definition || '';
    return '<div class="dict-item"><span class="dict-pos">' + esc(meaning.partOfSpeech || 'def') + '</span>' +
      '<div class="dict-item-body"><div class="dict-text">' + esc(zh || en) + '</div>' +
      (zh && en && zh !== en ? '<div class="dict-def-en">' + esc(en) + '</div>' : '') +
      (meaning.example ? '<div class="dict-example">“' + esc(meaning.example) + '”</div>' : '') +
      (syn.length ? dictChipRow('近义', syn, 4) : '') +
      (ant.length ? dictChipRow('反义', ant, 4) : '') +
      '</div></div>';
  }).join('');
  const examples = Array.isArray(dictionary.examples) && dictionary.examples.length
    ? '<div class="dict-example-list">' + dictionary.examples.slice(0, 2).map((example) =>
      '<div class="dict-example-row"><div class="en">' + esc(example.en || '') + '</div>' +
      (example.zh ? '<div class="zh">' + esc(example.zh) + '</div>' : '') + '</div>').join('') + '</div>'
    : '';
  const phrases = Array.isArray(dictionary.phrases) && dictionary.phrases.length
    ? '<div class="dict-phrases"><span class="dict-relations-label">短语</span>' +
      dictionary.phrases.slice(0, 5).map((phrase) =>
        '<span class="dict-phrase"><b>' + esc(phrase.en || '') + '</b>' + (phrase.zh ? '<span>' + esc(phrase.zh) + '</span>' : '') + '</span>').join('') + '</div>'
    : '';
  const forms = Array.isArray(dictionary.forms) && dictionary.forms.length
    ? '<div class="dict-relations"><span class="dict-relations-label">词形</span>' +
      dictionary.forms.slice(0, 6).map((form) => '<span class="dict-relation">' + esc(typeof form === 'string' ? form : form.form || '') + '</span>').join('') + '</div>'
    : '';
  const origin = dictionary.origin
    ? '<div class="dict-origin"><span>词源</span><p>' + esc(dictionary.origin) + '</p></div>'
    : '';
  const roots = dictionary.roots
    ? '<div class="dict-memory"><span>词根 / 词源</span><p>' + esc(dictionary.roots) + '</p></div>'
    : '';
  const mnemonic = dictionary.mnemonic
    ? '<div class="dict-memory dict-memory--mnemonic"><span>联想记忆</span><p>' + esc(dictionary.mnemonic) + '</p></div>'
    : '';
  const note = dictionary.note
    ? '<div class="dict-note-block"><button type="button" class="dict-note-toggle" data-act="dict-note-toggle" aria-expanded="' + Boolean(L.dictNoteOpen) + '">' +
        '<span>更多词根 / 记忆</span><span>' + (L.dictNoteOpen ? '收起' : '展开') + '</span></button>' +
        (L.dictNoteOpen ? '<pre class="dict-note">' + esc(dictionary.note) + '</pre>' : '') + '</div>'
    : '';
  return '<section class="lookup-section lookup-section--dictionary">' +
    '<div class="lookup-label lookup-label--row">' + icons.book(12) + '词典释义' +
      '<span class="dict-source">' + esc(source) + '</span></div>' +
    '<div class="dict-list">' + items + '</div>' + examples + phrases + forms +
    dictChipRow('近义', dictionary.synonyms, 8) +
    dictChipRow('反义', dictionary.antonyms, 8) +
    roots + mnemonic + note + origin + '</section>';
}

function lexiconSectionHtml(L) {
  const lexicon = L.lexicon;
  if (!lexicon) return '';
  const parts = Array.isArray(lexicon.parts) ? lexicon.parts : [];
  const rawBreakdown = typeof lexicon.breakdown === 'string' ? lexicon.breakdown.trim() : '';
  const fallbackWord = String((lexicon.word || (L.result && (L.result.normalized || L.result.text)) || L.text || '')).trim().toLowerCase();
  const meaningfulBreakdown = rawBreakdown && rawBreakdown.toLowerCase() !== fallbackWord;
  if (!meaningfulBreakdown && !parts.length && !(lexicon.related && lexicon.related.length)) return '';
  const expanded = Boolean(L.lexiconOpen);
  const chips = parts.map((part) =>
    '<span class="lexicon-part lexicon-part--' + esc(part.type || 'root') + '">' +
      '<b>' + esc(part.text || '') + '</b><span>' + esc(part.meaning || '') + '</span></span>').join('');
  const related = Array.isArray(lexicon.related) && lexicon.related.length
    ? '<div class="lexicon-related">同根词：' + lexicon.related.slice(0, 8).map((item) => '<span class="chip static">' + esc(item) + '</span>').join('') + '</div>'
    : '';
  return '<section class="lookup-section lookup-section--lexicon">' +
    '<button type="button" class="lexicon-head" data-act="lexicon-toggle" aria-expanded="' + expanded + '">' +
      '<span class="lookup-label">' + icons.layers(12) + '词根词缀</span>' +
      '<span class="lexicon-breakdown">' + esc(lexicon.breakdown || '拆解') + '</span>' +
      '<span class="lexicon-toggle">' + (expanded ? '收起' : '展开') + '</span>' +
    '</button>' +
    (expanded ? '<div class="lexicon-body">' +
      (chips ? '<div class="lexicon-parts">' + chips + '</div>' : '') +
      related +
      '</div>' : '') +
    '</section>';
}

function aiResultHtml(analysis) {
  const blocks = [];
  if (analysis.sense) blocks.push('<div class="ai-block"><div class="ai-label">语境义</div><div class="ai-text">' + esc(analysis.sense) + '</div></div>');
  if (analysis.grammar) blocks.push('<div class="ai-block"><div class="ai-label">语法结构</div><div class="ai-text">' + esc(analysis.grammar) + '</div></div>');
  if (analysis.nuance) blocks.push('<div class="ai-block"><div class="ai-label">语气与搭配</div><div class="ai-text">' + esc(analysis.nuance) + '</div></div>');
  if (Array.isArray(analysis.roots) && analysis.roots.length) {
    blocks.push('<div class="ai-block"><div class="ai-label">词根词缀</div><div class="ai-roots">' +
      analysis.roots.slice(0, 8).map((root) => '<span class="ai-root"><b>' + esc(root.text || '') + '</b>' + esc(root.meaning || '') + '</span>').join('') + '</div></div>');
  }
  if (analysis.mnemonic) {
    blocks.push('<div class="ai-block ai-block--mnemonic"><div class="ai-label">联想记忆</div>' +
      '<div class="ai-text">' + esc(analysis.mnemonic) + '</div>' +
      (Array.isArray(analysis.associations) && analysis.associations.length
        ? '<div class="ai-associations">' + analysis.associations.slice(0, 5).map((item) => '<span class="chip static">' + esc(item) + '</span>').join('') + '</div>'
        : '') + '</div>');
  }
  if (Array.isArray(analysis.collocations) && analysis.collocations.length) {
    blocks.push('<div class="ai-block"><div class="ai-label">常见搭配</div><div class="ai-collocations">' +
      analysis.collocations.slice(0, 10).map((item) => '<span class="chip static">' + esc(item) + '</span>').join('') + '</div></div>');
  }
  if (Array.isArray(analysis.examples) && analysis.examples.length) {
    blocks.push('<div class="ai-block"><div class="ai-label">例句</div><div class="ai-examples">' +
      analysis.examples.slice(0, 4).map((example) => '<div class="ai-example"><div class="en">' + esc(example.en || '') + '</div>' +
        (example.zh ? '<div class="zh">' + esc(example.zh) + '</div>' : '') + '</div>').join('') + '</div></div>');
  }
  if (Array.isArray(analysis.alternatives) && analysis.alternatives.length) {
    blocks.push('<div class="ai-block"><div class="ai-label">更自然的表达</div><div class="ai-collocations">' +
      analysis.alternatives.slice(0, 8).map((item) => '<span class="chip static">' + esc(item) + '</span>').join('') + '</div></div>');
  }
  return '<div class="lookup-ai"><div class="lookup-ai-head">' + icons.sparkles(13) + 'AI 语境解析' +
    (analysis.level ? '<span class="level">' + esc(analysis.level) + '</span>' : '') + '</div>' +
    '<div class="lookup-ai-body">' + blocks.join('') + '</div></div>';
}

function aiLoadingHtml() {
  return '<div class="lookup-ai"><div class="lookup-ai-head">' + icons.sparkles(13) + 'AI 语境解析<span class="level">思考中</span></div>' +
    '<div class="ai-loading"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div></div>';
}

function aiErrorHtml(st, error) {
  if (error && error.code === 'NO_AI_KEY') {
    return '<div class="lookup-ai"><div class="lookup-ai-head">' + icons.sparkles(13) + 'AI 语境解析</div>' +
      '<div class="ai-cta"><span class="ai-cta-icon">' + icons.key(15) + '</span><span>配置 AI 密钥后，可获得语境义、语法结构、搭配与例句。</span>' +
      '<button type="button" class="btn sm" data-act="open-settings">去设置</button></div></div>';
  }
  return '<div class="lookup-ai"><div class="lookup-ai-head">' + icons.sparkles(13) + 'AI 语境解析</div>' +
    '<div class="ai-error">' + icons.alert(14) + '<div>' + esc(friendlyError(error, 'AI 解析失败，请稍后再试')) +
    '<div><button type="button" class="btn sm" data-act="ai-retry">重试</button></div></div></div></div>';
}

function aiSectionHtml(st, L) {
  if (L.analysis) return aiResultHtml(L.analysis);
  if (L.analyzing) return aiLoadingHtml();
  if (L.aiError) return aiErrorHtml(st, L.aiError);
  if (hasApiKey(st)) {
    const manual = st.settings && st.settings.autoAnalyze === false;
    return '<div class="lookup-ai"><div class="lookup-ai-head">' + icons.sparkles(13) + 'AI 语境解析' +
      (manual ? '<span class="level">手动</span>' : '') + '</div>' +
      '<div class="ai-cta"><span class="ai-cta-icon">' + icons.sparkles(15) + '</span>' +
      '<span>' + (manual
        ? '自动解析已关闭。需要时点击「解析」，让 AI 讲解语境义、语法与搭配。'
        : '让 AI 解释它在当前语境中的含义、语法与搭配。') + '</span>' +
      '<button type="button" class="btn sm" data-act="analyze">解析</button></div></div>';
  }
  return '<div class="lookup-ai"><div class="lookup-ai-head">' + icons.sparkles(13) + 'AI 语境解析</div>' +
    '<div class="ai-cta"><span class="ai-cta-icon">' + icons.key(15) + '</span>' +
    '<span>配置 AI 密钥，解锁语境义、语法结构与搭配解析。</span>' +
    '<button type="button" class="btn sm" data-act="open-settings">去设置</button></div></div>';
}

function noteComposerHtml(st, L) {
  const colors = ['amber', 'rose', 'sage', 'sky'];
  const accent = L.noteColor || 'amber';
  return '<div class="lookup-note">' +
    '<div class="lookup-label">' + icons.highlight(12) + '高亮 / 笔记</div>' +
    '<textarea class="textarea" data-note-text placeholder="写下你的理解或记忆线索（可留空，仅高亮）" aria-label="笔记内容"></textarea>' +
    '<div class="lookup-note-colors" role="group" aria-label="高亮颜色">' +
    colors.map((color) => '<button type="button" class="note-color-dot' + (accent === color ? ' active' : '') + '" data-note-color="' + color + '" aria-label="' + color + ' 高亮"></button>').join('') +
    '</div>' +
    '<div class="lookup-note-actions">' +
    '<button type="button" class="btn ghost sm" data-act="note-cancel">取消</button>' +
    '<button type="button" class="btn primary sm" data-act="note-save">保存记录</button>' +
    '</div></div>';
}

function lookupHtml(st, L) {
  const meta = KIND_META[L.kind] || KIND_META.sentence;
  const result = L.result;
  const phonetic = (result && result.dictionary && result.dictionary.phonetic) || (L.saved && L.saved.phonetic) || '';
  const selection = truncate(String((result && result.text) || L.text || ''), 600);
  const canExpand = selection.length > 140;
  const expanded = Boolean(L.selectionExpanded);
  const provider = result && !result.error ? providerLabel(result.provider) : '';
  let body = '';
  if (L.error) {
    body = lookupErrorHtml(L.error);
  } else if (!result) {
    body = '<div class="lookup-loading"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div>';
  } else if (result.error) {
    body = lookupErrorHtml(result.error);
  } else {
    body += translationSectionHtml(st, L);
    body += dictionarySectionHtml(L);
    body += lexiconSectionHtml(L);
    body += aiSectionHtml(st, L);
    if (result.note) {
      body += '<div class="lookup-inline-note">' + icons.note(14) + '<span>' + esc(result.note) + '</span></div>';
    }
  }
  if (L.noteOpen) body += noteComposerHtml(st, L);
  const actions = '<div class="lookup-actions">' +
    '<div class="lookup-actions-primary">' +
      '<button type="button" class="btn primary lookup-save' + (L.saved ? ' is-saved' : '') + '" data-act="lookup-save"' + (L.saved ? ' disabled' : '') + '>' +
      (L.saved ? icons.check(14) + ' 已在生词本' : icons.plus(14) + ' 收藏生词') + '</button>' +
    '</div>' +
    '<div class="lookup-actions-secondary">' +
      '<button type="button" class="lookup-action' + (L.noteOpen ? ' active' : '') + '" data-act="lookup-note" aria-label="高亮或记笔记">' + icons.note(14) + '<span>笔记</span></button>' +
      '<button type="button" class="lookup-action" data-act="lookup-copy" aria-label="复制译文">' + icons.copy(14) + '<span>复制</span></button>' +
      '<button type="button" class="lookup-action" data-act="lookup-speak" aria-label="朗读原文">' + icons.volume(14) + '<span>朗读</span></button>' +
      '<button type="button" class="lookup-action" data-act="lookup-retry" aria-label="重新翻译">' + icons.rotate(14) + '<span>重译</span></button>' +
    '</div>' +
    '</div>';
  return '<div class="lookup-head">' +
    '<div class="lookup-head-top">' +
      '<span class="lookup-kicker">' + icons[meta.icon](12) + esc(meta.label) + '<span class="lookup-kicker-dot"></span>' + meta.kicker + '</span>' +
      '<button type="button" class="lookup-close" data-act="lookup-close" aria-label="关闭">' + icons.x(15) + '</button>' +
    '</div>' +
    '<div class="lookup-selection' + (expanded ? ' is-expanded' : '') + '">' + esc(selection) + '</div>' +
    '<div class="lookup-sub">' +
      (phonetic ? '<span class="phonetic">' + esc(phonetic) + '</span>' : '') +
      '<button type="button" class="speak-btn" data-act="lookup-speak" data-tip="朗读原文" aria-label="朗读原文">' + icons.volume(13) + '</button>' +
      '<span class="lookup-provider">' + esc(provider || (result && result.error ? '翻译不可用' : '查询中')) + '</span>' +
      (canExpand ? '<button type="button" class="lookup-expand" data-act="selection-toggle">' + (expanded ? '收起' : '展开') + '</button>' : '') +
    '</div>' +
  '</div>' +
  '<div class="lookup-body">' + body + '</div>' + actions;
}

/* ------------------------------ 卡片渲染 / 定位 ------------------------------ */

function renderLookup(st) {
  const L = st.lookup;
  const el = st.els && st.els.lookup;
  if (!L || !el) return;
  const oldBody = el.querySelector('.lookup-body');
  const scrollTop = oldBody ? oldBody.scrollTop : 0;
  el.hidden = false;
  el.dataset.kind = L.kind;
  el.innerHTML = lookupHtml(st, L);
  const body = el.querySelector('.lookup-body');
  if (body) body.scrollTop = scrollTop;
  const lookupAtRender = st.lookup;
  positionLookup(st);
  requestAnimationFrame(() => {
    if (st.lookup === lookupAtRender && st.els && st.els.lookup) positionLookup(st);
  });
  if (st.lookupPosTimer) clearTimeout(st.lookupPosTimer);
  st.lookupPosTimer = setTimeout(() => {
    st.lookupPosTimer = null;
    if (st.lookup === lookupAtRender && st.els && st.els.lookup && !st.destroyed) positionLookup(st);
  }, 150);
}

function positionLookup(st) {
  const L = st.lookup;
  const el = st.els && st.els.lookup;
  if (!L || !el || el.hidden) return;
  const scrollRect = st.els.scroll.getBoundingClientRect();
  const margin = 12;
  const viewportH = window.innerHeight;
  const area = {
    left: Math.max(scrollRect.left + 8, margin),
    right: Math.min(scrollRect.right - 8, window.innerWidth - margin),
    top: Math.max(scrollRect.top + 8, 64),
    bottom: Math.min(scrollRect.bottom - 8, viewportH - margin)
  };
  // 先按内容自然高度量一次，再决定放在选区上方还是下方
  el.style.maxHeight = 'none';
  const width = el.offsetWidth;
  const naturalHeight = Math.round(el.getBoundingClientRect().height);
  const rect = L.rect || normalizeRect(null);
  const gap = 10;
  const minHeight = 260;
  const spaceBelow = area.bottom - rect.bottom - gap;
  const spaceAbove = rect.top - area.top - gap;
  const preferAbove = rect.bottom > viewportH * 0.55 || spaceBelow < Math.min(naturalHeight, 320);
  let left = rect.left + rect.width / 2 - width / 2;
  let top;
  if (preferAbove && spaceAbove >= minHeight) {
    top = rect.top - gap - Math.min(naturalHeight, spaceAbove);
  } else if (spaceBelow >= minHeight) {
    top = rect.bottom + gap;
  } else if (spaceAbove >= minHeight) {
    top = rect.top - gap - Math.min(naturalHeight, spaceAbove);
  } else {
    // 选区几乎占满可视区时，优先放到选区侧边，避免遮住刚翻阅的句子
    const rightSpace = area.right - rect.right - gap;
    const leftSpace = rect.left - area.left - gap;
    if (rightSpace >= width + gap) {
      left = rect.right + gap;
      top = clamp(rect.top - 40, area.top, Math.max(area.top, area.bottom - minHeight));
    } else if (leftSpace >= width + gap) {
      left = rect.left - width - gap;
      top = clamp(rect.top - 40, area.top, Math.max(area.top, area.bottom - minHeight));
    } else {
      top = Math.max(area.top, area.bottom - minHeight);
    }
  }
  top = clamp(top, area.top, Math.max(area.top, area.bottom - minHeight));
  left = clamp(left, area.left, Math.max(area.left, area.right - width));
  const maxHeight = Math.max(minHeight, Math.round(area.bottom - top - 8));
  el.style.left = Math.round(left) + 'px';
  el.style.top = Math.round(top) + 'px';
  el.style.maxHeight = maxHeight + 'px';
}

function closeLookup(st) {
  if (!st.lookup) return;
  st.lookup = null;
  if (st.lookupPosTimer) { clearTimeout(st.lookupPosTimer); st.lookupPosTimer = null; }
  if (st.els && st.els.lookup) {
    st.els.lookup.hidden = true;
    st.els.lookup.innerHTML = '';
    st.els.lookup.style.left = '';
    st.els.lookup.style.top = '';
  }
  hideSelectPill(st);
}

function hideSelectPill(st) {
  if (st.els && st.els.selectPill) st.els.selectPill.classList.remove('is-on');
}

function showSelectPill(st, rect) {
  const pill = st.els.selectPill;
  if (!pill) return;
  pill.classList.add('is-on');
  pill.style.left = '0px';
  pill.style.top = '0px';
  pill.style.position = 'fixed';
  const width = pill.offsetWidth;
  const height = pill.offsetHeight;
  let left = clamp(rect.left + rect.width / 2 - width / 2, 10, Math.max(10, window.innerWidth - width - 10));
  let top = rect.bottom + 8;
  if (top + height > window.innerHeight - 10) top = rect.top - height - 8;
  pill.style.left = Math.round(left) + 'px';
  pill.style.top = Math.round(top) + 'px';
}

/* ------------------------------ 抽屉 / 进度 / 按钮状态 ------------------------------ */

function renderNotesDrawer(st) {
  if (!st.els || !st.els.notesDrawer) return;
  const notesList = st.els.notesDrawer.querySelector('#notes-list');
  const vocabList = st.els.notesDrawer.querySelector('#vocab-list');
  const notesCount = st.els.notesDrawer.querySelector('#notes-count');
  const vocabCount = st.els.notesDrawer.querySelector('#vocab-count');
  if (notesList) notesList.innerHTML = notesListHtml(st);
  if (vocabList) vocabList.innerHTML = vocabListHtml(st);
  if (notesCount) notesCount.textContent = String(st.notes.length);
  if (vocabCount) vocabCount.textContent = String(st.vocabWords.length);
}

function updateProgressUi(st) {
  if (!st.els || !st.els.scroll) return;
  const percent = computeBookPercent(st);
  st.percent = percent;
  if (st.els.progressFill) st.els.progressFill.style.width = percent.toFixed(2) + '%';
  if (st.els.progress) st.els.progress.setAttribute('aria-valuenow', String(Math.round(percent)));
  if (st.els.tocPercent) st.els.tocPercent.textContent = Math.round(percent) + '%';
  if (st.els.tocBar) st.els.tocBar.style.width = percent.toFixed(2) + '%';
  if (st.els.footMeta) st.els.footMeta.textContent = '全书 ' + Math.round(percent) + '%';
}

function updateBookmarkButton(st) {
  const button = st.els && st.els.bookmarkBtn;
  if (!button) return;
  const active = st.bookmarks.some((item) => Number(item.chapterIndex) === Number(st.chapter.index));
  button.innerHTML = active ? icons.bookmarkFilled(17) : icons.bookmark(17);
  button.classList.toggle('active', active);
  button.setAttribute('aria-pressed', String(active));
}

function updateTtsButton(st) {
  const button = st.els && st.els.ttsBtn;
  if (!button) return;
  button.innerHTML = st.speech ? icons.pause(17) : icons.volume(17);
  button.classList.toggle('active', Boolean(st.speech));
  button.setAttribute('aria-label', st.speech ? '停止朗读' : '朗读');
}

function updateThemeButton(st) {
  const button = st.els && st.els.themeBtn;
  if (!button) return;
  button.innerHTML = st.settings.theme === 'dark' ? icons.sun(17) : icons.moon(17);
}

/* ------------------------------ 搜索 ------------------------------ */

function highlightQuery(snippet, query) {
  const safe = esc(String(snippet || '').replace(/\s+/g, ' '));
  const trimmed = String(query || '').trim();
  if (!trimmed) return safe;
  try {
    return safe.replace(new RegExp('(' + escapeRegex(esc(trimmed)) + ')', 'gi'), '<mark>$1</mark>');
  } catch (error) {
    return safe;
  }
}

function renderSearchResults(st, results, query) {
  const container = st.els.searchResults;
  if (!container) return;
  const hits = Array.isArray(results) ? results : [];
  if (st.els.searchMeta) {
    st.els.searchMeta.innerHTML = icons.search(12) + ' “' + esc(query) + '” · ' + hits.length + ' 处结果';
  }
  if (!hits.length) {
    container.innerHTML = '<div class="search-empty">' + icons.search(20) +
      '<div>没有找到 “' + esc(query) + '”</div><div>试试更短的词，或检查拼写。</div></div>';
    return;
  }
  container.innerHTML = hits.map((hit) => {
    const chapterIndex = Number(hit.chapterIndex) || 0;
    return '<button type="button" class="search-hit" data-search-hit data-chapter="' + chapterIndex + '"' +
      ' data-query="' + esc(query) + '" data-snippet="' + esc(hit.snippet || '') + '">' +
      '<span class="hit-chapter"><span class="hit-index">第 ' + (chapterIndex + 1) + ' 章</span>' +
      esc(chapterDisplayTitle(st.book, { index: chapterIndex, title: hit.chapterTitle || '' })) + '</span>' +
      '<span class="hit-snippet">' + highlightQuery(hit.snippet || '', query) + '</span></button>';
  }).join('');
}

function renderSearchLoading(st) {
  const container = st.els.searchResults;
  if (!container) return;
  container.innerHTML = '<div class="lookup-loading" style="padding:16px"><div class="skeleton skeleton-text" style="width:60%"></div>' +
    '<div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text" style="width:84%"></div></div>';
}

function renderSearchError(st, error) {
  const container = st.els.searchResults;
  if (!container) return;
  container.innerHTML = '<div class="search-empty">' + icons.wifiOff(20) + '<div>' + esc(friendlyError(error, '搜索失败')) + '</div></div>';
}

/* ------------------------------ 进度 / 会话 ------------------------------ */

function computeBookPercent(st) {
  if (!st.els || !st.els.scroll || !st.book || !st.chapter) return 0;
  const scroll = st.els.scroll;
  const max = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
  const local = max > 6 ? clamp(scroll.scrollTop / max, 0, 1) : 1;
  const total = Math.max(1, Number(st.book.chapterCount) || 1);
  const index = Math.max(0, Number(st.chapter.index) || 0);
  return clamp(((index + local) / total) * 100, 0, 100);
}

async function saveProgress(st, extra) {
  if (!st || !st.book || !st.chapter || !st.els || !st.els.scroll) return;
  if (st.saving) return;
  st.saving = true;
  const percent = Number(computeBookPercent(st).toFixed(2));
  const payload = {
    bookId: st.book.id,
    chapterIndex: Number(st.chapter.index),
    percent,
    scrollTop: Math.round(st.els.scroll.scrollTop)
  };
  if (extra) Object.keys(extra).forEach((key) => { payload[key] = extra[key]; });
  try {
    const updated = await st.ctx.api.library.saveProgress(payload);
    if (updated) {
      if (updated.progress) st.book.progress = updated.progress;
      if (updated.status) st.book.status = updated.status;
      const list = st.ctx.state && Array.isArray(st.ctx.state.books) ? st.ctx.state.books : null;
      if (list) {
        const index = list.findIndex((book) => book && book.id === updated.id);
        if (index !== -1) list[index] = Object.assign({}, list[index], updated);
      }
    }
    st.lastSavedPercent = percent;
  } catch (error) {
    // 进度保存失败不打扰阅读
  } finally {
    st.saving = false;
  }
}

function restoreScroll(st) {
  const progress = st.book && st.book.progress;
  if (!progress || !st.els || !st.els.scroll) return;
  if (Number(progress.chapterIndex) !== Number(st.chapter.index)) return;
  const top = Number(progress.scrollTop) || 0;
  if (top <= 4) return;
  const apply = () => {
    if (st.destroyed || !st.els || !st.els.scroll) return;
    st.els.scroll.scrollTop = top;
  };
  apply();
  requestAnimationFrame(apply);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(apply).catch(() => {});
  }
}

function startSession(st) {
  st.saveDebounced = debounce(() => saveProgress(st), 1200);
  st.onScroll = () => {
    if (st.destroyed) return;
    updateProgressUi(st);
    st.saveDebounced();
    hideSelectPill(st);
    if (st.lookup) {
      const delta = Math.abs(st.els.scroll.scrollTop - (st.lookupScrollTop || 0));
      if (delta > 40) closeLookup(st);
    }
  };
  st.els.scroll.addEventListener('scroll', st.onScroll, { passive: true });
  st.cleanups.push(() => st.els.scroll.removeEventListener('scroll', st.onScroll));

  st.tickBase = st.els.scroll.scrollTop;
  st.tick = setInterval(() => {
    if (st.destroyed || document.hidden) return;
    const scroll = st.els.scroll;
    const max = Math.max(1, scroll.scrollHeight - scroll.clientHeight);
    const delta = (scroll.scrollTop - st.tickBase) / max;
    const chapterWords = Number(st.chapter.wordCount) || 0;
    const words = clamp(Math.round(Math.abs(delta) * chapterWords), 0, 900);
    st.tickBase = scroll.scrollTop;
    saveProgress(st, { minutesDelta: 1, wordsDelta: words });
  }, 60000);

  st.onVisibility = () => {
    if (document.hidden) saveProgress(st);
    else if (st.els && st.els.scroll) st.tickBase = st.els.scroll.scrollTop;
  };
  document.addEventListener('visibilitychange', st.onVisibility);

  st.onBeforeUnload = () => { saveProgress(st); };
  window.addEventListener('beforeunload', st.onBeforeUnload);

  st.onLeave = () => destroy(st);
  window.addEventListener('lumen:route-leave', st.onLeave);
}

function applyPendingJump(st) {
  if (!pendingJump) return false;
  const jump = pendingJump;
  const fresh = Date.now() - Number(jump.at || 0) < 25000;
  if (!fresh) { pendingJump = null; return false; }
  if (jump.bookId === st.book.id && Number(jump.chapterIndex) === Number(st.chapter.index)) {
    pendingJump = null;
    requestAnimationFrame(() => locateInChapter(st, jump.query, jump.snippet));
    return true;
  }
  return false;
}

function locateInChapter(st, query, snippet) {
  if (!st.els || !st.els.content) return false;
  const paragraphs = Array.from(st.els.content.querySelectorAll('.para'));
  const needle = String(query || '').trim().toLowerCase();
  let target = needle ? paragraphs.find((para) => paraText(para).toLowerCase().includes(needle)) : null;
  if (!target && snippet) {
    const cleaned = String(snippet).replace(/[…\s]+/g, ' ').trim().slice(0, 40).toLowerCase();
    if (cleaned) target = paragraphs.find((para) => paraText(para).toLowerCase().includes(cleaned));
  }
  if (!target) return false;
  const scroll = st.els.scroll;
  const top = target.offsetTop - Math.round(scroll.clientHeight * 0.32);
  scroll.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  target.classList.add('is-flash');
  setTimeout(() => { if (target.isConnected) target.classList.remove('is-flash'); }, 2100);
  return true;
}

/* ------------------------------ 划词 ------------------------------ */

function rebuildVocabIndex(st) {
  st.vocabMap = new Map();
  (st.vocabAll || []).forEach((word) => {
    const key = String((word && (word.normalized || word.word)) || '').toLowerCase();
    if (key) st.vocabMap.set(key, word);
  });
}

function hydrateLexicon(st, lookup, reqId) {
  const result = lookup && lookup.result;
  if (!result || result.kind !== 'word' || lookup.lexicon) return;
  const word = String(result.normalized || result.text || lookup.text || '').trim();
  if (!word || !st.ctx.api || !st.ctx.api.lookup || typeof st.ctx.api.lookup.lexicon !== 'function') return;
  st.ctx.api.lookup.lexicon(word).then((lexicon) => {
    if (!lexicon || !st.lookup || st.lookup.reqId !== reqId) return;
    st.lookup.lexicon = lexicon;
    renderLookup(st);
  }).catch(() => {});
}

function hydrateDictionary(st, lookup, reqId) {
  const result = lookup && lookup.result;
  if (!result || result.kind !== 'word') return;
  if (result.dictionary && Array.isArray(result.dictionary.meanings) && result.dictionary.meanings.length) return;
  const word = String(result.normalized || result.text || lookup.text || '').trim();
  if (!word || !st.ctx.api || !st.ctx.api.lookup || typeof st.ctx.api.lookup.dictionary !== 'function') return;
  st.ctx.api.lookup.dictionary(word).then((dictionary) => {
    if (!dictionary || !st.lookup || st.lookup.reqId !== reqId) return;
    st.lookup.result.dictionary = dictionary;
    renderLookup(st);
  }).catch(() => {});
}

function savedToResult(word) {
  return {
    text: word.word || '',
    kind: detectKind(word.word || ''),
    normalized: word.normalized || word.word || '',
    translation: word.translation || '',
    provider: 'cache',
    dictionary: word.phonetic ? { word: word.word, phonetic: word.phonetic, meanings: [], source: 'local' } : null,
    analyzed: false
  };
}

async function openLookup(st, options) {
  const text = String((options && options.text) || '').replace(/\s+/g, ' ').trim();
  if (!text) return;
  hideSelectPill(st);
  const preset = options.preset || null;
  const reqId = ++st.lookupReqId;
  const lookup = {
    reqId,
    text,
    context: options.context || '',
    kind: options.kind || detectKind(text),
    rect: normalizeRect(options.rect),
    result: preset ? savedToResult(preset) : null,
    saved: preset || null,
    analyzing: false,
    analysis: null,
    aiError: null,
    error: null,
    noteOpen: false,
    noteColor: 'amber',
    selectionExpanded: false,
    lexiconOpen: false,
    dictNoteOpen: false,
    autoSave: Boolean(options.autoSave)
  };
  st.lookup = lookup;
  st.lookupScrollTop = st.els.scroll.scrollTop;
  renderLookup(st);
  if (preset) {
    if (st.settings.autoAnalyze) maybeAnalyze(st);
    if (lookup.autoSave) saveLookupWord(st);
    return;
  }
  try {
    const result = await st.ctx.api.lookup.quick({ text, context: lookup.context, bookId: st.book.id });
    if (!st.lookup || st.lookup.reqId !== reqId) return;
    lookup.result = result || null;
    renderLookup(st);
    hydrateDictionary(st, lookup, reqId);
    hydrateLexicon(st, lookup, reqId);
    if (lookup.autoSave) {
      if (lookup.result && lookup.result.translation) await saveLookupWord(st);
      else st.ctx.toast('翻译尚未就绪，无法收藏', 'warn');
    }
    maybeAnalyze(st);
  } catch (error) {
    if (!st.lookup || st.lookup.reqId !== reqId) return;
    lookup.error = error;
    renderLookup(st);
  }
}

function maybeAnalyze(st) {
  const lookup = st.lookup;
  if (!lookup || lookup.analysis || lookup.analyzing) return;
  if (st.settings.autoAnalyze === false) return;
  if (!hasApiKey(st)) return;
  runAnalyze(st);
}

async function runAnalyze(st) {
  const lookup = st.lookup;
  if (!lookup || lookup.analyzing) return;
  if (!hasApiKey(st)) {
    st.ctx.toast('请先在设置中配置 AI 密钥', 'warn');
    return;
  }
  lookup.analyzing = true;
  lookup.analysis = null;
  lookup.aiError = null;
  const reqId = lookup.reqId;
  renderLookup(st);
  try {
    const analysis = await st.ctx.api.lookup.analyze({
      text: lookup.text,
      context: lookup.context,
      bookId: st.book.id,
      chapterTitle: chapterDisplayTitle(st.book, st.chapter)
    });
    if (!st.lookup || st.lookup.reqId !== reqId) return;
    lookup.analyzing = false;
    lookup.analysis = analysis || null;
    lookup.aiError = null;
    renderLookup(st);
  } catch (error) {
    if (!st.lookup || st.lookup.reqId !== reqId) return;
    lookup.analyzing = false;
    lookup.aiError = error;
    renderLookup(st);
  }
}

async function retryLookup(st) {
  const lookup = st.lookup;
  if (!lookup) return;
  const options = { text: lookup.text, context: lookup.context, kind: lookup.kind, rect: lookup.rect };
  lookup.error = null;
  lookup.result = null;
  lookup.analysis = null;
  lookup.aiError = null;
  lookup.analyzing = false;
  renderLookup(st);
  await openLookup(st, options);
}

async function saveLookupWord(st) {
  const lookup = st.lookup;
  if (!lookup) return;
  if (lookup.saved) {
    st.ctx.toast('这个生词已经在生词本里了', 'warn');
    return;
  }
  const result = lookup.result;
  if (!result || result.error) {
    st.ctx.toast('还没有可保存的翻译', 'warn');
    return;
  }
  const translation = String(result.translation || (lookup.analysis && lookup.analysis.translation) || '').trim();
  if (!translation) {
    st.ctx.toast('还没有可保存的翻译', 'warn');
    return;
  }
  const wordText = String(result.normalized || result.text || lookup.text || '').trim();
  try {
    const output = await st.ctx.api.vocab.add({
      word: wordText,
      translation,
      context: lookup.context || '',
      contextTranslation: lookup.analysis && lookup.analysis.translation ? lookup.analysis.translation : '',
      phonetic: (result.dictionary && result.dictionary.phonetic) || '',
      source: { bookId: st.book.id, bookTitle: st.book.title, chapterTitle: st.chapter.title }
    });
    const word = output && output.word ? output.word : null;
    lookup.saved = word || { word: wordText, translation };
    if (word) {
      st.vocabAll.unshift(word);
      if (word.source && word.source.bookId === st.book.id) st.vocabWords.unshift(word);
      rebuildVocabIndex(st);
    }
    st.ctx.toast(output && output.duplicate ? '已在生词本中' : '已加入生词本', output && output.duplicate ? 'warn' : 'ok');
    st.ctx.refreshShell().catch(() => {});
    renderLookup(st);
    renderNotesDrawer(st);
  } catch (error) {
    st.ctx.toast(friendlyError(error, '保存生词失败'), 'error');
  }
}

function toggleNoteComposer(st) {
  const lookup = st.lookup;
  if (!lookup) return;
  lookup.noteOpen = !lookup.noteOpen;
  renderLookup(st);
  if (lookup.noteOpen) {
    const textarea = st.els.lookup.querySelector('[data-note-text]');
    if (textarea) requestAnimationFrame(() => textarea.focus({ preventScroll: true }));
  }
}

async function saveNoteFromLookup(st) {
  const lookup = st.lookup;
  if (!lookup) return;
  const textarea = st.els.lookup.querySelector('[data-note-text]');
  const note = textarea ? textarea.value.trim() : '';
  try {
    const created = await st.ctx.api.notes.add({
      bookId: st.book.id,
      bookTitle: st.book.title,
      chapterIndex: Number(st.chapter.index),
      chapterTitle: chapterDisplayTitle(st.book, st.chapter),
      text: lookup.text,
      note,
      color: lookup.noteColor || 'amber',
      percent: computeBookPercent(st)
    });
    if (created) st.notes.unshift(created);
    lookup.noteOpen = false;
    st.ctx.toast(note ? '笔记已保存' : '已高亮这段文字', 'ok');
    renderLookup(st);
    renderNotesDrawer(st);
    st.ctx.refreshShell().catch(() => {});
  } catch (error) {
    st.ctx.toast(friendlyError(error, '保存笔记失败'), 'error');
  }
}

async function copyLookup(st) {
  const lookup = st.lookup;
  if (!lookup || !lookup.result) return;
  const text = [lookup.result.text || lookup.text, lookup.result.translation || ''].filter(Boolean).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    st.ctx.toast('已复制到剪贴板', 'ok');
  } catch (error) {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      st.ctx.toast('已复制到剪贴板', 'ok');
    } catch (err) {
      st.ctx.toast('复制失败', 'error');
    }
  }
}

/* ------------------------------ 朗读 ------------------------------ */

function pickVoice() {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return null;
    const voices = synth.getVoices() || [];
    if (!voices.length) return null;
    return voices.find((voice) => /^en[-_]US/i.test(voice.lang) && /natural|google|aria|jenny/i.test(voice.name)) ||
      voices.find((voice) => /^en[-_]US/i.test(voice.lang)) ||
      voices.find((voice) => /^en/i.test(voice.lang)) || null;
  } catch (error) {
    return null;
  }
}

function stopSpeech(st) {
  if (!st) return;
  st.speechToken = (st.speechToken || 0) + 1;
  try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (error) { /* ignore */ }
  if (st.els && st.els.content) {
    st.els.content.querySelectorAll('.para.is-speaking').forEach((para) => para.classList.remove('is-speaking'));
  }
  if (st.els) st.els.lookup?.querySelectorAll('.speak-btn.is-speaking').forEach((btn) => btn.classList.remove('is-speaking'));
  st.speech = null;
  updateTtsButton(st);
}

function speakSingle(st, text, button) {
  const value = String(text || '').trim();
  if (!value) return;
  if (!('speechSynthesis' in window)) {
    st.ctx.toast('当前环境不支持语音朗读', 'warn');
    return;
  }
  stopSpeech(st);
  const token = (st.speechToken = (st.speechToken || 0) + 1);
  const utter = new SpeechSynthesisUtterance(value);
  utter.lang = 'en-US';
  utter.rate = 0.94;
  const voice = pickVoice();
  if (voice) utter.voice = voice;
  st.speech = { token, kind: 'single', utter };
  updateTtsButton(st);
  if (button) button.classList.add('is-speaking');
  const cleanup = () => {
    if (button && button.isConnected) button.classList.remove('is-speaking');
    if (st.speech && st.speech.token === token) {
      st.speech = null;
      updateTtsButton(st);
    }
  };
  utter.onend = cleanup;
  utter.onerror = cleanup;
  window.speechSynthesis.speak(utter);
}

function speakLookup(st, button) {
  if (!st.lookup) return;
  speakSingle(st, st.lookup.text, button);
}

function visibleParagraphIndex(st) {
  if (!st.els || !st.els.content) return 0;
  const scrollRect = st.els.scroll.getBoundingClientRect();
  const paragraphs = Array.from(st.els.content.querySelectorAll('.para'));
  for (let i = 0; i < paragraphs.length; i += 1) {
    const rect = paragraphs[i].getBoundingClientRect();
    if (rect.bottom > scrollRect.top + 90) return i;
  }
  return 0;
}

function readParagraphs(st, startIndex, single) {
  if (!('speechSynthesis' in window)) {
    st.ctx.toast('当前环境不支持语音朗读', 'warn');
    return;
  }
  const paragraphs = Array.from(st.els.content.querySelectorAll('.para'));
  if (!paragraphs.length) {
    st.ctx.toast('本章没有可朗读的段落', 'warn');
    return;
  }
  const start = clamp(Number(startIndex) || 0, 0, paragraphs.length - 1);
  const list = single ? [paragraphs[start]] : paragraphs.slice(start);
  stopSpeech(st);
  const token = (st.speechToken = (st.speechToken || 0) + 1);
  st.speech = { token, kind: 'paragraphs', index: 0 };
  updateTtsButton(st);
  const speakAt = (position) => {
    if (!st.speech || st.speech.token !== token || st.destroyed) return;
    if (position >= list.length) { stopSpeech(st); return; }
    st.els.content.querySelectorAll('.para.is-speaking').forEach((para) => para.classList.remove('is-speaking'));
    const para = list[position];
    if (para) {
      para.classList.add('is-speaking');
      const scrollRect = st.els.scroll.getBoundingClientRect();
      const rect = para.getBoundingClientRect();
      if (rect.top < scrollRect.top + 50 || rect.bottom > scrollRect.bottom - 40) {
        st.els.scroll.scrollTo({ top: Math.max(0, para.offsetTop - scrollRect.height * 0.4), behavior: 'smooth' });
      }
    }
    const utter = new SpeechSynthesisUtterance(paraText(para));
    utter.lang = 'en-US';
    utter.rate = 0.94;
    const voice = pickVoice();
    if (voice) utter.voice = voice;
    if (st.speech) st.speech.utter = utter;
    utter.onend = () => speakAt(position + 1);
    utter.onerror = () => speakAt(position + 1);
    window.speechSynthesis.speak(utter);
  };
  speakAt(0);
}

function toggleTTS(st) {
  if (st.speech) { stopSpeech(st); return; }
  readParagraphs(st, visibleParagraphIndex(st), false);
}

/* ------------------------------ 段落翻译 ------------------------------ */

async function translateParagraph(st, index, button) {
  const para = st.els.content.querySelector('.para[data-index="' + index + '"]');
  if (!para) return;
  const next = para.nextElementSibling;
  if (next && next.classList && next.classList.contains('para-translation')) {
    next.remove();
    return;
  }
  const text = paraText(para);
  if (!text) return;
  if (button) {
    button.classList.add('is-busy');
    button.innerHTML = '<span class="spinner"></span>';
  }
  const restore = () => {
    if (button && button.isConnected) {
      button.classList.remove('is-busy');
      button.textContent = '译';
    }
  };
  try {
    const result = await st.ctx.api.lookup.quick({ text, context: text.slice(0, 360), bookId: st.book.id });
    if (st.destroyed) return;
    const failed = !result || Boolean(result.error);
    const block = document.createElement('div');
    block.className = 'para-translation' + (failed ? ' is-error' : '');
    const translation = result && result.translation
      ? result.translation
      : (result && result.error && result.error.message ? result.error.message : '翻译服务暂不可用');
    block.innerHTML = '<span class="pt-label">' + icons.translate(11) + '段落翻译</span>' +
      '<button type="button" class="pt-close" data-pt-close aria-label="关闭">' + icons.x(13) + '</button>' +
      '<div class="pt-text">' + esc(translation) + '</div>' +
      '<div class="pt-provider">' + esc(failed ? '网络或服务暂时不可用' : providerLabel(result.provider)) + '</div>';
    para.after(block);
  } catch (error) {
    if (st.destroyed) return;
    const block = document.createElement('div');
    block.className = 'para-translation is-error';
    block.innerHTML = '<span class="pt-label">' + icons.translate(11) + '段落翻译</span>' +
      '<button type="button" class="pt-close" data-pt-close aria-label="关闭">' + icons.x(13) + '</button>' +
      '<div class="pt-text">' + esc(friendlyError(error, '翻译服务暂不可用')) + '</div>';
    para.after(block);
  } finally {
    restore();
  }
}

/* ------------------------------ 章节 / 书签 / 主题 / 字号 ------------------------------ */

async function toggleBookmark(st) {
  const percent = Number(computeBookPercent(st).toFixed(2));
  const label = truncate(visibleParagraphText(st), 80);
  try {
    const result = await st.ctx.api.reader.toggleBookmark({
      bookId: st.book.id,
      chapterIndex: Number(st.chapter.index),
      percent,
      label
    });
    const added = Boolean(result && result.added);
    if (added) {
      st.bookmarks.push(result.bookmark || { chapterIndex: Number(st.chapter.index), percent, label });
      st.ctx.toast('已添加书签', 'ok');
    } else {
      st.bookmarks = st.bookmarks.filter((item) => Number(item.chapterIndex) !== Number(st.chapter.index));
      st.ctx.toast('已移除书签', 'ok');
    }
    updateBookmarkButton(st);
  } catch (error) {
    st.ctx.toast(friendlyError(error, '书签操作失败'), 'error');
  }
}

function visibleParagraphText(st) {
  const index = visibleParagraphIndex(st);
  const para = st.els.content.querySelector('.para[data-index="' + index + '"]');
  return paraText(para);
}

function gotoChapter(st, index) {
  if (index === null || index === undefined) return;
  saveProgress(st);
  stopSpeech(st);
  closeLookup(st);
  closeDrawers(st);
  closeSearch(st);
  closeMenu(st);
  st.ctx.navigate('read/' + encodeURIComponent(st.book.id) + '/' + Number(index));
}

function leaveToLibrary(st) {
  saveProgress(st);
  stopSpeech(st);
  st.ctx.navigate('library');
}

function leaveToSettings(st) {
  saveProgress(st);
  stopSpeech(st);
  st.ctx.navigate('settings');
}

async function changeFontSize(st, delta) {
  const next = clamp(Number(st.settings.fontSize) + delta, 15, 28);
  if (next === st.settings.fontSize) return;
  st.settings.fontSize = next;
  if (st.ctx.state.settings && st.ctx.state.settings.reader) st.ctx.state.settings.reader.fontSize = next;
  applyReaderVars(st);
  updateProgressUi(st);
  try { await st.ctx.api.settings.save({ reader: { fontSize: next } }); } catch (error) { /* ignore */ }
}

async function cycleTheme(st) {
  const order = ['paper', 'sepia', 'dark'];
  const current = st.settings.theme || 'paper';
  const next = order[(order.indexOf(current) + 1) % order.length];
  st.settings.theme = next;
  if (st.ctx.state.settings && st.ctx.state.settings.reader) st.ctx.state.settings.reader.theme = next;
  document.documentElement.dataset.theme = next;
  updateThemeButton(st);
  try {
    await st.ctx.api.settings.save({ reader: { theme: next } });
    st.ctx.refreshShell().catch(() => {});
  } catch (error) {
    st.ctx.toast('主题保存失败', 'error');
  }
}

function toggleFocus(st, force) {
  const on = typeof force === 'boolean' ? force : !st.focus;
  st.focus = on;
  st.els.reader.dataset.focus = on ? 'on' : 'off';
  if (!on) st.els.top.classList.remove('top-visible');
}

/* ------------------------------ 书内搜索 ------------------------------ */

function searchOpen(st) {
  return Boolean(st.els && st.els.search && st.els.search.classList.contains('is-open'));
}

function openSearch(st) {
  closeLookup(st);
  closeDrawers(st);
  closeMenu(st);
  st.els.search.classList.add('is-open');
  runSearch(st);
  requestAnimationFrame(() => {
    const input = st.els.searchInput;
    if (input) { input.focus({ preventScroll: true }); input.select(); }
  });
}

function closeSearch(st) {
  if (!st.els || !st.els.search) return;
  st.els.search.classList.remove('is-open');
  st.searchReq += 1;
}

async function runSearch(st) {
  const input = st.els.searchInput;
  if (!input) return;
  const query = input.value.trim();
  if (query.length < 2) {
    if (st.els.searchResults) {
      st.els.searchResults.innerHTML = '<div class="search-empty">' + icons.search(20) +
        '<div>输入至少 2 个字符</div><div>搜索会遍历整本书，并显示章节与上下文。</div></div>';
    }
    if (st.els.searchMeta) st.els.searchMeta.innerHTML = icons.info(12) + ' 输入至少 2 个字符开始搜索';
    return;
  }
  const req = ++st.searchReq;
  renderSearchLoading(st);
  try {
    const results = await st.ctx.api.reader.search(st.book.id, query);
    if (req !== st.searchReq || st.destroyed) return;
    renderSearchResults(st, results, query);
  } catch (error) {
    if (req !== st.searchReq || st.destroyed) return;
    renderSearchError(st, error);
  }
}

function jumpToSearchHit(st, button) {
  const chapterIndex = Number(button.dataset.chapter) || 0;
  const query = button.dataset.query || '';
  const snippet = button.dataset.snippet || '';
  closeSearch(st);
  if (chapterIndex === Number(st.chapter.index)) {
    locateInChapter(st, query, snippet);
    return;
  }
  pendingJump = { bookId: st.book.id, chapterIndex, query, snippet, at: Date.now() };
  saveProgress(st);
  stopSpeech(st);
  closeLookup(st);
  st.ctx.navigate('read/' + encodeURIComponent(st.book.id) + '/' + chapterIndex);
}

/* ------------------------------ 抽屉 / 菜单 ------------------------------ */

function toggleDrawer(st, which) {
  if (!st.els) return;
  const target = which === 'toc' ? st.els.tocDrawer : st.els.notesDrawer;
  const other = which === 'toc' ? st.els.notesDrawer : st.els.tocDrawer;
  if (!target) return;
  const open = !target.classList.contains('is-open');
  if (other) { other.classList.remove('is-open'); other.setAttribute('aria-hidden', 'true'); }
  target.classList.toggle('is-open', open);
  target.setAttribute('aria-hidden', String(!open));
  if (open) {
    closeLookup(st);
    hideSelectPill(st);
    st.drawer = which;
    if (st.els.scrim) st.els.scrim.classList.add('is-on');
  } else {
    st.drawer = null;
    if (st.els.scrim) st.els.scrim.classList.remove('is-on');
  }
}

function closeDrawers(st) {
  if (!st || !st.els) return;
  [st.els.tocDrawer, st.els.notesDrawer].forEach((drawer) => {
    if (!drawer) return;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
  });
  if (st.els.scrim) st.els.scrim.classList.remove('is-on');
  st.drawer = null;
}

function openReaderMenu(st) {
  closeMenu(st);
  const button = st.root.querySelector('[data-act="more"]');
  if (!button) return;
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.innerHTML =
    '<button type="button" class="menu-item" data-menu="library">' + icons.library(15) + '回到书库</button>' +
    '<button type="button" class="menu-item" data-menu="notes">' + icons.note(15) + '笔记与生词</button>' +
    '<button type="button" class="menu-item" data-menu="favorite">' + icons.heart(15) + (st.book.favorite ? '取消收藏本书' : '收藏本书') + '</button>' +
    '<button type="button" class="menu-item" data-menu="finish">' + icons.check(15) + '标记为已读完</button>' +
    '<div class="menu-sep"></div>' +
    '<button type="button" class="menu-item" data-menu="reload">' + icons.refresh(15) + '重新载入本章</button>' +
    '<button type="button" class="menu-item" data-menu="settings">' + icons.settings(15) + '阅读设置</button>';
  document.body.appendChild(menu);
  const rect = button.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  let left = clamp(rect.right - width, 10, window.innerWidth - width - 10);
  let top = rect.bottom + 8;
  if (top + height > window.innerHeight - 10) top = Math.max(10, rect.top - height - 8);
  menu.style.left = Math.round(left) + 'px';
  menu.style.top = Math.round(top) + 'px';
  st.menu = menu;
  const onClick = (event) => {
    const item = event.target.closest('[data-menu]');
    if (!item) return;
    event.stopPropagation();
    handleReaderMenu(st, item.dataset.menu);
  };
  menu.addEventListener('click', onClick);
  const onOutside = (event) => { if (!menu.contains(event.target)) closeMenu(st); };
  const timer = setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
  st.menuCleanup = () => {
    clearTimeout(timer);
    document.removeEventListener('mousedown', onOutside, true);
    menu.removeEventListener('click', onClick);
  };
}

function closeMenu(st) {
  if (!st) return;
  if (st.menuCleanup) { try { st.menuCleanup(); } catch (error) { /* ignore */ } st.menuCleanup = null; }
  if (st.menu) { st.menu.remove(); st.menu = null; }
}

async function handleReaderMenu(st, action) {
  closeMenu(st);
  if (action === 'library') { leaveToLibrary(st); return; }
  if (action === 'notes') { toggleDrawer(st, 'notes'); return; }
  if (action === 'settings') { leaveToSettings(st); return; }
  if (action === 'reload') {
    saveProgress(st);
    stopSpeech(st);
    render(st.root, st.ctx);
    return;
  }
  if (action === 'favorite') {
    try {
      const updated = await st.ctx.api.library.setFavorite(st.book.id, !st.book.favorite);
      if (updated) {
        st.book.favorite = Boolean(updated.favorite);
        st.ctx.toast(updated.favorite ? '已收藏本书' : '已取消收藏', 'ok');
        st.ctx.refreshShell().catch(() => {});
      }
    } catch (error) {
      st.ctx.toast(friendlyError(error, '操作失败'), 'error');
    }
    return;
  }
  if (action === 'finish') {
    try {
      await st.ctx.api.library.setStatus(st.book.id, 'finished');
      st.ctx.toast('已标记为读完', 'ok');
      st.ctx.refreshShell().catch(() => {});
    } catch (error) {
      st.ctx.toast(friendlyError(error, '操作失败'), 'error');
    }
  }
}

async function removeNote(st, id) {
  try {
    await st.ctx.api.notes.remove(id);
    st.notes = st.notes.filter((note) => note.id !== id);
    renderNotesDrawer(st);
    st.ctx.toast('笔记已删除', 'ok');
    st.ctx.refreshShell().catch(() => {});
  } catch (error) {
    st.ctx.toast(friendlyError(error, '删除笔记失败'), 'error');
  }
}

async function removeVocab(st, id) {
  try {
    await st.ctx.api.vocab.remove(id);
    st.vocabWords = st.vocabWords.filter((word) => word.id !== id);
    st.vocabAll = st.vocabAll.filter((word) => word.id !== id);
    rebuildVocabIndex(st);
    renderNotesDrawer(st);
    st.ctx.toast('已从生词本移除', 'ok');
    st.ctx.refreshShell().catch(() => {});
  } catch (error) {
    st.ctx.toast(friendlyError(error, '移除生词失败'), 'error');
  }
}

/* ------------------------------ 选区 ------------------------------ */

function settleSelection(st) {
  if (!st.alive || st.destroyed) return;
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || selection.isCollapsed) {
    hideSelectPill(st);
    return;
  }
  const range = selection.getRangeAt(0);
  if (!st.els.content.contains(range.commonAncestorContainer)) return;
  const text = selection.toString().replace(/\s+/g, ' ').trim().slice(0, 1200);
  if (!text || text.length < 2) { hideSelectPill(st); return; }
  const rect = normalizeRect(range.getBoundingClientRect());
  if (rect.width === 0 && rect.height === 0) return;
  const context = contextForRange(st, range);
  st.selection = { text, context, rect, kind: detectKind(text) };
  if (st.settings.autoTranslate) {
    openLookup(st, { text, context, rect, kind: st.selection.kind });
  } else {
    showSelectPill(st, rect);
  }
}

function saveCurrentSelection(st) {
  if (st.lookup) { saveLookupWord(st); return; }
  const selection = window.getSelection();
  const text = selection ? selection.toString().replace(/\s+/g, ' ').trim() : '';
  if (!text) {
    st.ctx.toast('先选中一个词或句子，再按 Ctrl+S', 'warn');
    return;
  }
  const range = selection.rangeCount ? selection.getRangeAt(0) : null;
  const rect = range ? normalizeRect(range.getBoundingClientRect()) : normalizeRect(null);
  openLookup(st, {
    text,
    context: range ? contextForRange(st, range) : '',
    rect,
    autoSave: true
  });
}

/* ------------------------------ 事件绑定 ------------------------------ */

function add(st, target, type, handler, options) {
  target.addEventListener(type, handler, options);
  st.cleanups.push(() => target.removeEventListener(type, handler, options));
}

function bind(st) {
  st.scheduleSelection = debounce(() => settleSelection(st), 200);

  add(st, window, 'keydown', (event) => onKeydown(st, event));
  add(st, window, 'resize', () => { if (st.lookup) positionLookup(st); });
  add(st, st.root, 'click', (event) => onRootClick(st, event));

  add(st, st.els.content, 'mouseup', () => st.scheduleSelection());
  add(st, document, 'selectionchange', () => st.scheduleSelection());
  add(st, document, 'mouseup', (event) => {
    if (!st.lookup) return;
    if (event.target.closest('#lookup') || event.target.closest('#select-pill')) return;
    if (!st.els.content.contains(event.target)) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) closeLookup(st);
  });

  add(st, st.els.reader, 'mousemove', throttle((event) => {
    if (!st.focus) return;
    const near = event.clientY <= 88;
    if (st.els.top) st.els.top.classList.toggle('top-visible', near);
  }, 90));

  const input = st.els.searchInput;
  if (input) {
    const onInput = debounce(() => runSearch(st), 320);
    add(st, input, 'input', onInput);
    add(st, input, 'keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        onInput.cancel();
        runSearch(st);
      } else if (event.key === 'Escape') {
        event.stopPropagation();
        closeSearch(st);
      }
    });
  }

  updateProgressUi(st);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { if (!st.destroyed) updateProgressUi(st); }).catch(() => {});
  }
}

function onRootClick(st, event) {
  const actionEl = event.target.closest('[data-act]');
  if (actionEl) {
    const action = actionEl.dataset.act;
    const map = {
      back: () => leaveToLibrary(st),
      toc: () => toggleDrawer(st, 'toc'),
      notes: () => toggleDrawer(st, 'notes'),
      'close-drawers': () => closeDrawers(st),
      search: () => openSearch(st),
      'search-close': () => closeSearch(st),
      'search-retry': () => runSearch(st),
      'font-minus': () => changeFontSize(st, -1),
      'font-plus': () => changeFontSize(st, 1),
      theme: () => cycleTheme(st),
      focus: () => toggleFocus(st),
      tts: () => toggleTTS(st),
      bookmark: () => toggleBookmark(st),
      more: () => openReaderMenu(st),
      prev: () => gotoChapter(st, st.chapter.prev),
      next: () => gotoChapter(st, st.chapter.next),
      'lookup-close': () => closeLookup(st),
      'selection-toggle': () => {
        if (!st.lookup) return;
        st.lookup.selectionExpanded = !st.lookup.selectionExpanded;
        renderLookup(st);
      },
      'lexicon-toggle': () => {
        if (!st.lookup) return;
        st.lookup.lexiconOpen = !st.lookup.lexiconOpen;
        renderLookup(st);
      },
      'dict-note-toggle': () => {
        if (!st.lookup) return;
        st.lookup.dictNoteOpen = !st.lookup.dictNoteOpen;
        renderLookup(st);
      },
      'lookup-save': () => saveLookupWord(st),
      'lookup-note': () => toggleNoteComposer(st),
      'lookup-copy': () => copyLookup(st),
      'lookup-speak': () => speakLookup(st, actionEl),
      'lookup-retry': () => retryLookup(st),
      'note-save': () => saveNoteFromLookup(st),
      'note-cancel': () => { if (st.lookup) { st.lookup.noteOpen = false; renderLookup(st); } },
      analyze: () => runAnalyze(st),
      'ai-retry': () => { if (st.lookup) st.lookup.aiError = null; runAnalyze(st); },
      'open-settings': () => leaveToSettings(st),
      'retry-error': () => render(st.root, st.ctx),
      'back-library': () => leaveToLibrary(st),
      'select-pill': () => {
        if (!st.selection) return;
        openLookup(st, { text: st.selection.text, context: st.selection.context, rect: st.selection.rect, kind: st.selection.kind });
      }
    };
    if (map[action]) {
      event.preventDefault();
      event.stopPropagation();
      map[action]();
      return;
    }
  }

  const paraButton = event.target.closest('.para-translate');
  if (paraButton) {
    event.preventDefault();
    translateParagraph(st, Number(paraButton.dataset.para), paraButton);
    return;
  }
  const translationClose = event.target.closest('[data-pt-close]');
  if (translationClose) {
    const block = translationClose.closest('.para-translation');
    if (block) block.remove();
    return;
  }
  const vocabHit = event.target.closest('.vocab-hit');
  if (vocabHit) {
    const word = vocabHit.dataset.word || vocabHit.textContent;
    const saved = st.vocabMap.get(String(word).toLowerCase()) || null;
    const para = vocabHit.closest('.para');
    openLookup(st, {
      text: word,
      context: paraText(para),
      rect: normalizeRect(vocabHit.getBoundingClientRect()),
      preset: saved
    });
    return;
  }
  const chapterItem = event.target.closest('[data-chapter]');
  if (chapterItem) {
    gotoChapter(st, Number(chapterItem.dataset.chapter));
    return;
  }
  const searchHit = event.target.closest('[data-search-hit]');
  if (searchHit) {
    jumpToSearchHit(st, searchHit);
    return;
  }
  const noteColor = event.target.closest('[data-note-color]');
  if (noteColor && st.lookup) {
    st.lookup.noteColor = noteColor.dataset.noteColor;
    st.els.lookup.querySelectorAll('[data-note-color]').forEach((dot) => dot.classList.toggle('active', dot === noteColor));
    return;
  }
  const noteRemove = event.target.closest('[data-note-remove]');
  if (noteRemove) {
    removeNote(st, noteRemove.dataset.noteRemove);
    return;
  }
  const vocabRemove = event.target.closest('[data-vocab-remove]');
  if (vocabRemove) {
    removeVocab(st, vocabRemove.dataset.vocabRemove);
    return;
  }
  if (event.target === st.els.scrim) closeDrawers(st);
}

function onKeydown(st, event) {
  const key = event.key;
  const mod = event.metaKey || event.ctrlKey;
  const typing = isTypingTarget(event.target);

  if (key === 'Escape') {
    if (st.lookup) { event.preventDefault(); closeLookup(st); return; }
    if (st.els.selectPill && st.els.selectPill.classList.contains('is-on')) { hideSelectPill(st); return; }
    if (searchOpen(st)) { event.preventDefault(); closeSearch(st); return; }
    if (st.drawer) { event.preventDefault(); closeDrawers(st); return; }
    if (st.menu) { event.preventDefault(); closeMenu(st); return; }
    if (st.focus) { event.preventDefault(); toggleFocus(st, false); return; }
    return;
  }

  if (typing) return;

  if (mod && String(key).toLowerCase() === 'f') { event.preventDefault(); openSearch(st); return; }
  if (mod && String(key).toLowerCase() === 's') { event.preventDefault(); saveCurrentSelection(st); return; }
  if (mod || event.altKey) return;
  if (st.lookup || searchOpen(st) || st.drawer || st.menu) return;

  if (key === 'ArrowRight') { event.preventDefault(); gotoChapter(st, st.chapter.next); return; }
  if (key === 'ArrowLeft') { event.preventDefault(); gotoChapter(st, st.chapter.prev); return; }
  if (String(key).toLowerCase() === 'f') { event.preventDefault(); toggleFocus(st); return; }
  if (String(key).toLowerCase() === 't') { event.preventDefault(); readParagraphs(st, visibleParagraphIndex(st), true); return; }
  if (key === '/') { event.preventDefault(); openSearch(st); }
}

function destroy(st) {
  if (!st || st.destroyed) return;
  st.destroyed = true;
  st.alive = false;
  if (S === st) S = null;
  try {
    if (st.book && st.chapter && st.els && st.els.scroll) saveProgress(st);
  } catch (error) { /* ignore */ }
  if (st.tick) clearInterval(st.tick);
  if (st.lookupPosTimer) { clearTimeout(st.lookupPosTimer); st.lookupPosTimer = null; }
  if (st.saveDebounced) st.saveDebounced.cancel();
  if (st.menuCleanup) { try { st.menuCleanup(); } catch (error) { /* ignore */ } st.menuCleanup = null; }
  if (st.menu) { st.menu.remove(); st.menu = null; }
  try { window.removeEventListener('lumen:route-leave', st.onLeave); } catch (error) { /* ignore */ }
  try { window.removeEventListener('beforeunload', st.onBeforeUnload); } catch (error) { /* ignore */ }
  try { document.removeEventListener('visibilitychange', st.onVisibility); } catch (error) { /* ignore */ }
  stopSpeech(st);
  closeLookup(st);
  hideSelectPill(st);
  closeDrawers(st);
  (st.cleanups || []).forEach((cleanup) => { try { cleanup(); } catch (error) { /* ignore */ } });
  st.cleanups = [];
}

/* ------------------------------ 挂载 ------------------------------ */

export async function render(root, ctx) {
  destroy(S);

  const route = parseHash();
  const st = {
    root,
    ctx,
    bookId: route.bookId,
    alive: true,
    destroyed: false,
    cleanups: [],
    settings: readerSettings(ctx),
    book: null,
    chapter: null,
    bookmarks: [],
    notes: [],
    vocabAll: [],
    vocabWords: [],
    vocabMap: new Map(),
    lookup: null,
    lookupReqId: 0,
    lookupScrollTop: 0,
    selection: null,
    focus: false,
    drawer: null,
    percent: 0,
    saving: false,
    speech: null,
    speechToken: 0,
    searchReq: 0,
    menu: null,
    menuCleanup: null,
    lookupPosTimer: null
  };
  S = st;
  root.scrollTop = 0;
  root.innerHTML = loadingHtml();

  if (!route.bookId) {
    root.innerHTML = missingHtml();
    bindSimpleActions(st);
    return;
  }

  const api = ctx.api;
  let chapterIndex = route.chapterIndex;
  let book = null;
  let payload = null;
  let vocabList = [];
  let noteList = [];
  try {
    if (chapterIndex === null) {
      book = await api.library.get(route.bookId);
      if (!st.alive) return;
      const count = Math.max(1, Number(book && book.chapterCount) || 1);
      chapterIndex = clamp(Number(book && book.progress && book.progress.chapterIndex) || 0, 0, count - 1);
    }
    const results = await Promise.all([
      api.reader.getChapter(route.bookId, chapterIndex).catch((error) => {
        if (chapterIndex !== 0) return api.reader.getChapter(route.bookId, 0);
        throw error;
      }),
      api.vocab.list().catch(() => []),
      api.notes.list(route.bookId).catch(() => [])
    ]);
    payload = results[0];
    vocabList = results[1];
    noteList = results[2];
    if (!payload || !payload.book || !payload.chapter) throw new Error('章节数据不完整');
    if (!st.alive) return;
  } catch (error) {
    if (!st.alive) return;
    console.warn('[lumen] reader load failed', error);
    root.innerHTML = errorHtml(error);
    bindSimpleActions(st);
    return;
  }

  st.book = payload.book || book;
  st.chapter = payload.chapter;
  st.chapterIndex = Number(st.chapter.index);
  st.bookmarks = Array.isArray(payload.bookmarks) ? payload.bookmarks : [];
  st.vocabAll = Array.isArray(vocabList) ? vocabList : [];
  st.vocabWords = st.vocabAll.filter((word) => word && word.source && word.source.bookId === st.book.id);
  st.notes = Array.isArray(noteList) ? noteList : [];
  rebuildVocabIndex(st);

  root.innerHTML = readerHtml(st);
  cacheEls(st);
  applyReaderVars(st);
  bind(st);
  startSession(st);
  restoreScroll(st);
  const jumped = applyPendingJump(st);
  if (!jumped) updateProgressUi(st);
  updateBookmarkButton(st);
  updateTtsButton(st);
  updateThemeButton(st);
}

function bindSimpleActions(st) {
  const retry = st.root.querySelector('[data-act="retry-error"]');
  if (retry) retry.addEventListener('click', () => render(st.root, st.ctx));
  const back = st.root.querySelector('[data-act="back-library"]');
  if (back) back.addEventListener('click', () => st.ctx.navigate('library'));
}
