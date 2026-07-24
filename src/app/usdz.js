// =============================================================================
// usdz.js
//
// Multi-layer .usdz reading. A .usdz is a zip package; real-world exports
// (DCC pipelines, avatar systems) frequently NEST further .usdz packages
// inside the outer one, which three's USDZLoader never looks into. This
// module walks the whole package tree with a small zip reader (no
// dependencies), tries three's USDZLoader on every package found, and merges
// whatever produced geometry into one group.
//
// Parsing itself goes through the official three.js USDLoader vendored from
// r185 (src/vendor/usd — pure JS, MIT): it reads ASCII .usda AND binary
// .usdc crates, so most DCC exports load. When a package still yields
// nothing, the error names the crates it saw instead of a generic
// "no geometry".
// =============================================================================

import * as THREE from 'three';
import { USDLoader } from '../vendor/usd/USDLoader.js';

/** Zip signatures. */
const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/** Maximum nesting depth walked (defensive bound, real files use 1-2). */
const MAX_DEPTH = 4;

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

/**
 * Walk a usdz package tree, collecting every package buffer and noting which
 * layer formats were seen along the way.
 * @param {Uint8Array} bytes a usdz package
 * @param {number} depth current nesting depth
 * @param {{buffers: Uint8Array[], usdc: string[], usda: string[]}} out accumulator
 * @returns {Promise<typeof out>}
 */
async function collectPackages(bytes, depth, out) {
  let entries;
  try {
    entries = listZipEntries(bytes);
  } catch (e) {
    return out; // not a zip at this level — nothing further to walk
  }
  for (const entry of entries) {
    const lower = entry.name.toLowerCase();
    if (lower.endsWith('.usdc')) out.usdc.push(entry.name);
    if (lower.endsWith('.usda')) out.usda.push(entry.name);
    if (lower.endsWith('.usdz') && depth < MAX_DEPTH) {
      const nested = await readEntry(bytes, entry);
      out.buffers.push(nested);
      await collectPackages(nested, depth + 1, out);
    }
  }
  return out;
}

/**
 * Parse a possibly multi-layered .usdz into one three.js group: every package
 * in the tree (outer + nested) is offered to three's USDZLoader, and every
 * result that contains geometry is merged.
 * @param {ArrayBuffer} buffer the dropped file's contents
 * @returns {Promise<THREE.Group>}
 * @throws with a format-specific message when nothing was readable
 */
export async function parseMultiLayerUSDZ(buffer) {
  const bytes = new Uint8Array(buffer);
  const tree = await collectPackages(bytes, 0, { buffers: [bytes], usdc: [], usda: [] });

  const merged = new THREE.Group();
  let meshCount = 0;
  for (const packageBytes of tree.buffers) {
    let object = null;
    try {
      const slice = packageBytes.buffer.slice(
        packageBytes.byteOffset, packageBytes.byteOffset + packageBytes.byteLength);
      object = new USDLoader().parse(slice);
    } catch (e) {
      console.warn('usdz: package skipped:', e);
      continue; // this package had no layer the parser could read — try the others
    }
    let meshes = 0;
    object.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      // some layers omit normals; the exporter and lit materials need them.
      if (!o.geometry.getAttribute('normal')) o.geometry.computeVertexNormals();
    });
    if (meshes) {
      merged.add(object);
      meshCount += meshes;
    }
  }

  if (!meshCount) {
    if (tree.usdc.length) {
      throw new Error('could not read this .usdz — its usdc crates ('
        + tree.usdc.slice(0, 3).join(', ') + (tree.usdc.length > 3 ? ', …' : '')
        + ') did not parse; export a .glb instead and report the file');
    }
    throw new Error('no readable geometry found in this .usdz');
  }
  return merged;
}
