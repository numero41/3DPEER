// =============================================================================
// usdz.js
//
// Multi-layer .usdz reading. A .usdz is a zip package; real-world exports
// (DCC pipelines, avatar systems) nest further .usdz packages inside — the
// GENIES avatars go three deep (outer -> 1/avatar.usdz -> 0/avatar.usdz).
// three's loader is handed one package at a time, so this module walks the
// whole tree with a small zip reader (no dependencies) and solves the two
// problems that nesting creates:
//
//   1. TEXTURES. USD references assets with package-relative paths such as
//      `1/avatar.usdz[0/avatar.usdz[head/textures/a.png]]`. The image usually
//      lives in a DIFFERENT package than the layer that references it, so no
//      single parse can resolve it. Every image in the tree is collected into
//      one shared pool (by full path and by basename) and published to the
//      loader, which normalises the bracketed path before looking it up.
//
//   2. DUPLICATE GEOMETRY. A package and the package nested inside it usually
//      describe the SAME asset at different stages. Parsing both merges two
//      overlapping copies, which z-fights and reads as "broken faces". The
//      walk therefore stops descending as soon as a package yields geometry,
//      while still visiting siblings (so avatar + hair both load, once each).
//
// Parsing itself goes through the official three.js USDLoader vendored from
// r185 (src/vendor/usd — pure JS, MIT): it reads ASCII .usda AND binary .usdc.
// =============================================================================

import * as THREE from 'three';
import { USDLoader } from '../vendor/usd/USDLoader.js';
import { setSharedUSDAssets } from '../vendor/usd/USDComposer.js';

/** Zip signatures. */
const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/** Maximum nesting depth walked (defensive bound; real files use 1-3). */
const MAX_DEPTH = 4;

/** Extensions treated as texture assets worth pooling. */
const IMAGE_RE = /\.(png|jpe?g|webp|avif)$/i;

// -----------------------------------------------------------------------------
// Minimal zip reader
// -----------------------------------------------------------------------------

/**
 * List the entries of a zip archive from its central directory.
 * @param {Uint8Array} bytes the archive
 * @returns {Array<{name: string, method: number, compSize: number, localOffset: number}>}
 * @throws when the buffer is not a readable zip
 */
function listZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record sits within the last 64 KB + 22 bytes.
  let eocd = -1;
  const floor = Math.max(0, bytes.length - 65558);
  for (let i = bytes.length - 22; i >= floor; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (offset === 0xffffffff) throw new Error('zip64 archives are not supported');
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== SIG_CENTRAL) break;
    const method = view.getUint16(offset + 10, true);
    const compSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.push({ name, method, compSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Extract one entry's bytes (stored, or deflate via DecompressionStream).
 * @param {Uint8Array} bytes the archive
 * @param {{method: number, compSize: number, localOffset: number}} entry
 * @returns {Promise<Uint8Array>}
 */
async function readEntry(bytes, entry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = entry.localOffset;
  if (view.getUint32(at, true) !== SIG_LOCAL) throw new Error('zip: bad local header');
  const nameLength = view.getUint16(at + 26, true);
  const extraLength = view.getUint16(at + 28, true);
  const start = at + 30 + nameLength + extraLength;
  const data = bytes.subarray(start, start + entry.compSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error('zip: unsupported compression method ' + entry.method);
}

// -----------------------------------------------------------------------------
// Package tree
// -----------------------------------------------------------------------------

/**
 * @typedef {Object} UsdPackage
 * @property {string} name label for diagnostics
 * @property {Uint8Array} bytes the package archive
 * @property {UsdPackage[]} children packages nested inside it
 */

/**
 * Walk one package: pool its images, recurse into nested packages, and note
 * which crate layers it holds (for the error message when nothing loads).
 * @param {Uint8Array} bytes the package
 * @param {string} name label
 * @param {number} depth current nesting depth
 * @param {{assets: Record<string, Uint8Array>, ambiguous: Set<string>, usdc: string[]}} out accumulator
 * @returns {Promise<UsdPackage>}
 */
async function walkPackage(bytes, name, depth, out) {
  const node = { name, bytes, children: [] };
  let entries;
  try {
    entries = listZipEntries(bytes);
  } catch (e) {
    return node; // not a zip at this level — nothing to walk
  }
  for (const entry of entries) {
    const lower = entry.name.toLowerCase();
    if (lower.endsWith('.usdc')) out.usdc.push(entry.name);
    if (IMAGE_RE.test(lower)) {
      try {
        const image = await readEntry(bytes, entry);
        // First writer wins: the outermost package is the most specific.
        if (!out.assets[entry.name]) out.assets[entry.name] = image;
        // Basenames are only a fallback, and only when unambiguous — matching
        // the wrong same-named file would paint a texture onto the wrong mesh.
        const base = entry.name.split('/').pop();
        if (out.ambiguous.has(base)) {
          // already known to collide
        } else if (out.assets[base] && out.assets[base] !== image) {
          delete out.assets[base];
          out.ambiguous.add(base);
        } else {
          out.assets[base] = image;
        }
      } catch (e) {
        console.warn('usdz: image skipped', entry.name, e && e.message);
      }
    }
    if (lower.endsWith('.usdz') && depth < MAX_DEPTH) {
      const nested = await readEntry(bytes, entry);
      node.children.push(await walkPackage(nested, entry.name, depth + 1, out));
    }
  }
  return node;
}

// -----------------------------------------------------------------------------
// Parsing
// -----------------------------------------------------------------------------

/**
 * Parse one package with three's USDLoader, waiting for its textures.
 *
 * The loader builds the scene synchronously but decodes texture images
 * asynchronously, and only assigns `texture.image` once an image has loaded —
 * so the group must not be inspected (or handed to GLTFExporter) before the
 * loader's own onLoad callback fires.
 * @param {UsdPackage} pkg
 * @returns {Promise<{object: THREE.Object3D, meshes: number} | null>}
 */
async function parsePackage(pkg) {
  let object;
  let settle;
  const texturesReady = new Promise((resolve) => { settle = resolve; });
  try {
    const slice = pkg.bytes.buffer.slice(
      pkg.bytes.byteOffset, pkg.bytes.byteOffset + pkg.bytes.byteLength);
    object = new USDLoader().parse(slice, '', () => settle(), (e) => {
      console.warn('usdz: texture load reported an error in', pkg.name, e && e.message);
      settle();
    });
  } catch (e) {
    console.warn('usdz: package skipped:', pkg.name, e && e.message);
    return null;
  }
  // Bounded wait: a stuck image must not hang the import.
  await Promise.race([
    texturesReady,
    new Promise((resolve) => setTimeout(resolve, TEXTURE_TIMEOUT_MS)),
  ]);

  // Textures are decoded now — settle direct-vs-ancestor binding conflicts.
  resolveSparseBakes(object);

  let meshes = 0;
  object.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    // Some layers omit normals; the exporter and lit materials need them.
    if (!o.geometry.getAttribute('normal')) o.geometry.computeVertexNormals();
    // USD materials often arrive flagged transparent at full opacity with no
    // alpha source, which only produces blend-sorting artifacts. Textures that
    // DO carry alpha (…AlbedoTransparency) keep their transparency.
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) {
      if (mat && mat.transparent && mat.opacity >= 1
        && !mat.map && !mat.alphaMap && !(mat.transmission > 0)) {
        mat.transparent = false;
      }
    }
  });
  return { object, meshes };
}

/** Give a texture image this long to decode before it is dropped (ms). */
const TEXTURE_TIMEOUT_MS = 20000;

// -----------------------------------------------------------------------------
// Sparse-bake resolution
// -----------------------------------------------------------------------------

/** A base-colour map is "sparse" above this fraction of pure-black opaque
 *  pixels (the GENIES head bake measures 0.81; real albedos stay far below). */
const SPARSE_BLACK_MIN = 0.5;

/** The replacement albedo must itself be dense: below this black fraction. */
const ALT_BLACK_MAX = 0.25;

/** Downsample edge for the histogram (4096 samples are plenty). */
const HISTO_SIZE = 64;

/**
 * Fraction of an image's pixels that are pure black AND fully opaque.
 * Transparent black (alpha-carded hair/eyebrow textures) does not count.
 * @param {CanvasImageSource} image a decoded texture image
 * @returns {number} 0..1, or -1 when the image cannot be sampled
 */
function blackOpaqueFraction(image) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = HISTO_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  try {
    ctx.drawImage(image, 0, 0, HISTO_SIZE, HISTO_SIZE);
  } catch (e) {
    return -1;
  }
  const data = ctx.getImageData(0, 0, HISTO_SIZE, HISTO_SIZE).data;
  let black = 0;
  const total = HISTO_SIZE * HISTO_SIZE;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 8 && data[i + 1] < 8 && data[i + 2] < 8 && data[i + 3] > 250) black++;
  }
  return black / total;
}

