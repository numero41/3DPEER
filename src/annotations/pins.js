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
// Pins FOLLOW deformation (skinning + morphs): the stored format stays a
// model-space point + normal, and each surface derives a live attachment —
// nearest triangle + barycentric coordinates — by projecting that point onto
// the current mesh at build time. Every frame the anchor is recomputed from
// the deformed triangle (getVertexPosition applies bones and morphs), so the
// pin rides the surface. Deriving the attachment per surface (instead of
// storing it) matters: the artifact's compressed mesh has different topology
// than the site's original, so face indices could never travel in the file.
// A pin remembers the index of the mesh it was placed on (pin.m) so it hides
// together with that mesh.
// =============================================================================

import * as THREE from 'three';
import { visibleWorldBounds } from '../viewer/bounds.js';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** The per-pin colour presets (identical on site and artifact — they are
 *  content, not chrome; mirrored as --pin-cN CSS tokens on both surfaces).
 *  Index 0 is the default. */
export const PIN_COLORS = [
  '#e8e6e3', '#d98b52', '#7fb069', '#6f9fd8', '#d76a6a',
  '#6fc7c0', '#a58fd8', '#d8c46f', '#b08968', '#8a8a8f',
];

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
 *   update: () => void,
 *   pickPin: (event: {clientX: number, clientY: number}, camera: THREE.Camera,
 *             dom: HTMLElement) => number,
 *   pickSurface: (event: {clientX: number, clientY: number}, camera: THREE.Camera,
 *                 dom: HTMLElement) => {p: number[], n: number[], m: number} | null,
 *   setVisible: (visible: boolean) => void,
 *   dispose: () => void,
 * }}
 */
