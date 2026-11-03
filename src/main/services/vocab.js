'use strict';

// vocab.js — 生词本 + SRS（间隔重复）
// rating：again = 10 分钟；hard = 1 天；good = 2.5×；easy = 4×
// ease 初始 2.5（±0.15，范围 1.3–3.5）；mastery 0–5
// 纯 Node，数据保存在 dataDir/vocab.json（原子写）。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createJsonStore, writeFileAtomic } = require('./store');

const RATINGS = ['again', 'hard', 'good', 'easy'];
const MASTERY_MAX = 5;
const EASE_MIN = 1.3;
const EASE_MAX = 3.5;
const HOUR_MS = 60 * 60 * 1000;

// 艾宾浩斯阶段（小时）：5 分钟、30 分钟、12 小时、1 天、2 天、4 天、7 天、15 天、30 天、60 天、120 天
const EBBINGHAUS_INTERVALS = [1 / 12, 0.5, 12, 24, 48, 96, 168, 360, 720, 1440, 2880];
const EBBINGHAUS_LABELS = ['5分钟', '30分钟', '12小时', '1天', '2天', '4天', '7天', '15天', '30天', '60天', '120天'];
const MAX_STAGE = EBBINGHAUS_INTERVALS.length - 1;
const HISTORY_LIMIT = 30;

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

function localDateKey(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  return value.getFullYear() + '-' + pad2(value.getMonth() + 1) + '-' + pad2(value.getDate());
}

