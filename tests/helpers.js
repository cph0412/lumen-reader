'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), (prefix || 'lumen-test') + '-'));
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    // 忽略清理失败
  }
}

module.exports = { makeTempDir, cleanupDir };
