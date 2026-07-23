// =============================================================================
// menus.js
//
// The viewport toolbar: three icon buttons (camera / material / light), each
// opening a popover that lists its options. Only one popover is open at a time.
//
// All open/close logic runs on pointerdown (not click) so a press anywhere
// outside — e.g. grabbing the viewport to orbit — dismisses the menu the moment
// the mouse goes down, without waiting for release. The popover contents are
// wired by their own modules; this file only manages open/close state.
// =============================================================================

import { $ } from './dom.js';

const OPEN_CLASS = 'open';

/**
 * Close every popover and clear the expanded state on its button.
 */
function closeAll() {
  document.querySelectorAll('.menu-group').forEach((group) => {
    group.classList.remove(OPEN_CLASS);
    const button = group.querySelector('[data-menu]');
    if (button) button.setAttribute('aria-expanded', 'false');
  });
}

/**
 * Toggle one popover open, closing any other that was open.
 * @param {HTMLElement} group the .menu-group wrapping the button + popover
 */
function toggleGroup(group) {
  const isOpen = group.classList.contains(OPEN_CLASS);
  closeAll();
  if (isOpen) return;
  group.classList.add(OPEN_CLASS);
  const button = group.querySelector('[data-menu]');
  if (button) button.setAttribute('aria-expanded', 'true');
}

/**
 * Wire the toolbar buttons and the global dismiss handlers (outside press, Esc).
 */
export function initMenus() {
  // Toolbar buttons toggle their popover on press.
  document.querySelectorAll('[data-menu]').forEach((button) => {
    button.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      toggleGroup(button.closest('.menu-group'));
    });
  });

  // Presses inside an open popover must not dismiss it.
  document.querySelectorAll('.menu-pop').forEach((pop) =>
    pop.addEventListener('pointerdown', (event) => event.stopPropagation()));

  // A press anywhere else dismisses immediately; so does Escape.
  document.addEventListener('pointerdown', closeAll);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAll();
  });
}
