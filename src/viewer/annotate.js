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

import { createPinLayer, PIN_COLORS } from '../annotations/pins.js';
import { injectAnnotations, extractAnnotations } from '../codec/annotations.js';
import { SPRITE } from './sprite.js';

/** Artifact register palette for the pin layer (mirrors page.css tokens). */
const PALETTE = {
  tagText: '#211a14',
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
 * @returns {{update: () => void}} per-frame hook (pins follow deformation)
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
  // The bundle carries its own inline icon sprite (invariant #1 intact).
  if (!document.querySelector('.icon-sprite')) {
    document.body.insertAdjacentHTML('afterbegin', SPRITE);
  }

  /**
   * Inline markup for one sprite icon.
   * @param {string} name icon name (without the i- prefix)
   * @returns {string}
   */
  const icon = (name) => '<svg class="ico" viewBox="0 0 24 24"><use href="#i-' + name + '"/></svg>';

  const button = document.createElement('button');
  button.id = 'abtn';
  button.title = 'Notes — read, edit and add annotations';
  button.insertAdjacentHTML('afterbegin', icon('pin') + '<span></span>');
  const buttonLabel = button.querySelector('span');
  document.body.appendChild(button);

  const panel = document.createElement('div');
  panel.id = 'apanel';
  const addToggle = document.createElement('button');
  addToggle.className = 'abtn';
  addToggle.title = 'Toggle pin mode, then click the model to add a note';
  addToggle.setAttribute('aria-pressed', 'false');
  addToggle.insertAdjacentHTML('afterbegin', icon('pin') + '<span>Add pin — click the model</span>');
  const visToggle = document.createElement('button');
  visToggle.className = 'abtn';
  visToggle.title = 'Show / hide all notes on the model';
  visToggle.setAttribute('aria-pressed', 'true');
  visToggle.insertAdjacentHTML('afterbegin', icon('eye') + '<span>Hide notes</span>');
  const save = document.createElement('button');
  save.className = 'abtn';
  save.title = 'Download this file with your notes baked in';
  save.insertAdjacentHTML('afterbegin', icon('export') + '<span>Save annotated copy</span>');
  const list = document.createElement('div');
  const status = document.createElement('p');
  status.id = 'astat';
  panel.append(addToggle, visToggle, save, list, status);
  document.body.appendChild(panel);

  let notesVisible = true;
  visToggle.addEventListener('click', () => {
    notesVisible = !notesVisible;
    visToggle.setAttribute('aria-pressed', String(notesVisible));
    visToggle.querySelector('use').setAttribute('href', notesVisible ? '#i-eye' : '#i-eye-off');
    visToggle.querySelector('span').textContent = notesVisible ? 'Hide notes' : 'Show notes';
    layer.setVisible(notesVisible);
  });


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
      setStatus('Restored unsaved notes — save a copy to keep them');
    }
  } catch (e) { /* unreadable draft: fall back to the shipped pins */ }

  // ---------------------------------------------------------------------------
  // Panel + pin sync
  // ---------------------------------------------------------------------------

  /** Push the pin list into the WebGL layer and refresh the button label. */
  function syncPins() {
    layer.setPins(pins);
    buttonLabel.textContent = pins.length ? 'Notes (' + pins.length + ')' : 'Notes';
  }

  /** Rebuild the panel rows: [badge (colour popover)]|[field + delete inside]. */
  function buildRows() {
    while (list.firstChild) list.removeChild(list.firstChild);
    pins.forEach((pin, i) => {
      const row = document.createElement('div');
      row.className = 'arow';

      // The badge opens a NATIVE popover with the palette: top layer, never
      // clipped by the panel scroll box, light-dismissed by the browser.
      const number = document.createElement('button');
      number.className = 'anum pin-c' + (pin.c || 0);
      number.textContent = String(i + 1);
      number.title = 'Pick a pin colour';
      number.setAttribute('popovertarget', 'acolors-' + i);
      const colors = document.createElement('div');
      colors.className = 'acolors';
      colors.id = 'acolors-' + i;
      colors.setAttribute('popover', '');
      PIN_COLORS.forEach((hex, ci) => {
        const swatch = document.createElement('button');
        swatch.className = 'aswatch pin-c' + ci + (ci === (pin.c || 0) ? ' active' : '');
        swatch.addEventListener('click', () => {
          colors.hidePopover();
          pin.c = ci;
          syncPins();
          buildRows();
          markUnsaved();
        });
        colors.append(swatch);
      });

      const field = document.createElement('div');
      field.className = 'afield';
      const text = document.createElement('textarea');
      text.rows = 1;
      text.placeholder = 'note…';
      text.title = 'Annotation text';
      text.value = pin.text;
      text.addEventListener('input', () => {
        pin.text = text.value;
        syncPins();
        markUnsaved();
      });
      const remove = document.createElement('button');
      remove.className = 'adel';
      remove.title = 'Delete this annotation';
      remove.insertAdjacentHTML('afterbegin', icon('close'));
      remove.addEventListener('click', () => {
        pins.splice(i, 1);
        syncPins();
        buildRows();
        markUnsaved();
      });
      field.append(text, remove);

      row.append(number, colors, field);
      list.appendChild(row);
    });
  }

  /** Flag pending changes (status + draft). */
  function markUnsaved() {
    saveDraft();
    if (JSON.stringify(pins) !== shipped) setStatus('Unsaved notes — save a copy to keep them');
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
      pins.push({ p: hit.p, n: hit.n, m: hit.m, text: '', c: 0 });
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
      setStatus('Saved — send the downloaded copy back');
    } catch (e) {
      setStatus('Save failed: ' + (e && e.message ? e.message : e));
    }
  });

  syncPins();
  buildRows();

  return { update: () => layer.update() };
}
