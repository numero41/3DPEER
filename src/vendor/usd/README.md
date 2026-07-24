# src/vendor/usd

The official three.js **USDLoader** addon (USDA + **binary USDC crate**
support), vendored from **three r0.185.0** (MIT — same license as three) and
run against this repo's pinned three r160:

    https://cdn.jsdelivr.net/npm/three@0.185.0/examples/jsm/loaders/USDLoader.js
    https://cdn.jsdelivr.net/npm/three@0.185.0/examples/jsm/loaders/usd/*.js

Why vendored instead of bumping three: invariant #2 pins three 0.160.0 to the
meshoptimizer codec pair for the artifact path. This loader is a SITE-side
import concern only — it never touches the artifact codec path — and every
`three` symbol it imports exists in r160 (verified at vendor time).

Local patches (keep when refreshing):

- `USDLoader.js`: fflate import re-pointed to
  `three/examples/jsm/libs/fflate.module.js` (r160's copy), `./usd/*` imports
  flattened to `./*`.
- `USDComposer.js`: `applyTransform()` honours USD `visibility` (invisible)
  and `purpose` (proxy/guide) by setting `obj.visible = false`, so a loaded
  package shows what QuickLook shows. Grep for "LOCAL PATCH (3dpeer)".
- Nested usdz-inside-usdz packages are handled OUTSIDE the loader by
  `src/app/usdz.js` (the multi-layer walker feeds each package separately).

To refresh: download the four files from the new three version, re-apply the
import patches, run the usdz fixtures + a real usdc file in the browser.
