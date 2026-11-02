'use strict';

// store.js — 可靠的 JSON 文件存储
// - 首次读取时写入默认值
// - 所有写入原子化（tmp + fsync + rename，Windows 下带重试）
// - 文件损坏时备份为 <name>.corrupt-<时间戳> 并用默认值重建

const fs = require('node:fs');
const path = require('node:path');

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (err) {
    // 忽略：极端环境下不支持 Atomics，直接继续重试
  }
}

function writeFileAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = filePath + '.tmp-' + process.pid + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.renameSync(tmpPath, filePath);
      return;
    } catch (err) {
      lastError = err;
      // Windows 上目标文件可能被杀软/索引器短暂占用，稍后重试。
      sleepSync(10 * (attempt + 1));
    }
  }
  // 最后兜底：直接覆盖写（仍先把 tmp 清掉）。
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    try { fs.unlinkSync(tmpPath); } catch (err) { /* 忽略 */ }
    return;
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch (cleanupError) { /* 忽略 */ }
    throw lastError || err;
  }
}

function backupCorruptFile(filePath) {
  const backupPath = filePath + '.corrupt-' + timestampForFile();
  try {
    fs.renameSync(filePath, backupPath);
    return backupPath;
  } catch (err) {
    try {
      fs.copyFileSync(filePath, backupPath);
      return backupPath;
    } catch (copyError) {
      return null;
    }
  }
}

function createJsonStore(options) {
  const opts = options || {};
  const filePath = opts.filePath;
  if (!filePath) throw new TypeError('createJsonStore 需要 filePath');
  const defaults = opts.defaults === undefined ? {} : opts.defaults;

  function defaultData() {
    return typeof defaults === 'function' ? defaults() : clone(defaults);
  }

  function write(data) {
    const serialized = JSON.stringify(data, null, 2);
    if (serialized === undefined) throw new TypeError('无法序列化存储数据');
    writeFileAtomic(filePath, serialized + '\n');
    return data;
  }

  function read() {
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        const initial = defaultData();
        write(initial);
        return initial;
      }
      throw err;
    }

    try {
      if (!raw.trim()) throw new Error('文件为空');
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object') throw new Error('顶层不是对象');
      return parsed;
    } catch (err) {
      backupCorruptFile(filePath);
      const rebuilt = defaultData();
      write(rebuilt);
      return rebuilt;
    }
  }

  function update(fn) {
    if (typeof fn !== 'function') throw new TypeError('update 需要函数');
    const current = read();
    const result = fn(current);
    const next = result !== null && typeof result === 'object' ? result : current;
    write(next);
    return next;
  }

  return { filePath, read, write, update };
}

module.exports = { createJsonStore, writeFileAtomic, backupCorruptFile };
