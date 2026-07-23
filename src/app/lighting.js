// =============================================================================
// lighting.js
//
// The light menu. Every model is lit by a constant image-based environment
// (the studio PMREM set up in stage.js); the presets here shape the look on top
// of it by varying tone-mapping exposure, a directional key light, a hemisphere
// fill, and the background tone. Switching presets never touches the geometry
// or materials.
// =============================================================================

import * as THREE from 'three';
import { state } from './state.js';

/**
 * Preset definitions.
 * @typedef {Object} LightPreset
 * @property {number} exposure  renderer tone-mapping exposure (overall brightness)
 * @property {number} key       directional key-light intensity (0 = off)
 * @property {number} fill      hemisphere fill-light intensity (0 = off)
 * @property {number} bg        background colour (hex)
 * @property {[number, number, number]} keyDir  key-light direction (unit-ish)
 */

/** @type {Record<string, LightPreset>} */
const PRESETS = {
  studio: { exposure: 1.0, key: 0.0, fill: 0.0, bg: 0x262626, keyDir: [1, 1, 1] },
  soft: { exposure: 0.9, key: 0.0, fill: 0.45, bg: 0x2e2e2e, keyDir: [1, 1, 1] },
  dramatic: { exposure: 0.85, key: 2.6, fill: 0.0, bg: 0x171717, keyDir: [-1, 1.2, 0.6] },
  bright: { exposure: 1.35, key: 0.8, fill: 0.3, bg: 0x3a3a3a, keyDir: [0.6, 1, 0.8] },
};

// Lights are created once and shared; presets only adjust their intensity.
let keyLight = null;
let fillLight = null;
let renderer = null;
let scene = null;

/**
 * Apply a lighting preset.
 * @param {'studio'|'soft'|'dramatic'|'bright'} name preset key
 */
export function applyLight(name) {
  const preset = PRESETS[name] || PRESETS.studio;
  state.light = name;

  renderer.toneMappingExposure = preset.exposure;
  scene.background = new THREE.Color(preset.bg);

  keyLight.intensity = preset.key;
  keyLight.position.set(...preset.keyDir).normalize().multiplyScalar(5);
  fillLight.intensity = preset.fill;
}

/** @returns {string} the checked lighting-preset value. */
export const currentLight = () => document.querySelector('input[name="light"]:checked').value;

/**
 * Create the shared lights and wire the lighting radios.
 * @param {ReturnType<import('./stage.js').createStage>} stage the render stage
 */
export function initLighting(stage) {
  renderer = stage.renderer;
  scene = stage.scene;

  keyLight = new THREE.DirectionalLight(0xffffff, 0);
  fillLight = new THREE.HemisphereLight(0xffffff, 0x404040, 0);
  scene.add(keyLight, fillLight);

  document.querySelectorAll('input[name="light"]').forEach((radio) =>
    radio.addEventListener('change', () => applyLight(radio.value)));

  applyLight(currentLight());
}
