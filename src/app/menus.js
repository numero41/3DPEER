// =============================================================================
// menus.js
//
// The viewport toolbar: three icon buttons (camera / material / light), each
// opening a popover that lists its options. Only one popover is open at a time;
// a click outside or the Escape key closes it. The popover contents (camera
// cube, material radios, light radios) are wired by their own modules — this
// file only manages open/close state.
// =============================================================================

import { $ } from './dom.js';

// Each toolbar button carries data-menu="<id>", matching a popover #menu-<id>.
const OPEN_CLASS = 'open';

/**
 * Close every popover and clear the pressed state on its button.
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
 * Wire the toolbar buttons and the global close handlers (outside-click, Esc).
 */
export function initMenus() {
  document.querySelectorAll('[data-menu]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleGroup(button.closest('.menu-group'));
    });
  });

  // Clicks inside an open popover must not close it; clicks anywhere else do.
  document.querySelectorAll('.menu-pop').forEach((pop) =>
    pop.addEventListener('click', (event) => event.stopPropagation()));
  document.addEventListener('click', closeAll);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAll();
  });
}
