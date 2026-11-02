'use strict';

// chapters.js — 章节识别、字数统计、无章节时的等长切分。
// 纯函数，不依赖 fs / electron，便于 node:test 单测。

const MAX_HEADING_LENGTH = 80;
const TOC_GAP_CHARS = 260;     // 目录行之间字符间距很小
const TOC_LINE_GAP = 2;        // 目录行相邻（允许标题另起一行的情形）
const TOC_RUN_MIN = 3;         // 连续 3 条以上视为目录块
const SECTION_WORDS = 4500;    // 无章节时每节目标词数

const NUMBER_WORDS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|' +
  'thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|' +
  'fifty|sixty|seventy|eighty|ninety|hundred';

const NUMBER_ALT = '(?:\\d+|[ivxlcdm]+|' + NUMBER_WORDS + ')';

const CHAPTER_RE = new RegExp('^(?:chapter|part|book|volume|section)\\s+' + NUMBER_ALT + '\\b[^\\n]*$', 'i');
const BARE_CHAPTER_RE = new RegExp('^(?:chapter|part|book|volume|section)\\s+' + NUMBER_ALT + '\\s*[.:]?\\s*$', 'i');
const ZH_CHAPTER_RE = /^第\s*(?:\d+|[一二三四五六七八九十百零〇两]+)\s*[章节回卷篇部][^\n]*$/;
const SPECIAL_WORD_RE = /^(?:prologue|epilogue|preface|foreword|introduction|afterword|appendix|conclusion)[.:]?$/i;
const LETTER_RE = /^letter\s+(?:\d+|[ivxlcdm]+)[.:]?$/i;
// "I. A SCANDAL IN BOHEMIA"：罗马数字 + 句点 + 全大写标题
const ROMAN_TITLE_RE = /^[IVXLCDM]{1,8}\.\s+[A-Z][A-Z0-9 ,.'\u2019"&:;\-]{2,}$/;
const ROMAN_ONLY_RE = /^[IVXLCDM]{1,8}\.?$/;
const NUMBERED_RE = /^\d{1,3}\.\s+\S[^\n]{1,60}$/;

const NON_TITLE_WORDS = /^(?:contents|table of contents|copyright|illustrations?|transcriber|the end|end of|index|notes|glossary|acknowledg\w*|dedication|title page|chapter|colophon)$/i;

function isAllCapsHeading(line) {
  if (line.length < 4 || line.length > 60) return false;
  if (!/^[A-Z0-9]/.test(line)) return false;
  if (/[a-z]/.test(line)) return false;
  if (NON_TITLE_WORDS.test(line.trim())) return false;
  const letters = line.match(/[A-Z]/g);
  if (!letters || letters.length < 2) return false;
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 9) return false;
  return true;
}

// 只接受独立成行的 Prologue / Letter 1 等，避免正文中 "introduction that ..." 被误判。
function isSpecialHeading(line) {
  if (line.length > 60) return false;
  if (!/^[A-Z]/.test(line)) return false;
  return SPECIAL_WORD_RE.test(line) || LETTER_RE.test(line);
}

function matchHeading(line) {
  if (CHAPTER_RE.test(line)) return 'chapter';
  if (ZH_CHAPTER_RE.test(line)) return 'chapter';
  if (isSpecialHeading(line)) return 'special';
  if (ROMAN_TITLE_RE.test(line)) return 'roman-title';
  if (NUMBERED_RE.test(line)) return 'numbered';
  if (ROMAN_ONLY_RE.test(line)) return 'roman';
  if (isAllCapsHeading(line)) return 'caps';
  return null;
}

function isBareHeading(line, kind) {
  if (kind === 'chapter') return BARE_CHAPTER_RE.test(line);
  if (kind === 'roman') return ROMAN_ONLY_RE.test(line);
  if (kind === 'special') return isSpecialHeading(line);
  return false;
}

