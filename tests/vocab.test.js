'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeTempDir, cleanupDir } = require('./helpers');
const { createVocabService } = require('../src/main/services/vocab');

const DAY_MS = 24 * 60 * 60 * 1000;

function makeService(t) {
  const dataDir = makeTempDir('lumen-vocab');
  t.after(function () { cleanupDir(dataDir); });
  return { service: createVocabService({ dataDir: dataDir }), dataDir: dataDir };
}

function near(actual, expected, tolerance) {
  assert.ok(Math.abs(actual - expected) <= tolerance, 'actual=' + actual + ' expected=' + expected);
}

test('vocab: 新增生词形状与归一化', function (t) {
  const ctx = makeService(t);
  const result = ctx.service.add({
    word: '  Serendipity, ',
    translation: '意外发现',
    context: 'A moment of serendipity.',
    source: { bookId: 'bk_1', bookTitle: 'A Book', chapterTitle: 'Chapter 1' },
  });
  assert.equal(result.duplicate, false);
  const word = result.word;
  assert.equal(word.word, 'Serendipity,');
  assert.equal(word.normalized, 'serendipity');
  assert.equal(word.translation, '意外发现');
  assert.equal(word.mastery, 0);
  assert.deepEqual(word.tags, []);
  assert.deepEqual(word.source, { bookId: 'bk_1', bookTitle: 'A Book', chapterTitle: 'Chapter 1' });
  assert.equal(word.srs.interval, 0);
  assert.equal(word.srs.ease, 2.5);
  assert.equal(word.srs.reps, 0);
  assert.equal(word.srs.lapses, 0);
  assert.ok(typeof word.id === 'string' && word.id.length > 0);
  assert.ok(!Number.isNaN(Date.parse(word.srs.due)));
  assert.ok(!Number.isNaN(Date.parse(word.createdAt)));
});

test('vocab: 按 normalized 去重并补齐空字段', function (t) {
  const ctx = makeService(t);
  const first = ctx.service.add({ word: 'Serendipity' });
  const second = ctx.service.add({ word: 'serendipity.', translation: '意外发现', tags: ['核心'] });
  assert.equal(second.duplicate, true);
  assert.equal(second.word.id, first.word.id);
  assert.equal(second.word.translation, '意外发现');
  assert.deepEqual(second.word.tags, ['核心']);
  assert.equal(ctx.service.list().length, 1);
});

test('vocab: list 过滤与排序', function (t) {
  const ctx = makeService(t);
  ctx.service.add({ word: 'banana', translation: '香蕉' });
  ctx.service.add({ word: 'Apple', translation: '苹果' });
  ctx.service.add({ word: 'cherry', translation: '樱桃' });

  assert.equal(ctx.service.list({ query: 'app' }).length, 1);
  assert.deepEqual(ctx.service.list({ sort: 'alpha' }).map(function (w) { return w.word; }), ['Apple', 'banana', 'cherry']);
  assert.equal(ctx.service.list({ mastery: 0 }).length, 3);
  ctx.service.list().forEach(function (word) {
    assert.ok(word.normalized);
  });
});

test('vocab: SRS 四档评分', function (t) {
  const ctx = makeService(t);
  const again = ctx.service.review(ctx.service.add({ word: 'again-word' }).word.id, 'again');
  assert.equal(again.srs.reps, 1);
  assert.equal(again.srs.lapses, 1);
  assert.equal(again.mastery, 0);
  near(again.srs.ease, 2.35, 1e-9);
  near(again.srs.interval, 10 / (24 * 60), 1e-6);
  near(Date.parse(again.srs.due), Date.now() + 10 * 60 * 1000, 2 * 60 * 1000);

  const hard = ctx.service.review(ctx.service.add({ word: 'hard-word' }).word.id, 'hard');
  assert.equal(hard.srs.interval, 1);
  near(hard.srs.ease, 2.35, 1e-9);
  assert.equal(hard.mastery, 0);
  near(Date.parse(hard.srs.due), Date.now() + DAY_MS, 5 * 60 * 1000);

  const goodWord = ctx.service.add({ word: 'good-word' }).word;
  const good = ctx.service.review(goodWord.id, 'good');
  assert.equal(good.srs.interval, 1);
  near(good.srs.ease, 2.5, 1e-9);
  assert.equal(good.mastery, 1);
  const good2 = ctx.service.review(goodWord.id, 'good');
  assert.equal(good2.srs.interval, 2.5);
  assert.equal(good2.mastery, 2);

  const easy = ctx.service.review(ctx.service.add({ word: 'easy-word' }).word.id, 'easy');
  assert.equal(easy.srs.interval, 2);
  near(easy.srs.ease, 2.65, 1e-9);
  assert.equal(easy.mastery, 2);
});

