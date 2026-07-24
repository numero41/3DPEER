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

/** mesh -> cached weld data (see weldMesh). */
const weldCache = new Map();

/** Meshes bigger than this are previewed unwelded (welding would stall). */
const MAX_WELD_VERTICES = 600000;

/**
 * Merge vertices that share a position.
 *
 * Imported meshes (USDZ, OBJ, STL — anything that goes through GLTFExporter)
 * arrive fully split: every triangle owns its three vertices. The simplifier
 * then sees disconnected triangles and can collapse almost nothing, so the
 * preview appeared to do nothing. The export path avoids this by running
 * weld() before simplify(); this is the preview's equivalent.
 * @param {THREE.BufferAttribute} position
 * @returns {{positions: Float32Array, remap: Uint32Array, first: Uint32Array}}
 *   welded positions, original-vertex -> welded-id, welded-id -> a
 *   representative original vertex
 */
function weldMesh(position) {
  const lookup = new Map();
  const remap = new Uint32Array(position.count);
  const firstOf = [];
  const coords = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const key = x + ',' + y + ',' + z;
    let id = lookup.get(key);
    if (id === undefined) {
      id = firstOf.length;
      lookup.set(key, id);
      firstOf.push(i);
      coords.push(x, y, z);
    }
    remap[i] = id;
  }
  return {
    positions: new Float32Array(coords),
    remap,
    first: Uint32Array.from(firstOf),
  };
}

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
 *
 * A non-indexed mesh (every USDZ/OBJ/STL import) is cached as an identity
 * index, NOT as null: restoring a null index would render correctly but
 * could never invalidate three's cached wireframe overlay — the wireframe
 * edge cache only re-checks its version when geometry.index exists, so a
 * null restore left the overlay stuck on the last decimated topology.
 * @param {THREE.Mesh} mesh
 * @param {number} ratio 0..1 fraction of triangles to KEEP
 */
function applyToMesh(mesh, ratio) {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  if (!position) return;

  if (!originalIndex.has(mesh)) {
    originalIndex.set(mesh, geometry.index || new THREE.BufferAttribute(
      Uint32Array.from({ length: position.count }, (_, i) => i), 1));
  }
  const source = originalIndex.get(mesh);
  const sourceArray = source.array;

  if (ratio >= 1) {
    setIndexAndInvalidate(geometry, source);
    return;
  }

  const target = Math.max(3, Math.floor((sourceArray.length * ratio) / 3) * 3);

  // Weld so the simplifier sees a connected surface. Positions are also
  // de-interleaved here: GLTFLoader stores them interleaved with normals
  // (stride 6) and meshopt needs a contiguous buffer at stride 3.
  if (!weldCache.has(mesh)) {
    weldCache.set(mesh, position.count <= MAX_WELD_VERTICES ? weldMesh(position) : null);
  }
  const weld = weldCache.get(mesh);

  let indices;
  if (weld) {
    const welded = new Uint32Array(sourceArray.length);
    for (let i = 0; i < sourceArray.length; i++) welded[i] = weld.remap[sourceArray[i]];
    // simplify(indices, positions, stride, targetIndexCount, error, flags)
    const [simplified] = MeshoptSimplifier.simplify(welded, weld.positions, 3, target, 0.05, []);
    // Map welded ids back to real vertices so the other attributes still apply.
    indices = new Uint32Array(simplified.length);
    for (let i = 0; i < simplified.length; i++) indices[i] = weld.first[simplified[i]];
  } else {
    const positions = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      positions[i * 3] = position.getX(i);
      positions[i * 3 + 1] = position.getY(i);
      positions[i * 3 + 2] = position.getZ(i);
    }
    [indices] = MeshoptSimplifier.simplify(
      sourceArray instanceof Uint32Array ? sourceArray : new Uint32Array(sourceArray),
      positions, 3, target, 0.05, [],
    );
  }
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
  weldCache.clear();
}

/** Wire the decimate slider to the live preview. */
export function initDecimatePreview() {
  $('c-dec').addEventListener('input', scheduleDecimatePreview);
}
