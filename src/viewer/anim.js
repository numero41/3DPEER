// =============================================================================
// anim.js (viewer)
//
// In-artifact animation playback. The recipient gets the same control the
// site has: pick a clip, play/pause, scrub. Ships whenever the model carries
// animation clips — playback controls are content, not chrome, so they are
// NOT gated behind __CFG.ui (an animated file without them is unplayable at
// the receiving end).
//
// The first clip auto-plays, matching the site's default selection. Only one
// clip runs at a time (playing every clip at once blends unrelated actions —
// the previous artifact behavior, which read as broken on multi-clip files).
//
// Plain DOM + classes from page.css; icons come from the bundled sprite
// (invariant #1 — nothing external, invariant #6 — no styles from JS).
// =============================================================================

import * as THREE from 'three';
import { SPRITE } from './sprite.js';

/**
 * Build the animation bar and mixer for a model's clips.
 * @param {THREE.Object3D} root the loaded model root
 * @param {THREE.AnimationClip[]} clips the model's animation clips
 * @returns {{ update: (delta: number) => void } | null} per-frame hook, or
 *   null when the model has no clips
 */
export function initAnimationControls(root, clips) {
  if (!clips || !clips.length) return null;

  const mixer = new THREE.AnimationMixer(root);
  let active = null;

  // The bundle carries its own inline icon sprite (shared with the notes UI).
  if (!document.querySelector('.icon-sprite')) {
    document.body.insertAdjacentHTML('afterbegin', SPRITE);
  }

  /**
   * Inline markup for one sprite icon.
   * @param {string} name icon name (without the i- prefix)
   * @returns {string}
   */
  const icon = (name) => '<svg class="ico" viewBox="0 0 24 24"><use href="#i-' + name + '"/></svg>';

  const bar = document.createElement('div');
  bar.id = 'anbar';
  // With no control bar beneath (ui not shipped), take its spot instead.
  if (!(window.__CFG && window.__CFG.ui)) bar.classList.add('solo');

  // clip selector — only worth the space when there is a choice
  let select = null;
  if (clips.length > 1) {
    select = document.createElement('select');
    select.title = 'Choose an animation clip';
    clips.forEach((clip, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = clip.name || 'clip ' + (i + 1);
      select.appendChild(option);
    });
    bar.appendChild(select);
  }

  const toggle = document.createElement('button');
  toggle.title = 'Play / pause the animation';
  toggle.setAttribute('aria-pressed', 'true');
  toggle.insertAdjacentHTML('afterbegin', icon('pause'));
  bar.appendChild(toggle);

  const scrub = document.createElement('input');
  scrub.type = 'range';
  scrub.min = '0';
  scrub.max = '1';
  scrub.step = '0.001';
  scrub.value = '0';
  scrub.title = 'Scrub the animation timeline';
  bar.appendChild(scrub);

  document.body.appendChild(bar);

  /** Refresh the play/pause glyph from the paused state. */
  function syncToggle() {
    const playing = active && !active.action.paused;
    toggle.setAttribute('aria-pressed', String(playing));
    toggle.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  }

  /**
   * Start one clip (stopping the previous), optionally paused.
   * @param {number} index clip index
   */
  function play(index) {
    if (active) active.action.stop();
    const clip = clips[index];
    const action = mixer.clipAction(clip);
    action.reset().play();
    active = { clip, action };
    syncToggle();
  }

  toggle.addEventListener('click', () => {
    if (!active) return;
    active.action.paused = !active.action.paused;
    syncToggle();
  });

  if (select) select.addEventListener('change', () => play(parseInt(select.value, 10)));

  scrub.addEventListener('input', () => {
    if (!active) return;
    active.action.paused = true;
    active.action.time = parseFloat(scrub.value) * active.clip.duration;
    mixer.update(0); // apply the pose immediately while paused
    syncToggle();
  });

  play(0);

  return {
    /**
     * Advance playback and keep the scrub handle in sync.
     * @param {number} delta seconds since the previous frame
     */
    update(delta) {
      if (!active) return;
      if (!active.action.paused) {
        mixer.update(delta);
        scrub.value = String((active.action.time % active.clip.duration) / active.clip.duration);
      }
    },
  };
}
