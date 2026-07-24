// panels.js — the right-side overlay panel: animations, morphs and parts.
//
// Each section auto-shows only when the model has that content. The whole
// panel (and its edge toggle) is hidden when the model has none of them.
// Contents are rebuilt on every load; playback state lives in state.js.

import * as THREE from 'three';
import { collectMorphs } from '../viewer/morphs.js';
import { refreshAnnotations, syncAnnotationVisibility } from './annotate.js';
import { state } from './state.js';
import { $, clearChildren, el } from './dom.js';

/** Start (or restart) clip `i`, stopping any other playing clip. */
export function playClip(i) {
  state.actions.forEach(({ action }) => action.stop());
  const a = state.actions[i];
  a.action.reset().play();
  a.action.paused = false;
  state.activeAction = a;
  $('anim-toggle').textContent = 'Pause';
}

/** node -> its visibility checkbox, so a group toggle can cascade. */
const partBoxes = new Map();

/** Show the side panel + edge toggle iff at least one section is visible, and
 *  tag the first visible section so section dividers land between the rest. */
function refreshSideVisibility() {
  const ids = ['panel-notes', 'panel-anims', 'panel-morphs', 'panel-parts'];
  let first = true;
  for (const id of ids) {
    const section = $(id);
    const visible = !section.classList.contains('hidden');
    section.classList.toggle('first-visible', visible && first);
    if (visible) first = false;
  }
  const anyVisible = !first;
  $('side').classList.toggle('has-content', anyVisible);
  $('panel-toggle').classList.toggle('hidden', !anyVisible);
  if (!anyVisible) $('side').classList.remove('open');
}

/** Build the morphs section (one slider per named morph target). */
function buildMorphs(scene) {
  const morphs = collectMorphs(scene);
  const box = $('panel-morphs');
  const list = $('morph-list');
  clearChildren(list);
  box.classList.toggle('hidden', morphs.size === 0);
  $('morph-count').textContent = morphs.size ? String(morphs.size) : '';
  for (const [name, targets] of morphs) {
    const row = el('label', { cls: 'slider-row', attrs: { title: 'Morph: ' + name } });
    row.append(el('span', { text: name }));
    const r = el('input', { attrs: { type: 'range', min: '0', max: '1', step: '0.01', value: '0', title: 'Blend ' + name } });
    r.addEventListener('input', () => {
      for (const { mesh, index } of targets) mesh.morphTargetInfluences[index] = parseFloat(r.value);
    });
    row.append(r);
    list.append(row);
  }
  $('morph-reset').onclick = () => list.querySelectorAll('input').forEach((r) => {
    r.value = 0;
    r.dispatchEvent(new Event('input'));
  });
}

/**
 * @param {THREE.Object3D} node
 * @returns {boolean} whether node is a mesh or has a mesh descendant.
 */
function hasGeometry(node) {
  if (node.isMesh) return true;
  return node.children.some(hasGeometry);
}

/**
 * Append one hierarchy row (indented) and recurse into geometry-bearing
 * children. Each row's checkbox drives that node's visibility; a group node
 * hides its whole subtree (three inherits visibility at render).
 * @param {THREE.Object3D} node
 * @param {HTMLElement} list the container
 * @param {number} depth nesting level (for indentation)
 * @param {number} index sibling index (fallback label)
 */
function appendPartRow(node, list, depth, index) {
  const kind = node.isMesh ? 'mesh' : 'group';
  const label = node.name || kind + ' ' + index;
  const row = el('label', {
    cls: 'part-row depth-' + Math.min(depth, 6),
    attrs: { title: 'Show / hide ' + label },
  });
  const box = el('input', { attrs: { type: 'checkbox' } });
  box.checked = node.visible;
  partBoxes.set(node, box);
  box.addEventListener('change', () => {
    // Toggling a node cascades to its whole subtree (a hidden group hides
    // everything under it, checkboxes included).
    node.traverse((child) => {
      child.visible = box.checked;
      const childBox = partBoxes.get(child);
      if (childBox) childBox.checked = box.checked;
    });
    syncAnnotationVisibility();
  });
  row.append(box, el('span', { cls: 'part-name part-' + kind, text: label }));
  list.append(row);

  const children = node.children.filter(hasGeometry);
  children.forEach((child, i) => appendPartRow(child, list, depth + 1, i));
}

/** Build the parts section as the real scene hierarchy (visibility per node). */
function buildParts(scene) {
  const box = $('panel-parts');
  const list = $('part-list');
  clearChildren(list);
  partBoxes.clear();
  let meshCount = 0;
  scene.traverse((o) => { if (o.isMesh) meshCount++; });
  box.classList.toggle('hidden', meshCount < 1);
  if (meshCount < 1) return;
  // The GLTF scene root is a wrapper; show its geometry-bearing children.
  scene.children.filter(hasGeometry).forEach((child, i) => appendPartRow(child, list, 0, i));
}

/** Build the animations section (clip picker + play/pause + scrub). */
function buildAnimations() {
  const box = $('panel-anims');
  box.classList.toggle('hidden', state.actions.length === 0);
  if (!state.actions.length) return;

  const sel = $('anim-select');
  clearChildren(sel);
  state.actions.forEach(({ clip }, i) => {
    sel.append(el('option', { text: clip.name || 'clip ' + i, attrs: { value: String(i) } }));
  });
  sel.onchange = () => playClip(parseInt(sel.value, 10));

  $('anim-toggle').onclick = () => {
    if (!state.activeAction) { playClip(parseInt(sel.value, 10)); return; }
    state.activeAction.action.paused = !state.activeAction.action.paused;
    $('anim-toggle').textContent = state.activeAction.action.paused ? 'Play' : 'Pause';
  };

  $('anim-scrub').oninput = (e) => {
    if (!state.activeAction) return;
    const a = state.activeAction;
    a.action.paused = true;
    a.action.time = parseFloat(e.target.value) * a.clip.duration;
    state.mixer.update(0);
    $('anim-toggle').textContent = 'Play';
  };
}

/**
 * Rebuild every section for a freshly loaded model.
 * @param {{scene: THREE.Object3D}} gltf
 */
export function buildPanels(gltf) {
  refreshAnnotations();
  buildMorphs(gltf.scene);
  buildParts(gltf.scene);
  buildAnimations();
  refreshSideVisibility();
}

/** Wire the toggle that opens/closes the docked side panel (icon flips). */
export function initSidePanel() {
  const toggle = $('panel-toggle');
  toggle.addEventListener('click', () => {
    const open = $('side').classList.toggle('open');
    toggle.querySelector('use').setAttribute('href', open ? '#i-panel-close' : '#i-panel-open');
    // Docking/undocking the panel reflows the row, so the canvas must re-fit
    // its box — otherwise the drawing buffer keeps the old size and letterboxes.
    requestAnimationFrame(() => dispatchEvent(new Event('resize')));
  });
}
