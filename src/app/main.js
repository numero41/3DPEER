// main.js — workbench entry point. Wires the modules together and runs the
// render loop. Everything substantial lives in its own module; this file only
// orchestrates. No styles here (invariant #6).

import { state } from './state.js';
import { createStage } from './stage.js';
import { initLoader } from './loader.js';
import { initDisplayControls } from './display-modes.js';
import { initSidePanel } from './panels.js';
import { initViews } from './views.js';
import { initExport } from './exporter.js';
import { $ } from './dom.js';

const stage = createStage();

initLoader(stage);
initDisplayControls();
initSidePanel();
initViews(stage);
initExport();

stage.resize();
stage.renderer.setAnimationLoop(() => {
  // advance the active animation and keep the scrub bar in sync
  if (state.mixer && state.activeAction && !state.activeAction.action.paused) {
    state.mixer.update(state.clock.getDelta());
    const a = state.activeAction;
    $('anim-scrub').value = String((a.action.time % a.clip.duration) / a.clip.duration);
  } else {
    state.clock.getDelta(); // keep the clock current even when paused
  }
  stage.controls.update();
  stage.renderer.render(stage.scene, stage.camera);
});
