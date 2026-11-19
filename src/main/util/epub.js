'use strict';

// epub.js — 最小 EPUB 2/3 读取器：ZIP 解包 + OPF spine + XHTML 正文抽取。
// 纯 Node（zlib），不依赖第三方库，便于 node:test 单测。

const path = require('node:path');
const zlib = require('node:zlib');
const { countWords, CHAPTER_MARKER } = require('./chapters');

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function readUInt16(buf, offset) { return buf.readUInt16LE(offset); }
function readUInt32(buf, offset) { return buf.readUInt32LE(offset); }

function findEndOfCentralDirectory(buffer) {
  const min = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

// 只实现 EPUB 常见的 stored / deflate 两种压缩方式；不支持 ZIP64。
function readZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw fail('INVALID_EPUB', '不是有效的 EPUB 文件');
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd === -1) throw fail('INVALID_EPUB', '找不到 EPUB 的 ZIP 目录');
  const count = readUInt16(buffer, eocd + 10);
  const centralSize = readUInt32(buffer, eocd + 12);
  const centralOffset = readUInt32(buffer, eocd + 16);
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw fail('INVALID_EPUB', '暂不支持 ZIP64 格式的 EPUB');
  }
  if (centralOffset + centralSize > buffer.length) throw fail('INVALID_EPUB', 'EPUB ZIP 目录损坏');

  const entries = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > buffer.length || readUInt32(buffer, cursor) !== CENTRAL_SIG) {
      throw fail('INVALID_EPUB', 'EPUB ZIP 目录损坏');
    }
    const method = readUInt16(buffer, cursor + 10);
    const compressedSize = readUInt32(buffer, cursor + 20);
    const uncompressedSize = readUInt32(buffer, cursor + 24);
    const nameLength = readUInt16(buffer, cursor + 28);
    const extraLength = readUInt16(buffer, cursor + 30);
    const commentLength = readUInt16(buffer, cursor + 32);
    const localOffset = readUInt32(buffer, cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8').replace(/\\/g, '/');
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > buffer.length) throw fail('INVALID_EPUB', 'EPUB ZIP 目录损坏');

    if (name && !name.endsWith('/')) {
      if (localOffset + 30 > buffer.length || readUInt32(buffer, localOffset) !== LOCAL_SIG) {
        throw fail('INVALID_EPUB', 'EPUB 文件条目损坏');
      }
      const localNameLength = readUInt16(buffer, localOffset + 26);
      const localExtraLength = readUInt16(buffer, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      if (dataStart + compressedSize > buffer.length) throw fail('INVALID_EPUB', 'EPUB 文件条目损坏');
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      let data;
      if (method === 0) data = compressed;
      else if (method === 8) {
        try {
          data = zlib.inflateRawSync(compressed);
        } catch (err) {
          throw fail('INVALID_EPUB', 'EPUB 正文解压失败');
        }
      } else {
        throw fail('INVALID_EPUB', '不支持的 EPUB 压缩方式（' + method + '）');
      }
      if (uncompressedSize && data.length !== uncompressedSize) {
        // 某些 EPUB 的 central 大小不准确；只要解压成功就继续。
      }
      entries.set(name, data);
    }
    cursor = next;
  }
  return entries;
}

function decodeEntities(value) {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    mdash: '—', ndash: '–', hellip: '…', ldquo: '“', rdquo: '”',
    lsquo: '‘', rsquo: '’', middot: '·', bull: '•', copy: '©',
    reg: '®', trade: '™', eacute: 'é', egrave: 'è', agrave: 'à',
    ccedil: 'ç', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß'
  };
  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, function (match, entity) {
    if (entity.charAt(0) === '#') {
      const hex = entity.charAt(1).toLowerCase() === 'x';
      const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try { return String.fromCodePoint(code); } catch (err) { return match; }
      }
      return match;
    }
    const key = entity.toLowerCase();
    return Object.prototype.hasOwnProperty.call(named, key) ? named[key] : match;
  });
}

function cleanFragment(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '');
}

