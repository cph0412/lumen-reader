'use strict';

// local-dictionary.js — 内置词典（用户提供的 cigen / TOEFL / 不择手段背单词数据集）
// 数据由 scripts/build-dictionaries.js 预生成成按首字母分片的 gzip JSONL。
// 纯 Node，无 electron 依赖。

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const CACHE_LIMIT = 6;

function normalizeWord(value) {
  return String(value == null ? '' : value)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function bucketOf(key) {
  const char = String(key || '').charAt(0);
  return /^[a-z]$/.test(char) ? char : '_';
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createLocalDictionaryService(options) {
  const opts = options || {};
  const dictionaryDir = opts.dictionaryDir;
  if (!dictionaryDir) throw new TypeError('createLocalDictionaryService 需要 dictionaryDir');
  const shardDir = path.join(dictionaryDir, 'shards');
  const cache = new Map();
  let manifest = null;

  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dictionaryDir, 'manifest.json'), 'utf8'));
  } catch (err) {
    manifest = { total: 0, shards: [] };
  }

  function loadShard(bucket) {
    if (cache.has(bucket)) {
      const hit = cache.get(bucket);
      cache.delete(bucket);
      cache.set(bucket, hit);
      return hit;
    }
    const file = path.join(shardDir, bucket + '.jsonl.gz');
    const index = new Map();
    try {
      const raw = zlib.gunzipSync(fs.readFileSync(file));
      for (const line of raw.toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line);
          const key = normalizeWord(record.w);
          if (key) index.set(key, record);
        } catch (err) { /* skip malformed line */ }
      }
    } catch (err) {
      index.clear();
    }
    cache.set(bucket, index);
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return index;
  }

  function toDictionaryResult(record) {
    const meanings = Array.isArray(record.d) ? record.d.map((item) => ({
      partOfSpeech: item.pos || '',
      definition: item.en || '',
      definitionZh: item.zh || '',
      example: '',
      synonyms: [],
      antonyms: []
    })) : [];
    return {
      word: record.w,
      phonetic: record.p || record.uk || record.us || undefined,
      audio: undefined,
      source: 'local',
      sourceLabel: '内置词典',
      meanings,
      synonyms: Array.isArray(record.s) ? record.s : [],
      antonyms: Array.isArray(record.a) ? record.a : [],
      examples: Array.isArray(record.x) ? record.x : [],
      phrases: Array.isArray(record.ph) ? record.ph : [],
      roots: record.r || undefined,
      mnemonic: record.m || undefined,
      wordFamily: Array.isArray(record.fam) ? record.fam : [],
      note: record.n || undefined,
      origin: undefined,
      forms: [],
      url: undefined,
      localSources: Array.isArray(record.src) ? record.src : []
    };
  }

  function lookup(word) {
    const key = normalizeWord(word);
    if (!key) return null;
    const bucket = bucketOf(key);
    if (!manifest || !Array.isArray(manifest.shards) || manifest.shards.indexOf(bucket) === -1) return null;
    const index = loadShard(bucket);
    const record = index.get(key);
    return record ? clone(toDictionaryResult(record)) : null;
  }

  function stats() {
    return {
      total: Number(manifest && manifest.total) || 0,
      shards: Array.isArray(manifest && manifest.shards) ? manifest.shards.length : 0,
      cacheBuckets: cache.size,
      sources: manifest && manifest.sources ? manifest.sources : null
    };
  }

  return { lookup, stats, dictionaryDir };
}

module.exports = { createLocalDictionaryService, normalizeWord };
