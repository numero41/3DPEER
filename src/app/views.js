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

  // --- snapshot (PNG of the current frame) ----------------------------------
  $('snapshot').addEventListener('click', () => {
    renderer.render(scene, camera);
    canvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = state.name + '.png';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  });

  // --- fullscreen -----------------------------------------------------------
  const stageEl = $('stage');
  $('fullscreen').addEventListener('click', () => {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (stageEl.requestFullscreen || stageEl.webkitRequestFullscreen).call(stageEl);
  });
  ['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) =>
    document.addEventListener(ev, () => requestAnimationFrame(resize)));
}
