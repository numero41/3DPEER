// =============================================================================
// pins.js
//
// Shared annotation pin layer, used by both the workbench (site) and the
// exported artifact. A pin is stored in model space (see codec/annotations.js)
// and rendered as a numbered dot + leader line + text label.
//
// Everything is drawn inside WebGL — sprites and lines, with canvas-baked
// textures for the badge and the label. No DOM element is positioned from JS,
// which keeps invariant #6 (zero CSS in JS) intact on both surfaces; the
// canvas colours come from the palette passed by each side (site: monochrome,
// artifact: amber register).
//
// Sprites use sizeAttenuation:false so pins keep a constant on-screen size at
// any orbit distance. Picking is done in screen space (projected pin heads),
// not with three's sprite raycaster — simpler and threshold-based.
//
// Pins are static in model space: skinned/animated deformation is not tracked
// (v0, same stance as the wireframe overlay).
// =============================================================================

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Sizing constants
// ---------------------------------------------------------------------------

/** Sprite scale of the numbered dot (NDC-relative, fov 45): ~32 px at 800 px. */
const DOT_SCALE = 0.033;

/** Sprite scale (height) of the text label: ~25 px at 800 px. */
const LABEL_SCALE = 0.026;

/** Leader-line length as a fraction of the model's bounding radius. */
const LEADER_FRACTION = 0.14;

/** Label text is truncated to this many characters (full text lives in the panel). */
const LABEL_MAX_CHARS = 26;

/** Render-order block that keeps pins above the model (depth test is off). */
const ORDER_LINE = 9990;
const ORDER_DOT = 9991;
const ORDER_LABEL = 9992;

// ---------------------------------------------------------------------------
// Canvas-baked textures
// ---------------------------------------------------------------------------

/**
 * Bake the numbered round badge for one pin.
 * @param {number} number 1-based pin number
 * @param {{dot: string, dotText: string}} palette canvas fill colours
 * @returns {THREE.CanvasTexture}
 */
function makeDotTexture(number, palette) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fillStyle = palette.dot;
  ctx.fill();
  ctx.fillStyle = palette.dotText;
  ctx.font = '700 32px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), 32, 35);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Bake the rounded-rect text label for one pin.
 * @param {string} text label text (already truncated by the caller)
 * @param {{labelBg: string, labelLine: string, labelText: string}} palette
 * @returns {{texture: THREE.CanvasTexture, aspect: number}} texture + w/h ratio
 */
function makeLabelTexture(text, palette) {
  const HEIGHT = 44;
  const PAD_X = 14;
  const FONT = '500 22px system-ui, -apple-system, sans-serif';
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = FONT;
  const width = Math.ceil(probe.measureText(text).width) + PAD_X * 2;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.roundRect(1, 1, width - 2, HEIGHT - 2, 10);
  ctx.fillStyle = palette.labelBg;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = palette.labelLine;
  ctx.stroke();
  ctx.fillStyle = palette.labelText;
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, PAD_X, HEIGHT / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: width / HEIGHT };
}

// ---------------------------------------------------------------------------
// Pin layer
// ---------------------------------------------------------------------------

/**
 * Create the pin layer for one loaded model.
 * @param {THREE.Scene} scene the stage scene the layer draws into
 * @param {THREE.Object3D} root the model root — pins are stored in its local
 *   frame, picking raycasts against it
 * @param {{dot: string, dotText: string, line: string,
 *          labelBg: string, labelLine: string, labelText: string}} palette
 *   canvas/material colours for this surface (site vs artifact register)
 * @returns {{
 *   setPins: (list: Array<{p: number[], n: number[], text: string}>) => void,
 *   pickPin: (event: {clientX: number, clientY: number}, camera: THREE.Camera,
 *             dom: HTMLElement) => number,
 *   pickSurface: (event: {clientX: number, clientY: number}, camera: THREE.Camera,
 *                 dom: HTMLElement) => {p: number[], n: number[]} | null,
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

  /** Projected pin heads (world space), kept for screen-space picking. */
  let heads = [];
  /** Disposable GPU resources created by the last setPins call. */
  let resources = [];
  const raycaster = new THREE.Raycaster();

  /** Drop every object and GPU resource the layer currently holds. */
  function clear() {
    for (const child of [...group.children]) group.remove(child);
    for (const resource of resources) resource.dispose();
    resources = [];
    heads = [];
  }

  /**
   * Rebuild the layer from a pin list (cheap: pins are few, textures small).
   * @param {Array<{p: number[], n: number[], text: string}>} list
   */
  function setPins(list) {
    clear();
    list.forEach((pin, i) => {
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

      const dotTexture = makeDotTexture(i + 1, palette);
      const dotMaterial = new THREE.SpriteMaterial({
        map: dotTexture, sizeAttenuation: false, depthTest: false, transparent: true,
      });
      const dot = new THREE.Sprite(dotMaterial);
      dot.position.copy(head);
      dot.scale.set(DOT_SCALE, DOT_SCALE, 1);
      dot.renderOrder = ORDER_DOT;
      resources.push(dotTexture, dotMaterial);
      group.add(dot);

      const text = (pin.text || '').trim();
      if (text) {
        const short = text.length > LABEL_MAX_CHARS ? text.slice(0, LABEL_MAX_CHARS) + '…' : text;
        const label = makeLabelTexture(short, palette);
        const labelMaterial = new THREE.SpriteMaterial({
          map: label.texture, sizeAttenuation: false, depthTest: false, transparent: true,
        });
        const sprite = new THREE.Sprite(labelMaterial);
        sprite.position.copy(head);
        sprite.center.set(-0.18, 0.5);
        sprite.scale.set(LABEL_SCALE * label.aspect, LABEL_SCALE, 1);
        sprite.renderOrder = ORDER_LABEL;
        resources.push(label.texture, labelMaterial);
        group.add(sprite);
      }
    });
  }

  /**
   * Screen-space hit test against the pin heads.
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
    // Dot radius in px for the current viewport, with a comfortable margin.
    const dotPx = (DOT_SCALE / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * rect.height * 0.5;
    const reach = Math.max(14, dotPx * 0.75);
    let best = -1;
    let bestDistance = Infinity;
    const projected = new THREE.Vector3();
    heads.forEach((head, i) => {
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
   * @returns {{p: number[], n: number[]} | null} model-space hit, or null
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
    return { p: [p.x, p.y, p.z], n: [n.x, n.y, n.z] };
  }

  /** Remove the layer from the scene and free every GPU resource. */
  function dispose() {
    clear();
    scene.remove(group);
  }

  return { setPins, pickPin, pickSurface, dispose };
}
