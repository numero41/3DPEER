// Gltf mode: optimized GLB -> paired GLTFLoader, morphs, animations.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { unenvelope } from './decode.js';
import { createStage, showError } from './scene.js';
import { collectMorphs, buildMorphPanel } from './morphs.js';
import { initViewerControls } from './controls.js';
import { capturePristine, initAnnotations } from './annotate.js';

async function boot() {
  // Pristine self-copy for the annotation save path — captured before any
  // DOM mutation (the very next line already edits the hint).
  const pristine = capturePristine();
  // Scripts are running: replace the static "your app blocks scripts" fallback.
  document.getElementById('hint').textContent = 'loading…';

  const u8 = await unenvelope(window.__P);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await new Promise((ok, ko) => loader.parse(u8.buffer, '', ok, ko));

  const stage = createStage();
  stage.scene.add(gltf.scene);
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh) o.frustumCulled = false; });
  stage.frameObject(gltf.scene, 0.35);

  let mixer = null;
  if (gltf.animations && gltf.animations.length) {
    mixer = new THREE.AnimationMixer(gltf.scene);
    gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
  }
  buildMorphPanel(collectMorphs(gltf.scene));
  if (window.__CFG && window.__CFG.ui) initViewerControls(stage, gltf.scene);
  initAnnotations(stage, gltf.scene, pristine);

  const clock = new THREE.Clock();
  stage.run(() => { if (mixer) mixer.update(clock.getDelta()); });
}
boot().catch(showError);
