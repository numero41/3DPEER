// state.js — the single mutable model-state object for the workbench.
//
// One page, one loaded model, so a shared singleton is simpler than threading
// state through every module. Modules import `state`, read/write its fields,
// and never create their own copy. `reset()` clears everything tied to the
// currently loaded model (called before loading a new one).

import * as THREE from 'three';

/** @typedef {{clip: THREE.AnimationClip, action: THREE.AnimationAction}} ClipAction */

export const state = {
  /** Root object of the loaded glTF scene, or null when nothing is loaded. */
  root: null,
  /** Raw bytes of the source .glb, kept for export. */
  glbBytes: null,
  /** Base file name (no extension), used for exported file names + captions. */
  name: 'model',

  /** Framed centre of the model, in world space (for camera views). */
  center: new THREE.Vector3(),
  /** Framing distance chosen by frameObject (radius of the view orbit). */
  dist: 4,

  /** mesh -> its original material, so display modes can restore "shaded". */
  originals: new Map(),
  /** Live wireframe overlay meshes (additive wireframe toggle). */
  wireOverlays: [],
  /** Whether the additive wireframe overlay is on (a UI preference that
   *  persists across model loads, so it is NOT cleared by resetState). */
  wireframe: false,
  /** Lighting rig values driven by the light-menu sliders (UI preference,
   *  persists across loads). See lighting.js for the meaning of each field. */
  lighting: { ambient: 0.6, count: 1, intensity: 1.2, orientation: 35 },

  /** THREE.AnimationMixer for the loaded clips, or null. */
  mixer: null,
  /** @type {ClipAction[]} All clip/action pairs on the model. */
  actions: [],
  /** The clip/action currently playing/scrubbing, or null. */
  activeAction: null,
  /** Shared clock driving the animation mixer. */
  clock: new THREE.Clock(),
};

/**
 * Clear every field tied to the currently loaded model. Does not remove the
 * object from the scene — the caller (loader) owns disposal.
 */
export function resetState() {
  state.root = null;
  state.glbBytes = null;
  state.originals.clear();
  state.wireOverlays = [];
  state.mixer = null;
  state.actions = [];
  state.activeAction = null;
}
