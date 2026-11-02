'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

async function call(channel, payload) {
  const response = await ipcRenderer.invoke(channel, payload);
  if (response && response.ok) return response.data;
  const message = (response && response.error && response.error.message) || '操作失败，请稍后重试';
  const error = new Error(message);
  error.code = (response && response.error && response.error.code) || 'UNKNOWN';
  throw error;
}

function on(channel, callback) {
  const listener = (_event, data) => {
    try {
      callback(data);
    } catch (err) {
      console.error('[lumen] event handler failed', err);
    }
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  platform: process.platform,
  app: {
    info: () => call('app:info'),
    windowAction: (action) => call('app:window-action', { action }),
    openMain: () => call('app:open-main'),
    openDataFolder: () => call('app:open-data-folder'),
    openExternal: (url) => call('app:open-external', { url }),
    getPathForFile: (file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch (_) {
        return '';
      }
    }
  },
  library: {
    list: () => call('library:list'),
    get: (id) => call('library:get', { id }),
    importFiles: () => call('library:import-files'),
    importPaths: (paths) => call('library:import-paths', { paths }),
    remove: (id) => call('library:remove', { id }),
    setFavorite: (id, favorite) => call('library:set-favorite', { id, favorite }),
    saveProgress: (input) => call('library:save-progress', input),
    setStatus: (id, status) => call('library:set-status', { id, status })
  },
  reader: {
    getChapter: (bookId, chapterIndex) => call('reader:get-chapter', { bookId, chapterIndex }),
    search: (bookId, query) => call('reader:search', { bookId, query }),
    toggleBookmark: (input) => call('reader:toggle-bookmark', input)
  },
  lookup: {
    quick: (input) => call('lookup:quick', input),
    analyze: (input) => call('lookup:analyze', input),
    dictionary: (word) => call('lookup:dictionary', { word }),
    history: (limit) => call('lookup:history', { limit })
  },
  vocab: {
    list: (filter) => call('vocab:list', filter || {}),
    add: (input) => call('vocab:add', input),
    update: (id, patch) => call('vocab:update', { id, patch }),
    remove: (id) => call('vocab:remove', { id }),
    due: (limit) => call('vocab:due', { limit }),
    review: (id, rating) => call('vocab:review', { id, rating }),
    stats: () => call('vocab:stats'),
    exportCsv: () => call('vocab:export-csv'),
    isSaved: (normalized) => call('vocab:is-saved', { normalized })
  },
  notes: {
    list: (bookId) => call('notes:list', { bookId }),
    add: (input) => call('notes:add', input),
    remove: (id) => call('notes:remove', { id })
  },
  stats: {
    overview: () => call('stats:overview'),
    record: (input) => call('stats:record', input),
    heatmap: (days) => call('stats:heatmap', { days })
  },
  settings: {
    get: () => call('settings:get'),
    save: (patch) => call('settings:save', { patch }),
    testAI: () => call('settings:test-ai'),
    exportData: () => call('settings:export-data'),
    importData: () => call('settings:import-data')
  },
  quick: {
    hide: () => call('quick:hide'),
    showForSelection: (text) => call('quick:show-for-selection', { text })
  },
  events: {
    onQuickLookup: (cb) => on('quick:data', cb),
    onNavigate: (cb) => on('app:navigate', cb),
    onTheme: (cb) => on('app:theme', cb),
    onSettingsChanged: (cb) => on('settings:changed', cb)
  }
};

contextBridge.exposeInMainWorld('lumen', api);
