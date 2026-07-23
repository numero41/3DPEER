// stage.js — the workbench 3D stage: renderer, studio environment, camera and
// orbit controls, plus framing/resize helpers. This is the site-side twin of
// src/viewer/scene.js (the artifact's stage); kept separate because the
// workbench has no auto-rotate and drives its own animation loop.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { $ } from './dom.js';

/**
 * Build the renderer/scene/camera/controls bound to the #viewport canvas.
 * @returns {{
 *   canvas: HTMLCanvasElement,
 *   renderer: THREE.WebGLRenderer,
 *   scene: THREE.Scene,
 *   camera: THREE.PerspectiveCamera,
 *   controls: OrbitControls,
 *   resize: () => void,
 *   frameObject: (object: THREE.Object3D) => void,
 * }}
 */
export function createStage() {
  const canvas = $('viewport');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x262626); // neutral grey studio backdrop
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  /** Match the drawing buffer + camera aspect to the canvas's CSS box. */
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);

  /**
   * Frame the camera so `object` fills the view, and record its centre +
   * orbit distance in the shared state (via the caller) for the view presets.
   * @param {THREE.Object3D} object
   */
  function frameObject(object) {
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = (maxDim / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))) * 1.4;
    camera.near = dist / 100;
    camera.far = dist * 100;
    camera.position.copy(center).add(new THREE.Vector3(1, 0.5, 1).normalize().multiplyScalar(dist));
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.minDistance = dist * 0.1;
    controls.maxDistance = dist * 8;
    controls.update();
    return { center, dist };
  }

  return { canvas, renderer, scene, camera, controls, resize, frameObject };
}
