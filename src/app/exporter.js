// =============================================================================
// exporter.js
//
// Turns the loaded model into one self-contained .html file, then either
// downloads it (export button) or hands it to the system share sheet (share
// button, Web Share API).
//
// Pipeline: gzip (native CompressionStream) -> length-framed buffer -> base85
// -> substitute into the artifact template. The base85 pass is the slow part
// for large models, so it runs in yielding chunks to keep the progress bar
// (with ETA) live and avoid freezing the tab.
//
// The template, stylesheet and viewer are inlined at build time
// (window.__EXPORT) and loaded via a <script> tag, so building performs no
// network request and works over file://.
//
// The built artifact is cached per (model, options): sharing needs a user
// gesture that expires while a large build runs, so the first share press may
// only build + prime the cache, and the second press shares instantly.
// =============================================================================

import { b85encode } from '../codec/base85.js';
import { state } from './state.js';
import { $ } from './dom.js';
import { setStatus, progress } from './ui.js';

// -----------------------------------------------------------------------------
// Build helpers
// -----------------------------------------------------------------------------

/**
 * gzip a byte array with the browser's native CompressionStream.
 * @param {Uint8Array} u8
 * @returns {Promise<Uint8Array>}
 */
async function gzipBytes(u8) {
  const resp = new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip')));
  return new Uint8Array(await resp.arrayBuffer());
}

// Placeholder substitution uses split/join, never String.replace: the base85
// payload contains `$`, which replace() would mangle via $&/$$ (invariant #4).
function put(s, key, val) {
  return s.split('{{' + key + '}}').join(val);
}

// Yield to the event loop between chunks so the progress bar can paint.
// setTimeout (not requestAnimationFrame): rAF is paused while the tab is
// backgrounded, which would hang a long build if the user switches away.
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * base85-encode a framed buffer in chunks, reporting progress.
 * b85encode processes independent 4-byte groups, so slicing on 4-byte
 * boundaries and concatenating is byte-for-byte identical to encoding at once.
 * @param {Uint8Array} framed length is a multiple of 4
 * @param {(fraction: number) => void} onProgress fraction of the encode done
 * @returns {Promise<string>}
 */
async function encodeWithProgress(framed, onProgress) {
  const CHUNK = 1 << 20; // 1 MiB (a multiple of 4)
  if (framed.length <= CHUNK) return b85encode(framed);
  let out = '';
  for (let offset = 0; offset < framed.length; offset += CHUNK) {
    const end = Math.min(offset + CHUNK, framed.length);
    out += b85encode(framed.subarray(offset, end));
    onProgress(end / framed.length);
    await nextTick();
  }
  return out;
}

// -----------------------------------------------------------------------------
// Artifact build (cached)
// -----------------------------------------------------------------------------

/** Last built artifact, keyed by the exact inputs that shaped it. */
const cache = { source: null, ui: null, blob: null };

/**
 * Build the artifact HTML for the current model + options, driving the
 * progress bar from 0 to ~0.95. Returns the cached blob when nothing changed.
 * @returns {Promise<Blob>}
 */
async function buildArtifact() {
  const ui = $('opt-ui').checked;
  if (cache.blob && cache.source === state.glbBytes && cache.ui === ui) {
    progress.set(0.95, 'cached');
    return cache.blob;
  }

  progress.set(0.02, 'compressing');
  const gz = await gzipBytes(state.glbBytes);
  await nextTick();

  // length-framed, padded to a 4-byte boundary for base85
  const framed = new Uint8Array(4 + gz.length + (4 - (4 + gz.length) % 4) % 4);
  new DataView(framed.buffer).setUint32(0, gz.length, true);
  framed.set(gz, 4);

  // base85 occupies 0.05..0.85 of the bar
  const payload = await encodeWithProgress(framed, (f) => progress.set(0.05 + f * 0.8, 'encoding'));

  progress.set(0.9, 'assembling');
  const { tpl, css, viewer } = window.__EXPORT;
  let html = put(tpl, 'CSS', css);
  html = put(html, 'TITLE', state.name);
  html = put(html, 'CAPTION', `${state.name} · self-contained file · 0 requests`);
  // Viewer feature flags: the "ship viewer controls" checkbox decides whether
  // the artifact carries camera/material/light controls.
  html = put(html, 'CONFIG', JSON.stringify({ ui }));
  html = put(html, 'PAYLOAD', payload);
  html = put(html, 'BUNDLE', viewer);

  const blob = new Blob([html], { type: 'text/html' });
  cache.source = state.glbBytes;
  cache.ui = ui;
  cache.blob = blob;
  return blob;
}

/**
 * Human size summary for the status line: original -> artifact with the
 * percentage saved (or added, for tiny models where the viewer dominates).
 * @param {Blob} blob the built artifact
 * @returns {string}
 */
function sizeSummary(blob) {
  const inMB = (state.glbBytes.length / 1e6).toFixed(2);
  const outMB = (blob.size / 1e6).toFixed(2);
  const pct = Math.round((1 - blob.size / state.glbBytes.length) * 100);
  const note = pct >= 0 ? `${pct}% compression` : `${-pct}% larger`;
  return `${inMB} MB → ${outMB} MB (${note})`;
}

// -----------------------------------------------------------------------------
// Actions: export (download) and share (Web Share API)
// -----------------------------------------------------------------------------

/**
 * Run one build-backed action with the progress bar and disabled buttons.
 * @param {(blob: Blob) => Promise<void> | void} deliver what to do with the blob
 */
async function runAction(deliver) {
  if (!state.glbBytes) return;
  const buttons = [$('export'), $('share')];
  buttons.forEach((b) => { b.disabled = true; });
  progress.start();
  try {
    const blob = await buildArtifact();
    await deliver(blob);
    progress.set(1);
    setTimeout(() => progress.hide(), 1500);
  } catch (e) {
    setStatus('failed: ' + (e.message || e));
    progress.hide();
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

/** Wire the export and share buttons. */
export function initExport() {
  $('export').addEventListener('click', () =>
    runAction((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = state.name + '.3dpeer.html';
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus(`exported: ${state.name}.3dpeer.html — ${sizeSummary(blob)}`);
    }));

  // Hide the share button where the browser cannot share files at all.
  const probe = new File([''], 'probe.html', { type: 'text/html' });
  const canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [probe] }));
  if (!canShareFiles) $('share').classList.add('hidden');

  $('share').addEventListener('click', () =>
    runAction(async (blob) => {
      const file = new File([blob], state.name + '.3dpeer.html', { type: 'text/html' });
      try {
        await navigator.share({ files: [file], title: state.name });
        setStatus(`shared: ${state.name}.3dpeer.html — ${sizeSummary(blob)}`);
      } catch (e) {
        if (e.name === 'AbortError') {
          setStatus('share cancelled');
        } else if (e.name === 'NotAllowedError') {
          // The user gesture expired during a long build; the artifact is now
          // cached, so the next press shares instantly.
          setStatus('ready to share — press share again');
        } else {
          throw e;
        }
      }
    }));
}
