// =============================================================================
// annotate.js
//
// Workbench annotation authoring: a pin-mode toggle in the stage tools, click
// on the model to drop a numbered pin (raycast hit stored in model space), and
// an editable list in the side panel. Pins live in state.annotations and are
// baked into the export via the annotation slot (see codec/annotations.js).
//
// Rendering is delegated to the shared WebGL pin layer (annotations/pins.js):
// no DOM element is positioned or coloured from JS — pin colours go through
// the .pin-c0…4 classes (invariant #6). The palette below mirrors the site's
// overlay tokens — WebGL cannot read CSS custom properties, same trade-off as
// the stage background colour in stage.js.
// =============================================================================

import { createPinLayer, PIN_COLORS } from '../annotations/pins.js';
import { state } from './state.js';
import { $, clearChildren, el } from './dom.js';

/** Site register for the pin layer (mirrors site.css overlay tokens). */
const PALETTE = {
  tagText: '#161618',
  line: '#fcfcfd',
  labelBg: 'rgba(24, 24, 27, 0.82)',
  labelLine: 'rgba(244, 244, 245, 0.22)',
  labelText: '#fcfcfd',
};

/** Presses that move less than this many px count as clicks, not orbits. */
const CLICK_SLOP_PX = 5;

/** The render stage, provided by initAnnotations. */
let stageRef = null;

/** The live pin layer for the loaded model, or null. */
let layer = null;

/** Whether notes are shown on the model (UI preference, survives loads). */
let notesVisible = true;

// -----------------------------------------------------------------------------
// Undo (Ctrl/Cmd+Z outside text fields; typing keeps the native text undo)
// -----------------------------------------------------------------------------

/** Undo history: JSON snapshots of the pin list, taken BEFORE each mutation.
 *  Text edits coalesce per focus session (snapshot on textarea focus). */
const history = [];

/** Record the current pin list (bounded). */
function snapshot() {
  history.push(JSON.stringify(state.annotations));
  if (history.length > 50) history.shift();
}

/** Restore the most recent snapshot. */
function undo() {
  if (!history.length) return;
  const previous = JSON.parse(history.pop());
  state.annotations.length = 0;
  previous.forEach((pin) => state.annotations.push(pin));
  syncPins();
  buildRows();
}

// -----------------------------------------------------------------------------
// Pin mode + click handling
// -----------------------------------------------------------------------------

/**
 * Turn annotation mode on or off (button state + crosshair cursor class).
 * @param {boolean} on
 */
function setMode(on) {
  $('note-mode').setAttribute('aria-pressed', String(on));
  $('stage').classList.toggle('noting', on);
}

/** @returns {boolean} whether annotation mode is active */
function modeOn() {
  return $('note-mode').getAttribute('aria-pressed') === 'true';
}

/**
 * Open the side panel and focus the text field of one pin row.
 * @param {number} index pin index in state.annotations
 */
function focusRow(index) {
  $('side').classList.add('open');
  const row = $('note-list').children[index];
  if (row) row.querySelector('textarea').focus();
}

/**
 * Handle a clean click on the viewport: an existing pin opens its row; in
 * pin mode, a surface hit adds a new pin there.
 * @param {PointerEvent} event
 */
function handleClick(event) {
  if (!state.root || !layer) return;
  // Quad view renders four cameras into one canvas; single-camera picking
  // would land on the wrong pane — annotations are edited in single view.
  if (stageRef.isQuad && stageRef.isQuad()) return;
  const { camera, canvas } = stageRef;
  const picked = layer.pickPin(event, camera, canvas);
  if (picked >= 0) {
    focusRow(picked);
    return;
  }
  if (!modeOn()) return;
  const hit = layer.pickSurface(event, camera, canvas);
  if (!hit) return;
  snapshot();
  state.annotations.push({ p: hit.p, n: hit.n, m: hit.m, text: '', c: 0 });
  syncPins();
  buildRows();
  focusRow(state.annotations.length - 1);
}

// -----------------------------------------------------------------------------
// Panel section
// -----------------------------------------------------------------------------

/** Push the current pin list into the WebGL layer. */
function syncPins() {
  if (layer) layer.setPins(state.annotations);
}

/**
 * Re-sync pin visibility after a part was shown/hidden in the parts panel
 * (pins follow the mesh they were placed on).
 */
export function syncAnnotationVisibility() {
  syncPins();
}

/**
 * Per-frame hook: keep pins riding the deformed surface while an animation
 * or morph plays (no-op for static models). Called from the render loop.
 */
export function updateAnnotationLayer() {
  if (layer) layer.update();
}

