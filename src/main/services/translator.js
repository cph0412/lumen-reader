'use strict';

// translator.js — 免费翻译 / AI 语境解析 / 连接测试
// - Google 非官方端点（2.5s 超时）失败立即降级 MyMemory（8s 超时）
// - 网络失败返回带 error 的 LookupResult，不抛异常
// - AI 走 OpenAI 兼容 /chat/completions，支持本地 Ollama / LM Studio（无 key）
// - fetch 可注入，便于 node:test 单测

const path = require('node:path');
const crypto = require('node:crypto');
const { createJsonStore } = require('./store');

const GOOGLE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const MYMEMORY_ENDPOINT = 'https://api.mymemory.translated.net/get';
const DICTIONARY_ENDPOINT = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

const GOOGLE_TIMEOUT = 1200;
const MYMEMORY_TIMEOUT = 8000;
const DICTIONARY_TIMEOUT = 5000;
const AI_TIMEOUT = 40000;
const TEST_TIMEOUT = 20000;

const MAX_FREE_CHARS = 1500;
// MyMemory rejects queries above roughly 500 bytes; keep a conservative
// character budget so a whole paragraph can be translated in chunks.
const MYMEMORY_CHUNK_CHARS = 420;
const LOOKUP_CACHE_LIMIT = 600;
const ANALYSIS_CACHE_LIMIT = 200;
const DICTIONARY_CACHE_LIMIT = 200;

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';

const SYSTEM_PROMPT = [
  '你是一位严谨的英语阅读教练，面向中文母语的英语学习者。',
  '请结合给定的语境解释英文片段，并且只输出一个 JSON 对象，不要输出 Markdown 或额外说明。',
  'JSON 字段：',
  '{"translation":"符合语境的中文翻译",',
  '"sense":"该片段在语境中的确切含义",',
  '"grammar":"结构/语法说明（中文）",',
  '"nuance":"语气、搭配与使用场景（中文）",',
  '"collocations":["搭配1","搭配2"],',
  '"examples":[{"en":"英文例句","zh":"中文翻译"}],',
  '"alternatives":["更地道的替换说法"],',
  '"level":"CEFR 等级，如 B1/B2/C1"}',
  '所有字段都必须存在，数组可以为空数组。',
].join('\n');

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function normalizeSpace(text) {
  return String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim();
}

