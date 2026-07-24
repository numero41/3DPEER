// panels.js — the scene panel's sections (notes, objects, blend shapes) and
// the viewport's transport bar.
//
// Each section auto-shows only when the model has that content; the panels
// themselves are always docked. Contents are rebuilt on every load, and
// playback state lives in state.js.

import * as THREE from 'three';
import { collectMorphs } from '../viewer/morphs.js';
import { refreshAnnotations, syncAnnotationVisibility } from './annotate.js';
import { refreshPolyCount } from './hud.js';
import { state } from './state.js';
import { $, clearChildren, el } from './dom.js';

/** Start (or restart) clip `i`, stopping any other playing clip. */
export function playClip(i) {
  state.actions.forEach(({ action }) => action.stop());
  const a = state.actions[i];
  a.action.reset().play();
  a.action.paused = false;
  state.activeAction = a;
  syncAnimToggle(true);
}

/**
 * Reflect the playing state on the play/pause button (sprite icon + ARIA),
 * mirroring the artifact's own control (src/viewer/anim.js).
 * @param {boolean} playing whether a clip is currently advancing
 */
function syncAnimToggle(playing) {
  const button = $('anim-toggle');
  button.setAttribute('aria-pressed', String(playing));
  button.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
}

/** node -> { set, isOn } for its outliner row, so a group toggle can cascade. */
const partBoxes = new Map();

/** outliner row -> its DIRECT child rows, for collapse/expand. */
const rowChildren = new Map();

/** While the pointer is held down on an eye, the state it paints onto every
 *  other eye it slides over (DCC-style drag-to-toggle); null when idle. */
let eyePaint = null;

// One release ends any paint stroke, wherever it happens.
addEventListener('pointerup', () => { eyePaint = null; });
addEventListener('pointercancel', () => { eyePaint = null; });

