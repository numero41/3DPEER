// =============================================================================
// comp-settings.js
//
// The compression panel: five sliders (position/normal precision, texture
// size/quality, decimation) with live value readouts, plus read/write helpers
// so the auto solver can push a chosen preset back into the UI.
//
// The texture-size slider works in powers of two (2^8..2^12 = 256..4096 px)
// so every stop is a sane GPU texture edge.
// =============================================================================

import { $ } from './dom.js';

/** slider id -> readout id + how to map slider value <-> setting value. */
const FIELDS = {
  posBits: { input: 'c-pos', readout: 'v-pos', toValue: Number, toSlider: String },
  nrmBits: { input: 'c-nrm', readout: 'v-nrm', toValue: Number, toSlider: String },
  texSize: {
    input: 'c-tex',
    readout: 'v-tex',
    toValue: (v) => 2 ** Number(v),
    toSlider: (v) => String(Math.round(Math.log2(v))),
  },
  texQuality: { input: 'c-q', readout: 'v-q', toValue: Number, toSlider: String },
  decimate: { input: 'c-dec', readout: 'v-dec', toValue: Number, toSlider: String },
};

/** Refresh one readout from its slider position. */
function refresh(name) {
  const field = FIELDS[name];
  $(field.readout).textContent = String(field.toValue($(field.input).value));
}

/**
 * Read the current slider values as pipeline settings.
 * @returns {import('./compress.js').CompressSettings}
 */
export function readSettings() {
  const out = {};
  for (const [name, field] of Object.entries(FIELDS)) out[name] = field.toValue($(field.input).value);
  return out;
}

/**
 * Push a settings object into the sliders and readouts (used by auto), and
 * open the panel so the chosen values are visible.
 * @param {import('./compress.js').CompressSettings} settings
 */
export function writeSettings(settings) {
  $('comp-panel').open = true;
  for (const [name, field] of Object.entries(FIELDS)) {
    $(field.input).value = field.toSlider(settings[name]);
    refresh(name);
  }
}

/** Wire the readouts once at startup. */
export function initCompressionSettings() {
  for (const name of Object.keys(FIELDS)) {
    refresh(name);
    $(FIELDS[name].input).addEventListener('input', () => refresh(name));
  }
}
