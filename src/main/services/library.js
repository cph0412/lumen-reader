'use strict';

// library.js — 书库：导入、章节读取、进度、书签、搜索、示例书播种。
// 书库元数据保存在 dataDir/library.json，正文保存在 dataDir/books/<id>.txt。
// 纯 Node，不依赖 electron。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { detectAndDecode } = require('../util/encoding');
const { parseChapters, countWords, guessTitle } = require('../util/chapters');
const { createJsonStore, writeFileAtomic } = require('./store');

const TEXT_EXTENSIONS = new Set(['.txt', '.text', '.md']);
const MAX_IMPORT_BYTES = 40 * 1024 * 1024;
const MAX_SEARCH_RESULTS = 60;
const CACHE_LIMIT = 4;
const BOOK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function nowIso() {
  return new Date().toISOString();
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function randomId(prefix) {
  return prefix + '_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function paletteFor(seed) {
  const hash = crypto.createHash('sha1').update(String(seed)).digest();
  return hash[0] % 6;
}

function cleanText(raw) {
  return String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '') + '\n';
}

function extractMeta(text, fileName) {
  const fallback = path.basename(fileName || '未命名', path.extname(fileName || '')) || '未命名';
  const lines = text.split('\n');
  const nonEmpty = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) nonEmpty.push(trimmed);
    if (nonEmpty.length >= 40) break;
  }

  let title = fallback;
  let titlePos = -1;
  for (let i = 0; i < Math.min(nonEmpty.length, 8); i += 1) {
    const line = nonEmpty[i];
    if (/^\[.*\]$/.test(line)) continue;
    if (/^(contents|table of contents)$/i.test(line)) break;
    if (line.length > 80) break;
    const cleaned = line
      .replace(/^["'\u201c\u201d\u2018\u2019]+/, '')
      .replace(/["'\u201c\u201d\u2018\u2019]+$/, '')
      .replace(/[;,]$/, '')
      .trim();
    if (cleaned) {
      title = cleaned;
      titlePos = i;
    }
    break;
  }

  let author = '';
  for (let i = titlePos + 1; i < Math.min(nonEmpty.length, titlePos + 16); i += 1) {
    const match = /^(?:by|author)\s*[:\uff1a]?\s*(.+)$/i.exec(nonEmpty[i]);
    if (match) {
      const value = match[1].trim();
      if (value && value.length <= 80) {
        author = value;
        break;
      }
    }
    if (/^(chapter|part|contents|prologue|letter)\b/i.test(nonEmpty[i])) break;
  }

  return { title: title || fallback, author };
}

function createLibraryService(options) {
  const opts = options || {};
  const dataDir = opts.dataDir;
  if (!dataDir) throw new TypeError('createLibraryService 需要 dataDir');
  const sampleDir = opts.sampleDir || null;
  const booksDir = path.join(dataDir, 'books');
  const store = opts.store || createJsonStore({
    filePath: path.join(dataDir, 'library.json'),
    defaults: function () { return { schemaVersion: 2, books: [], bookmarks: [], deletedSamples: [] }; },
  });
  const parseCache = new Map();

  function readLib() {
    const lib = store.read();
    if (!Array.isArray(lib.books)) lib.books = [];
    if (!Array.isArray(lib.bookmarks)) lib.bookmarks = [];
    if (!Array.isArray(lib.deletedSamples)) lib.deletedSamples = [];
    // v1 stored progress/bookmark percentages as 0..1 while the UI and
    // reader use 0..100. Migrate old files once so a user's saved position
    // does not suddenly show up as "1%".
    if (lib.schemaVersion !== 2) {
      let changed = false;
      for (const book of lib.books) {
        const progress = book && book.progress;
        const percent = progress ? Number(progress.percent) : NaN;
        if (Number.isFinite(percent) && percent > 0 && percent <= 1) {
          progress.percent = Math.round(percent * 10000) / 100;
          changed = true;
        }
      }
      for (const bookmark of lib.bookmarks) {
        const percent = Number(bookmark && bookmark.percent);
        if (Number.isFinite(percent) && percent > 0 && percent <= 1) {
          bookmark.percent = Math.round(percent * 10000) / 100;
          changed = true;
        }
      }
      lib.schemaVersion = 2;
      if (changed) store.write(lib);
    }
    return lib;
  }

  function persist(lib) {
    store.write(lib);
    return lib;
  }

  function bookPath(id) {
    if (!BOOK_ID_RE.test(String(id || ''))) throw fail('NOT_FOUND', '无效的书籍 ID');
    return path.join(booksDir, id + '.txt');
  }

  function cacheParsed(bookId, text, chapters) {
    parseCache.delete(bookId);
    parseCache.set(bookId, { text: text, chapters: chapters });
    while (parseCache.size > CACHE_LIMIT) {
      const oldest = parseCache.keys().next().value;
      parseCache.delete(oldest);
    }
  }

  function loadParsed(book) {
    const cached = parseCache.get(book.id);
    if (cached) {
      parseCache.delete(book.id);
      parseCache.set(book.id, cached);
      return cached;
    }
    let text;
    try {
      text = fs.readFileSync(bookPath(book.id), 'utf8');
    } catch (err) {
      throw fail('NOT_FOUND', '书籍文件不存在：' + book.title);
    }
    const parsed = parseChapters(text);
    const entry = { text: text, chapters: parsed.chapters };
    cacheParsed(book.id, text, parsed.chapters);
    return entry;
  }

  function buildBook(input) {
    const parsed = parseChapters(input.text);
    const chapters = parsed.chapters.map(function (item) {
      return { index: item.index, title: item.title, wordCount: item.wordCount };
    });
    const wordCount = chapters.reduce(function (sum, item) { return sum + item.wordCount; }, 0);
    const book = {
      id: input.id,
      title: input.title || parsed.title || guessTitle(input.text) || input.fileName || '未命名',
      author: input.author || '',
      description: input.description || '',
      fileName: input.fileName || '',
      source: input.source === 'sample' ? 'sample' : 'imported',
      encoding: input.encoding || 'utf-8',
      language: 'en',
      sizeBytes: input.sizeBytes || Buffer.byteLength(input.text, 'utf8'),
      wordCount: wordCount,
      charCount: input.text.length,
      addedAt: input.addedAt || nowIso(),
      lastOpenedAt: null,
      chapterCount: chapters.length,
      progress: { chapterIndex: 0, percent: 0, scrollTop: 0 },
      status: 'unread',
      palette: Number.isInteger(input.palette) ? ((input.palette % 6) + 6) % 6 : paletteFor(input.id + ':' + (input.title || '')),
      favorite: false,
      chapters: chapters,
    };
    if (input.level) book.level = String(input.level);
    if (input.year) book.year = Number(input.year);
    return { book: book, parsed: parsed };
  }

  function list() {
    const books = readLib().books.slice();
    books.sort(function (a, b) {
      const aTime = Date.parse(a.lastOpenedAt || a.addedAt || 0) || 0;
      const bTime = Date.parse(b.lastOpenedAt || b.addedAt || 0) || 0;
      if (bTime !== aTime) return bTime - aTime;
      return String(a.title).localeCompare(String(b.title));
    });
    return books;
  }

  function get(id) {
    const key = String(id || '');
    if (!BOOK_ID_RE.test(key)) throw fail('NOT_FOUND', '书籍不存在');
    const book = readLib().books.find(function (item) { return item.id === key; });
    if (!book) throw fail('NOT_FOUND', '书籍不存在');
    return book;
  }

  function updateBook(id, mutate) {
    const lib = readLib();
    const index = lib.books.findIndex(function (item) { return item.id === String(id || ''); });
    if (index === -1) throw fail('NOT_FOUND', '书籍不存在');
    const book = lib.books[index];
    const next = mutate(book) || book;
    lib.books[index] = next;
    persist(lib);
    return next;
  }

  function listBookmarks(bookId) {
    const lib = readLib();
    const id = String(bookId || '');
    return lib.bookmarks
      .filter(function (item) { return item.bookId === id; })
      .sort(function (a, b) {
        if (a.chapterIndex !== b.chapterIndex) return a.chapterIndex - b.chapterIndex;
        return (Number(a.percent) || 0) - (Number(b.percent) || 0);
      });
  }

  function getChapter(bookId, chapterIndex) {
    const book = get(bookId);
    const parsed = loadParsed(book);
    const total = parsed.chapters.length;
    let index = Number(chapterIndex);
    if (!Number.isInteger(index)) index = 0;
    index = Math.min(Math.max(index, 0), Math.max(0, total - 1));
    const entry = parsed.chapters[index];
    let text = entry ? parsed.text.slice(entry.start, entry.end) : '';
    text = text.replace(/^\n+/, '').replace(/\s+$/, '');
    return {
      book: book,
      chapter: {
        index: index,
        title: entry ? entry.title : book.title,
        text: text,
        wordCount: entry ? entry.wordCount : 0,
        prev: index > 0 ? index - 1 : null,
        next: total > 0 && index < total - 1 ? index + 1 : null,
        total: total,
      },
      bookmarks: listBookmarks(book.id).filter(function (item) { return item.chapterIndex === index; }),
    };
  }

  function chapterIndexAt(chapters, position) {
    let low = 0;
    let high = chapters.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (position < chapters[mid].start) high = mid - 1;
      else if (position >= chapters[mid].end) low = mid + 1;
      else return mid;
    }
    return Math.max(0, Math.min(chapters.length - 1, low));
  }

  function makeSnippet(text, index, length) {
    const before = 70;
    const after = 110;
    let start = Math.max(0, index - before);
    let end = Math.min(text.length, index + length + after);
    if (start > 0) {
      const space = text.indexOf(' ', start);
      if (space !== -1 && space < index) start = space + 1;
    }
    if (end < text.length) {
      const space = text.lastIndexOf(' ', end);
      if (space > index + length) end = space;
    }
    let snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
    if (start > 0) snippet = '\u2026' + snippet;
    if (end < text.length) snippet = snippet + '\u2026';
    return snippet;
  }

  function search(bookId, query) {
    const book = get(bookId);
    const needleText = String(query === undefined || query === null ? '' : query).trim();
    if (!needleText) return [];
    const parsed = loadParsed(book);
    const haystack = parsed.text.toLowerCase();
    const needle = needleText.toLowerCase();
    if (!parsed.chapters.length) return [];
    const results = [];
    let from = 0;
    let guard = 0;
    while (results.length < MAX_SEARCH_RESULTS && guard < 5000) {
      guard += 1;
      const found = haystack.indexOf(needle, from);
      if (found === -1) break;
      const chapterIdx = chapterIndexAt(parsed.chapters, found);
      const chapter = parsed.chapters[chapterIdx];
      results.push({
        chapterIndex: chapter.index,
        chapterTitle: chapter.title,
        snippet: makeSnippet(parsed.text, found, needle.length),
        position: found - chapter.start,
      });
      from = found + needle.length;
    }
    return results;
  }

  function importOne(filePath) {
    const abs = path.resolve(String(filePath || ''));
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch (err) {
      throw fail('INVALID_FILE', '文件不存在或无法访问');
    }
    if (!stat.isFile()) throw fail('INVALID_FILE', '仅支持单个文本文件');
    if (stat.size > MAX_IMPORT_BYTES) throw fail('INVALID_FILE', '文件过大（上限 40 MB）');
    const ext = path.extname(abs).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) throw fail('INVALID_FILE', '仅支持 .txt / .md 文本文件');

    const buffer = fs.readFileSync(abs);
    const decoded = detectAndDecode(buffer);
    const text = cleanText(decoded.text);
    if (countWords(text) < 20) throw fail('INVALID_FILE', '文件内容为空或过短');

    const id = randomId('bk');
    const fileName = path.basename(abs);
    const meta = extractMeta(text, fileName);
    const built = buildBook({
      id: id,
      text: text,
      title: meta.title,
      author: meta.author,
      fileName: fileName,
      source: 'imported',
      encoding: decoded.encoding,
      sizeBytes: buffer.length,
    });
    writeFileAtomic(bookPath(id), text);
    const lib = readLib();
    lib.books.push(built.book);
    persist(lib);
    cacheParsed(id, text, built.parsed.chapters);
    return built.book;
  }

  async function importPaths(paths) {
    const imported = [];
    const errors = [];
    const list = Array.isArray(paths) ? paths : (paths ? [paths] : []);
    for (const filePath of list) {
      try {
        imported.push(importOne(filePath));
      } catch (err) {
        const name = path.basename(String(filePath || '')) || String(filePath || '');
        errors.push(name + '：' + (err && err.message ? err.message : '导入失败'));
      }
    }
    return { imported: imported, errors: errors };
  }

  async function ensureSamples() {
    if (!sampleDir) return;
    const manifestPath = path.join(sampleDir, 'samples.json');
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      return;
    }
    if (!Array.isArray(manifest)) return;

    const lib = readLib();
    let changed = false;
    for (const item of manifest) {
      if (!item || typeof item !== 'object') continue;
      const fileName = path.basename(String(item.file || ''));
      if (!fileName || !TEXT_EXTENSIONS.has(path.extname(fileName).toLowerCase())) continue;
      const sourcePath = path.join(sampleDir, fileName);
      if (!fs.existsSync(sourcePath)) continue;
      const base = fileName.slice(0, fileName.length - path.extname(fileName).length);
      const id = 'sample-' + base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (!BOOK_ID_RE.test(id)) continue;
      if (lib.deletedSamples.indexOf(id) !== -1) continue;

      const existingIndex = lib.books.findIndex(function (book) { return book.id === id; });
      if (existingIndex !== -1) {
        const book = lib.books[existingIndex];
        const patch = {
          title: item.title || book.title,
          author: item.author || book.author,
          description: typeof item.description === 'string' ? item.description : book.description,
          palette: Number.isInteger(item.palette) ? ((item.palette % 6) + 6) % 6 : book.palette,
        };
        if (item.level) patch.level = String(item.level);
        if (item.year) patch.year = Number(item.year);
        let touched = false;
        for (const key of Object.keys(patch)) {
          if (book[key] !== patch[key]) {
            book[key] = patch[key];
            touched = true;
          }
        }
        if (!fs.existsSync(bookPath(id))) {
          const buffer = fs.readFileSync(sourcePath);
          const decoded = detectAndDecode(buffer);
          const text = cleanText(decoded.text);
          writeFileAtomic(bookPath(id), text);
          cacheParsed(id, text, parseChapters(text).chapters);
          touched = true;
        }
        if (touched) changed = true;
        continue;
      }

      try {
        const buffer = fs.readFileSync(sourcePath);
        const decoded = detectAndDecode(buffer);
        const text = cleanText(decoded.text);
        if (countWords(text) < 20) continue;
        const built = buildBook({
          id: id,
          text: text,
          title: item.title || '',
          author: item.author || '',
          description: typeof item.description === 'string' ? item.description : '',
          fileName: fileName,
          source: 'sample',
          encoding: decoded.encoding,
          sizeBytes: buffer.length,
          palette: Number.isInteger(item.palette) ? item.palette : 0,
          level: item.level,
          year: item.year,
        });
        writeFileAtomic(bookPath(id), text);
        lib.books.push(built.book);
        cacheParsed(id, text, built.parsed.chapters);
        changed = true;
      } catch (err) {
        // 单本示例书损坏不应影响整体启动
        continue;
      }
    }
    if (changed) persist(lib);
  }

  async function init() {
    fs.mkdirSync(booksDir, { recursive: true });
    readLib();
    await ensureSamples();
  }

  function remove(id) {
    const key = String(id || '');
    const lib = readLib();
    const index = lib.books.findIndex(function (book) { return book.id === key; });
    if (index === -1) throw fail('NOT_FOUND', '书籍不存在');
    const book = lib.books[index];
    lib.books.splice(index, 1);
    lib.bookmarks = lib.bookmarks.filter(function (item) { return item.bookId !== key; });
    if (book.source === 'sample' && lib.deletedSamples.indexOf(key) === -1) {
      lib.deletedSamples.push(key);
    }
    persist(lib);
    parseCache.delete(key);
    try {
      fs.unlinkSync(bookPath(key));
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    return { ok: true };
  }

  function setFavorite(id, favorite) {
    return updateBook(id, function (book) {
      book.favorite = Boolean(favorite);
      return book;
    });
  }

  function setStatus(id, status) {
    const allowed = ['unread', 'reading', 'finished'];
    const nextStatus = allowed.indexOf(status) === -1 ? 'reading' : status;
    return updateBook(id, function (book) {
      book.status = nextStatus;
      if (nextStatus === 'finished') {
        book.progress = Object.assign({ chapterIndex: 0, percent: 0, scrollTop: 0 }, book.progress || {});
        book.progress.percent = 100;
      }
      return book;
    });
  }

  function saveProgress(input) {
    const payload = input || {};
    const book = get(payload.bookId);
    const chapterIndex = clampNumber(payload.chapterIndex, 0, Math.max(0, book.chapterCount - 1), 0);
    const percent = clampNumber(payload.percent, 0, 100, Number(book.progress && book.progress.percent) || 0);
    const scrollTop = clampNumber(payload.scrollTop, 0, Number.MAX_SAFE_INTEGER, 0);
    return updateBook(book.id, function (target) {
      target.progress = {
        chapterIndex: Math.floor(chapterIndex),
        percent: percent,
        scrollTop: scrollTop,
      };
      target.lastOpenedAt = nowIso();
      // 进度驱动状态；只有到最后一章末尾附近才算读完。
      if (target.status !== 'finished') {
        const atEnd = target.chapterCount > 0 && chapterIndex >= target.chapterCount - 1 && percent >= 98;
        target.status = atEnd ? 'finished' : (percent > 0 || chapterIndex > 0 ? 'reading' : target.status);
      }
      return target;
    });
  }

  function toggleBookmark(input) {
    const payload = input || {};
    const book = get(payload.bookId);
    const chapterIndex = Math.floor(clampNumber(payload.chapterIndex, 0, Math.max(0, book.chapterCount - 1), 0));
    const percent = clampNumber(payload.percent, 0, 100, 0);
    const lib = readLib();
    const index = lib.bookmarks.findIndex(function (item) {
      return item.bookId === book.id &&
        item.chapterIndex === chapterIndex &&
        Math.abs((Number(item.percent) || 0) - percent) < 0.5;
    });
    if (index !== -1) {
      const removed = lib.bookmarks[index];
      lib.bookmarks.splice(index, 1);
      persist(lib);
      return { added: false, bookmark: removed };
    }
    const parsed = loadParsed(book);
    const chapter = parsed.chapters[chapterIndex];
    const bookmark = {
      id: randomId('bm'),
      bookId: book.id,
      chapterIndex: chapterIndex,
      chapterTitle: chapter ? chapter.title : '',
      percent: percent,
      label: String(payload.label || '').trim().slice(0, 120),
      createdAt: nowIso(),
    };
    lib.bookmarks.push(bookmark);
    persist(lib);
    return { added: true, bookmark: bookmark };
  }

  return {
    init: init,
    list: list,
    get: get,
    getChapter: getChapter,
    search: search,
    importPaths: importPaths,
    remove: remove,
    setFavorite: setFavorite,
    saveProgress: saveProgress,
    setStatus: setStatus,
    toggleBookmark: toggleBookmark,
    listBookmarks: listBookmarks,
    ensureSamples: ensureSamples,
    // 供主进程 / 测试使用的只读属性
    dataDir: dataDir,
    booksDir: booksDir,
  };
}

module.exports = { createLibraryService, extractMeta };
