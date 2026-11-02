'use strict';

const { protocol } = require('electron');
const fs = require('fs/promises');
const path = require('path');

const RENDERER_ROOT = path.join(__dirname, '..', 'renderer');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

function registerAppScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }
  ]);
}

function resolveRequestPath(rawUrl) {
  const url = new URL(rawUrl);
  let pathname = decodeURIComponent(url.pathname || '/');
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const target = path.normalize(path.join(RENDERER_ROOT, pathname));
  if (!target.startsWith(RENDERER_ROOT + path.sep) && target !== RENDERER_ROOT) return null;
  return target;
}

async function installAppProtocol() {
  await protocol.handle('app', async (request) => {
    const filePath = resolveRequestPath(request.url);
    if (!filePath) return new Response('Forbidden', { status: 403 });
    try {
      const body = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const headers = {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': 'no-cache'
      };
      if (ext === '.html') headers['content-security-policy'] = CSP;
      return new Response(body, { status: 200, headers });
    } catch (err) {
      return new Response('Not found', { status: 404 });
    }
  });
}

module.exports = { registerAppScheme, installAppProtocol, RENDERER_ROOT };
