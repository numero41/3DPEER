# 3dpeer — ROADMAP

Working document for the workshop (Claude Code). Each phase has an objective,
tasks and a "done when" criterion. Do not open a phase before the
previous one passes its criterion. The project invariants are in CLAUDE.md —
read them before any modification.

## Phase 0 — foundations (DONE)

Two packing modes (geo: custom 3DPEER streams, quantized GPU buffers;
gltf: optimized GLB, paired GLTFLoader, morph sliders), gzip + base85
envelope, self-test on the produced HTML, workbench site v0 (drag-drop,
display modes, views, snapshot, auto morphs/parts/anims panels, real
non-optimized export). Measured references: cube 62.05 → 4.20 MB (÷14.8),
avatar 6.52 → 1.10 MB with 212 morphs.

## Phase 1 — in-browser compression (the heart of the product)

Objective: the site's export produces the same quality as the CLI, without the
file leaving the browser.

- Port the optimization pipeline to the browser side: prune/weld/resample/
  quantize via @gltf-transform (core + functions run in the browser),
  meshopt 0.20 encoder in WASM, simplify() via the meshopt simplifier.
- Remove the CLI execSync from gltf mode: a single programmatic code path
  shared between Node/browser (src/pack becomes isomorphic where possible).
- Textures on the browser side: decode image → canvas → toBlob('image/webp', q)
  with a size cap (sharp stays reserved for the CLI).
- Wire up the sliders: position bits, normal bits, texture size + quality,
  anim resample tolerance, decimation ratio/error.
- UX: live before/after wipe, estimated weight displayed continuously, a
  "target weight" field (simple solver that lowers the sliders down to budget).

Done when: from the site, the 62 MB cube comes out at ≤ 5 MB and the avatar at
≤ 1.3 MB, mobile opening < 3 s, viewer self-test OK, zero bytes sent
over the network (verifiable in the Network tab).

## Phase 2 — imports

Objective: accept what the audience actually has on its disk.

- obj, stl, ply: three loaders → GLTFExporter → existing pipeline.
  (stl = 3D printing; ply with vertex colors = scans → geo mode.)
- fbx: FBXLoader (web, approximate materials assumed); FBX2glTF binary
  on the CLI side for fidelity.
- Maya "Send to 3DPEER" shelf: Python script that exports the selection to
  GLB and opens the site. It's an acquisition channel, not a feature.
- usdz on IMPORT: P2, do not open before phase 4 (TinyUSDZ/WASM, big).

Done when: a test stl and ply pass drag-drop → export → mobile;
a simple fbx (mesh + anim) passes with a defensible render.

## Phase 3 — the enriched artifact + "what ships"

Objective: the export dialog becomes a capability checklist.

- Optional viewer modules in the artifact: animation controls, views,
  snapshot, parts show/hide, wireframe/clay modes.
- Export checklist: each box = editorial control (do not expose the
  topology to the client) and bytes. Pragmatic v1: one complete bundle per mode
  + injected JSON config that enables/disables; tree-shaking per bundle
  variant (real byte savings) awaits a server-side build or
  esbuild-wasm — P2, document the accepted overhead in the meantime.
- "portfolio" / "client review" presets.
- Discreet "made with 3dpeer" footer in the artifact + internal flag to
  remove it (prepares the phase 4 gating). The footer is the distribution
  loop: every delivered file is a demo.

Done when: two exports of the same model with two presets give two
artifacts with different capabilities, verified on opening.

## Phase 4 — multiple exports + NDA tier

- One-click triple export: .html (interaction), .usdz (three's USDZExporter,
  Apple ecosystem), turntable video (offscreen render of N frames →
  MediaRecorder webm; mp4 if a lightweight muxer is available).
- Forensic watermark: per-recipient seed in the low-order bits of
  the quantization + a small reader tool (identify a leak).
- Expiration date (deterrence, documented as such).
- Lemon Squeezy licensing: key verified locally (signature, zero server),
  footer removal, watermark/expiration unlock.

Done when: a Lemon Squeezy test purchase delivers a key that unlocks,
and a marked file is identifiable by the reader tool.

## Phase 5 — public site

- Pages: the app IS the landing; embedded examples (artifacts in iframes);
  pricing; short docs; Number41 legal notices.
- Cloudflare Pages deployment, 3dpeer.com domain, no third-party cookies.

Done when: an outside person goes from the URL to the exported file without
help, and sends it over WhatsApp successfully.

## Cross-cutting (to maintain at every phase)

- test.mjs enriched at each feature (procedural fixtures: anim, textures,
  multi-prims) — never binaries in the repo.
- Device matrix before any release: iOS Safari (Mail + Files
  attachment), Android Chrome, desktop file://.
- Budget: artifact opening < 3 s on an average mobile, viewer ≤ 650 KB/mode.
