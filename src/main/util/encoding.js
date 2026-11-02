'use strict';

// encoding.js — 编码检测与解码
// 支持：UTF-8 BOM、UTF-16LE/BE BOM、无 BOM 的 UTF-16 启发式、严格 UTF-8、
// GB18030 回退（兼容 GBK/GB2312 中文书籍）。纯 Node 内置模块实现。

const { TextDecoder } = require('node:util');

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const REPLACEMENT = '\uFFFD';

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (typeof input === 'string') return Buffer.from(input, 'utf8');
  throw new TypeError('detectAndDecode 需要 Buffer / Uint8Array / ArrayBuffer');
}

function stripBom(text) {
  return text && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function decodeFatal(buf, encoding) {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(buf);
  } catch (err) {
    return null;
  }
}

function decodeLossy(buf, encoding) {
  try {
    return new TextDecoder(encoding).decode(buf);
  } catch (err) {
    return null;
  }
}

// 乱码比例：替换字符与非常规控制字符占比。0 表示干净文本。
function garbleRatio(text) {
  if (!text) return 0;
  let bad = 0;
  let total = 0;
  for (const ch of text) {
    total += 1;
    const code = ch.codePointAt(0);
    if (code === 0xfffd) {
      bad += 1;
    } else if (code < 0x20 && ch !== '\n' && ch !== '\r' && ch !== '\t') {
      bad += 1;
    }
  }
  return total === 0 ? 0 : bad / total;
}

function looksGarbled(text, threshold) {
  const limit = typeof threshold === 'number' ? threshold : 0.02;
  return garbleRatio(text) > limit;
}

function swapBytes(buf) {
  const even = buf.length - (buf.length % 2);
  const out = Buffer.alloc(even);
  for (let i = 0; i < even; i += 2) {
    out[i] = buf[i + 1];
    out[i + 1] = buf[i];
  }
  return out;
}

// 无 BOM 的 UTF-16 文本会产生大量 0x00 字节，据此判断大端 / 小端。
function detectUtf16WithoutBom(buf) {
  const n = Math.min(buf.length, 4096);
  const pairs = Math.floor(n / 2);
  if (pairs < 4) return null;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i + 1 < n; i += 2) {
    if (buf[i] === 0) evenZeros += 1;
    if (buf[i + 1] === 0) oddZeros += 1;
  }
  const evenRatio = evenZeros / pairs;
  const oddRatio = oddZeros / pairs;
  if (oddRatio > 0.3 && evenRatio < 0.05) {
    const text = decodeLossy(buf, 'utf-16le');
    return text === null ? null : { text: stripBom(text), encoding: 'utf-16le' };
  }
  if (evenRatio > 0.3 && oddRatio < 0.05) {
    const text = decodeLossy(swapBytes(buf), 'utf-16le');
    return text === null ? null : { text: stripBom(text), encoding: 'utf-16be' };
  }
  return null;
}

// 主入口：返回 { text, encoding }
// encoding ∈ 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'gb18030'
function detectAndDecode(input) {
  const buf = toBuffer(input);
  if (!buf.length) return { text: '', encoding: 'utf-8' };

  if (buf.length >= 3 && buf[0] === UTF8_BOM[0] && buf[1] === UTF8_BOM[1] && buf[2] === UTF8_BOM[2]) {
    const text = decodeLossy(buf.subarray(3), 'utf-8') || '';
    return { text: stripBom(text), encoding: 'utf-8-bom' };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    const text = decodeLossy(buf.subarray(2), 'utf-16le') || '';
    return { text: stripBom(text), encoding: 'utf-16le' };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const text = decodeLossy(swapBytes(buf.subarray(2)), 'utf-16le') || '';
    return { text: stripBom(text), encoding: 'utf-16be' };
  }

  const utf16 = detectUtf16WithoutBom(buf);
  if (utf16) return utf16;

  const strict = decodeFatal(buf, 'utf-8');
  if (strict !== null) return { text: stripBom(strict), encoding: 'utf-8' };

  const lossyUtf8 = decodeLossy(buf, 'utf-8') || '';
  const utf8Garble = garbleRatio(lossyUtf8);
  // 几乎全是 ASCII 的文件里出现个别坏字节：按轻微损坏的 UTF-8 处理。
  let nonAscii = 0;
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] >= 0x80) nonAscii += 1;
  }
  const nonAsciiRatio = nonAscii / buf.length;
  if (utf8Garble <= 0.002 || nonAsciiRatio <= 0.005) {
    return { text: stripBom(lossyUtf8), encoding: 'utf-8' };
  }

  const gbStrict = decodeFatal(buf, 'gb18030');
  if (gbStrict !== null && garbleRatio(gbStrict) < utf8Garble) {
    return { text: stripBom(gbStrict), encoding: 'gb18030' };
  }
  const gbLossy = decodeLossy(buf, 'gb18030');
  if (gbLossy !== null && garbleRatio(gbLossy) < utf8Garble) {
    return { text: stripBom(gbLossy), encoding: 'gb18030' };
  }
  return { text: stripBom(lossyUtf8), encoding: 'utf-8' };
}

module.exports = { detectAndDecode, garbleRatio, looksGarbled, stripBom };