function htmlToText(html) {
  let value = cleanFragment(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<\/div\s*>/gi, '\n\n')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<\/blockquote\s*>/gi, '\n\n')
    .replace(/<\/h[1-6]\s*>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ');
  value = decodeEntities(value);
  return value
    .split('\n')
    .map(function (line) { return line.replace(/[ \t\f\v]+/g, ' ').trim(); })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTagText(html, tag) {
  const match = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i').exec(html);
  return match ? htmlToText(match[1]).replace(/\s+/g, ' ').trim() : '';
}

function parseAttributes(source) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = re.exec(source))) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[3] !== undefined ? match[3] : match[4]);
  }
  return attrs;
}

function parseContainer(xml) {
  const match = /<(?:[a-z][\w.-]*:)?rootfile\b([^>]*)>/i.exec(xml);
  if (!match) throw fail('INVALID_EPUB', 'EPUB 缺少 container.xml 根文件');
  const attrs = parseAttributes(match[1]);
  const fullPath = attrs['full-path'];
  if (!fullPath) throw fail('INVALID_EPUB', 'EPUB 根文件路径为空');
  return fullPath;
}

function parseOpf(xml) {
  const metadataMatch = /<(?:[a-z][\w.-]*:)?metadata\b[^>]*>([\s\S]*?)<\/(?:[a-z][\w.-]*:)?metadata>/i.exec(xml);
  const metadata = metadataMatch ? metadataMatch[1] : '';
  const titles = [];
  const titleRe = /<(?:dc:)?title\b[^>]*>([\s\S]*?)<\/(?:dc:)?title>/gi;
  let tm;
  while ((tm = titleRe.exec(metadata))) {
    const text = htmlToText(tm[1]).replace(/\s+/g, ' ').trim();
    if (text) titles.push(text);
  }
  const creators = [];
  const creatorRe = /<(?:dc:)?creator\b[^>]*>([\s\S]*?)<\/(?:dc:)?creator>/gi;
  let cm;
  while ((cm = creatorRe.exec(metadata))) {
    const text = htmlToText(cm[1]).replace(/\s+/g, ' ').trim();
    if (text) creators.push(text);
  }
  const manifest = new Map();
  const itemRe = /<(?:[a-z][\w.-]*:)?item\b([^>]*)\/?>/gi;
  let im;
  while ((im = itemRe.exec(xml))) {
    const attrs = parseAttributes(im[1]);
    if (!attrs.id || !attrs.href) continue;
    manifest.set(attrs.id, attrs);
  }
  const spineMatch = /<(?:[a-z][\w.-]*:)?spine\b[^>]*>([\s\S]*?)<\/(?:[a-z][\w.-]*:)?spine>/i.exec(xml);
  const spine = [];
  if (spineMatch) {
    const refRe = /<(?:[a-z][\w.-]*:)?itemref\b([^>]*)\/?>/gi;
    let rm;
    while ((rm = refRe.exec(spineMatch[1]))) {
      const attrs = parseAttributes(rm[1]);
      if (attrs.idref) spine.push(attrs);
    }
  }
  return { title: titles[0] || '', author: creators[0] || '', manifest: manifest, spine: spine };
}

function normalizeZipPath(value) {
  const parts = [];
  for (const part of String(value || '').replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (parts.length) parts.pop(); continue; }
    parts.push(part);
  }
  return parts.join('/');
}

function resolveHref(baseDir, href) {
  let value = String(href || '').split('#')[0];
  try { value = decodeURIComponent(value); } catch (err) { /* keep raw */ }
  const joined = baseDir ? baseDir + '/' + value : value;
  return normalizeZipPath(joined);
}

function titleFromHtml(html, fallback) {
  return extractTagText(html, 'h1') || extractTagText(html, 'h2') || extractTagText(html, 'title') || fallback;
}

function normalizeHeading(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function stripLeadingTitle(text, title) {
  if (!title) return text;
  const lines = String(text || '').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && normalizeHeading(lines[0]) === normalizeHeading(title)) {
    lines.shift();
    while (lines.length && !lines[0].trim()) lines.shift();
  }
  return lines.join('\n').replace(/^\n+/, '').trim();
}

