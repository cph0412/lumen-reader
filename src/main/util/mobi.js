'use strict';

// mobi.js — MOBI / 旧版 AZW 读取器（PalmDB + PalmDOC；不含 DRM / KF8）
// 文本压缩支持 PalmDOC（compression=1/2）；HUFF/CDIC 会返回明确错误。

const { TextDecoder } = require('node:util');
const { htmlToText } = require('./epub');
const { countWords, CHAPTER_MARKER } = require('./chapters');

const PDB_HEADER_SIZE = 78;

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function readString(buffer, start, length) {
  return buffer.subarray(start, start + length).toString('latin1').replace(/\x00.*$/, '').trim();
}

function readPdb(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < PDB_HEADER_SIZE) {
    throw fail('INVALID_MOBI', '不是有效的 MOBI 文件');
  }
  const type = buffer.toString('ascii', 60, 64);
  const creator = buffer.toString('ascii', 64, 68);
  if (type !== 'BOOK' || creator !== 'MOBI') {
    throw fail('INVALID_MOBI', '不是受支持的 MOBI / AZW 文件');
  }
  const numRecords = buffer.readUInt16BE(76);
  if (!numRecords || numRecords > 1000000) throw fail('INVALID_MOBI', 'MOBI 记录表损坏');
  const offsets = [];
  for (let i = 0; i < numRecords; i += 1) {
    const offset = buffer.readUInt32BE(PDB_HEADER_SIZE + i * 8);
    if (offset < PDB_HEADER_SIZE || offset >= buffer.length) throw fail('INVALID_MOBI', 'MOBI 记录偏移损坏');
    offsets.push(offset);
  }
  offsets.push(buffer.length);
  const records = [];
  for (let i = 0; i < numRecords; i += 1) {
    if (offsets[i] > offsets[i + 1]) throw fail('INVALID_MOBI', 'MOBI 记录偏移损坏');
    records.push(buffer.subarray(offsets[i], offsets[i + 1]));
  }
  return { name: readString(buffer, 0, 32), type, creator, records };
}

function getDecoder(encoding) {
  const name = Number(encoding) === 65001 ? 'utf-8' : 'windows-1252';
  try { return new TextDecoder(name); } catch (err) { return new TextDecoder('utf-8'); }
}

function decodeBytes(buffer, encoding) {
  return getDecoder(encoding).decode(buffer);
}

function decompressPalmDoc(input) {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const output = [];
  for (let i = 0; i < source.length; i += 1) {
    const byte = source[i];
    if (byte === 0) {
      output.push(0);
    } else if (byte <= 8) {
      for (let n = 0; n < byte && i + 1 < source.length; n += 1) output.push(source[++i]);
    } else if (byte <= 0x7f) {
      output.push(byte);
    } else if (byte <= 0xbf) {
      if (i + 1 >= source.length) break;
      const pair = (byte << 8) | source[++i];
      const distance = (pair & 0x3fff) >>> 3;
      const length = (pair & 0x0007) + 3;
      if (!distance) continue;
      for (let n = 0; n < length; n += 1) {
        const index = output.length - distance;
        if (index < 0) break;
        output.push(output[index]);
      }
    } else {
      output.push(32, byte ^ 0x80);
    }
  }
  return Buffer.from(output);
}

function getVarLenFromEnd(bytes) {
  let value = 0;
  for (let i = Math.max(0, bytes.length - 4); i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte & 0x80) value = 0;
    value = (value << 7) | (byte & 0x7f);
  }
  return value;
}

function removeTrailingEntries(input, flags) {
  let bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const trailingFlags = Number(flags) || 0;
  const multibyte = trailingFlags & 1;
  let count = 0;
  for (let value = trailingFlags >>> 1; value > 0; value >>>= 1) count += value & 1;
  for (let i = 0; i < count && bytes.length; i += 1) {
    const length = getVarLenFromEnd(bytes);
    if (!length || length > bytes.length) break;
    bytes = bytes.subarray(0, bytes.length - length);
  }
  if (multibyte && bytes.length) {
    const length = (bytes[bytes.length - 1] & 0x03) + 1;
    bytes = bytes.subarray(0, Math.max(0, bytes.length - length));
  }
  return bytes;
}

function readExth(record0, offset, encoder) {
  if (!offset || offset + 12 > record0.length) return {};
  if (record0.toString('ascii', offset, offset + 4) !== 'EXTH') return {};
  const length = record0.readUInt32BE(offset + 4);
  const count = record0.readUInt32BE(offset + 8);
  const end = Math.min(record0.length, offset + length);
  const values = {};
  let cursor = offset + 12;
  for (let i = 0; i < count && cursor + 8 <= end; i += 1) {
    const type = record0.readUInt32BE(cursor);
    const size = record0.readUInt32BE(cursor + 4);
    if (size < 8 || cursor + size > end) break;
    const data = record0.subarray(cursor + 8, cursor + size);
    const key = type === 100 ? 'creator' : type === 503 ? 'title' : type === 101 ? 'publisher' :
      type === 103 ? 'description' : type === 104 ? 'isbn' : type === 503 ? 'title' : '';
    if (key) values[key] = decodeBytes(data, encoder).trim();
    cursor += size;
  }
  return values;
}

