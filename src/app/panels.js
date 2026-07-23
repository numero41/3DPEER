// panels.js — the right-side overlay panel: animations, morphs and parts.
//
// Each section auto-shows only when the model has that content. The whole
// panel (and its edge toggle) is hidden when the model has none of them.
// Contents are rebuilt on every load; playback state lives in state.js.

import * as THREE from 'three';
import { collectMorphs } from '../viewer/morphs.js';
import { refreshAnnotations } from './annotate.js';
import { state } from './state.js';
import { $, clearChildren, el } from './dom.js';

/** Start (or restart) clip `i`, stopping any other playing clip. */
export function playClip(i) {
  state.actions.forEach(({ action }) => action.stop());
  const a = state.actions[i];
  a.action.reset().play();
  a.action.paused = false;
  state.activeAction = a;
  $('anim-toggle').textContent = 'pause';
}

/** Show the side panel + edge toggle iff at least one section is visible. */
function refreshSideVisibility() {
  const anyVisible = ['panel-notes', 'panel-anims', 'panel-morphs', 'panel-parts']
    .some((id) => !$(id).classList.contains('hidden'));
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
    const row = el('label', { cls: 'slider-row' });
    row.append(el('span', { text: name }));
    const r = el('input', { attrs: { type: 'range', min: '0', max: '1', step: '0.01', value: '0' } });
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

/** Build the parts section (one visibility checkbox per named mesh). */
function buildParts(scene) {
  const box = $('panel-parts');
  const list = $('part-list');
  clearChildren(list);
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  box.classList.toggle('hidden', meshes.length < 2);
  meshes.forEach((m, i) => {
    const label = m.name || 'mesh ' + i;
    const row = el('label', { cls: 'check-row', attrs: { title: 'Toggle visibility of ' + label } });
    const c = el('input', { attrs: { type: 'checkbox' } });
    c.checked = true;
    c.addEventListener('change', () => { m.visible = c.checked; });
    row.append(c, el('span', { text: label }));
    list.append(row);
  });
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
    $('anim-toggle').textContent = state.activeAction.action.paused ? 'play' : 'pause';
  };

  $('anim-scrub').oninput = (e) => {
    if (!state.activeAction) return;
    const a = state.activeAction;
    a.action.paused = true;
    a.action.time = parseFloat(e.target.value) * a.clip.duration;
    state.mixer.update(0);
    $('anim-toggle').textContent = 'play';
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

/** Wire the edge toggle that opens/closes the side panel. */
export function initSidePanel() {
  $('panel-toggle').addEventListener('click', () => $('side').classList.toggle('open'));
}
