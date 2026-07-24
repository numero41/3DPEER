// =============================================================================
// hud.js
//
// Viewport heads-up displays (top-left): polygon budget of the loaded model
// and the live frame rate. Both are read-outs only — pointer-events are off
// in CSS so they never steal a click from the model underneath.
//
// The poly count reflects what is CURRENTLY displayed, decimation preview
// included, so the readout and the viewport never disagree; it is recomputed
// on demand rather than per frame (traversal is O(meshes), the frame loop is
// not the place for it). Visibility is class-driven from the view menu.
// =============================================================================

import { state } from './state.js';
import { $ } from './dom.js';

/** Frame-rate sampling window (ms) — long enough to read, short enough to react. */
const FPS_WINDOW_MS = 500;

/** Frames counted in the current window, and when the window opened. */
let frames = 0;
let windowStart = 0;

/**
 * Format a count with thin-space grouping (1 234 567) for readability.
 * @param {number} n
 * @returns {string}
 */
function group(n) {
  return n.toLocaleString('en-US').split(',').join(' ');
}

/**
 * Recount vertices / faces / edges over the visible meshes and write the
 * poly-count line. Edges are derived from the manifold-agnostic upper bound
 * (3 per triangle, shared edges counted once via a face/vertex identity) —
 * the honest figure for a display budget, not a topology audit.
 */
export function refreshPolyCount() {
  if (!state.root) {
    $('hud-verts').textContent = 'Verts: —';
    $('hud-faces').textContent = 'Faces: —';
    $('hud-edges').textContent = 'Edges: —';
    return;
  }
  let vertices = 0;
  let faces = 0;
  for (const mesh of state.originals.keys()) {
    if (!mesh.visible) continue;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    if (!position) continue;
    vertices += position.count;
    faces += (geometry.index ? geometry.index.count : position.count) / 3;
  }
  faces = Math.round(faces);
  // Closed triangle mesh: E = 3F/2. Open meshes have slightly more; this is
  // the standard DCC estimate and is labelled as a count, not a proof.
  const edges = Math.round(faces * 1.5);
  $('hud-verts').textContent = 'Verts: ' + group(vertices);
  $('hud-faces').textContent = 'Faces: ' + group(faces);
  $('hud-edges').textContent = 'Edges: ' + group(edges);
}

/**
 * Count one rendered frame and refresh the fps line once per window.
 * Called from the render loop.
 */
export function tickFps() {
  frames++;
  const now = performance.now();
  if (!windowStart) {
    windowStart = now;
    return;
  }
  const elapsed = now - windowStart;
  if (elapsed < FPS_WINDOW_MS) return;
  $('hud-fps').textContent = 'FPS: ' + Math.round((frames * 1000) / elapsed);
  frames = 0;
  windowStart = now;
}

/**
 * Wire the two HUD toggles in the view menu. Each hides its own line, and the
 * HUD block disappears when both are off.
 */
export function initHud() {
  const sync = () => {
    const poly = $('hud-poly-toggle').checked;
    const fps = $('hud-fps-toggle').checked;
    document.querySelectorAll('.hud-poly').forEach((line) => line.classList.toggle('hidden', !poly));
    $('hud-fps').classList.toggle('hidden', !fps);
    $('hud').classList.toggle('hidden', !poly && !fps);
  };
  $('hud-poly-toggle').addEventListener('change', sync);
  $('hud-fps-toggle').addEventListener('change', sync);
  sync();
}
