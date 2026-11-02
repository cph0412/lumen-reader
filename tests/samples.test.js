'use strict';

// 真实示例书集成检查：resources/samples 存在时验证 6 本示例书的播种与解析。
// 若资源尚未准备（例如裁剪过的检出），跳过而不是失败。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeTempDir, cleanupDir } = require('./helpers');
const { createLibraryService } = require('../src/main/services/library');

const samplesDir = path.join(__dirname, '..', 'resources', 'samples');

test('samples: 从 resources/samples 播种真实示例书', async function (t) {
  const manifestPath = path.join(samplesDir, 'samples.json');
  if (!fs.existsSync(manifestPath)) {
    t.skip('resources/samples/samples.json 不存在');
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(Array.isArray(manifest));
  assert.ok(manifest.length >= 6, '示例书至少 6 本');

  const dataDir = makeTempDir('lumen-real-samples');
  t.after(function () { cleanupDir(dataDir); });
  const library = createLibraryService({ dataDir: dataDir, sampleDir: samplesDir });
  await library.init();

  const books = library.list();
  assert.equal(books.length, manifest.length);
  const titles = books.map(function (book) { return book.title; });
  for (const item of manifest) {
    assert.ok(item.file && item.title, 'samples.json 条目应包含 file/title');
    assert.ok(titles.indexOf(item.title) !== -1, '缺少示例书：' + item.title);
  }
  for (const book of books) {
    assert.equal(book.source, 'sample');
    assert.ok(book.chapterCount >= 1, book.title + ' 应至少有一个章节');
    assert.ok(book.wordCount > 500, book.title + ' 词数异常');
    assert.ok(book.charCount > 2000, book.title + ' 字符数异常');
    assert.ok(fs.existsSync(path.join(dataDir, 'books', book.id + '.txt')));
    const payload = library.getChapter(book.id, 0);
    assert.ok(payload.chapter.text.length > 100);
  }

  const multiChapter = books.filter(function (book) { return book.chapterCount >= 10; });
  assert.ok(multiChapter.length >= 2, '至少两本示例书应有 10+ 章节（如 Sherlock / Frankenstein）');
});
