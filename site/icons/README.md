# site/icons

SVG icons for the workbench UI. **Source: [Lucide](https://lucide.dev)**
(ISC license — free for commercial use, attribution not required).
Download each as SVG from `https://lucide.dev/icons/<lucide-name>` and save it
here under the target filename below.

Style to keep consistent: 24×24 viewBox, `stroke="currentColor"`,
`fill="none"`, `stroke-width` 1.5–1.75, round caps/joins. The site colours them
via `currentColor`, so leave no hard-coded colours in the files.

> Note: these are for the **site** only. The exported artifact must stay
> self-contained (invariant #1), so its handful of viewer icons are inlined at
> build time, never referenced from this folder.

## Viewer chrome (top-right + toggles)

| filename            | Lucide name          | used for                         |
|---------------------|----------------------|----------------------------------|
| `fit.svg`           | `scan`               | fit / recenter the camera        |
| `snapshot.svg`      | `camera`             | save a PNG snapshot              |
| `fullscreen.svg`    | `maximize`           | enter fullscreen                 |
| `fullscreen-exit.svg` | `minimize`         | exit fullscreen                  |
| `panel-open.svg`    | `panel-right-open`   | open the right-side panel        |
| `panel-close.svg`   | `panel-right-close`  | close the right-side panel       |

## Right-side panel

| filename       | Lucide name    | used for                    |
|----------------|----------------|-----------------------------|
| `eye.svg`      | `eye`          | part visible                |
| `eye-off.svg`  | `eye-off`      | part hidden                 |
| `reset.svg`    | `rotate-ccw`   | reset morphs                |
| `play.svg`     | `play`         | play animation              |
| `pause.svg`    | `pause`        | pause animation             |
| `loop.svg`     | `repeat`       | loop animation              |

## Export + compression

| filename        | Lucide name           | used for                        |
|-----------------|-----------------------|---------------------------------|
| `export.svg`    | `download`            | export the .html                |
| `auto.svg`      | `wand-sparkles`       | auto (target-size) compression  |
| `sliders.svg`   | `sliders-horizontal`  | per-parameter compression       |
| `decimate.svg`  | `shrink`              | mesh decimation                 |
| `target.svg`    | `target`              | target file size                |
| `settings.svg`  | `settings-2`          | advanced settings               |

## Empty state / misc

| filename      | Lucide name      | used for                     |
|---------------|------------------|------------------------------|
| `upload.svg`  | `upload`         | dropzone                     |
| `info.svg`    | `info`           | hints / help                 |
| `close.svg`   | `x`              | dismiss                      |
| `chevron.svg` | `chevron-left`   | generic disclosure           |

## Not from a set (bespoke — do not download)

- **Camera cube** (bottom-left views): a hand-built unfolded-cube SVG net,
  already inline in `site/index.html`. No stock icon matches it.
- **Display modes** (shaded / clay / matcap / wire / wire+shaded): these read
  best as text or as small 3D-render thumbnails, not line icons — kept as text
  for now.

## Wiring them in

Once downloaded, reference them from the site with inline `<use>` from a sprite
or `<img src="icons/fit.svg">`. Say the word and I'll swap the current inline
placeholder SVGs (`fit`, `snapshot`, `fullscreen`, `panel-toggle`) over to
these files and build a small sprite so there's one request instead of many.
