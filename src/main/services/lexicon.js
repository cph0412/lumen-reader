'use strict';

// lexicon.js — 词根词缀分析（本地） + AI 联想记忆（OpenAI 兼容接口）
// - analyze(word) 纯本地、同步，保守匹配前缀/词根/后缀，避免把普通词硬拆
// - mnemonic({word,translation,context}) 走 settings.getRaw().ai；无 Key 抛 NO_AI_KEY
// - 两者都有内存缓存；不依赖 electron，fetch 可注入

const crypto = require('node:crypto');
const { PREFIXES, ROOTS, SUFFIXES } = require('./roots-data');

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';
const AI_TIMEOUT = 40000;
const MNEMONIC_CACHE_LIMIT = 200;
const MAX_RELATED = 8;
const MAX_PARTS = 4;

const MNEMONIC_SYSTEM_PROMPT = [
  '你是一位中文母语的英语词汇教练，擅长用联想、谐音和场景帮助记忆单词。',
  '只输出一个 JSON 对象，不要输出 Markdown 或额外说明。',
  'JSON 字段：',
  '{"mnemonic":"一句中文联想/谐音/场景记忆，尽量具体",',
  '"associations":["2-5 条中文联想或相关表达"],',
  '"wordFamily":["同根/同族词，可为空数组"]}',
  '所有字段都必须存在。',
].join('\n');

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function normalizeWord(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeSpace(text) {
  return String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim();
}

function isLocalBaseUrl(baseUrl) {
  try {
    const host = new URL(String(baseUrl || '')).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host.endsWith('.localhost');
  } catch (err) {
    return false;
  }
}

function hashKey(parts) {
  return crypto.createHash('sha1').update(parts.join('\u0000')).digest('hex');
}

function toStringArray(value, limit) {
  const max = limit || 6;
  if (typeof value === 'string') {
    return value.split(/\n|；|;/).map(function (item) { return item.trim(); }).filter(Boolean).slice(0, max);
  }
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const output = [];
  for (const item of value) {
    const text = typeof item === 'string'
      ? item.trim()
      : (item && typeof item === 'object' ? normalizeSpace(item.text || item.word || item.value || '') : '');
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
    if (output.length >= max) break;
  }
  return output;
}

function getAIConfig(settings) {
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

function pickPrefix(word) {
  let best = null;
  for (const item of PREFIXES) {
    if (word.indexOf(item.text) !== 0) continue;
    if (word.length - item.text.length < 4) continue;
    if (!best || item.text.length > best.text.length) best = item;
  }
  return best;
}

function pickSuffix(word) {
  let best = null;
  for (const item of SUFFIXES) {
    if (word.length < item.text.length || word.slice(word.length - item.text.length) !== item.text) continue;
    if (word.length - item.text.length < 3) continue;
    if (!best || item.text.length > best.text.length) best = item;
  }
  return best;
}

function collectRoots(word, start, end) {
  const found = [];
  if (end - start < 3) return found;
  for (const item of ROOTS) {
    let from = start;
    while (from <= end - item.text.length) {
      const index = word.indexOf(item.text, from);
      if (index === -1 || index + item.text.length > end) break;
      found.push({ item: item, index: index });
      from = index + 1;
    }
  }
  found.sort(function (a, b) {
    return (b.item.text.length - a.item.text.length) || (a.index - b.index);
  });
  return found;
}

function analyze(input) {
  const raw = String(input === undefined || input === null ? '' : input).trim();
  const result = {
    word: raw,
    breakdown: raw,
    parts: [],
    related: [],
    source: 'local',
  };
  const word = normalizeWord(raw).replace(/[^a-z]/g, '');
  if (!word || word.length < 5 || !/^[a-z]+$/.test(word)) return result;
  result.word = raw || word;

  let prefix = pickPrefix(word);
  let suffix = pickSuffix(word);
  // 词首若存在比前缀更长的词根（如 biography = bio + graph），优先按词根处理
  if (prefix) {
    let leadingRoot = null;
    for (const item of ROOTS) {
      if (word.indexOf(item.text) !== 0) continue;
      if (item.text.length <= prefix.text.length) continue;
      if (word.length - item.text.length < 2) continue;
      if (!leadingRoot || item.text.length > leadingRoot.text.length) leadingRoot = item;
    }
    if (leadingRoot) prefix = null;
  }
  if (prefix && suffix && prefix.text.length + suffix.text.length >= word.length) {
    if (prefix.text.length >= suffix.text.length) suffix = null;
    else prefix = null;
  }
  const start = prefix ? prefix.text.length : 0;
  const end = suffix ? word.length - suffix.text.length : word.length;

  const rootCandidates = collectRoots(word, start, end);
  const pickedRoots = [];
  for (const candidate of rootCandidates) {
    const item = candidate.item;
    const overlaps = pickedRoots.some(function (picked) {
      return candidate.index < picked.index + picked.item.text.length &&
        picked.index < candidate.index + item.text.length;
    });
    if (overlaps) continue;
    if (item.text.length < 4 && !prefix && !suffix) {
      // 三字母词根只在词首且后面还有足够内容时采纳（bio + graph）
      if (!(candidate.index === 0 && word.length - item.text.length >= 4)) continue;
    }
    if (!prefix && !suffix) {
      const outside = word.length - item.text.length;
      if (outside < 2) continue;
      if (candidate.index === 0 && item.text.length === word.length) continue;
    }
    pickedRoots.push(candidate);
    if (pickedRoots.length >= 2) break;
  }
  pickedRoots.sort(function (a, b) { return a.index - b.index; });

  const hasRoot = pickedRoots.length > 0;
  let finalPrefix = prefix;
  let finalSuffix = suffix;
  if (finalPrefix && finalPrefix.strict && !hasRoot) {
    finalSuffix = finalSuffix && !finalSuffix.strict ? finalSuffix : null;
    if (!finalSuffix) finalPrefix = null;
  }
  if (finalSuffix && finalSuffix.strict && !hasRoot && !(finalPrefix && !finalPrefix.strict)) {
    finalSuffix = null;
  }
  if (!finalPrefix && !finalSuffix && !hasRoot) return result;

  const parts = [];
  if (finalPrefix) {
    parts.push({
      text: finalPrefix.text + '-',
      type: 'prefix',
      meaning: finalPrefix.meaning,
    });
  }
  for (const picked of pickedRoots) {
    parts.push({
      text: picked.item.text,
      type: 'root',
      meaning: picked.item.meaning,
    });
  }
  if (finalSuffix) {
    parts.push({
      text: '-' + finalSuffix.text,
      type: 'suffix',
      meaning: finalSuffix.meaning,
    });
  }
  if (parts.length > MAX_PARTS) parts.length = MAX_PARTS;

  const related = [];
  const seen = new Set([word]);
  const sources = [];
  if (finalPrefix) sources.push(finalPrefix);
  for (const picked of pickedRoots) sources.push(picked.item);
  if (finalSuffix) sources.push(finalSuffix);
  for (const source of sources) {
    const examples = Array.isArray(source.examples) ? source.examples : [];
    for (const example of examples) {
      const value = String(example || '').trim();
      const key = value.toLowerCase();
      if (!value || seen.has(key)) continue;
      seen.add(key);
      related.push(value);
      if (related.length >= MAX_RELATED) break;
    }
    if (related.length >= MAX_RELATED) break;
  }

  result.breakdown = parts.map(function (part) {
    return part.text + '（' + part.meaning + '）';
  }).join(' + ');
  result.parts = parts;
  result.related = related;
  return result;
}

function createLexiconService(options) {
  const opts = options || {};
  const settings = opts.settings || null;
  const fetchImpl = typeof opts.fetchImpl === 'function'
    ? opts.fetchImpl
    : (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const cache = new Map();

  function remember(key, result) {
    cache.set(key, { ts: Date.now(), result: result });
    while (cache.size > MNEMONIC_CACHE_LIMIT) {
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

  async function requestJson(url, requestOptions) {
    if (!fetchImpl) throw fail('NETWORK', '当前环境没有 fetch');
    const options = requestOptions || {};
    const controller = new AbortController();
    const timer = setTimeout(function () {
      try { controller.abort(); } catch (err) { /* 忽略 */ }
    }, options.timeout || AI_TIMEOUT);
    try {
      const response = await fetchImpl(url, {
        method: options.method || 'POST',
        headers: options.headers || {},
        body: options.body,
        signal: controller.signal,
      });
      if (!response) throw fail('NETWORK', '网络无响应');
      const ok = typeof response.ok === 'boolean'
        ? response.ok
        : (typeof response.status === 'number' ? response.status >= 200 && response.status < 300 : true);
      if (!ok) {
        const httpError = new Error('HTTP ' + (response.status === undefined ? '?' : response.status));
        httpError.status = response.status;
        throw httpError;
      }
      if (typeof response.json === 'function') return await response.json();
      if (typeof response.text === 'function') return JSON.parse(await response.text());
      throw fail('NETWORK', '响应格式无法解析');
    } catch (error) {
      if (error && error.name === 'AbortError') throw fail('TIMEOUT', 'AI 请求超时');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function mnemonic(input) {
    const payload = input || {};
    const word = normalizeSpace(payload.word);
    if (!word) throw fail('INVALID_INPUT', '单词不能为空');
    const translation = normalizeSpace(payload.translation || '');
    const context = normalizeSpace(payload.context || '').slice(0, 1200);
    const cacheKey = hashKey([word.toLowerCase(), translation, context]);
    const cached = cache.get(cacheKey);
    if (cached && cached.result) return JSON.parse(JSON.stringify(cached.result));

    const config = getAIConfig(settings);
    if (!config.apiKey && !config.local) {
      throw fail('NO_AI_KEY', '尚未配置 AI API Key，无法生成联想记忆。');
    }

    const userContent = [
      '单词：' + word,
      translation ? '中文释义：' + translation : '',
      context ? '所在语境：' + context : '',
    ].filter(Boolean).join('\n');
    const headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers.Authorization = 'Bearer ' + config.apiKey;
    else if (config.local) headers.Authorization = 'Bearer ollama';
    const body = {
      model: config.model,
      temperature: config.temperature,
      max_tokens: 700,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: MNEMONIC_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    };
    const url = chatCompletionsUrl(config.baseUrl);

    let data;
    try {
      data = await requestJson(url, { method: 'POST', headers: headers, body: JSON.stringify(body), timeout: AI_TIMEOUT });
    } catch (error) {
      if (error && error.status === 400) {
        const fallbackBody = Object.assign({}, body);
        delete fallbackBody.response_format;
        try {
          data = await requestJson(url, { method: 'POST', headers: headers, body: JSON.stringify(fallbackBody), timeout: AI_TIMEOUT });
        } catch (secondError) {
          throw fail('NETWORK', '生成联想记忆失败：' + (secondError.message || '网络错误'));
        }
      } else if (error && error.code === 'TIMEOUT') {
        throw error;
      } else {
        throw fail('NETWORK', '生成联想记忆失败：' + (error.message || '网络错误'));
      }
    }

    const choices = data && Array.isArray(data.choices) ? data.choices : [];
    const content = choices[0] && choices[0].message ? choices[0].message.content : null;
    if (!content) throw fail('AI_ERROR', 'AI 返回内容为空');
    const parsed = extractJson(content);
    const mnemonicText = normalizeSpace(parsed.mnemonic || parsed.memory || parsed.association || '');
    if (!mnemonicText) throw fail('AI_ERROR', 'AI 返回内容缺少 mnemonic');
    const result = {
      mnemonic: mnemonicText,
      associations: toStringArray(parsed.associations || parsed.association || parsed.related, 5),
      wordFamily: toStringArray(parsed.wordFamily || parsed.word_family || parsed.family, 8),
      source: 'ai',
    };
    remember(cacheKey, result);
    return JSON.parse(JSON.stringify(result));
  }

  return {
    analyze: analyze,
    mnemonic: mnemonic,
    cacheSize: function () { return cache.size; },
    cache: cache,
  };
}

module.exports = {
  createLexiconService,
  analyze,
  isLocalBaseUrl,
  normalizeWord,
};
