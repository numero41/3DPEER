// =============================================================================
// compare.js
//
// Before/after compression split view. Toggling compare runs the REAL export
// pipeline (shared, memoized via exporter.getOptimizedGLB) on the current
// settings, loads the result next to the original, and renders the two into
// the same viewport split by a draggable divider: original on the left,
// compressed on the right, one camera. What the right side shows is exactly
// the GLB an export would embed — texture size, quality, precision and
// decimation all become visible live, not just after export.
//
// While compare is active the live decimate preview is suspended so the left
// side stays the untouched original (decimation shows on the right, where the
// pipeline applied it for real). Any settings change rebuilds the compressed
// side, debounced and serialized.
//
// The split divider is drawn by the renderer (a scissored clear), not by DOM:
// positioning a DOM line from JS would need element.style (invariant #6).
// =============================================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { getOptimizedGLB } from './exporter.js';
import { readSettings } from './comp-settings.js';
import { setDecimateSuspended } from './decimate-preview.js';
import { reapplyMaterial } from './materials.js';
import { state } from './state.js';
import { $ } from './dom.js';
import { setStatus } from './ui.js';

/** Divider band colour (mirrors the --line-strong token in site.css). */
const DIVIDER_COLOR = new THREE.Color(0x35353b);

/** Divider band width in device pixels. */
const DIVIDER_PX = 2;

/** Debounce for settings-driven rebuilds of the compressed side (ms). */
const REBUILD_DEBOUNCE_MS = 700;

/** The render stage, provided by initCompare. */
let stageRef = null;

/** The compressed model currently shown on the right side, or null. */
let compareRoot = null;

/** Whether compare mode is on. */
let active = false;

/** Serialize builds; remember whether another build was requested meanwhile. */
let building = false;
let buildQueued = false;

/** Debounce timer for settings-driven rebuilds. */
let rebuildTimer = 0;

/**
 * Dispose a model subtree's GPU resources (geometry, materials, textures).
 * @param {THREE.Object3D} root
 */
function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const key of Object.keys(m)) {
          if (m[key] && m[key].isTexture) m[key].dispose();
        }
        m.dispose();
      }
    }
  });
}

/**
 * Where the divider belongs, in canvas pixels.
 *
 * A range input's thumb centre does NOT travel the full track: it starts half
 * a thumb in and ends half a thumb before the end. Using value/100 * width
 * therefore drifts from the visible handle, and the wider the viewport the
 * more obvious the gap. This reproduces the browser's own thumb geometry so
 * the drawn line sits under the handle at every position.
 * @param {number} w canvas width in CSS pixels
 * @returns {number} pixel offset of the divider
 */
function splitPixel(w) {
  const input = $('compare-split');
  const min = parseFloat(input.min);
  const max = parseFloat(input.max);
  const fraction = (parseFloat(input.value) - min) / (max - min);
  const styles = getComputedStyle(document.documentElement);
  const thumb = parseFloat(styles.getPropertyValue('--range-thumb')) || 10;
  const track = input.getBoundingClientRect().width - thumb;
  const offset = input.getBoundingClientRect().left - $('viewport').getBoundingClientRect().left;
  return offset + thumb / 2 + fraction * track;
}

/**
 * Render both halves with the shared camera: original left of the split,
 * compressed right of it, then the divider band.
 */
function renderCompare() {
  const { renderer, scene, camera, canvas } = stageRef;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h || !state.root || !compareRoot) {
    renderer.render(scene, camera);
    return;
  }
  const split = Math.round(splitPixel(w));

  renderer.setScissorTest(true);
  renderer.setViewport(0, 0, w, h);

  // left: the original
  compareRoot.visible = false;
  state.root.visible = true;
  renderer.setScissor(0, 0, split, h);
  renderer.render(scene, camera);

  // right: the compressed result
  state.root.visible = false;
  compareRoot.visible = true;
  renderer.setScissor(split, 0, w - split, h);
  renderer.render(scene, camera);

  // steady state outside the frame: original visible (picking, snapshots of
  // other code paths), compressed hidden.
  state.root.visible = true;
  compareRoot.visible = false;

  // divider band (scissored clear — WebGL, not DOM)
  const saved = new THREE.Color();
  renderer.getClearColor(saved);
  const savedAlpha = renderer.getClearAlpha();
  renderer.setScissor(Math.max(0, split - DIVIDER_PX / 2), 0, DIVIDER_PX, h);
  renderer.setClearColor(DIVIDER_COLOR, 1);
  renderer.clear(true, false, false);
  renderer.setClearColor(saved, savedAlpha);
  renderer.setScissorTest(false);
}

