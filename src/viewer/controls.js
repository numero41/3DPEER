// =============================================================================
// controls.js
//
// Optional in-artifact viewer controls, shipped only when the exporter sets
// __CFG.ui: camera view presets, a material override (original / clay / wire)
// and a lighting slider. Everything is plain DOM with classes from page.css —
// no styles are set from JS (project invariant #6).
// =============================================================================

import * as THREE from 'three';

/** Unit view directions (from the orbit target) for the camera presets. */
const VIEWS = {
  front: [0, 0, 1],
  right: [1, 0, 0],
  top: [0, 1, 0],
  persp: [1, 0.55, 1],
};

/**
 * Build the control bar and wire it to the stage.
 * @param {ReturnType<import('./scene.js').createStage>} stage the artifact stage
 * @param {THREE.Object3D} root the loaded model root
 */
export function initViewerControls(stage, root) {
  const { scene, camera, controls } = stage;

  // ---------------------------------------------------------------------------
  // Lighting: a hemisphere fill on a slider, on top of the environment map
  // ---------------------------------------------------------------------------
  const fill = new THREE.HemisphereLight(0xffffff, 0x404040, 0);
  scene.add(fill);

  // ---------------------------------------------------------------------------
  // Material override
  // ---------------------------------------------------------------------------
  const originals = new Map();
  root.traverse((o) => { if (o.isMesh) originals.set(o, o.material); });

  const clayMat = new THREE.MeshStandardMaterial({ color: 0xb4b4b4, roughness: 0.9, metalness: 0 });
  const wireMat = new THREE.MeshBasicMaterial({ wireframe: true, color: 0xc9a978 });

  /**
   * Swap every mesh onto a preset, or back to its original material.
   * @param {'original'|'clay'|'wire'} name
   */
  function setMaterial(name) {
    for (const [mesh, original] of originals) {
      if (name === 'original') {
        mesh.material = original;
        continue;
      }
      const material = (name === 'clay' ? clayMat : wireMat).clone();
      material.morphTargets = original && original.morphTargets;
      mesh.material = material;
    }
  }

  // ---------------------------------------------------------------------------
  // Camera view presets (keep the current orbit distance, move the eye)
  // ---------------------------------------------------------------------------

  /**
   * Move the camera to a named view around the current orbit target.
   * @param {keyof typeof VIEWS} name
   */
  function setView(name) {
    const direction = VIEWS[name];
    const distance = camera.position.distanceTo(controls.target);
    camera.position.copy(controls.target)
      .add(new THREE.Vector3(...direction).normalize().multiplyScalar(distance));
    camera.updateProjectionMatrix();
    controls.update();
  }

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  const bar = document.createElement('div');
  bar.id = 'vbar';

  // view preset buttons
  for (const name of Object.keys(VIEWS)) {
    const button = document.createElement('button');
    button.textContent = name;
    button.addEventListener('click', () => setView(name));
    bar.appendChild(button);
  }

  // material select
  const select = document.createElement('select');
  for (const name of ['original', 'clay', 'wire']) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }
  select.addEventListener('change', () => setMaterial(select.value));
  bar.appendChild(select);

  // light slider
  const light = document.createElement('input');
  light.type = 'range';
  light.min = '0';
  light.max = '2';
  light.step = '0.05';
  light.value = '0';
  light.title = 'light';
  light.addEventListener('input', () => { fill.intensity = parseFloat(light.value); });
  bar.appendChild(light);

  document.body.appendChild(bar);
}
