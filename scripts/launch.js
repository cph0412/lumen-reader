'use strict';

// Launch Electron with a clean environment. Some terminals export
// ELECTRON_RUN_AS_NODE=1 (for editor integrations); inheriting it makes the
// Electron binary behave like plain Node and breaks the app at startup.
const { spawn } = require('child_process');
const path = require('path');

const electronBinary = require('electron');
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;

const args = [path.join(__dirname, '..'), ...process.argv.slice(2)];
const child = spawn(electronBinary, args, {
  stdio: 'inherit',
  env,
  windowsHide: false
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code === null ? 1 : code);
});
