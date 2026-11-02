'use strict';

const { globalShortcut, clipboard } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');

function execSelectionHelper(helperPath, timeout = 1600) {
  return new Promise((resolve) => {
    if (!helperPath || !fs.existsSync(helperPath)) return resolve('');
    execFile(
      helperPath,
      [],
      { windowsHide: true, timeout, encoding: 'buffer', maxBuffer: 1024 * 512 },
      (error, stdout) => {
        if (error && (!stdout || stdout.length === 0)) return resolve('');
        resolve(Buffer.from(stdout || '').toString('utf8').replace(/\u0000/g, '').trim());
      }
    );
  });
}

class HotkeyManager {
  constructor({ settings, helperPath, windows, onError }) {
    this.settings = settings;
    this.helperPath = helperPath;
    this.windows = windows;
    this.onError = onError || (() => {});
    this.currentAccelerator = null;
    this.status = { ok: false, accelerator: null };
  }

  register(accelerator) {
    if (this.currentAccelerator) {
      try { globalShortcut.unregister(this.currentAccelerator); } catch (_) {}
      this.currentAccelerator = null;
    }
    const candidate = (accelerator || 'Alt+Shift+D').trim();
    try {
      const ok = globalShortcut.register(candidate, () => this.trigger());
      this.status = { ok, accelerator: candidate };
      if (ok) {
        this.currentAccelerator = candidate;
        return this.status;
      }
      this.onError('全局快捷键被占用：' + candidate);
    } catch (err) {
      this.onError('全局快捷键格式无效：' + candidate);
    }
    // Try a friendly fallback so the feature still works.
    if (candidate !== 'Alt+Shift+L') {
      try {
        const ok = globalShortcut.register('Alt+Shift+L', () => this.trigger());
        if (ok) {
          this.currentAccelerator = 'Alt+Shift+L';
          this.status = { ok: true, accelerator: 'Alt+Shift+L', fallback: true };
          return this.status;
        }
      } catch (_) {}
    }
    this.status = { ok: false, accelerator: candidate };
    return this.status;
  }

  async captureSelection() {
    let text = await execSelectionHelper(this.helperPath);
    if (text) return { text: text.slice(0, 4000), source: 'selection' };
    try {
      const clip = clipboard.readText().trim();
      if (clip && /[A-Za-z]/.test(clip)) {
        return { text: clip.slice(0, 4000), source: 'clipboard' };
      }
    } catch (_) {}
    return { text: '', source: 'none' };
  }

  async trigger() {
    if (this.windows.quickWindow && this.windows.quickWindow.isVisible()) {
      this.windows.hideQuick();
      return;
    }
    const captured = await this.captureSelection();
    if (!captured.text) {
      this.windows.showQuick({
        text: '',
        source: 'none',
        error: '没有捕获到选中文本。请先在任意应用中选中英文，再按一次快捷键。'
      });
      return;
    }
    this.windows.showQuick({ text: captured.text, source: captured.source });
  }
}

module.exports = { HotkeyManager, execSelectionHelper };