/**
 * Swap sparse partial-bake albedos for the ancestor-bound material.
 *
 * Pipeline packages (avatar generators) often bind a machine-produced partial
 * bake directly on a mesh while the ancestor scope still binds the full
 * composited material. Per USD rules the direct binding wins — but a bake
 * whose albedo is mostly pure-black opaque texels renders as black patches in
 * any generic viewer. When that measured condition holds AND the ancestor's
 * albedo is dense, the ancestor material is used instead. Purely data-driven:
 * no name matching, logged when it triggers.
 *
 * Must run after the loader's onLoad (textures decoded). Always removes the
 * userData stash — GLTFExporter must never see a material in userData.
 * @param {THREE.Object3D} root a parsed package's scene
 */
function resolveSparseBakes(root) {
  root.traverse((node) => {
    if (!node.isMesh || !node.userData.usdAltMaterial) return;
    const alt = node.userData.usdAltMaterial;
    delete node.userData.usdAltMaterial;
    const current = Array.isArray(node.material) ? null : node.material;
    if (!current || !current.map || !current.map.image) return;
    if (!alt.material || !alt.material.map || !alt.material.map.image) return;
    const directBlack = blackOpaqueFraction(current.map.image);
    if (directBlack < SPARSE_BLACK_MIN) return;
    const altBlack = blackOpaqueFraction(alt.material.map.image);
    if (altBlack < 0 || altBlack > ALT_BLACK_MAX) return;
    console.info('usdz: sparse partial-bake albedo on "' + node.name + '" ('
      + Math.round(directBlack * 100) + '% black) replaced by ancestor material '
      + alt.path + ' (' + Math.round(altBlack * 100) + '% black)');
    node.material = alt.material;
  });
}

/**
 * Drop textures that genuinely failed to decode. Called only AFTER the
 * loader's onLoad has fired, so a null image here means a real failure —
 * handing one to GLTFExporter fails with "No valid image data found".
 * @param {THREE.Object3D} root
 */
function pruneBrokenTextures(root) {
  /** @type {Set<THREE.Texture>} */
  const broken = new Set();
  root.traverse((node) => {
    if (!node.isMesh) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of mats) {
      if (!mat) continue;
      for (const key of Object.keys(mat)) {
        const value = mat[key];
        if (value && value.isTexture) {
          const image = value.image;
          if (!image || !(image.width || image.videoWidth)) broken.add(value);
        }
      }
    }
  });
  if (!broken.size) return;
  root.traverse((node) => {
    if (!node.isMesh) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of mats) {
      if (!mat) continue;
      for (const key of Object.keys(mat)) {
        if (broken.has(mat[key])) mat[key] = null;
      }
      mat.needsUpdate = true;
    }
  });
  console.warn('usdz: dropped ' + broken.size + ' texture(s) that failed to decode');
}

/**
 * Depth-first collect of geometry: a package that yields meshes wins and its
 * descendants are skipped (they re-describe the same asset), while siblings
 * are still visited.
 * @param {UsdPackage} pkg
 * @param {THREE.Group} merged destination
 * @returns {Promise<number>} meshes added from this subtree
 */
async function collectGeometry(pkg, merged) {
  const parsed = await parsePackage(pkg);
  if (parsed && parsed.meshes > 0) {
    merged.add(parsed.object);
    return parsed.meshes;
  }
  let count = 0;
  for (const child of pkg.children) count += await collectGeometry(child, merged);
  return count;
}

/**
 * Parse a possibly multi-layered .usdz into one three.js group.
 * @param {ArrayBuffer} buffer the dropped file's contents
 * @returns {Promise<THREE.Group>}
 * @throws with a format-specific message when nothing was readable
 */
export async function parseMultiLayerUSDZ(buffer) {
  const bytes = new Uint8Array(buffer);
  const out = { assets: {}, ambiguous: new Set(), usdc: [] };
  const root = await walkPackage(bytes, 'root', 0, out);

  // Publish every image in the tree so package-relative texture references
  // resolve across package boundaries.
  setSharedUSDAssets(out.assets);

  const merged = new THREE.Group();
  const meshCount = await collectGeometry(root, merged);
  if (meshCount) pruneBrokenTextures(merged);

  if (!meshCount) {
    if (out.usdc.length) {
      throw new Error('could not read this .usdz — its usdc crates ('
        + out.usdc.slice(0, 3).join(', ') + (out.usdc.length > 3 ? ', …' : '')
        + ') did not parse; export a .glb instead and report the file');
    }
    throw new Error('no readable geometry found in this .usdz');
  }
  return merged;
}
