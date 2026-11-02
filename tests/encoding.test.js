'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectAndDecode, garbleRatio, looksGarbled } = require('../src/main/util/encoding');

function swapPairs(buffer) {
  const out = Buffer.alloc(buffer.length);
  for (let i = 0; i + 1 < buffer.length; i += 2) {
    out[i] = buffer[i + 1];
    out[i + 1] = buffer[i];
  }
  return out;
}

test('encoding: 纯 UTF-8', function () {
  const result = detectAndDecode(Buffer.from('Hello, world! 你好。', 'utf8'));
  assert.equal(result.encoding, 'utf-8');
  assert.equal(result.text, 'Hello, world! 你好。');
});

test('encoding: UTF-8 BOM', function () {
  const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Hello', 'utf8')]);
  const result = detectAndDecode(buffer);
  assert.equal(result.encoding, 'utf-8-bom');
  assert.equal(result.text, 'Hello');
});

test('encoding: UTF-16LE BOM', function () {
  const buffer = Buffer.from('\uFEFFHello 世界', 'utf16le');
  const result = detectAndDecode(buffer);
  assert.equal(result.encoding, 'utf-16le');
  assert.equal(result.text, 'Hello 世界');
});

test('encoding: UTF-16BE BOM', function () {
  const body = Buffer.from('Hello 世界', 'utf16le');
  const buffer = Buffer.concat([Buffer.from([0xfe, 0xff]), swapPairs(body)]);
  const result = detectAndDecode(buffer);
  assert.equal(result.encoding, 'utf-16be');
  assert.equal(result.text, 'Hello 世界');
});

test('encoding: GB18030 回退（GBK 中文）', function () {
  // "Hello 中文" 的 GBK 字节：中 = D6D0，文 = CEC4
  const buffer = Buffer.concat([Buffer.from('Hello ', 'ascii'), Buffer.from([0xd6, 0xd0, 0xce, 0xc4])]);
  const result = detectAndDecode(buffer);
  assert.equal(result.encoding, 'gb18030');
  assert.equal(result.text, 'Hello 中文');
});

test('encoding: GB18030 长文本回退', function () {
  const chineseBytes = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4]);
  const buffer = Buffer.concat([Buffer.from('Chapter 1\n', 'ascii'), chineseBytes, Buffer.from('\nmore text here', 'ascii')]);
  const result = detectAndDecode(buffer);
  assert.equal(result.encoding, 'gb18030');
  assert.ok(result.text.indexOf('中文测试') !== -1);
});

test('encoding: 少量坏字节的 UTF-8 保持 utf-8', function () {
  const head = Buffer.from('x'.repeat(200) + 'hello ', 'utf8');
  const tail = Buffer.from(' world ' + 'y'.repeat(200), 'utf8');
  const buffer = Buffer.concat([head, Buffer.from([0x80]), tail]);
  const result = detectAndDecode(buffer);
  assert.equal(result.encoding, 'utf-8');
  assert.ok(result.text.indexOf('hello') !== -1 && result.text.indexOf('world') !== -1);
  assert.ok(result.text.indexOf('\uFFFD') !== -1);
});

test('encoding: 空 Buffer', function () {
  const result = detectAndDecode(Buffer.alloc(0));
  assert.equal(result.text, '');
  assert.equal(result.encoding, 'utf-8');
});

test('encoding: 乱码比例与判断', function () {
  assert.equal(garbleRatio('hello world'), 0);
  assert.ok(garbleRatio('a\uFFFDb') > 0.3);
  assert.equal(looksGarbled('正常文本'), false);
  assert.equal(looksGarbled('a\uFFFDb'), true);
});
