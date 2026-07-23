import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const TPL = path.join(__dir, '..', 'template');

// Substitution via split/join: the base85 payload contains $ and other
// characters special to String.replace — NEVER use .replace here.
function put(s, key, val) { return s.split('{{' + key + '}}').join(val); }

export function assemble({ output, title, caption, payload, viewerEntry, ui }) {
  const bundle = esbuild.buildSync({
    entryPoints: [path.join(__dir, '..', 'viewer', viewerEntry)],
    bundle: true, minify: true, format: 'iife', write: false,
  }).outputFiles[0].text.replace(/<\/script/g, '<\\/script');

  let html = fs.readFileSync(path.join(TPL, 'page.html'), 'utf-8');
  html = put(html, 'CSS', fs.readFileSync(path.join(TPL, 'page.css'), 'utf-8'));
  html = put(html, 'TITLE', title);
  html = put(html, 'CAPTION', caption);
  // Viewer feature flags injected as window.__CFG. Controls ship by default;
  // pass ui:false to produce a bare orbit-only artifact.
  html = put(html, 'CONFIG', JSON.stringify({ ui: ui !== false }));
  html = put(html, 'PAYLOAD', payload);
  html = put(html, 'BUNDLE', bundle);
  fs.writeFileSync(output, html);
}
