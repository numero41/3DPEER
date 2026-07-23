// Geo mode: 3DPEER container -> quantized GPU buffers as-is.
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { unenvelope } from './decode.js';
import { parseHeader, HEADER_SIZE } from '../codec/container.js';
import { createStage, showError } from './scene.js';
import { initViewerControls } from './controls.js';

async function boot() {
  // Scripts are running: replace the static "your app blocks scripts" fallback.
  document.getElementById('hint').textContent = 'loading…';

  const c = await unenvelope(window.__P);
  const h = parseHeader(c);
  await MeshoptDecoder.ready;
  let p = HEADER_SIZE;
  const dPos = new Uint8Array(h.unique * 8), dNrm = new Uint8Array(h.unique * 4),
        dCol = new Uint8Array(h.unique * 4), dIdx = new Uint8Array(h.indexCount * 4);
  MeshoptDecoder.decodeGltfBuffer(dPos, h.unique, 8, c.subarray(p, p += h.lens[0]), 'ATTRIBUTES');
  MeshoptDecoder.decodeGltfBuffer(dNrm, h.unique, 4, c.subarray(p, p += h.lens[1]), 'ATTRIBUTES');
  MeshoptDecoder.decodeGltfBuffer(dCol, h.unique, 4, c.subarray(p, p += h.lens[2]), 'ATTRIBUTES');
  MeshoptDecoder.decodeGltfBuffer(dIdx, h.indexCount, 4, c.subarray(p, p += h.lens[3]), 'TRIANGLES');

  const g = new THREE.BufferGeometry();
  g.setAttribute('position',
    new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(new Uint16Array(dPos.buffer), 4), 3, 0, false));
  g.setAttribute('normal',
    new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(new Int8Array(dNrm.buffer), 4), 3, 0, true));
  g.setAttribute('color',
    new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(new Uint8Array(dCol.buffer), 4), 4, 0, true));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(dIdx.buffer), 1));
  g.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    color: new THREE.Color(h.baseColor[0], h.baseColor[1], h.baseColor[2]),
    metalness: h.metal, roughness: h.rough,
  });
  const mesh = new THREE.Mesh(g, mat);
  const Q = (1 << h.bits) - 1;
  mesh.scale.set(h.sz[0] / Q, h.sz[1] / Q, h.sz[2] / Q);
  mesh.position.set(h.mn[0], h.mn[1], h.mn[2]);

  const stage = createStage();
  stage.scene.add(mesh);
  stage.frameObject(mesh);
  if (window.__CFG && window.__CFG.ui) initViewerControls(stage, mesh);
  stage.run();
}
boot().catch(showError);