test('vocab: mastery 上限 5，ease 范围限制', function (t) {
  const ctx = makeService(t);
  const word = ctx.service.add({ word: 'clamp-me' }).word;
  let current = word;
  for (let i = 0; i < 5; i += 1) current = ctx.service.review(current.id, 'easy');
  assert.equal(current.mastery, 5);
  for (let i = 0; i < 10; i += 1) current = ctx.service.review(current.id, 'again');
  assert.equal(current.mastery, 0);
  assert.ok(current.srs.ease >= 1.3);
});

test('vocab: due 排序与 limit', function (t) {
  const ctx = makeService(t);
  const first = ctx.service.add({ word: 'first-due' }).word;
  ctx.service.add({ word: 'second-due' });
  ctx.service.review(first.id, 'again');
  const dueWords = ctx.service.due();
  assert.equal(dueWords.length, 1, 'only the un-reviewed word is due now');
  assert.equal(dueWords[0].word, 'second-due');

  for (let i = 0; i < 25; i += 1) ctx.service.add({ word: 'bulk-' + i });
  assert.equal(ctx.service.due().length, 20);
  assert.equal(ctx.service.due(5).length, 5);
});

test('vocab: stats 与统计口径', function (t) {
  const ctx = makeService(t);
  const a = ctx.service.add({ word: 'stats-a' }).word;
  const b = ctx.service.add({ word: 'stats-b' }).word;
  const c = ctx.service.add({ word: 'stats-c' }).word;
  ctx.service.review(a.id, 'good');
  ctx.service.review(a.id, 'good');
  ctx.service.review(a.id, 'good');
  ctx.service.review(a.id, 'good');
  ctx.service.review(b.id, 'good');
  ctx.service.review(b.id, 'again');
  ctx.service.review(c.id, 'easy');
  const stats = ctx.service.stats();
  assert.equal(stats.total, 3);
  assert.equal(stats.reviewedToday, 7);
  assert.equal(stats.addedToday, 3);
  assert.equal(stats.new, 1);
  assert.equal(stats.learning, 1);
  assert.equal(stats.mastered, 1);
  assert.equal(typeof stats.due, 'number');
  assert.equal(stats.streak, 1);
});

test('vocab: update / remove / isSaved', function (t) {
  const ctx = makeService(t);
  const word = ctx.service.add({ word: 'UpdateMe' }).word;
  const updated = ctx.service.update(word.id, { translation: '更新', note: '备注', tags: ['x', 'x', 'y'], mastery: 9 });
  assert.equal(updated.translation, '更新');
  assert.equal(updated.note, '备注');
  assert.deepEqual(updated.tags, ['x', 'y']);
  assert.equal(updated.mastery, 5);

  const saved = ctx.service.isSaved('updateme.');
  assert.equal(saved.id, word.id);
  assert.equal(ctx.service.isSaved('missing'), null);

  ctx.service.remove(word.id);
  assert.equal(ctx.service.list().length, 0);
  assert.throws(function () { ctx.service.remove(word.id); }, function (err) { return err.code === 'NOT_FOUND'; });
});

test('vocab: CSV 导出（UTF-8 BOM 中文表头）', function (t) {
  const ctx = makeService(t);
  ctx.service.add({
    word: 'comma,word',
    phonetic: '/a,b/',
    translation: '含逗号, 和 "引号"',
    context: 'Some "quoted" context, with comma.',
    source: { bookId: 'bk', bookTitle: 'Book', chapterTitle: 'Ch 1' },
    tags: ['tag'],
  });
  const result = ctx.service.exportCsv();
  assert.equal(result.saved, true);
  assert.ok(fs.existsSync(result.path));
  const content = fs.readFileSync(result.path, 'utf8');
  assert.ok(content.charCodeAt(0) === 0xfeff, 'CSV 应带 UTF-8 BOM');
  assert.ok(content.indexOf('单词,音标,释义') !== -1);
  assert.ok(content.indexOf('"comma,word"') !== -1);
  assert.ok(content.indexOf('"含逗号, 和 ""引号"""') !== -1);
  assert.ok(content.indexOf('"Some ""quoted"" context, with comma."') !== -1);

  const target = path.join(ctx.dataDir, 'custom.csv');
  const custom = ctx.service.exportCsv(target);
  assert.equal(custom.saved, true);
  assert.equal(custom.path, target);
  assert.ok(fs.readFileSync(target, 'utf8').indexOf('单词') !== -1);
});

test('vocab: 数据持久化', function (t) {
  const ctx = makeService(t);
  ctx.service.add({ word: 'persist-me', translation: '持久化' });
  const reopened = createVocabService({ dataDir: ctx.dataDir });
  const words = reopened.list();
  assert.equal(words.length, 1);
  assert.equal(words[0].translation, '持久化');
});
