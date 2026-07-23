// =============================================================================
// materials.js
//
// The material menu. A base material preset (original / clay / metallic / glass
// / matcap) is applied to every mesh, and an INDEPENDENT wireframe overlay can
// be layered on top of any of them. The two axes are orthogonal: choosing a
// material never clears the wireframe, and toggling the wireframe never resets
// the material.
//
// Real meshes are enumerated from state.originals (populated once at load),
// never by traversing the scene graph — the wireframe overlay adds child
// meshes, and traversing would re-enter them and spawn overlays of overlays.
// =============================================================================

import * as THREE from 'three';
import { state } from './state.js';
import { $ } from './dom.js';

// -----------------------------------------------------------------------------
// Preset materials (cloned per mesh so per-mesh morph flags are preserved)
// -----------------------------------------------------------------------------

/** Uniform matte grey — reads pure form, ignores the model's own maps. */
const clayMat = new THREE.MeshStandardMaterial({ color: 0xb4b4b4, roughness: 0.9, metalness: 0 });

/** Polished chrome — driven entirely by the studio environment map. */
const metalMat = new THREE.MeshStandardMaterial({ color: 0xd4d4d4, roughness: 0.16, metalness: 1 });

/** Clear refractive glass (physical transmission). */
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  metalness: 0,
  roughness: 0.02,
  transmission: 1,
  thickness: 0.6,
  ior: 1.5,
  transparent: true,
});

/**
 * Build a greyscale matcap: a lit-sphere gradient baked into a texture that the
 * shader samples by surface normal, so the model looks lit with no real lights.
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

const matcapMat = new THREE.MeshMatcapMaterial({ matcap: makeMatcapTexture() });

/** name -> preset material (null = restore the model's original material). */
const PRESETS = {
  original: null,
  clay: clayMat,
  metallic: metalMat,
  glass: glassMat,
  matcap: matcapMat,
};

// -----------------------------------------------------------------------------
// Wireframe overlay material
// -----------------------------------------------------------------------------

// A dark, semi-transparent wire (DCC convention). Studio lighting keeps most
// surfaces mid-to-light, so a dark line reads clearly; the polygon offset lifts
// the wire off the shaded surface to avoid z-fighting.
const wireOverlayMat = new THREE.MeshBasicMaterial({
  wireframe: true,
  color: 0x111111,
  transparent: true,
  opacity: 0.4,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});

// -----------------------------------------------------------------------------
// Application
// -----------------------------------------------------------------------------

/** @returns {THREE.Mesh[]} the model's real meshes (excludes wire overlays). */
const realMeshes = () => [...state.originals.keys()];

/**
 * Apply a base material preset to every real mesh. Leaves the wireframe overlay
 * untouched (it lives as separate child meshes).
 * @param {'original'|'clay'|'metallic'|'glass'|'matcap'} name preset key
 */
export function applyMaterial(name) {
  const preset = PRESETS[name];
  for (const mesh of realMeshes()) {
    const original = state.originals.get(mesh);
    if (!preset) {
      mesh.material = original;
      continue;
    }
    // Clone so each mesh keeps its own morph-target support flag.
    const material = preset.clone();
    material.morphTargets = original && original.morphTargets;
    mesh.material = material;
  }
}

/** Remove every live wireframe overlay mesh from the scene. */
function clearWireOverlays() {
  state.wireOverlays.forEach((overlay) => overlay.parent && overlay.parent.remove(overlay));
  state.wireOverlays = [];
}

/**
 * Turn the additive wireframe overlay on or off across all real meshes.
 * @param {boolean} on whether the overlay should be shown
 */
export function setWireframe(on) {
  state.wireframe = on;
  clearWireOverlays();
  if (!on) return;
  for (const mesh of realMeshes()) {
    if (mesh.isSkinnedMesh) continue; // the overlay does not follow skinned bones
    const overlay = new THREE.Mesh(mesh.geometry, wireOverlayMat);
    mesh.add(overlay);
    state.wireOverlays.push(overlay);
  }
}

// -----------------------------------------------------------------------------
// UI wiring + current state
// -----------------------------------------------------------------------------

/** @returns {string} the checked material-preset value. */
export const currentMaterial = () => document.querySelector('input[name="material"]:checked').value;

/** Re-apply the current material + wireframe state to a freshly loaded model. */
export function reapplyMaterial() {
  applyMaterial(currentMaterial());
  setWireframe(state.wireframe);
}

/** Wire the material radios and the wireframe toggle button to their handlers. */
export function initMaterialControls() {
  document.querySelectorAll('input[name="material"]').forEach((radio) =>
    radio.addEventListener('change', () => applyMaterial(radio.value)));

  const toggle = $('wire-toggle');
  toggle.addEventListener('click', () => {
    const on = toggle.getAttribute('aria-pressed') !== 'true';
    toggle.setAttribute('aria-pressed', String(on));
    setWireframe(on);
  });
}
