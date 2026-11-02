'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeTempDir, cleanupDir } = require('./helpers');
const { createLibraryService } = require('../src/main/services/library');

const PARA = 'It was a bright cold day in April and the clocks were striking thirteen while people hurried home. ';

function bookText(title, author, chapters) {
  const lines = [title, '', 'by ' + author, ''];
  for (let i = 1; i <= chapters; i += 1) {
    lines.push(i % 2 === 0 ? 'Chapter ' + i : 'CHAPTER ' + toRoman(i));
    lines.push(PARA.repeat(6).trim());
    lines.push('');
  }
  return lines.join('\n');
}

function toRoman(number) {
  const map = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let value = number;
  let output = '';
  for (const pair of map) {
    while (value >= pair[0]) {
      output += pair[1];
      value -= pair[0];
    }
  }
  return output;
}

function makeSampleDir(t) {
  const dir = makeTempDir('lumen-samples');
  t.after(function () { cleanupDir(dir); });
  fs.writeFileSync(path.join(dir, 'sample-one.txt'), bookText('Sample One', 'Author One', 3), 'utf8');
  fs.writeFileSync(path.join(dir, 'sample-two.txt'), bookText('Sample Two', 'Author Two', 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'samples.json'), JSON.stringify([
    { file: 'sample-one.txt', title: '示例一', author: '作者一', description: '第一本示例书', palette: 3, level: 'B1', year: 2020 },
    { file: 'sample-two.txt', title: '示例二', author: '作者二', description: '第二本示例书', palette: 5 },
  ], null, 2), 'utf8');
  return dir;
}

async function makeLibrary(t, opts) {
  const dataDir = makeTempDir('lumen-lib');
  t.after(function () { cleanupDir(dataDir); });
  const sampleDir = opts && opts.sampleDir === false ? null : makeSampleDir(t);
  const library = createLibraryService({ dataDir: dataDir, sampleDir: sampleDir });
  await library.init();
  return { library: library, dataDir: dataDir, sampleDir: sampleDir };
}

test('library: 示例书播种（元数据来自 samples.json）', async function (t) {
  const ctx = await makeLibrary(t);
  const books = ctx.library.list();
  assert.equal(books.length, 2);
  const first = books.find(function (book) { return book.title === '示例一'; });
  assert.ok(first, '应播种示例一');
  assert.equal(first.source, 'sample');
  assert.equal(first.author, '作者一');
  assert.equal(first.description, '第一本示例书');
  assert.equal(first.palette, 3);
  assert.equal(first.level, 'B1');
  assert.equal(first.year, 2020);
  assert.equal(first.language, 'en');
  assert.equal(first.status, 'unread');
  assert.deepEqual(first.progress, { chapterIndex: 0, percent: 0, scrollTop: 0 });
  assert.equal(first.favorite, false);
  assert.equal(first.lastOpenedAt, null);
  assert.equal(typeof first.addedAt, 'string');
  assert.ok(first.chapterCount >= 3);
  assert.equal(first.chapters.length, first.chapterCount);
  first.chapters.forEach(function (chapter, index) {
    assert.equal(chapter.index, index);
    assert.equal(typeof chapter.title, 'string');
    assert.ok(chapter.wordCount > 0);
  });
  assert.ok(first.wordCount > 0);
  assert.ok(first.charCount > 0);
  assert.ok(first.sizeBytes > 0);
  assert.ok(fs.existsSync(path.join(ctx.dataDir, 'books', first.id + '.txt')));
});

test('library: init 幂等，不会重复播种', async function (t) {
  const ctx = await makeLibrary(t);
  await ctx.library.init();
  assert.equal(ctx.library.list().length, 2);
});

test('library: getChapter / 目录页码', async function (t) {
  const ctx = await makeLibrary(t);
  const book = ctx.library.list()[0];
  const payload = ctx.library.getChapter(book.id, 0);
  assert.equal(payload.book.id, book.id);
  assert.equal(payload.chapter.index, 0);
  assert.equal(payload.chapter.prev, null);
  assert.equal(payload.chapter.total, book.chapterCount);
  assert.ok(payload.chapter.next === 1 || payload.chapter.total === 1);
  assert.ok(payload.chapter.text.indexOf('bright cold') !== -1);
  assert.ok(payload.chapter.wordCount > 0);
  assert.deepEqual(payload.bookmarks, []);

  const last = ctx.library.getChapter(book.id, 999);
  assert.equal(last.chapter.index, book.chapterCount - 1);
  assert.equal(last.chapter.next, null);
  assert.equal(last.chapter.prev, book.chapterCount - 2);
});

