// Scène commune aux deux modes : renderer, éclairage studio, contrôles, cadrage.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export function createStage() {
  const canvas = document.getElementById('c');
  const hint = document.getElementById('hint');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x211a14);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.autoRotate = true; controls.autoRotateSpeed = 0.9;
  controls.addEventListener('start', () => { controls.autoRotate = false; hint.classList.add('off'); });

  function frameObject(object, elevation = 0.55) {
    const box = new THREE.Box3().setFromObject(object);
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
    renderer.setAnimationLoop(() => {
      if (onFrame) onFrame();
      controls.update();
      renderer.render(scene, camera);
    });
  }
  return { renderer, scene, camera, controls, hint, frameObject, run };
}

export function showError(e) {
  const hint = document.getElementById('hint');
  hint.textContent = 'erreur : ' + (e && e.message ? e.message : e);
}
