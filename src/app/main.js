// =============================================================================
// main.js
//
// Workbench entry point. Injects the icon sprite, builds the render stage, wires
// each feature module to the DOM, and runs the render loop. Everything of
// substance lives in its own module; this file only orchestrates. No styles are
// set here — all styling is in site/site.css.
// =============================================================================

import { state } from './state.js';
import { createStage } from './stage.js';
import { initLoader } from './loader.js';
import { initMaterialControls } from './materials.js';
import { initLighting } from './lighting.js';
import { initMenus } from './menus.js';
import { initSidePanel } from './panels.js';
import { initViews } from './views.js';
import { initExport } from './exporter.js';
import { SPRITE } from './sprite.js';
import { $ } from './dom.js';

// Inject the inline icon sprite so <use href="#i-..."> resolves with no fetch.
document.body.insertAdjacentHTML('afterbegin', SPRITE);

const stage = createStage();

// Feature wiring.
initLoader(stage);
initMaterialControls();
initLighting(stage);
initMenus();
initSidePanel();
initViews(stage);
initExport();

// Render loop: advance any playing animation, keep the scrub bar in sync, and
// draw. OrbitControls needs update() every frame for damping.
stage.resize();
stage.renderer.setAnimationLoop(() => {
  if (state.mixer && state.activeAction && !state.activeAction.action.paused) {
    state.mixer.update(state.clock.getDelta());
    const active = state.activeAction;
    $('anim-scrub').value = String((active.action.time % active.clip.duration) / active.clip.duration);
  } else {
    state.clock.getDelta(); // keep the clock current even while paused
  }
  stage.controls.update();
  stage.renderer.render(stage.scene, stage.camera);
});