function parseMobi(buffer) {
  const pdb = readPdb(buffer);
  const record0 = pdb.records[0];
  if (record0.length < 16) throw fail('INVALID_MOBI', 'MOBI 头部为空');
  const compression = record0.readUInt16BE(0);
  const textLength = record0.readUInt32BE(4);
  const textRecordCount = record0.readUInt16BE(8);
  const encryption = record0.readUInt16BE(12);
  if (encryption !== 0) throw fail('DRM_MOBI', '这本 MOBI 有 DRM 加密，无法读取');

  const mobiStart = 16;
  if (record0.toString('ascii', mobiStart, mobiStart + 4) !== 'MOBI') {
    throw fail('INVALID_MOBI', 'MOBI 头部缺失');
  }
  const headerLength = record0.readUInt32BE(mobiStart + 4);
  const encoding = record0.readUInt32BE(mobiStart + 12);
  const version = record0.readUInt32BE(mobiStart + 20);
  // These offsets are relative to the start of record 0 (not the MOBI
  // header), matching the MOBI 6 spec / calibre's reader.
  const titleOffset = record0.readUInt32BE(84);
  const titleLength = record0.readUInt32BE(88);
  const exthFlags = record0.readUInt32BE(128);
  const trailingFlags = record0.readUInt32BE(240);
  if (version >= 8) throw fail('UNSUPPORTED_MOBI', '暂不支持 KF8 / AZW3 格式，请转换为 MOBI 或 EPUB');

  const decoder = getDecoder(encoding);
  const exth = exthFlags & 0x40 ? readExth(record0, mobiStart + headerLength, encoding) : {};
  let title = exth.title || '';
  if (!title && titleLength && titleOffset + titleLength <= record0.length) {
    title = decoder.decode(record0.subarray(titleOffset, titleOffset + titleLength)).trim();
  }
  const author = exth.creator || '';

  if (!textRecordCount) throw fail('INVALID_MOBI', 'MOBI 没有可读取的文本记录');
  if (textRecordCount + 1 > pdb.records.length) throw fail('INVALID_MOBI', 'MOBI 文本记录表不完整');

  const chunks = [];
  for (let i = 0; i < textRecordCount; i += 1) {
    let raw = removeTrailingEntries(pdb.records[i + 1], trailingFlags);
    if (compression === 1) {
      chunks.push(raw);
    } else if (compression === 2) {
      chunks.push(decompressPalmDoc(raw));
    } else if (compression === 17480) {
      throw fail('UNSUPPORTED_MOBI', '暂不支持 HUFF/CDIC 压缩的 MOBI，请用 Calibre 转换为 EPUB');
    } else {
      throw fail('UNSUPPORTED_MOBI', '不支持的 MOBI 压缩方式（' + compression + '）');
    }
  }
  let textBytes = Buffer.concat(chunks);
  if (textLength && textBytes.length > textLength) textBytes = textBytes.subarray(0, textLength);
  if (!textBytes.length) throw fail('INVALID_MOBI', 'MOBI 正文为空');

  let html = decoder.decode(textBytes);
  html = html.replace(/<\?xml[^>]*>/gi, '').replace(/<\!DOCTYPE[^>]*>/gi, '');

  const chapters = [];
  const rawSections = html.split(/<\s*(?:mbp:)?pagebreak[^>]*>/gi);
  for (const section of rawSections) {
    const sections = splitHtmlSection(section);
    for (const item of sections) {
      const text = String(item.text || '').trim();
      if (countWords(text) < 20) continue;
      const sectionTitle = String(item.title || '').trim();
      if (/^(contents|table of contents|copyright|cover|title page)$/i.test(sectionTitle)) continue;
      chapters.push({ title: sectionTitle, text: text });
    }
  }
  if (!chapters.length) throw fail('INVALID_MOBI', 'MOBI 中没有可读取的正文');

  const normalizedText = chapters.map(function (chapter, index) {
    const title = String(chapter.title || '').trim() || ('Chapter ' + (index + 1));
    return CHAPTER_MARKER + title + '\n\n' + chapter.text;
  }).join('\n\n');

  return {
    title: title ? htmlToText(title) : '',
    author: author ? htmlToText(author) : '',
    language: 'en',
    chapters: chapters,
    text: normalizedText,
  };
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

function headingText(html, tag) {
  const match = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i').exec(html);
  return match ? htmlToText(match[1]).replace(/\s+/g, ' ').trim() : '';
}

function splitHtmlSection(html) {
  const headings = [];
  const re = /<h([12])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match;
  while ((match = re.exec(html))) {
    headings.push({
      index: match.index,
      end: re.lastIndex,
      title: htmlToText(match[2]).replace(/\s+/g, ' ').trim(),
    });
  }
  if (headings.length < 2) {
    const title = headingText(html, 'h1') || headingText(html, 'h2');
    const text = htmlToText(html);
    return [{ title: title, text: stripLeadingTitle(text, title) }];
  }
  const sections = [];
  if (headings[0].index > 0) {
    const preamble = htmlToText(html.slice(0, headings[0].index));
    if (countWords(preamble) > 20) sections.push({ title: '', text: preamble });
  }
  for (let i = 0; i < headings.length; i += 1) {
    const start = headings[i].end;
    const end = i + 1 < headings.length ? headings[i + 1].index : html.length;
    const text = htmlToText(html.slice(start, end));
    if (text) sections.push({ title: headings[i].title, text: text });
  }
  return sections;
}

module.exports = {
  parseMobi,
  readPdb,
  decompressPalmDoc,
  removeTrailingEntries,
};
