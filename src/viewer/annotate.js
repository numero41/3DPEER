// =============================================================================
// annotate.js (viewer)
//
// In-artifact annotations: renders the pins shipped in the annotation slot
// (window.__ANN), and lets the RECIPIENT add, edit and delete pins from a
// notes panel. Saving rebuilds the artifact from a pristine copy of its own
// HTML — captured before any DOM mutation — with the new pin list injected
// into the marker-delimited slot (split/join only, invariant #4), then
// downloads it as <title>.annotated.3dpeer.html. The file travels back by
// mail; no server, no persistence problem.
//
// Before the rebuilt file is offered, it self-tests (invariant #3 applied to
// the save path): the payload literal must be byte-identical to the one this
// very page decoded, and the slot must read back the exact pin list.
//
// localStorage keeps a draft of unsaved notes as a crash net (best effort:
// storage may be unavailable over file:// — every access is guarded).
// =============================================================================

import { createPinLayer } from '../annotations/pins.js';
import { injectAnnotations, extractAnnotations } from '../codec/annotations.js';

/** Artifact register palette for the pin layer (mirrors page.css tokens). */
const PALETTE = {
  dot: '#c9a978',
  dotText: '#211a14',
  line: '#c9a978',
  labelBg: 'rgba(33, 26, 20, 0.92)',
  labelLine: '#4a3a2c',
  labelText: '#c9a978',
};

/** Presses that move less than this many px count as clicks, not orbits. */
const CLICK_SLOP_PX = 5;

/**
 * Serialize the document as it stands RIGHT NOW. Must be called before any
 * DOM mutation (first statement of boot), so the captured copy matches the
 * original file: rebuilding from it re-ships the poster, the hint and the
 * bundle untouched, and reopening the copy boots cleanly with no leftover
 * runtime DOM.
 * @returns {string} the full artifact HTML, doctype restored
 */
export function capturePristine() {
  return '<!doctype html>\n' + document.documentElement.outerHTML;
}

/**
 * Locate the base85 payload literal inside an artifact HTML string.
 * @param {string} html the artifact
 * @returns {string} the payload characters
 */
function payloadSlice(html) {
  const marker = 'window.__P=\n"';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('payload literal not found');
  const from = start + marker.length;
  return html.slice(from, html.indexOf('"', from));
}

/**
 * Wire the notes button, panel and self-re-export for this artifact.
 * @param {ReturnType<import('./scene.js').createStage>} stage the stage
 * @param {import('three').Object3D} root the loaded model root
 * @param {string} pristine the pre-mutation HTML from capturePristine()
 */
