// loader.js — drag-drop / file-input handling and model parsing.
//
// Non-glTF formats are first converted to GLB by importers.js, so one path
// (the meshopt-enabled GLTFLoader) serves every input. Disposes any previous
// model, populates state + panels, frames the camera, and applies the current
// display mode. Geometry is never modified here (invariant #10).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { state, resetState } from './state.js';
import { buildPanels } from './panels.js';
import { reapplyMaterial } from './materials.js';
import { toGLB } from './importers.js';
import { scheduleEstimate } from './exporter.js';
import { resetDecimatePreview } from './decimate-preview.js';
import { resetCompare } from './compare.js';
import { setStatus, progress } from './ui.js';

/** Files above this size get an honest heads-up before conversion starts:
 *  browser tabs have a hard memory ceiling and a source this large can hit
 *  it while the format's own loader unpacks it. */
const LARGE_FILE_BYTES = 150e6;

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
  // Convert whatever was dropped to GLB (a pass-through for .glb/.gltf).
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (file.size > LARGE_FILE_BYTES && ext !== 'glb' && ext !== 'gltf') {
    setStatus(`Large ${ext} file (${(file.size / 1e6).toFixed(0)} MB). Conversion may take some time, and files this size can exceed what a browser tab can hold. A .glb export is the most reliable route at this scale`, 'warn');
  } else {
    setStatus(ext !== 'glb' && ext !== 'gltf' ? 'Converting…' : 'Loading…');
  }
  progress.start();
  let bytes;
  try {
    // Conversion occupies 0..0.85 of the bar (read fractions are real bytes).
    bytes = await toGLB(file, (f, label) => progress.set(f * 0.85, label));
  } catch (e) {
    progress.hide();
    setStatus('This file could not be imported', 'error');
    return;
  }

  progress.set(0.9, 'opening');
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  let gltf;
  try {
    gltf = await new Promise((ok, ko) => loader.parse(bytes.buffer.slice(0), '', ok, ko));
  } catch (e) {
    progress.hide();
    setStatus('This file could not be read', 'error');
    return;
  }
  progress.set(1);
  setTimeout(() => progress.hide(), 800);

  // Some importers (notably USDZ variants three cannot fully read) return an
  // empty scene: refuse it clearly instead of showing a blank viewport.
  let meshCount = 0;
  gltf.scene.traverse((o) => { if (o.isMesh) meshCount++; });
  if (!meshCount) {
    progress.hide();
    setStatus(`No geometry was found in ${file.name}. This variant of the format is not supported yet`, 'error');
    return;
  }

  resetCompare();
  disposeCurrent(stage);
  resetDecimatePreview();
  state.root = gltf.scene;
  state.glbBytes = bytes;
  state.name = file.name.replace(/\.(glb|gltf|obj|stl|ply|fbx|usdz)$/i, '');
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
  setStatus(`${state.name} · ${(file.size / 1e6).toFixed(2)} MB loaded, processed locally`, 'ok');
  reapplyMaterial();
  scheduleEstimate(0);
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
