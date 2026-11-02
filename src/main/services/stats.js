'use strict';

// stats.js — 阅读足迹统计
// 按本地日期 YYYY-MM-DD 聚合；record 幂等合并同日数据；支持补录 date。
// overview 返回契约 5.1 的 StatsOverview 基础字段；vocab / goal 由主进程合并，
// 若注入 vocab / settings 服务则这里直接合并，便于单测与独立使用。

const path = require('node:path');
const { createJsonStore } = require('./store');

const DEFAULT_HEATMAP_DAYS = 84;
const MAX_HEATMAP_DAYS = 366;

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

function localDateKey(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  return value.getFullYear() + '-' + pad2(value.getMonth() + 1) + '-' + pad2(value.getDate());
}

function isDateKey(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function roundMinutes(value) {
  return Math.round(Math.max(0, value) * 100) / 100;
}

function emptyDay(date) {
  return { date: date, minutes: 0, words: 0, lookups: 0, reviews: 0, added: 0, reads: 0 };
}

function normalizeDay(raw, date) {
  const day = emptyDay(date);
  if (!raw || typeof raw !== 'object') return day;
  day.minutes = roundMinutes(toNumber(raw.minutes));
  day.words = Math.max(0, Math.round(toNumber(raw.words)));
  day.lookups = Math.max(0, Math.round(toNumber(raw.lookups)));
  day.reviews = Math.max(0, Math.round(toNumber(raw.reviews)));
  day.added = Math.max(0, Math.round(toNumber(raw.added)));
  day.reads = Math.max(0, Math.round(toNumber(raw.reads)));
  return day;
}

function publicToday(day) {
  return { minutes: day.minutes, words: day.words, lookups: day.lookups, reviews: day.reviews, added: day.added };
}

function hasActivity(day) {
  return day.minutes > 0 || day.words > 0 || day.lookups > 0 || day.reviews > 0 || day.added > 0 || day.reads > 0;
}

function hasReading(day) {
  return day.minutes > 0 || day.words > 0 || day.reads > 0;
}

// 从今天（若无活动则从昨天）向前数连续有活动的天数。
function computeStreak(days, now) {
  const get = function (key) { return normalizeDay(days[key], key); };
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!hasActivity(get(localDateKey(cursor)))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (hasActivity(get(localDateKey(cursor)))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function createStatsService(options) {
  const opts = options || {};
  const dataDir = opts.dataDir;
  if (!dataDir) throw new TypeError('createStatsService 需要 dataDir');
  const store = opts.store || createJsonStore({
    filePath: path.join(dataDir, 'stats.json'),
    defaults: function () { return { days: {} }; },
  });
  const vocabService = opts.vocab || null;
  const settingsService = opts.settings || null;

  function readData() {
    let data = store.read();
    if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
    if (!data.days || typeof data.days !== 'object' || Array.isArray(data.days)) data.days = {};
    return data;
  }

  function record(input) {
    const payload = input && typeof input === 'object' ? input : {};
    const type = ['lookup', 'review', 'read'].indexOf(payload.type) === -1 ? 'read' : payload.type;
    const dateKey = isDateKey(payload.date) ? payload.date : localDateKey(new Date());
    const data = readData();
    const day = normalizeDay(data.days[dateKey], dateKey);

    day.minutes = roundMinutes(day.minutes + Math.max(0, toNumber(payload.minutes)));
    day.words += Math.max(0, Math.round(toNumber(payload.words)));
    const count = Math.max(1, Math.round(toNumber(payload.count) || 1));
    if (type === 'lookup') day.lookups += count;
    else if (type === 'review') day.reviews += count;
    else day.reads += count;
    if (payload.added !== undefined) day.added += Math.max(0, Math.round(toNumber(payload.added)));

    data.days[dateKey] = day;
    store.write(data);
    return publicToday(day);
  }

  function lastNDays(now, days) {
    const output = [];
    const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    cursor.setDate(cursor.getDate() - (days - 1));
    for (let i = 0; i < days; i += 1) {
      output.push(localDateKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return output;
  }

  function readVocabStats() {
    try {
      if (vocabService && typeof vocabService.stats === 'function') return vocabService.stats();
    } catch (err) {
      // 生词数据异常时返回空统计
    }
    return null;
  }

  function readGoalMinutes() {
    try {
      if (settingsService && typeof settingsService.get === 'function') {
        const settings = settingsService.get();
        const minutes = Number(settings && settings.general && settings.general.dailyGoalMinutes);
        if (Number.isFinite(minutes) && minutes > 0) return minutes;
      }
    } catch (err) {
      // 忽略
    }
    return 20;
  }

  function overview() {
    const data = readData();
    const now = new Date();
    const todayKey = localDateKey(now);
    const today = publicToday(normalizeDay(data.days[todayKey], todayKey));

    const totals = { minutes: 0, words: 0, lookups: 0, reviews: 0 };
    let daysRead = 0;
    for (const date of Object.keys(data.days)) {
      const day = normalizeDay(data.days[date], date);
      totals.minutes = roundMinutes(totals.minutes + day.minutes);
      totals.words += day.words;
      totals.lookups += day.lookups;
      totals.reviews += day.reviews;
      if (hasReading(day)) daysRead += 1;
    }

    const weekly = lastNDays(now, 7).map(function (date) {
      const day = normalizeDay(data.days[date], date);
      return { date: date, minutes: day.minutes, words: day.words, lookups: day.lookups };
    });
    const heatmap = lastNDays(now, DEFAULT_HEATMAP_DAYS).map(function (date) {
      const day = normalizeDay(data.days[date], date);
      return { date: date, minutes: day.minutes, words: day.words };
    });

    const vocabStats = readVocabStats();
    const vocab = vocabStats
      ? {
        total: vocabStats.total || 0,
        due: vocabStats.due || 0,
        learning: vocabStats.learning || 0,
        mastered: vocabStats.mastered || 0,
        new: vocabStats.new || 0,
      }
      : { total: 0, due: 0, learning: 0, mastered: 0, new: 0 };
    const mastery = { new: vocab.new, learning: vocab.learning, mastered: vocab.mastered };

    return {
      today: today,
      totals: totals,
      streak: computeStreak(data.days, now),
      weekly: weekly,
      heatmap: heatmap,
      daysRead: daysRead,
      vocab: vocab,
      mastery: mastery,
      goal: { minutes: readGoalMinutes() },
    };
  }

  function heatmap(days) {
    const count = Math.min(MAX_HEATMAP_DAYS, Math.max(1, Math.round(toNumber(days) || DEFAULT_HEATMAP_DAYS)));
    const data = readData();
    const now = new Date();
    return lastNDays(now, count).map(function (date) {
      const day = normalizeDay(data.days[date], date);
      return { date: date, minutes: day.minutes, words: day.words };
    });
  }

  return { overview: overview, record: record, heatmap: heatmap, dataDir: dataDir };
}

module.exports = { createStatsService, localDateKey };
