'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { parseEpub, htmlToText } = require('../src/main/util/epub');
const { createLibraryService } = require('../src/main/services/library');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const method = entry.method === 0 ? 0 : 8;
    const data = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const crc = crc32(raw);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    local.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, name);
    offset += localHeader.length + name.length + data.length;
  }
  const centralBuffer = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat(local.concat([centralBuffer, eocd]));
}

function makeEpub(options) {
  const opts = options || {};
  const chapters = opts.chapters || [
    { title: 'The Beginning', body: '<p>The morning was cold and the street was quiet. She opened the window and listened to the rain.</p><p>It was a day for new beginnings.</p>' },
    { title: 'The Journey', body: '<p>They walked for hours without speaking. The road curled through the hills toward the sea.</p><p>At last the lights of the harbor appeared below them.</p>' }
  ];
  let chapterFiles = chapters.map((chapter, index) => ({
    name: 'OEBPS/ch' + (index + 1) + '.xhtml',
    data: '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>' + chapter.title + '</title></head><body><h1>' + chapter.title + '</h1>' + chapter.body + '</body></html>'
  }));
  let manifestItems = chapters.map((chapter, index) => '<item id="ch' + (index + 1) + '" href="ch' + (index + 1) + '.xhtml" media-type="application/xhtml+xml"/>').join('');
  let spineItems = chapters.map((chapter, index) => '<itemref idref="ch' + (index + 1) + '"/>').join('');
  if (opts.singleFile) {
    const body = chapters.map((chapter) => '<h1>' + chapter.title + '</h1>' + chapter.body).join('');
    chapterFiles = [{
      name: 'OEBPS/all.xhtml',
      data: '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>' + (opts.title || 'A Small Book') + '</title></head><body>' + body + '</body></html>'
    }];
    manifestItems = '<item id="all" href="all.xhtml" media-type="application/xhtml+xml"/>';
    spineItems = '<itemref idref="all"/>';
  }
  const opf = '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' + (opts.title || 'A Small Book') + '</dc:title><dc:creator>' + (opts.author || 'Ada Reader') + '</dc:creator><dc:language>en</dc:language></metadata><manifest>' + manifestItems + '</manifest><spine>' + spineItems + '</spine></package>';
  return makeZip([
    { name: 'mimetype', data: 'application/epub+zip', method: 0 },
    { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OEBPS/content.opf', data: opf },
    ...chapterFiles
  ]);
}

test('epub: parses metadata, spine and XHTML into chapters', () => {
  const result = parseEpub(makeEpub());
  assert.equal(result.title, 'A Small Book');
  assert.equal(result.author, 'Ada Reader');
  assert.equal(result.chapters.length, 2);
  assert.equal(result.chapters[0].title, 'The Beginning');
  assert.match(result.chapters[0].text, /morning was cold/);
  assert.match(result.text, /The Beginning/);
  assert.match(result.text, /The Journey/);
  assert.doesNotMatch(result.text, /<p>|<h1>/);
});

test('epub: parses OPF with opf: namespace prefixes', () => {
  const { parseOpf } = require('../src/main/util/epub');
  const xml = '<?xml version="1.0"?><opf:package version="2.0" xmlns:opf="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><opf:metadata><dc:title>国富论</dc:title><dc:creator>亚当·斯密</dc:creator></opf:metadata><opf:manifest><opf:item id="c1" href="chapter/1.html" media-type="application/xhtml+xml"/></opf:manifest><opf:spine><opf:itemref idref="c1"/></opf:spine></opf:package>';
  const parsed = parseOpf(xml);
  assert.equal(parsed.title, '国富论');
  assert.equal(parsed.author, '亚当·斯密');
  assert.equal(parsed.manifest.size, 1);
  assert.deepEqual(parsed.spine, [{ idref: 'c1' }]);
});

test('epub: strips tags, scripts and decodes entities', () => {
  const text = htmlToText('<body><p>A &amp; B&nbsp; C.</p><script>bad()</script><p>“ok”</p></body>');
  assert.match(text, /A & B C./);
  assert.doesNotMatch(text, /bad()|<p>/);
  assert.match(text, /“ok”/);
});

test('epub: splits a single XHTML containing multiple h1 headings', () => {
  const epub = makeEpub({
    singleFile: true,
    chapters: [
      { title: 'First', body: '<p>Words in the first part are enough to pass the filter and make a chapter. The road was long and the night was cold, but the travelers kept walking toward the distant lights.</p>' },
      { title: 'Second', body: '<p>Words in the second part are enough to pass the filter and make a chapter. In the morning they reached the harbor and found a small boat waiting for them by the pier.</p>' }
    ]
  });
  const result = parseEpub(epub);
  assert.equal(result.chapters.length, 2);
});

test('library: imports EPUB and reuses the chapter reader', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-epub-'));
  const epubPath = path.join(dir, 'book.epub');
  fs.writeFileSync(epubPath, makeEpub({ title: 'Imported EPUB', author: 'Test Author' }));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-epub-data-'));
  const library = createLibraryService({ dataDir });
  await library.init();
  const result = await library.importPaths([epubPath]);
  assert.equal(result.errors.length, 0);
  assert.equal(result.imported.length, 1);
  const book = result.imported[0];
  assert.equal(book.title, 'Imported EPUB');
  assert.equal(book.format, 'epub');
  assert.equal(book.author, 'Test Author');
  assert.equal(book.chapterCount, 2);
  const chapter = library.getChapter(book.id, 0);
  assert.match(chapter.chapter.text, /morning was cold/);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});
