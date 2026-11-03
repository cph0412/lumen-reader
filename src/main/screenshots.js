'use strict';

const fs = require('fs');
const path = require('path');

const SHOT_DIR = path.join(__dirname, '..', '..', 'docs', 'screenshots');
const TEST_DIR = path.join(__dirname, '..', '..', 'docs', 'test-artifacts');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function nav(win, hash, wait = 600) {
  const result = await win.webContents.executeJavaScript(`(async () => {
    const started = Date.now();
    location.hash = ${JSON.stringify(hash)};
    for (let i = 0; i < 120; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      const route = window.__LUMEN_ROUTE__;
      const view = document.querySelector('#view');
      if (route && route.at >= started && view && view.childElementCount > 0 && view.textContent.trim().length > 0) {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { ok: true, route: route.name, raw: route.raw, chars: view.textContent.length };
      }
    }
    return { ok: false, route: window.__LUMEN_ROUTE__ || null, chars: (document.querySelector('#view') || {}).textContent?.length || 0 };
  })()`);
  if (!result || !result.ok) console.log('[nav] not ready', hash, JSON.stringify(result));
  else console.log('[nav]', hash, result.route, result.chars);
  await sleep(wait);
}

async function capture(win, name) {
  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 160))))').catch(() => {});
  await sleep(220);
  const image = await win.webContents.capturePage();
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.writeFileSync(path.join(SHOT_DIR, name), image.toPNG());
  console.log('[shot]', name, image.getSize().width + 'x' + image.getSize().height);
}

function demoVocab(book, chapterTitle) {
  const source = { bookId: book.id, bookTitle: book.title, chapterTitle };
  return [
    {
      word: 'curious', phonetic: '/ˈkjʊəriəs/', translation: '好奇的；奇怪的',
      context: 'Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it.',
      contextTranslation: '爱丽丝开始觉得坐在河岸边姐姐身旁无事可做很无聊……',
      source, tags: ['CET4'], note: 'curious 比 strange 更强调“想知道”'
    },
    {
      word: 'peculiar', phonetic: '/pɪˈkjuːliə(r)/', translation: '奇怪的；独特的',
      context: '“and what is the use of a book,” thought Alice “without pictures or conversations?”',
      contextTranslation: '“一本没有插图也没有对话的书有什么用呢？”爱丽丝想。',
      source, tags: ['GRE'], note: '常指令人不适的古怪'
    },
    {
      word: 'vanish', phonetic: '/ˈvænɪʃ/', translation: '突然消失',
      context: 'Before she had drunk half the bottle, she found her head pressing against the ceiling, and she had to stoop to save her neck from being broken.',
      contextTranslation: '她还没喝完半瓶，就发现头已经顶到天花板了。',
      source, tags: ['CET4']
    },
    {
      word: 'opportunity', phonetic: '/ˌɒpəˈtjuːnəti/', translation: '机会；时机',
      context: 'In another moment down went Alice after it, never once considering how in the world she was to get out again.',
      contextTranslation: '紧接着，爱丽丝也跟着跳了下去，根本没考虑该怎么出来。',
      source, tags: ['CET4']
    },
    {
      word: 'conversation', phonetic: '/ˌkɒnvəˈseɪʃn/', translation: '交谈；对话',
      context: '“What is the use of a book,” thought Alice, “without pictures or conversations?”',
      contextTranslation: '“一本没有插图也没有对话的书有什么用呢？”',
      source, tags: ['CET4']
    },
    {
      word: 'delicious', phonetic: '/dɪˈlɪʃəs/', translation: '美味的；令人愉快的',
      context: 'It was the best butter, you know.',
      contextTranslation: '你知道，那是顶好的黄油。',
      source, tags: ['CET4']
    },
    {
      word: 'adventure', phonetic: '/ədˈventʃə(r)/', translation: '冒险；奇遇',
      context: 'Alice opened the door and found that it led into a small passage, not much larger than a rat-hole.',
      contextTranslation: '爱丽丝打开门，发现它通向一条不比老鼠洞大多少的小通道。',
      source, tags: ['CET4']
    },
    {
      word: 'melancholy', phonetic: '/ˈmelənkəli/', translation: '忧郁；忧伤的',
      context: 'The Hatter shook his head mournfully.',
      contextTranslation: '帽匠悲伤地摇了摇头。',
      source, tags: ['GRE', 'TEM8']
    }
  ];
}

async function seedDemo(services) {
  const books = services.library.list();
  if (!books.length) return null;
  const book = books[0];
  const chapterTitle = book.chapters[0] ? book.chapters[0].title : 'Chapter 1';
  try {
    for (const item of demoVocab(book, chapterTitle)) {
      services.vocab.add(item);
    }
  } catch (err) {
    console.error('[demo vocab]', err);
  }
  try {
    const today = new Date();
    for (let i = 0; i < 49; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const date = d.toISOString().slice(0, 10);
      // Keep a believable 5-day streak, then a visible gap before older activity.
      const restDay = i > 4 && i % 7 === 5;
      const minutes = restDay ? 0 : 12 + ((i * 13) % 32);
      const words = minutes * 9 + ((i * 17) % 180);
      if (minutes > 0) {
        services.stats.record({ type: 'read', minutes, words, date });
        services.stats.record({ type: 'lookup', count: 2 + (i % 7), date });
      }
      if (!restDay && i % 3 === 0) services.stats.record({ type: 'review', count: 3 + (i % 5), date });
    }
  } catch (err) {
    console.error('[demo stats]', err);
  }
  return book;
}

