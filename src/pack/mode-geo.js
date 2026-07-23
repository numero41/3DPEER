// Mode geo : extraction de la primitive, quantisation, reorder, meshopt v0,
// conteneur 3DPEER. Retourne le conteneur + les flux quantisés (pour l'auto-test).
import { prune, join as joinFn, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { computeBbox, buildQuantizedStreams } from '../codec/quantize.js';
import { buildContainer } from '../codec/container.js';

export async function packGeo(doc, { bits }) {
  await doc.transform(prune({ keepAttributes: false }), joinFn(), weld());

  const meshes = doc.getRoot().listMeshes();
  const nPrims = meshes.reduce((s, m) => s + m.listPrimitives().length, 0);
  if (nPrims > 1) console.warn(`note : ${nPrims} primitives, seule la première est packée (mode geo)`);
  const prim = meshes[0].listPrimitives()[0];

  const posA = prim.getAttribute('POSITION');
  const nrmA = prim.getAttribute('NORMAL');
  const colA = prim.getAttribute('COLOR_0');
  const idxA = prim.getIndices();
  if (!posA || !idxA) throw new Error('POSITION et indices requis');
  if (!nrmA) throw new Error('mode geo : normales requises');

  const pos = posA.getArray();
  const nrm = nrmA.getArray();
  const idx = new Uint32Array(idxA.getArray());
  const count = posA.getCount(), indexCount = idx.length;

  const colU8 = new Uint8Array(count * 4).fill(255);
  if (colA) {
    const a = colA.getArray(), comp = colA.getElementSize();
    const isFloat = a instanceof Float32Array;
    const shift = a instanceof Uint16Array ? 8 : 0;
    for (let v = 0; v < count; v++)
      for (let k = 0; k < comp; k++) {
        const s = a[v * comp + k];
        colU8[v * 4 + k] = isFloat ? Math.min(255, Math.max(0, Math.round(s * 255))) : (s >> shift);
      }
  }

  const matG = prim.getMaterial();
  const baseColor = matG ? matG.getBaseColorFactor() : [1, 1, 1, 1];
  const metal = matG ? matG.getMetallicFactor() : 1;
  const rough = matG ? matG.getRoughnessFactor() : 1;

  const { mn, sz } = computeBbox(pos);
  await MeshoptEncoder.ready;
  const [remap, unique] = MeshoptEncoder.reorderMesh(idx, true, true);
  const { posQ, nrmQ, colQ } = buildQuantizedStreams({ pos, nrm, colU8, remap, count, unique, mn, sz, bits });

  const streams = [
    MeshoptEncoder.encodeVertexBuffer(new Uint8Array(posQ.buffer), unique, 8),
    MeshoptEncoder.encodeVertexBuffer(new Uint8Array(nrmQ.buffer), unique, 4),
    MeshoptEncoder.encodeVertexBuffer(new Uint8Array(colQ.buffer), unique, 4),
    MeshoptEncoder.encodeIndexBuffer(new Uint8Array(idx.buffer, idx.byteOffset, idx.byteLength), indexCount, 4),
  ];
  const container = buildContainer({ unique, indexCount, mn, sz, baseColor, metal, rough, bits, streams });
  return { container, ref: { posQ, nrmQ, colQ, idxBytes: idx.byteLength }, stats: { count, indexCount } };
}
