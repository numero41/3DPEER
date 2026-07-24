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
- **Phase 2 — imports** — obj/stl/ply/fbx/usdz via three loaders →
  GLTFExporter → the one GLB path. USDZ reads binary usdc crates through the
  vendored r185 USDLoader (multi-layer walker in src/app/usdz.js).
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
- **UX pass + USDZ (2026-07-24)** — grouped right tool column (panel toggle
  on top), docked side panel, instant CSS tooltips (data-tip), thin sliders,
  per-pin colour presets picked in overlay popovers, click the 3D tag to
  edit, hide-all-notes toggle (site + artifact), artifact ships its own icon
  sprite. USDZ: multi-layer package walker + vendored r185 pure-JS USDLoader
  reads binary usdc crates and nested usdz — the 363 MB GENIES avatar test
  file loads.
- **USD composition + viewer parity (2026-07-24)** — vendored parser fixes:
  crate STRINGS table off-by-two (subLayers/variant selections resolved to
  junk tokens), missing array types (bool/int64/string/vec2i/vec2-4d,
  compressed int64), StringVector + LayerOffsetVector scalars. Composer:
  GeomSubsets split a mesh only for face-typed materialBind subsets (pipeline
  point-subsets scrambled the GENIES head into holed chunks), faces outside
  every subset keep the mesh material (they were dropped), material:binding
  inherits from ancestors per UsdShade (eyes/teeth/tongue were untextured),
  and a measured sparse-bake heuristic swaps a direct-bound albedo that is
  mostly pure-black opaque for a dense ancestor material (GENIES partial AI
  bake vs full composite — logged when it fires). Shared visibleWorldBounds
  (src/viewer/bounds.js) for framing + pin leaders on both surfaces:
  setFromObject collapsed on quantized skinned meshes, framing artifacts on
  the feet and shrinking pin leaders. Decimate preview caches an identity
  index for non-indexed meshes (a null restore could never invalidate
  three's wireframe cache — the overlay stayed stuck on the last decimated
  topology). test.mjs: USDZExporter→import round-trip.
- **Artifact playback + compare (2026-07-24)** — the artifact ships
  animation controls whenever clips exist (clip select, play/pause, scrub —
  src/viewer/anim.js, NOT gated by __CFG.ui: playback is content, not
  chrome; one clip at a time replaces the old play-everything-at-once).
  The morph panel already shipped; verified live. Site: compare split view
  (M5 item, see below). Pins FOLLOW deformation on both surfaces: stored
  format stays {p, n}; each surface projects onto its own topology at load
  (nearest triangle + barycentric) and re-evaluates per frame — measured:
  morph Δy exactly 1.0 on the test cube, 45° bone bend swings the pin with
  the skinned tip, live in the exported artifact too. Viewer bundle 622 KB
  (budget 650). Known GENIES import gaps (not viewer bugs): SkelAnimation
  clips and USD BlendShapes are not composed into the GLB yet.

## Phase 1.5 — single-file LOD ladder

Goal: one artifact carries several detail levels of the same mesh and shows
the coarsest in under a second — heavy scans open instantly, then refine in
place. Node/CLI side; the export-panel control ships WIRED with the
in-browser geo packer port (no inert UI before that).

- Container v2, magic 0x33445002; parseHeader accepts v1 AND v2. Levels
  SHARE the vertex streams (the meshopt simplifier creates no vertices);
  only index streams differ. Header: lodCount, then per level: index-stream
  length, triangle count, simplification error (absolute, model units, via
  err × getScale — world units thanks to matrix dequantization).
- Packer (geo mode): simplification BEFORE quantization (float positions),
  every level simplified from the original, MeshoptSimplifier 0.20 (already
  a dependency). Default ratios 1 / 0.25 / 0.06 / 0.015; --lods 1|2|4 with
  2 = [1, 0.06] (the coarse level must stay light for the < 1 s boot);
  --preset review = [0.06, 0.015] for client rounds. reorderMesh keyed on
  the finest shipped level, the same remap applied to every index set; one
  vertex-stream set + N meshopt index streams, coarsest first in the file.
- Viewer (boot-geo): streaming decode; first pixel from the coarsest level
  (< 1 s), then switching by projected screen error (error / distance ×
  focal, ~1 px threshold, hysteresis 1 px up / 0.6 px down). Per-level
  index BufferAttributes are created once when their bytes land (one GPU
  upload each); switching is geometry.setIndex on a cached attribute,
  never a re-creation.
