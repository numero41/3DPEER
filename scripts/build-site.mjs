#!/usr/bin/env node
// Builds the site: workbench bundle + export assets
// (template + pre-bundled viewers that the app fetches at export time).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const R = (...p) => path.join(__dir, '..', ...p);

fs.mkdirSync(R('site', 'assets'), { recursive: true });

esbuild.buildSync({
  entryPoints: [R('src', 'app', 'main.js')],
  bundle: true, minify: true, format: 'iife', outfile: R('site', 'app.js'),
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

console.log('site built in site/ :',
  fs.readdirSync(R('site')).join(', '), '| assets :',
  fs.readdirSync(R('site', 'assets')).join(', '));
