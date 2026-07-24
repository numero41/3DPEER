// =============================================================================
// menus.js
//
// Popover menus: any [data-menu] button inside a .menu-group toggles that
// group's .menu-pop open; only one popover is open at a time.
//
// All logic is DELEGATED to one document-level pointerdown listener so that
// popovers created after load (e.g. the per-annotation colour pickers) work
// without re-wiring. Running on pointerdown (not click) means a press
// anywhere outside — e.g. grabbing the viewport to orbit — dismisses the
// menu the moment the mouse goes down, without waiting for release.
// =============================================================================

const OPEN_CLASS = 'open';

/**
 * Close every popover and clear the expanded state on its button.
 */
export function closeMenus() {
  document.querySelectorAll('.menu-group.' + OPEN_CLASS).forEach((group) => {
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
  closeMenus();
  if (isOpen) return;
  group.classList.add(OPEN_CLASS);
  const button = group.querySelector('[data-menu]');
  if (button) button.setAttribute('aria-expanded', 'true');
}

/**
 * Wire the delegated open/close handling (works for dynamic menu groups too).
 */
export function initMenus() {
  document.addEventListener('pointerdown', (event) => {
    const button = event.target.closest('[data-menu]');
    if (button) {
      toggleGroup(button.closest('.menu-group'));
      return;
    }
    // Presses inside an open popover must not dismiss it; anywhere else does.
    if (event.target.closest('.menu-pop')) return;
    closeMenus();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenus();
  });
}
