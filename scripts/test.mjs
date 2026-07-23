#!/usr/bin/env node
// Régression sans fixtures binaires : génère un petit GLB procédural
// (cube 24 sommets, couleurs) et le packe en mode geo ; puis lui ajoute
// un morph target pour déclencher le mode gltf.
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
  console.log('---', withMorph ? 'fixture morph (mode gltf attendu)' : 'fixture geo');
  await pack(glb, glb.replace('.glb', '.html'), { title: 'test' });
}
console.log('=== régression synthétique OK ===');
