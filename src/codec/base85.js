// base85, alphabet sûr pour un littéral JS "..." : ni ", ni \, ni <
// (la séquence </script est impossible par construction)
export const A85 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&;|()[]{}@%$#';

export function b85encode(u8) {
  const out = new Array(u8.length / 4 * 5);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  for (let i = 0, j = 0; i < u8.length; i += 4, j += 5) {
    let v = dv.getUint32(i, false);
    for (let k = 4; k >= 0; k--) { out[j + k] = A85[v % 85]; v = Math.floor(v / 85); }
  }
  return out.join('');
}

export function b85decode(s) {
  const T = {}; for (let i = 0; i < 85; i++) T[A85[i]] = i;
  const u8 = new Uint8Array(s.length / 5 * 4);
  for (let i = 0, j = 0; i < s.length; i += 5, j += 4) {
    const v = (((T[s[i]] * 85 + T[s[i + 1]]) * 85 + T[s[i + 2]]) * 85 + T[s[i + 3]]) * 85 + T[s[i + 4]];
    u8[j] = (v >>> 24) & 255; u8[j + 1] = (v >>> 16) & 255; u8[j + 2] = (v >>> 8) & 255; u8[j + 3] = v & 255;
  }
  return u8;
}
