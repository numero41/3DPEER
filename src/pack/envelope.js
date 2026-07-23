import zlib from 'zlib';
import { b85encode, b85decode } from '../codec/base85.js';

export function envelope(bytes) {
  const gz = zlib.gzipSync(bytes, { level: 9 });
  const framed = new Uint8Array(4 + gz.length + (4 - (4 + gz.length) % 4) % 4);
  new DataView(framed.buffer).setUint32(0, gz.length, true);
  framed.set(gz, 4);
  const payload = b85encode(framed);
  if (payload.includes('</script') || payload.includes('"') || payload.includes('\\'))
    throw new Error('payload non sûr pour un littéral JS');
  return payload;
}

export function unenvelope(payloadStr) {
  const f = b85decode(payloadStr);
  const gzLen = new DataView(f.buffer).getUint32(0, true);
  return zlib.gunzipSync(Buffer.from(f.subarray(4, 4 + gzLen)));
}

export function extractPayload(html) {
  const m = html.match(/__P=\n"([^"]+)"/);
  if (!m) throw new Error('payload introuvable dans le HTML');
  return m[1];
}
