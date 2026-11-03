'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createLocalDictionaryService } = require('../src/main/services/local-dictionary');
const { createDictionaryService } = require('../src/main/services/dictionary');

const DICTIONARY_DIR = path.join(__dirname, '..', 'resources', 'dictionaries');

function settingsWith(provider) {
  return {
    getRaw() {
      return { dictionary: { provider: provider || 'auto' } };
    }
  };
}

test('local dictionary: manifest and shards load', () => {
  const local = createLocalDictionaryService({ dictionaryDir: DICTIONARY_DIR });
  const stats = local.stats();
  assert.ok(stats.total >= 90000, 'expected at least 90000 merged entries');
  assert.equal(stats.shards, 26);
});

test('local dictionary: TOEFL structured meanings come first', () => {
  const local = createLocalDictionaryService({ dictionaryDir: DICTIONARY_DIR });
  const back = local.lookup('back');
  assert.ok(back);
  assert.equal(back.source, 'local');
  assert.equal(back.sourceLabel, '内置词典');
  assert.ok(back.meanings.length > 0);
  assert.equal(back.meanings[0].definitionZh, '回原处');
  assert.ok(back.phrases.length > 0);
});

test('local dictionary: cigen/GRE roots and mnemonics are available', () => {
  const local = createLocalDictionaryService({ dictionaryDir: DICTIONARY_DIR });
  const abacus = local.lookup('abacus');
  assert.ok(abacus);
  assert.ok(abacus.meanings.some((item) => String(item.definitionZh).includes('算盘')));
  assert.match(abacus.mnemonic || '', /算盘|ab|刻死/);
  assert.match(abacus.roots || '', /希伯来|abaq/);
});

test('local dictionary: unknown word returns null', () => {
  const local = createLocalDictionaryService({ dictionaryDir: DICTIONARY_DIR });
  assert.equal(local.lookup('zzzz-not-a-real-word'), null);
});

test('dictionary service: bundled data wins without network', async () => {
  const local = createLocalDictionaryService({ dictionaryDir: DICTIONARY_DIR });
  const dictionary = createDictionaryService({
    settings: settingsWith('free'),
    localDictionary: local,
    fetchImpl: async () => { throw new Error('network should not be used'); }
  });
  const result = await dictionary.lookup('abacus');
  assert.ok(result);
  assert.equal(result.source, 'local');
  assert.equal(result.sourceLabel, '内置词典');
  const tested = await dictionary.testDictionary();
  assert.equal(tested.provider, 'local');
  assert.equal(tested.ok, true);
});
