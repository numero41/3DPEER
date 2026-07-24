// =============================================================================
// ui.js
//
// Status line + export progress bar. The progress bar is a native <progress>
// element; its `.value` is a DOM property (not a style), and only classes and
// attributes are toggled — per project invariant #6 (no element.style anywhere).
// =============================================================================

import { $ } from './dom.js';

/**
 * Write a short message to the status line under the 3D view.
 * @param {string} msg
 * @param {'info'|'ok'|'warn'|'error'} [kind='info'] tone of the message —
 *   every kind has its own soft colour: info yellow, ok green, warn pink,
 *   error red (tokens in site.css).
 */
export function setStatus(msg, kind = 'info') {
  const status = $('status');
  status.textContent = msg;
  status.classList.remove('info', 'ok', 'warn', 'error');
  status.classList.add(kind);
}

/**
 * Controls the export progress bar (fill + percent + estimated time remaining).
 * Estimation is a simple linear extrapolation from elapsed time and fraction
 * done — good enough to reassure the user a large export is progressing.
 */
export const progress = {
  _startedAt: 0,

  /** Reveal the bar and start the ETA clock. Call once at the top of a task. */
  start() {
    this._startedAt = performance.now();
    $('export-progress').value = 0;
    $('export-pct').textContent = '0%';
    $('export-eta').textContent = 'estimating…';
    $('export-progress-wrap').removeAttribute('hidden');
  },

  /**
   * Update the bar.
   * @param {number} fraction 0..1 completed
   * @param {string} [label] optional stage label shown next to the ETA
   */
  set(fraction, label) {
    const f = Math.max(0, Math.min(1, fraction));
    $('export-progress').value = f;
    $('export-pct').textContent = Math.round(f * 100) + '%';
    const elapsed = performance.now() - this._startedAt;
    let eta = 'estimating…';
    if (f > 0.02 && f < 1) {
      const remainMs = elapsed * (1 - f) / f;
      eta = '~' + (remainMs < 1000 ? '<1s' : Math.ceil(remainMs / 1000) + 's') + ' left';
    } else if (f >= 1) {
      eta = 'done';
    }
    $('export-eta').textContent = label ? `${label} · ${eta}` : eta;
  },

  /** Hide the bar (e.g. a short delay after completion, or on error). */
  hide() {
    $('export-progress-wrap').setAttribute('hidden', '');
  },
};
