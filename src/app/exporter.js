// =============================================================================
// exporter.js
//
// Turns the loaded model into one self-contained .html file.
//
// Pipeline: gzip (native CompressionStream) -> length-framed buffer -> base85
// -> substitute into the artifact template. The base85 pass is the slow part
// for large models, so it runs in yielding chunks to keep the progress bar (with
// ETA) live and avoid freezing the tab. The source GLB is embedded as-is; the
// only size reduction at this stage is gzip.
//
// The template, stylesheet and viewer are inlined at build time (window.__EXPORT)
// and loaded via a <script> tag, so export performs no network request and works
// over file://.
// =============================================================================

import { b85encode } from '../codec/base85.js';
import { state } from './state.js';
import { $ } from './dom.js';
import { setStatus, progress } from './ui.js';

/** gzip a byte array using the browser's native CompressionStream. */
async function gzipBytes(u8) {
  const resp = new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip')));
  return new Uint8Array(await resp.arrayBuffer());
}

// Placeholder substitution uses split/join, never String.replace: the base85
// payload contains `$`, which replace() would mangle via $&/$$ (invariant #4).
function put(s, key, val) {
  return s.split('{{' + key + '}}').join(val);
}

// Yield to the event loop so the progress bar can paint between chunks.
// setTimeout (not requestAnimationFrame): rAF is paused while the tab is
// backgrounded, which would hang a long export if the user switches away.
const nextFrame = () => new Promise((r) => setTimeout(r, 0));

/**
 * base85-encode a framed buffer in chunks, reporting progress.
 * b85encode processes independent 4-byte groups, so slicing on 4-byte
 * boundaries and concatenating is byte-for-byte identical to encoding at once.
 * @param {Uint8Array} framed length is a multiple of 4
 * @param {(fraction:number)=>void} onProgress fraction of the encode done
 */
async function encodeWithProgress(framed, onProgress) {
  const CHUNK = 1 << 20; // 1 MiB (already a multiple of 4)
  if (framed.length <= CHUNK) return b85encode(framed);
  let out = '';
  for (let off = 0; off < framed.length; off += CHUNK) {
    const end = Math.min(off + CHUNK, framed.length);
    out += b85encode(framed.subarray(off, end));
    onProgress(end / framed.length);
    await nextFrame();
  }
  return out;
}

/** Wire the export button. */
export function initExport() {
  $('export').addEventListener('click', async () => {
    if (!state.glbBytes) return;
    const btn = $('export');
    btn.disabled = true;
    progress.start();
    try {
      progress.set(0.02, 'compressing');
      const gz = await gzipBytes(state.glbBytes);
      await nextFrame();

      // length-framed, padded to a 4-byte boundary for base85
      const framed = new Uint8Array(4 + gz.length + (4 - (4 + gz.length) % 4) % 4);
      new DataView(framed.buffer).setUint32(0, gz.length, true);
      framed.set(gz, 4);

      // base85 is 0.05..0.85 of the bar
      const payload = await encodeWithProgress(framed, (f) => progress.set(0.05 + f * 0.8, 'encoding'));

      progress.set(0.9, 'assembling');
      // Export assets are inlined at build time (window.__EXPORT) and loaded via
      // a <script> tag, so export never fetches — it works over file:// too.
      const { tpl, css, viewer } = window.__EXPORT;
      let html = put(tpl, 'CSS', css);
      html = put(html, 'TITLE', state.name);
      html = put(html, 'CAPTION', `${state.name} · self-contained file · 0 requests`);
      html = put(html, 'PAYLOAD', payload);
      html = put(html, 'BUNDLE', viewer);

      const blob = new Blob([html], { type: 'text/html' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = state.name + '.3dpeer.html';
      a.click();
      URL.revokeObjectURL(a.href);

      progress.set(1);
      setStatus(`exported: ${state.name}.3dpeer.html — ${(blob.size / 1e6).toFixed(2)} MB`);
      setTimeout(() => progress.hide(), 1500);
    } catch (e) {
      setStatus('export failed: ' + (e.message || e));
      progress.hide();
    } finally {
      btn.disabled = false;
    }
  });
}