function normalizeWord(text) {
  return normalizeSpace(text)
    .replace(/^[\s"'\u201c\u201d\u2018\u2019(\[{<\u00ab]+/, '')
    .replace(/[\s"'\u201c\u201d\u2018\u2019)\]}>.,;:!?\u3002\uff0c\uff1b\uff1a\uff01\uff1f\u00bb]+$/, '')
    .toLowerCase();
}

function normalizeKey(text) {
  return normalizeSpace(text).toLowerCase();
}

function detectKind(text) {
  const words = normalizeSpace(text).split(/\s+/).filter(Boolean);
  if (words.length <= 1) return 'word';
  if (words.length <= 6 && !/[.!?\u3002\uff01\uff1f]["'\u201d\u2019)]?$/.test(normalizeSpace(text))) return 'phrase';
  if (words.length <= 40) return 'sentence';
  return 'paragraph';
}

function truncate(text, limit) {
  const value = String(text || '');
  return value.length > limit ? value.slice(0, limit) : value;
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

function splitTextForTranslation(text, maxChars) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!source) return [];
  const limit = Math.max(80, Number(maxChars) || MYMEMORY_CHUNK_CHARS);
  const sentences = source.match(/[^.!?。！？]+[.!?。！？]+["'”’]?|[^.!?。！？]+$/g) || [source];
  const chunks = [];
  let current = '';
  const push = function (value) {
    const trimmed = String(value || '').trim();
    if (trimmed) chunks.push(trimmed);
  };
  for (const rawSentence of sentences) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;
    if (sentence.length > limit) {
      if (current) { push(current); current = ''; }
      const words = sentence.split(/\s+/).filter(Boolean);
      let part = '';
      for (const word of words) {
        if (part && (part.length + 1 + word.length) > limit) { push(part); part = word; }
        else part = part ? part + ' ' + word : word;
      }
      if (part) push(part);
      continue;
    }
    if (current && (current.length + 1 + sentence.length) > limit) {
      push(current);
      current = sentence;
    } else {
      current = current ? current + ' ' + sentence : sentence;
    }
  }
  if (current) push(current);
  return chunks;
}

function joinTranslations(parts) {
  let joined = '';
  for (const part of parts) {
    const value = String(part || '').trim();
    if (!value) continue;
    if (joined && !/[。！？.!?；;，,、]$/.test(joined) && !/^[，。！？；、,.!?;]/.test(value)) joined += ' ';
    joined += value;
  }
  return joined.trim();
}

function hashKey(parts) {
  return crypto.createHash('sha1').update(parts.join('\u0000')).digest('hex');
}

function isLocalBaseUrl(baseUrl) {
  try {
    const host = new URL(String(baseUrl || '')).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host.endsWith('.localhost');
  } catch (err) {
    return false;
  }
}

function createTranslationService(options) {
  const opts = options || {};
  const settings = opts.settings || null;
  const fetchImpl = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (!fetchImpl) throw new TypeError('当前环境没有 fetch，请注入 fetchImpl');

  const cacheDir = opts.dataDir || (settings && settings.dataDir) || null;
  const lookupCache = new Map();
  const analysisCache = new Map();
  const dictionaryCache = new Map();
  let cacheStore = null;
  let cacheLoaded = false;

  function getCacheStore() {
    if (!cacheDir) return null;
    if (!cacheStore) {
      cacheStore = opts.cacheStore || createJsonStore({
        filePath: path.join(cacheDir, 'cache.json'),
        defaults: function () { return { lookups: {}, analyses: {} }; },
      });
    }
    return cacheStore;
  }

  function ensureCacheLoaded() {
    if (cacheLoaded) return;
    cacheLoaded = true;
    const store = getCacheStore();
    if (!store) return;
    try {
      const data = store.read();
      if (data && typeof data === 'object') {
        if (data.lookups && typeof data.lookups === 'object') {
          for (const key of Object.keys(data.lookups)) lookupCache.set(key, data.lookups[key]);
        }
        if (data.analyses && typeof data.analyses === 'object') {
          for (const key of Object.keys(data.analyses)) analysisCache.set(key, data.analyses[key]);
        }
      }
    } catch (err) {
      // 缓存损坏不影响主流程，store 内部已备份
    }
  }

  function persistCache() {
    const store = getCacheStore();
    if (!store) return;
    try {
      const current = store.read();
      const data = current && typeof current === 'object' ? current : {};
      data.lookups = Object.fromEntries(lookupCache);
      data.analyses = Object.fromEntries(analysisCache);
      store.write(data);
    } catch (err) {
      // 忽略缓存写入失败
    }
  }

  function evictOldest(cache, limit) {
    while (cache.size > limit) {
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

  function rememberLookup(key, entry) {
    lookupCache.set(key, entry);
    evictOldest(lookupCache, LOOKUP_CACHE_LIMIT);
    persistCache();
  }

  function rememberAnalysis(key, entry) {
    analysisCache.set(key, entry);
    evictOldest(analysisCache, ANALYSIS_CACHE_LIMIT);
    persistCache();
  }

  function getAIConfig() {
    let raw = {};
    try {
      raw = settings && typeof settings.getRaw === 'function' ? settings.getRaw() : (settings || {});
    } catch (err) {
      raw = {};
    }
    const ai = raw && typeof raw.ai === 'object' && raw.ai ? raw.ai : {};
    const baseUrl = (typeof ai.baseUrl === 'string' && ai.baseUrl.trim() ? ai.baseUrl.trim() : DEFAULT_BASE_URL).replace(/\/+$/, '');
    return {
      apiKey: typeof ai.apiKey === 'string' ? ai.apiKey.trim() : '',
      baseUrl: baseUrl,
      model: typeof ai.model === 'string' && ai.model.trim() ? ai.model.trim() : DEFAULT_MODEL,
      temperature: Number.isFinite(Number(ai.temperature)) ? Number(ai.temperature) : 0.7,
      local: isLocalBaseUrl(baseUrl),
    };
  }

  function chatCompletionsUrl(baseUrl) {
    if (/\/chat\/completions$/.test(baseUrl)) return baseUrl;
    return baseUrl + '/chat/completions';
  }

  function authHeaders(config) {
    if (config.apiKey) return { Authorization: 'Bearer ' + config.apiKey };
    // 本地 OpenAI 兼容服务（Ollama / LM Studio）不校验 key，但仍带占位值兼容部分实现
    if (config.local) return { Authorization: 'Bearer ollama' };
    return {};
  }

  async function requestJson(url, requestOptions) {
    const options = requestOptions || {};
    const timeout = options.timeout || MYMEMORY_TIMEOUT;
    const controller = new AbortController();
    const timer = setTimeout(function () {
      try { controller.abort(); } catch (err) { /* 忽略 */ }
    }, timeout);
    try {
      const response = await fetchImpl(url, {
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body === undefined ? undefined : options.body,
        signal: controller.signal,
      });
      if (!response) throw new Error('网络无响应');
      const ok = typeof response.ok === 'boolean'
        ? response.ok
        : (typeof response.status === 'number' ? response.status >= 200 && response.status < 300 : true);
      if (!ok) {
        const httpError = new Error('HTTP ' + (response.status === undefined ? '?' : response.status));
        httpError.status = response.status;
        throw httpError;
      }
      let data;
      if (typeof response.json === 'function') data = await response.json();
      else if (typeof response.text === 'function') data = JSON.parse(await response.text());
      else throw new Error('响应格式无法解析');
      return data;
    } catch (err) {
      if (err && err.name === 'AbortError') {
        const timeoutError = new Error('请求超时');
        timeoutError.code = 'TIMEOUT';
        throw timeoutError;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function translateWithGoogle(text) {
    const url = GOOGLE_ENDPOINT + '?client=gtx&sl=en&tl=zh-CN&dt=t&q=' + encodeURIComponent(text);
    const data = await requestJson(url, { timeout: GOOGLE_TIMEOUT });
    const groups = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];
    const translation = groups
      .map(function (group) { return Array.isArray(group) && typeof group[0] === 'string' ? group[0] : ''; })
      .join('')
      .trim();
    if (!translation) throw new Error('Google 返回空翻译');
    return decodeHtmlEntities(translation);
  }

  async function translateWithMyMemory(text) {
    const url = MYMEMORY_ENDPOINT + '?q=' + encodeURIComponent(text) + '&langpair=en|zh-CN';
    const data = await requestJson(url, { timeout: MYMEMORY_TIMEOUT });
    const translated = data && data.responseData && typeof data.responseData.translatedText === 'string'
      ? data.responseData.translatedText
      : (data && typeof data.translatedText === 'string' ? data.translatedText : '');
    const status = data && data.responseStatus !== undefined ? Number(data.responseStatus) : 200;
    if (status !== 200 && !translated) throw new Error('MyMemory 返回错误状态');
    const cleaned = decodeHtmlEntities(translated).trim();
    if (!cleaned) throw new Error('MyMemory 返回空翻译');
    if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE PAIR|PLEASE SELECT/i.test(cleaned)) {
      throw new Error('MyMemory 拒绝请求');
    }
    return cleaned;
  }

  async function translateLongText(text) {
    const chunks = splitTextForTranslation(text, MYMEMORY_CHUNK_CHARS);
    if (!chunks.length) throw new Error('没有可翻译的文本');
    const parts = [];
    let usedGoogle = false;
    for (const chunk of chunks) {
      let translated;
      try {
        translated = await translateWithMyMemory(chunk);
      } catch (memoryError) {
        translated = await translateWithGoogle(chunk);
        usedGoogle = true;
      }
      parts.push(translated);
    }
    return {
      translation: joinTranslations(parts),
      provider: usedGoogle ? 'google-free' : 'mymemory',
    };
  }

  function dictionaryEntry(word) {
    const key = normalizeWord(word);
    if (!key) return null;
    return dictionaryCache.get(key) || null;
  }

  async function dictionary(word) {
    const key = normalizeWord(word);
    if (!key) return null;
    const cached = dictionaryCache.get(key);
    if (cached) return cached;
    try {
      const data = await requestJson(DICTIONARY_ENDPOINT + encodeURIComponent(key), { timeout: DICTIONARY_TIMEOUT });
      const entry = Array.isArray(data) ? data[0] : data;
      if (!entry || !Array.isArray(entry.meanings)) return null;
      const phonetics = Array.isArray(entry.phonetics) ? entry.phonetics : [];
      const audio = phonetics.find(function (item) { return item && item.audio; });
      const phonetic = entry.phonetic || (phonetics.find(function (item) { return item && item.text; }) || {}).text || '';
      const result = {
        word: entry.word || key,
        phonetic: phonetic || undefined,
        audio: audio ? audio.audio : undefined,
        meanings: entry.meanings.slice(0, 6).map(function (meaning) {
          const definition = meaning && Array.isArray(meaning.definitions) ? meaning.definitions[0] : null;
          return {
            partOfSpeech: (meaning && meaning.partOfSpeech) || '',
            definition: (definition && definition.definition) || '',
            example: (definition && definition.example) || undefined,
          };
        }).filter(function (item) { return item.definition; }),
        source: 'dictionaryapi',
      };
      if (!result.meanings.length) return null;
      dictionaryCache.set(key, result);
      evictOldest(dictionaryCache, DICTIONARY_CACHE_LIMIT);
      return result;
    } catch (err) {
      return null;
    }
  }

  function buildLookupResult(fields) {
    const result = {
      text: fields.text,
      kind: fields.kind,
      normalized: fields.normalized,
      translation: fields.translation || '',
      provider: fields.provider,
      dictionary: fields.dictionary || null,
      analyzed: Boolean(fields.analyzed),
    };
    if (fields.note) result.note = fields.note;
    if (fields.error) result.error = fields.error;
    return result;
  }

  async function lookup(input) {
    ensureCacheLoaded();
    const payload = input || {};
    const original = normalizeSpace(payload.text);
    if (!original) {
      return buildLookupResult({
        text: '',
        kind: 'word',
        normalized: '',
        provider: 'google-free',
        error: { code: 'EMPTY', message: '没有可翻译的文本' },
      });
    }
    const limited = truncate(original, MAX_FREE_CHARS);
    const kind = detectKind(limited);
    const normalized = kind === 'word' ? normalizeWord(limited) : normalizeKey(limited);
    const cacheKey = kind + '\u0000' + normalized;

    const cached = lookupCache.get(cacheKey);
    if (cached && cached.translation) {
      return buildLookupResult({
        text: original,
        kind: kind,
        normalized: normalized,
        translation: cached.translation,
        provider: 'cache',
        dictionary: dictionaryEntry(normalized),
      });
    }

    let translation = '';
    let provider = 'google-free';
    if (limited.length > MYMEMORY_CHUNK_CHARS) {
      // Long paragraphs exceed MyMemory's 500-byte query limit. Translate them
      // in sentence-aligned chunks instead of returning a misleading NETWORK
      // error for the whole paragraph.
      try {
        const longResult = await translateLongText(limited);
        translation = longResult.translation;
        provider = longResult.provider;
      } catch (err) {
        translation = '';
      }
    } else {
      try {
        translation = await translateWithGoogle(limited);
      } catch (err) {
        translation = '';
      }
      if (!translation) {
        try {
          translation = await translateWithMyMemory(limited);
          provider = 'mymemory';
        } catch (err) {
          translation = '';
        }
      }
    }

    if (!translation) {
      return buildLookupResult({
        text: original,
        kind: kind,
        normalized: normalized,
        provider: 'google-free',
        error: { code: 'NETWORK', message: '翻译服务暂不可用，请检查网络后重试' },
      });
    }

    rememberLookup(cacheKey, {
      ts: Date.now(),
      text: original,
      kind: kind,
      normalized: normalized,
      translation: translation,
      provider: provider,
    });

    return buildLookupResult({
      text: original,
      kind: kind,
      normalized: normalized,
      translation: translation,
      provider: provider,
      dictionary: dictionaryEntry(normalized),
    });
  }

  function toText(value) {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return String(value);
    if (Array.isArray(value)) {
      return value.map(toText).filter(Boolean).join('；');
    }
    if (value && typeof value === 'object') {
      for (const key of ['zh', 'chinese', 'cn', 'text', 'value', 'translation', 'content']) {
        const text = toText(value[key]);
        if (text) return text;
      }
    }
    return '';
  }

  function toStringArray(value) {
    if (typeof value === 'string') {
      return value.split(/\n|；|;/).map(function (item) { return item.trim(); }).filter(Boolean);
    }
    if (!Array.isArray(value)) return [];
    return value.map(function (item) {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        for (const key of ['en', 'zh', 'text', 'phrase', 'collocation', 'value']) {
          const text = toText(item[key]);
          if (text) return text;
        }
      }
      return '';
    }).filter(Boolean);
  }

  function normalizeExample(item) {
    if (!item) return null;
    if (typeof item === 'string') return item.trim() ? { en: item.trim(), zh: '' } : null;
    const en = toText(item.en || item.english || item.source || item.original || item.sentence);
    const zh = toText(item.zh || item.cn || item.chinese || item.target || item.translation);
    if (!en && !zh) return null;
    return { en: en, zh: zh };
  }

  function extractJson(content) {
    if (content && typeof content === 'object') return content;
    let text = String(content || '').trim();
    if (!text) throw fail('AI_ERROR', 'AI 返回内容为空');
    const fenced = /\x60{3}(?:json)?([\s\S]*?)\x60{3}/i.exec(text);
    if (fenced) text = fenced[1].trim();
    try { return JSON.parse(text); } catch (err) { /* 继续尝试截取 */ }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch (err) { /* 继续 */ }
    }
    throw fail('AI_ERROR', 'AI 返回的 JSON 无法解析');
  }

  function normalizeAnalysis(parsed) {
    const source = parsed && typeof parsed === 'object' ? parsed : {};
    const analysis = {
      translation: toText(source.translation || source.translate || source.zh || source.chinese),
      sense: toText(source.sense || source.meaning || source.contextualMeaning || source.context_meaning),
      grammar: toText(source.grammar || source.structure || source.syntax),
      nuance: toText(source.nuance || source.tone || source.usage || source.register),
      collocations: toStringArray(source.collocations || source.collocation || source.phrases).slice(0, 8),
      examples: (Array.isArray(source.examples) ? source.examples : []).map(normalizeExample).filter(Boolean).slice(0, 4),
      alternatives: toStringArray(source.alternatives || source.synonyms || source.alternative).slice(0, 6),
    };
    const level = toText(source.level || source.cefr);
    if (level) analysis.level = level.toUpperCase().slice(0, 8);
    if (!analysis.translation && !analysis.sense) {
      throw fail('AI_ERROR', 'AI 返回内容缺少必要字段');
    }
    if (!analysis.translation) analysis.translation = analysis.sense;
    if (!analysis.sense) analysis.sense = analysis.translation;
    return analysis;
  }

  function aiErrorMessage(error) {
    if (!error) return '连接失败';
    if (error.code === 'TIMEOUT' || /超时/.test(String(error.message))) return '连接超时，请检查网络或代理设置';
    const status = error.status;
    if (status === 401 || status === 403) return 'API Key 无效或没有权限（HTTP ' + status + '）';
    if (status === 404) return '接口地址不存在，请检查 Base URL';
    if (status === 429) return '请求过于频繁或额度不足（HTTP 429）';
    if (typeof status === 'number') return '接口返回错误（HTTP ' + status + '）';
    return '连接失败：' + (error.message || '未知错误');
  }

  async function requestAnalysis(config, text, context, chapterTitle) {
    const userContent = [
      '需要解释的英文片段：',
      text,
      context ? '所在语境：\n' + context : '',
      chapterTitle ? '章节：' + chapterTitle : '',
    ].filter(Boolean).join('\n\n');

    const headers = Object.assign({ 'Content-Type': 'application/json' }, authHeaders(config));
    const url = chatCompletionsUrl(config.baseUrl);
    const body = {
      model: config.model,
      temperature: config.temperature,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    };

    try {
      return await requestJson(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
        timeout: AI_TIMEOUT,
      });
    } catch (error) {
      // 部分兼容实现不支持 response_format，去掉后重试一次
      if (error && error.status === 400 && /response_format|json_object/i.test(String(error.message || ''))) {
        const fallbackBody = Object.assign({}, body);
        delete fallbackBody.response_format;
        return requestJson(url, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(fallbackBody),
          timeout: AI_TIMEOUT,
        });
      }
      throw error;
    }
  }

  async function analyze(input) {
    ensureCacheLoaded();
    const payload = input || {};
    const text = normalizeSpace(payload.text);
    if (!text) throw fail('INVALID_INPUT', '没有可解析的文本');
    const context = normalizeSpace(payload.context || '');
    const chapterTitle = normalizeSpace(payload.chapterTitle || '');
    const config = getAIConfig();
    if (!config.apiKey && !config.local) {
      throw fail('NO_AI_KEY', '尚未配置 AI API Key，请先在设置中填写。');
    }

    const cacheKey = hashKey([text.slice(0, MAX_FREE_CHARS), context.slice(0, 3000)]);
    const cached = analysisCache.get(cacheKey);
    if (cached && cached.result) return JSON.parse(JSON.stringify(cached.result));

    let data;
    try {
      data = await requestAnalysis(config, text.slice(0, MAX_FREE_CHARS), context, chapterTitle);
    } catch (error) {
      if (error && error.code === 'NO_AI_KEY') throw error;
      throw fail('NETWORK', aiErrorMessage(error));
    }

    const choices = data && Array.isArray(data.choices) ? data.choices : [];
    const content = choices[0] && choices[0].message ? choices[0].message.content : null;
    if (!content) throw fail('AI_ERROR', 'AI 返回内容为空');
    const analysis = normalizeAnalysis(extractJson(content));
    rememberAnalysis(cacheKey, { ts: Date.now(), result: analysis });
    return JSON.parse(JSON.stringify(analysis));
  }

  async function testAI() {
    const config = getAIConfig();
    if (!config.apiKey && !config.local) {
      return { ok: false, message: '尚未配置 API Key，请先在设置中填写。' };
    }
    const headers = Object.assign({ 'Content-Type': 'application/json' }, authHeaders(config));
    const started = Date.now();
    try {
      await requestJson(chatCompletionsUrl(config.baseUrl), {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          model: config.model,
          max_tokens: 8,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
        }),
        timeout: TEST_TIMEOUT,
      });
      const latency = Date.now() - started;
      const suffix = config.local ? '（本地服务）' : '';
      return { ok: true, latency: latency, message: '连接成功 · ' + config.model + ' · ' + latency + ' ms' + suffix };
    } catch (error) {
      return { ok: false, message: aiErrorMessage(error) };
    }
  }

  return {
    lookup: lookup,
    analyze: analyze,
    testAI: testAI,
    dictionary: dictionary,
    // 供主进程 / 测试使用
    cache: { lookups: lookupCache, analyses: analysisCache },
  };
}

module.exports = {
  createTranslationService,
  normalizeWord,
  detectKind,
  decodeHtmlEntities,
  isLocalBaseUrl,
};
