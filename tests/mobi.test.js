'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseMobi, decompressPalmDoc } = require('../src/main/util/mobi');
const { createLibraryService } = require('../src/main/services/library');

function makeMobi(options) {
  const opts = options || {};
  const title = opts.title || 'A MOBI Book';
  const titleBuffer = Buffer.from(title, 'utf8');
  const html = opts.html || '<html><body><h1>Chapter One</h1><p>The morning was cold and the street was quiet. She opened the window and listened to the rain. It was a day for new beginnings and long walks.</p><mbp:pagebreak/><h1>Chapter Two</h1><p>They walked for hours without speaking. The road curled through the hills toward the sea. At last the lights of the harbor appeared below them.</p></body></html>';
  const textBuffer = Buffer.from(html, 'utf8');
  const compression = opts.compression === 2 ? 2 : 1;
  const mobiHeaderLength = 232;
  const titleOffset = 16 + mobiHeaderLength;
  const record0 = Buffer.alloc(titleOffset + titleBuffer.length);
  record0.writeUInt16BE(compression, 0);
  record0.writeUInt32BE(textBuffer.length, 4);
  record0.writeUInt16BE(1, 8);
  record0.writeUInt16BE(4096, 10);
  record0.writeUInt16BE(0, 12);
  record0.write('MOBI', 16, 'ascii');
  record0.writeUInt32BE(mobiHeaderLength, 20);
  record0.writeUInt32BE(2, 24);
  record0.writeUInt32BE(65001, 28);
  record0.writeUInt32BE(1, 32);
  record0.writeUInt32BE(6, 36);
  record0.writeUInt32BE(titleOffset, 84);
  record0.writeUInt32BE(titleBuffer.length, 88);
  record0.writeUInt32BE(0, 128);
  record0.writeUInt32BE(0, 240);
  titleBuffer.copy(record0, titleOffset);
  const records = [record0, textBuffer];
  const count = records.length;
  const firstOffset = 78 + count * 8 + 2;
  const header = Buffer.alloc(78);
  header.write(title, 0, 'latin1');
  header.write('BOOK', 60, 'ascii');
  header.write('MOBI', 64, 'ascii');
  header.writeUInt16BE(count, 76);
  const info = Buffer.alloc(count * 8);
  let offset = firstOffset;
  for (let i = 0; i < count; i += 1) {
    info.writeUInt32BE(offset, i * 8);
    info.writeUInt8(0, i * 8 + 4);
    info.writeUIntBE(i, i * 8 + 5, 3);
    offset += records[i].length;
  }
  return Buffer.concat([header, info, Buffer.alloc(2), ...records]);
}

test('mobi: parses PalmDOC title and pagebreak chapters', () => {
  const result = parseMobi(makeMobi());
  assert.equal(result.title, 'A MOBI Book');
  assert.equal(result.chapters.length, 2);
  assert.equal(result.chapters[0].title, 'Chapter One');
  assert.match(result.text, /morning was cold/);
  assert.match(result.text, /Chapter Two/);
  assert.doesNotMatch(result.text, /<p>|<h1>/);
});

test('mobi: supports PalmDOC compression type 2', () => {
  const result = parseMobi(makeMobi({ compression: 2 }));
  assert.match(result.text, /morning was cold/);
});

test('mobi: PalmDOC back-reference decompression', () => {
  // "abcabc": literals a,b,c then length=3 distance=3
  const input = Buffer.from([0x61, 0x62, 0x63, 0x80, 0x18]);
  assert.equal(decompressPalmDoc(input).toString('utf8'), 'abcabc');
});

test('library: imports MOBI and reuses chapter reader', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-mobi-'));
  const mobiPath = path.join(dir, 'book.mobi');
  fs.writeFileSync(mobiPath, makeMobi({ title: 'Imported MOBI' }));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-mobi-data-'));
  const library = createLibraryService({ dataDir });
  await library.init();
  const result = await library.importPaths([mobiPath]);
  assert.equal(result.errors.length, 0);
  assert.equal(result.imported.length, 1);
  const book = result.imported[0];
  assert.equal(book.title, 'Imported MOBI');
  assert.equal(book.format, 'mobi');
  assert.equal(book.chapterCount, 2);
  assert.match(library.getChapter(book.id, 0).chapter.text, /morning was cold/);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});
