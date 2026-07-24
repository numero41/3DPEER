#!/usr/bin/env node
// =============================================================================
// spike-lod.mjs — Phase 1.5 measured baseline (manual tool, NOT part of
// npm test: it runs for minutes and writes multi-MB artifacts).
//
// Generates the reference heightfield procedurally (1200×1200 vertices,
// 2,875,202 triangles, height-gradient vertex colors, finite-difference
// normals — never a binary fixture, invariant #9), simplifies it with
// MeshoptSimplifier 0.20 at the agreed ratios (every level from the
// ORIGINAL mesh), then packs each level as its own artifact through the
// REAL pack() path into a temp directory and prints the measured table
// against the recorded baseline. Triangle counts and artifact sizes must
// land within TOLERANCE of the baseline or the process exits non-zero.
// This file is the numbered ground truth behind the Phase 1.5 "done when"
// gates (full ladder ≤ 12.5 MB, review preset ≤ 1.6 MB in one file).
//
//   node scripts/spike-lod.mjs [--grid 1200] [--keep]
//
//   --grid N   vertices per side (default 1200; lower for a quick dry run,
//              baseline gates only apply at 1200)
//   --keep     keep the temp directory (prints its path) instead of
//              deleting it — handy to open the artifacts in a browser
// =============================================================================

import fs from 'fs';
import os from 'os';
import path from 'path';
import { Document, NodeIO } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';
import { pack } from '../src/pack/index.js';

// -----------------------------------------------------------------------------
// Recorded baseline (David, 2026-07-24) — grid 1200, pack defaults (12-bit)
// -----------------------------------------------------------------------------

/** Simplification ratios of the ladder, finest first. */
const RATIOS = [1, 0.25, 0.06, 0.015];

/** Measured reference: per-level single artifacts at the default settings. */
const BASELINE = [
  { ratio: 1, tris: 2875202, mb: 8.17, err: 0 },
  { ratio: 0.25, tris: 718793, mb: 3.79, err: 0.0004 },
  { ratio: 0.06, tris: 172509, mb: 1.38, err: 0.0011 },
  { ratio: 0.015, tris: 43128, mb: 0.75, err: 0.0029 },
];

/** Acceptance tolerance on triangle counts and artifact sizes. */
const TOLERANCE = 0.10;

// -----------------------------------------------------------------------------
// Procedural heightfield
// -----------------------------------------------------------------------------

/**
 * Closed-form terrain height: four sine/cosine octaves, deterministic.
 * @param {number} x world x
 * @param {number} z world z
 * @returns {number} height
 */
function height(x, z) {
  return 1.165 * Math.sin(x * 2.1) * Math.cos(z * 1.7)
       + 0.600 * Math.sin(x * 5.3 + 1.3) * Math.sin(z * 4.9 + 0.7)
       + 0.233 * Math.sin(x * 13.7 + 2.1) * Math.cos(z * 11.3 + 1.1)
       + 0.083 * Math.sin(x * 29.0 + 0.5) * Math.sin(z * 31.0 + 1.9)
       + 0.012 * Math.sin(x * 247.0 + 0.9) * Math.sin(z * 239.0 + 1.4)
       + 0.006 * Math.sin(x * 487.0 + 0.3) * Math.cos(z * 503.0 + 2.2);
}

/**
 * Builds the heightfield arrays: positions, finite-difference normals,
 * height-gradient vertex colors and grid indices.
 * @param {number} n vertices per side
 * @returns {{pos: Float32Array, nrm: Float32Array, col: Uint8Array,
 *            idx: Uint32Array}}
 */
function makeHeightfield(n) {
  const EXTENT = 10;
  const step = EXTENT / (n - 1);
  const pos = new Float32Array(n * n * 3);
  const nrm = new Float32Array(n * n * 3);
  const col = new Uint8Array(n * n * 3);
  const heights = new Float32Array(n * n);

  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) heights[j * n + i] = height(i * step, j * step);

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = j * n + i;
      const y = heights[v];
      pos[v * 3] = i * step;
      pos[v * 3 + 1] = y;
      pos[v * 3 + 2] = j * step;

      // central differences, one-sided at the borders
      const xa = heights[j * n + Math.max(0, i - 1)];
      const xb = heights[j * n + Math.min(n - 1, i + 1)];
      const za = heights[Math.max(0, j - 1) * n + i];
      const zb = heights[Math.min(n - 1, j + 1) * n + i];
      const dx = (xb - xa) / (step * (Math.min(n - 1, i + 1) - Math.max(0, i - 1)));
      const dz = (zb - za) / (step * (Math.min(n - 1, j + 1) - Math.max(0, j - 1)));
      const len = Math.hypot(dx, 1, dz);
      nrm[v * 3] = -dx / len;
      nrm[v * 3 + 1] = 1 / len;
      nrm[v * 3 + 2] = -dz / len;

      // plain height gradient (deep amber -> pale sand)
      const t = Math.min(1, Math.max(0, (y + 2.1) / 4.2));
      col[v * 3] = Math.round(60 + 180 * t);
      col[v * 3 + 1] = Math.round(50 + 140 * t);
      col[v * 3 + 2] = Math.round(40 + 90 * t);
    }
  }

  const quads = (n - 1) * (n - 1);
  const idx = new Uint32Array(quads * 6);
  let w = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx[w++] = a; idx[w++] = c; idx[w++] = b;
      idx[w++] = b; idx[w++] = c; idx[w++] = d;
    }
  }
  return { pos, nrm, col, idx };
}

