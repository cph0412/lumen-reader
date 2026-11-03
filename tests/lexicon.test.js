'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createLexiconService,
  analyze,
  isLocalBaseUrl,
} = require('../src/main/services/lexicon');
const { PREFIXES, ROOTS, SUFFIXES } = require('../src/main/services/roots-data');

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

function chatResponse(payload) {
  return {
    choices: [{ message: { content: FENCE + 'json\n' + JSON.stringify(payload) + '\n' + FENCE } }],
  };
}

test('lexicon: 本地词根数据至少 60 条且都有含义', function () {
  const all = PREFIXES.concat(ROOTS, SUFFIXES);
  assert.ok(all.length >= 60, 'actual=' + all.length);
  for (const item of all) {
    assert.equal(typeof item.text, 'string');
    assert.ok(item.text.length >= 2, 'text too short: ' + item.text);
    assert.equal(typeof item.meaning, 'string');
    assert.ok(item.meaning.length > 0, 'missing meaning: ' + item.text);
  }
});

test('lexicon: analyze 拆解词根词缀并给出同族词', function () {
  const result = analyze('Unhappiness');
  assert.equal(result.word, 'Unhappiness');
  assert.equal(result.source, 'local');
  assert.ok(result.breakdown.indexOf('un-') !== -1);
  assert.ok(result.breakdown.indexOf('hap') !== -1);
  assert.ok(result.breakdown.indexOf('-ness') !== -1);
  assert.deepEqual(result.parts.map(function (p) { return p.type; }), ['prefix', 'root', 'suffix']);
  assert.ok(result.parts[0].meaning.length > 0);
  assert.ok(result.related.indexOf('happy') !== -1);
  assert.ok(result.related.length <= 8);
});

test('lexicon: 词首长词根优先（biography = bio + graph）', function () {
  const result = analyze('biography');
  const texts = result.parts.map(function (part) { return part.text; });
  assert.ok(texts.indexOf('bio') !== -1);
  assert.ok(texts.indexOf('graph') !== -1);
  assert.equal(texts.indexOf('bi-'), -1);
  assert.ok(result.related.indexOf('biology') !== -1 || result.related.indexOf('photograph') !== -1);
});

test('lexicon: 普通词保守处理，不硬拆', function () {
  for (const word of ['cat', 'banana', 'family', 'teacher', 'quickly', 'the']) {
    const result = analyze(word);
    assert.equal(result.source, 'local');
    assert.deepEqual(result.parts, [], word + ' 不应硬拆');
    assert.equal(result.breakdown, word);
    assert.deepEqual(result.related, []);
  }
});

test('lexicon: 无法识别的输入不抛异常', function () {
  assert.deepEqual(analyze('').parts, []);
  assert.deepEqual(analyze(null).parts, []);
  assert.deepEqual(analyze('12345').parts, []);
  assert.equal(analyze('  Inspection  ').word, 'Inspection');
});

test('lexicon: mnemonic 走 OpenAI 兼容接口并归一化结果', async function () {
  const fetchImpl = makeFetch([{
    match: '/chat/completions',
    respond: function () {
      return jsonResponse(chatResponse({
        mnemonic: '把 spect 想成「看」的聚光灯',
        associations: ['spectator 观众', 'inspect 检查', 'spectator 观众'],
        wordFamily: ['inspect', 'respect', 'spectator'],
      }));
    },
  }]);
  const service = createLexiconService({ settings: makeSettings({ apiKey: 'sk-test' }), fetchImpl: fetchImpl });
  const result = await service.mnemonic({ word: 'spectator', translation: '观众', context: 'The spectator cheered.' });
  assert.equal(result.mnemonic, '把 spect 想成「看」的聚光灯');
  assert.deepEqual(result.associations, ['spectator 观众', 'inspect 检查']);
  assert.deepEqual(result.wordFamily, ['inspect', 'respect', 'spectator']);
  assert.equal(result.source, 'ai');

  const call = fetchImpl.calls[0];
  assert.equal(call.url, 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(call.options.headers.Authorization, 'Bearer sk-test');
  const body = JSON.parse(call.options.body);
  assert.equal(body.model, 'deepseek-chat');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.messages.length, 2);
  assert.ok(body.messages[1].content.indexOf('spectator') !== -1);
  assert.ok(body.messages[1].content.indexOf('观众') !== -1);
});

test('lexicon: mnemonic 结果缓存（同输入只请求一次）', async function () {
  const fetchImpl = makeFetch([{
    match: '/chat/completions',
    respond: function () {
      return jsonResponse(chatResponse({ mnemonic: '联想', associations: ['a'], wordFamily: [] }));
    },
  }]);
  const service = createLexiconService({ settings: makeSettings({ apiKey: 'k' }), fetchImpl: fetchImpl });
  const first = await service.mnemonic({ word: 'alpha', translation: '甲' });
  const second = await service.mnemonic({ word: 'Alpha', translation: '甲' });
  assert.deepEqual(first, second);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(service.cacheSize(), 1);
});

test('lexicon: 无 AI Key 抛 NO_AI_KEY，本地服务无 Key 可用', async function () {
  const noKey = createLexiconService({ settings: makeSettings({ apiKey: '' }), fetchImpl: makeFetch([]) });
  await assert.rejects(noKey.mnemonic({ word: 'hello' }), function (err) {
    return err.code === 'NO_AI_KEY';
  });

  const fetchImpl = makeFetch([{
    match: '/chat/completions',
    respond: function () {
      return jsonResponse(chatResponse({ mnemonic: '本地联想', associations: [], wordFamily: [] }));
    },
  }]);
  const local = createLexiconService({
    settings: makeSettings({ apiKey: '', baseUrl: 'http://localhost:11434/v1', model: 'qwen' }),
    fetchImpl: fetchImpl,
  });
  assert.equal(isLocalBaseUrl('http://127.0.0.1:1234/v1'), true);
  assert.equal(isLocalBaseUrl('https://api.deepseek.com/v1'), false);
  const result = await local.mnemonic({ word: 'hello' });
  assert.equal(result.mnemonic, '本地联想');
  assert.equal(fetchImpl.calls[0].options.headers.Authorization, 'Bearer ollama');
});

test('lexicon: AI 返回非法 JSON 或缺少 mnemonic 时抛 AI_ERROR', async function () {
  const badJson = createLexiconService({
    settings: makeSettings({ apiKey: 'k' }),
    fetchImpl: makeFetch([{
      match: '/chat/completions',
      respond: function () { return jsonResponse({ choices: [{ message: { content: 'not json' } }] }); },
    }]),
  });
  await assert.rejects(badJson.mnemonic({ word: 'alpha' }), function (err) {
    return err.code === 'AI_ERROR';
  });

  const emptyMnemonic = createLexiconService({
    settings: makeSettings({ apiKey: 'k' }),
    fetchImpl: makeFetch([{
      match: '/chat/completions',
      respond: function () {
        return jsonResponse({ choices: [{ message: { content: JSON.stringify({ associations: ['x'] }) } }] });
      },
    }]),
  });
  await assert.rejects(emptyMnemonic.mnemonic({ word: 'alpha' }), function (err) {
    return err.code === 'AI_ERROR';
  });
});

test('lexicon: 网络失败返回 NETWORK 错误', async function () {
  const service = createLexiconService({
    settings: makeSettings({ apiKey: 'k' }),
    fetchImpl: makeFetch([{ match: null, respond: function () { throw new Error('offline'); } }]),
  });
  await assert.rejects(service.mnemonic({ word: 'alpha' }), function (err) {
    return err.code === 'NETWORK';
  });
});
