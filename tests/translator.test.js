'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeTempDir, cleanupDir } = require('./helpers');
const {
  createTranslationService,
  decodeHtmlEntities,
  detectKind,
  isLocalBaseUrl,
} = require('../src/main/services/translator');

const FENCE = String.fromCharCode(96).repeat(3);

function makeSettings(ai) {
  const config = Object.assign({
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.7,
    apiKey: '',
  }, ai || {});
  return {
    getRaw: function () { return { ai: Object.assign({}, config) }; },
    get: function () { return { general: { dailyGoalMinutes: 30 } }; },
  };
}

function makeFetch(handlers) {
  const calls = [];
  const impl = async function (url, options) {
    const target = String(url);
    calls.push({ url: target, options: options || {} });
    for (const handler of handlers) {
      if (handler.match === null || target.indexOf(handler.match) !== -1) {
        return handler.respond(target, options || {});
      }
    }
    throw new Error('unexpected url: ' + target);
  };
  impl.calls = calls;
  return impl;
}

function jsonResponse(data, status) {
  return { ok: status === undefined || status === 200, status: status || 200, json: async function () { return data; } };
}

const GOOGLE_OK = [[['你好，世界', 'Hello, world', null, null]], null, 'en'];

test('translator: Google 端点成功', async function () {
  const fetchImpl = makeFetch([{ match: 'translate.googleapis.com', respond: function () { return jsonResponse(GOOGLE_OK); } }]);
  const service = createTranslationService({ settings: makeSettings(), fetchImpl: fetchImpl });
  const result = await service.lookup({ text: 'Hello, world' });
  assert.equal(result.translation, '你好，世界');
  assert.equal(result.provider, 'google-free');
  assert.equal(result.kind, 'phrase');
  assert.equal(result.normalized, 'hello, world');
  assert.equal(result.dictionary, null);
  assert.equal(result.analyzed, false);
  assert.equal(result.error, undefined);
  const url = fetchImpl.calls[0].url;
  assert.ok(url.indexOf('https://translate.googleapis.com/translate_a/single') === 0);
  assert.ok(url.indexOf('client=gtx') !== -1);
  assert.ok(url.indexOf('sl=en') !== -1);
  assert.ok(url.indexOf('tl=zh-CN') !== -1);
  assert.ok(url.indexOf('dt=t') !== -1);
  assert.ok(url.indexOf('q=' + encodeURIComponent('Hello, world')) !== -1);
});

test('translator: 单词与句子类型识别', function () {
  assert.equal(detectKind('serendipity'), 'word');
  assert.equal(detectKind('a piece of cake'), 'phrase');
  assert.equal(detectKind('This is a complete sentence.'), 'sentence');
  assert.equal(detectKind(('word '.repeat(60)).trim()), 'paragraph');
});

test('translator: Google 失败降级 MyMemory，并反转义 HTML 实体', async function () {
  const fetchImpl = makeFetch([
    { match: 'translate.googleapis.com', respond: function () { throw new Error('blocked'); } },
    {
      match: 'api.mymemory.translated.net',
      respond: function () {
        return jsonResponse({ responseData: { translatedText: '&#20320;&#22909; &amp; hi' }, responseStatus: 200 });
      },
    },
  ]);
  const service = createTranslationService({ settings: makeSettings(), fetchImpl: fetchImpl });
  const result = await service.lookup({ text: 'Hello' });
  assert.equal(result.provider, 'mymemory');
  assert.equal(result.translation, '你好 & hi');
  assert.equal(result.kind, 'word');
  assert.equal(fetchImpl.calls.length, 2);
  assert.ok(fetchImpl.calls[1].url.indexOf('api.mymemory.translated.net/get') !== -1);
  assert.ok(fetchImpl.calls[1].url.indexOf('langpair=en|zh-CN') !== -1);
});

test('translator: 长段落按 MyMemory 限制分块翻译', async function () {
  const calls = [];
  const longText = ('This is a complete sentence with enough words to translate. ').repeat(24).trim();
  assert.ok(longText.length > 600);
  const fetchImpl = makeFetch([{
    match: 'api.mymemory.translated.net',
    respond: function (url) {
      calls.push(url);
      const chunk = decodeURIComponent(String(url).split('q=')[1].split('&langpair=')[0]);
      assert.ok(chunk.length <= 460, 'chunk too long: ' + chunk.length);
      return jsonResponse({ responseData: { translatedText: '译文' }, responseStatus: 200 });
    },
  }]);
  const service = createTranslationService({ settings: makeSettings(), fetchImpl: fetchImpl });
  const result = await service.lookup({ text: longText });
  assert.equal(result.error, undefined);
  assert.equal(result.provider, 'mymemory');
  assert.ok(result.translation.length >= 2);
  assert.ok(calls.length >= 2);
  assert.equal(fetchImpl.calls.filter(function (call) { return call.url.indexOf('api.mymemory') !== -1; }).length, calls.length);
});

