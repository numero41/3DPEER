// Scene shared by both modes: renderer, studio lighting, controls, framing.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { visibleWorldBounds } from './bounds.js';

export function createStage() {
  const canvas = document.getElementById('c');
  const hint = document.getElementById('hint');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  // Same neutral page colour as the workbench stage (--bg in page.css).
  scene.background = new THREE.Color(0x1c1a16);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.autoRotate = true; controls.autoRotateSpeed = 0.9;
  controls.addEventListener('start', () => { controls.autoRotate = false; hint.classList.add('off'); });

  // Skinned-aware visible bounds: a quantized skinned avatar's plain
  // Box3.setFromObject collapses to the tiny bind-space box (framing the
  // camera on the feet); see src/viewer/bounds.js.
  function frameObject(object, elevation = 0.55) {
    const box = visibleWorldBounds(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = (maxDim / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))) * 1.35;
    camera.near = dist / 100; camera.far = dist * 100;
    camera.position.copy(center).add(new THREE.Vector3(1, elevation, 1).normalize().multiplyScalar(dist));
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.minDistance = dist * 0.15; controls.maxDistance = dist * 6;
    controls.update();
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize); resize();

  function run(onFrame) {
    hint.textContent = window.__CAPTION || '';
    let firstFrame = true;
    renderer.setAnimationLoop(() => {
      if (onFrame) onFrame();
      controls.update();
      renderer.render(scene, camera);
      // Drop the static poster only once real frames exist beneath it.
      if (firstFrame) {
        firstFrame = false;
        const poster = document.getElementById('poster');
        if (poster) poster.remove();
      }
    });
  }
  return { renderer, scene, camera, controls, hint, frameObject, run };
}

export function showError(e) {
  const hint = document.getElementById('hint');
  hint.textContent = 'error: ' + (e && e.message ? e.message : e);
}
