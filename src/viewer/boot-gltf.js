// Gltf mode: optimized GLB -> paired GLTFLoader, morphs, animations.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { unenvelope } from './decode.js';
import { createStage, showError } from './scene.js';
import { collectMorphs, buildMorphPanel } from './morphs.js';

async function boot() {
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

  const clock = new THREE.Clock();
  stage.run(() => { if (mixer) mixer.update(clock.getDelta()); });
}
boot().catch(showError);