async function runScreenshotFlow({ windows, mainWindow, services }) {
  const win = mainWindow;
  win.show();
  win.setContentSize(1440, 900);
  win.center();
  await sleep(900);
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)').catch(() => {});
  const book = await seedDemo(services);

  await nav(win, '#/library', 1400);
  await capture(win, '01-library.png');

  if (book) {
    await nav(win, '#/read/' + book.id + '/0', 1500);
    await capture(win, '02-reader.png');

    // Select a real word so the screenshot shows the compact word card.
    try {
      const opened = await win.webContents.executeJavaScript(`(async () => {
        const root = document.querySelector('.reader-content');
        if (!root) return false;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const text = node.nodeValue || '';
          const index = text.search(/grocer/);
          if (index === -1) continue;
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + 6);
          const rect = range.getBoundingClientRect();
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          const target = node.parentElement;
          target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.right, clientY: rect.bottom, button: 0 }));
          document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.right, clientY: rect.bottom, button: 0 }));
          return true;
        }
        return false;
      })()`);
      if (opened) {
        const lookupState = await win.webContents.executeJavaScript(`(async () => {
          for (let i = 0; i < 100; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 120));
            const card = document.querySelector('#lookup');
            const trans = card && card.querySelector('.lookup-translation');
            const error = card && card.querySelector('.lookup-error');
            if (trans || error) return { ready: true, translation: trans ? trans.textContent.trim() : '', error: error ? error.textContent.trim() : '' };
          }
          return { ready: false };
        })()`);
        console.log('[lookup]', JSON.stringify(lookupState).slice(0, 400));
        await win.webContents.executeJavaScript(`(async () => {
          for (let i = 0; i < 28; i += 1) {
            if (document.querySelector('#lookup .dict-list') || document.querySelector('#lookup .lookup-error')) return true;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return true;
        })()`);
        await capture(win, '03-reader-lookup.png');
      }
    } catch (err) {
      console.error('[selection shot]', err);
    }
  }

  await nav(win, '#/vocab', 1200);
  await capture(win, '04-vocabulary.png');

  try {
    await win.webContents.executeJavaScript(`(() => {
      const row = document.querySelector('.vocab-row');
      if (row) row.click();
      return Boolean(row);
    })()`);
    await win.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 40; i += 1) {
        const drawer = document.querySelector('#vocab-drawer');
        const lex = drawer && drawer.querySelector('#vd-lexicon');
        if (drawer && drawer.classList.contains('is-open') && lex && lex.getAttribute('data-loading') === 'false') return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return true;
    })()`);
    await capture(win, '10-vocabulary-memory.png');
    await win.webContents.executeJavaScript("document.querySelector('#vocab-drawer [data-vd=\"close\"]')?.click(); true");
  } catch (err) {
    console.error('[vocab drawer shot]', err);
  }

  await nav(win, '#/review', 1200);
  await capture(win, '05-review.png');

  await nav(win, '#/stats', 1400);
  await capture(win, '06-stats.png');

  await nav(win, '#/settings', 1000);
  await capture(win, '07-settings.png');

  try {
    const scrolled = await win.webContents.executeJavaScript(`(() => {
      const card = Array.from(document.querySelectorAll('.settings-card')).find((el) => (el.getAttribute('aria-label') || '') === '词典');
      if (!card) return false;
      card.scrollIntoView({ block: 'start', behavior: 'instant' });
      return true;
    })()`);
    if (scrolled) {
      await sleep(700);
      await capture(win, '11-settings-dictionary.png');
    }
  } catch (err) {
    console.error('[dictionary settings shot]', err);
  }

  // Quick panel screenshot (best-effort; free translation may be unavailable).
  try {
    windows.showQuick({ text: 'It was the best butter, you know.', source: 'selection' });
    const quick = windows.quickWindow;
    if (quick && !quick.isDestroyed()) {
      const quickState = await quick.webContents.executeJavaScript(`(async () => {
        for (let i = 0; i < 120; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 120));
          const trans = document.querySelector('.quick-trans');
          const error = document.querySelector('.quick-error');
          if (trans || error) return { ready: true, translation: trans ? trans.textContent.trim() : '', error: error ? error.textContent.trim() : '' };
        }
        return { ready: false };
      })()`);
      console.log('[quick]', JSON.stringify(quickState).slice(0, 500));
      const image = await quick.webContents.capturePage();
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      fs.writeFileSync(path.join(SHOT_DIR, '08-quick-lookup.png'), image.toPNG());
      console.log('[shot] 08-quick-lookup.png', image.getSize().width + 'x' + image.getSize().height);
      quick.hide();
    }
  } catch (err) {
    console.error('[quick shot]', err);
  }

  await nav(win, '#/library', 900);
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, 'screenshot-ok.txt'), new Date().toISOString(), 'utf8');
  console.log('LUMEN_SCREENSHOTS_OK');
}

module.exports = { runScreenshotFlow };
