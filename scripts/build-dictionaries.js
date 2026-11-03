'use strict';
// Build compact per-letter dictionary shards from user-provided datasets:
//   ../../cigen_en_new.jsonl
//   ../../TOEFL.json
//   ../../Bu_Ze_Shou_Duan_Bei_Dan_Ci.jsonl
// Output: resources/dictionaries/shards/<letter>.jsonl.gz + manifest.json

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const INPUT_DIR = path.join(ROOT, '..');
const OUT_DIR = path.join(ROOT, 'resources', 'dictionaries');
const SHARD_DIR = path.join(OUT_DIR, 'shards');

const maps = new Map();
const stats = { cigen: 0, toefl: 0, buze: 0, merged: 0, skipped: 0 };

function normalizeWord(value) {
  return String(value == null ? '' : value)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function bucketOf(key) {
  const char = key.charAt(0);
  return /^[a-z]$/.test(char) ? char : '_';
}

function ensureRecord(word) {
  const key = normalizeWord(word);
  if (!key || key.length > 96) return null;
  let record = maps.get(key);
  if (!record) {
    record = { w: String(word).trim(), d: [], x: [], s: [], a: [], ph: [], fam: [], src: [] };
    maps.set(key, record);
  }
  return record;
}

function addUnique(array, value) {
  if (!value) return;
  const text = String(value).trim();
  if (!text) return;
  if (!array.includes(text)) array.push(text);
}

function addSource(record, source) {
  if (!record.src.includes(source)) record.src.push(source);
}

function cleanText(value, max) {
  return String(value == null ? '' : value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max || 5000);
}

function parseCigen(entry) {
  const word = entry.word;
  const record = ensureRecord(word);
  if (!record) return;
  stats.cigen += 1;
  addSource(record, 'cigen');
  let text = cleanText(entry.text, 5000);
  text = text.replace(/^【词根记忆】\s*/,'').trim();
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length && normalizeWord(lines[0]) === normalizeWord(word)) lines.shift();
  let pos = '';
  let zh = '';
  let noteLines = [];
  for (const line of lines) {
    const posMatch = /^((?:n|v|vt|vi|adj|adv|prep|conj|pron|num|art|aux|int)\.)\s*(.*)$/i.exec(line);
    if (posMatch && !pos) {
      pos = posMatch[1].toLowerCase();
      zh = posMatch[2].trim();
    } else if (!zh && /^[\u4e00-\u9fff]/.test(line)) {
      zh = line;
    } else {
      noteLines.push(line);
    }
  }
  if (zh) record.d.push({ pos: pos || '', zh: zh.slice(0, 500) });
  if (noteLines.length) {
    const note = noteLines.join('\n').slice(0, 2600);
    record.n = record.n ? record.n + '\n' + note : note;
  }
}

function parseToefl(entry) {
  const word = entry.headWord || (entry.content && entry.content.word && entry.content.word.wordHead);
  const record = ensureRecord(word);
  if (!record) return;
  stats.toefl += 1;
  addSource(record, 'toefl');
  const content = entry.content && entry.content.word && entry.content.word.content ? entry.content.word.content : {};
  const phone = content.usphone || content.ukphone || content.phone;
  if (phone && !record.p) record.p = String(phone).slice(0, 80);
  if (content.ukphone && !record.uk) record.uk = String(content.ukphone).slice(0, 80);
  if (content.usphone && !record.us) record.us = String(content.usphone).slice(0, 80);
  const trans = Array.isArray(content.trans) ? content.trans : [];
  for (const item of trans) {
    const zh = cleanText(item.tranCn || '', 700);
    if (!zh) continue;
    record.d.push({ pos: String(item.pos || '').trim(), zh: zh, en: cleanText(item.tranOther || '', 700) });
  }
  const sentences = content.sentence && Array.isArray(content.sentence.sentences) ? content.sentence.sentences : [];
  for (const item of sentences.slice(0, 8)) {
    if (item.sContent) record.x.push({ en: cleanText(item.sContent, 500), zh: cleanText(item.sCn || '', 500) });
  }
  const synos = content.syno && Array.isArray(content.syno.synos) ? content.syno.synos : [];
  for (const syn of synos) {
    if (!Array.isArray(syn.hwds)) continue;
    for (const h of syn.hwds) addUnique(record.s, h.w);
  }
  const phrases = content.phrase && Array.isArray(content.phrase.phrases) ? content.phrase.phrases : [];
  for (const phrase of phrases.slice(0, 30)) {
    if (phrase.pContent) record.ph.push({ en: cleanText(phrase.pContent, 180), zh: cleanText(phrase.pCn || '', 180) });
  }
  const rem = content.remMethod && content.remMethod.val ? cleanText(content.remMethod.val, 900) : '';
  if (rem && !record.r) record.r = rem;
  const rels = content.relWord && Array.isArray(content.relWord.rels) ? content.relWord.rels : [];
  for (const rel of rels.slice(0, 10)) {
    const words = Array.isArray(rel.words) ? rel.words.map((item) => ({ w: item.hwd, t: cleanText(item.tran || '', 160) })).filter((item) => item.w) : [];
    if (words.length) record.fam.push({ pos: rel.pos || '', words: words.slice(0, 12) });
  }
}