/** Tag the first visible scene section so dividers land between the rest. */
function refreshSideVisibility() {
  const ids = ['panel-notes', 'panel-parts', 'panel-morphs'];
  let first = true;
  for (const id of ids) {
    const section = $(id);
    const visible = !section.classList.contains('hidden');
    section.classList.toggle('first-visible', visible && first);
    if (visible) first = false;
  }
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

/** Names an exporter invents; they carry no information for the reader. */
const GENERIC_NAME_RE = /^(group|geo|mesh|components|node|object)[\s_-]*\d*$/i;

/** Deepest indent step available in site.css (rows below it stop stepping). */
const MAX_INDENT_DEPTH = 9;

/**
 * Strip a trailing `_12`-style suffix. A USD mesh bound to several materials
 * is imported as one three.js mesh PER material, named `x`, `x_1`, `x_2`… —
 * one model part, many objects.
 * @param {string} name
 * @returns {string}
 */
function nameStem(name) {
  return (name || '').replace(/_\d+$/, '');
}

/**
 * Bundle sibling meshes that are the material-split pieces of one model part
 * (`x`, `x_1`, `x_2`…) so the outliner shows one row for one part. Anything
 * else is passed through as its own single-node group, in order.
 * @param {THREE.Object3D[]} nodes geometry-bearing siblings
 * @returns {Array<{nodes: THREE.Object3D[], label: string}>}
 */
function groupSiblings(nodes) {
  /** @type {Array<{nodes: THREE.Object3D[], label: string}>} */
  const groups = [];
  const byStem = new Map();
  for (const node of nodes) {
    const stem = node.isMesh ? nameStem(node.name) : null;
    if (!stem) {
      groups.push({ nodes: [node], label: node.name });
      continue;
    }
    const existing = byStem.get(stem);
    if (existing) {
      existing.nodes.push(node);
    } else {
      const group = { nodes: [node], label: stem };
      byStem.set(stem, group);
      groups.push(group);
    }
  }
  return groups;
}

/**
 * Walk down a chain of single-child pass-through groups, returning the node to
 * actually show and the best label for it. Importers wrap meshes in several
 * anonymous levels (wearables › hair › geo_7 › Mesh), which buries real parts
 * so deep they read as missing.
 * @param {THREE.Object3D} node
 * @returns {{node: THREE.Object3D, label: string}}
 */
function collapseChain(node) {
  let current = node;
  /** Every informative name met on the way down, outermost first. */
  const names = [];
  const keep = (name) => {
    if (name && !GENERIC_NAME_RE.test(name) && names[names.length - 1] !== name) names.push(name);
  };
  keep(current.name);
  while (!current.isMesh) {
    const children = current.children.filter(hasGeometry);
    if (children.length !== 1) break;
    current = children[0];
    keep(current.name);
  }
  // Show the most specific names — the deepest one is what the user looks for
  // (a chain like wearables › hair › geo_7 › Mesh must still read as "hair").
  return { node: current, label: names.slice(-2).join(' / ') };
}

/**
 * Append one outliner row and recurse into its children. A row stands for one
 * model part, which may be several three.js objects (a USD mesh bound to
 * several materials imports as one object per material).
 * @param {{nodes: THREE.Object3D[], label: string}} group the part
 * @param {HTMLElement} list the container
 * @param {number} depth nesting level (for indentation)
 * @param {number} index sibling index (fallback label)
 */
function appendPartRow(group, list, depth, index) {
  const single = group.nodes.length === 1;
  const collapsed = single ? collapseChain(group.nodes[0]) : null;
  const nodes = single ? [collapsed.node] : group.nodes;
  const kind = nodes.every((n) => n.isMesh) ? 'mesh' : 'group';
  const label = (single ? collapsed.label : group.label) || kind + ' ' + index;

  // No tooltip on the row itself: hovering a list of objects should not pop a
  // label that only repeats the name already on screen.
  const row = el('div', { cls: 'part-row depth-' + Math.min(depth, MAX_INDENT_DEPTH) });

  // Disclosure triangle: present on every row so names stay aligned, but
  // inert (and invisible) when the row has nothing under it.
  const twisty = el('button', {
    cls: 'part-twisty',
    attrs: { 'aria-label': 'Collapse or expand ' + label, 'aria-expanded': 'true' },
  });
  twisty.insertAdjacentHTML('afterbegin', '<svg class="ico" viewBox="0 0 24 24"><use href="#i-chevron"></use></svg>');

  // Visibility: an eye that closes when the part is hidden.
  const eye = el('button', {
    cls: 'part-eye',
    attrs: { 'aria-label': 'Show or hide ' + label, 'aria-pressed': 'true' },
  });
  eye.insertAdjacentHTML('afterbegin', '<svg class="ico" viewBox="0 0 24 24"><use href="#i-eye"></use></svg>');

  const name = el('span', { cls: 'part-name part-' + kind, text: label });

  /**
   * Reflect one visibility state on this row (icon, ARIA, dimmed name).
   * @param {boolean} visible
   */
  const paint = (visible) => {
    eye.setAttribute('aria-pressed', String(visible));
    eye.querySelector('use').setAttribute('href', visible ? '#i-eye' : '#i-eye-off');
    row.classList.toggle('part-hidden', !visible);
  };
  paint(nodes.every((n) => n.visible));

  for (const node of nodes) partBoxes.set(node, { set: paint, isOn: () => nodes.every((n) => n.visible) });

  /**
   * Apply one visibility state to this part and everything under it.
   * @param {boolean} next
   */
  const applyVisibility = (next) => {
    if (eye.getAttribute('aria-pressed') === String(next)) return;
    // Toggling a part cascades to every object under it (a hidden group hides
    // everything below, its rows included).
    for (const node of nodes) {
      node.traverse((child) => {
        child.visible = next;
        const entry = partBoxes.get(child);
        if (entry) entry.set(next);
      });
    }
    paint(next);
    syncAnnotationVisibility();
    refreshPolyCount();
  };

  // Press starts a stroke and flips this row; sliding over other eyes paints
  // the same state onto them, so a whole run of parts hides in one gesture.
  eye.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    eyePaint = eye.getAttribute('aria-pressed') !== 'true';
    applyVisibility(eyePaint);
  });
  eye.addEventListener('pointerenter', () => {
    if (eyePaint !== null) applyVisibility(eyePaint);
  });
  // Keyboard and assistive activation still work through a plain click.
  eye.addEventListener('click', (event) => {
    if (event.detail === 0) applyVisibility(eye.getAttribute('aria-pressed') !== 'true');
  });

  row.append(twisty, eye, name);
  list.append(row);

  // Split pieces have no meaningful sub-structure to show.
  if (!single) {
    row.classList.add('part-leaf');
    return;
  }
  const children = groupSiblings(nodes[0].children.filter(hasGeometry));
  if (!children.length) {
    row.classList.add('part-leaf');
    return;
  }
  const firstChildIndex = list.children.length;
  children.forEach((child, i) => appendPartRow(child, list, depth + 1, i));
  // Direct children only — nested rows are reached through their own entry,
  // so a subtree collapsed inside a subtree stays collapsed when the outer
  // one re-opens.
  rowChildren.set(row, [...list.children].slice(firstChildIndex)
    .filter((child) => list.children[firstChildIndex] === child
      || child.classList.contains('depth-' + Math.min(depth + 1, MAX_INDENT_DEPTH))));
  twisty.addEventListener('click', () => {
    const open = twisty.getAttribute('aria-expanded') !== 'true';
    twisty.setAttribute('aria-expanded', String(open));
    applyCollapse(row, open);
  });
}

