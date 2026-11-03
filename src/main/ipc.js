'use strict';

const { app, dialog, shell, BrowserWindow } = require('electron');
const fs = require('fs/promises');
const path = require('path');

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function registerIpc({ dataDir, library, settings, translator, dictionary, lexicon, vocab, notes, stats, historyStore, windows, hotkey }) {
  const { ipcMain } = require('electron');

  function handle(channel, fn) {
    ipcMain.handle(channel, async (event, payload) => {
      try {
        const data = await fn(payload || {}, event);
        return { ok: true, data };
      } catch (err) {
        console.error('[ipc]', channel, err);
        return {
          ok: false,
          error: { code: err.code || 'ERROR', message: err.message || '操作失败，请稍后重试' }
        };
      }
    });
  }

  function browserWindow(event) {
    return BrowserWindow.fromWebContents(event.sender);
  }

  function pushHistory(entry) {
    try {
      const data = historyStore.read();
      const items = Array.isArray(data.items) ? data.items : [];
      items.unshift(entry);
      historyStore.write({ items: items.slice(0, 100) });
    } catch (err) {
      console.error('[history]', err);
    }
  }

  function broadcastSettings() {
    const publicSettings = settings.get();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('settings:changed', publicSettings);
    }
    if (windows.quickWindow && !windows.quickWindow.isDestroyed()) {
      windows.quickWindow.webContents.send('app:theme', publicSettings.reader.theme);
    }
    return publicSettings;
  }

  // ---- app ----
  handle('app:info', async () => ({
    version: app.getVersion(),
    dataDir,
    platform: process.platform,
    hotkey: hotkey ? hotkey.status : null
  }));

  handle('app:window-action', async ({ action }, event) => {
    const win = browserWindow(event);
    if (!win) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === 'close') win.close();
  });

  handle('app:open-main', async () => {
    windows.showMain();
    windows.hideQuick();
  });

  handle('app:open-data-folder', async () => {
    await fs.mkdir(dataDir, { recursive: true });
    const error = await shell.openPath(dataDir);
    if (error) throw fail('OPEN_FAILED', error);
  });

  handle('app:open-external', async ({ url }) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw fail('INVALID_URL', '只允许打开 HTTP/HTTPS 链接');
    }
    await shell.openExternal(url);
  });

  // ---- library ----
  handle('library:list', async () => library.list());
  handle('library:get', async ({ id }) => library.get(id));

  handle('library:import-files', async () => {
    const result = await dialog.showOpenDialog(windows.mainWindow, {
      title: '导入英文 TXT',
      buttonLabel: '导入',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '文本文件', extensions: ['txt'] }]
    });
    if (result.canceled || !result.filePaths.length) {
      return { imported: [], canceled: true, errors: [] };
    }
    const imported = await library.importPaths(result.filePaths);
    return { ...imported, canceled: false };
  });

  handle('library:import-paths', async ({ paths }) => {
    if (!Array.isArray(paths) || !paths.length) throw fail('INVALID_INPUT', '没有可导入的文件');
    return library.importPaths(paths.filter((p) => typeof p === 'string'));
  });

  handle('library:remove', async ({ id }) => {
    const result = library.remove(id);
    return result;
  });

  handle('library:set-favorite', async ({ id, favorite }) => library.setFavorite(id, !!favorite));

  handle('library:save-progress', async (input) => {
    const book = library.saveProgress(input);
    const minutes = Number(input.minutesDelta) || 0;
    const words = Number(input.wordsDelta) || 0;
    if (minutes > 0 || words > 0) {
      stats.record({ type: 'read', minutes, words });
    }
    return book;
  });

  handle('library:set-status', async ({ id, status }) => library.setStatus(id, status));

  // ---- reader ----
  handle('reader:get-chapter', async ({ bookId, chapterIndex }) => {
    const payload = library.getChapter(bookId, Number(chapterIndex) || 0);
    return { ...payload, bookmarks: library.listBookmarks(bookId) };
  });

  handle('reader:search', async ({ bookId, query }) => {
    if (typeof query !== 'string' || !query.trim()) return [];
    return library.search(bookId, query.trim());
  });

  handle('reader:toggle-bookmark', async (input) => library.toggleBookmark(input));

  // ---- lookup ----
  handle('lookup:quick', async ({ text, context, bookId }) => {
    if (typeof text !== 'string' || !text.trim()) throw fail('INVALID_INPUT', '没有需要翻译的文本');
    const clean = text.trim().slice(0, 4000);
    const result = await translator.lookup({ text: clean, context: (context || '').slice(0, 4000) });
    let bookTitle = '';
    let chapterTitle = '';
    if (bookId) {
      try {
        const book = library.get(bookId);
        bookTitle = book.title;
        chapterTitle = book.chapters[book.progress.chapterIndex]?.title || '';
      } catch (_) {}
    }
    if (result.translation) {
      pushHistory({
        id: 'h_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        text: clean,
        kind: result.kind,
        translation: result.translation,
        provider: result.provider,
        bookId: bookId || undefined,
        bookTitle: bookTitle || undefined,
        chapterTitle: chapterTitle || undefined,
        createdAt: new Date().toISOString()
      });
      stats.record({ type: 'lookup' });
    }
    return result;
  });

  handle('lookup:analyze', async ({ text, context, bookId, chapterTitle }) => {
    if (typeof text !== 'string' || !text.trim()) throw fail('INVALID_INPUT', '没有可分析的文本');
    return translator.analyze({
      text: text.trim().slice(0, 3000),
      context: (context || '').slice(0, 5000),
      chapterTitle: chapterTitle || ''
    });
  });

  handle('lookup:dictionary', async ({ word }) => {
    const clean = String(word || '').trim();
    if (!clean) return null;
    if (dictionary && typeof dictionary.lookup === 'function') return dictionary.lookup(clean);
    if (typeof translator.dictionary === 'function') return translator.dictionary(clean);
    const result = await translator.lookup({ text: clean });
    return result.dictionary || null;
  });

  handle('lookup:lexicon', async ({ word }) => {
    const clean = String(word || '').trim();
    if (!clean) throw fail('INVALID_INPUT', '单词不能为空');
    if (!lexicon || typeof lexicon.analyze !== 'function') return null;
    return lexicon.analyze(clean);
  });

  handle('lookup:mnemonic', async (input) => {
    if (!input || typeof input.word !== 'string' || !input.word.trim()) throw fail('INVALID_INPUT', '单词不能为空');
    if (!lexicon || typeof lexicon.mnemonic !== 'function') throw fail('UNAVAILABLE', '联想记忆服务不可用');
    return lexicon.mnemonic(input);
  });

  handle('lookup:history', async ({ limit }) => {
    const items = historyStore.read().items || [];
    return items.slice(0, Math.min(Number(limit) || 30, 100));
  });

  // ---- vocab ----
  handle('vocab:list', async (filter) => vocab.list(filter || {}));
  handle('vocab:add', async (input) => {
    if (!input || typeof input.word !== 'string' || !input.word.trim()) {
      throw fail('INVALID_INPUT', '单词不能为空');
    }
    return vocab.add(input);
  });
  handle('vocab:update', async ({ id, patch }) => vocab.update(id, patch || {}));
  handle('vocab:remove', async ({ id }) => vocab.remove(id));
  handle('vocab:due', async ({ limit }) => vocab.due(Number(limit) || 30));
  handle('vocab:review', async ({ id, rating }) => {
    const result = vocab.review(id, rating);
    stats.record({ type: 'review' });
    return result;
  });
  handle('vocab:stats', async () => vocab.stats());
  handle('vocab:schedule', async () => (typeof vocab.schedule === 'function' ? vocab.schedule() : { intervals: [], maxStage: 10 }));
  handle('vocab:is-saved', async ({ normalized }) => vocab.isSaved(String(normalized || '')));

  handle('vocab:export-csv', async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(windows.mainWindow, {
      title: '导出 Lumen 生词本',
      defaultPath: 'Lumen-生词本-' + stamp + '.csv',
      filters: [{ name: 'CSV 表格', extensions: ['csv'] }]
    });
    if (result.canceled || !result.filePath) return { saved: false };
    return vocab.exportCsv(result.filePath);
  });

  // ---- notes ----
  handle('notes:list', async ({ bookId }) => notes.list(bookId || undefined));
  handle('notes:add', async (input) => notes.add(input || {}));
  handle('notes:remove', async ({ id }) => notes.remove(id));

  // ---- stats ----
  handle('stats:overview', async () => {
    const overview = stats.overview();
    const vs = vocab.stats();
    const goalMinutes = settings.getRaw().general.dailyGoalMinutes || 30;
    return {
      ...overview,
      today: { ...overview.today, added: vs.addedToday, reviews: Math.max(overview.today.reviews || 0, vs.reviewedToday || 0) },
      vocab: { total: vs.total, due: vs.due, learning: vs.learning, mastered: vs.mastered, new: vs.new },
      mastery: { new: vs.new, learning: vs.learning, mastered: vs.mastered },
      goal: { minutes: goalMinutes }
    };
  });

  handle('stats:record', async (input) => {
    stats.record(input);
  });

  handle('stats:heatmap', async ({ days }) => stats.heatmap(Number(days) || 120));

  // ---- settings ----
  handle('settings:get', async () => settings.get());

  handle('settings:save', async ({ patch }) => {
    if (!patch || typeof patch !== 'object') throw fail('INVALID_INPUT', '设置内容无效');
    settings.save(patch);
    if (hotkey) hotkey.register(settings.getRaw().general.hotkey);
    return broadcastSettings();
  });

  handle('settings:test-ai', async () => translator.testAI());

  handle('settings:test-dictionary', async () => {
    if (dictionary && typeof dictionary.testDictionary === 'function') return dictionary.testDictionary();
    return { ok: false, provider: 'free', message: '词典服务不可用' };
  });

  handle('settings:export-data', async () => {
    const result = await dialog.showOpenDialog(windows.mainWindow, {
      title: '选择备份保存位置',
      buttonLabel: '保存到这里',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return { saved: false };
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const target = path.join(result.filePaths[0], 'Lumen-backup-' + stamp);
    await fs.mkdir(target, { recursive: true });
    const files = ['library.json', 'vocab.json', 'notes.json', 'stats.json'];
    for (const name of files) {
      try { await fs.copyFile(path.join(dataDir, name), path.join(target, name)); } catch (_) {}
    }
    try {
      const raw = settings.getRaw();
      delete raw.ai.apiKey;
      raw.ai.hasApiKey = false;
      raw.ai.keyHint = '';
      if (raw.dictionary) {
        delete raw.dictionary.oxfordAppKey;
        raw.dictionary.hasOxfordAppKey = false;
        raw.dictionary.oxfordKeyHint = '';
      }
      await fs.writeFile(path.join(target, 'settings.json'), JSON.stringify(raw, null, 2), 'utf8');
    } catch (_) {}
    try {
      await fs.cp(path.join(dataDir, 'books'), path.join(target, 'books'), { recursive: true });
    } catch (_) {}
    await fs.writeFile(
      path.join(target, 'manifest.json'),
      JSON.stringify({ app: 'lumen-reader', version: app.getVersion(), createdAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
    return { saved: true, path: target };
  });

  handle('settings:import-data', async () => {
    const result = await dialog.showOpenDialog(windows.mainWindow, {
      title: '选择 Lumen 备份文件夹',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return { imported: false };
    const source = result.filePaths[0];
    try {
      await fs.access(path.join(source, 'library.json'));
    } catch (_) {
      throw fail('INVALID_BACKUP', '这个文件夹里没有找到 Lumen 备份');
    }
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const backupDir = path.join(dataDir, 'backups', 'before-import-' + stamp);
    await fs.mkdir(backupDir, { recursive: true });
    for (const name of ['library.json', 'vocab.json', 'notes.json', 'stats.json', 'settings.json']) {
      try { await fs.copyFile(path.join(dataDir, name), path.join(backupDir, name)); } catch (_) {}
    }
    for (const name of ['library.json', 'vocab.json', 'notes.json', 'stats.json', 'settings.json']) {
      try { await fs.copyFile(path.join(source, name), path.join(dataDir, name)); } catch (_) {}
    }
    try {
      await fs.cp(path.join(source, 'books'), path.join(dataDir, 'books'), { recursive: true, force: false });
    } catch (_) {}
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 900);
    return { imported: true, message: '导入完成，应用即将重启' };
  });

  // ---- quick ----
  handle('quick:hide', async () => windows.hideQuick());
  handle('quick:show-for-selection', async ({ text }) => {
    if (typeof text !== 'string' || !text.trim()) throw fail('INVALID_INPUT', '没有可翻译文本');
    windows.showQuick({ text: text.trim().slice(0, 4000), source: 'selection' });
  });
}

module.exports = { registerIpc };