function roundTo(value, digits) {
  const factor = Math.pow(10, digits || 0);
  return Math.round(value * factor) / factor;
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function randomId() {
  return 'v_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function normalizeWord(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s"'\u201c\u201d\u2018\u2019(\[{<\u00ab]+/, '')
    .replace(/[\s"'\u201c\u201d\u2018\u2019)\]}>.,;:!?\u3002\uff0c\uff1b\uff1a\uff01\uff1f\u00bb]+$/, '')
    .toLowerCase();
}

function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const output = [];
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const value = tag.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function cleanStringArray(list, limit) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const output = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const value = item.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (limit && output.length >= limit) break;
  }
  return output;
}

function sanitizeMemoryHistory(history) {
  if (!Array.isArray(history)) return [];
  const output = [];
  for (const entry of history) {
    if (!entry || typeof entry !== 'object') continue;
    const at = typeof entry.at === 'string' ? entry.at : '';
    if (!at || Number.isNaN(Date.parse(at))) continue;
    const rating = RATINGS.indexOf(entry.rating) === -1 ? '' : entry.rating;
    if (!rating) continue;
    const stage = Math.round(clampNumber(entry.stage, 0, MAX_STAGE, 0));
    output.push({
      at: at,
      rating: rating,
      stage: stage,
      intervalHours: clampNumber(entry.intervalHours, 0, EBBINGHAUS_INTERVALS[MAX_STAGE], EBBINGHAUS_INTERVALS[stage]),
    });
  }
  return output.slice(-HISTORY_LIMIT);
}

function estimateStage(mastery, reps) {
  const byReps = Math.min(MAX_STAGE, Math.max(0, Math.round(clampNumber(reps, 0, 100000, 0))));
  const byMastery = Math.min(MAX_STAGE, Math.max(0, Math.round(clampNumber(mastery, 0, MASTERY_MAX, 0) * 2)));
  return Math.max(byReps, byMastery);
}

function normalizeMemory(raw, srs, mastery, createdAt) {
  const source = raw && typeof raw === 'object' ? raw : null;
  if (!source) {
    // 旧数据迁移：按 srs.reps/mastery 估算 stage，due 保持
    const stage = estimateStage(mastery, srs.reps);
    return {
      stage: stage,
      intervalHours: EBBINGHAUS_INTERVALS[stage],
      due: srs.due || createdAt,
      lapses: srs.lapses,
      history: [],
    };
  }
  const stage = Math.round(clampNumber(source.stage, 0, MAX_STAGE, estimateStage(mastery, srs.reps)));
  const intervalHours = clampNumber(source.intervalHours, 0, EBBINGHAUS_INTERVALS[MAX_STAGE], EBBINGHAUS_INTERVALS[stage]);
  const due = typeof source.due === 'string' && !Number.isNaN(Date.parse(source.due)) ? source.due : (srs.due || createdAt);
  const memory = {
    stage: stage,
    intervalHours: intervalHours || EBBINGHAUS_INTERVALS[stage],
    due: due,
    lapses: Math.max(0, Math.round(clampNumber(source.lapses, 0, 100000, srs.lapses))),
    history: sanitizeMemoryHistory(source.history),
  };
  const lastRating = RATINGS.indexOf(source.lastRating) === -1 ? '' : source.lastRating;
  if (lastRating) memory.lastRating = lastRating;
  return memory;
}

function normalizeLexicon(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const parts = (Array.isArray(raw.parts) ? raw.parts : []).map(function (part) {
    if (!part || typeof part !== 'object') return null;
    const text = typeof part.text === 'string' ? part.text.trim() : '';
    if (!text) return null;
    const type = ['prefix', 'root', 'suffix'].indexOf(part.type) === -1 ? 'root' : part.type;
    const item = {
      text: text,
      type: type,
      meaning: typeof part.meaning === 'string' ? part.meaning.trim() : '',
    };
    if (typeof part.note === 'string' && part.note.trim()) item.note = part.note.trim();
    return item;
  }).filter(Boolean);
  const word = typeof raw.word === 'string' ? raw.word.trim() : '';
  const breakdown = typeof raw.breakdown === 'string' ? raw.breakdown.trim() : '';
  const related = cleanStringArray(raw.related, 12);
  if (!word && !breakdown && !parts.length && !related.length) return undefined;
  return {
    word: word,
    breakdown: breakdown,
    parts: parts,
    related: related,
    source: 'local',
  };
}

function sanitizeSource(source) {
  if (!source || typeof source !== 'object') return {};
  const output = {};
  for (const key of ['bookId', 'bookTitle', 'chapterTitle']) {
    if (typeof source[key] === 'string' && source[key].trim()) output[key] = source[key].trim();
  }
  return output;
}

function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const word = typeof raw.word === 'string' ? raw.word.trim() : '';
  if (!word) return null;
  const normalized = typeof raw.normalized === 'string' && raw.normalized ? raw.normalized : normalizeWord(word);
  if (!normalized) return null;
  const created = typeof raw.createdAt === 'string' ? raw.createdAt : nowIso();
  const srs = raw.srs && typeof raw.srs === 'object' ? raw.srs : {};
  const record = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : randomId(),
    word: word,
    normalized: normalized,
    phonetic: typeof raw.phonetic === 'string' && raw.phonetic.trim() ? raw.phonetic.trim() : undefined,
    translation: typeof raw.translation === 'string' ? raw.translation : '',
    context: typeof raw.context === 'string' ? raw.context : '',
    contextTranslation: typeof raw.contextTranslation === 'string' && raw.contextTranslation ? raw.contextTranslation : undefined,
    source: sanitizeSource(raw.source),
    note: typeof raw.note === 'string' && raw.note ? raw.note : undefined,
    tags: cleanTags(raw.tags),
    createdAt: created,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : created,
    lastReviewedAt: typeof raw.lastReviewedAt === 'string' ? raw.lastReviewedAt : undefined,
    srs: {
      due: typeof srs.due === 'string' ? srs.due : created,
      interval: clampNumber(srs.interval, 0, 36500, 0),
      ease: clampNumber(srs.ease, EASE_MIN, EASE_MAX, 2.5),
      reps: Math.max(0, Math.round(clampNumber(srs.reps, 0, 100000, 0))),
      lapses: Math.max(0, Math.round(clampNumber(srs.lapses, 0, 100000, 0))),
    },
    mastery: Math.round(clampNumber(raw.mastery, 0, MASTERY_MAX, 0)),
  };
  record.memory = normalizeMemory(raw.memory, record.srs, record.mastery, created);
  record.srs.due = record.memory.due;
  const mnemonic = typeof raw.mnemonic === 'string' ? raw.mnemonic.trim() : '';
  if (mnemonic) record.mnemonic = mnemonic;
  const associations = cleanStringArray(raw.associations, 8);
  if (associations.length) record.associations = associations;
  const lexicon = normalizeLexicon(raw.lexicon);
  if (lexicon) record.lexicon = lexicon;
  return record;
}