/**
 * Build one row: [badge (colour popover)]|[field + delete inside]. The badge
 * opens a NATIVE popover with the colour presets — top layer, so it can never
 * be clipped by the panel's scroll boxes (popovertarget needs no JS at all;
 * light dismiss comes free with popover="auto"-style behaviour).
 * @param {{p: number[], n: number[], m?: number, text: string, c?: number}} pin
 * @param {number} i pin index
 * @returns {HTMLElement}
 */
function buildRow(pin, i) {
  const row = el('div', { cls: 'note-row' });

  const badge = el('button', {
    cls: 'note-num pin-c' + (pin.c || 0),
    text: String(i + 1),
    attrs: { popovertarget: 'note-colors-' + i, title: 'Pick a pin colour' },
  });
  const colors = el('div', {
    cls: 'note-colors',
    attrs: { id: 'note-colors-' + i, popover: '', role: 'menu' },
  });
  PIN_COLORS.forEach((hex, ci) => {
    const swatch = el('button', {
      cls: 'note-swatch pin-c' + ci + (ci === (pin.c || 0) ? ' active' : ''),
    });
    swatch.addEventListener('click', () => {
      colors.hidePopover();
      snapshot();
      pin.c = ci;
      syncPins();
      buildRows();
    });
    colors.append(swatch);
  });
  row.append(badge, colors);

  const field = el('div', { cls: 'note-field' });
  const text = el('textarea', {
    attrs: { rows: '1', placeholder: 'note…', title: 'Annotation text' },
  });
  text.value = pin.text;
  text.addEventListener('focus', snapshot); // one undo step per edit session
  text.addEventListener('input', () => {
    pin.text = text.value;
    syncPins();
  });
  const remove = el('button', { cls: 'note-del', attrs: { title: 'Delete this annotation' } });
  remove.insertAdjacentHTML('afterbegin', '<svg class="ico" viewBox="0 0 24 24"><use href="#i-close"></use></svg>');
  remove.addEventListener('click', () => {
    snapshot();
    state.annotations.splice(i, 1);
    syncPins();
    buildRows();
  });
  field.append(text, remove);
  row.append(field);
  return row;
}

/** Rebuild the side-panel rows. */
function buildRows() {
  const list = $('note-list');
  clearChildren(list);
  $('note-count').textContent = state.annotations.length ? String(state.annotations.length) : '';
  $('note-hint').classList.toggle('hidden', state.annotations.length > 0);
  state.annotations.forEach((pin, i) => list.append(buildRow(pin, i)));
}

/**
 * Rebuild the layer + panel for the current model. Called by buildPanels on
 * every load (annotations are per-model and start empty).
 */
export function refreshAnnotations() {
  if (layer) {
    layer.dispose();
    layer = null;
  }
  history.length = 0; // undo never crosses a model load
  const hasModel = !!state.root;
  $('panel-notes').classList.toggle('hidden', !hasModel);
  if (!hasModel) return;
  layer = createPinLayer(stageRef.scene, state.root, PALETTE);
  layer.setVisible(notesVisible);
  syncPins();
  buildRows();
}

// -----------------------------------------------------------------------------
// Wiring
// -----------------------------------------------------------------------------

/**
 * Wire the pin-mode button and viewport click handling.
 * @param {ReturnType<import('./stage.js').createStage>} stage the render stage
 */
export function initAnnotations(stage) {
  stageRef = stage;
  $('note-mode').addEventListener('click', () => setMode(!modeOn()));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setMode(false);
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
      const target = event.target;
      // Inside a text field the browser's own text undo applies.
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
      event.preventDefault();
      undo();
    }
  });

  // Visibility menu (eye icon in the tool column).
  $('vis-notes').addEventListener('change', () => {
    notesVisible = $('vis-notes').checked;
    if (layer) layer.setVisible(notesVisible);
  });
  $('vis-meshes').addEventListener('change', () => {
    const on = $('vis-meshes').checked;
    const boxes = document.querySelectorAll('#part-list input[type="checkbox"]');
    if (boxes.length) {
      // Drive the hierarchy rows so groups + meshes both follow.
      boxes.forEach((box) => {
        box.checked = on;
        box.dispatchEvent(new Event('change'));
      });
    } else {
      for (const mesh of state.originals.keys()) mesh.visible = on;
    }
    syncPins();
  });

  // Click vs orbit: a press that barely moves between down and up is a click.
  const press = { x: 0, y: 0, id: -1 };
  stage.canvas.addEventListener('pointerdown', (event) => {
    press.x = event.clientX;
    press.y = event.clientY;
    press.id = event.pointerId;
  });
  stage.canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId !== press.id) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_SLOP_PX) return;
    handleClick(event);
  });
}
