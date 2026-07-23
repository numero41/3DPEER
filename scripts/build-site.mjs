#!/usr/bin/env node
// Construit le site : bundle du workbench + assets d'export
// (template + viewers pré-bundlés que l'app va chercher au moment d'exporter).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const R = (...p) => path.join(__dir, '..', ...p);

fs.mkdirSync(R('site', 'assets'), { recursive: true });

esbuild.buildSync({
  entryPoints: [R('src', 'app', 'main.js')],
  bundle: true, format: 'iife', outfile: R('site', 'app.js'),
});
for (const entry of ['boot-geo.js', 'boot-gltf.js']) {
  esbuild.buildSync({
    entryPoints: [R('src', 'viewer', entry)],
    bundle: true, minify: true, format: 'iife',
    outfile: R('site', 'assets', 'viewer-' + entry.replace('boot-', '').replace('.js', '') + '.js'),
  });
}
for (const f of ['page.html', 'page.css'])
  fs.copyFileSync(R('src', 'template', f), R('site', 'assets', f));

console.log('site construit dans site/ :',
  fs.readdirSync(R('site')).join(', '), '| assets :',
  fs.readdirSync(R('site', 'assets')).join(', '));
