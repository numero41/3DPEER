// =============================================================================
// lighting.js
//
// The light menu. The scene is always lit by the studio environment map set up
// in stage.js (image-based light arriving from everywhere). The menu sliders
// shape the rest of the rig on top of it:
//
//   ambient      hemisphere fill intensity — extra light from all directions
//   lights       number of directional lights (0–4), spaced evenly in azimuth
//   intensity    shared strength of the directional lights
//   orientation  azimuth rotation of the whole rig, in degrees
//
// Slider values persist in state.lighting across model loads. Changing them
// never touches geometry or materials.
// =============================================================================

import * as THREE from 'three';
import { state } from './state.js';
import { $ } from './dom.js';

// -----------------------------------------------------------------------------
// Rig
// -----------------------------------------------------------------------------

/** Hard cap on directional lights (also the slider maximum). */
const MAX_LIGHTS = 4;

/** Fixed elevation of every directional light above the horizon (radians). */
const ELEVATION = Math.PI / 4;

/** Distance of the directional lights from the origin (arbitrary; direction is
 *  what matters for a DirectionalLight). */
const RIG_RADIUS = 5;

let hemiLight = null;
/** @type {THREE.DirectionalLight[]} pre-created pool; presets toggle visibility */
let dirLights = [];

/**
 * Push the current state.lighting values into the light rig.
 * Lights beyond the configured count are hidden, not destroyed.
 */
export function applyLighting() {
  const cfg = state.lighting;

  hemiLight.intensity = cfg.ambient;

  dirLights.forEach((light, index) => {
    const active = index < cfg.count;
    light.visible = active;
    if (!active) return;

    light.intensity = cfg.intensity;

    // Spread the active lights evenly around the azimuth, starting at the
    // orientation angle, all at the same elevation.
    const azimuth = THREE.MathUtils.degToRad(cfg.orientation)
      + (index * Math.PI * 2) / Math.max(cfg.count, 1);
    light.position.set(
      Math.cos(azimuth) * Math.cos(ELEVATION),
      Math.sin(ELEVATION),
      Math.sin(azimuth) * Math.cos(ELEVATION),
    ).multiplyScalar(RIG_RADIUS);
  });
}

// -----------------------------------------------------------------------------
// Setup + UI wiring
// -----------------------------------------------------------------------------

/**
 * Create the shared lights, bind the four sliders to state.lighting, and apply
 * the initial values.
 * @param {ReturnType<import('./stage.js').createStage>} stage the render stage
 */
export function initLighting(stage) {
  hemiLight = new THREE.HemisphereLight(0xffffff, 0x404040, 0);
  stage.scene.add(hemiLight);

  for (let i = 0; i < MAX_LIGHTS; i++) {
    const light = new THREE.DirectionalLight(0xffffff, 0);
    light.visible = false;
    stage.scene.add(light);
    dirLights.push(light);
  }

  /**
   * Bind one range input to a state.lighting key.
   * @param {string} id    input element id
   * @param {string} key   state.lighting property to drive
   */
  const bind = (id, key) => {
    const input = $(id);
    input.value = String(state.lighting[key]);
    input.addEventListener('input', () => {
      state.lighting[key] = parseFloat(input.value);
      applyLighting();
    });
  };

  bind('light-ambient', 'ambient');
  bind('light-count', 'count');
  bind('light-intensity', 'intensity');
  bind('light-orientation', 'orientation');

  applyLighting();
}
