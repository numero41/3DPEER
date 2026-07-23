#!/usr/bin/env node
// Minimal static server for site/ (export uses fetch -> no file://)
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(8137, () => console.log('3dpeer dev → http://localhost:8137'));
