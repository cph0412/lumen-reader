'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeTempDir, cleanupDir } = require('./helpers');
const { createNotesService } = require('../src/main/services/notes');

function makeService(t) {
  const dataDir = makeTempDir('lumen-notes');
  t.after(function () { cleanupDir(dataDir); });
  return { service: createNotesService({ dataDir: dataDir }), dataDir: dataDir };
}

test('notes: 新增笔记形状与默认颜色', function (t) {
  const ctx = makeService(t);
  const note = ctx.service.add({
    bookId: 'bk_1',
    bookTitle: 'A Book',
    chapterIndex: 2,
    chapterTitle: 'Chapter 3',
    text: 'the curious incident of the dog',
    note: '这句很好',
    percent: 0.35,
  });
  assert.equal(note.bookId, 'bk_1');
  assert.equal(note.bookTitle, 'A Book');
  assert.equal(note.chapterIndex, 2);
  assert.equal(note.chapterTitle, 'Chapter 3');
  assert.equal(note.text, 'the curious incident of the dog');
  assert.equal(note.note, '这句很好');
  assert.equal(note.percent, 0.35);
  assert.equal(note.color, 'amber');
  assert.ok(!Number.isNaN(Date.parse(note.createdAt)));
  assert.ok(typeof note.id === 'string' && note.id.length > 0);

  const rose = ctx.service.add({ bookId: 'bk_1', text: 'x', note: 'y', color: 'rose' });
  assert.equal(rose.color, 'rose');
  const invalid = ctx.service.add({ bookId: 'bk_1', text: 'x', note: 'y', color: 'neon' });
  assert.equal(invalid.color, 'amber');
});

test('notes: 校验必填字段', function (t) {
  const ctx = makeService(t);
  assert.throws(function () { ctx.service.add({ bookId: 'b', note: '没有原文' }); }, function (err) { return err.code === 'INVALID_INPUT'; });
  assert.throws(function () { ctx.service.add({ bookId: 'b', text: '没有笔记' }); }, function (err) { return err.code === 'INVALID_INPUT'; });
});

test('notes: 按书籍过滤与倒序', function (t) {
  const ctx = makeService(t);
  ctx.service.add({ bookId: 'bk_1', text: 'a', note: 'n1' });
  ctx.service.add({ bookId: 'bk_2', text: 'b', note: 'n2' });
  ctx.service.add({ bookId: 'bk_1', text: 'c', note: 'n3' });
  assert.equal(ctx.service.list().length, 3);
  const forBook = ctx.service.list('bk_1');
  assert.equal(forBook.length, 2);
  forBook.forEach(function (note) { assert.equal(note.bookId, 'bk_1'); });
  assert.ok((Date.parse(forBook[0].createdAt) || 0) >= (Date.parse(forBook[1].createdAt) || 0));
});

test('notes: 删除与持久化', function (t) {
  const ctx = makeService(t);
  const note = ctx.service.add({ bookId: 'bk_1', text: 'a', note: 'n1' });
  assert.deepEqual(ctx.service.remove(note.id), { ok: true });
  assert.equal(ctx.service.list().length, 0);
  assert.throws(function () { ctx.service.remove(note.id); }, function (err) { return err.code === 'NOT_FOUND'; });

  const kept = ctx.service.add({ bookId: 'bk_9', text: 'keep', note: 'keep' });
  const reopened = createNotesService({ dataDir: ctx.dataDir });
  const notes = reopened.list();
  assert.equal(notes.length, 1);
  assert.equal(notes[0].id, kept.id);
});
