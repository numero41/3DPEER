export function computeBbox(pos) {
  const mn = [1e30, 1e30, 1e30], mx = [-1e30, -1e30, -1e30];
  for (let i = 0; i < pos.length; i += 3)
    for (let a = 0; a < 3; a++) { const v = pos[i + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
  return { mn, sz: [mx[0] - mn[0] || 1, mx[1] - mn[1] || 1, mx[2] - mn[2] || 1] };
}

// Fills the quantized streams by applying the reorderMesh remap.
// pos u16 stride 8 (xyz + pad) · nrm i8 stride 4 · col u8 RGBA stride 4
export function buildQuantizedStreams({ pos, nrm, colU8, remap, count, unique, mn, sz, bits }) {
  const Q = (1 << bits) - 1;
  const posQ = new Uint16Array(unique * 4);
  const nrmQ = new Int8Array(unique * 4);
  const colQ = new Uint8Array(unique * 4);
  for (let v = 0; v < count; v++) {
    const t = remap[v]; if (t === 0xFFFFFFFF) continue;
    for (let a = 0; a < 3; a++) {
      posQ[t * 4 + a] = Math.min(Q, Math.max(0, Math.round((pos[v * 3 + a] - mn[a]) / sz[a] * Q)));
      nrmQ[t * 4 + a] = Math.min(127, Math.max(-127, Math.round(nrm[v * 3 + a] * 127)));
    }
    for (let a = 0; a < 4; a++) colQ[t * 4 + a] = colU8[v * 4 + a];
  }
  return { posQ, nrmQ, colQ };
}