test('library: 导入 UTF-8 文件（书名/作者/复制正文）', async function (t) {
  const ctx = await makeLibrary(t, { sampleDir: false });
  const sourceDir = makeTempDir('lumen-import');
  t.after(function () { cleanupDir(sourceDir); });
  const file = path.join(sourceDir, 'my-book.txt');
  const content = ['My Imported Book', '', 'by Test Author', '', 'Chapter 1', PARA.repeat(6).trim(), '', 'Chapter 2', PARA.repeat(6).trim(), ''].join('\n');
  fs.writeFileSync(file, content, 'utf8');

  const result = await ctx.library.importPaths([file]);
  assert.equal(result.errors.length, 0);
  assert.equal(result.imported.length, 1);
  const book = result.imported[0];
  assert.equal(book.source, 'imported');
  assert.equal(book.title, 'My Imported Book');
  assert.equal(book.author, 'Test Author');
  assert.equal(book.encoding, 'utf-8');
  assert.equal(book.chapterCount, 2);
  assert.ok(book.wordCount > 0);
  assert.ok(fs.existsSync(path.join(ctx.dataDir, 'books', book.id + '.txt')));
  assert.equal(fs.readFileSync(file, 'utf8'), content, '原文件不应被修改');
  assert.equal(ctx.library.list().length, 1);
  assert.equal(ctx.library.get(book.id).title, 'My Imported Book');
});

test('library: 导入 GB18030 中文书籍', async function (t) {
  const ctx = await makeLibrary(t, { sampleDir: false });
  const sourceDir = makeTempDir('lumen-gbk');
  t.after(function () { cleanupDir(sourceDir); });
  const asciiHead = 'Chinese Encoding Book\n\nby Someone\n\n' + PARA.repeat(4);
  const gbk = Buffer.from([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2]); // 第一章
  const buffer = Buffer.concat([
    Buffer.from(asciiHead, 'ascii'),
    Buffer.from('\n\n', 'ascii'),
    gbk,
    Buffer.from('\n', 'ascii'),
    Buffer.from(PARA.repeat(2), 'ascii'),
  ]);
  const file = path.join(sourceDir, 'chinese.txt');
  fs.writeFileSync(file, buffer);

  const result = await ctx.library.importPaths([file]);
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
  const book = result.imported[0];
  assert.equal(book.encoding, 'gb18030');
  const payload = ctx.library.getChapter(book.id, 0);
  assert.ok(payload.chapter.text.indexOf('第一章') !== -1);
});

test('library: 导入失败文件返回 errors 而不抛异常', async function (t) {
  const ctx = await makeLibrary(t, { sampleDir: false });
  const sourceDir = makeTempDir('lumen-bad');
  t.after(function () { cleanupDir(sourceDir); });
  const pdf = path.join(sourceDir, 'bad.pdf');
  fs.writeFileSync(pdf, 'not a text book');
  const empty = path.join(sourceDir, 'empty.txt');
  fs.writeFileSync(empty, '   ');

  const result = await ctx.library.importPaths([pdf, empty, path.join(sourceDir, 'missing.txt')]);
  assert.equal(result.imported.length, 0);
  assert.equal(result.errors.length, 3);
  assert.equal(ctx.library.list().length, 0);
});

test('library: 60 万字符大书导入、章节与搜索', async function (t) {
  const ctx = await makeLibrary(t, { sampleDir: false });
  const sourceDir = makeTempDir('lumen-big');
  t.after(function () { cleanupDir(sourceDir); });
  const para = ('word '.repeat(500)).trim();
  const chunks = ['Big Book', '', 'by Big Author', ''];
  for (let i = 1; i <= 12; i += 1) {
    chunks.push('CHAPTER ' + i);
    chunks.push((i === 7 ? 'needle-unique-word ' : '') + new Array(20).fill(para).join('\n\n'));
    chunks.push('');
  }
  const content = chunks.join('\n');
  assert.ok(content.length > 590000, '生成文本长度=' + content.length);
  const file = path.join(sourceDir, 'big.txt');
  fs.writeFileSync(file, content, 'utf8');

  const result = await ctx.library.importPaths([file]);
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
  const book = result.imported[0];
  assert.equal(book.chapterCount, 12);
  assert.ok(book.charCount > 590000);
  assert.ok(book.wordCount > 100000);

  const chapter = ctx.library.getChapter(book.id, 6);
  assert.equal(chapter.chapter.index, 6);
  assert.ok(chapter.chapter.text.indexOf('needle-unique-word') !== -1);

  const hits = ctx.library.search(book.id, 'needle-unique-word');
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].chapterIndex, 6);
  assert.ok(hits[0].snippet.indexOf('needle-unique-word') !== -1);
  assert.ok(hits[0].position >= 0);
  assert.equal(ctx.library.search(book.id, 'zzzz-not-found').length, 0);
});

