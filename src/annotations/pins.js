// =============================================================================
// pins.js
//
// Shared annotation pin layer, used by both the workbench (site) and the
// exported artifact. A pin is stored in model space (see codec/annotations.js)
// and rendered as a leader line + a tag sprite: a colour-coded number cell
// (rounded left corners, straight right) continued by the text label
// (straight left, rounded right) — one continuous shape.
//
// Everything is drawn inside WebGL — sprites and lines, with canvas-baked
// textures. No DOM element is positioned from JS, which keeps invariant #6
// (zero CSS in JS) intact on both surfaces; the canvas colours come from the
// palette passed by each side (site: monochrome, artifact: amber register)
// plus the shared per-pin colour presets below.
//
// Sprites use sizeAttenuation:false so pins keep a constant on-screen size at
// any orbit distance. Picking is done in screen space (projected pin heads),
// not with three's sprite raycaster — simpler and threshold-based.
//
// Pins are static in model space: skinned/animated deformation is not tracked
// (v0, same stance as the wireframe overlay). A pin remembers the index of
// the mesh it was placed on (pin.m) so it hides together with that mesh.
// =============================================================================

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** The five per-pin colour presets (identical on site and artifact — they are
 *  content, not chrome). Index 0 is the default. */
export const PIN_COLORS = ['#e8e6e3', '#d98b52', '#7fb069', '#6f9fd8', '#d76a6a'];

/** Sprite scale (height) of the tag (NDC-relative, fov 45): ~28 px at 800 px. */
const TAG_SCALE = 0.029;

/** Leader-line length as a fraction of the model's bounding radius. */
const LEADER_FRACTION = 0.14;

/** Label text is truncated to this many characters (full text lives in the panel). */
const LABEL_MAX_CHARS = 26;

/** Render-order block that keeps pins above the model (depth test is off). */
const ORDER_LINE = 9990;
const ORDER_TAG = 9991;

// ---------------------------------------------------------------------------
// Canvas-baked tag texture
// ---------------------------------------------------------------------------

/**
 * Bake the tag for one pin: [ number cell | label ] as one continuous shape —
 * number cell rounded on the left only, label rounded on the right only.
 * With no text, the number cell is drawn alone.
 * @param {number} number 1-based pin number
 * @param {string} text label text (already truncated by the caller; may be '')
 * @param {string} color the pin's preset colour (number cell fill)
 * @param {{tagText: string, labelBg: string, labelLine: string,
 *          labelText: string}} palette surface colours
 * @returns {{texture: THREE.CanvasTexture, aspect: number}} texture + w/h ratio
 */
function makeTagTexture(number, text, color, palette) {
  const HEIGHT = 44;
  const RADIUS = 12;
  const PAD_X = 12;
  const FONT_NUM = '700 24px system-ui, -apple-system, sans-serif';
  const FONT_TEXT = '500 22px system-ui, -apple-system, sans-serif';
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = FONT_TEXT;
  const badgeW = HEIGHT;
  const labelW = text ? Math.ceil(probe.measureText(text).width) + PAD_X * 2 : 0;

  const canvas = document.createElement('canvas');
  canvas.width = badgeW + labelW;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');

  // number cell: rounded left corners, straight right
  ctx.beginPath();
  ctx.roundRect(0, 0, badgeW, HEIGHT, [RADIUS, 0, 0, RADIUS]);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = palette.tagText;
  ctx.font = FONT_NUM;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), badgeW / 2, HEIGHT / 2 + 2);

  // label: straight left, rounded right — visually continues the cell
  if (text) {
    ctx.beginPath();
    ctx.roundRect(badgeW, 1, labelW - 1, HEIGHT - 2, [0, RADIUS, RADIUS, 0]);
    ctx.fillStyle = palette.labelBg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = palette.labelLine;
    ctx.stroke();
    ctx.fillStyle = palette.labelText;
    ctx.font = FONT_TEXT;
    ctx.textAlign = 'left';
    ctx.fillText(text, badgeW + PAD_X, HEIGHT / 2 + 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: canvas.width / HEIGHT };
}

// ---------------------------------------------------------------------------
// Pin layer
// ---------------------------------------------------------------------------

/**
 * Create the pin layer for one loaded model.
 * @param {THREE.Scene} scene the stage scene the layer draws into
 * @param {THREE.Object3D} root the model root — pins are stored in its local
 *   frame, picking raycasts against it
 * @param {{tagText: string, line: string, labelBg: string, labelLine: string,
 *          labelText: string}} palette canvas/material colours for this
 *   surface (site vs artifact register)
 * @returns {{
 *   setPins: (list: Array<{p: number[], n: number[], text: string,
 *             c?: number, m?: number}>) => void,
 *   pickPin: (event: {clientX: number, clientY: number}, camera: THREE.Camera,
 *             dom: HTMLElement) => number,
 *   pickSurface: (event: {clientX: number, clientY: number}, camera: THREE.Camera,
 *                 dom: HTMLElement) => {p: number[], n: number[], m: number} | null,
 *   dispose: () => void,
 * }}
 */
