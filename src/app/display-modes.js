// display-modes.js — base shader (shaded / clay / matcap / wire) plus an
// INDEPENDENT wireframe overlay that layers on top of whichever shader is
// active. Picking a shader no longer clears the wireframe, and toggling the
// wireframe no longer resets the shader — the two are orthogonal.
//
// Real meshes are enumerated from state.originals (populated at load), never by
// traversing the scene, so the wireframe overlay child meshes are never mistaken
// for real geometry (which previously caused runaway overlay-of-overlay nesting).

import * as THREE from 'three';
import { state } from './state.js';
import { $ } from './dom.js';

// --- reusable materials (cloned per mesh so morph flags stay per-mesh) --------

const clayMat = new THREE.MeshStandardMaterial({ color: 0xb4b4b4, roughness: 0.9, metalness: 0 });

/** Procedural greyscale matcap (a lit sphere baked into a texture). */
function makeMatcapTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(96, 96, 20, 128, 128, 150);
  grad.addColorStop(0, '#f5f5f5');
  grad.addColorStop(0.55, '#9a9a9a');
  grad.addColorStop(0.85, '#333333');
  grad.addColorStop(1, '#101010');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const matcapMat = new THREE.MeshMatcapMaterial({ matcap: makeMatcapTexture() });

/** Pure wireframe shader: light grey, reads on the dark viewport. */
const wireMat = new THREE.MeshBasicMaterial({ wireframe: true, color: 0xe6e6e6 });

// Overlay wire: dark, semi-transparent (DCC convention). Studio lighting keeps
// most surfaces mid-to-light, so a dark line reads; polygon offset lifts it off.
const wireOverlayMat = new THREE.MeshBasicMaterial({
  wireframe: true, color: 0x111111, transparent: true, opacity: 0.4,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
});

/** All real (non-overlay) meshes of the loaded model. */
const realMeshes = () => [...state.originals.keys()];

// --- base shader --------------------------------------------------------------

/**
 * Set the base material on every real mesh. Does not touch the wireframe
 * overlay, which lives as separate child meshes.
 * @param {'shaded'|'clay'|'matcap'|'wire'} mode
 */
export function applyBase(mode) {
  for (const o of realMeshes()) {
    const orig = state.originals.get(o);
    const cloneFor = (m) => {
      const c = m.clone();
      c.morphTargets = orig && orig.morphTargets;
      return c;
    };
    if (mode === 'clay') o.material = cloneFor(clayMat);
    else if (mode === 'matcap') o.material = cloneFor(matcapMat);
    else if (mode === 'wire') o.material = cloneFor(wireMat);
    else o.material = orig; // shaded
  }
}

// --- wireframe overlay --------------------------------------------------------

/** Remove all live overlay meshes. */
function clearWireOverlays() {
  state.wireOverlays.forEach((w) => w.parent && w.parent.remove(w));
  state.wireOverlays = [];
}

/**
 * Toggle the additive wireframe overlay on/off across all real meshes.
 * @param {boolean} on
 */
export function setWireframe(on) {
  state.wireframe = on;
  clearWireOverlays();
  if (!on) return;
  for (const o of realMeshes()) {
    if (o.isSkinnedMesh) continue; // v0: overlay does not follow bones
    const w = new THREE.Mesh(o.geometry, wireOverlayMat);
    o.add(w);
    state.wireOverlays.push(w);
  }
}

// --- current UI state + re-apply ---------------------------------------------

/** The checked base-shader value. */
export const currentBase = () => document.querySelector('input[name="dmode"]:checked').value;

/** Re-apply shader + wireframe for a freshly loaded model. */
export function reapplyDisplay() {
  applyBase(currentBase());
  setWireframe(state.wireframe);
}

/** Wire the shader radios and the wireframe toggle button. */
export function initDisplayControls() {
  document.querySelectorAll('input[name="dmode"]').forEach((r) =>
    r.addEventListener('change', () => applyBase(r.value)));

  const toggle = $('wire-toggle');
  toggle.addEventListener('click', () => {
    const on = toggle.getAttribute('aria-pressed') !== 'true';
    toggle.setAttribute('aria-pressed', String(on));
    setWireframe(on);
  });
}
