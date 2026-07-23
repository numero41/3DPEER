// Conteneur 3DPEER v1 — source unique de vérité du layout.
// [0]  u32 BE magic  [4] u32 vertexCount  [8] u32 indexCount
// [12] f32×3 bboxMin [24] f32×3 bboxSize
// [36] f32×4 baseColor [52] f32 metallic [56] f32 roughness
// [60] u32 bits de quantisation
// [64] u32×4 longueurs des flux pos, nrm, col, idx
// [80] flux meshopt concaténés
export const MAGIC = 0x33445001;
export const HEADER_SIZE = 80;

export function buildContainer({ unique, indexCount, mn, sz, baseColor, metal, rough, bits, streams }) {
  const total = HEADER_SIZE + streams.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, false);
  dv.setUint32(4, unique, true);
  dv.setUint32(8, indexCount, true);
  for (let a = 0; a < 3; a++) { dv.setFloat32(12 + a * 4, mn[a], true); dv.setFloat32(24 + a * 4, sz[a], true); }
  for (let a = 0; a < 4; a++) dv.setFloat32(36 + a * 4, baseColor[a], true);
  dv.setFloat32(52, metal, true);
  dv.setFloat32(56, rough, true);
  dv.setUint32(60, bits, true);
  let p = HEADER_SIZE;
  streams.forEach((b, i) => { dv.setUint32(64 + i * 4, b.length, true); out.set(b, p); p += b.length; });
  return out;
}

export function parseHeader(u8) {
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (v.getUint32(0, false) !== MAGIC) throw new Error('conteneur 3dpeer invalide');
  return {
    unique: v.getUint32(4, true),
    indexCount: v.getUint32(8, true),
    mn: [v.getFloat32(12, true), v.getFloat32(16, true), v.getFloat32(20, true)],
    sz: [v.getFloat32(24, true), v.getFloat32(28, true), v.getFloat32(32, true)],
    baseColor: [v.getFloat32(36, true), v.getFloat32(40, true), v.getFloat32(44, true), v.getFloat32(48, true)],
    metal: v.getFloat32(52, true),
    rough: v.getFloat32(56, true),
    bits: v.getUint32(60, true),
    lens: [v.getUint32(64, true), v.getUint32(68, true), v.getUint32(72, true), v.getUint32(76, true)],
  };
}
