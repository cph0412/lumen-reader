'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeTempDir, cleanupDir } = require('./helpers');
const { createJsonStore } = require('../src/main/services/store');

test('store: 首次读取自动创建默认值', function (t) {
  const dir = makeTempDir('store');
  t.after(function () { cleanupDir(dir); });
  const filePath = path.join(dir, 'nested', 'library.json');
  const store = createJsonStore({ filePath: filePath, defaults: function () { return { books: [] }; } });
  const data = store.read();
  assert.deepEqual(data, { books: [] });
  assert.ok(fs.existsSync(filePath));
  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.deepEqual(onDisk, { books: [] });
});

test('store: write / read / update 持久化', function (t) {
  const dir = makeTempDir('store');
  t.after(function () { cleanupDir(dir); });
  const filePath = path.join(dir, 'data.json');
  const store = createJsonStore({ filePath: filePath, defaults: { count: 0, items: [] } });
  store.write({ count: 3, items: ['a'] });
  assert.deepEqual(store.read(), { count: 3, items: ['a'] });
  const next = store.update(function (data) {
    data.count += 1;
    data.items.push('b');
    return data;
  });
  assert.equal(next.count, 4);
  const reopened = createJsonStore({ filePath: filePath, defaults: {} });
  assert.deepEqual(reopened.read(), { count: 4, items: ['a', 'b'] });
});

test('store: 原子写不留临时文件', function (t) {
  const dir = makeTempDir('store');
  t.after(function () { cleanupDir(dir); });
  const filePath = path.join(dir, 'data.json');
  const store = createJsonStore({ filePath: filePath, defaults: {} });
  store.write({ ok: 1 });
  store.write({ ok: 2 });
  const files = fs.readdirSync(dir);
  assert.deepEqual(files, ['data.json']);
});

test('store: 损坏文件备份为 .corrupt-* 并重建默认值', function (t) {
  const dir = makeTempDir('store');
  t.after(function () { cleanupDir(dir); });
  const filePath = path.join(dir, 'data.json');
  fs.writeFileSync(filePath, '{ this is not json', 'utf8');
  const store = createJsonStore({ filePath: filePath, defaults: { rebuilt: true } });
  const data = store.read();
  assert.deepEqual(data, { rebuilt: true });
  const files = fs.readdirSync(dir);
  const backupName = files.find(function (name) { return name.indexOf('data.json.corrupt-') === 0; });
  assert.ok(backupName, '应生成损坏备份，实际文件：' + files.join(', '));
  assert.equal(fs.readFileSync(path.join(dir, backupName), 'utf8'), '{ this is not json');
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), { rebuilt: true });
});

test('store: 返回值为独立副本', function (t) {
  const dir = makeTempDir('store');
  t.after(function () { cleanupDir(dir); });
  const filePath = path.join(dir, 'data.json');
  const store = createJsonStore({ filePath: filePath, defaults: { list: [1] } });
  const first = store.read();
  first.list.push(2);
  assert.deepEqual(store.read(), { list: [1] });
});
