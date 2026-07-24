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
// The preview mirrors the export's trade-off: weld on position AND uv, then
// simplify with LockBorder. Seam vertices stay split, so every UV seam is a
// border edge the simplifier will not collapse, and the texture does not tear
// along the seams as the budget drops.
// =============================================================================

import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { refreshPolyCount } from './hud.js';
import { state } from './state.js';
import { $ } from './dom.js';

/** mesh -> its original index attribute (null when the mesh was non-indexed). */
const originalIndex = new Map();

/** mesh -> cached weld data (see weldMesh). */
const weldCache = new Map();

/** Meshes bigger than this are previewed unwelded (welding would stall). */
const MAX_WELD_VERTICES = 600000;

/**
 * Merge vertices that share a position AND a UV.
 *
 * Imported meshes (USDZ, OBJ, STL — anything that goes through GLTFExporter)
 * arrive fully split: every triangle owns its three vertices. The simplifier
 * then sees disconnected triangles and can collapse almost nothing, so the
 * preview appeared to do nothing. Welding fixes that — but welding on
 * POSITION ALONE fuses the two sides of a UV seam into one vertex, and the
 * mapping back to real vertices then hands both sides the same UV, tearing
 * the texture along every seam. Including the UV in the key keeps seam
 * vertices distinct, which also turns each seam into a border edge that
 * simplify() can be told to lock (see applyToMesh). Same trade-off the
 * export path already makes with weld() + lockBorder.
 * @param {THREE.BufferAttribute} position
 * @param {THREE.BufferAttribute|undefined} uv
 * @returns {{positions: Float32Array, remap: Uint32Array, first: Uint32Array}}
 *   welded positions, original-vertex -> welded-id, welded-id -> a
 *   representative original vertex
 */
function weldMesh(position, uv) {
  const lookup = new Map();
  const remap = new Uint32Array(position.count);
  const firstOf = [];
  const coords = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const key = uv
      ? x + ',' + y + ',' + z + ',' + uv.getX(i) + ',' + uv.getY(i)
      : x + ',' + y + ',' + z;
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

/** While true the preview leaves the display geometry at the original
 *  topology (the compare split view shows decimation on its compressed
 *  side only, so the "original" side must stay pristine). */
let suspended = false;

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
    weldCache.set(mesh, position.count <= MAX_WELD_VERTICES
      ? weldMesh(position, geometry.getAttribute('uv'))
      : null);
  }
  const weld = weldCache.get(mesh);

  let indices;
  if (weld) {
    const welded = new Uint32Array(sourceArray.length);
    for (let i = 0; i < sourceArray.length; i++) welded[i] = weld.remap[sourceArray[i]];
    // simplify(indices, positions, stride, targetIndexCount, error, flags)
    // LockBorder keeps the UV seams (border edges after the uv-aware weld)
    // and any open boundary exactly where they are.
    const [simplified] = MeshoptSimplifier.simplify(
      welded, weld.positions, 3, target, 0.05, ['LockBorder']);
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
      const ratio = suspended ? 1 : 1 - (parseFloat($('c-dec').value) || 0) / 100;
      for (const mesh of state.originals.keys()) {
        try {
          applyToMesh(mesh, ratio);
        } catch (e) {
          console.warn('decimate preview: mesh skipped', e && e.message ? e.message : e);
        }
      }
    } while (queued);
    // The HUD reports what is on screen, decimation preview included.
    refreshPolyCount();
  } finally {
    busy = false;
  }
}

/**
 * Suspend (restore originals) or resume (re-apply the slider) the preview.
 * @param {boolean} on
 */
export function setDecimateSuspended(on) {
  suspended = on;
  clearTimeout(timer);
  run();
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