function parseBuze(entry) {
  const word = entry.word;
  const record = ensureRecord(word);
  if (!record) return;
  stats.buze += 1;
  addSource(record, 'buzhe');
  const text = cleanText(entry.text || '', 5000);
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length) {
    const first = lines[0];
    const posMatch = /^((?:n|v|vt|vi|adj|adv|prep|conj|pron|num|art|aux|int)\.)\s*(.*)$/i.exec(first);
    if (posMatch && !record.d.length) record.d.push({ pos: posMatch[1].toLowerCase(), zh: posMatch[2].trim().slice(0, 600) });
  }
  const mnemonic = /【记】([\s\S]*?)(?=\n【|$)/.exec(text);
  const origin = /【源】([\s\S]*?)(?=\n【|$)/.exec(text);
  const ex = /【例】([\s\S]*?)(?=\n【|$)/.exec(text);
  const cls = /【类】([\s\S]*?)(?=\n【|$)/.exec(text);
  if (mnemonic && !record.m) record.m = cleanText(mnemonic[1], 1800);
  if (origin && !record.r) record.r = cleanText(origin[1], 900);
  if (ex && !record.x.length) {
    const raw = cleanText(ex[1], 1200);
    if (raw) record.x.push({ en: raw, zh: '' });
  }
  const noteParts = [];
  if (cls) noteParts.push('【类】' + cleanText(cls[1], 900));
  if (noteParts.length) {
    const note = noteParts.join('\n');
    record.n = record.n ? record.n + '\n' + note : note;
  }
}

async function eachLine(file, handler) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try { handler(JSON.parse(line)); } catch (err) { stats.skipped += 1; }
  }
}

function dedupeRecord(record) {
  const seen = new Set();
  record.d = record.d.filter((item) => {
    const k = (item.pos || '') + '|' + (item.zh || '') + '|' + (item.en || '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 12);
  const examples = new Set();
  record.x = record.x.filter((item) => {
    const k = (item.en || '') + '|' + (item.zh || '');
    if (examples.has(k)) return false;
    examples.add(k);
    return true;
  }).slice(0, 8);
  record.s = record.s.slice(0, 20);
  record.ph = record.ph.slice(0, 20);
  record.fam = record.fam.slice(0, 8);
  for (const key of ['p', 'uk', 'us', 'r', 'm', 'n']) if (!record[key]) delete record[key];
  if (!record.d.length && !record.x.length && !record.n && !record.m) return false;
  return true;
}

async function main() {
  fs.mkdirSync(SHARD_DIR, { recursive: true });
  // TOEFL has the richest structured data; parse it first so its definitions
  // stay at the top when a word also appears in the other collections.
  await eachLine(path.join(INPUT_DIR, 'TOEFL.json'), parseToefl);
  await eachLine(path.join(INPUT_DIR, 'cigen_en_new.jsonl'), parseCigen);
  await eachLine(path.join(INPUT_DIR, 'Bu_Ze_Shou_Duan_Bei_Dan_Ci.jsonl'), parseBuze);

  const shards = new Map();
  for (const [key, record] of maps.entries()) {
    if (!dedupeRecord(record)) { stats.skipped += 1; continue; }
    const bucket = bucketOf(key);
    if (!shards.has(bucket)) shards.set(bucket, []);
    shards.get(bucket).push(record);
  }
  let total = 0;
  for (const [bucket, records] of shards.entries()) {
    records.sort((a, b) => a.w.localeCompare(b.w));
    const content = records.map((item) => JSON.stringify(item)).join('\n') + '\n';
    fs.writeFileSync(path.join(SHARD_DIR, bucket + '.jsonl.gz'), zlib.gzipSync(Buffer.from(content, 'utf8'), { level: 9 }));
    total += records.length;
  }
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    total,
    sources: { cigen: stats.cigen, toefl: stats.toefl, buze: stats.buze },
    shards: Array.from(shards.keys()).sort(),
    note: 'Built from user-provided local dictionary datasets. Keep source attribution with the project.'
  }, null, 2), 'utf8');
  console.log(JSON.stringify({ total, shards: shards.size, stats }, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
