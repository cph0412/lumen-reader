'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeTempDir, cleanupDir } = require('./helpers');
const { createSettingsService } = require('../src/main/services/settings');

function makeSecret() {
  const prefix = 'enc:';
  return {
    encrypt: function (plain) {
      return prefix + Buffer.from(plain, 'utf8').toString('base64');
    },
    decrypt: function (payload) {
      const raw = payload.indexOf(prefix) === 0 ? payload.slice(prefix.length) : payload;
      return Buffer.from(raw, 'base64').toString('utf8');
    },
  };
}

function makeService(t, secret) {
  const dataDir = makeTempDir('lumen-settings');
  t.after(function () { cleanupDir(dataDir); });
  const service = createSettingsService({ dataDir: dataDir, secret: secret });
  return { service: service, dataDir: dataDir };
}

test('settings: 默认值对齐产品契约', function (t) {
  const ctx = makeService(t, makeSecret());
  const settings = ctx.service.get();
  assert.equal(settings.ai.baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(settings.ai.model, 'deepseek-chat');
  assert.equal(settings.ai.hasApiKey, false);
  assert.equal(settings.ai.keyHint, '');
  assert.equal(settings.reader.theme, 'paper');
  assert.equal(settings.reader.fontSize, 19);
  assert.equal(settings.reader.lineHeight, 1.9);
  assert.equal(settings.reader.contentWidth, 700);
  assert.equal(settings.reader.justify, false);
  assert.equal(settings.reader.autoTranslate, true);
  assert.equal(settings.reader.autoAnalyze, true);
  assert.equal(settings.general.hotkey, 'Alt+Shift+D');
  assert.equal(settings.general.minimizeToTray, true);
  assert.equal(settings.general.dailyGoalMinutes, 30);
  assert.equal(settings.ai.apiKey, undefined);
  assert.equal(settings.ai.apiKeyEnc, undefined);
});

test('settings: 深合并 patch，不影响其他字段', function (t) {
  const ctx = makeService(t, makeSecret());
  const saved = ctx.service.save({ reader: { theme: 'dark', fontSize: 23 } });
  assert.equal(saved.reader.theme, 'dark');
  assert.equal(saved.reader.fontSize, 23);
  assert.equal(saved.reader.lineHeight, 1.9);
  assert.equal(saved.general.dailyGoalMinutes, 30);

  const second = ctx.service.save({ general: { dailyGoalMinutes: 45 } });
  assert.equal(second.general.dailyGoalMinutes, 45);
  assert.equal(second.reader.theme, 'dark');

  const fromDisk = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'settings.json'), 'utf8'));
  assert.equal(fromDisk.reader.theme, 'dark');
  assert.equal(fromDisk.general.dailyGoalMinutes, 45);
});

test('settings: API Key 加密存储与脱敏', function (t) {
  const ctx = makeService(t, makeSecret());
  const plain = 'sk-test-secret-1234567890';
  const saved = ctx.service.save({ ai: { apiKey: plain } });
  assert.equal(saved.ai.hasApiKey, true);
  assert.ok(saved.ai.keyHint.indexOf('1234') !== -1 || saved.ai.keyHint.indexOf('7890') !== -1);
  assert.ok(saved.ai.keyHint.indexOf(plain) === -1);
  assert.equal(saved.ai.apiKey, undefined);

  const raw = ctx.service.getRaw();
  assert.equal(raw.ai.apiKey, plain);

  const onDisk = fs.readFileSync(path.join(ctx.dataDir, 'settings.json'), 'utf8');
  assert.equal(onDisk.indexOf(plain), -1, '磁盘上不能出现明文 Key');
  assert.ok(onDisk.indexOf('apiKeyEnc') !== -1);
  assert.ok(onDisk.indexOf('"apiKey"') === -1);
});

