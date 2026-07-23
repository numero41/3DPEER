# 3DPEER

3D model -> a single .html file: double-click, email attachment, offline,
touch rotation. The model, its decompressor and its viewer travel together.

## Commands

    npm install
    npm run pack -- model.glb output.html --bits 12 --title "My model"
    npm test

## Directory tree

    src/codec/     base85, 3DPEER container, quantization — ISOMORPHIC (Node + browser).
                   These modules are shared by BOTH the packer AND the viewer: a single
                   source of truth for the format. The future drag-drop site will
                   reuse them as-is on the client side.
    src/pack/      Node side: gzip envelope, geo/gltf modes, assembly, self-tests
    src/viewer/    browser side: decode, shared scene, morphs, geo/gltf boots
    src/template/  page.html + page.css for the artifact (placeholders {{...}},
                   substitution via split/join — never String.replace, the payload
                   contains $)
    scripts/       pack.mjs CLI, test.mjs regression (procedural fixtures, zero binaries)
    docs/          technical description

## Modes

geo  — static geometry: custom 3DPEER streams, quantized GPU buffers as-is
gltf — skins / morphs / animations / textures: optimized GLB (gltf-transform CLI)
       in the same envelope, GLTFLoader paired with three r160, morph sliders

Pinned versions: meshoptimizer 0.20 (vertex codec v0) + three 0.160 —
encoder/decoder pair tested across the whole browser fleet since 2023.
Every HTML produced is self-tested (re-extraction + full decoding).
