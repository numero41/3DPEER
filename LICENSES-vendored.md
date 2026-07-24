# Vendored third-party code — licenses

This repository vendors (copies into the tree, rather than installing from
npm) the third-party code below. Each entry records the upstream project,
the exact origin, the license, and the local modification policy. Runtime
npm dependencies (three, meshoptimizer, @gltf-transform/*) are NOT listed
here — their licenses ship inside `node_modules/` as usual.

## src/vendor/usd/ — three.js USDLoader family

- **Files**: `USDLoader.js`, `USDAParser.js`, `USDCParser.js`, `USDComposer.js`
- **Upstream**: [three.js](https://github.com/mrdoob/three.js) r185,
  `examples/jsm/loaders/USDLoader.js` and its parser/composer modules
  (pure-JS USD/USDA/USDC/USDZ reading)
- **License**: MIT (full text below)
- **Why vendored**: the pinned runtime three version is r160 (codec-pair
  invariant #2 in CLAUDE.md); the USD loader family only exists upstream
  from r185, and every import it needs is already present in r160.
- **Local modifications**: marked with `LOCAL PATCH (3dpeer)` comments in
  place (crate string-table fix, missing crate value types, GeomSubset
  filtering, ancestor material bindings, Catmull-Clark subdivision,
  package-relative asset resolution, visibility/purpose handling, sparse
  partial-bake stash). Diff against upstream r185 to enumerate precisely.

### MIT License (three.js)

```
The MIT License

Copyright © 2010 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
```

## site/icons/ — Lucide icons

- **Files**: `site/icons/*.svg` (mapping table in `site/icons/README.md`)
- **Upstream**: [Lucide](https://lucide.dev) (`lucide-static`)
- **License**: ISC — free for commercial use, attribution not required
- **Local modifications**: none beyond keeping the 24×24 `currentColor`
  stroke style; two bespoke glyphs (`fit.svg` "1:1", noted in the README)
  are original to this project.

### ISC License (Lucide)

```
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as
part of Feather (MIT). All other copyright (c) for Lucide are held by
Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```
