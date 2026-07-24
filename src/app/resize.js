// =============================================================================
// resize.js
//
// Draggable edges around the viewport: the two vertical handles set the side
// panels' widths, the bottom one sets the viewport height. Clicking a panel's
// title collapses it to a labelled strip and clicking again restores it.
//
// On invariant #6 ("no element.style"): the invariant exists so APPEARANCE
// never leaks out of the stylesheets. A dimension the user drags is data, not
// appearance, and it has no class-based equivalent — a continuous value cannot
// be enumerated. It is written as a CUSTOM PROPERTY on :root (--scene-w,
// --export-w, --stage-h), which site.css alone decides what to do with; no
// appearance property is ever set from here, and no element carries a style
// attribute. Everything else (collapsed, dragging) still goes through classes.
// =============================================================================

import { $ } from './dom.js';

/** Smallest a side panel may be dragged to, mirroring --panel-min. */
const PANEL_MIN = 200;

/** Bounds for the viewport height (px). */
const STAGE_MIN_H = 320;
const STAGE_MAX_H = 1400;

/**
 * Write one layout dimension for the stylesheet to consume.
 * @param {string} name custom property name, without the leading dashes
 * @param {number} px value in pixels
 */
function setDimension(name, px) {
  document.documentElement.style.setProperty('--' + name, px + 'px');
}

/**
 * Wire one drag handle.
 * @param {string} handleId the handle element
 * @param {(event: PointerEvent, start: {x: number, y: number,
 *          value: number}) => void} onDrag applies the new dimension
 * @param {() => number} readValue current value, sampled when the drag starts
 */
function wireHandle(handleId, onDrag, readValue) {
  const handle = $(handleId);
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('dragging');
    const start = { x: event.clientX, y: event.clientY, value: readValue() };
    const move = (moveEvent) => onDrag(moveEvent, start);
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      handle.classList.remove('dragging');
      // The canvas must re-fit its box after the row reflows.
      dispatchEvent(new Event('resize'));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  });
}

/**
 * Collapse or expand one panel (class-driven; the strip layout is CSS).
 * @param {string} headId the title button
 * @param {string} panelId the panel it belongs to
 */
function wireCollapse(headId, panelId) {
  const head = $(headId);
  const panel = $(panelId);
  head.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    panel.classList.toggle('open', !collapsed);
    head.setAttribute('aria-expanded', String(!collapsed));
    requestAnimationFrame(() => dispatchEvent(new Event('resize')));
  });
}

/**
 * Wire the three handles and the two collapse toggles.
 */
export function initResize() {
  const width = (panelId) => $(panelId).getBoundingClientRect().width;

  // Left handle: dragging right widens the scene panel.
  wireHandle('handle-left', (event, start) => {
    setDimension('scene-w', Math.max(PANEL_MIN, start.value + (event.clientX - start.x)));
  }, () => width('side-left'));

  // Right handle: dragging left widens the export panel.
  wireHandle('handle-right', (event, start) => {
    setDimension('export-w', Math.max(PANEL_MIN, start.value - (event.clientX - start.x)));
  }, () => width('side-right'));

  // Bottom handle: dragging down makes the viewport taller.
  wireHandle('handle-bottom', (event, start) => {
    const next = start.value + (event.clientY - start.y);
    setDimension('stage-h', Math.min(STAGE_MAX_H, Math.max(STAGE_MIN_H, next)));
    dispatchEvent(new Event('resize'));
  }, () => $('stage').getBoundingClientRect().height);

  wireCollapse('side-left-head', 'side-left');
  wireCollapse('side-right-head', 'side-right');
}
