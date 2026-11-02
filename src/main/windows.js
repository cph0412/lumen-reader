'use strict';

const { BrowserWindow, screen, nativeImage } = require('electron');
const path = require('path');

const MAIN_BG = '#F6F1E7';
const QUICK_WIDTH = 420;
const QUICK_HEIGHT = 480;

class WindowManager {
  constructor({ preloadPath, iconPath, shouldMinimizeToTray }) {
    this.preloadPath = preloadPath;
    this.iconPath = iconPath;
    this.shouldMinimizeToTray = shouldMinimizeToTray || (() => false);
    this.mainWindow = null;
    this.quickWindow = null;
    this.quickReady = false;
    this.quickHideTimer = null;
    this.forceQuit = false;
  }

  createMainWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) return this.mainWindow;
    const win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1080,
      minHeight: 720,
      show: false,
      frame: false,
      titleBarStyle: 'hidden',
      backgroundColor: MAIN_BG,
      icon: this.iconPath,
      title: 'Lumen · 流明阅读',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false,
        backgroundThrottling: false
      }
    });
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (level >= 2) console.log('[renderer]', level, message, sourceId + ':' + line);
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      console.error('[renderer gone]', details);
    });
    win.loadURL('app://lumen/index.html');
    win.once('ready-to-show', () => {
      if (!process.argv.includes('--screenshots') && !process.argv.includes('--smoke')) win.show();
    });
    win.on('close', (event) => {
      if (this.forceQuit) return;
      try {
        if (this.shouldMinimizeToTray()) {
          event.preventDefault();
          win.hide();
        }
      } catch (_) {
        // settings may not be ready during early boot
      }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) require('electron').shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('app://lumen/')) {
        event.preventDefault();
        if (/^https?:/i.test(url)) require('electron').shell.openExternal(url);
      }
    });
    this.mainWindow = win;
    return win;
  }

  createQuickWindow() {
    if (this.quickWindow && !this.quickWindow.isDestroyed()) return this.quickWindow;
    const win = new BrowserWindow({
      width: QUICK_WIDTH,
      height: QUICK_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      roundedCorners: true,
      title: 'Lumen 划词',
      icon: this.iconPath,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false,
        backgroundThrottling: false
      }
    });
    win.loadURL('app://lumen/quick.html');
    win.setAlwaysOnTop(true, 'pop-up-menu');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.on('blur', () => {
      if (!win.isDestroyed() && !win.webContents.isDevToolsOpened()) {
        this.scheduleQuickHide();
      }
    });
    win.webContents.on('did-finish-load', () => {
      this.quickReady = true;
    });
    this.quickWindow = win;
    return win;
  }

  scheduleQuickHide() {
    clearTimeout(this.quickHideTimer);
    this.quickHideTimer = setTimeout(() => this.hideQuick(), 140);
  }

  positionQuickWindow() {
    const win = this.quickWindow;
    if (!win) return;
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const area = display.workArea;
    let x = Math.round(cursor.x - QUICK_WIDTH + 28);
    let y = Math.round(cursor.y + 18);
    x = Math.max(area.x + 12, Math.min(x, area.x + area.width - QUICK_WIDTH - 12));
    y = Math.max(area.y + 12, Math.min(y, area.y + area.height - QUICK_HEIGHT - 12));
    win.setPosition(x, y, false);
  }

  showQuick(payload) {
    const win = this.createQuickWindow();
    this.positionQuickWindow();
    win.show();
    win.focus();
    const send = () => {
      if (!win.isDestroyed()) win.webContents.send('quick:data', payload);
    };
    if (this.quickReady) send();
    else win.webContents.once('did-finish-load', send);
  }

  hideQuick() {
    clearTimeout(this.quickHideTimer);
    if (this.quickWindow && !this.quickWindow.isDestroyed()) {
      this.quickWindow.hide();
    }
  }

  showMain() {
    const win = this.createMainWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  toggleMain() {
    const win = this.createMainWindow();
    if (win.isVisible() && !win.isMinimized()) win.hide();
    else this.showMain();
  }

  sendToMain(channel, payload) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, payload);
    }
  }

  setForceQuit(value) {
    this.forceQuit = value;
  }
}

module.exports = { WindowManager };
