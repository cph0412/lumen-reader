'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseChapters, countWords } = require('../src/main/util/chapters');

test('countWords: 缩写、连字符与数字', function () {
  assert.equal(countWords("It's a well-known fact."), 4);
  assert.equal(countWords("Mr. Smith arrived at 5 p.m."), 6);
  assert.equal(countWords("don't"), 1);
  assert.equal(countWords(''), 0);
  assert.equal(countWords('hello world'), 2);
  assert.equal(countWords('中文'), 2);
  assert.equal(countWords('one-two three'), 2);
});

test('parseChapters: Chapter 1 / Chapter 2', function () {
  const text = [
    'The Test Book',
    '',
    'by Jane Doe',
    '',
    'Chapter 1',
    'Alpha beta gamma delta epsilon.',
    '',
    'Chapter 2',
    'Zeta eta theta iota kappa.',
    '',
    'Chapter 3',
    'Lambda mu nu xi omicron.',
    '',
  ].join('\n');
  const parsed = parseChapters(text);
  assert.equal(parsed.chapters.length, 3);
  assert.deepEqual(parsed.chapters.map(function (c) { return c.title; }), ['Chapter 1', 'Chapter 2', 'Chapter 3']);
  assert.deepEqual(parsed.chapters.map(function (c) { return c.index; }), [0, 1, 2]);
  assert.equal(parsed.title, 'The Test Book');
  for (const chapter of parsed.chapters) {
    assert.ok(chapter.wordCount > 0);
    assert.ok(chapter.end > chapter.start);
    assert.ok(text.slice(chapter.start, chapter.end).startsWith(chapter.title));
  }
  assert.ok(parsed.chapters[0].end <= parsed.chapters[1].start);
  assert.equal(parsed.chapters[2].end, text.trimEnd().length);
});

test('parseChapters: CHAPTER I / PART ONE', function () {
  const text = [
    'A Book',
    '',
    'CHAPTER I',
    'The first chapter has several words in it.',
    '',
    'CHAPTER II',
    'The second chapter also has several words.',
    '',
    'PART ONE',
    'The third part begins here with more words.',
    '',
  ].join('\n');
  const parsed = parseChapters(text);
  assert.equal(parsed.chapters.length, 3);
  assert.equal(parsed.chapters[0].title, 'CHAPTER I');
  assert.equal(parsed.chapters[2].title, 'PART ONE');
});

test('parseChapters: 第X章', function () {
  const text = ['书名', '', '第一章', '这是第一章的正文内容，包含足够多的词语。', '', '第二章', '这是第二章的正文内容，也包含很多词语。', ''].join('\n');
  const parsed = parseChapters(text);
  assert.equal(parsed.chapters.length, 2);
  assert.equal(parsed.chapters[0].title, '第一章');
  assert.equal(parsed.chapters[1].title, '第二章');
});

test('parseChapters: Letter 1', function () {
  const text = ['Frankenstein', '', 'Letter 1', 'To Mrs. Saville, England.', 'Some text of the letter.', '', 'Letter 2', 'Another letter body.', ''].join('\n');
  const parsed = parseChapters(text);
  assert.equal(parsed.chapters.length, 2);
  assert.equal(parsed.chapters[0].title, 'Letter 1');
});

test('parseChapters: 全大写短标题与罗马数字标题', function () {
  const text = [
    'A Book',
    '',
    'THE BEGINNING',
    'It was a dark and stormy night in the old town.',
    '',
    'I. A SCANDAL IN BOHEMIA',
    'To Sherlock Holmes she is always the woman of the story.',
    '',
    'THE END OF IT',
    'And so the story came to a quiet close at last.',
    '',
  ].join('\n');
  const parsed = parseChapters(text);
  assert.equal(parsed.chapters.length, 3);
  assert.equal(parsed.chapters[0].title, 'THE BEGINNING');
  assert.equal(parsed.chapters[1].title, 'I. A SCANDAL IN BOHEMIA');
});

test('parseChapters: 目录块被丢弃', function () {
  const body = 'Body paragraph with enough words to look like real prose. ';
  const text = [
    'Contents',
    'Chapter 1',
    'Chapter 2',
    'Chapter 3',
    'Chapter 4',
    '',
    'Chapter 1',
    body.repeat(8).trim(),
    '',
    'Chapter 2',
    body.repeat(8).trim(),
    '',
    'Chapter 3',
    body.repeat(8).trim(),
    '',
    'Chapter 4',
    body.repeat(8).trim(),
    '',
  ].join('\n');
  const parsed = parseChapters(text);
  assert.equal(parsed.chapters.length, 4);
  assert.equal(parsed.chapters[0].start, text.indexOf('Chapter 1', 20));
});

test('parseChapters: 无章节时按约 4500 词切 Section', function () {
  const paragraph = ('word '.repeat(100)).trim();
  const text = new Array(100).fill(paragraph).join('\n\n') + '\n';
  const parsed = parseChapters(text);
  assert.ok(parsed.chapters.length >= 3);
  parsed.chapters.forEach(function (chapter, index) {
    assert.equal(chapter.title, 'Section ' + (index + 1));
    assert.ok(chapter.wordCount >= 1000);
    assert.ok(chapter.wordCount <= 5200);
  });
  const sum = parsed.chapters.reduce(function (total, chapter) { return total + chapter.wordCount; }, 0);
  assert.ok(sum >= 9000, 'sum=' + sum);
});

test('parseChapters: 空文本', function () {
  const parsed = parseChapters('   \n\n  ');
  assert.deepEqual(parsed.chapters, []);
});

test('parseChapters: 正文中的 "said I." 不误判', function () {
  const text = [
    'A Story',
    '',
    'It was a long conversation about many things that mattered.',
    '',
    'said I.',
    '',
    'Then the conversation continued for a while longer here.',
    '',
  ].join('\n');
  const parsed = parseChapters(text);
  assert.ok(parsed.chapters.length === 1);
  assert.equal(parsed.chapters[0].title, 'A Story');
});