function computeReviewStreak(reviewDays, now) {
  const has = function (key) { return Number(reviewDays[key]) > 0; };
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (has(localDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function csvCell(value) {
  const text = value === undefined || value === null ? '' : String(value);
  if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function formatDateTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' +
    pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

function sourceLabel(source) {
  if (!source) return '';
  const parts = [source.bookTitle, source.chapterTitle].filter(Boolean);
  return parts.join(' · ');
}

function createVocabService(options) {
  const opts = options || {};
  const dataDir = opts.dataDir;
  if (!dataDir) throw new TypeError('createVocabService 需要 dataDir');
  const store = opts.store || createJsonStore({
    filePath: path.join(dataDir, 'vocab.json'),
    defaults: function () { return { words: [], reviewDays: {} }; },
  });

  function readData() {
    let data = store.read();
    if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
    if (!Array.isArray(data.words)) data.words = [];
    if (!data.reviewDays || typeof data.reviewDays !== 'object' || Array.isArray(data.reviewDays)) data.reviewDays = {};
    data.words = data.words.map(normalizeRecord).filter(Boolean);
    return data;
  }

  function persist(data) {
    store.write({ words: data.words, reviewDays: data.reviewDays });
  }

  function findWord(data, id) {
    const word = data.words.find(function (item) { return item.id === String(id || ''); });
    if (!word) throw fail('NOT_FOUND', '生词不存在');
    return word;
  }

  function list(filter) {
    const opts2 = filter && typeof filter === 'object' ? filter : {};
    let words = readData().words.map(clone);
    const query = typeof opts2.query === 'string' ? opts2.query.trim().toLowerCase() : '';
    if (query) {
      words = words.filter(function (item) {
        const haystack = [item.word, item.normalized, item.translation, item.note, item.context, (item.tags || []).join(' ')].join(' ').toLowerCase();
        return haystack.indexOf(query) !== -1;
      });
    }
    if (typeof opts2.mastery === 'number' && Number.isFinite(opts2.mastery)) {
      words = words.filter(function (item) { return item.mastery === opts2.mastery; });
    }
    const sort = opts2.sort || 'recent';
    if (sort === 'alpha') {
      words.sort(function (a, b) { return a.word.localeCompare(b.word); });
    } else if (sort === 'due') {
      words.sort(function (a, b) { return Date.parse(a.srs.due) - Date.parse(b.srs.due); });
    } else {
      words.sort(function (a, b) {
        return (Date.parse(b.updatedAt || b.createdAt) || 0) - (Date.parse(a.updatedAt || a.createdAt) || 0);
      });
    }
    return words;
  }

  function add(input) {
    const payload = input && typeof input === 'object' ? input : {};
    const rawWord = typeof payload.word === 'string' ? payload.word.trim() : '';
    const normalized = normalizeWord(rawWord);
    if (!normalized) throw fail('INVALID_INPUT', '生词不能为空');

    const data = readData();
    const existing = data.words.find(function (item) { return item.normalized === normalized; });
    if (existing) {
      let touched = false;
      if (!existing.translation && typeof payload.translation === 'string' && payload.translation.trim()) {
        existing.translation = payload.translation.trim();
        touched = true;
      }
      if (!existing.context && typeof payload.context === 'string' && payload.context.trim()) {
        existing.context = payload.context.trim();
        touched = true;
      }
      if (!existing.contextTranslation && typeof payload.contextTranslation === 'string' && payload.contextTranslation.trim()) {
        existing.contextTranslation = payload.contextTranslation.trim();
        touched = true;
      }
      if (!existing.phonetic && typeof payload.phonetic === 'string' && payload.phonetic.trim()) {
        existing.phonetic = payload.phonetic.trim();
        touched = true;
      }
      if (!existing.note && typeof payload.note === 'string' && payload.note.trim()) {
        existing.note = payload.note.trim();
        touched = true;
      }
      const incomingSource = sanitizeSource(payload.source);
      for (const key of Object.keys(incomingSource)) {
        if (!existing.source[key]) {
          existing.source[key] = incomingSource[key];
          touched = true;
        }
      }
      if (Array.isArray(payload.tags) && payload.tags.length) {
        const merged = cleanTags(existing.tags.concat(payload.tags));
        if (merged.length !== existing.tags.length) {
          existing.tags = merged;
          touched = true;
        }
      }
      if (touched) {
        existing.updatedAt = nowIso();
        persist(data);
      }
      return { word: clone(existing), duplicate: true };
    }

    const record = normalizeRecord({
      word: rawWord,
      normalized: normalized,
      phonetic: payload.phonetic,
      translation: payload.translation,
      context: payload.context,
      contextTranslation: payload.contextTranslation,
      source: sanitizeSource(payload.source),
      note: payload.note,
      tags: payload.tags,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      srs: { due: nowIso(), interval: 0, ease: 2.5, reps: 0, lapses: 0 },
      mastery: 0,
      mnemonic: payload.mnemonic,
      associations: payload.associations,
      lexicon: payload.lexicon,
    });
    data.words.push(record);
    persist(data);
    return { word: clone(record), duplicate: false };
  }

  function update(id, patch) {
    const payload = patch && typeof patch === 'object' ? patch : {};
    const data = readData();
    const word = findWord(data, id);
    let touched = false;

    if (typeof payload.word === 'string' && payload.word.trim() && payload.word.trim() !== word.word) {
      const nextWord = payload.word.trim();
      const nextNormalized = normalizeWord(nextWord);
      const collision = data.words.find(function (item) { return item.normalized === nextNormalized && item.id !== word.id; });
      if (collision) throw fail('INVALID_INPUT', '已存在同名生词');
      word.word = nextWord;
      word.normalized = nextNormalized;
      touched = true;
    }
    for (const key of ['phonetic', 'translation', 'context', 'contextTranslation', 'note']) {
      if (typeof payload[key] === 'string') {
        word[key] = payload[key];
        touched = true;
      }
    }
    if (typeof payload.mnemonic === 'string') {
      const mnemonic = payload.mnemonic.trim();
      if (mnemonic) word.mnemonic = mnemonic;
      else delete word.mnemonic;
      touched = true;
    }
    if (Array.isArray(payload.associations)) {
      const associations = cleanStringArray(payload.associations, 8);
      if (associations.length) word.associations = associations;
      else delete word.associations;
      touched = true;
    }
    if (payload.lexicon === null) {
      delete word.lexicon;
      touched = true;
    } else if (payload.lexicon && typeof payload.lexicon === 'object') {
      const lexicon = normalizeLexicon(payload.lexicon);
      if (lexicon) {
        word.lexicon = lexicon;
        touched = true;
      }
    }
    if (Array.isArray(payload.tags)) {
      word.tags = cleanTags(payload.tags);
      touched = true;
    }
    if (payload.mastery !== undefined) {
      word.mastery = Math.round(clampNumber(payload.mastery, 0, MASTERY_MAX, word.mastery));
      touched = true;
    }
    if (payload.source && typeof payload.source === 'object') {
      word.source = Object.assign({}, word.source, sanitizeSource(payload.source));
      touched = true;
    }
    if (touched) {
      word.updatedAt = nowIso();
      persist(data);
    }
    return clone(word);
  }

  function remove(id) {
    const data = readData();
    const index = data.words.findIndex(function (item) { return item.id === String(id || ''); });
    if (index === -1) throw fail('NOT_FOUND', '生词不存在');
    data.words.splice(index, 1);
    persist(data);
    return { ok: true };
  }

  function due(limit) {
    const max = limit === undefined || limit === null ? 20 : Math.max(0, Math.round(Number(limit) || 0));
    const now = Date.now();
    const words = readData().words
      .filter(function (item) { return Date.parse(item.srs.due) <= now; })
      .sort(function (a, b) { return Date.parse(a.srs.due) - Date.parse(b.srs.due); });
    return words.slice(0, max).map(clone);
  }

  function review(id, rating) {
    if (RATINGS.indexOf(rating) === -1) throw fail('INVALID_INPUT', '无效的复习评分');
    const data = readData();
    const word = findWord(data, id);
    const now = new Date();
    const nowMs = now.getTime();
    const memory = word.memory && typeof word.memory === 'object'
      ? word.memory
      : normalizeMemory(null, word.srs, word.mastery, word.createdAt);

    let stage = Math.round(clampNumber(memory.stage, 0, MAX_STAGE, 0));
    let ease = Number(word.srs.ease) || 2.5;
    let reps = Math.max(0, Math.round(Number(word.srs.reps) || 0));
    let lapses = Math.max(0, Math.round(Number(memory.lapses !== undefined ? memory.lapses : word.srs.lapses) || 0));
    let mastery = Math.round(Number(word.mastery) || 0);

    if (rating === 'again') {
      stage = 0;
      ease -= 0.15;
      lapses += 1;
      mastery = Math.max(0, mastery - 1);
    } else if (rating === 'hard') {
      stage = Math.max(0, stage - 1);
      ease -= 0.15;
    } else if (rating === 'good') {
      stage = Math.min(MAX_STAGE, stage + 1);
      mastery = Math.min(MASTERY_MAX, mastery + 1);
    } else {
      stage = Math.min(MAX_STAGE, stage + 2);
      ease += 0.15;
      mastery = Math.min(MASTERY_MAX, mastery + 2);
    }

    ease = clampNumber(ease, EASE_MIN, EASE_MAX, 2.5);
    reps += 1;
    const intervalHours = EBBINGHAUS_INTERVALS[stage];
    const due = new Date(nowMs + intervalHours * HOUR_MS).toISOString();
    const history = (Array.isArray(memory.history) ? memory.history : [])
      .concat([{ at: now.toISOString(), rating: rating, stage: stage, intervalHours: intervalHours }])
      .slice(-HISTORY_LIMIT);

    word.memory = {
      stage: stage,
      intervalHours: intervalHours,
      due: due,
      lastRating: rating,
      lapses: lapses,
      history: history,
    };
    word.srs = {
      due: due,
      interval: roundTo(intervalHours / 24, 6),
      ease: roundTo(ease, 2),
      reps: reps,
      lapses: lapses,
    };
    word.mastery = mastery;
    word.lastReviewedAt = now.toISOString();
    word.updatedAt = word.lastReviewedAt;

    const dateKey = localDateKey(now);
    data.reviewDays[dateKey] = (Number(data.reviewDays[dateKey]) || 0) + 1;
    persist(data);
    return clone(word);
  }

  function stats() {
    const data = readData();
    const now = new Date();
    const nowMs = now.getTime();
    const todayKey = localDateKey(now);
    let dueCount = 0;
    let newCount = 0;
    let learning = 0;
    let mastered = 0;
    let addedToday = 0;
    const stages = new Array(MAX_STAGE + 1).fill(0);
    for (const word of data.words) {
      if (Date.parse(word.srs.due) <= nowMs) dueCount += 1;
      if (word.mastery <= 0) newCount += 1;
      else if (word.mastery <= 3) learning += 1;
      else mastered += 1;
      if (localDateKey(new Date(word.createdAt)) === todayKey) addedToday += 1;
      const stage = Number(word.memory && word.memory.stage);
      if (Number.isInteger(stage) && stage >= 0 && stage <= MAX_STAGE) stages[stage] += 1;
    }
    return {
      total: data.words.length,
      due: dueCount,
      learning: learning,
      mastered: mastered,
      new: newCount,
      reviewedToday: Number(data.reviewDays[todayKey]) || 0,
      addedToday: addedToday,
      streak: computeReviewStreak(data.reviewDays, now),
      stages: stages,
    };
  }

  function schedule() {
    return {
      intervals: EBBINGHAUS_INTERVALS.map(function (hours, stage) {
        return { stage: stage, hours: hours, label: EBBINGHAUS_LABELS[stage] };
      }),
      maxStage: MAX_STAGE,
    };
  }

  function isSaved(normalized) {
    const key = normalizeWord(normalized);
    if (!key) return null;
    const word = readData().words.find(function (item) { return item.normalized === key; });
    return word ? clone(word) : null;
  }

  function exportCsv(targetPath) {
    try {
      const words = readData().words.slice().sort(function (a, b) {
        return (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0);
      });
      const rows = [['单词', '音标', '释义', '原文语境', '语境翻译', '出处', '笔记', '标签', '掌握度', '下次复习', '添加时间']];
      for (const word of words) {
        rows.push([
          word.word,
          word.phonetic || '',
          word.translation || '',
          word.context || '',
          word.contextTranslation || '',
          sourceLabel(word.source),
          word.note || '',
          (word.tags || []).join(' / '),
          String(word.mastery || 0),
          formatDateTime(word.srs && word.srs.due),
          formatDateTime(word.createdAt),
        ]);
      }
      const content = '\uFEFF' + rows.map(function (row) { return row.map(csvCell).join(','); }).join('\r\n') + '\r\n';
      const filePath = targetPath
        ? path.resolve(String(targetPath))
        : path.join(dataDir, 'exports', 'lumen-vocab-' + localDateKey(new Date()) + '.csv');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileAtomic(filePath, content);
      return { saved: true, path: filePath };
    } catch (err) {
      return { saved: false };
    }
  }

  return {
    list: list,
    add: add,
    update: update,
    remove: remove,
    due: due,
    review: review,
    stats: stats,
    schedule: schedule,
    isSaved: isSaved,
    exportCsv: exportCsv,
    dataDir: dataDir,
  };
}

module.exports = {
  createVocabService,
  normalizeWord,
  EBBINGHAUS_INTERVALS,
  EBBINGHAUS_LABELS,
  MAX_STAGE,
};