export function createPinLayer(scene, root, palette) {
  const group = new THREE.Group();
  scene.add(group);

  // Leader length derives from the model size so pins read the same on a
  // 2 cm part and a 20 m building. Visible + skinned-aware bounds: the same
  // implementation runs on the site and in the artifact, so leader lengths
  // match on both surfaces (plain setFromObject collapses on the artifact's
  // quantized skinned meshes).
  const bounds = visibleWorldBounds(root);
  const radius = bounds.getSize(new THREE.Vector3()).length() * 0.5 || 1;
  const leader = radius * LEADER_FRACTION;

  // Mesh enumeration in traversal order — the identity pins refer to (pin.m).
  const meshes = [];
  root.traverse((o) => { if (o.isMesh) meshes.push(o); });

  /** Per-pin picking data ({head, aspect}, world space + tag proportions);
   *  the entry is null for pins hidden with their mesh. */
  let tags = [];
  /** Per-pin live surface attachment for deformation tracking:
   *  { mesh, i0, i1, i2, bary, n0, line, sprite, anchor, head } or null for
   *  pins without a surface to ride (they stay static). */
  let attachments = [];
  /** Whether any attachment can actually move (skinning or morphs). */
  let deforms = false;
  /** Disposable GPU resources created by the last setPins call. */
  let resources = [];
  const raycaster = new THREE.Raycaster();

  // ---------------------------------------------------------------------------
  // Surface attachment (deformation tracking)
  // ---------------------------------------------------------------------------

  /** Scratch objects for attachment math (no per-frame allocations). */
  const _tri = new THREE.Triangle();
  const _closest = new THREE.Vector3();
  const _bary = new THREE.Vector3();
  const _target = new THREE.Vector3();
  const _vA = new THREE.Vector3();
  const _vB = new THREE.Vector3();
  const _vC = new THREE.Vector3();
  const _edge1 = new THREE.Vector3();
  const _edge2 = new THREE.Vector3();
  const _normal = new THREE.Vector3();

  /**
   * Whether a mesh can deform at runtime (bones or morph targets).
   * @param {THREE.Mesh} mesh
   * @returns {boolean}
   */
  function meshDeforms(mesh) {
    return !!(mesh.isSkinnedMesh
      || (mesh.morphTargetInfluences && mesh.morphTargetInfluences.length));
  }

  /**
   * Project a world-space point onto one mesh's CURRENT surface.
   * @param {THREE.Mesh} mesh candidate mesh
   * @param {THREE.Vector3} point world-space pin anchor
   * @returns {{d2: number, i0: number, i1: number, i2: number,
   *            bary: THREE.Vector3} | null} best triangle, or null
   */
  function projectOntoMesh(mesh, point) {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    if (!position) return null;
    const index = geometry.index;
    const triCount = (index ? index.count : position.count) / 3;
    let best = null;
    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      mesh.getVertexPosition(i0, _vA).applyMatrix4(mesh.matrixWorld);
      mesh.getVertexPosition(i1, _vB).applyMatrix4(mesh.matrixWorld);
      mesh.getVertexPosition(i2, _vC).applyMatrix4(mesh.matrixWorld);
      _tri.set(_vA, _vB, _vC);
      _tri.closestPointToPoint(point, _closest);
      const d2 = _closest.distanceToSquared(point);
      if (!best || d2 < best.d2) {
        _tri.getBarycoord(_closest, _bary);
        best = { d2, i0, i1, i2, bary: _bary.clone() };
      }
    }
    return best;
  }

  /**
   * Derive the live attachment for one pin: nearest triangle + barycentric
   * coordinates, preferring the mesh the pin was authored on.
   * @param {{p: number[], n: number[], m?: number}} pin
   * @returns {object | null} attachment core, or null (pin stays static)
   */
  function attachPin(pin) {
    const point = root.localToWorld(new THREE.Vector3(...pin.p));
    const preferred = pin.m != null ? meshes[pin.m] : null;
    const candidates = preferred ? [preferred] : meshes;
    let best = null;
    for (const mesh of candidates) {
      const hit = projectOntoMesh(mesh, point);
      if (hit && (!best || hit.d2 < best.d2)) best = { mesh, ...hit };
    }
    if (!best) return null;
    return {
      mesh: best.mesh,
      i0: best.i0,
      i1: best.i1,
      i2: best.i2,
      bary: best.bary,
      n0: new THREE.Vector3(...pin.n).transformDirection(root.matrixWorld),
    };
  }

  /**
   * Current world-space anchor + outward normal of one attachment, computed
   * from the deformed triangle (bones + morphs applied).
   * @param {object} attachment
   * @param {THREE.Vector3} outAnchor written with the anchor
   * @param {THREE.Vector3} outNormal written with the unit normal
   */
  function evaluateAttachment(attachment, outAnchor, outNormal) {
    const { mesh, i0, i1, i2, bary, n0 } = attachment;
    mesh.getVertexPosition(i0, _vA).applyMatrix4(mesh.matrixWorld);
    mesh.getVertexPosition(i1, _vB).applyMatrix4(mesh.matrixWorld);
    mesh.getVertexPosition(i2, _vC).applyMatrix4(mesh.matrixWorld);
    outAnchor.set(0, 0, 0)
      .addScaledVector(_vA, bary.x)
      .addScaledVector(_vB, bary.y)
      .addScaledVector(_vC, bary.z);
    _edge1.subVectors(_vB, _vA);
    _edge2.subVectors(_vC, _vA);
    outNormal.crossVectors(_edge1, _edge2).normalize();
    // Keep the leader on the side the author chose (winding can flip).
    if (outNormal.dot(n0) < 0) outNormal.negate();
  }

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
    tags = [];
    attachments = [];
    deforms = false;
  }

  /**
   * Rebuild the layer from a pin list (cheap: pins are few, textures small).
   * @param {Array<{p: number[], n: number[], text: string, c?: number, m?: number}>} list
   */
  function setPins(list) {
    clear();
    root.updateWorldMatrix(true, true);
    list.forEach((pin, i) => {
      if (!pinVisible(pin)) {
        tags.push(null);
        attachments.push(null);
        return;
      }
      const anchor = root.localToWorld(new THREE.Vector3(...pin.p));
      const normal = new THREE.Vector3(...pin.n).transformDirection(root.matrixWorld);
      // Ride the surface when one is found; static placement otherwise.
      const attachment = attachPin(pin);
      if (attachment) evaluateAttachment(attachment, anchor, normal);
      const head = anchor.clone().addScaledVector(normal, leader);

      const lineGeometry = new THREE.BufferGeometry().setFromPoints([anchor, head]);
      const lineMaterial = new THREE.LineBasicMaterial({
        color: palette.line, depthTest: false, transparent: true, opacity: 0.9,
      });
      const line = new THREE.Line(lineGeometry, lineMaterial);
      line.renderOrder = ORDER_LINE;
      // The leader endpoints move under deformation: never frustum-cull from
      // the stale initial bounding sphere.
      line.frustumCulled = false;
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
      tags.push({ head, aspect: tag.aspect });
      if (attachment) {
        attachment.line = lineGeometry;
        attachment.sprite = sprite;
        attachment.head = head;
        if (meshDeforms(attachment.mesh)) deforms = true;
      }
      attachments.push(attachment);
    });
  }

  /**
   * Follow the deformed surface: recompute every attached pin's anchor from
   * its triangle (bones + morphs applied) and move the leader + tag. Call
   * once per rendered frame; a no-op for models that cannot deform.
   */
  function update() {
    if (!deforms || !group.visible) return;
    for (const attachment of attachments) {
      if (!attachment || !meshDeforms(attachment.mesh)) continue;
      evaluateAttachment(attachment, _target, _normal);
      attachment.head.copy(_target).addScaledVector(_normal, leader);
      const positions = attachment.line.getAttribute('position');
      positions.setXYZ(0, _target.x, _target.y, _target.z);
      positions.setXYZ(1, attachment.head.x, attachment.head.y, attachment.head.z);
      positions.needsUpdate = true;
      attachment.sprite.position.copy(attachment.head);
    }
  }

  /**
   * Screen-space hit test against the WHOLE tag (number cell + label), so a
   * click on the label in 3D opens the note for editing.
   * @param {{clientX: number, clientY: number}} event a pointer event
   * @param {THREE.Camera} camera the stage camera
   * @param {HTMLElement} dom the render canvas (for rect + size)
   * @returns {number} index of the hit pin, or -1
   */
  function pickPin(event, camera, dom) {
    if (!group.visible) return -1;
    // Picking must not depend on a frame having rendered since the last
    // camera move (rAF is paused in background/preview tabs); Camera's
    // override also refreshes matrixWorldInverse for project().
    camera.updateMatrixWorld();
    const rect = dom.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    // On-screen tag height for the current viewport (sizeAttenuation false).
    const tagPx = (TAG_SCALE / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * rect.height * 0.5;
    const margin = 4;
    const projected = new THREE.Vector3();
    let best = -1;
    tags.forEach((tag, i) => {
      if (!tag) return;
      projected.copy(tag.head).project(camera);
      if (projected.z > 1) return;
      // The sprite anchors at its LEFT edge, vertically centred (center 0,0.5).
      const sx = (projected.x + 1) / 2 * rect.width;
      const sy = (1 - projected.y) / 2 * rect.height;
      const inX = x >= sx - margin && x <= sx + tagPx * tag.aspect + margin;
      const inY = y >= sy - tagPx / 2 - margin && y <= sy + tagPx / 2 + margin;
      if (inX && inY) best = i; // later pins draw on top — prefer them
    });
    return best;
  }

  /**
   * Show or hide the whole layer (picking is disabled while hidden).
   * @param {boolean} visible
   */
  function setVisible(visible) {
    group.visible = visible;
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

  return { setPins, update, pickPin, pickSurface, setVisible, dispose };
}