function collapse(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function splitLines(text) {
  const lines = [];
  const newline = /\r\n|\n|\r/g;
  let lineStart = 0;
  let lineIndex = 0;
  for (;;) {
    const match = newline.exec(text);
    const lineEnd = match ? match.index : text.length;
    lines.push({ raw: text.slice(lineStart, lineEnd), start: lineStart, end: lineEnd, index: lineIndex });
    lineIndex += 1;
    if (!match) break;
    lineStart = lineEnd + match[0].length;
    if (lineStart > text.length) break;
  }
  return lines;
}

// 下一行是否像标题的后半截（"CHAPTER I." / "II." 后另起一行的标题）。
function isTitleContinuation(line) {
  if (!line) return false;
  const text = line.trim();
  if (!text || text.length > 60) return false;
  if (matchHeading(text)) return false;
  if (/^["'\u201c\u201d\u2018\u2019]/.test(text)) return false;
  if (!/^[A-Z]/.test(text)) return false;
  if (/[.,;:]$/.test(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 8) return false;
  return true;
}

function nextNonEmptyLine(lines, fromIndex, maxLookahead) {
  const limit = Math.min(lines.length, fromIndex + (maxLookahead || 2) + 1);
  for (let i = fromIndex + 1; i < limit; i += 1) {
    const trimmed = lines[i].raw.trim();
    if (trimmed) return { line: lines[i], text: trimmed };
  }
  return null;
}

// 逐行扫描候选标题，记录原始字符位置与行号。
function collectCandidates(text) {
  const lines = splitLines(text);
  const candidates = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.raw.trim();
    if (!trimmed || trimmed.length > MAX_HEADING_LENGTH) continue;
    const kind = matchHeading(trimmed);
    if (!kind) continue;
    const lead = line.raw.length - line.raw.replace(/^\s+/, '').length;
    let title = collapse(trimmed);

    if (isBareHeading(trimmed, kind)) {
      const next = nextNonEmptyLine(lines, i, 2);
      if (kind === 'roman' && (!next || !isTitleContinuation(next.text))) {
        // 单独的 "I." / "II." 也可能是正文（"said I." 折行），必须有标题行才认。
        continue;
      }
      if (next && isTitleContinuation(next.text)) {
        title = collapse(title + ' ' + next.text);
      }
    }

    candidates.push({
      kind: kind,
      title: title,
      start: line.start + lead,
      end: line.end,
      lineIndex: line.index,
      previousEmpty: line.index === 0 ? true : lines[line.index - 1].raw.trim() === '',
      nextEmpty: line.index + 1 >= lines.length ? true : lines[line.index + 1].raw.trim() === '',
    });
  }
  return candidates;
}

// 目录块：连续多行标题且彼此间距很小，整块丢弃（正文会再次出现同名标题）。
function dropTocClusters(candidates) {
  if (candidates.length < TOC_RUN_MIN) return candidates;
  const kept = [];
  let i = 0;
  while (i < candidates.length) {
    let j = i;
    while (j + 1 < candidates.length) {
      const gapChars = candidates[j + 1].start - candidates[j].start;
      const gapLines = candidates[j + 1].lineIndex - candidates[j].lineIndex;
      // 目录行必须相邻；若隔一行，只有该行是标题续行（非空）时才视为同一目录块，
      // 避免把正文第一章也吞进目录块。
      const linked = gapLines === 1 || (gapLines === TOC_LINE_GAP && !candidates[j + 1].previousEmpty);
      if (gapChars < TOC_GAP_CHARS && linked) j += 1;
      else break;
    }
    const runLength = j - i + 1;
    if (runLength >= TOC_RUN_MIN) {
      i = j + 1; // 丢弃整段目录
    } else {
      kept.push(candidates[i]);
      i += 1;
    }
  }
  return kept;
}

function trimRangeEnd(text, start, end) {
  let cursor = end;
  while (cursor > start && /\s/.test(text[cursor - 1])) cursor -= 1;
  return cursor;
}

function countWords(text) {
  if (!text) return 0;
  const source = String(text);
  // 英文词：连字符、撇号、缩写点号视为同一个词；CJK 字符按字计数。
  const latin = source.match(/[A-Za-z0-9](?:[A-Za-z0-9'\u2019\-.]*[A-Za-z0-9])?/g);
  let words = latin ? latin.length : 0;
  const cjk = source.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g);
  if (cjk) words += cjk.length;
  return words;
}

// 无章节时按约 4500 词切分，尽量在空行处断开。
function splitIntoSections(text, targetWords) {
  const target = targetWords || SECTION_WORDS;
  const sections = [];
  const newline = /\r\n|\n|\r/g;
  let offset = 0;
  let chunkStart = null;
  let chunkWords = 0;
  let chunkEnd = 0;

  function flush() {
    if (chunkStart === null || chunkEnd <= chunkStart) {
      chunkStart = null;
      chunkWords = 0;
      return;
    }
    const end = trimRangeEnd(text, chunkStart, chunkEnd);
    sections.push({ start: chunkStart, end: end, wordCount: countWords(text.slice(chunkStart, end)) });
    chunkStart = null;
    chunkWords = 0;
  }

  for (;;) {
    const match = newline.exec(text);
    const lineEnd = match ? match.index : text.length;
    const rawLine = text.slice(offset, lineEnd);
    const trimmed = rawLine.trim();
    if (trimmed) {
      if (chunkStart === null) chunkStart = offset;
      chunkWords += countWords(trimmed);
      chunkEnd = offset + rawLine.replace(/\s+$/, '').length;
    }
    if (chunkStart !== null && chunkWords >= target && trimmed === '') flush();
    if (!match) break;
    offset = lineEnd + match[0].length;
    if (offset > text.length) break;
  }
  flush();

  if (!sections.length && text.trim()) {
    const start = text.length - text.replace(/^\s+/, '').length;
    const end = trimRangeEnd(text, start, text.length);
    sections.push({ start: start, end: end, wordCount: countWords(text.slice(start, end)) });
  }
  return sections;
}

function guessTitle(text) {
  const lines = text.split(/\r\n|\n|\r/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\[.*\]$/.test(trimmed)) continue;
    if (NON_TITLE_WORDS.test(trimmed)) continue;
    if (trimmed.length > 80) break;
    if (matchHeading(trimmed)) continue;
    return trimmed
      .replace(/^["'\u201c\u201d\u2018\u2019]+/, '')
      .replace(/["'\u201c\u201d\u2018\u2019]+$/, '')
      .replace(/[;,]$/, '')
      .trim();
  }
  return undefined;
}

function parseChapters(text) {
  const source = typeof text === 'string' ? text : String(text || '');
  if (!source.trim()) return { chapters: [], title: undefined };

  let candidates = collectCandidates(source);
  candidates = dropTocClusters(candidates);

  // 强结构（章节 / 信件 / 序章 / 大写罗马标题）足够多时，正文中的全大写短行多是误判。
  const strongKinds = { chapter: true, special: true, 'roman-title': true, numbered: true };
  const strongCount = candidates.filter(function (item) { return strongKinds[item.kind]; }).length;
  const capsCount = candidates.filter(function (item) { return item.kind === 'caps'; }).length;
  if (strongCount >= 3 && capsCount < strongCount) {
    candidates = candidates.filter(function (item) { return item.kind !== 'caps'; });
  }

  // 只有一条标题且前面还有大量正文时多半是误判，改用等长切分。
  if (candidates.length === 1) {
    const leadingWords = countWords(source.slice(0, candidates[0].start));
    if (leadingWords > 50) candidates = [];
  }
  // 大量全大写标题且每段极短，多半是诗集正文被误判，放弃标题识别。
  if (candidates.length >= 5) {
    const weakCount = candidates.filter(function (item) { return item.kind === 'caps' || item.kind === 'roman'; }).length;
    const avgGap = (source.length - candidates[0].start) / candidates.length;
    if (weakCount >= candidates.length * 0.8 && avgGap < 120) candidates = [];
  }

  let chapters = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const current = candidates[i];
    const next = candidates[i + 1];
    const start = current.start;
    const rawEnd = next ? next.start : source.length;
    const end = trimRangeEnd(source, start, rawEnd);
    if (end <= start) continue;
    chapters.push({
      index: chapters.length,
      title: current.title,
      start: start,
      end: end,
      wordCount: countWords(source.slice(start, end)),
    });
  }

  // 只有标题行、几乎没有正文的条目是目录残留，剔除后重排索引。
  if (chapters.length > 1) {
    const meaningful = chapters.filter(function (item) { return item.wordCount > 3; });
    if (meaningful.length) {
      meaningful.forEach(function (item, index) { item.index = index; });
      chapters = meaningful;
    }
  }

  if (chapters.length) return { chapters: chapters, title: guessTitle(source) };

  const sections = splitIntoSections(source);
  const guessedTitle = guessTitle(source);
  return {
    chapters: sections.map(function (item, index) {
      return {
        index: index,
        // A single-section book is usually a short story: use its real title
        // rather than the impersonal "Section 1".
        title: sections.length === 1 && guessedTitle ? guessedTitle : 'Section ' + (index + 1),
        start: item.start,
        end: item.end,
        wordCount: item.wordCount,
      };
    }),
    title: guessedTitle,
  };
}

module.exports = { parseChapters, countWords, matchHeading, guessTitle };
