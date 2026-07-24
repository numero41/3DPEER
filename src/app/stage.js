// stage.js — the workbench 3D stage: renderer, studio environment, camera and
// orbit controls, plus framing/resize helpers and the quad-view render path
// (top / front / right / perspective in one scissored canvas). This is the
// site-side twin of src/viewer/scene.js (the artifact's stage); kept separate
// because the workbench has no auto-rotate and drives its own animation loop.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { visibleWorldBounds } from '../viewer/bounds.js';
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
  // Transparent canvas: the backdrop is the CSS --stage-bg token on #viewport.
  // A GL clear colour would pass through ACES tone mapping, which tints a
  // neutral grey visibly greenish; the CSS backdrop stays exact.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // ---------------------------------------------------------------------------
  // Quad view: three fixed axis cameras + the orbiting perspective camera,
  // rendered into the four quadrants with scissor testing. The orbit camera
  // keeps working (bottom-right pane).
  // ---------------------------------------------------------------------------
  let quad = false;

  /** Fixed axis panes: name -> unit view direction from the model centre. */
  const AXIS_PANES = [
    { label: 'top', direction: [0, 1, 0] },
    { label: 'front', direction: [0, 0, 1] },
    { label: 'right', direction: [1, 0, 0] },
  ];
  // The side/front/top panes are true orthographic technical views.
  const axisCameras = AXIS_PANES.map(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100));

  // Each axis pane has its own controls: left-click PANS, wheel zooms, no
  // rotate (the view stays axis-aligned). Enabled only while the pointer is
  // over that pane.
  const axisControls = axisCameras.map((axisCamera) => {
    const c = new OrbitControls(axisCamera, canvas);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.enableRotate = false;
    c.screenSpacePanning = true;
    c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    c.enabled = false;
    return c;
  });

  /** Model framing remembered so a resize can re-derive the ortho frustum. */
  let framedCenter = new THREE.Vector3();
  let framedDist = 4;

  /** Half the ortho view height at the framing distance (fov-matched). */
  function orthoHalfHeight(dist) {
    return dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  }

  /** Size the axis cameras' ortho frustums to the current aspect + framing. */
  function resizeAxisCameras() {
    const halfH = orthoHalfHeight(framedDist);
    const halfW = halfH * camera.aspect;
    axisCameras.forEach((axisCamera) => {
      axisCamera.left = -halfW;
      axisCamera.right = halfW;
      axisCamera.top = halfH;
      axisCamera.bottom = -halfH;
      axisCamera.updateProjectionMatrix();
    });
  }

  /**
   * Point the axis cameras at the framed model (called by frameObject).
   * @param {THREE.Vector3} center model centre
   * @param {number} dist framing distance
   */
  function updateAxisCameras(center, dist) {
    framedCenter.copy(center);
    framedDist = dist;
    axisCameras.forEach((axisCamera, i) => {
      const direction = new THREE.Vector3(...AXIS_PANES[i].direction);
      axisCamera.near = dist / 100;
      axisCamera.far = dist * 100;
      axisCamera.up.set(0, 1, 0);
      if (AXIS_PANES[i].label === 'top') axisCamera.up.set(0, 0, -1);
      axisCamera.position.copy(center).add(direction.multiplyScalar(dist));
      axisCamera.lookAt(center);
      axisControls[i].target.copy(center);
      axisControls[i].update();
    });
    resizeAxisCameras();
  }

  /**
   * Enable only the controls for the pane under the pointer. In single view
   * the perspective controls are always active.
   * @param {number} [clientX]
   * @param {number} [clientY]
   */
  function routeControls(clientX, clientY) {
    if (!quad || clientX === undefined) {
      controls.enabled = true;
      axisControls.forEach((c) => { c.enabled = false; });
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const left = clientX - rect.left < rect.width / 2;
    const top = clientY - rect.top < rect.height / 2;
    // Panes: TL top, TR front, BL right, BR perspective (the orbit camera).
    let active = controls;
    if (top && left) active = axisControls[0];
    else if (top && !left) active = axisControls[1];
    else if (!top && left) active = axisControls[2];
    controls.enabled = active === controls;
    axisControls.forEach((c) => { c.enabled = c === active; });
  }
  canvas.addEventListener('pointermove', (event) => routeControls(event.clientX, event.clientY));

  /**
   * Turn quad view on or off.
   * @param {boolean} on
   */
  function setQuad(on) {
    quad = on;
    routeControls();
  }

  /** @returns {boolean} whether quad view is active */
  function isQuad() {
    return quad;
  }

  /** Advance damping on the active controls (called once per frame). */
  function update() {
    controls.update();
    if (quad) axisControls.forEach((c) => c.update());
  }

  /**
   * Draw the current frame: one full-canvas perspective view, or the four
   * scissored panes (TL top, TR front, BL right, BR perspective).
   */
  function render() {
    if (!quad) {
      renderer.render(scene, camera);
      return;
    }
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const halfW = w / 2, halfH = h / 2;
    const panes = [
      { cam: axisCameras[0], x: 0, y: halfH },      // top-left: top view
      { cam: axisCameras[1], x: halfW, y: halfH },  // top-right: front view
      { cam: axisCameras[2], x: 0, y: 0 },          // bottom-left: right view
      { cam: camera, x: halfW, y: 0 },              // bottom-right: orbit
    ];
    renderer.setScissorTest(true);
    for (const pane of panes) {
      renderer.setViewport(pane.x, pane.y, halfW, halfH);
      renderer.setScissor(pane.x, pane.y, halfW, halfH);
      renderer.render(scene, pane.cam);
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
  }

  /** Match the drawing buffer + camera aspect to the canvas's CSS box. Each
   *  quad pane shares the canvas aspect (half width × half height). */
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    resizeAxisCameras();
  }
  addEventListener('resize', resize);

  /**
   * Frame the camera so `object` fills the view, and record its centre +
   * orbit distance in the shared state (via the caller) for the view presets.
   * Bounds come from the shared visible-geometry helper (hidden USD
   * proxy/guide prims excluded, skinned deformation followed) so the site
   * and the artifact frame identically.
   * @param {THREE.Object3D} object
   */
  function frameObject(object) {
    const box = visibleWorldBounds(object);
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
    updateAxisCameras(center, dist);
    return { center, dist };
  }

  return { canvas, renderer, scene, camera, controls, resize, frameObject, render, update, setQuad, isQuad };
}
