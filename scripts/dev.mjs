#!/usr/bin/env node
// Minimal static server for site/ (export uses fetch -> no file://).
// Also serves /test/* from the repo's test/ folder (local trial models,
// gitignored) and disables caching so a rebuilt bundle is always the one
// the browser runs.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const PORT = Number(process.env.PORT) || 8137;
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = path.join(repo, 'site');
const testRoot = path.join(repo, 'test');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.usdz': 'model/vnd.usdz+zip', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const inTest = url.startsWith('/test/');
  const root = inTest ? testRoot : siteRoot;
  const rel = inTest ? url.slice('/test/'.length) : (url === '/' ? 'index.html' : url);
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('404');
    return;
  }
  res.writeHead(200, {
    'Content-Type': types[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`3dpeer dev → http://localhost:${PORT} (test files under /test/)`));
