'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeTempDir, cleanupDir } = require('./helpers');
const { createStatsService, localDateKey } = require('../src/main/services/stats');

const DAY_MS = 24 * 60 * 60 * 1000;

function makeService(t, deps) {
  const dataDir = makeTempDir('lumen-stats');
  t.after(function () { cleanupDir(dataDir); });
  const service = createStatsService(Object.assign({ dataDir: dataDir }, deps || {}));
  return { service: service, dataDir: dataDir };
}

function dateKeyOffset(offsetDays) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return localDateKey(date);
}

test('stats: record 同日幂等合并', function (t) {
  const ctx = makeService(t);
  ctx.service.record({ type: 'read', minutes: 5, words: 100 });
  ctx.service.record({ type: 'read', minutes: 7.5, words: 50 });
  ctx.service.record({ type: 'lookup', count: 3 });
  ctx.service.record({ type: 'review' });
  ctx.service.record({ type: 'lookup', added: 2 });

  const overview = ctx.service.overview();
  assert.equal(overview.today.minutes, 12.5);
  assert.equal(overview.today.words, 150);
  assert.equal(overview.today.lookups, 4);
  assert.equal(overview.today.reviews, 1);
  assert.equal(overview.today.added, 2);
  assert.equal(overview.totals.minutes, 12.5);
  assert.equal(overview.totals.words, 150);
  assert.equal(overview.totals.lookups, 4);
  assert.equal(overview.totals.reviews, 1);
  assert.equal(overview.daysRead, 1);
  assert.equal(overview.streak, 1);
});

test('stats: 仅 lookup 的日期不计入 daysRead', function (t) {
  const ctx = makeService(t);
  ctx.service.record({ type: 'lookup', count: 5 });
  assert.equal(ctx.service.overview().daysRead, 0);
  ctx.service.record({ type: 'read', minutes: 1 });
  assert.equal(ctx.service.overview().daysRead, 1);
});

test('stats: streak 今天无活动从昨天算', function (t) {
  const ctx = makeService(t);
  ctx.service.record({ type: 'read', date: dateKeyOffset(-2), minutes: 10 });
  ctx.service.record({ type: 'read', date: dateKeyOffset(-1), minutes: 10 });
  const overview = ctx.service.overview();
  assert.equal(overview.streak, 2);
  assert.equal(overview.today.minutes, 0);

  ctx.service.record({ type: 'read', minutes: 3 });
  assert.equal(ctx.service.overview().streak, 3);
});

test('stats: streak 有断档时为 0', function (t) {
  const ctx = makeService(t);
  ctx.service.record({ type: 'read', date: dateKeyOffset(-3), minutes: 10 });
  assert.equal(ctx.service.overview().streak, 0);
});

test('stats: 可选 date 补录', function (t) {
  const ctx = makeService(t);
  const past = dateKeyOffset(-10);
  ctx.service.record({ type: 'read', date: past, minutes: 8, words: 200 });
  const overview = ctx.service.overview();
  assert.equal(overview.totals.minutes, 8);
  assert.equal(overview.totals.words, 200);
  assert.equal(overview.daysRead, 1);
  assert.equal(overview.today.minutes, 0);

  // 非法 date 回退为今天
  ctx.service.record({ type: 'read', date: 'not-a-date', minutes: 2 });
  assert.equal(ctx.service.overview().today.minutes, 2);
});

test('stats: weekly / heatmap 结构', function (t) {
  const ctx = makeService(t);
  ctx.service.record({ type: 'read', minutes: 4, words: 80 });
  ctx.service.record({ type: 'lookup', count: 2 });
  const overview = ctx.service.overview();
  assert.equal(overview.weekly.length, 7);
  const today = localDateKey(new Date());
  assert.equal(overview.weekly[6].date, today);
  assert.equal(overview.weekly[6].minutes, 4);
  assert.equal(overview.weekly[6].words, 80);
  assert.equal(overview.weekly[6].lookups, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(overview.weekly[0], 'date'), true);

  assert.equal(overview.heatmap.length, 84);
  assert.equal(overview.heatmap[83].date, today);
  assert.deepEqual(Object.keys(overview.heatmap[0]).sort(), ['date', 'minutes', 'words']);

  const week = ctx.service.heatmap(7);
  assert.equal(week.length, 7);
  assert.equal(week[6].date, today);
  assert.equal(week[6].minutes, 4);
  assert.equal(ctx.service.heatmap(0).length, 84);
});

test('stats: 注入 vocab / settings 后的 overview 合并字段', function (t) {
  const vocabStats = { total: 12, due: 3, learning: 4, mastered: 2, new: 6, reviewedToday: 5, addedToday: 2, streak: 4 };
  const ctx = makeService(t, {
    vocab: { stats: function () { return Object.assign({}, vocabStats); } },
    settings: { get: function () { return { general: { dailyGoalMinutes: 45 } }; } },
  });
  const overview = ctx.service.overview();
  assert.deepEqual(overview.vocab, { total: 12, due: 3, learning: 4, mastered: 2, new: 6 });
  assert.deepEqual(overview.mastery, { new: 6, learning: 4, mastered: 2 });
  assert.deepEqual(overview.goal, { minutes: 45 });
});

test('stats: 数据持久化', function (t) {
  const ctx = makeService(t);
  ctx.service.record({ type: 'read', minutes: 6, words: 60 });
  const reopened = createStatsService({ dataDir: ctx.dataDir });
  const overview = reopened.overview();
  assert.equal(overview.today.minutes, 6);
  assert.equal(overview.today.words, 60);
  assert.equal(overview.daysRead, 1);
});