test('translator: 两个免费端点都失败时返回 error 而不抛异常', async function () {
  const fetchImpl = makeFetch([{ match: null, respond: function () { throw new Error('offline'); } }]);
  const service = createTranslationService({ settings: makeSettings(), fetchImpl: fetchImpl });
  const result = await service.lookup({ text: 'Hello' });
  assert.equal(result.translation, '');
  assert.equal(result.error.code, 'NETWORK');
  assert.ok(result.error.message.length > 0);
  assert.equal(fetchImpl.calls.length, 2);
});

test('translator: 内存缓存命中（provider=cache）', async function () {
  const fetchImpl = makeFetch([{ match: 'translate.googleapis.com', respond: function () { return jsonResponse(GOOGLE_OK); } }]);
  const service = createTranslationService({ settings: makeSettings(), fetchImpl: fetchImpl });
  const first = await service.lookup({ text: 'Hello' });
  assert.equal(first.provider, 'google-free');
  const second = await service.lookup({ text: ' Hello. ' });
  assert.equal(second.provider, 'cache');
  assert.equal(second.translation, '你好，世界');
  assert.equal(fetchImpl.calls.length, 1);
});

test('translator: cache.json 持久化，重启后命中缓存', async function (t) {
  const dataDir = makeTempDir('lumen-cache');
  t.after(function () { cleanupDir(dataDir); });
  const settings = makeSettings();
  const firstFetch = makeFetch([{ match: 'translate.googleapis.com', respond: function () { return jsonResponse(GOOGLE_OK); } }]);
  const first = createTranslationService({ settings: settings, fetchImpl: firstFetch, dataDir: dataDir });
  await first.lookup({ text: 'Hello' });

  const secondFetch = makeFetch([{ match: null, respond: function () { throw new Error('should not fetch'); } }]);
  const second = createTranslationService({ settings: settings, fetchImpl: secondFetch, dataDir: dataDir });
  const result = await second.lookup({ text: 'Hello' });
  assert.equal(result.provider, 'cache');
  assert.equal(secondFetch.calls.length, 0);
});

test('translator: 无 AI Key 时 analyze 抛 NO_AI_KEY', async function () {
  const service = createTranslationService({ settings: makeSettings({ apiKey: '' }), fetchImpl: makeFetch([]) });
  await assert.rejects(service.analyze({ text: 'hello' }), function (err) {
    return err.code === 'NO_AI_KEY';
  });
});

test('translator: 本地 OpenAI 兼容服务无 Key 也可 analyze', async function () {
  const content = FENCE + 'json\n' + JSON.stringify({
    translation: '你好',
    sense: '见面时的问候',
    grammar: '感叹句',
    nuance: '口语',
    collocations: ['say hello'],
    examples: [{ en: 'She said hello.', zh: '她打了个招呼。' }],
    alternatives: ['hi'],
    level: 'a1',
  }) + '\n' + FENCE;
  const fetchImpl = makeFetch([{
    match: '/chat/completions',
    respond: function () { return jsonResponse({ choices: [{ message: { content: content } }] }); },
  }]);
  const service = createTranslationService({
    settings: makeSettings({ baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', apiKey: '' }),
    fetchImpl: fetchImpl,
  });
  const analysis = await service.analyze({ text: 'hello', context: 'She said hello.', chapterTitle: 'Chapter 1' });
  assert.equal(analysis.translation, '你好');
  assert.equal(analysis.sense, '见面时的问候');
  assert.equal(analysis.level, 'A1');
  assert.deepEqual(analysis.collocations, ['say hello']);
  assert.deepEqual(analysis.examples, [{ en: 'She said hello.', zh: '她打了个招呼。' }]);
  assert.deepEqual(analysis.alternatives, ['hi']);

  const call = fetchImpl.calls[0];
  assert.equal(call.url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(call.options.headers.Authorization, 'Bearer ollama');
  const body = JSON.parse(call.options.body);
  assert.equal(body.model, 'qwen2.5:7b');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.messages.length, 2);
  assert.ok(body.messages[1].content.indexOf('She said hello.') !== -1);
});

test('translator: 带 API Key 的远程 analyze 与 JSON 容错提取', async function () {
  const content = 'Sure, here is the result: ' + JSON.stringify({
    translation: '甲',
    sense: '乙',
    grammar: '丙',
    nuance: '丁',
    collocations: 'one；two',
    examples: [{ en: 'a', zh: 'b' }],
    alternatives: [],
  }) + ' hope this helps.';
  const fetchImpl = makeFetch([{
    match: '/chat/completions',
    respond: function () { return jsonResponse({ choices: [{ message: { content: content } }] }); },
  }]);
  const service = createTranslationService({
    settings: makeSettings({ apiKey: 'sk-test-key' }),
    fetchImpl: fetchImpl,
  });
  const analysis = await service.analyze({ text: 'alpha' });
  assert.equal(analysis.translation, '甲');
  assert.equal(analysis.sense, '乙');
  assert.deepEqual(analysis.collocations, ['one', 'two']);
  assert.equal(fetchImpl.calls[0].options.headers.Authorization, 'Bearer sk-test-key');
});

test('translator: analyze 结果缓存（同 text+context 只请求一次）', async function () {
  const fetchImpl = makeFetch([{
    match: '/chat/completions',
    respond: function () {
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({ translation: '译', sense: '义' }) } }] });
    },
  }]);
  const service = createTranslationService({ settings: makeSettings({ apiKey: 'k' }), fetchImpl: fetchImpl });
  const first = await service.analyze({ text: 'alpha', context: 'ctx' });
  const second = await service.analyze({ text: 'alpha', context: 'ctx' });
  assert.deepEqual(first, second);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(service.cache.analyses.size, 1);
});

