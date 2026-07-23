#!/usr/bin/env node
// Thin CLI: node scripts/pack.mjs input.glb output.html
//           [--bits 12] [--title "..."] [--texsize 2048]
import { pack } from '../src/pack/index.js';

const args = process.argv.slice(2);
const files = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
if (files.length < 2) {
  console.error('usage: node scripts/pack.mjs input.glb output.html [--bits 12] [--title "..."] [--texsize 2048]');
  process.exit(1);
}
const opt = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
await pack(files[0], files[1], {
  bits: opt('bits') ? parseInt(opt('bits'), 10) : undefined,
  texSize: opt('texsize') ? parseInt(opt('texsize'), 10) : undefined,
  title: opt('title'),
});
