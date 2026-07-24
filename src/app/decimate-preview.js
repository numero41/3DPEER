// =============================================================================
// decimate-preview.js
//
// Live viewport preview of the "decimate" slider: when the user reduces the
// triangle budget, the meshes on screen are simplified in place so the effect
// is visible immediately — the export pipeline stays the source of truth, this
// only mirrors it in the display.
//
// The simplifier (meshoptimizer, the pinned codec) returns a NEW index buffer
// that references the existing vertices, so swapping geometry.index preserves
// skinning and morph attributes untouched — the preview works on skinned
// avatars as well as static meshes.
//
// This is a PREVIEW, not the export: it simplifies the display geometry as-is
// (no weld pass), so it does not lock borders — locking every edge of an
// unwelded mesh would block all reduction and show no change. The export path
// welds first and keeps seams (lockBorder); the preview only illustrates the
// triangle budget.
// =============================================================================

import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { state } from './state.js';
import { $ } from './dom.js';

/** mesh -> its original index attribute (null when the mesh was non-indexed). */
const originalIndex = new Map();

/** Ever-increasing index version. three caches the wireframe edge buffer per
 *  geometry and only rebuilds it when `index.version` EXCEEDS the cached one,
 *  so a fresh attribute (version 0) would leave the wireframe overlay showing
 *  the original topology. Stamping a rising version forces the rebuild. */
let indexVersion = 0;

/**
 * Install an index attribute and force three to re-derive dependent buffers.
 * @param {THREE.BufferGeometry} geometry
 * @param {THREE.BufferAttribute|null} attribute
 */
function setIndexAndInvalidate(geometry, attribute) {
  geometry.setIndex(attribute);
  if (geometry.index) geometry.index.version = ++indexVersion;
}

/** Debounce timer for slider-driven previews. */
let timer = 0;

/** Serialize preview runs (never overlap two simplifications). */
let busy = false;
let queued = null;

/**
 * Simplify one geometry to a triangle ratio, swapping its index. Caches the
 * original index the first time so decimate 0 restores it exactly.
 * @param {THREE.Mesh} mesh
 * @param {number} ratio 0..1 fraction of triangles to KEEP
 */
function applyToMesh(mesh, ratio) {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  if (!position) return;

  if (!originalIndex.has(mesh)) originalIndex.set(mesh, geometry.index);
  const source = originalIndex.get(mesh);
  const sourceArray = source
    ? source.array
    : Uint32Array.from({ length: position.count }, (_, i) => i);

  if (ratio >= 1) {
    setIndexAndInvalidate(geometry, source);
    return;
  }

  const target = Math.max(3, Math.floor((sourceArray.length * ratio) / 3) * 3);
  // De-interleave to a tight XYZ Float32Array: GLTFLoader often stores
  // positions interleaved with normals (stride 6), and meshopt's simplify
  // needs a contiguous position buffer at stride 3.
  const positions = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    positions[i * 3] = position.getX(i);
    positions[i * 3 + 1] = position.getY(i);
    positions[i * 3 + 2] = position.getZ(i);
  }
  // simplify(indices, positions, positionsStride, targetIndexCount, error, flags)
  const [indices] = MeshoptSimplifier.simplify(
    sourceArray instanceof Uint32Array ? sourceArray : new Uint32Array(sourceArray),
    positions, 3, target, 0.05, [],
  );
  setIndexAndInvalidate(geometry, new THREE.BufferAttribute(indices, 1));
}

/** Run the preview for the current decimate value across all real meshes. */
async function run() {
  if (busy) {
    queued = true;
    return;
  }
  busy = true;
  try {
    await MeshoptSimplifier.ready;
    do {
      queued = false;
      const ratio = 1 - (parseFloat($('c-dec').value) || 0) / 100;
      for (const mesh of state.originals.keys()) {
        try {
          applyToMesh(mesh, ratio);
        } catch (e) {
          console.warn('decimate preview: mesh skipped', e && e.message ? e.message : e);
        }
      }
    } while (queued);
  } finally {
    busy = false;
  }
}

/** Schedule a debounced preview refresh (called on decimate-slider input). */
export function scheduleDecimatePreview() {
  clearTimeout(timer);
  timer = setTimeout(run, 250);
}

/** Forget cached indices (call on model load, before the new meshes arrive). */
export function resetDecimatePreview() {
  originalIndex.clear();
}

/** Wire the decimate slider to the live preview. */
export function initDecimatePreview() {
  $('c-dec').addEventListener('input', scheduleDecimatePreview);
}