- The format stays extensible through the versioned magic + per-level
  table; no virtual-geometry work starts here.

Done when: the spike heightfield (2.88 M tris) ships the full ladder in one
file ≤ 12.5 MB and the review preset ≤ 1.6 MB (scripts/spike-lod.mjs is the
measured baseline, reproduced ±10 %), every self-test green, first coarse
pixel < 1 s.

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

## M-E — Enterprise tier (direction set 2026-07-24, research-verified)

Threat model first, honestly: a fully client-side app cannot technically stop
batch automation (headless Chromium drives any UI; the code ships to the
user; Squoosh is the precedent — Google never fought scripts, it shipped a
CLI). So "super secured batch" means: the WEBSITE never becomes the batch
product, and the free tier's protections are the visible watermark plus
clickwrap license terms ("interactive per-file use; automated/bulk
processing requires a commercial license" — enforceable against companies,
the only buyers that matter). Spend nothing on anti-automation tech.

- **Batch = licensed CLI**, grown from the existing pack CLI, distributed as
  a separate artifact. Gated by an OFFLINE Ed25519-signed license file
  {org, seats, expiry, features} verified with node:crypto — no activation
  server, no telemetry: "your models never leave your machines, not even
  for licensing". Expiring keys tied to updates so renewal has value.
- **Collaborative notes** — the one feature that genuinely needs a server:
  shared annotation threads / preset libraries / team galleries, sold
  hosted or self-hosted. Metadata only; model compression stays local, the
  core promise holds. The annotation slot format is the wire format.
- **Self-hosted bundle** (Photopea model, reported $500–2000/mo range):
  the built site + batch page + license file served on the customer's
  intranet. Nearly free to produce — the site already runs over file://.
- **Embeds** (Slack unfurl, ShotGrid/Flow, portfolio iframe from M6): the
  artifact is already the embed; ship the snippet + unfurl metadata first,
  integrations only on customer pull.
- Unlimited access = the free tier is already unlimited (pricing decision);
  enterprise adds seats/licensing paperwork procurement can sign.

## Engine & protection stance (research-verified 2026-07-24)

"Compiled so it can't be reverse engineered" is not achievable client-side:
wasm decompiles (wabt, Ghidra plugins, w2c2, LLM-assisted decompilers), and
LLM deobfuscators undo commercial JS obfuscation (~93 % execution-correct
on javascript-obfuscator output). The decoder half of the format ships
readable inside every artifact by design — the format is public by
construction. Consequences:
- Worth doing: offline Ed25519 license verification (WebCrypto + tiny
  vendored fallback), watermark applied at pack-time inside the template
  assembly, esbuild minification, AT MOST light obfuscation of the unlock
  check (M3 already says: buried, documented as deterrence).
- Not worth doing: heavy/commercial obfuscation (15–80 % runtime cost,
  breakage risk), rewriting the pipeline in wasm FOR SECRECY (fine for
  performance if ever needed), anti-debug tricks (hostile to a self-testing
  file:// artifact), any "cannot be reversed" claim.
- The moat is workflow, UX, the Maya shelf and artifact quality — the
  licensing layer only makes honesty convenient.

## M5 — Viewer tools (pick per demand)

- ~~Before/after compression wipe on the site~~ DONE 2026-07-24: compare
  split view (src/app/compare.js) — real pipeline output beside the
  original, one camera, draggable divider, auto-rebuild on settings change.
- Measurement: two clicks → world-space distance (pairs with STL users).
- Section plane: draggable clipping plane.
- Exploded view: parts drift apart on a slider (the parts list exists).

## M6 — Apple / AR + distribution helpers

- USDZ EXPORT via three's USDZExporter (one click → QuickLook AR on iPhone).
  Export is far easier than usdz import; do not confuse the two.
- Embed snippet: copy-paste <iframe> code for portfolios (the user hosts
  their own artifact — the no-server promise holds).
- USDZ IMPORT is handled (2026-07-24): multi-layer walker (src/app/usdz.js)
  + the official three USDLoader vendored from r185 (src/vendor/usd — pure
  JS, MIT, reads binary usdc crates; all imports exist in r160). Escalation
  if production crates hit parser gaps: TinyUSDZ wasm slim build (npm
  "tinyusdz", 1.38 MB raw / 542 KB gz, Apache-2.0 OR MIT, no
  SharedArrayBuffer). three-usdz-loader and Needle usd are ruled out
  (COOP/COEP + SharedArrayBuffer requirements; Needle is also
  PolyForm-Noncommercial).

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