/**
 * Wraps arrays into a one-primitive glTF Document ready for pack().
 * @param {Float32Array} pos positions
 * @param {Float32Array} nrm normals
 * @param {Uint8Array} col vertex colors (u8 normalized)
 * @param {Uint32Array} idx triangle indices
 * @returns {Document}
 */
function buildDoc(pos, nrm, col, idx) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const prim = doc.createPrimitive()
    .setAttribute('POSITION',
      doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
    .setAttribute('NORMAL',
      doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buffer))
    .setAttribute('COLOR_0',
      doc.createAccessor().setType('VEC3').setArray(col).setNormalized(true).setBuffer(buffer))
    .setIndices(
      doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer));
  const mesh = doc.createMesh().addPrimitive(prim);
  doc.createScene().addChild(doc.createNode('heightfield').setMesh(mesh));
  return doc;
}

// -----------------------------------------------------------------------------
// Ladder run
// -----------------------------------------------------------------------------

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const GRID = opt('grid') ? parseInt(opt('grid'), 10) : 1200;
const KEEP = args.includes('--keep');
const gated = GRID === 1200;

const t0 = Date.now();
console.log(`=== spike-lod: ${GRID}×${GRID} heightfield ===`);
const { pos, nrm, col, idx } = makeHeightfield(GRID);
console.log(`generated: ${pos.length / 3} vertices, ${idx.length / 3} triangles — ${Date.now() - t0} ms`);

await MeshoptSimplifier.ready;
const scale = MeshoptSimplifier.getScale(pos, 3);
console.log(`simplifier scale (extent): ${scale.toFixed(3)}`);

/** One row per level: simplify (from the original), then pack. */
const rows = [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), '3dpeer-spike-'));
const io = new NodeIO();

for (const ratio of RATIOS) {
  const tSimp = Date.now();
  let levelIdx = idx, errRel = 0;
  if (ratio < 1) {
    const target = Math.floor(idx.length * ratio / 3) * 3;
    [levelIdx, errRel] = MeshoptSimplifier.simplify(idx, pos, 3, target, 1.0);
  }
  const simpMs = Date.now() - tSimp;

  const glb = path.join(tmp, `level-${ratio}.glb`);
  const html = path.join(tmp, `level-${ratio}.html`);
  await io.write(glb, buildDoc(pos, nrm, col, levelIdx));
  console.log(`--- ratio ${ratio}: ${levelIdx.length / 3} tris (simplify ${simpMs} ms, err ${errRel.toFixed(5)})`);
  const tPack = Date.now();
  await pack(glb, html, { title: `spike ${ratio}` });
  rows.push({
    ratio,
    tris: levelIdx.length / 3,
    errRel,
    errAbs: errRel * scale,
    mb: fs.statSync(html).size / 1e6,
    packMs: Date.now() - tPack,
  });
}

// -----------------------------------------------------------------------------
// Report against the baseline
// -----------------------------------------------------------------------------

console.log('\n=== measured table (per-level single artifacts) ===');
console.log('ratio    tris        err(rel)  err(abs)  HTML MB   pack ms   baseline   verdict');
let failed = false;
for (const row of rows) {
  const ref = BASELINE.find((b) => b.ratio === row.ratio);
  let verdict = 'n/a';
  if (ref && gated) {
    const trisOk = Math.abs(row.tris - ref.tris) <= ref.tris * TOLERANCE;
    const mbOk = Math.abs(row.mb - ref.mb) <= ref.mb * TOLERANCE;
    verdict = trisOk && mbOk ? 'PASS' : 'FAIL';
    if (verdict === 'FAIL') failed = true;
  }
  console.log(
    String(row.ratio).padEnd(8)
    + String(row.tris).padEnd(12)
    + row.errRel.toFixed(5).padEnd(10)
    + row.errAbs.toFixed(4).padEnd(10)
    + row.mb.toFixed(2).padEnd(10)
    + String(row.packMs).padEnd(10)
    + (ref ? `${ref.tris} / ${ref.mb} MB` : '—').padEnd(21)
    + verdict);
}
console.log(`total wall time: ${((Date.now() - t0) / 1000).toFixed(1)} s`);

if (KEEP) console.log(`artifacts kept in: ${tmp}`);
else fs.rmSync(tmp, { recursive: true, force: true });

if (failed) {
  console.error(`spike-lod: outside the ${TOLERANCE * 100}% baseline tolerance`);
  process.exit(1);
}
console.log(gated ? 'spike-lod: baseline reproduced within tolerance' : 'spike-lod: dry run (no gates below grid 1200)');
