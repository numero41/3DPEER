// =============================================================================
// importers.js
//
// Accepts what the audience actually has on disk. Every non-glTF format is
// loaded with the matching three.js loader, then converted once to GLB via
// GLTFExporter — so a single downstream path (GLTFLoader -> compression ->
// artifact) serves every input, and what you preview is exactly what exports.
//
// Fidelity notes: FBX materials are approximate on the web (assumed); USDZ
// support covers the common Apple-generated files, not full USD.
// =============================================================================

import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { USDZLoader } from 'three/examples/jsm/loaders/USDZLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/** Extensions the workbench accepts, in file-input "accept" form. */
export const ACCEPT = '.glb,.gltf,.obj,.stl,.ply,.fbx,.usdz';

/**
 * Wrap a bare BufferGeometry in a lit standard-material mesh (STL/PLY give
 * geometry only, no scene graph).
 * @param {THREE.BufferGeometry} geometry
 * @returns {THREE.Mesh}
 */
function meshFromGeometry(geometry) {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: 0xb4b4b4,
    roughness: 0.8,
    metalness: 0,
    vertexColors: !!geometry.getAttribute('color'),
  });
  return new THREE.Mesh(geometry, material);
}

/**
 * Parse a non-glTF model file into a three.js object.
 * @param {string} ext lower-case extension without the dot
 * @param {ArrayBuffer} buffer file contents
 * @returns {THREE.Object3D} object; may carry .animations (FBX)
 */
function parseToObject(ext, buffer) {
  switch (ext) {
    case 'obj':
      return new OBJLoader().parse(new TextDecoder().decode(buffer));
    case 'stl':
      return meshFromGeometry(new STLLoader().parse(buffer));
    case 'ply':
      return meshFromGeometry(new PLYLoader().parse(buffer));
    case 'fbx':
      return new FBXLoader().parse(buffer, '');
    case 'usdz':
      return parseUSDZ(buffer);
    default:
      throw new Error('unsupported format: .' + ext);
  }
}

/**
 * Parse a .usdz, with a diagnosis the generic "no geometry" check cannot give:
 * three's USDZLoader only reads ASCII .usda layers, but most DCC exports store
 * geometry as binary .usdc crates (magic "PXR-USDC") or nest further .usdz
 * packages — tell the user what their file is and what to export instead.
 * @param {ArrayBuffer} buffer file contents
 * @returns {THREE.Object3D}
 */
function parseUSDZ(buffer) {
  const object = new USDZLoader().parse(buffer);
  let meshCount = 0;
  object.traverse((o) => { if (o.isMesh) meshCount++; });
  if (!meshCount && hasUsdcCrate(new Uint8Array(buffer))) {
    throw new Error('this .usdz stores its geometry as a binary usdc crate, '
      + 'which browsers cannot read yet — export a .glb (or a .usdz with ASCII .usda layers) instead');
  }
  return object;
}

/**
 * Scan a usdz (zip) for the "PXR-USDC" crate magic.
 * @param {Uint8Array} bytes file contents
 * @returns {boolean}
 */
function hasUsdcCrate(bytes) {
  const magic = [0x50, 0x58, 0x52, 0x2d, 0x55, 0x53, 0x44, 0x43]; // PXR-USDC
  const limit = Math.min(bytes.length, 64 * 1024 * 1024) - magic.length;
  for (let i = 0; i <= limit; i++) {
    if (bytes[i] !== magic[0]) continue;
    let hit = true;
    for (let j = 1; j < magic.length; j++) {
      if (bytes[i + j] !== magic[j]) { hit = false; break; }
    }
    if (hit) return true;
  }
  return false;
}

/**
 * Convert any accepted file to GLB bytes.
 * glTF inputs pass through untouched; everything else goes loader -> GLTFExporter.
 * @param {File} file the dropped/chosen file
 * @returns {Promise<Uint8Array>} GLB bytes ready for the standard pipeline
 */
export async function toGLB(file) {
  const buffer = await file.arrayBuffer();
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'glb' || ext === 'gltf') return new Uint8Array(buffer);

  const object = parseToObject(ext, buffer);
  const result = await new GLTFExporter().parseAsync(object, {
    binary: true,
    animations: object.animations || [],
  });
  return new Uint8Array(result);
}
