// loader.js — drag-drop / file-input handling and GLB parsing.
//
// Parses .glb/.gltf with the meshopt-enabled GLTFLoader, disposes any previous
// model, populates state + panels, frames the camera, and applies the current
// display mode. Geometry is never modified here (invariant #10).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { state, resetState } from './state.js';
import { buildPanels } from './panels.js';
import { applyDisplayMode, currentMode } from './display-modes.js';
import { setStatus } from './ui.js';

/** Remove the current model from the scene and free its GPU resources. */
function disposeCurrent(stage) {
  if (!state.root) return;
  stage.scene.remove(state.root);
  state.root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
  resetState();
}

/**
 * Load a user-provided file into the stage.
 * @param {ReturnType<import('./stage.js').createStage>} stage
 * @param {File} file
 */
async function loadFile(stage, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  let gltf;
  try {
    gltf = await new Promise((ok, ko) => loader.parse(bytes.buffer.slice(0), '', ok, ko));
  } catch (e) {
    setStatus('parse error: ' + (e.message || e));
    return;
  }

  disposeCurrent(stage);
  state.root = gltf.scene;
  state.glbBytes = bytes;
  state.name = file.name.replace(/\.(glb|gltf)$/i, '');
  stage.scene.add(gltf.scene);
  gltf.scene.traverse((o) => {
    if (o.isSkinnedMesh) o.frustumCulled = false;
    if (o.isMesh) state.originals.set(o, o.material);
  });

  const framed = stage.frameObject(gltf.scene);
  state.center.copy(framed.center);
  state.dist = framed.dist;

  if (gltf.animations && gltf.animations.length) {
    state.mixer = new THREE.AnimationMixer(gltf.scene);
    state.actions = gltf.animations.map((clip) => ({ clip, action: state.mixer.clipAction(clip) }));
  }

  buildPanels(gltf);
  document.body.classList.add('loaded');
  setStatus(`${state.name} — ${(bytes.length / 1e6).toFixed(2)} MB loaded, processed locally`);
  applyDisplayMode(currentMode());
}

/**
 * Wire drag-drop on the window and the file input.
 * @param {ReturnType<import('./stage.js').createStage>} stage
 */
export function initLoader(stage) {
  ['dragover', 'drop'].forEach((ev) => addEventListener(ev, (e) => e.preventDefault()));
  addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(stage, f);
  });
  document.getElementById('file-input').addEventListener('change', (e) => {
    if (e.target.files[0]) loadFile(stage, e.target.files[0]);
  });
}
