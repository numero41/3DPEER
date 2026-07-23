// =============================================================================
// annotations.js
//
// Single source for the artifact's annotation slot: a JSON array of pins that
// lives between two comment markers on the `window.__ANN=` line of the
// exported HTML. The packer writes the slot, the viewer reads it at boot and
// rewrites it when the recipient saves an annotated copy (self-re-export).
//
// A pin is { p: [x,y,z], n: [x,y,z], text: string } — position and surface
// normal in model space (the root object's local frame), so the same pin
// lands on the same spot in the workbench and in the artifact.
//
// Why split/join on markers is unambiguous by construction:
//   - both markers contain '<', a character the base85 alphabet excludes
//     (invariant #5), so the payload can never contain a marker;
//   - encodeAnnotations escapes every '<' to the u003c form, so the JSON
//     itself can never contain a marker (or close the script tag), whatever
//     the user types;
//   - the marker literals are assembled at runtime via Array.join — NOT by
//     '+' concatenation, which esbuild constant-folds into the whole marker
//     inside the minified viewer bundle (caught by the packer self-test) —
//     so they never appear contiguously in the bundled source.
// String.replace is never used here (invariant #4).
//
// This module is isomorphic (Node + browser, zero dependencies) — it is
// imported by the CLI packer, the site exporter and the artifact viewer.
// =============================================================================

/** Opening marker of the annotation slot ('<' keeps it out of the payload). */
export const ANN_START = ['/*<', '3DP', ':ANN*/'].join('');

/** Closing marker of the annotation slot. */
export const ANN_END = ['/*<', '/3DP', ':ANN*/'].join('');

/**
 * Serialize a pin list to JSON safe for a <script> body: every '<' becomes
 * the backslash-u003c escape, which JSON.parse and the JS parser both read
 * back as '<'.
 * @param {Array<{p: number[], n: number[], text: string}>} list the pins
 * @returns {string} script-safe JSON
 */
export function encodeAnnotations(list) {
  return JSON.stringify(list).split('<').join('\\u003c');
}

/**
 * Wrap a pin list in the slot markers, ready to substitute into the template.
 * @param {Array<{p: number[], n: number[], text: string}>} list the pins
 * @returns {string} marker + JSON + marker
 */
export function wrapAnnotations(list) {
  return ANN_START + encodeAnnotations(list) + ANN_END;
}

/**
 * Split an artifact HTML string on the slot markers.
 * @param {string} html a full artifact
 * @returns {{before: string, json: string, after: string}}
 * @throws when either marker is absent or appears more than once
 */
function splitSlot(html) {
  const head = html.split(ANN_START);
  if (head.length !== 2) throw new Error('annotation slot: start marker count is ' + (head.length - 1));
  const tail = head[1].split(ANN_END);
  if (tail.length !== 2) throw new Error('annotation slot: end marker count is ' + (tail.length - 1));
  return { before: head[0], json: tail[0], after: tail[1] };
}

/**
 * Replace the slot contents of an artifact with a new pin list.
 * @param {string} html a full artifact
 * @param {Array<{p: number[], n: number[], text: string}>} list the new pins
 * @returns {string} the rebuilt artifact HTML
 */
export function injectAnnotations(html, list) {
  const slot = splitSlot(html);
  return slot.before + wrapAnnotations(list) + slot.after;
}

/**
 * Read the pin list out of an artifact.
 * @param {string} html a full artifact
 * @returns {Array<{p: number[], n: number[], text: string}>}
 */
export function extractAnnotations(html) {
  return JSON.parse(splitSlot(html).json);
}
