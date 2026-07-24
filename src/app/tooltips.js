// =============================================================================
// tooltips.js
//
// Instant tooltips: native title= bubbles appear after a ~1 s hover delay the
// page cannot control, so every static [title] is converted once at boot into
// a [data-tip] attribute rendered by CSS (site.css) — visible the moment the
// pointer enters. Dynamically created controls get data-tip through the el()
// helper (dom.js), which performs the same conversion.
//
// SVG <title> children (the camera-cube faces) are left untouched — they are
// elements, not attributes, and keep their native behaviour.
// =============================================================================

/**
 * Convert every static title attribute into an instant CSS tooltip.
 */
export function initTooltips() {
  document.querySelectorAll('[title]').forEach((node) => {
    node.setAttribute('data-tip', node.getAttribute('title'));
    node.removeAttribute('title');
  });
}
