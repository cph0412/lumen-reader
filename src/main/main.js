'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { registerAppScheme, installAppProtocol } = require('./protocols');
const { WindowManager } = require('./windows');
const { HotkeyManager } = require('./hotkey');
const { registerIpc } = require('./ipc');
const { createSettingsService } = require('./services/settings');
const { createLibraryService } = require('./services/library');
const { createTranslationService } = require('./services/translator');
const { createDictionaryService } = require('./services/dictionary');
const { createLocalDictionaryService } = require('./services/local-dictionary');
const { createLexiconService } = require('./services/lexicon');
const { createVocabService } = require('./services/vocab');
const { createNotesService } = require('./services/notes');
const { createStatsService } = require('./services/stats');
const { createJsonStore } = require('./services/store');

const IS_SCREENSHOT = process.argv.includes('--screenshots');
const IS_SMOKE = process.argv.includes('--smoke');
const IS_SELFTEST = process.argv.includes('--selftest');
const IS_TEST_MODE = IS_SCREENSHOT || IS_SMOKE || IS_SELFTEST;

if (IS_TEST_MODE) {
  const dir = path.join(os.tmpdir(), 'lumen-test-' + process.pid);
  app.setPath('userData', dir);
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
}

registerAppScheme();

const gotLock = IS_TEST_MODE ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function resourcePath(name) {
  if (app.isPackaged) return path.join(process.resourcesPath, name);
  return path.join(__dirname, '..', '..', 'resources', name);
}

function appIconPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'icon.png');
  return path.join(__dirname, '..', '..', 'build', 'icon.png');
}

function createSecretCodec() {
  let available = false;
  try {
    available = safeStorage.isEncryptionAvailable();
  } catch (_) {}
  return {
    available,
    encrypt(value) {
      if (!value) return '';
      if (available) {
        try {
          return 'enc:' + safeStorage.encryptString(String(value)).toString('base64');
        } catch (_) {}
      }
      return 'b64:' + Buffer.from(String(value), 'utf8').toString('base64');
    },
    decrypt(value) {
      if (!value) return '';
      try {
        if (String(value).startsWith('enc:')) {
          return safeStorage.decryptString(Buffer.from(String(value).slice(4), 'base64'));
        }
        if (String(value).startsWith('b64:')) {
          return Buffer.from(String(value).slice(4), 'base64').toString('utf8');
        }
      } catch (_) {
        return '';
      }
      return String(value);
    }
  };
}

let windows = null;
let tray = null;
let services = null;
let hotkeyManager = null;

async function boot() {
  await installAppProtocol();
  const dataDir = app.getPath('userData');
  fs.mkdirSync(dataDir, { recursive: true });

  const secret = createSecretCodec();
  const settings = createSettingsService({ dataDir, secret });
  const library = createLibraryService({ dataDir, sampleDir: resourcePath('samples') });
  await library.init();
  try {
    await library.ensureSamples();
  } catch (err) {
    console.error('[samples]', err);
  }
  const translator = createTranslationService({ settings });
  const localDictionary = createLocalDictionaryService({ dictionaryDir: resourcePath('dictionaries') });
  const dictionary = createDictionaryService({ settings, localDictionary });
  const lexicon = createLexiconService({ settings, dataDir });
  const vocab = createVocabService({ dataDir });
  const notes = createNotesService({ dataDir });
  const stats = createStatsService({ dataDir });
  const historyStore = createJsonStore({ filePath: path.join(dataDir, 'history.json'), defaults: { items: [] } });

  services = { dataDir, settings, library, translator, dictionary, localDictionary, lexicon, vocab, notes, stats, historyStore };

  windows = new WindowManager({
    preloadPath: path.join(__dirname, 'preload.js'),
    iconPath: appIconPath(),
    shouldMinimizeToTray: () => {
      try { return settings.getRaw().general.minimizeToTray; } catch (_) { return false; }
    }
  });

  const mainWindow = windows.createMainWindow();
  windows.createQuickWindow();
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  hotkeyManager = new HotkeyManager({
    settings,
    helperPath: resourcePath('SelectionGrabber.exe'),
    windows,
    onError: (message) => console.warn('[hotkey]', message)
  });
  hotkeyManager.register(settings.getRaw().general.hotkey);

  registerIpc({
    dataDir,
    library,
    settings,
    translator,
    dictionary,
    lexicon,
    vocab,
    notes,
    stats,
    historyStore,
    windows,
    hotkey: hotkeyManager
  });

  if (!IS_TEST_MODE) createTray();

  if (IS_SELFTEST) {
    const { runSelfTest } = require('./selftest');
    try {
      const result = await runSelfTest({ windows, mainWindow, services, hotkey: hotkeyManager });
      app.exit(result.ok ? 0 : 1);
    } catch (err) {
      console.error('LUMEN_SELFTEST_CRASHED', err);
      app.exit(1);
    }
    return;
  }

  if (IS_TEST_MODE) {
    const { runScreenshotFlow } = require('./screenshots');
    try {
      await runScreenshotFlow({ app, windows, mainWindow, services });
      if (IS_SMOKE) console.log('LUMEN_SMOKE_OK');
      app.exit(0);
    } catch (err) {
      console.error('LUMEN_SCREENSHOT_FAILED', err);
      app.exit(1);
    }
  }
}

function createTray() {
  const iconPath = resourcePath('tray.png');
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) image = nativeImage.createFromPath(appIconPath());
  tray = new Tray(image.resize({ width: 16, height: 16 }));
  tray.setToolTip('Lumen · 流明阅读');
  const rebuild = () => {
    const menu = Menu.buildFromTemplate([
      { label: '打开 Lumen', click: () => windows.showMain() },
      { label: '划词翻译  Alt+Shift+D', click: () => { if (hotkeyManager) hotkeyManager.trigger(); } },
      { type: 'separator' },
      { label: '今日复习', click: () => { windows.showMain(); windows.sendToMain('app:navigate', { route: 'review' }); } },
      { label: '生词本', click: () => { windows.showMain(); windows.sendToMain('app:navigate', { route: 'vocab' }); } },
      { label: '设置', click: () => { windows.showMain(); windows.sendToMain('app:navigate', { route: 'settings' }); } },
      { type: 'separator' },
      { label: '退出', click: () => { windows.setForceQuit(true); app.quit(); } }
    ]);
    tray.setContextMenu(menu);
  };
  rebuild();
  tray.on('click', () => windows.toggleMain());
  tray.on('double-click', () => windows.showMain());
}

app.on('second-instance', () => {
  if (windows) windows.showMain();
});

app.whenReady().then(boot).catch((err) => {
  console.error(err);
  try {
    require('electron').dialog.showErrorBox('Lumen 启动失败', String(err && err.stack ? err.stack : err));
  } catch (_) {}
  app.quit();
});

app.on('activate', () => {
  if (windows) windows.showMain();
});

app.on('before-quit', () => {
  if (windows) windows.setForceQuit(true);
  try {
    const { globalShortcut } = require('electron');
    globalShortcut.unregisterAll();
  } catch (_) {}
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !tray) app.quit();
});
