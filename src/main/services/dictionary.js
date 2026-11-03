'use strict';

// dictionary.js — 增强词典服务（免费开放词典 + 可选牛津 API）
// - provider='auto'：有牛津凭证用牛津，否则免费
// - provider='free'：只用 dictionaryapi.dev
// - provider='oxford'：优先牛津；凭证缺失/请求失败时回退免费源（结果 source='free' + fallbackFrom='oxford'）
// - 内存缓存最多 200 条；牛津商业数据不落磁盘
// - fetch 可注入，便于 node:test 单测；不依赖 electron

const FREE_ENDPOINT = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const OXFORD_ENDPOINT = 'https://od-api.oxforddictionaries.com/api/v2/entries/en-gb/';
const OXFORD_FIELDS = 'definitions,examples,pronunciations,synonyms,antonyms,etymologies,lexicalCategory';
const FREE_TIMEOUT = 5000;
const OXFORD_TIMEOUT = 8000;
const CACHE_LIMIT = 200;
const MAX_MEANINGS = 12;
const MAX_CHIPS = 12;

function normalizeSpace(text) {
  return String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim();
}

function normalizeWord(text) {
  return normalizeSpace(text)
    .replace(/^[\s"'\u201c\u201d\u2018\u2019(\[{<\u00ab]+/, '')
    .replace(/[\s"'\u201c\u201d\u2018\u2019)\]}>.,;:!?\u3002\uff0c\uff1b\uff1a\uff01\uff1f\u00bb]+$/, '')
    .toLowerCase();
}

function decodeHtmlEntities(text) {
  if (!text) return '';
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, function (match, hex) {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch (err) { return match; }
    })
    .replace(/&#(\d+);/g, function (match, dec) {
      try { return String.fromCodePoint(parseInt(dec, 10)); } catch (err) { return match; }
    })
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&mdash;/gi, '\u2014')
    .replace(/&ndash;/gi, '\u2013')
    .replace(/&hellip;/gi, '\u2026')
    .replace(/&amp;/gi, '&');
}

function cleanText(value) {
  const decoded = decodeHtmlEntities(normalizeSpace(value));
  if (!decoded) return '';
  return normalizeSpace(decoded.replace(/<[^>]+>/g, ' '));
}

function cleanList(list) {
  if (!Array.isArray(list)) {
    if (typeof list === 'string') {
      return list.split(/[,;\n]/).map(cleanText).filter(Boolean);
    }
    return [];
  }
  const seen = new Set();
  const output = [];
  for (const item of list) {
    let text = '';
    if (typeof item === 'string') text = cleanText(item);
    else if (item && typeof item === 'object') {
      text = cleanText(item.text || item.word || item.phrase || item.value || '');
    }
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function uniqueChips(lists) {
  const seen = new Set();
  const output = [];
  for (const list of lists) {
    for (const item of list) {
      const key = String(item).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(item);
      if (output.length >= MAX_CHIPS) return output;
    }
  }
  return output;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function parseFreeEntry(data, fallbackWord) {
  const entries = Array.isArray(data) ? data : [data];
  const first = entries.find(function (item) { return item && typeof item === 'object'; });
  if (!first) return null;

  const sourceUrls = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (Array.isArray(entry.sourceUrls)) {
      for (const url of entry.sourceUrls) {
        if (typeof url === 'string' && url.trim() && sourceUrls.indexOf(url.trim()) === -1) sourceUrls.push(url.trim());
      }
    }
  }

  const meanings = [];
  const allSynonyms = [];
  const allAntonyms = [];
  let phonetic = '';
  let audio = '';
  let origin = '';

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (!phonetic && typeof entry.phonetic === 'string') phonetic = entry.phonetic.trim();
    const phonetics = Array.isArray(entry.phonetics) ? entry.phonetics : [];
    for (const item of phonetics) {
      if (!item || typeof item !== 'object') continue;
      if (!phonetic && typeof item.text === 'string' && item.text.trim()) phonetic = item.text.trim();
      if (!audio && typeof item.audio === 'string' && item.audio.trim()) audio = item.audio.trim();
    }
    if (!origin && typeof entry.origin === 'string') origin = cleanText(entry.origin);

    const entryMeanings = Array.isArray(entry.meanings) ? entry.meanings : [];
    for (const meaning of entryMeanings) {
      if (!meaning || typeof meaning !== 'object') continue;
      const partOfSpeech = cleanText(meaning.partOfSpeech || '');
      const meaningSynonyms = cleanList(meaning.synonyms);
      const meaningAntonyms = cleanList(meaning.antonyms);
      allSynonyms.push(meaningSynonyms);
      allAntonyms.push(meaningAntonyms);
      const definitions = Array.isArray(meaning.definitions) ? meaning.definitions : [];
      for (const definition of definitions) {
        if (!definition || typeof definition !== 'object') continue;
        const text = cleanText(definition.definition || '');
        if (!text) continue;
        const synonyms = uniqueChips([cleanList(definition.synonyms), meaningSynonyms]);
        const antonyms = uniqueChips([cleanList(definition.antonyms), meaningAntonyms]);
        allSynonyms.push(synonyms);
        allAntonyms.push(antonyms);
        const example = cleanText(definition.example || '');
        const item = {
          partOfSpeech: partOfSpeech || meaning.partOfSpeech || '',
          definition: text,
          synonyms: synonyms,
          antonyms: antonyms,
        };
        if (example) item.example = example;
        meanings.push(item);
        if (meanings.length >= MAX_MEANINGS) break;
      }
      if (meanings.length >= MAX_MEANINGS) break;
    }
    if (meanings.length >= MAX_MEANINGS) break;
  }

  if (!meanings.length) return null;
  const result = {
    word: cleanText(first.word || fallbackWord) || fallbackWord,
    meanings: meanings,
    synonyms: uniqueChips(allSynonyms),
    antonyms: uniqueChips(allAntonyms),
    source: 'free',
    sourceLabel: '开放词典',
  };
  if (phonetic) result.phonetic = phonetic;
  if (audio) result.audio = audio;
  if (origin) result.origin = origin;
  if (sourceUrls.length) {
    result.url = sourceUrls[0];
    result.sourceUrls = sourceUrls;
  }
  return result;
}

function oxfordPronunciations(entry, lexicalEntry) {
  const output = { phonetic: '', audio: '' };
  const groups = [
    Array.isArray(entry && entry.pronunciations) ? entry.pronunciations : [],
    Array.isArray(lexicalEntry && lexicalEntry.pronunciations) ? lexicalEntry.pronunciations : [],
  ];
  for (const group of groups) {
    for (const item of group) {
      if (!item || typeof item !== 'object') continue;
      if (!output.phonetic && typeof item.phoneticSpelling === 'string' && item.phoneticSpelling.trim()) {
        output.phonetic = item.phoneticSpelling.trim();
      }
      if (!output.audio && typeof item.audioFile === 'string' && item.audioFile.trim()) {
        output.audio = item.audioFile.trim();
      }
      if (!output.audio && typeof item.audio === 'string' && item.audio.trim()) output.audio = item.audio.trim();
    }
  }
  return output;
}

function collectOxfordSenses(senses, partOfSpeech, collect) {
  if (!Array.isArray(senses)) return;
  for (const sense of senses) {
    if (!sense || typeof sense !== 'object') continue;
    const definitions = Array.isArray(sense.definitions) ? sense.definitions : [];
    const synonyms = cleanList(sense.synonyms);
    const antonyms = cleanList(sense.antonyms);
    const examples = Array.isArray(sense.examples)
      ? sense.examples.map(function (item) {
        if (typeof item === 'string') return cleanText(item);
        if (item && typeof item === 'object') return cleanText(item.text || item.example || '');
        return '';
      }).filter(Boolean)
      : [];
    collect(partOfSpeech, definitions, examples, synonyms, antonyms);
    if (Array.isArray(sense.subsenses)) {
      collectOxfordSenses(sense.subsenses, partOfSpeech, collect);
    }
  }
}

function parseOxfordEntry(data, fallbackWord) {
  const results = Array.isArray(data && data.results) ? data.results : [];
  const result0 = results.find(function (item) { return item && typeof item === 'object'; });
  if (!result0) return null;

  const meanings = [];
  const allSynonyms = [];
  const allAntonyms = [];
  let phonetic = '';
  let audio = '';
  let origin = '';
  const lexicalEntries = Array.isArray(result0.lexicalEntries) ? result0.lexicalEntries : [];

  const collect = function (partOfSpeech, definitions, examples, synonyms, antonyms) {
    allSynonyms.push(synonyms);
    allAntonyms.push(antonyms);
    definitions.forEach(function (rawDefinition, index) {
      if (meanings.length >= MAX_MEANINGS) return;
      const text = cleanText(typeof rawDefinition === 'string' ? rawDefinition : (rawDefinition && rawDefinition.text) || '');
      if (!text) return;
      const item = {
        partOfSpeech: partOfSpeech || '',
        definition: text,
        synonyms: synonyms.slice(),
        antonyms: antonyms.slice(),
      };
      const example = examples[index] || examples[0] || '';
      if (example) item.example = example;
      meanings.push(item);
    });
  };

  for (const lexicalEntry of lexicalEntries) {
    if (!lexicalEntry || typeof lexicalEntry !== 'object') continue;
    const category = lexicalEntry.lexicalCategory;
    const partOfSpeech = cleanText(
      (category && (category.id || category.text)) || lexicalEntry.lexicalCategory || ''
    );
    if (!phonetic || !audio) {
      const pron = oxfordPronunciations(null, lexicalEntry);
      if (!phonetic) phonetic = pron.phonetic;
      if (!audio) audio = pron.audio;
    }
    if (!origin && Array.isArray(lexicalEntry.etymologies)) {
      origin = cleanText(lexicalEntry.etymologies[0] || '');
    }
    const entries = Array.isArray(lexicalEntry.entries) ? lexicalEntry.entries : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const pron = oxfordPronunciations(entry, null);
      if (!phonetic) phonetic = pron.phonetic;
      if (!audio) audio = pron.audio;
      if (!origin && Array.isArray(entry.etymologies)) origin = cleanText(entry.etymologies[0] || '');
      collectOxfordSenses(entry.senses, partOfSpeech, collect);
      if (meanings.length >= MAX_MEANINGS) break;
    }
    if (meanings.length >= MAX_MEANINGS) break;
  }

  if (!meanings.length) return null;
  const result = {
    word: cleanText(result0.word || fallbackWord) || fallbackWord,
    meanings: meanings,
    synonyms: uniqueChips(allSynonyms),
    antonyms: uniqueChips(allAntonyms),
    source: 'oxford',
    sourceLabel: '牛津词典',
  };
  if (phonetic) result.phonetic = phonetic;
  if (audio) result.audio = audio;
  if (origin) result.origin = origin;
  result.url = 'https://www.oxfordlearnersdictionaries.com/definition/english/' + encodeURIComponent(normalizeWord(result.word));
  return result;
}

function requestJson(fetchImpl, url, options) {
  const opts = options || {};
  const timeout = opts.timeout || FREE_TIMEOUT;
  const controller = new AbortController();
  const timer = setTimeout(function () {
    try { controller.abort(); } catch (err) { /* 忽略 */ }
  }, timeout);
  return Promise.resolve()
    .then(function () {
      return fetchImpl(url, {
        method: 'GET',
        headers: opts.headers || {},
        signal: controller.signal,
      });
    })
    .then(function (response) {
      if (!response) throw new Error('网络无响应');
      const ok = typeof response.ok === 'boolean'
        ? response.ok
        : (typeof response.status === 'number' ? response.status >= 200 && response.status < 300 : true);
      if (!ok) {
        const httpError = new Error('HTTP ' + (response.status === undefined ? '?' : response.status));
        httpError.status = response.status;
        throw httpError;
      }
      if (typeof response.json === 'function') return response.json();
      if (typeof response.text === 'function') return JSON.parse(response.text());
      throw new Error('响应格式无法解析');
    })
    .catch(function (error) {
      if (error && error.name === 'AbortError') {
        const timeoutError = new Error('词典请求超时');
        timeoutError.code = 'TIMEOUT';
        throw timeoutError;
      }
      throw error;
    })
    .finally(function () { clearTimeout(timer); });
}

function createDictionaryService(options) {
  const opts = options || {};
  const settings = opts.settings || null;
  const localDictionary = opts.localDictionary || null;
  const fetchImpl = typeof opts.fetchImpl === 'function'
    ? opts.fetchImpl
    : (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (!fetchImpl) throw new TypeError('当前环境没有 fetch，请注入 fetchImpl');

  const cache = new Map();

  function readConfig() {
    let raw = {};
    try {
      raw = settings && typeof settings.getRaw === 'function' ? settings.getRaw() : (settings || {});
    } catch (err) {
      raw = {};
    }
    const dictionary = raw && typeof raw.dictionary === 'object' && raw.dictionary ? raw.dictionary : {};
    const provider = ['auto', 'free', 'oxford'].indexOf(dictionary.provider) === -1 ? 'auto' : dictionary.provider;
    const appId = typeof dictionary.oxfordAppId === 'string' ? dictionary.oxfordAppId.trim() : '';
    const appKey = typeof dictionary.oxfordAppKey === 'string' ? dictionary.oxfordAppKey.trim() : '';
    const hasOxford = Boolean(appId && appKey);
    const useOxford = provider === 'oxford' ? hasOxford : (provider === 'auto' && hasOxford);
    return {
      provider: provider,
      appId: appId,
      appKey: appKey,
      hasOxford: hasOxford,
      useOxford: useOxford,
      oxfordRequested: provider === 'oxford',
    };
  }

  function remember(key, result) {
    cache.set(key, { ts: Date.now(), result: clone(result) });
    while (cache.size > CACHE_LIMIT) {
      let oldestKey = null;
      let oldestTs = Infinity;
      for (const entry of cache.entries()) {
        const ts = Number(entry[1] && entry[1].ts) || 0;
        if (ts < oldestTs) {
          oldestTs = ts;
          oldestKey = entry[0];
        }
      }
      if (oldestKey === null) break;
      cache.delete(oldestKey);
    }
  }

  async function fetchFree(key) {
    const data = await requestJson(fetchImpl, FREE_ENDPOINT + encodeURIComponent(key), { timeout: FREE_TIMEOUT });
    return parseFreeEntry(data, key);
  }

  async function fetchOxford(key, appId, appKey) {
    const url = OXFORD_ENDPOINT + encodeURIComponent(key) + '?fields=' + encodeURIComponent(OXFORD_FIELDS);
    const data = await requestJson(fetchImpl, url, {
      timeout: OXFORD_TIMEOUT,
      headers: {
        Accept: 'application/json',
        app_id: appId,
        app_key: appKey,
      },
    });
    return parseOxfordEntry(data, key);
  }

  function peek(word) {
    const key = normalizeWord(word);
    if (!key) return null;
    const cached = cache.get(key);
    return cached && cached.result ? clone(cached.result) : null;
  }

  async function lookup(word, lookupOptions) {
    const key = normalizeWord(word);
    if (!key) return null;
    const noCache = Boolean(lookupOptions && lookupOptions.noCache);
    const cached = noCache ? null : cache.get(key);
    if (cached && cached.result) {
      cached.ts = Date.now();
      return clone(cached.result);
    }

    const config = readConfig();
    let result = null;
    let fallbackFrom = '';
    let oxfordTried = false;

    // If the user explicitly chose Oxford, try it before the bundled data.
    if (config.oxfordRequested && config.hasOxford) {
      oxfordTried = true;
      try {
        result = await fetchOxford(key, config.appId, config.appKey);
      } catch (err) {
        result = null;
      }
      if (!result) fallbackFrom = 'oxford';
    }

    // Bundled user-provided dictionaries next: offline, with Chinese
    // translations, TOEFL examples/roots and GRE mnemonics.
    if (!result && localDictionary && typeof localDictionary.lookup === 'function') {
      try {
        const local = await localDictionary.lookup(key);
        if (local) {
          if (fallbackFrom) local.fallbackFrom = fallbackFrom;
          remember(key, local);
          return clone(local);
        }
      } catch (err) {
        // A broken local shard must not block the online fallback.
      }
    }

    if (!result && !oxfordTried && config.useOxford) {
      try {
        result = await fetchOxford(key, config.appId, config.appKey);
      } catch (err) {
        result = null;
      }
      if (!result) fallbackFrom = 'oxford';
    }

    if (!result) {
      try {
        result = await fetchFree(key);
      } catch (err) {
        result = null;
      }
    }

    if (!result) return null;
    if (fallbackFrom) result.fallbackFrom = fallbackFrom;
    if (config.oxfordRequested && !config.hasOxford) result.fallbackFrom = 'oxford';
    remember(key, result);
    return clone(result);
  }

  async function testDictionary() {
    const config = readConfig();
    const preferOxford = config.oxfordRequested && config.hasOxford;
    if (!preferOxford && localDictionary && typeof localDictionary.lookup === 'function') {
      const local = localDictionary.lookup('hello');
      if (local) {
        const localStats = typeof localDictionary.stats === 'function' ? localDictionary.stats() : null;
        return { ok: true, provider: 'local', message: '内置词典可用' + (localStats && localStats.total ? '（' + localStats.total + ' 词条）' : '') };
      }
    }
    const target = config.useOxford || config.oxfordRequested ? 'oxford' : 'free';
    const result = await lookup('hello', { noCache: true });
    if (!result) {
      return {
        ok: false,
        provider: target,
        message: target === 'oxford'
          ? '牛津词典连接失败，请检查 App ID / App Key 与网络。'
          : '开放词典连接失败，请检查网络后重试。',
      };
    }
    if (result.fallbackFrom === 'oxford' && result.source === 'free') {
      return {
        ok: true,
        provider: 'free',
        message: config.hasOxford
          ? '牛津词典请求失败，已回退开放词典（免费源可用）。'
          : '未配置牛津凭证，已使用开放词典（免费源可用）。',
      };
    }
    return {
      ok: true,
      provider: result.source,
      message: (result.sourceLabel || result.source) + '连接正常',
    };
  }

  return {
    lookup: lookup,
    testDictionary: testDictionary,
    peek: peek,
    cacheSize: function () { return cache.size; },
    config: readConfig,
    cache: cache,
    localDictionary: localDictionary,
  };
}

module.exports = {
  createDictionaryService,
  parseFreeEntry,
  parseOxfordEntry,
  normalizeWord,
  decodeHtmlEntities,
  FREE_ENDPOINT,
  OXFORD_ENDPOINT,
  CACHE_LIMIT,
};