/**
 * Build (or rebuild) the compressed side from the current settings.
 * Serialized: a change during a build queues exactly one re-run.
 */
async function buildCompareModel() {
  if (building) {
    buildQueued = true;
    return;
  }
  building = true;
  try {
    do {
      buildQueued = false;
      setStatus('Preparing the comparison…');
      const settings = readSettings();
      const bytes = await getOptimizedGLB(settings);
      if (!active) return; // toggled off while compressing
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await new Promise((ok, ko) => loader.parse(bytes.buffer.slice(0), '', ok, ko));
      if (!active) {
        disposeTree(gltf.scene);
        return;
      }
      if (compareRoot) {
        stageRef.scene.remove(compareRoot);
        disposeTree(compareRoot);
      }
      compareRoot = gltf.scene;
      compareRoot.visible = false;
      stageRef.scene.add(compareRoot);
      // Match whatever the left side is wearing right now.
      reapplyMaterial();
      const inMB = (state.glbBytes.length / 1e6).toFixed(2);
      const outMB = (bytes.length / 1e6).toFixed(2);
      const pct = Math.round((1 - bytes.length / state.glbBytes.length) * 100);
      setStatus(`Comparison ready. Original ${inMB} MB, compressed ${outMB} MB, ${pct}% smaller`, 'ok');
    } while (buildQueued);
  } catch (e) {
    setStatus('The comparison could not be prepared', 'error');
    setCompare(false);
  } finally {
    building = false;
  }
}

/**
 * Turn the compare view on or off (UI classes, decimate suspension, render
 * delegate, compressed-side lifecycle).
 * @param {boolean} on
 */
function setCompare(on) {
  if (on === active) return;
  if (on && !state.glbBytes) {
    setStatus('Load a model to compare', 'warn');
    return;
  }
  active = on;
  $('compare').setAttribute('aria-pressed', String(on));
  $('stage').classList.toggle('comparing', on);
  if (on) {
    // quad and compare both own the scissor pass — compare wins.
    if (stageRef.isQuad()) {
      $('quad').setAttribute('aria-pressed', 'false');
      $('stage').classList.remove('quad');
      stageRef.setQuad(false);
    }
    setDecimateSuspended(true);
    stageRef.setRenderOverride(renderCompare);
    buildCompareModel();
  } else {
    stageRef.setRenderOverride(null);
    setDecimateSuspended(false);
    if (compareRoot) {
      stageRef.scene.remove(compareRoot);
      disposeTree(compareRoot);
      compareRoot = null;
    }
    setStatus('');
  }
}

/** Schedule a debounced rebuild of the compressed side (settings changed). */
function scheduleRebuild() {
  if (!active) return;
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(buildCompareModel, REBUILD_DEBOUNCE_MS);
}

/**
 * The compressed model currently on the right of the split, or null.
 * Display settings (material preset, wireframe) must reach BOTH sides, or
 * the comparison stops comparing like for like.
 * @returns {THREE.Object3D | null}
 */
export function getCompareRoot() {
  return compareRoot;
}

/** Compare must not survive a model swap: the loader resets the scene. */
export function resetCompare() {
  setCompare(false);
}

/**
 * Wire the compare toggle, the split slider and settings-driven rebuilds.
 * @param {ReturnType<import('./stage.js').createStage>} stage the render stage
 */
export function initCompare(stage) {
  stageRef = stage;
  $('compare').addEventListener('click', () => setCompare(!active));
  ['c-pos', 'c-nrm', 'c-tex', 'c-q', 'c-dec'].forEach((id) =>
    $(id).addEventListener('input', scheduleRebuild));
  $('c-reset').addEventListener('click', scheduleRebuild);
}
