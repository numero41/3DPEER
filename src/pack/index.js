// Orchestrator: read, mode detection, packing, assembly, self-test.
import fs from 'fs';
import path from 'path';
import { NodeIO } from '@gltf-transform/core';
import { envelope } from './envelope.js';
import { assemble } from './assemble.js';
import { packGeo } from './mode-geo.js';
import { optimizeGlb } from './mode-gltf.js';
import { selfTestGeo, selfTestGltf } from './selftest.js';

export async function pack(input, output, opts = {}) {
  const bits = Math.min(16, Math.max(8, opts.bits ?? 12));
  const texSize = opts.texSize ?? 2048;
  const title = opts.title ?? path.basename(input, path.extname(input));
  const t0 = Date.now();

  const io = new NodeIO();
  const doc = await io.read(input);
  const root = doc.getRoot();
  const hasTex = root.listTextures().length > 0;
  const hasAnim = root.listAnimations().length > 0;
  const hasSkin = root.listSkins().length > 0;
  const hasMorph = root.listMeshes().some((m) => m.listPrimitives().some((p) => p.listTargets().length > 0));
  const mode = (hasTex || hasAnim || hasSkin || hasMorph) ? 'gltf' : 'geo';
  console.log(`mode ${mode}` + (mode === 'gltf'
    ? ` (textures:${hasTex} anims:${hasAnim} skins:${hasSkin} morphs:${hasMorph})` : ''));

  if (mode === 'gltf') {
    const glb = optimizeGlb({ input, hasTex, texSize, tmpDir: path.dirname(path.resolve(output)) });
    const payload = envelope(glb);
    assemble({ output, title, payload, viewerEntry: 'boot-gltf.js',
      caption: `${title} · self-contained file · 0 requests` });
    selfTestGltf(output);
    report(input, output, t0, `optimized GLB: ${(glb.length / 1e6).toFixed(2)} MB`);
  } else {
    const { container, ref, stats } = await packGeo(doc, { bits });
    const payload = envelope(container);
    assemble({ output, title, payload, viewerEntry: 'boot-geo.js',
      caption: `${title} · ${(container.length / 1e6).toFixed(1)} MB decompressed · self-contained file · 0 requests` });
    await selfTestGeo(output, ref);
    report(input, output, t0,
      `${stats.count} vertices, ${stats.indexCount / 3} triangles | container: ${(container.length / 1e6).toFixed(2)} MB | ${bits}-bit quantization`);
  }
}

function report(input, output, t0, extra) {
  const so = fs.statSync(input).size, sf = fs.statSync(output).size;
  console.log(extra);
  console.log(`input: ${(so / 1e6).toFixed(2)} MB | output: ${(sf / 1e6).toFixed(2)} MB (÷${(so / sf).toFixed(1)}) — ${Date.now() - t0} ms`);
}