test('settings: 空 apiKey 不覆盖，clearApiKey 才清除', function (t) {
  const ctx = makeService(t, makeSecret());
  ctx.service.save({ ai: { apiKey: 'sk-first-key-abcdef' } });
  const afterEmpty = ctx.service.save({ ai: { apiKey: '' } });
  assert.equal(afterEmpty.ai.hasApiKey, true);
  assert.equal(ctx.service.getRaw().ai.apiKey, 'sk-first-key-abcdef');

  const cleared = ctx.service.save({ ai: { clearApiKey: true } });
  assert.equal(cleared.ai.hasApiKey, false);
  assert.equal(ctx.service.getRaw().ai.apiKey, '');
});

test('settings: 非法值归一化', function (t) {
  const ctx = makeService(t, makeSecret());
  const saved = ctx.service.save({
    reader: { fontSize: 999, lineHeight: 9, theme: 'neon', contentWidth: 100, letterSpacing: -9, fontFamily: 'mono' },
    general: { dailyGoalMinutes: 0 },
    ai: { temperature: 9 },
    translation: { provider: 'unknown' },
  });
  assert.equal(saved.reader.fontSize, 40);
  assert.equal(saved.reader.lineHeight, 2.8);
  assert.equal(saved.reader.theme, 'paper');
  assert.equal(saved.reader.contentWidth, 520);
  assert.equal(saved.reader.letterSpacing, -1);
  assert.equal(saved.reader.fontFamily, 'serif');
  assert.equal(saved.general.dailyGoalMinutes, 1);
  assert.equal(saved.ai.temperature, 2);
  assert.equal(saved.translation.provider, 'auto');
});

test('settings: 无 secret 时使用本地混淆且可还原', function (t) {
  const ctx = makeService(t, null);
  const plain = 'sk-local-fallback-key';
  ctx.service.save({ ai: { apiKey: plain } });
  assert.equal(ctx.service.get().ai.hasApiKey, true);
  assert.equal(ctx.service.getRaw().ai.apiKey, plain);
  const onDisk = fs.readFileSync(path.join(ctx.dataDir, 'settings.json'), 'utf8');
  assert.equal(onDisk.indexOf(plain), -1);
});

test('settings: 兼容主进程 safeStorage 风格（带 enc: 前缀的完整值）codec', function (t) {
  const encryptPrefix = 'enc:';
  const codec = {
    // 与 main.js createSecretCodec 一致：返回值带 enc: 前缀，解密器也接收完整前缀值
    encrypt: function (plain) { return encryptPrefix + Buffer.from(plain, 'utf8').toString('base64'); },
    decrypt: function (value) {
      const text = String(value || '');
      if (text.indexOf(encryptPrefix) === 0) return Buffer.from(text.slice(encryptPrefix.length), 'base64').toString('utf8');
      return text;
    },
  };
  const ctx = makeService(t, codec);
  const plain = 'sk-safestorage-style-key';
  ctx.service.save({ ai: { apiKey: plain } });
  assert.equal(ctx.service.get().ai.hasApiKey, true);
  assert.equal(ctx.service.getRaw().ai.apiKey, plain);
  const onDisk = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'settings.json'), 'utf8'));
  assert.ok(onDisk.ai.apiKeyEnc.indexOf('enc:') === 0);
  assert.equal(onDisk.ai.apiKeyEnc.indexOf('enc:enc:'), -1, '不应出现双前缀');
  // 再次保存未改动 Key 时仍能正确解密
  ctx.service.save({ reader: { fontSize: 21 } });
  assert.equal(ctx.service.getRaw().ai.apiKey, plain);
});

test('settings: 损坏的 settings.json 自动恢复默认值', function (t) {
  const ctx = makeService(t, makeSecret());
  fs.writeFileSync(path.join(ctx.dataDir, 'settings.json'), '{ broken json', 'utf8');
  const settings = ctx.service.get();
  assert.equal(settings.reader.fontSize, 19);
  const files = fs.readdirSync(ctx.dataDir);
  assert.ok(files.some(function (name) { return name.indexOf('settings.json.corrupt-') === 0; }));
});