test('translator: AI 返回无法解析的 JSON 时抛 AI_ERROR', async function () {
  const fetchImpl = makeFetch([{
    match: '/chat/completions',
    respond: function () { return jsonResponse({ choices: [{ message: { content: 'not json at all' } }] }); },
  }]);
  const service = createTranslationService({ settings: makeSettings({ apiKey: 'k' }), fetchImpl: fetchImpl });
  await assert.rejects(service.analyze({ text: 'alpha' }), function (err) {
    return err.code === 'AI_ERROR';
  });
});

test('translator: testAI 无 Key / 本地服务', async function () {
  const noKey = createTranslationService({ settings: makeSettings({ apiKey: '' }), fetchImpl: makeFetch([]) });
  const failed = await noKey.testAI();
  assert.equal(failed.ok, false);
  assert.ok(failed.message.indexOf('API Key') !== -1);

  const fetchImpl = makeFetch([{
    match: '/chat/completions',
    respond: function () { return jsonResponse({ choices: [{ message: { content: 'OK' } }] }); },
  }]);
  const local = createTranslationService({
    settings: makeSettings({ baseUrl: 'http://127.0.0.1:1234/v1', model: 'local-model', apiKey: '' }),
    fetchImpl: fetchImpl,
  });
  const passed = await local.testAI();
  assert.equal(passed.ok, true);
  assert.equal(typeof passed.latency, 'number');
  assert.ok(passed.message.indexOf('local-model') !== -1);
});

test('translator: dictionary 查询与失败降级', async function () {
  const fetchImpl = makeFetch([{
    match: 'dictionaryapi.dev',
    respond: function () {
      return jsonResponse([{
        word: 'hello',
        phonetic: '/həˈləʊ/',
        phonetics: [{ text: '/həˈləʊ/', audio: 'https://example.com/hello.mp3' }],
        meanings: [{ partOfSpeech: 'exclamation', definitions: [{ definition: 'used as a greeting', example: 'hello there' }] }],
      }]);
    },
  }]);
  const service = createTranslationService({ settings: makeSettings(), fetchImpl: fetchImpl });
  const entry = await service.dictionary('Hello');
  assert.equal(entry.word, 'hello');
  assert.equal(entry.phonetic, '/həˈləʊ/');
  assert.equal(entry.meanings.length, 1);
  assert.equal(entry.meanings[0].partOfSpeech, 'exclamation');
  assert.equal(entry.source, 'dictionaryapi');
  const again = await service.dictionary('hello');
  assert.equal(again.word, 'hello');
  assert.equal(fetchImpl.calls.length, 1, '第二次应命中缓存');

  const broken = createTranslationService({ settings: makeSettings(), fetchImpl: makeFetch([{ match: 'dictionaryapi.dev', respond: function () { throw new Error('down'); } }]) });
  assert.equal(await broken.dictionary('world'), null);
});

test('translator: 工具函数', function () {
  assert.equal(decodeHtmlEntities('&#20320;&#22909; &amp; &quot;hi&quot;'), '你好 & "hi"');
  assert.equal(isLocalBaseUrl('http://localhost:11434/v1'), true);
  assert.equal(isLocalBaseUrl('http://127.0.0.1:1234/v1'), true);
  assert.equal(isLocalBaseUrl('https://api.deepseek.com/v1'), false);
});