export function initAnnotations(stage, root, pristine) {
  const { scene, camera, renderer } = stage;
  const canvas = renderer.domElement;
  const layer = createPinLayer(scene, root, PALETTE);

  /** The live pin list (starts as shipped, may be replaced by a draft). */
  let pins = Array.isArray(window.__ANN) ? window.__ANN.slice() : [];
  const shipped = JSON.stringify(pins);
  const draftKey = '3dpeer:ann:' + document.title + ':' + String((window.__P || '').length);

  // ---------------------------------------------------------------------------
  // DOM (classes only — all styling lives in page.css)
  // ---------------------------------------------------------------------------
  const button = document.createElement('button');
  button.id = 'abtn';
  document.body.appendChild(button);

  const panel = document.createElement('div');
  panel.id = 'apanel';
  const addToggle = document.createElement('button');
  addToggle.className = 'abtn';
  addToggle.textContent = 'add pin — click the model';
  addToggle.title = 'Toggle pin mode, then click the model to add a note';
  addToggle.setAttribute('aria-pressed', 'false');
  const save = document.createElement('button');
  save.className = 'abtn';
  save.textContent = 'save annotated copy';
  save.title = 'Download this file with your notes baked in';
  const list = document.createElement('div');
  const status = document.createElement('p');
  status.id = 'astat';
  panel.append(addToggle, save, list, status);
  document.body.appendChild(panel);

  /** @param {string} message status line under the panel buttons */
  function setStatus(message) {
    status.textContent = message;
  }

  // ---------------------------------------------------------------------------
  // Draft crash net
  // ---------------------------------------------------------------------------

  /** Persist the current pins if they differ from what the file shipped. */
  function saveDraft() {
    try {
      const now = JSON.stringify(pins);
      if (now === shipped) localStorage.removeItem(draftKey);
      else localStorage.setItem(draftKey, now);
    } catch (e) { /* storage unavailable (some file:// contexts) — net only */ }
  }

  /** Drop the draft (called after a successful save). */
  function clearDraft() {
    try { localStorage.removeItem(draftKey); } catch (e) { /* same as above */ }
  }

  try {
    const draft = localStorage.getItem(draftKey);
    if (draft && draft !== shipped) {
      pins = JSON.parse(draft);
      setStatus('restored unsaved notes — save a copy to keep them');
    }
  } catch (e) { /* unreadable draft: fall back to the shipped pins */ }

  // ---------------------------------------------------------------------------
  // Panel + pin sync
  // ---------------------------------------------------------------------------

  /** Push the pin list into the WebGL layer and refresh the button label. */
  function syncPins() {
    layer.setPins(pins);
    button.textContent = pins.length ? 'notes (' + pins.length + ')' : 'notes';
  }

  /** Rebuild the panel rows (number, editable text, delete). */
  function buildRows() {
    while (list.firstChild) list.removeChild(list.firstChild);
    pins.forEach((pin, i) => {
      const row = document.createElement('div');
      row.className = 'arow';
      const number = document.createElement('span');
      number.textContent = String(i + 1);
      const text = document.createElement('textarea');
      text.rows = 2;
      text.placeholder = 'note…';
      text.title = 'Annotation text';
      text.value = pin.text;
      text.addEventListener('input', () => {
        pin.text = text.value;
        syncPins();
        markUnsaved();
      });
      const remove = document.createElement('button');
      remove.textContent = '×';
      remove.title = 'Delete this annotation';
      remove.addEventListener('click', () => {
        pins.splice(i, 1);
        syncPins();
        buildRows();
        markUnsaved();
      });
      row.append(number, text, remove);
      list.appendChild(row);
    });
  }

  /** Flag pending changes (status + draft). */
  function markUnsaved() {
    saveDraft();
    if (JSON.stringify(pins) !== shipped) setStatus('unsaved notes — save a copy to keep them');
    else setStatus('');
  }

  /**
   * Open the panel and focus one row's text field.
   * @param {number} index pin index
   */
  function focusRow(index) {
    panel.classList.add('open');
    const row = list.children[index];
    if (row) row.querySelector('textarea').focus();
  }

  // ---------------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------------
  button.addEventListener('click', () => {
    panel.classList.toggle('open');
    const other = document.getElementById('mpanel');
    if (panel.classList.contains('open') && other) other.classList.remove('open');
  });

  addToggle.addEventListener('click', () => {
    const on = addToggle.getAttribute('aria-pressed') === 'true';
    addToggle.setAttribute('aria-pressed', String(!on));
    document.body.classList.toggle('noting', !on);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    addToggle.setAttribute('aria-pressed', 'false');
    document.body.classList.remove('noting');
  });

  // Click vs orbit: a press that barely moves between down and up is a click.
  const press = { x: 0, y: 0, id: -1 };
  canvas.addEventListener('pointerdown', (event) => {
    press.x = event.clientX;
    press.y = event.clientY;
    press.id = event.pointerId;
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId !== press.id) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_SLOP_PX) return;
    const picked = layer.pickPin(event, camera, canvas);
    if (picked >= 0) {
      focusRow(picked);
      return;
    }
    if (document.body.classList.contains('noting')) {
      const hit = layer.pickSurface(event, camera, canvas);
      if (!hit) return;
      pins.push({ p: hit.p, n: hit.n, text: '' });
      syncPins();
      buildRows();
      markUnsaved();
      focusRow(pins.length - 1);
    }
  });

  // ---------------------------------------------------------------------------
  // Self-re-export
  // ---------------------------------------------------------------------------
  save.addEventListener('click', () => {
    try {
      const rebuilt = injectAnnotations(pristine, pins);
      // Self-test before the file leaves: the payload must be byte-identical
      // to the one this page decoded, and the slot must read back exactly.
      if (payloadSlice(rebuilt) !== window.__P)
        throw new Error('payload changed across the rebuild');
      if (JSON.stringify(extractAnnotations(rebuilt)) !== JSON.stringify(pins))
        throw new Error('notes corrupted across the rebuild');

      const blob = new Blob([rebuilt], { type: 'text/html' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (document.title || 'model') + '.annotated.3dpeer.html';
      a.click();
      URL.revokeObjectURL(a.href);
      clearDraft();
      setStatus('saved — send the downloaded copy back');
    } catch (e) {
      setStatus('save failed: ' + (e && e.message ? e.message : e));
    }
  });

  syncPins();
  buildRows();
}
