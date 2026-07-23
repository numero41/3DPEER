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

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { b85encode, b85decode } from '../codec/base85.js';
import { wrapAnnotations, extractAnnotations, injectAnnotations } from '../codec/annotations.js';
import { compressGLB, AUTO_LADDER } from './compress.js';
import { readSettings, writeSettings } from './comp-settings.js';
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
// Poster snapshot
// -----------------------------------------------------------------------------

/** The render stage, provided by initExport — needed to capture the poster. */
let stageRef = null;

/**
 * Capture the artifact's static poster (visible in script-blocked previews):
 * a 2×2 grid of front / left / right / perspective views rendered around the
 * current orbit target. The live camera is restored afterwards.
 * @returns {string} a data: URI (JPEG)
 */
function capturePoster() {
  const { renderer, scene, camera, canvas, controls } = stageRef;
  const VIEWS = [[0, 0, 1], [-1, 0, 0], [1, 0, 0], [1, 0.55, 1]]; // front left right persp

  const savedPosition = camera.position.clone();
  const savedQuaternion = camera.quaternion.clone();
  const target = controls.target;
  const distance = camera.position.distanceTo(target);

  const CELL = 420;
  const out = document.createElement('canvas');
  out.width = out.height = CELL * 2;
  const ctx = out.getContext('2d');
  // The workbench renderer clears to transparent (CSS backdrop); fill with
  // the artifact's page colour so the JPEG poster blends into it.
  ctx.fillStyle = '#211a14';
  ctx.fillRect(0, 0, out.width, out.height);

  VIEWS.forEach((dir, i) => {
    camera.position.copy(target)
      .add(new THREE.Vector3(...dir).normalize().multiplyScalar(distance));
    camera.lookAt(target);
    renderer.render(scene, camera);
    ctx.drawImage(canvas, (i % 2) * CELL, Math.floor(i / 2) * CELL, CELL, CELL);
  });

  // restore the interactive camera exactly as it was
  camera.position.copy(savedPosition);
  camera.quaternion.copy(savedQuaternion);
  controls.update();
  renderer.render(scene, camera);

  return out.toDataURL('image/jpeg', 0.82);
}

// -----------------------------------------------------------------------------
// Artifact build (cached)
// -----------------------------------------------------------------------------

/** Last built artifact, keyed by the exact inputs that shaped it. The poster
 *  is captured at first build; reusing it from cache is acceptable. */
const cache = { key: null, blob: null };

/** Last optimized GLB, so export right after auto reuses the solver's work. */
const glbCache = { key: null, bytes: null };

/**
 * Cache key for one (model, settings) combination.
 * @param {import('./compress.js').CompressSettings} settings
 * @returns {string}
 */
function glbKey(settings) {
  return state.name + ':' + state.glbBytes.length + ':' + JSON.stringify(settings);
}

/**
 * Optimize the current model with the given settings, memoizing the result.
 * @param {import('./compress.js').CompressSettings} settings
 * @param {(f: number, label: string) => void} onProgress pipeline progress
 * @param {boolean} [fallbackToRaw=true] on pipeline failure: true returns the
 *   raw bytes (export must still produce a file), false rethrows (the auto
 *   solver skips broken presets instead)
 * @returns {Promise<Uint8Array>}
 */
async function optimizedGLB(settings, onProgress, fallbackToRaw = true) {
  const key = glbKey(settings);
  if (glbCache.bytes && glbCache.key === key) return glbCache.bytes;
  let bytes;
  try {
    bytes = await compressGLB(state.glbBytes, settings, onProgress);
  } catch (e) {
    if (!fallbackToRaw) throw e;
    console.warn('compression failed, exporting raw bytes:', e);
    setStatus('compression failed (' + (e.message || e) + ') — exporting uncompressed', 'warn');
    bytes = state.glbBytes;
  }
  glbCache.key = key;
  glbCache.bytes = bytes;
  return bytes;
}

/**
 * Build the artifact HTML for the current model + options, driving the
 * progress bar from 0 to ~0.95. Returns the cached blob when nothing changed.
 * @returns {Promise<Blob>}
 */
