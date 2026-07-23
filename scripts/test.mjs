#!/usr/bin/env node
// Regression without binary fixtures: generates a small procedural GLB
// (24-vertex cube, colors) and packs it in geo mode; then adds a
// morph target to it to trigger gltf mode.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Document, NodeIO } from '@gltf-transform/core';
import { pack } from '../src/pack/index.js';

function makeCubeDoc(withMorph) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const P = [], N = [], C = [], I = [];
  const faces = [[0,0,1],[0,0,-1],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0]];
  faces.forEach((n, f) => {
    const U = [n[1], n[2], n[0]], V = [n[2], n[0], n[1]];
    [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(([a,b]) => {
      P.push(n[0]+a*U[0]+b*V[0], n[1]+a*U[1]+b*V[1], n[2]+a*U[2]+b*V[2]);
      N.push(...n); C.push((f+1)/6, 0.4, 0.6, 1);
    });
    const o = f*4; I.push(o,o+2,o+1, o,o+3,o+2);
  });
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(P)).setBuffer(buffer))
    .setAttribute('NORMAL',   doc.createAccessor().setType('VEC3').setArray(new Float32Array(N)).setBuffer(buffer))
    .setAttribute('COLOR_0',  doc.createAccessor().setType('VEC4').setArray(new Float32Array(C)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(I)).setBuffer(buffer));
  if (withMorph) {
    const D = new Float32Array(P.length);
    for (let i = 1; i < D.length; i += 3) D[i] = 0.5;
    const target = doc.createPrimitiveTarget()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(D).setBuffer(buffer));
    prim.addTarget(target);
  }
  const mesh = doc.createMesh().addPrimitive(prim);
  const node = doc.createNode('cube').setMesh(mesh);
  doc.createScene().addChild(node);
  return doc;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), '3dpeer-'));
const io = new NodeIO();
for (const withMorph of [false, true]) {
  const glb = path.join(tmp, withMorph ? 'm.glb' : 'g.glb');
  await io.write(glb, makeCubeDoc(withMorph));
  console.log('---', withMorph ? 'morph fixture (gltf mode expected)' : 'geo fixture');
  await pack(glb, glb.replace('.glb', '.html'), { title: 'test' });
}

// --- in-browser compression pipeline, smoke-tested through NodeIO -----------
// (The texture stage is canvas-based and auto-skips outside the browser; this
// exercises dedup/prune/simplify/resample/quantize/meshopt on real transforms.)
console.log('--- compression pipeline (NodeIO)');
const { compressGLB, DEFAULT_SETTINGS } = await import('../src/app/compress.js');
const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
const { MeshoptDecoder, MeshoptEncoder } = await import('meshoptimizer');
const pipeIO = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const srcBytes = fs.readFileSync(path.join(tmp, 'm.glb'));
const outBytes = await compressGLB(new Uint8Array(srcBytes), { ...DEFAULT_SETTINGS, decimate: 20 }, () => {}, pipeIO);
const reread = await pipeIO.readBinary(outBytes);
const meshCount = reread.getRoot().listMeshes().length;
if (!meshCount) throw new Error('compression pipeline: output has no meshes');
console.log(`compression pipeline: OK — ${srcBytes.length} -> ${outBytes.length} bytes, meshes:${meshCount}`);

console.log('=== synthetic regression OK ===');