/**
 * Show or hide one row's subtree, honouring rows collapsed further down.
 * @param {HTMLElement} row the row whose children are toggled
 * @param {boolean} open whether the row is expanding
 */
function applyCollapse(row, open) {
  for (const child of rowChildren.get(row) || []) {
    child.classList.toggle('row-collapsed', !open);
    const twisty = child.querySelector('.part-twisty');
    const childOpen = open && twisty && twisty.getAttribute('aria-expanded') === 'true';
    applyCollapse(child, childOpen);
  }
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
  groupSiblings(scene.children.filter(hasGeometry))
    .forEach((group, i) => appendPartRow(group, list, 0, i));
}

/** Build the transport bar across the bottom of the viewport (clip picker
 *  when there is a choice, play/pause, scrub, time readout). */
function buildAnimations() {
  const bar = $('transport');
  bar.classList.toggle('hidden', state.actions.length === 0);
  if (!state.actions.length) return;

  const sel = $('anim-select');
  clearChildren(sel);
  // One clip needs no picker; the bar stays a play button and a timeline.
  sel.classList.toggle('hidden', state.actions.length < 2);
  state.actions.forEach(({ clip }, i) => {
    sel.append(el('option', { text: clip.name || 'clip ' + i, attrs: { value: String(i) } }));
  });
  sel.onchange = () => playClip(parseInt(sel.value, 10));

  $('anim-toggle').onclick = () => {
    if (!state.activeAction) { playClip(parseInt(sel.value, 10)); return; }
    state.activeAction.action.paused = !state.activeAction.action.paused;
    syncAnimToggle(!state.activeAction.action.paused);
  };

  $('anim-scrub').oninput = (e) => {
    if (!state.activeAction) return;
    const a = state.activeAction;
    a.action.paused = true;
    a.action.time = parseFloat(e.target.value) * a.clip.duration;
    state.mixer.update(0);
    syncAnimToggle(false);
    syncAnimTime();
  };
  syncAnimTime();
}

/** Write the transport's time readout from the active clip. */
export function syncAnimTime() {
  const a = state.activeAction;
  $('anim-time').textContent = a ? a.action.time.toFixed(2) + 's' : '0.00s';
}

/**
 * Rebuild every section for a freshly loaded model.
 * @param {{scene: THREE.Object3D}} gltf
 */
export function buildPanels(gltf) {
  rowChildren.clear();
  refreshAnnotations();
  buildMorphs(gltf.scene);
  buildParts(gltf.scene);
  buildAnimations();
  refreshSideVisibility();
  refreshPolyCount();
}

