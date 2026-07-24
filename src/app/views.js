// views.js — camera view presets, fit, snapshot and fullscreen.
//
// The view buttons are the faces of the unfolded-cube widget (bottom-left of
// the stage); each carries a data-view attribute, so the same handler serves
// the cube faces and the perspective button.

import * as THREE from 'three';
import { state } from './state.js';
import { $ } from './dom.js';

/** Unit direction (from centre) for each named view. */
const VIEWS = {
  front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0],
  right: [1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0], persp: [1, 0.5, 1],
};

/**
 * Wire camera views, fit, snapshot and fullscreen.
 * @param {ReturnType<import('./stage.js').createStage>} stage
 */
export function initViews(stage) {
  const { renderer, scene, camera, controls, canvas, resize, frameObject } = stage;

  // --- view presets (cube faces + perspective) ------------------------------
  document.querySelectorAll('[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      const d = VIEWS[b.dataset.view];
      if (!d) return;
      camera.position.copy(state.center)
        .add(new THREE.Vector3(...d).normalize().multiplyScalar(state.dist));
      camera.updateProjectionMatrix();
      controls.update();
    }));

  // --- fit / recenter -------------------------------------------------------
  $('fit').addEventListener('click', () => {
    if (!state.root) return;
    const framed = frameObject(state.root);
    state.center.copy(framed.center);
    state.dist = framed.dist;
  });

  // --- quad view ------------------------------------------------------------
  $('quad').addEventListener('click', () => {
    const on = $('quad').getAttribute('aria-pressed') !== 'true';
    $('quad').setAttribute('aria-pressed', String(on));
    $('stage').classList.toggle('quad', on); // draws the pane separators
    stage.setQuad(on);
  });

  // --- snapshot (PNG of the current frame, quad included) -------------------
  $('snapshot').addEventListener('click', () => {
    stage.render();
    canvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = state.name + '.png';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  });

  // --- fullscreen -----------------------------------------------------------
  // Fullscreen takes the WHOLE workbench, so the scene panel, the export
  // panel and the status line stay available while the viewport grows.
  const fsTarget = document.querySelector('.workbench');
  $('fullscreen').addEventListener('click', () => {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen).call(fsTarget);
  });
  const fsUse = $('fullscreen').querySelector('use');
  ['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) =>
    document.addEventListener(ev, () => {
      const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
      fsUse.setAttribute('href', on ? '#i-fullscreen-exit' : '#i-fullscreen');
      // The layout is driven by this class, not by :fullscreen — one selector
      // instead of three vendor-prefixed ones, and it can be tested.
      fsTarget.classList.toggle('fullscreen', on);
      // The row only reflows on the next frame; the canvas is refitted after
      // that, then once more in case the fullscreen transition is animated.
      requestAnimationFrame(() => { resize(); requestAnimationFrame(resize); });
    }));
}
