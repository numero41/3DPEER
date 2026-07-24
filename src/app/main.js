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
import { initTooltips } from './tooltips.js';
import { initLoader } from './loader.js';
import { initMaterialControls } from './materials.js';
import { initLighting } from './lighting.js';
import { initMenus } from './menus.js';
import { initSidePanel } from './panels.js';
import { initViews } from './views.js';
import { initAnnotations } from './annotate.js';
import { initExport } from './exporter.js';
import { initDecimatePreview } from './decimate-preview.js';
import { initCompressionSettings } from './comp-settings.js';
import { SPRITE } from './sprite.js';
import { setStatus } from './ui.js';
import { $ } from './dom.js';

// site/sprite.js already inserted the sprite while the page was parsing (it
// has to land before the first <use href="#i-…">). This is the fallback for
// any page that does not load it.
if (!document.querySelector('.icon-sprite')) {
  document.body.insertAdjacentHTML('afterbegin', SPRITE);
}

// Static title= attributes become instant CSS tooltips before anything else
// reads the DOM (dynamic elements get data-tip through the el() helper).
initTooltips();

const stage = createStage();

// Feature wiring.
initLoader(stage);
initMaterialControls();
initLighting(stage);
initMenus();
initSidePanel();
initViews(stage);
initAnnotations(stage);
initExport(stage);
initDecimatePreview();
initCompressionSettings();

// Licensing is not live yet: say so plainly rather than leaving a dead button.
$('signin').addEventListener('click', () =>
  setStatus('Accounts are not live yet — every feature is free and exported files carry a watermark.', 'info'));

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
  stage.update();
  stage.render();
});
