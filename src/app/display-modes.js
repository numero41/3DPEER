// display-modes.js — shaded / clay / matcap / wire / wire+shaded.
//
// Materials are monochrome to match the site palette. The wire+shaded overlay
// is a separate child mesh drawn over the shaded surface; see applyDisplayMode
// for the traversal caveat that used to cause an infinite-recursion crash.

import * as THREE from 'three';
import { state } from './state.js';

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

/** Full wireframe: light grey, reads on the dark viewport. */
const wireMat = new THREE.MeshBasicMaterial({ wireframe: true, color: 0xe6e6e6 });

// wire+shaded overlay: a dark, semi-transparent wire (DCC convention). Studio
// lighting keeps most surfaces mid-to-light, so a dark line reads where a
// near-opaque light one would not; polygon offset lifts it off the surface.
const wireOverlayMat = new THREE.MeshBasicMaterial({
  wireframe: true, color: 0x111111, transparent: true, opacity: 0.4,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
});

/** Remove any live wire+shaded overlay meshes. */
function clearWireOverlays() {
  state.wireOverlays.forEach((w) => w.parent && w.parent.remove(w));
  state.wireOverlays = [];
}

/**
 * Apply a display mode to every mesh of the loaded model.
 * @param {'shaded'|'clay'|'matcap'|'wire'|'wireshaded'} mode
 */
export function applyDisplayMode(mode) {
  if (!state.root) return;
  clearWireOverlays();

  // Snapshot the real meshes FIRST: the wireshaded branch adds child meshes,
  // and traverse() walks into children added mid-traversal — which would make
  // each overlay spawn its own overlay until the stack overflowed.
  const meshes = [];
  state.root.traverse((o) => { if (o.isMesh) meshes.push(o); });

  for (const o of meshes) {
    const orig = state.originals.get(o);
    const cloneFor = (m) => {
      const c = m.clone();
      c.morphTargets = orig && orig.morphTargets;
      return c;
    };
    if (mode === 'shaded') o.material = orig;
    else if (mode === 'clay') o.material = cloneFor(clayMat);
    else if (mode === 'matcap') o.material = cloneFor(matcapMat);
    else if (mode === 'wire') o.material = cloneFor(wireMat);
    else if (mode === 'wireshaded') {
      o.material = orig;
      if (!o.isSkinnedMesh) { // v0: the overlay does not follow bones
        const w = new THREE.Mesh(o.geometry, wireOverlayMat);
        o.add(w);
        state.wireOverlays.push(w);
      }
    }
  }
}

/** Wire the display-mode radio group to applyDisplayMode. */
export function initDisplayModes() {
  document.querySelectorAll('input[name="dmode"]').forEach((r) =>
    r.addEventListener('change', () => applyDisplayMode(r.value)));
}

/** The currently checked display mode value. */
export function currentMode() {
  return document.querySelector('input[name="dmode"]:checked').value;
}
