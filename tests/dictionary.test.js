'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDictionaryService,
  parseFreeEntry,
  parseOxfordEntry,
  normalizeWord,
} = require('../src/main/services/dictionary');

function makeSettings(dictionary) {
  return {
    getRaw: function () {
      return { dictionary: dictionary || {} };
    },
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
  return {
    ok: status === undefined || status === 200,
    status: status || 200,
    json: async function () { return data; },
  };
}

const FREE_DATA = [{
  word: 'hello',
  phonetic: '/həˈləʊ/',
  phonetics: [{ text: '/həˈləʊ/', audio: 'https://example.com/hello.mp3' }],
  origin: 'Old English &quot;h&#275;l&#257;n&quot;',
  sourceUrls: ['https://dictionaryapi.dev/e/hello'],
  meanings: [{
    partOfSpeech: 'exclamation',
    definitions: [{
      definition: 'used as a greeting &amp; an expression of surprise',
      example: 'she said &quot;hello&quot; softly',
      synonyms: ['hi', 'greetings'],
      antonyms: ['goodbye'],
    }],
    synonyms: ['hey'],
    antonyms: [],
  }],
}];

const OXFORD_DATA = {
  results: [{
    word: 'hello',
    lexicalEntries: [{
      lexicalCategory: { id: 'exclamation' },
      pronunciations: [{ phoneticSpelling: 'həˈləʊ', audioFile: 'https://oxford/hello.mp3' }],
      entries: [{
        etymologies: ['from Old English'],
        senses: [{
          definitions: ['used as a greeting'],
          examples: [{ text: 'hello there' }],
          synonyms: [{ text: 'hi' }],
          antonyms: [{ text: 'goodbye' }],
        }],
      }],
    }],
  }],
};

test('dictionary: 免费词典解析音标/音频/词性/释义/例句/同反义词/词源/URL', async function () {
  const fetchImpl = makeFetch([{ match: 'dictionaryapi.dev', respond: function () { return jsonResponse(FREE_DATA); } }]);
  const service = createDictionaryService({ settings: makeSettings({ provider: 'auto' }), fetchImpl: fetchImpl });
  const result = await service.lookup('Hello!');
  assert.equal(result.word, 'hello');
  assert.equal(result.phonetic, '/həˈləʊ/');
  assert.equal(result.audio, 'https://example.com/hello.mp3');
  assert.equal(result.source, 'free');
  assert.equal(result.sourceLabel, '开放词典');
  assert.ok(result.origin.indexOf('Old English "hēlān"') !== -1, 'HTML entity 应被还原');
  assert.equal(result.url, 'https://dictionaryapi.dev/e/hello');
  assert.equal(result.meanings.length, 1);
  const meaning = result.meanings[0];
  assert.equal(meaning.partOfSpeech, 'exclamation');
  assert.equal(meaning.definition, 'used as a greeting & an expression of surprise');
  assert.equal(meaning.example, 'she said "hello" softly');
  assert.deepEqual(meaning.synonyms, ['hi', 'greetings', 'hey']);
  assert.deepEqual(meaning.antonyms, ['goodbye']);
  assert.deepEqual(result.synonyms.slice().sort(), ['greetings', 'hey', 'hi']);
  assert.deepEqual(result.antonyms, ['goodbye']);
  assert.equal(fetchImpl.calls.length, 1);
  assert.ok(fetchImpl.calls[0].url.indexOf('https://api.dictionaryapi.dev/api/v2/entries/en/hello') === 0);
});

test('dictionary: 内存缓存命中且归一化大小写/标点', async function () {
  const fetchImpl = makeFetch([{ match: 'dictionaryapi.dev', respond: function () { return jsonResponse(FREE_DATA); } }]);
  const service = createDictionaryService({ settings: makeSettings(), fetchImpl: fetchImpl });
  const first = await service.lookup('hello');
  const second = await service.lookup(' HELLO. ');
  assert.equal(fetchImpl.calls.length, 1);
  assert.deepEqual(first, second);
  assert.equal(service.peek('hello').word, 'hello');
  assert.equal(service.cacheSize(), 1);
});

test('dictionary: auto 有牛津凭证时优先牛津，URL/headers/解析正确', async function () {
  const fetchImpl = makeFetch([{ match: 'od-api.oxforddictionaries.com', respond: function () { return jsonResponse(OXFORD_DATA); } }]);
  const service = createDictionaryService({
    settings: makeSettings({ provider: 'auto', oxfordAppId: 'app-id-1', oxfordAppKey: 'app-key-1' }),
    fetchImpl: fetchImpl,
  });
  const result = await service.lookup('Hello');
  assert.equal(result.source, 'oxford');
  assert.equal(result.sourceLabel, '牛津词典');
  assert.equal(result.phonetic, 'həˈləʊ');
  assert.equal(result.audio, 'https://oxford/hello.mp3');
  assert.equal(result.origin, 'from Old English');
  assert.equal(result.meanings[0].partOfSpeech, 'exclamation');
  assert.equal(result.meanings[0].definition, 'used as a greeting');
  assert.equal(result.meanings[0].example, 'hello there');
  assert.deepEqual(result.meanings[0].synonyms, ['hi']);
  assert.deepEqual(result.meanings[0].antonyms, ['goodbye']);

  const call = fetchImpl.calls[0];
  assert.ok(call.url.indexOf('https://od-api.oxforddictionaries.com/api/v2/entries/en-gb/hello') === 0);
  assert.ok(call.url.indexOf('fields=') !== -1);
  assert.ok(decodeURIComponent(call.url).indexOf('definitions,examples,pronunciations,synonyms,antonyms,etymologies,lexicalCategory') !== -1);
  assert.equal(call.options.headers.app_id, 'app-id-1');
  assert.equal(call.options.headers.app_key, 'app-key-1');
});

test('dictionary: provider=free 时即使有凭证也不用牛津', async function () {
  const fetchImpl = makeFetch([{ match: 'dictionaryapi.dev', respond: function () { return jsonResponse(FREE_DATA); } }]);
  const service = createDictionaryService({
    settings: makeSettings({ provider: 'free', oxfordAppId: 'id', oxfordAppKey: 'key' }),
    fetchImpl: fetchImpl,
  });
  const result = await service.lookup('hello');
  assert.equal(result.source, 'free');
  assert.equal(fetchImpl.calls.length, 1);
  assert.ok(fetchImpl.calls[0].url.indexOf('dictionaryapi.dev') !== -1);
});

test('dictionary: 牛津失败回退免费源并标记 fallbackFrom', async function () {
  const fetchImpl = makeFetch([
    { match: 'od-api.oxforddictionaries.com', respond: function () { throw new Error('oxford down'); } },
    { match: 'dictionaryapi.dev', respond: function () { return jsonResponse(FREE_DATA); } },
  ]);
  const service = createDictionaryService({
    settings: makeSettings({ provider: 'oxford', oxfordAppId: 'id', oxfordAppKey: 'key' }),
    fetchImpl: fetchImpl,
  });
  const result = await service.lookup('hello');
  assert.equal(result.source, 'free');
  assert.equal(result.fallbackFrom, 'oxford');
  assert.equal(fetchImpl.calls.length, 2);

  const fallback = await service.testDictionary();
  assert.equal(fallback.ok, true);
  assert.equal(fallback.provider, 'free');
  assert.ok(fallback.message.indexOf('回退') !== -1 || fallback.message.indexOf('开放词典') !== -1);
});

test('dictionary: 全部失败返回 null，testDictionary 返回可读错误', async function () {
  const fetchImpl = makeFetch([{ match: null, respond: function () { throw new Error('offline'); } }]);
  const service = createDictionaryService({ settings: makeSettings({ provider: 'free' }), fetchImpl: fetchImpl });
  assert.equal(await service.lookup('world'), null);
  const tested = await service.testDictionary();
  assert.equal(tested.ok, false);
  assert.equal(tested.provider, 'free');
  assert.ok(tested.message.length > 0);

  const oxford = createDictionaryService({
    settings: makeSettings({ provider: 'oxford', oxfordAppId: '', oxfordAppKey: '' }),
    fetchImpl: fetchImpl,
  });
  const oxfordTested = await oxford.testDictionary();
  assert.equal(oxfordTested.ok, false);
  assert.equal(oxfordTested.provider, 'oxford');
});

test('dictionary: 缓存最多 200 条', async function () {
  const fetchImpl = makeFetch([{
    match: 'dictionaryapi.dev',
    respond: function (url) {
      const word = decodeURIComponent(String(url).split('/en/')[1] || 'word');
      return jsonResponse([{ word: word, meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'word ' + word }] }] }]);
    },
  }]);
  const service = createDictionaryService({ settings: makeSettings({ provider: 'free' }), fetchImpl: fetchImpl });
  for (let i = 0; i < 205; i += 1) {
    await service.lookup('cacheword' + i);
  }
  assert.equal(service.cacheSize(), 200);
});

test('dictionary: 解析函数可独立使用', function () {
  assert.equal(normalizeWord('  "Hello," '), 'hello');
  const free = parseFreeEntry(FREE_DATA, 'hello');
  assert.equal(free.source, 'free');
  const oxford = parseOxfordEntry(OXFORD_DATA, 'hello');
  assert.equal(oxford.source, 'oxford');
  assert.equal(parseFreeEntry([], 'x'), null);
  assert.equal(parseOxfordEntry({ results: [] }, 'x'), null);
});
