// =============================================================================
// guide.js
//
// The guide modal: a native <dialog> over the workbench with a blurred
// backdrop (styles in site.css — the dialog and ::backdrop are pure CSS,
// states via the dialog's own open semantics, invariant #6 intact).
//
// showModal() gives the top layer, ESC-to-close and focus containment for
// free. A click on the backdrop closes (the dialog element itself is the
// click target only outside its content box). Deep links keep working:
// #guide in the URL opens the modal on load, and guide.html redirects here.
// =============================================================================

import { $ } from './dom.js';

/**
 * Wire the guide modal: nav button, close button, backdrop click, #guide hash.
 */
export function initGuide() {
  const modal = $('guide-modal');

  /** Drop the #guide hash if it is present. */
  function clearHash() {
    if (location.hash === '#guide') history.replaceState(null, '', location.pathname);
  }

  /** Open the modal and reflect it in the URL hash (deep-linkable). */
  function open() {
    if (!modal.open) modal.showModal();
    history.replaceState(null, '', '#guide');
  }

  /** Close the modal and drop the hash. */
  function close() {
    modal.close();
    clearHash();
  }

  $('guide-open').addEventListener('click', open);
  $('guide-close').addEventListener('click', close);

  // Backdrop click: inside the dialog every click targets a child; a click
  // whose target is the dialog element itself landed on the backdrop.
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });

  // ESC and any other native close path also drop the hash. (Cleanup happens
  // in close() too — not every embedded browser dispatches these events.)
  modal.addEventListener('cancel', clearHash);
  modal.addEventListener('close', clearHash);

  if (location.hash === '#guide') open();
}
