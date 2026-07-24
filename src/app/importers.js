// =============================================================================
// importers.js
//
// Accepts what the audience actually has on disk. Every non-glTF format is
// loaded with the matching three.js loader, then converted once to GLB via
// GLTFExporter — so a single downstream path (GLTFLoader -> compression ->
// artifact) serves every input, and what you preview is exactly what exports.
//
// Fidelity notes: FBX materials are approximate on the web (assumed); USDZ
// goes through the multi-layer walker in usdz.js (nested packages are read,
// ASCII .usda layers parse, binary .usdc crates do not — clear error).
// =============================================================================

import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
// Vendored r160 copy with LOCAL PATCH guards: an empty animation curve node
// must skip its track, not abort the whole import (see src/vendor/fbx).
import { FBXLoader } from '../vendor/fbx/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { parseMultiLayerUSDZ } from './usdz.js';

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
 * Run a parser with console.warn batched: loaders such as FBXLoader emit one
 * warning PER VERTEX ("more than 4 skinning weights…"), and tens of thousands
 * of console lines both stall the tab and bury real messages. Each distinct
 * message is kept once with a count and replayed at the end.
 * @template T
 * @param {() => T} parse the parsing work
 * @returns {T}
 */
function withBatchedWarnings(parse) {
  const original = console.warn;
  const counts = new Map();
  // console-style %s/%d/%i/%f substitution, so batched messages read the way
  // the console would have printed them.
  const format = (args) => {
    if (typeof args[0] === 'string' && /%[sdif]/.test(args[0])) {
      let next = 1;
      const head = args[0].replace(/%[sdif]/g, () =>
        (next < args.length ? String(args[next++]) : ''));
      return [head, ...args.slice(next)].join(' ').trim();
    }
    return args.join(' ');
  };
  console.warn = (...args) => {
    const key = format(args);
    counts.set(key, (counts.get(key) || 0) + 1);
  };
  try {
    return parse();
  } finally {
    console.warn = original;
    for (const [message, count] of counts) {
      console.warn(count > 1 ? message + ' (×' + count + ')' : message);
    }
  }
}

/**
 * Repair skin weights that do not sum to 1.
 *
 * FBX supports any number of influences per vertex; three's shader supports
 * four, so the loader keeps the four largest and DROPS the rest without
 * renormalising. The remaining weights then sum to less than 1 and the
 * skinning shader pulls those vertices toward the skeleton origin — the mesh
 * looks exploded. normalizeSkinWeights() is three's own fix; it is a no-op on
 * files whose weights already sum to 1.
 * @param {THREE.Object3D} object the parsed scene
 */
function normalizeSkinning(object) {
  object.traverse((node) => {
    if (node.isSkinnedMesh) node.normalizeSkinWeights();
  });
}

/**
 * Convert legacy Phong/Lambert/Basic-lit materials to MeshStandardMaterial.
 *
 * FBX has no PBR material in its base spec, so the loader falls back to
 * MeshPhongMaterial — which GLTFExporter cannot express ("Use
 * MeshStandardMaterial or MeshBasicMaterial for best results") and therefore
 * writes with default PBR values, losing the shading the viewport showed.
 * Converting here keeps what the formats share (colour, maps, emissive,
 * transparency) and maps Phong shininess onto roughness, so preview and
 * export agree.
 * @param {THREE.Object3D} object the parsed scene
 */
function toStandardMaterials(object) {
  const converted = new Map();

  /**
   * @param {THREE.Material} material
   * @returns {THREE.Material} the standard equivalent, or the input untouched
   */
  const convert = (material) => {
    if (!material || !material.isMeshPhongMaterial) return material;
    if (converted.has(material)) return converted.get(material);
    // Phong shininess (0..1000, log-ish) onto roughness (1..0).
    const shininess = typeof material.shininess === 'number' ? material.shininess : 30;
    const roughness = Math.min(1, Math.max(0, 1 - Math.log2(1 + shininess) / 10));
    const standard = new THREE.MeshStandardMaterial({
      name: material.name,
      color: material.color,
      map: material.map,
      normalMap: material.normalMap,
      normalScale: material.normalScale,
      bumpMap: material.bumpMap,
      bumpScale: material.bumpScale,
      alphaMap: material.alphaMap,
      aoMap: material.aoMap,
      emissive: material.emissive,
      emissiveMap: material.emissiveMap,
      emissiveIntensity: material.emissiveIntensity,
      transparent: material.transparent,
      opacity: material.opacity,
      alphaTest: material.alphaTest,
      side: material.side,
      vertexColors: material.vertexColors,
      flatShading: material.flatShading,
      roughness,
      metalness: 0,
    });
    converted.set(material, standard);
    return standard;
  };

  object.traverse((node) => {
    if (!node.isMesh) return;
    node.material = Array.isArray(node.material)
      ? node.material.map(convert)
      : convert(node.material);
  });
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
    case 'fbx': {
      const object = withBatchedWarnings(() => new FBXLoader().parse(buffer, ''));
      normalizeSkinning(object);
      toStandardMaterials(object);
      return object;
    }
    default:
      throw new Error('unsupported format: .' + ext);
  }
}

/**
 * Read a File into an ArrayBuffer with real byte progress.
 * @param {File} file the dropped/chosen file
 * @param {(fraction: number) => void} onProgress fraction of bytes read
 * @returns {Promise<ArrayBuffer>}
 */
async function readWithProgress(file, onProgress) {
  const reader = file.stream().getReader();
  const bytes = new Uint8Array(file.size);
  let offset = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes.set(value, offset);
    offset += value.length;
    onProgress(file.size ? offset / file.size : 1);
  }
  return bytes.buffer;
}

/**
 * Convert any accepted file to GLB bytes.
 * glTF inputs pass through untouched; everything else goes loader -> GLTFExporter.
 * @param {File} file the dropped/chosen file
 * @param {(fraction: number, label: string) => void} [onProgress] 0..1 within
 *   the conversion, with a short stage label
 * @returns {Promise<Uint8Array>} GLB bytes ready for the standard pipeline
 */
export async function toGLB(file, onProgress = () => {}) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  // Reading occupies the first stretch of the bar (real byte fractions).
  const buffer = await readWithProgress(file, (f) => onProgress(f * 0.4, 'reading'));
  if (ext === 'glb' || ext === 'gltf') {
    onProgress(1, 'read');
    return new Uint8Array(buffer);
  }

  onProgress(0.45, 'parsing');
  // usdz goes through the multi-layer walker (nested packages, usdc diagnosis).
  const object = ext === 'usdz' ? await parseMultiLayerUSDZ(buffer) : parseToObject(ext, buffer);
  onProgress(0.7, 'converting');
  const result = await new GLTFExporter().parseAsync(object, {
    binary: true,
    animations: object.animations || [],
  });
  onProgress(1, 'converted');
  return new Uint8Array(result);
}