async function buildArtifact() {
  const ui = $('opt-ui').checked;
  const settings = readSettings();
  const annotations = state.annotations;
  const key = glbKey(settings) + ':ui=' + ui + ':ann=' + JSON.stringify(annotations);
  if (cache.blob && cache.key === key) {
    progress.set(0.95, 'cached');
    return cache.blob;
  }

  // optimization occupies 0.02..0.42 of the bar
  const glb = await optimizedGLB(settings, (f, label) => progress.set(0.02 + f * 0.4, label));

  progress.set(0.44, 'compressing');
  const gz = await gzipBytes(glb);
  await nextTick();

  // length-framed, padded to a 4-byte boundary for base85
  const framed = new Uint8Array(4 + gz.length + (4 - (4 + gz.length) % 4) % 4);
  new DataView(framed.buffer).setUint32(0, gz.length, true);
  framed.set(gz, 4);

  // base85 occupies 0.48..0.88 of the bar
  const payload = await encodeWithProgress(framed, (f) => progress.set(0.48 + f * 0.4, 'encoding'));

  progress.set(0.9, 'assembling');
  const { tpl, css, viewer } = window.__EXPORT;
  let html = put(tpl, 'CSS', css);
  html = put(html, 'TITLE', state.name);
  html = put(html, 'CAPTION', `${state.name} · self-contained file · 0 requests`);
  // Viewer feature flags: the "ship viewer controls" checkbox decides whether
  // the artifact carries camera/material/light controls.
  html = put(html, 'CONFIG', JSON.stringify({ ui }));
  // Annotation slot: pins authored on the site ship inside the file, and the
  // markers let the artifact rebuild itself when the recipient adds theirs.
  html = put(html, 'ANNOTATIONS', wrapAnnotations(annotations));
  html = put(html, 'POSTER', capturePoster());
  html = put(html, 'PAYLOAD', payload);
  html = put(html, 'BUNDLE', viewer);

  progress.set(0.94, 'self-test');
  await selfTestArtifact(html, framed, glb, annotations);

  const blob = new Blob([html], { type: 'text/html' });
  cache.key = key;
  cache.blob = blob;
  return blob;
}

/**
 * Self-test on the PRODUCED HTML (invariant #3): re-extract the payload from
 * the final string, decode it back, byte-compare against what was embedded,
 * and fully parse the optimized GLB with the same three r160 loader family the
 * artifact ships. The annotation slot must read back exactly and must survive
 * the same rebuild the artifact performs when the recipient saves an annotated
 * copy. Throws on any mismatch — a failing export must never leave the machine.
 * @param {string} html the assembled artifact
 * @param {Uint8Array} framed the length-framed gzip payload that was encoded
 * @param {Uint8Array} glb the optimized GLB embedded in the payload
 * @param {Array<{p: number[], n: number[], text: string}>} annotations the
 *   pins that were baked into the slot
 */
