'use strict';

// notes.js — 阅读笔记 CRUD（dataDir/notes.json，原子写）

const path = require('node:path');
const crypto = require('node:crypto');
const { createJsonStore } = require('./store');

const COLORS = ['amber', 'rose', 'sage', 'sky'];

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function randomId() {
  return 'n_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function createNotesService(options) {
  const opts = options || {};
  const dataDir = opts.dataDir;
  if (!dataDir) throw new TypeError('createNotesService 需要 dataDir');
  const store = opts.store || createJsonStore({
    filePath: path.join(dataDir, 'notes.json'),
    defaults: function () { return { notes: [] }; },
  });

  function readNotes() {
    const data = store.read();
    if (!data || typeof data !== 'object' || !Array.isArray(data.notes)) return [];
    return data.notes.filter(function (note) {
      return note && typeof note === 'object' && typeof note.id === 'string';
    });
  }

  function persist(notes) {
    store.write({ notes: notes });
  }

  function list(bookId) {
    const notes = readNotes().slice();
    const id = typeof bookId === 'string' ? bookId : '';
    const filtered = id ? notes.filter(function (note) { return note.bookId === id; }) : notes;
    filtered.sort(function (a, b) {
      return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
    });
    return filtered.map(clone);
  }

  function add(input) {
    const payload = input && typeof input === 'object' ? input : {};
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) throw fail('INVALID_INPUT', '请选择要高亮的原文');
    const noteBody = typeof payload.note === 'string' ? payload.note.trim() : '';
    if (!noteBody) throw fail('INVALID_INPUT', '笔记内容不能为空');

    const chapterIndex = Number(payload.chapterIndex);
    const record = {
      id: randomId(),
      bookId: String(payload.bookId || ''),
      bookTitle: String(payload.bookTitle || ''),
      chapterIndex: Number.isInteger(chapterIndex) ? chapterIndex : 0,
      chapterTitle: String(payload.chapterTitle || ''),
      text: text,
      note: noteBody,
      color: COLORS.indexOf(payload.color) === -1 ? 'amber' : payload.color,
      percent: Number.isFinite(Number(payload.percent)) ? Math.min(1, Math.max(0, Number(payload.percent))) : 0,
      createdAt: nowIso(),
    };
    const notes = readNotes();
    notes.push(record);
    persist(notes);
    return clone(record);
  }

  function remove(id) {
    const notes = readNotes();
    const index = notes.findIndex(function (note) { return note.id === String(id || ''); });
    if (index === -1) throw fail('NOT_FOUND', '笔记不存在');
    notes.splice(index, 1);
    persist(notes);
    return { ok: true };
  }

  return { list: list, add: add, remove: remove, dataDir: dataDir };
}

module.exports = { createNotesService, COLORS };
