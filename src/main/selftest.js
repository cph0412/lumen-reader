'use strict';

// End-to-end smoke test for the Electron shell. It uses a local mock
// OpenAI-compatible endpoint so the full AI-context path is exercised without
// spending tokens or requiring network access.

const fs = require('fs');
const path = require('path');
const http = require('http');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(win, expression, timeout = 12000, interval = 120) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const value = await win.webContents.executeJavaScript(expression);
      if (value) return value;
    } catch (_) {}
    await sleep(interval);
  }
  return null;
}

async function waitForRoute(win, hash, timeout = 12000) {
  await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`);
  return waitFor(win, `(async () => {
    const view = document.querySelector('#view');
    return Boolean(window.__LUMEN_ROUTE__ && view && view.childElementCount > 0 && view.textContent.trim().length > 20);
  })()`, timeout);
}

function mockAnalysis() {
  return {
    translation: '德拉数了数钱，一共一美元八十七美分，其中六十美分是硬币。',
    sense: '这里不是在单纯报数字，而是在强调 Della 反复清点、舍不得又不得不花的窘迫。',
    grammar: '“That was all.” 是省略句，承接前句；三个短句连续出现，制造出停顿和克制的焦虑感。',
    nuance: '“bulldozing the grocer” 是口语化的夸张表达，字面是“推平杂货商”，实际指为了省一两分钱反复讨价还价。',
    collocations: ['count the money', 'the next day would be Christmas', 'save one and two at a time'],
    examples: [
      { en: 'She counted the coins twice before leaving.', zh: '她出门前把硬币数了两遍。' },
      { en: 'The next day would be Christmas.', zh: '第二天就是圣诞节了。' }
    ],
    alternatives: ['She counted every cent.', 'There was nothing left to do but count again.'],
    roots: [
      { text: 'count', type: 'root', meaning: '计算' }
    ],
    mnemonic: '联想：数硬币时一枚一枚地数，就像把注意力“count”住。',
    associations: ['count on', 'count down', 'countless'],
    level: 'B1'
  };
}

function startMockAI() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && /\/models$/.test(req.url || '')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'lumen-mock' }] }));
        return;
      }
      if (req.method === 'POST' && /\/chat\/completions$/.test(req.url || '')) {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            const payload = JSON.parse(body || '{}');
            const messages = Array.isArray(payload.messages) ? payload.messages : [];
            const last = messages[messages.length - 1] || {};
            const userContent = last.content ? String(last.content) : '';
            if (/^单词：/.test(userContent) || /中文释义：/.test(userContent)) {
              res.writeHead(200, { 'content-type': 'application/json' });
              res.end(JSON.stringify({
                choices: [{ message: { role: 'assistant', content: JSON.stringify({
                  mnemonic: '把 curious 想成“care + us”：因为在意，所以好奇。',
                  associations: ['curiosity', 'curious about', 'curiously'],
                  wordFamily: ['curiosity', 'curiously', 'incurious']
                }) } }]
              }));
              return;
            }
            const analysis = mockAnalysis();
            if (last.content && /butter/i.test(String(last.content))) {
              analysis.translation = '这是最好的黄油，你知道的。';
              analysis.sense = '“the best butter” 在这里是强调品质，也有一点自嘲式的夸张。';
            }
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              id: 'chatcmpl-lumen-test',
              object: 'chat.completion',
              choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(analysis) }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 100, completion_tokens: 120, total_tokens: 220 }
            }));
          } catch (err) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { message: String(err) } }));
          }
        });
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function runSelfTest({ windows, mainWindow, services, hotkey }) {
  const results = [];
  const record = (name, ok, detail) => {
    results.push({ name, ok, detail: detail === undefined ? '' : String(detail).slice(0, 300) });
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + String(detail).slice(0, 200) : ''));
  };
  const win = mainWindow;
  let server = null;
  try {
    server = await startMockAI();
    const port = server.address().port;
    services.settings.save({
      ai: { baseUrl: 'http://127.0.0.1:' + port + '/v1', model: 'lumen-mock', temperature: 0.2 },
      reader: { autoTranslate: true, autoAnalyze: true, theme: 'paper' },
      translation: { provider: 'auto' }
    });
    const aiSettings = services.settings.get().ai;
    record('settings: local AI available without key', aiSettings.available === true && aiSettings.local === true, JSON.stringify({ hasApiKey: aiSettings.hasApiKey, local: aiSettings.local, available: aiSettings.available }));

    try {
      const localEntry = await services.dictionary.lookup('abacus');
      record('dictionary: built-in 90k entries', Boolean(localEntry && localEntry.source === 'local' && localEntry.meanings.some((item) => String(item.definitionZh).includes('算盘'))), JSON.stringify({ source: localEntry && localEntry.source, total: services.localDictionary && services.localDictionary.stats().total }).slice(0, 220));
      const lex = services.lexicon.analyze('unhappy');
      record('lexicon: local root/affix analysis', Boolean(lex && Array.isArray(lex.parts) && lex.parts.length > 0), JSON.stringify(lex).slice(0, 220));
      const mnemonic = await services.lexicon.mnemonic({ word: 'curious', translation: '好奇的' });
      record('lexicon: AI mnemonic', Boolean(mnemonic && mnemonic.mnemonic && mnemonic.mnemonic.length > 0), JSON.stringify(mnemonic).slice(0, 220));
      const added = services.vocab.add({ word: 'unhappy', translation: '不快乐的', context: 'She felt unhappy.', source: { bookTitle: 'Test' } });
      const reviewed = services.vocab.review(added.word.id, 'good');
      const schedule = services.vocab.schedule();
      record('vocab: Ebbinghaus scheduling', Boolean(reviewed.memory) && reviewed.memory.stage === 1 && Date.parse(reviewed.memory.due) > Date.now() && schedule.intervals.length === 11, JSON.stringify({ stage: reviewed.memory && reviewed.memory.stage, due: reviewed.memory && reviewed.memory.due, intervals: schedule.intervals.length }));
      services.vocab.remove(added.word.id);
    } catch (err) {
      record('lexicon/vocab enrichment', false, err.message);
    }

    win.show();
    win.setContentSize(1440, 900);
    win.center();
    win.focus();
    await sleep(1000);
    await waitFor(win, "Boolean(window.lumen && document.querySelector('#view') && document.querySelector('#view').childElementCount)");

    const books = services.library.list();
    record('library: sample books seeded', books.length >= 6, books.length + ' books');
    const book = books.find((item) => item.id === 'sample-the-gift-of-the-magi') || books[0];

    const openedReader = await waitForRoute(win, '#/read/' + book.id + '/0');
    record('reader: route renders', Boolean(openedReader));
    const readerTitle = await win.webContents.executeJavaScript("document.querySelector('.chapter-title')?.textContent || ''");
    record('reader: real chapter title', /Gift of the Magi/i.test(readerTitle), readerTitle);

    const selected = await win.webContents.executeJavaScript(`(() => {
      const root = document.querySelector('.reader-content');
      if (!root) return false;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.nodeValue || '';
        const index = text.indexOf('Della');
        if (index === -1) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 5);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        const rect = range.getBoundingClientRect();
        const target = node.parentElement;
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.left + 4, clientY: rect.bottom, button: 0 }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.left + 4, clientY: rect.bottom, button: 0 }));
        return true;
      }
      return false;
    })()`);
    record('reader: text selection captured', Boolean(selected));

    const quick = await waitFor(win, "Boolean(document.querySelector('#lookup .lookup-translation, #lookup .lookup-error'))", 16000);
    const quickTranslation = await win.webContents.executeJavaScript("document.querySelector('#lookup .lookup-translation')?.textContent.trim() || ''");
    record('lookup: free translation', Boolean(quick) && quickTranslation.length > 0, quickTranslation);
    const aiCard = await waitFor(win, "Boolean(document.querySelector('#lookup .lookup-ai .ai-block'))", 12000);
    const aiText = await win.webContents.executeJavaScript("document.querySelector('#lookup .lookup-ai')?.textContent.trim() || ''");
    record('lookup: AI context analysis', Boolean(aiCard), aiText);
    await sleep(1400);
    try {
      const aiShot = await win.webContents.capturePage();
      fs.mkdirSync(path.join(process.cwd(), '.tmp'), { recursive: true });
      fs.writeFileSync(path.join(process.cwd(), '.tmp', 'ai-card.png'), aiShot.toPNG());
      console.log('[shot] .tmp/ai-card.png');
    } catch (_) {}

    try {
      const clickedPara = await win.webContents.executeJavaScript(`(() => {
        const button = document.querySelector('.para-translate');
        if (!button) return false;
        button.click();
        return true;
      })()`);
      const paraReady = await waitFor(win, "Boolean(document.querySelector('.para-translation'))", 20000);
      const paraInfo = await win.webContents.executeJavaScript(`(() => {
        const block = document.querySelector('.para-translation');
        if (!block) return { text: '', error: true };
        return { text: block.querySelector('.pt-text')?.textContent.trim() || '', error: block.classList.contains('is-error') };
      })()`);
      record('reader: paragraph translation', Boolean(clickedPara) && Boolean(paraReady) && !paraInfo.error && paraInfo.text.length > 0, JSON.stringify(paraInfo).slice(0, 220));
    } catch (err) {
      record('reader: paragraph translation', false, err.message);
    }

    let capturedSelection = '';
    if (hotkey) {
      record('hotkey: global shortcut registered', Boolean(hotkey.status && hotkey.status.ok), JSON.stringify(hotkey.status || {}).slice(0, 160));
      if (typeof hotkey.captureSelection === 'function') {
        // The Win32 helper sends Ctrl+C to the foreground window. Some CI /
        // remote sessions block synthetic input; in that case the helper still
        // must return cleanly instead of hanging.
        try {
          win.show();
          win.setAlwaysOnTop(true);
          win.focus();
          await sleep(500);
          const captured = await hotkey.captureSelection();
          win.setAlwaysOnTop(false);
          capturedSelection = (captured && captured.text) || '';
          record(
            'hotkey: selection helper executes',
            true,
            capturedSelection ? 'captured ' + capturedSelection.slice(0, 80) : 'no text captured (synthetic input blocked in this session)'
          );
        } catch (err) {
          win.setAlwaysOnTop(false);
          record('hotkey: selection helper executes', false, err.message);
        }
      }
    }

    // Quick panel is tested with a deterministic payload, independent of the
    // OS-level synthetic-input restrictions of the current session.
    try {
      windows.showQuick({ text: 'It was the best butter, you know.', source: 'selection' });
      const quickWin = windows.quickWindow;
      const quickVisible = Boolean(quickWin && !quickWin.isDestroyed() && quickWin.isVisible());
      const quickText = quickWin && !quickWin.isDestroyed()
        ? await waitFor(quickWin, "document.querySelector('.quick-trans')?.textContent.trim() || ''", 15000)
        : null;
      record('quick panel: opens and translates', quickVisible && Boolean(quickText), quickText || '');
      if (quickWin && !quickWin.isDestroyed()) {
        const beforeQuickSave = services.vocab.list().length;
        await quickWin.webContents.executeJavaScript("document.getElementById('q-save')?.click(); true");
        await sleep(1500);
        record('quick panel: saves to vocabulary', services.vocab.list().length > beforeQuickSave, beforeQuickSave + ' -> ' + services.vocab.list().length);
        windows.hideQuick();
      }
    } catch (err) {
      record('quick panel: opens and translates', false, err.message);
    }

    const beforeSave = services.vocab.list().length;
    const clickedSave = await win.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('#lookup .lookup-save');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    await sleep(1500);
    const afterSave = services.vocab.list().length;
    record('vocab: saving from lookup card', Boolean(clickedSave) && afterSave > beforeSave, beforeSave + ' -> ' + afterSave);

    try {
      const scrolled = await win.webContents.executeJavaScript(`(() => {
        const scroll = document.querySelector('#reader-scroll');
        if (!scroll) return 0;
        const max = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
        scroll.scrollTop = Math.round(max * 0.45);
        scroll.dispatchEvent(new Event('scroll', { bubbles: true }));
        return scroll.scrollTop;
      })()`);
      await sleep(1800);
      await waitForRoute(win, '#/library');
      const shownPercent = await waitFor(win, `(() => {
        const el = document.querySelector('.continue-meter .percent');
        if (!el) return 0;
        const value = parseInt(el.textContent, 10);
        return Number.isFinite(value) && value > 0 ? value : 0;
      })()`, 6000);
      record('library: reading progress updates after return', Boolean(scrolled) && shownPercent > 0, 'scroll=' + scrolled + ', percent=' + shownPercent);
    } catch (err) {
      record('library: reading progress updates after return', false, err.message);
    }

    try {
      await waitForRoute(win, '#/vocab');
      const drawerOpened = await win.webContents.executeJavaScript(`(() => {
        const row = document.querySelector('.vocab-row');
        if (!row) return false;
        row.click();
        return true;
      })()`);
      const drawerReady = await waitFor(win, "Boolean(document.querySelector('#vocab-drawer.is-open .vd-memory') && document.querySelector('#vd-lexicon'))", 6000);
      record('vocab: memory + roots drawer', Boolean(drawerOpened) && Boolean(drawerReady));
    } catch (err) {
      record('vocab: memory + roots drawer', false, err.message);
    }

    const reviewRoute = await waitForRoute(win, '#/review');
    record('review: route renders', Boolean(reviewRoute));
    const curveReady = await waitFor(win, "Boolean(document.querySelector('#memory-card .memory-chart'))", 5000);
    record('review: Ebbinghaus curve renders', Boolean(curveReady));
    const revealed = await win.webContents.executeJavaScript(`(() => { const btn = document.querySelector('#review-reveal'); if (!btn) return false; btn.click(); return true; })()`);
    await sleep(500);
    const rated = await win.webContents.executeJavaScript(`(() => { const btn = document.querySelector('[data-rating="good"]'); if (!btn) return false; btn.click(); return true; })()`);
    await sleep(900);
    record('review: reveal and rate', Boolean(revealed) && Boolean(rated));

    const settingsRoute = await waitForRoute(win, '#/settings');
    record('settings: route renders', Boolean(settingsRoute));
    const dictionaryCard = await win.webContents.executeJavaScript(`Boolean(
      document.querySelector('#set-oxford-app-id') &&
      Array.from(document.querySelectorAll('.settings-card')).some((el) => (el.getAttribute('aria-label') || '') === '词典')
    )`);
    record('settings: dictionary + Oxford credentials card', Boolean(dictionaryCard));
    const darkClicked = await win.webContents.executeJavaScript(`(() => { const el = document.querySelector('[data-theme-value="dark"]'); if (!el) return false; el.click(); return true; })()`);
    await sleep(900);
    const darkApplied = await win.webContents.executeJavaScript("document.documentElement.dataset.theme === 'dark'");
    const darkSaved = services.settings.getRaw().reader.theme === 'dark';
    record('settings: theme applies and persists', Boolean(darkClicked) && darkApplied && darkSaved);
    services.settings.save({ reader: { theme: 'paper' } });

    try {
      const offClicked = await win.webContents.executeJavaScript(`(() => {
        const button = document.querySelector('[data-behavior="autoAnalyze"] [data-value="0"]');
        if (!button) return false;
        button.click();
        return true;
      })()`);
      await sleep(1100);
      const savedOff = services.settings.getRaw().reader.autoAnalyze === false;
      await waitForRoute(win, '#/read/' + book.id + '/0');
      const selectedForManual = await win.webContents.executeJavaScript(`(() => {
        const root = document.querySelector('.reader-content');
        if (!root) return false;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const text = node.nodeValue || '';
          const index = text.indexOf('Della');
          if (index === -1) continue;
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + 5);
          const rect = range.getBoundingClientRect();
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.right, clientY: rect.bottom, button: 0 }));
          return true;
        }
        return false;
      })()`);
      await waitFor(win, "Boolean(document.querySelector('#lookup .lookup-translation, #lookup .lookup-error'))", 16000);
      await sleep(1800);
      const aiAutoVisible = await win.webContents.executeJavaScript("Boolean(document.querySelector('#lookup .lookup-ai .ai-block'))");
      const manualCta = await win.webContents.executeJavaScript("document.querySelector('#lookup .ai-cta')?.textContent.includes('自动解析已关闭') || false");
      record('settings: disable auto AI analysis', Boolean(offClicked) && savedOff && Boolean(selectedForManual) && !aiAutoVisible && Boolean(manualCta), JSON.stringify({ offClicked, savedOff, aiAutoVisible, manualCta }));

      windows.showQuick({ text: 'It was the best butter, you know.', source: 'selection' });
      const quickWin = windows.quickWindow;
      const quickTranslated = quickWin ? await waitFor(quickWin, "document.querySelector('.quick-trans')?.textContent.trim() || ''", 15000) : '';
      const manualButton = quickWin ? await waitFor(quickWin, "Boolean(document.querySelector('#quick-ai .quick-ai-run'))", 6000) : false;
      const quickAutoBlock = quickWin ? await quickWin.webContents.executeJavaScript("Boolean(document.querySelector('#quick-ai .quick-ai-block'))") : true;
      let manualWorked = false;
      if (quickWin && manualButton) {
        await quickWin.webContents.executeJavaScript("document.getElementById('q-ai-run')?.click(); true");
        manualWorked = Boolean(await waitFor(quickWin, "Boolean(document.querySelector('#quick-ai .quick-ai-block'))", 12000));
      }
      record('quick panel: manual AI when auto disabled', Boolean(quickTranslated) && Boolean(manualButton) && !quickAutoBlock && manualWorked, JSON.stringify({ quickTranslated: Boolean(quickTranslated), manualButton: Boolean(manualButton), quickAutoBlock, manualWorked }));
      if (quickWin && !quickWin.isDestroyed()) windows.hideQuick();

      services.settings.save({ reader: { autoAnalyze: true } });
    } catch (err) {
      record('settings: disable auto AI analysis', false, err.message);
    }

    const importedPath = path.join(process.cwd(), '.tmp', 'selftest-import-' + Date.now() + '.txt');
    fs.mkdirSync(path.dirname(importedPath), { recursive: true });
    fs.writeFileSync(importedPath, 'A Small Test Book\n\nby Lumen\n\nChapter 1\n\nThis is a short imported chapter for the smoke test.\n\nChapter 2\n\nIt has a second chapter, too.\n', 'utf8');
    const imported = await services.library.importPaths([importedPath]);
    record('library: TXT import', imported.imported.length === 1, imported.errors && imported.errors.join('; '));
    if (imported.imported[0]) {
      const importedBook = imported.imported[0];
      const chapter = services.library.getChapter(importedBook.id, 0);
      record('library: imported chapters parsed', chapter.chapter.total === 2, 'chapters=' + chapter.chapter.total);
      services.library.remove(importedBook.id);
    }
    try { fs.unlinkSync(importedPath); } catch (_) {}

    const failed = results.filter((item) => !item.ok);
    console.log('SELFTEST_SUMMARY ' + JSON.stringify({ total: results.length, failed: failed.length, failedNames: failed.map((item) => item.name) }));
    if (failed.length) {
      console.log('LUMEN_SELFTEST_FAILED');
      return { ok: false, results };
    }
    console.log('LUMEN_SELFTEST_OK');
    return { ok: true, results };
  } finally {
    if (server) server.close();
  }
}

module.exports = { runSelfTest };