async function selfTestArtifact(html, framed, glb, annotations) {
  // 1. Payload round-trip: find the exact literal the template wraps.
  const payloadRange = locatePayload(html);
  const back = b85decode(html.slice(payloadRange.from, payloadRange.to));
  if (back.length !== framed.length) throw new Error('self-test: payload length mismatch');
  for (let i = 0; i < back.length; i++) {
    if (back[i] !== framed[i]) throw new Error('self-test: payload corrupted at byte ' + i);
  }

  // 2. The embedded GLB must decode with the viewer's own loader pairing.
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  await new Promise((ok, ko) =>
    loader.parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', ok, ko));

  // 3. Annotation slot: reads back exactly, and a hostile rebuild (the
  //    artifact's own save path) leaves the payload byte-identical.
  if (JSON.stringify(extractAnnotations(html)) !== JSON.stringify(annotations))
    throw new Error('self-test: annotations not shipped exactly');
  const probe = [...annotations, { p: [0, 0, 0], n: [0, 1, 0], text: '<probe> </script> $&' }];
  const rebuilt = injectAnnotations(html, probe);
  const rebuiltRange = locatePayload(rebuilt);
  if (rebuilt.slice(rebuiltRange.from, rebuiltRange.to) !== html.slice(payloadRange.from, payloadRange.to))
    throw new Error('self-test: payload changed across an annotation rebuild');
  if (JSON.stringify(extractAnnotations(rebuilt)) !== JSON.stringify(probe))
    throw new Error('self-test: annotations corrupted across a rebuild');
}

/**
 * Locate the base85 payload literal inside an artifact HTML string.
 * @param {string} html the artifact
 * @returns {{from: number, to: number}} slice bounds of the payload characters
 */
function locatePayload(html) {
  const marker = 'window.__P=\n"';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('self-test: payload marker not found');
  const from = start + marker.length;
  return { from, to: html.indexOf('"', from) };
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
    setStatus('failed: ' + (e.message || e), 'warn');
    progress.hide();
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

/**
 * Wire the export and share buttons.
 * @param {ReturnType<import('./stage.js').createStage>} stage the render stage
 *   (used to capture the poster snapshot at build time)
 */
export function initExport(stage) {
  stageRef = stage;
  $('export').addEventListener('click', () =>
    runAction((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = state.name + '.3dpeer.html';
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus(`exported: ${state.name}.3dpeer.html — ${sizeSummary(blob)}`, 'ok');
    }));

  // Hide the share button where the browser cannot share files at all.
  const probe = new File([''], 'probe.html', { type: 'text/html' });
  const canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [probe] }));
  if (!canShareFiles) $('share').classList.add('hidden');

  // ---- auto (target size) solver ----
  // Walks the quality ladder best-first, measuring the real pipeline output,
  // and stops at the first preset whose estimated artifact fits the target.
  $('c-auto').addEventListener('click', async () => {
    if (!state.glbBytes) return;
    const targetBytes = parseFloat($('c-target').value) * 1e6;
    if (!targetBytes) return;
    const buttons = [$('export'), $('share'), $('c-auto')];
    buttons.forEach((b) => { b.disabled = true; });
    progress.start();
    try {
      // Fixed per-artifact overhead: viewer bundle + template + poster margin.
      const overhead = window.__EXPORT.viewer.length + window.__EXPORT.tpl.length + 100000;
      let best = null; // smallest estimate seen, in case no preset fits
      for (let i = 0; i < AUTO_LADDER.length; i++) {
        const preset = AUTO_LADDER[i];
        const base = i / AUTO_LADDER.length;
        setStatus(`auto: trying quality level ${i + 1}/${AUTO_LADDER.length}…`);
        let glb;
        try {
          glb = await optimizedGLB(preset, (f, label) =>
            progress.set(base + (f * 0.9) / AUTO_LADDER.length, label), false);
        } catch (e) {
          console.warn('auto: preset skipped:', e);
          continue;
        }
        const gz = await gzipBytes(glb);
        const estimate = gz.length * 1.25 + overhead; // base85 adds 25 %
        if (!best || estimate < best.estimate) best = { estimate, preset };
        if (estimate <= targetBytes) break;
      }
      if (!best) throw new Error('no preset could process this file');
      writeSettings(best.preset);
      const estMB = (best.estimate / 1e6).toFixed(2);
      setStatus(
        best.estimate <= targetBytes
          ? `auto: ~${estMB} MB with these settings — press export`
          : `auto: target unreachable, best is ~${estMB} MB — press export`,
        best.estimate <= targetBytes ? 'ok' : 'warn');
      progress.set(1);
      setTimeout(() => progress.hide(), 1200);
    } catch (e) {
      setStatus('auto failed: ' + (e.message || e), 'warn');
      progress.hide();
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  });

  $('share').addEventListener('click', () =>
    runAction(async (blob) => {
      const file = new File([blob], state.name + '.3dpeer.html', { type: 'text/html' });
      try {
        await navigator.share({ files: [file], title: state.name });
        setStatus(`shared: ${state.name}.3dpeer.html — ${sizeSummary(blob)}`, 'ok');
      } catch (e) {
        if (e.name === 'AbortError') {
          setStatus('share cancelled');
        } else if (e.name === 'NotAllowedError') {
          // The user gesture expired during a long build; the artifact is now
          // cached, so the next press shares instantly.
          setStatus('ready to share — press share again', 'warn');
        } else {
          throw e;
        }
      }
    }));
}
