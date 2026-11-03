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

test('vocab: Ebbinghaus 四档评分（stage/interval/due/srs 同步）', function (t) {
  const ctx = makeService(t);
  const HOUR_MS = 60 * 60 * 1000;

  const again = ctx.service.review(ctx.service.add({ word: 'again-word' }).word.id, 'again');
  assert.equal(again.memory.stage, 0);
  assert.equal(again.memory.intervalHours, 1 / 12);
  assert.equal(again.memory.lastRating, 'again');
  assert.equal(again.memory.lapses, 1);
  assert.equal(again.memory.history.length, 1);
  assert.deepEqual(again.memory.history[0].rating, 'again');
  assert.equal(again.srs.reps, 1);
  assert.equal(again.srs.lapses, 1);
  assert.equal(again.mastery, 0);
  near(again.srs.ease, 2.35, 1e-9);
  near(again.srs.interval, (1 / 12) / 24, 1e-6);
  near(Date.parse(again.srs.due), Date.now() + (1 / 12) * HOUR_MS, 2 * 60 * 1000);
  assert.equal(again.srs.due, again.memory.due, 'srs.due 必须与 memory.due 同步');

  const hard = ctx.service.review(ctx.service.add({ word: 'hard-word' }).word.id, 'hard');
  assert.equal(hard.memory.stage, 0);
  assert.equal(hard.memory.intervalHours, 1 / 12);
  near(hard.srs.ease, 2.35, 1e-9);
  assert.equal(hard.mastery, 0);
  near(Date.parse(hard.srs.due), Date.now() + (1 / 12) * HOUR_MS, 2 * 60 * 1000);

  const goodWord = ctx.service.add({ word: 'good-word' }).word;
  const good = ctx.service.review(goodWord.id, 'good');
  assert.equal(good.memory.stage, 1);
  assert.equal(good.memory.intervalHours, 0.5);
  near(good.srs.interval, 0.5 / 24, 1e-6);
  near(good.srs.ease, 2.5, 1e-9);
  assert.equal(good.mastery, 1);
  near(Date.parse(good.srs.due), Date.now() + 0.5 * HOUR_MS, 2 * 60 * 1000);

  const good2 = ctx.service.review(goodWord.id, 'good');
  assert.equal(good2.memory.stage, 2);
  assert.equal(good2.memory.intervalHours, 12);
  near(good2.srs.interval, 0.5, 1e-6);
  assert.equal(good2.mastery, 2);
  assert.equal(good2.memory.history.length, 2);

  const easy = ctx.service.review(ctx.service.add({ word: 'easy-word' }).word.id, 'easy');
  assert.equal(easy.memory.stage, 2);
  assert.equal(easy.memory.intervalHours, 12);
  near(easy.srs.interval, 0.5, 1e-6);
  near(easy.srs.ease, 2.65, 1e-9);
  assert.equal(easy.mastery, 2);
  near(Date.parse(easy.srs.due), Date.now() + 12 * HOUR_MS, 5 * 60 * 1000);
});

test('vocab: Ebbinghaus 评分在已有阶段上的升降级', function (t) {
  const ctx = makeService(t);
  const word = ctx.service.add({ word: 'stage-walk' }).word;
  for (let i = 0; i < 3; i += 1) ctx.service.review(word.id, 'good');
  assert.equal(ctx.service.isSaved('stage-walk').memory.stage, 3);

  const hard = ctx.service.review(word.id, 'hard');
  assert.equal(hard.memory.stage, 2);
  assert.equal(hard.memory.intervalHours, 12);

  const good = ctx.service.review(word.id, 'good');
  assert.equal(good.memory.stage, 3);
  assert.equal(good.memory.intervalHours, 24);

  const easy = ctx.service.review(word.id, 'easy');
  assert.equal(easy.memory.stage, 5);
  assert.equal(easy.memory.intervalHours, 96);

  const again = ctx.service.review(word.id, 'again');
  assert.equal(again.memory.stage, 0);
  assert.equal(again.memory.intervalHours, 1 / 12);
  assert.equal(again.memory.lapses, 1);
  assert.deepEqual(again.memory.history.map(function (item) { return item.rating; }), ['good', 'good', 'good', 'hard', 'good', 'easy', 'again']);
});

test('vocab: Ebbinghaus 阶段上限 10，history 保留最近 30 条', function (t) {
  const ctx = makeService(t);
  const word = ctx.service.add({ word: 'max-stage' }).word;
  let current = null;
  for (let i = 0; i < 35; i += 1) current = ctx.service.review(word.id, 'easy');
  assert.equal(current.memory.stage, 10);
  assert.equal(current.memory.intervalHours, 2880);
  assert.equal(current.srs.interval, 2880 / 24);
  const persisted = ctx.service.isSaved('max-stage');
  assert.equal(persisted.memory.stage, 10);
  assert.equal(persisted.memory.history.length, 30);
  assert.equal(persisted.memory.history[29].stage, 10);
  assert.ok(!Number.isNaN(Date.parse(persisted.memory.due)));
});

test('vocab: 新记录默认 memory 结构与 srs.due 同步', function (t) {
  const ctx = makeService(t);
  const word = ctx.service.add({ word: 'memory-default' }).word;
  assert.equal(word.memory.stage, 0);
  assert.equal(word.memory.intervalHours, 1 / 12);
  assert.equal(word.memory.lapses, 0);
  assert.deepEqual(word.memory.history, []);
  assert.equal(word.memory.lastRating, undefined);
  assert.equal(word.srs.interval, 0);
  assert.equal(word.srs.due, word.memory.due);
  assert.ok(!Number.isNaN(Date.parse(word.memory.due)));
});

