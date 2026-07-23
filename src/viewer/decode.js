import { b85decode } from '../codec/base85.js';

export async function unenvelope(payloadStr) {
  const framed = b85decode(payloadStr);
  const gzLen = new DataView(framed.buffer).getUint32(0, true);
  const resp = new Response(
    new Blob([framed.subarray(4, 4 + gzLen)]).stream().pipeThrough(new DecompressionStream('gzip'))
  );
  return new Uint8Array(await resp.arrayBuffer());
}