export function createPinLayer(scene, root, palette) {
  const group = new THREE.Group();
  scene.add(group);

  // Leader length derives from the model size so pins read the same on a
  // 2 cm part and a 20 m building.
  const bounds = new THREE.Box3().setFromObject(root);
  const radius = bounds.getSize(new THREE.Vector3()).length() * 0.5 || 1;
  const leader = radius * LEADER_FRACTION;

  // Mesh enumeration in traversal order — the identity pins refer to (pin.m).
  const meshes = [];
  root.traverse((o) => { if (o.isMesh) meshes.push(o); });

  /** Projected pin heads (world space), kept for screen-space picking; the
   *  entry is null for pins hidden with their mesh. */
  let heads = [];
  /** Disposable GPU resources created by the last setPins call. */
  let resources = [];
  const raycaster = new THREE.Raycaster();

  /**
   * Whether a pin should be shown (its mesh, when known, must be visible).
   * @param {{m?: number}} pin
   * @returns {boolean}
   */
  function pinVisible(pin) {
    if (pin.m == null || !meshes[pin.m]) return true;
    return meshes[pin.m].visible;
  }

  /** Drop every object and GPU resource the layer currently holds. */
  function clear() {
    for (const child of [...group.children]) group.remove(child);
    for (const resource of resources) resource.dispose();
    resources = [];
    heads = [];
  }

  /**
   * Rebuild the layer from a pin list (cheap: pins are few, textures small).
   * @param {Array<{p: number[], n: number[], text: string, c?: number, m?: number}>} list
   */
  function setPins(list) {
    clear();
    list.forEach((pin, i) => {
      if (!pinVisible(pin)) {
        heads.push(null);
        return;
      }
      const anchor = root.localToWorld(new THREE.Vector3(...pin.p));
      const normal = new THREE.Vector3(...pin.n).transformDirection(root.matrixWorld);
      const head = anchor.clone().add(normal.multiplyScalar(leader));
      heads.push(head);

      const lineGeometry = new THREE.BufferGeometry().setFromPoints([anchor, head]);
      const lineMaterial = new THREE.LineBasicMaterial({
        color: palette.line, depthTest: false, transparent: true, opacity: 0.9,
      });
      const line = new THREE.Line(lineGeometry, lineMaterial);
      line.renderOrder = ORDER_LINE;
      resources.push(lineGeometry, lineMaterial);
      group.add(line);

      const text = (pin.text || '').trim();
      const short = text.length > LABEL_MAX_CHARS ? text.slice(0, LABEL_MAX_CHARS) + '…' : text;
      const color = PIN_COLORS[pin.c] || PIN_COLORS[0];
      const tag = makeTagTexture(i + 1, short, color, palette);
      const tagMaterial = new THREE.SpriteMaterial({
        map: tag.texture, sizeAttenuation: false, depthTest: false, transparent: true,
      });
      const sprite = new THREE.Sprite(tagMaterial);
      sprite.position.copy(head);
      sprite.center.set(0, 0.5);
      sprite.scale.set(TAG_SCALE * tag.aspect, TAG_SCALE, 1);
      sprite.renderOrder = ORDER_TAG;
      resources.push(tag.texture, tagMaterial);
      group.add(sprite);
    });
  }

  /**
   * Screen-space hit test against the pin heads (the tag's number cell).
   * @param {{clientX: number, clientY: number}} event a pointer event
   * @param {THREE.Camera} camera the stage camera
   * @param {HTMLElement} dom the render canvas (for rect + size)
   * @returns {number} index of the closest pin within reach, or -1
   */
  function pickPin(event, camera, dom) {
    // Picking must not depend on a frame having rendered since the last
    // camera move (rAF is paused in background/preview tabs); Camera's
    // override also refreshes matrixWorldInverse for project().
    camera.updateMatrixWorld();
    const rect = dom.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    // Tag height in px for the current viewport, with a comfortable margin.
    const tagPx = (TAG_SCALE / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * rect.height * 0.5;
    const reach = Math.max(14, tagPx * 0.8);
    let best = -1;
    let bestDistance = Infinity;
    const projected = new THREE.Vector3();
    heads.forEach((head, i) => {
      if (!head) return;
      projected.copy(head).project(camera);
      if (projected.z > 1) return;
      const sx = (projected.x + 1) / 2 * rect.width;
      const sy = (1 - projected.y) / 2 * rect.height;
      const distance = Math.hypot(sx - x, sy - y);
      if (distance < reach && distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    return best;
  }

  /**
   * Raycast the model surface under the pointer.
   * @param {{clientX: number, clientY: number}} event a pointer event
   * @param {THREE.Camera} camera the stage camera
   * @param {HTMLElement} dom the render canvas (for rect)
   * @returns {{p: number[], n: number[], m: number} | null} model-space hit
   *   (position, outward normal, mesh index), or null
   */
  function pickSurface(event, camera, dom) {
    // Same rationale as pickPin: refresh the camera matrices before casting.
    camera.updateMatrixWorld();
    const rect = dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(root, true)
      .find((h) => h.object.isMesh && h.object.visible);
    if (!hit) return null;
    const p = root.worldToLocal(hit.point.clone());
    const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const toCamera = camera.getWorldDirection(new THREE.Vector3()).negate();
    let n;
    if (hit.face) {
      n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      // Geometric normals follow the winding; on flipped or double-sided
      // faces they can point into the surface — keep the leader on the
      // viewer's side.
      if (n.dot(toCamera) < 0) n.negate();
    } else {
      n = toCamera.clone();
    }
    n.transformDirection(inverse);
    return { p: [p.x, p.y, p.z], n: [n.x, n.y, n.z], m: meshes.indexOf(hit.object) };
  }

  /** Remove the layer from the scene and free every GPU resource. */
  function dispose() {
    clear();
    scene.remove(group);
  }

  return { setPins, pickPin, pickSurface, dispose };
}