test('vocab: 旧数据迁移（无 memory 时按 mastery/reps 估算 stage，due 保持）', function (t) {
  const ctx = makeService(t);
  const due = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const legacy = {
    words: [
      {
        id: 'v_legacy_1',
        word: 'legacy',
        normalized: 'legacy',
        translation: '旧词',
        createdAt: new Date(Date.now() - DAY_MS).toISOString(),
        updatedAt: new Date().toISOString(),
        srs: { due: due, interval: 2, ease: 2.5, reps: 4, lapses: 1 },
        mastery: 3,
      },
      {
        id: 'v_legacy_2',
        word: 'fresh',
        normalized: 'fresh',
        translation: '新词',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        srs: { due: new Date().toISOString(), interval: 0, ease: 2.5, reps: 0, lapses: 0 },
        mastery: 0,
      },
    ],
    reviewDays: {},
  };
  fs.writeFileSync(path.join(ctx.dataDir, 'vocab.json'), JSON.stringify(legacy), 'utf8');

  const words = ctx.service.list({ sort: 'alpha' });
  assert.equal(words.length, 2);
  const migrated = words.find(function (item) { return item.normalized === 'legacy'; });
  assert.equal(migrated.memory.stage, 6);
  assert.equal(migrated.memory.intervalHours, 168);
  assert.equal(migrated.memory.due, due, '迁移时 due 必须保持');
  assert.equal(migrated.srs.due, due);
  assert.equal(migrated.memory.lapses, 1);
  assert.deepEqual(migrated.memory.history, []);

  const fresh = words.find(function (item) { return item.normalized === 'fresh'; });
  assert.equal(fresh.memory.stage, 0);
  assert.equal(fresh.memory.intervalHours, 1 / 12);

  const reviewed = ctx.service.review('v_legacy_1', 'again');
  assert.equal(reviewed.memory.stage, 0);
  assert.equal(reviewed.memory.lapses, 2);
  assert.equal(reviewed.srs.lapses, 2);
});

test('vocab: schedule 返回完整艾宾浩斯间隔', function (t) {
  const ctx = makeService(t);
  const schedule = ctx.service.schedule();
  assert.equal(schedule.maxStage, 10);
  assert.equal(schedule.intervals.length, 11);
  assert.deepEqual(schedule.intervals.map(function (item) { return item.stage; }), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(schedule.intervals.map(function (item) { return item.hours; }), [1 / 12, 0.5, 12, 24, 48, 96, 168, 360, 720, 1440, 2880]);
  assert.deepEqual(schedule.intervals.map(function (item) { return item.label; }), ['5分钟', '30分钟', '12小时', '1天', '2天', '4天', '7天', '15天', '30天', '60天', '120天']);
});

test('vocab: stats 增加 stages 分布且总和等于 total', function (t) {
  const ctx = makeService(t);
  const a = ctx.service.add({ word: 'stage-a' }).word;
  const b = ctx.service.add({ word: 'stage-b' }).word;
  ctx.service.add({ word: 'stage-c' });
  ctx.service.review(a.id, 'good');
  ctx.service.review(b.id, 'easy');
  const stats = ctx.service.stats();
  assert.equal(stats.stages.length, 11);
  assert.equal(stats.stages[0], 1);
  assert.equal(stats.stages[1], 1);
  assert.equal(stats.stages[2], 1);
  assert.equal(stats.stages.reduce(function (sum, count) { return sum + count; }, 0), stats.total);
  assert.equal(stats.total, 3);
});

test('vocab: 保留并持久化 mnemonic / associations / lexicon', function (t) {
  const ctx = makeService(t);
  const added = ctx.service.add({
    word: 'spectator',
    translation: '观众',
    mnemonic: 'spect 看 + ator 人',
    associations: ['聚光灯', '聚光灯', '看台'],
    lexicon: {
      word: 'spectator',
      breakdown: 'spect（看） + -ator（人）',
      parts: [
        { text: 'spect', type: 'root', meaning: '看' },
        { text: '-ator', type: 'suffix', meaning: '人' },
        { text: '', type: 'root', meaning: '空文本过滤' },
      ],
      related: ['inspect', 'respect'],
      source: 'local',
    },
  }).word;
  assert.equal(added.mnemonic, 'spect 看 + ator 人');
  assert.deepEqual(added.associations, ['聚光灯', '看台']);
  assert.equal(added.lexicon.breakdown, 'spect（看） + -ator（人）');
  assert.equal(added.lexicon.parts.length, 2);
  assert.equal(added.lexicon.source, 'local');

  const updated = ctx.service.update(added.id, {
    mnemonic: '换成新的联想',
    associations: ['新联想'],
    lexicon: { word: 'spectator', breakdown: 'spect（看）', parts: [{ text: 'spect', type: 'root', meaning: '看' }], related: [] },
  });
  assert.equal(updated.mnemonic, '换成新的联想');
  assert.deepEqual(updated.associations, ['新联想']);
  assert.equal(updated.lexicon.breakdown, 'spect（看）');

  const reopened = createVocabService({ dataDir: ctx.dataDir });
  const persisted = reopened.isSaved('spectator');
  assert.equal(persisted.mnemonic, '换成新的联想');
  assert.deepEqual(persisted.associations, ['新联想']);
  assert.equal(persisted.lexicon.parts[0].meaning, '看');

  const cleared = reopened.update(persisted.id, { mnemonic: '', associations: [], lexicon: null });
  assert.equal(cleared.mnemonic, undefined);
  assert.equal(cleared.associations, undefined);
  assert.equal(cleared.lexicon, undefined);
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
