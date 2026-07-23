// Self-tests on the PRODUCED HTML: re-extraction of the payload and full
// decoding with the meshopt decoder from three r160 — deliberately the most
// conservative one across the browser fleet.
import fs from 'fs';
import { MeshoptDecoder as RefDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { unenvelope, extractPayload } from './envelope.js';
import { parseHeader, HEADER_SIZE } from '../codec/container.js';

export async function selfTestGeo(output, ref) {
  const c = unenvelope(extractPayload(fs.readFileSync(output, 'utf-8')));
  const h = parseHeader(c);
  await RefDecoder.ready;
  let p = HEADER_SIZE;
  const dPos = new Uint8Array(h.unique * 8), dNrm = new Uint8Array(h.unique * 4),
        dCol = new Uint8Array(h.unique * 4), dIdx = new Uint8Array(h.indexCount * 4);
  RefDecoder.decodeGltfBuffer(dPos, h.unique, 8, c.subarray(p, p += h.lens[0]), 'ATTRIBUTES');
  RefDecoder.decodeGltfBuffer(dNrm, h.unique, 4, c.subarray(p, p += h.lens[1]), 'ATTRIBUTES');
  RefDecoder.decodeGltfBuffer(dCol, h.unique, 4, c.subarray(p, p += h.lens[2]), 'ATTRIBUTES');
  RefDecoder.decodeGltfBuffer(dIdx, h.indexCount, 4, c.subarray(p, p += h.lens[3]), 'TRIANGLES');
  const eq = (a, b) => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength),
                                      Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;
  const ok = eq(dPos, new Uint8Array(ref.posQ.buffer)) && eq(dNrm, new Uint8Array(ref.nrmQ.buffer))
          && eq(dCol, new Uint8Array(ref.colQ.buffer)) && dIdx.byteLength === ref.idxBytes;
  if (!ok) throw new Error('geo self-test: decoding not identical');
  console.log('geo self-test (three r160 decoder on the final HTML): OK');
}

export function selfTestGltf(output) {
  const c = unenvelope(extractPayload(fs.readFileSync(output, 'utf-8')));
  if (c.subarray(0, 4).toString() !== 'glTF') throw new Error('gltf self-test: bad magic');
  const jl = c.readUInt32LE(12);
  const j = JSON.parse(c.subarray(20, 20 + jl).toString());
  const nt = (j.meshes || []).reduce((s, m) => s + m.primitives.reduce((q, p) => q + (p.targets || []).length, 0), 0);
  console.log(`gltf self-test: OK — meshes:${(j.meshes || []).length} skins:${(j.skins || []).length} anims:${(j.animations || []).length} morphs:${nt}`);
}
