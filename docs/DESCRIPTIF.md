# 3dpeer — technical description
### 3D model → self-contained HTML file. v0.1, July 2026.

## Purpose

A command-line packer: a GLB goes in, a single `.html` file comes out. That file opens by double-click, as an email or WhatsApp attachment, offline, on mobile as well as desktop. Finger rotation, pinch to zoom, auto-rotation at rest. No server, no account, no network request: the model, its decompressor and its viewer travel together inside the file. The recipient installs nothing — the only runtime required is the browser, already present everywhere.

It's the principle of the self-extracting zip applied to 3D: the archive contains its own decompressor, the presentation contains its own rendering engine.

## Anatomy of the delivered file

The produced HTML contains three things. A minimal skeleton (full-screen canvas, a caption that fades out, `#211a14` background). A first `<script>` carrying the payload: the compressed model, encoded in base85 in a JS literal, preceded by a caption. A second `<script>` carrying the bundled and minified viewer (~610 KB): three.js core, OrbitControls, RoomEnvironment and the meshopt 0.20 decoder with its WASM inlined.

## Compression pipeline

Seven stages, with the figures measured on the reference file (976 k vertices, 1.9 M triangles, per-vertex colors, no texture):

1. **Prune** (`keepAttributes:false`) — removal of orphan attributes. On the reference file, 15 MB of tangents and 8 MB of UVs that no texture referenced.
2. **Join + weld** — merging of compatible primitives, welding of equivalent vertices.
3. **In-house quantization** — positions on 12 bits (configurable via `--bits`) stored as uint16 with stride 8, normals as int8 stride 4, colors as uint8 RGBA stride 4. Maximum measured geometric error: 0.007 % of the bounding box diagonal — invisible. Dequantization costs nothing at load time: it is carried by the object's matrix (see below).
4. **Reordering** (`reorderMesh`) — reorganization of vertices for the GPU cache. Serves twice: better stream compression AND better rendering throughput.
5. **Meshopt encoding, vertex codec v0** — `encodeVertexBuffer` / `encodeIndexBuffer`. The choice of v0 is deliberate: it's the one every browser decoder has digested since 2023 (see "lessons").
6. **gzip -9** — the meshopt streams are designed to be run back through an entropy coder. Client-side decoding is native (`DecompressionStream`), so it's free: zero bytes of decompressor to embed for this stage. On the reference: 8.3 MB → 2.95 MB.
7. **Base85 with a proprietary alphabet** — 85 symbols chosen to be safe in a double-quoted JS literal: no `"`, no `\`, no `<`, so the `</script` sequence is impossible by construction. +25 % overhead versus +33 % for base64. Frame `[u32 length][gzip][%4 padding]`.

Bottom line on the reference: **62.05 MB → 4.24 MB** (÷14.6), complete file viewer included, in ~10 s of packing.

## 3DPEER container format, version 1

| Offset | Type | Content |
|---|---|---|
| 0 | u32 BE | magic `0x4E343101` ("3DPEER" + version) |
| 4 | u32 LE | vertex count |
| 8 | u32 LE | index count |
| 12 | f32 ×3 | bbox min |
| 24 | f32 ×3 | bbox size |
| 36 | f32 ×4 | baseColorFactor |
| 52 | f32 | metallic |
| 56 | f32 | roughness |
| 60 | u32 | quantization bits |
| 64 | u32 ×4 | lengths of the 4 streams: pos, nrm, col, idx |
| 80 | — | concatenated meshopt streams |

There is no longer any GLB in the delivered file: nothing standard to extract. A private binary container, in an unknown alphabet, behind a gzip. This is graduated deterrence, not DRM — a determined attacker instruments WebGL — but trivial extraction ("open the devtools, save the .glb") no longer exists.

## GPU hydration

The decoded streams are uploaded as-is, without conversion to float: positions `Uint16Array` via `InterleavedBuffer` (stride 4 elements, not normalized), normals `Int8Array` (normalized), colors `Uint8Array` RGBA (normalized), indices `Uint32Array`. Position dequantization is done by the vertex shader via the object's matrix: `mesh.scale = bbox_size / (2^bits − 1)` per axis, `mesh.position = bbox_min`. Three's normalMatrix (inverse-transpose) correctly absorbs the non-uniform scale for lighting. The bounding sphere is computed in quantized space then transformed by the world matrix for culling. Result: roughly half the VRAM compared to float32, and near-zero CPU load cost.

## Rendering

`MeshStandardMaterial` with `vertexColors` multiplied by the `baseColorFactor` (glTF semantics), metallic/roughness from the source material. Image-based lighting: PMREM generated from `RoomEnvironment` — a procedural studio, so zero embedded HDRI asset. ACES tone mapping, sRGB output, pixelRatio capped at 2.

## Robustness — built-in lessons

**Paired codecs.** First development incident: meshoptimizer 1.2.0 (2026) encoder emitting vertex codec v1, unreadable by the decoders embedded in the three ≤ 2024 fleet → "malformed buffer data" on mobile while the Node self-test passed (same lib on both sides). Resolution: the whole project is pinned to meshoptimizer 0.20.0, codec v0, encoder and decoder from the same package.

**The self-test targets the artifact, not the intermediates.** On each packing, the tool re-extracts the `__P` string from the final produced HTML, decodes it entirely (base85 → gzip → meshopt) with the **three r160** decoder — deliberately the oldest and most conservative in the fleet — and compares bit-for-bit with the source streams. A delivered file is a file whose complete decoding path has been executed.

**Client compatibility.** `DecompressionStream`: Chrome/Edge 80+, Safari/iOS 16.4+, Firefox 113+. WebGL2 required (three r160). Below that, the file shows a clean error in the caption rather than a blank screen.

## Known limitations, v0

A single primitive packed (subsequent ones are ignored with a warning). No textures — the image pipeline (WebP/KTX2) is the next big stage. No animations or skinning. Normals required in the source GLB. The "protection" is deterrence, not key-based encryption.

## Product roadmap

Short term: multi-primitive and multi-material; textures (WebP recompression, size cap, native browser decoding); animations (resample + meshopt compression of curves, the viewer already knows how to play them). Product: quality slider with live before/after comparison and displayed weight; one-click triple export (.html interactive, .usdz for the Apple ecosystem, .mp4 turntable 9:16 for feeds); single-file progressive LOD (silhouette shown in ~300 ms while the full model decodes); forensic watermark in the low-order bits of the quantization — each recipient gets a differently marked file, identifiable in case of a leak; expiration date; drag-drop interface for non-coders; Lemon Squeezy licensing.

## Reproduction

```
npm install
node pack.mjs model.glb output.html --bits 12 --title "My model"
```

Reference figures (50playgrounds_cube_00): source GLB 62.05 MB → 3DPEER container 8.34 MB → gzip 2.95 MB → base85 3.68 MB → **final HTML 4.24 MB**, three r160 self-test: OK.
