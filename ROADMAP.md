# 3dpeer — ROADMAP

Working document for the workshop (Claude Code). Each milestone has a goal, a
design already agreed with David, and a "done when" criterion. Do not open a
milestone before the previous one passes its criterion. The project invariants
and working conventions are in CLAUDE.md — read them before any change.

## Done (reference numbers)

- **Foundations** — two packing modes (geo: custom 3DPEER streams; gltf:
  optimized GLB, paired GLTFLoader), gzip + base85 envelope, self-test on the
  produced HTML, workbench site (drag-drop, materials, lighting, panels).
- **Phase 1 — in-browser compression (the core)** — src/app/compress.js:
  dedup/prune → optional meshopt decimation → resample → quantization →
  canvas WebP textures → meshopt packing. Sliders + auto target-size solver
  (quality ladder, measures real output). Every site export self-tests in the
  browser: payload re-extracted and byte-compared, GLB re-decoded with the
  artifact's own r160 loader. Reference: TheFountain.glb 34.5 → 5.0 MB at
  defaults (85 %), 2.86 MB at a 3 MB auto target (92 %).
- **Phase 2 — imports (mostly)** — obj/stl/ply/fbx/usdz via three loaders →
  GLTFExporter → the one GLB path. USDZ partial: three r160 cannot read
  binary usdc crates; a clean warning is shown ("no geometry found").
- **Artifact** — optional shipped controls (__CFG.ui: camera views, six
  material presets, brightness + light-angle sliders), 2×2 poster grid
  (front/left/right/persp) for script-blocked previews (Gmail preview,
  iOS Mail, QuickLook), static no-JS fallback message.
- **Site** — monochrome dark, tokenized CSS, icon sprite (no runtime fetch,
  works over file://), guide + contact nav, collapsible export settings,
  colour-coded status (info/ok/warn), Web Share button with build cache.
- **M1 — Annotations** — pins + text authored on the site AND by the
  recipient inside the artifact. Slot codec in src/codec/annotations.js
  (marker-delimited JSON on the window.__ANN line; markers contain '<' so
  neither the base85 payload nor the escaped JSON can ever collide; markers
  assembled via Array.join so esbuild cannot fold them into the bundle).
  Shared WebGL pin layer (src/annotations/pins.js): numbered dot + leader
  line + label as sprites — no DOM positioned from JS. Site: pin-mode
  toggle, click-to-pin (raycast, model space), editable side-panel list,
  slot injected at export. Artifact: notes panel, recipient add/edit/delete,
  self-re-export from a pristine outerHTML capture (split/join), downloads
  <name>.annotated.3dpeer.html, localStorage crash net. Self-tests: CLI +
  site exports run a hostile rebuild probe (payload must stay byte-identical);
  the artifact re-checks before every save. page.css migrated to :root tokens.

## M2 — Turntable video (the email-body answer)

Goal: mail bodies cannot run scripts, so ship motion as media: offscreen
render of N frames orbiting the model → WebM via MediaRecorder (mp4 later if
a light muxer). Button next to export/share. The poster grid stays for
attachments; the turntable goes IN the mail body.

Done when: a 3-second loop of TheFountain plays in a mail client's body.

## M3 — Free watermark + paid unlock

Agreed direction (decided 2026-07-23): every feature free for everyone;
free artifacts carry a VISIBLE watermark overlay (corner badge — present but
not disfiguring) plus the "made with 3dpeer" footer. Paying removes them.
Do NOT limit compression or formats — they drive conversion and acquisition.

- License: Lemon Squeezy key, verified locally by signature (zero server).
- Implementation: watermark is part of the artifact template; the unlock flag
  flows through __CFG but must not be trivially editable — bury the check
  inside the minified viewer bundle (deterrence, documented as such,
  never sold as DRM).

Done when: a test purchase delivers a key that removes the watermark.

## M4 — NDA tier

- Forensic watermark: per-recipient seed written into the least-significant
  bits of quantized vertex positions (visually invisible, zero extra bytes,
  survives file copying). A small reader tool identifies which recipient's
  copy leaked. This is the "security in the bytes".
- Expiry date (deterrence, documented as such).
- Review-mode export preset for client rounds.

Done when: a marked file is identifiable by the reader tool.

## M5 — Viewer tools (pick per demand)

- Before/after compression wipe on the site (sells the compression).
- Measurement: two clicks → world-space distance (pairs with STL users).
- Section plane: draggable clipping plane.
- Exploded view: parts drift apart on a slider (the parts list exists).

## M6 — Apple / AR + distribution helpers

- USDZ EXPORT via three's USDZExporter (one click → QuickLook AR on iPhone).
  Export is far easier than usdz import; do not confuse the two.
- Embed snippet: copy-paste <iframe> code for portfolios (the user hosts
  their own artifact — the no-server promise holds).
- TinyUSDZ/WASM import for usdc crates: only if user demand shows up; heavy.

## Phase 5 — public site

- The app IS the landing; embedded example artifacts in iframes; pricing;
  the guide already exists; legal (Number41).
- Deploy on Cloudflare Pages, domain 3dpeer.com, zero third-party cookies.

Done when: an outsider goes from URL to an exported file without help and
successfully sends it via WhatsApp.

## Transverse (every milestone)

- test.mjs grows with every feature that touches the pack path; the site
  export self-test grows with every feature that touches the artifact.
- Device matrix before any release: iOS Safari (Mail attachment + Files),
  Android Chrome, desktop file://. A codec-touching change requires a re-test
  on a REAL mobile device (invariant #2 exists because of a real incident).
- Budgets: artifact opens < 3 s on mid-range mobile; viewer ≤ 650 KB per mode
  (currently 592 KB — check after every viewer change).
