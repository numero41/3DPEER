// =============================================================================
// controls.js
//
// Optional in-artifact viewer controls, shipped only when the exporter sets
// __CFG.ui: camera view presets, a material override (original / clay /
// metallic / glass / matcap / wire), and lighting sliders (brightness + angle)
// layered over the studio environment. Everything is plain DOM with classes
// from page.css — no styles are set from JS (project invariant #6).
// =============================================================================

import * as THREE from 'three';

/** Unit view directions (from the orbit target) for the camera presets. */
const VIEWS = {
  front: [0, 0, 1],
  right: [1, 0, 0],
  top: [0, 1, 0],
  persp: [1, 0.55, 1],
};

/** Fixed elevation of the key light above the horizon (radians). */
const KEY_ELEVATION = Math.PI / 4;

/**
 * Bake a greyscale lit-sphere gradient for the matcap preset.
 * @returns {THREE.CanvasTexture}
 */
function makeMatcapTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(96, 96, 20, 128, 128, 150);
  grad.addColorStop(0, '#f5f5f5');
  grad.addColorStop(0.55, '#9a9a9a');
  grad.addColorStop(0.85, '#333333');
  grad.addColorStop(1, '#101010');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Build the control bar and wire it to the stage.
 * @param {ReturnType<import('./scene.js').createStage>} stage the artifact stage
 * @param {THREE.Object3D} root the loaded model root
 */
export function initViewerControls(stage, root) {
  const { scene, camera, controls } = stage;

  // ---------------------------------------------------------------------------
  // Lighting: hemisphere fill + one directional key, driven by two sliders
  // ---------------------------------------------------------------------------
  const fill = new THREE.HemisphereLight(0xffffff, 0x404040, 0);
  const key = new THREE.DirectionalLight(0xffffff, 0);
  scene.add(fill, key);

  let brightness = 0; // 0..2 — scales both lights
  let angleDeg = 35; // key-light azimuth

  /** Push slider values into the two lights. */
  function applyLighting() {
    fill.intensity = brightness * 0.8;
    key.intensity = brightness * 1.2;
    const azimuth = (angleDeg * Math.PI) / 180;
    key.position.set(
      Math.cos(azimuth) * Math.cos(KEY_ELEVATION),
      Math.sin(KEY_ELEVATION),
      Math.sin(azimuth) * Math.cos(KEY_ELEVATION),
    ).multiplyScalar(5);
  }
  applyLighting();

  // ---------------------------------------------------------------------------
  // Material override
  // ---------------------------------------------------------------------------
  const originals = new Map();
  root.traverse((o) => { if (o.isMesh) originals.set(o, o.material); });

  const PRESETS = {
    original: null,
    clay: new THREE.MeshStandardMaterial({ color: 0xb4b4b4, roughness: 0.9, metalness: 0 }),
    metallic: new THREE.MeshStandardMaterial({ color: 0xd4d4d4, roughness: 0.16, metalness: 1 }),
    // Alpha-based glass (not transmission): reads as actually transparent
    // over the flat artifact backdrop — same preset as the site.
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 0.05,
      transparent: true, opacity: 0.22, depthWrite: false,
    }),
    matcap: new THREE.MeshMatcapMaterial({ matcap: makeMatcapTexture() }),
    wire: new THREE.MeshBasicMaterial({ wireframe: true, color: 0xc9a978 }),
  };

  /**
   * Swap every mesh onto a preset, or back to its original material.
   * @param {keyof typeof PRESETS} name
   */
  function setMaterial(name) {
    const preset = PRESETS[name];
    for (const [mesh, original] of originals) {
      if (!preset) {
        mesh.material = original;
        continue;
      }
      const material = preset.clone();
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
    button.title = name + ' view';
    button.addEventListener('click', () => setView(name));
    bar.appendChild(button);
  }

  // material select
  const select = document.createElement('select');
  select.title = 'material';
  for (const name of Object.keys(PRESETS)) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }
  select.addEventListener('change', () => setMaterial(select.value));
  bar.appendChild(select);

  /**
   * Append one labelled range slider to the bar.
   * @param {string} title tooltip text
   * @param {{min: string, max: string, step: string, value: string}} attrs
   * @param {(value: number) => void} onInput
   */
  function addRange(title, attrs, onInput) {
    const range = document.createElement('input');
    range.type = 'range';
    range.title = title;
    Object.assign(range, attrs);
    range.addEventListener('input', () => onInput(parseFloat(range.value)));
    bar.appendChild(range);
  }

  addRange('brightness', { min: '0', max: '2', step: '0.05', value: '0' }, (v) => {
    brightness = v;
    applyLighting();
  });
  addRange('light angle', { min: '0', max: '360', step: '1', value: '35' }, (v) => {
    angleDeg = v;
    applyLighting();
  });

  document.body.appendChild(bar);
}