function splitByH1(html, fallback) {
  const headings = [];
  const re = /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi;
  let match;
  while ((match = re.exec(html))) {
    headings.push({ index: match.index, end: re.lastIndex, title: htmlToText(match[1]).replace(/\s+/g, ' ').trim() });
  }
  if (headings.length < 2) {
    const title = titleFromHtml(html, fallback);
    return [{ title: title, text: stripLeadingTitle(htmlToText(html), title) }];
  }
  const sections = [];
  if (headings[0].index > 0) {
    const preamble = htmlToText(html.slice(0, headings[0].index));
    if (countWords(preamble) > 20) sections.push({ title: fallback, text: preamble });
  }
  for (let i = 0; i < headings.length; i += 1) {
    const start = headings[i].end;
    const end = i + 1 < headings.length ? headings[i + 1].index : html.length;
    const text = htmlToText(html.slice(start, end));
    if (countWords(text) < 5) continue;
    sections.push({ title: headings[i].title || fallback, text: text });
  }
  return sections;
}

function findEntry(entries, name) {
  if (entries.has(name)) return entries.get(name);
  const lower = name.toLowerCase();
  for (const [key, value] of entries.entries()) {
    if (key.toLowerCase() === lower) return value;
  }
  return null;
}

function parseEpub(buffer) {
  const entries = readZip(buffer);
  const container = findEntry(entries, 'META-INF/container.xml');
  if (!container) throw fail('INVALID_EPUB', 'EPUB 缺少 META-INF/container.xml');
  const containerXml = container.toString('utf8');
  const opfPath = normalizeZipPath(parseContainer(containerXml));
  const opfBuffer = findEntry(entries, opfPath);
  if (!opfBuffer) throw fail('INVALID_EPUB', 'EPUB 找不到 OPF 清单');
  const opfXml = opfBuffer.toString('utf8');
  const opf = parseOpf(opfXml);
  const opfDir = path.posix.dirname(opfPath) === '.' ? '' : path.posix.dirname(opfPath);

  const items = [];
  const seen = new Set();
  for (const ref of opf.spine) {
    const item = opf.manifest.get(ref.idref);
    if (!item || !item.href) continue;
    if (ref.linear === 'no') continue;
    items.push(item);
  }
  if (!items.length) {
    for (const item of opf.manifest.values()) {
      if (/\.x?html?$/i.test(item.href || '')) items.push(item);
    }
  }

  const chapters = [];
  for (const item of items) {
    const entryName = resolveHref(opfDir, item.href);
    if (!/\.x?html?$/i.test(entryName)) continue;
    const file = findEntry(entries, entryName);
    if (!file) continue;
    const html = file.toString('utf8');
    const baseTitle = (opf.title || 'Chapter') + ' ' + (chapters.length + 1);
    const sections = splitByH1(html, baseTitle);
    for (const section of sections) {
      const text = String(section.text || '').trim();
      if (!text) continue;
      if (countWords(text) < 20) continue;
      const title = String(section.title || '').trim();
      if (/^(contents|table of contents|copyright|cover|title page)$/i.test(title)) continue;
      chapters.push({ title: title, text: text });
    }
  }
  if (!chapters.length) throw fail('INVALID_EPUB', 'EPUB 中没有可读取的正文');

  const text = chapters.map(function (chapter, index) {
    const title = String(chapter.title || '').trim() || ('Chapter ' + (index + 1));
    // The marker is invisible in the reader: chapters.js uses it to build
    // exact chapter boundaries instead of re-guessing headings in the body.
    return CHAPTER_MARKER + title + '\n\n' + chapter.text;
  }).join('\n\n');

  return {
    title: opf.title || '',
    author: opf.author || '',
    language: 'en',
    chapters: chapters,
    text: text,
  };
}

module.exports = {
  parseEpub,
  readZip,
  htmlToText,
  parseContainer,
  parseOpf,
  resolveHref,
};
