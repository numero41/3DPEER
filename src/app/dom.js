// dom.js — tiny DOM helpers shared across the workbench modules.
// No styling here: all styles live in site/site.css (project invariant #6).

/**
 * Look up an element by id.
 * @param {string} id
 * @returns {HTMLElement}
 */
export const $ = (id) => document.getElementById(id);

/**
 * Remove all children of an element (faster and safer than innerHTML = '').
 * @param {HTMLElement} el
 */
export function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/**
 * Create an element with optional class, text and attributes in one call.
 * A `title` attribute is stored as `data-tip` instead — the site renders
 * instant CSS tooltips from it (see tooltips.js).
 * @param {string} tag
 * @param {{cls?: string, text?: string, attrs?: Record<string,string>}} [opts]
 * @returns {HTMLElement}
 */
export function el(tag, opts = {}) {
  const node = document.createElement(tag);
  if (opts.cls) node.className = opts.cls;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      node.setAttribute(k === 'title' ? 'data-tip' : k, v);
    }
  }
  return node;
}