test('library: 进度、状态、收藏持久化', async function (t) {
  const ctx = await makeLibrary(t);
  const book = ctx.library.list()[0];
  const updated = ctx.library.saveProgress({
    bookId: book.id,
    chapterIndex: 1,
    percent: 42,
    scrollTop: 1200,
  });
  assert.deepEqual(updated.progress, { chapterIndex: 1, percent: 42, scrollTop: 1200 });
  assert.equal(updated.status, 'reading');
  assert.ok(updated.lastOpenedAt);

  const finished = ctx.library.saveProgress({
    bookId: book.id,
    chapterIndex: 99,
    percent: 100,
  });
  assert.equal(finished.status, 'finished');
  assert.equal(finished.progress.percent, 100);
  assert.equal(finished.progress.chapterIndex, book.chapterCount - 1);

  const favorite = ctx.library.setFavorite(book.id, true);
  assert.equal(favorite.favorite, true);
  assert.equal(ctx.library.setStatus(book.id, 'unread').status, 'unread');

  const reopened = createLibraryService({ dataDir: ctx.dataDir, sampleDir: null });
  await reopened.init();
  const reloaded = reopened.get(book.id);
  assert.equal(reloaded.favorite, true);
  assert.equal(reloaded.progress.percent, 100);
});

test('library: 旧版 0-1 百分比迁移到 0-100', async function (t) {
  const dataDir = makeTempDir('lumen-migrate');
  t.after(function () { cleanupDir(dataDir); });
  fs.mkdirSync(path.join(dataDir, 'books'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'books', 'bk_legacy.txt'), bookText('Legacy', 'Author', 1), 'utf8');
  const legacyBook = {
    id: 'bk_legacy', title: 'Legacy', author: 'Author', fileName: 'legacy.txt',
    source: 'imported', encoding: 'utf-8', language: 'en', sizeBytes: 100, wordCount: 100,
    charCount: 500, addedAt: new Date().toISOString(), lastOpenedAt: null,
    chapterCount: 1, chapters: [{ index: 0, title: 'Legacy', wordCount: 100 }],
    progress: { chapterIndex: 0, percent: 0.45, scrollTop: 300 },
    status: 'reading', palette: 0, favorite: false,
  };
  fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify({
    books: [legacyBook],
    bookmarks: [{ id: 'bm_legacy', bookId: 'bk_legacy', chapterIndex: 0, percent: 0.25 }],
    deletedSamples: [],
  }), 'utf8');
  const library = createLibraryService({ dataDir, sampleDir: null });
  await library.init();
  const migrated = library.get('bk_legacy');
  assert.equal(migrated.progress.percent, 45);
  assert.equal(migrated.progress.scrollTop, 300);
  assert.equal(library.listBookmarks('bk_legacy')[0].percent, 25);
});

test('library: 书签添加 / 删除', async function (t) {
  const ctx = await makeLibrary(t);
  const book = ctx.library.list()[0];
  const added = ctx.library.toggleBookmark({ bookId: book.id, chapterIndex: 1, percent: 25, label: '重点' });
  assert.equal(added.added, true);
  assert.equal(added.bookmark.chapterIndex, 1);
  assert.equal(added.bookmark.label, '重点');
  assert.equal(added.bookmark.bookId, book.id);
  assert.ok(added.bookmark.chapterTitle);
  assert.equal(ctx.library.listBookmarks(book.id).length, 1);
  assert.equal(ctx.library.getChapter(book.id, 1).bookmarks.length, 1);

  const removed = ctx.library.toggleBookmark({ bookId: book.id, chapterIndex: 1, percent: 25 });
  assert.equal(removed.added, false);
  assert.equal(ctx.library.listBookmarks(book.id).length, 0);
});

test('library: 删除书籍（示例书不会被重复播种）', async function (t) {
  const ctx = await makeLibrary(t);
  const book = ctx.library.list().find(function (item) { return item.source === 'sample'; });
  ctx.library.toggleBookmark({ bookId: book.id, chapterIndex: 0, percent: 10 });
  ctx.library.remove(book.id);
  assert.equal(ctx.library.list().length, 1);
  assert.throws(function () { ctx.library.get(book.id); }, function (err) {
    return err.code === 'NOT_FOUND';
  });
  assert.equal(ctx.library.listBookmarks(book.id).length, 0);
  assert.equal(fs.existsSync(path.join(ctx.dataDir, 'books', book.id + '.txt')), false);

  await ctx.library.init();
  assert.equal(ctx.library.list().length, 1, '用户删除的示例书不应复活');
});
