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
      return new USDZLoader().parse(buffer);
    default:
      throw new Error('unsupported format: .' + ext);
  }
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
