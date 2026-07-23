# CLAUDE.md — 3dpeer

Project: a "3D model → self-contained .html file" packer. A GLB goes in, a
single file comes out; it opens by double-click, as an attachment, offline.
The phased roadmap is in ROADMAP.md. This file lists the invariants —
each one encodes a real bug or a product decision. Do not break them.

## Commands

    npm run pack -- input.glb output.html [--bits 12] [--title "..."] [--texsize 2048]
    npm test                # regression: procedural fixtures, fails if a self-test breaks
    npm run build:site      # bundles the workbench + export assets
    npm run dev             # serves site/ on http://localhost:8137

## Absolute invariants

1. **The artifact is self-contained.** Zero network requests in the exported
   HTML: no fetch, no CDN, no external asset. Everything is inlined. It must
   work over file://, as an email attachment, ten years from now.

2. **Pinned codec pairs.** meshoptimizer 0.20.0 (vertex codec v0) +
   three 0.160.0, encoder and decoder from the SAME package. History: a
   1.2.0 encoder (codec v1) produced "malformed buffer data" on mobile
   while the Node test passed. Any version bump is done on both
   sides at once, with an attachment re-test on a real mobile device.

3. **The self-test targets the produced HTML**, never only the
   intermediates: re-extraction of the payload from the final file +
   full decoding with the three r160 decoder (the most conservative in the
   fleet). Any feature that touches the artifact adds its own self-test.

4. **Placeholders via split/join, never String.replace.** The base85 payload
   contains `$` — `.replace` would corrupt it via the `$&`/`$$` patterns.
   See put() in src/pack/assemble.js and src/app/main.js.

5. **Base85, not base64.** Custom alphabet in src/codec/base85.js: no `"`,
   no `\`, no `<` — the `</script` sequence is impossible by construction,
   and the overhead is +25 % instead of +33 %. Do not reintroduce base64.

6. **Zero CSS in the HTML or the JS.** Site styles in site/site.css,
   artifact styles in src/template/page.css. States go through
   classes. No style attribute, no element.style, no <style>
   generated in JS. (Explicit requirement from David.)

7. **The container format has a single source**: src/codec/container.js.
   Magic 0x33445001 ("3DP" + version), 80-byte header. Any evolution
   of the layout ⇒ version bump in the magic + backward-compatible parse.
   Packer and viewer import this module — never offsets copied by hand.

8. **src/codec/ stays isomorphic** (Node + browser, zero dependencies):
   this is what lets the site share the format with the CLI. Nothing from
   Node (Buffer, fs, zlib) in this folder. gzip: zlib on the pack side,
   CompressionStream/DecompressionStream on the browser side.

9. **Never any binary fixtures in the repo.** The tests generate their GLBs
   procedurally (scripts/test.mjs). David's large files serve
   local trials, not versioning.

10. **The user's geometry is sacred.** Simplification disengaged
    by default (--simplify false everywhere); decimation is an opt-in
    slider, never a silent default.

## Product decisions to respect

- One file → one artifact. No multi-file gallery in v1.
- "Nothing leaves this browser" is an architectural promise: the site
  must not acquire any upload endpoint.
- The "protection" (obfuscation, watermark, expiration) is graduated
  deterrence, documented as such — never sold as DRM.
- .ma/.mb: definitive refusal to parse; the answer is the Maya shelf
  "Send to 3DPEER" (GLB export + opening the site).
- trimesh/Python: no. Decimation goes through the meshopt simplifier already
  in dependencies.
- "made with 3dpeer" footer in free artifacts; its removal is
  the first paid feature.

## Aesthetics

Site: monochrome dark — page #161618, light-grey text #d6d6da, dark-grey
buttons #2c2c31 (one shade for every button, export included), neutral-grey
viewport #262626; system-sans UI with mono only for the wordmark and
technical readouts; zero marketing gradient. The viewer is a centered
~800×800 card (fullscreen on demand); camera/material/light live in three
icon menus at the bottom of the view, export + progress beneath the card.
Artifact: dark background #211a14, amber caption #c9a978. Two registers,
one restrained palette.

## Known pitfalls

- file:// blocks fetch: the artifact makes none; the SITE does (export
  assets) → always test the site via npm run dev, not over file://.
- Workers over file://: via Blob URL only, if ever needed.
- The wire+shaded overlay does not follow SkinnedMesh (assumed for v0).
- iOS < 16.4 does not have DecompressionStream: the artifact shows a clean
  error in #hint — intended behavior, not a bug to "fix" with a
  heavy polyfill.
