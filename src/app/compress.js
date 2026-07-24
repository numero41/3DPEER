// =============================================================================
// compress.js
//
// The in-browser optimization pipeline (the core of the product): GLB in,
// smaller GLB out, no byte leaving the machine.
//
// Stages: dedup/prune -> optional meshopt decimation -> animation resample ->
// quantization (KHR_mesh_quantization) -> texture recompression to WebP via
// canvas -> meshopt packing (EXT_meshopt_compression). Encoder and decoder are
// both meshoptimizer 0.20 / three 0.160 — the pinned pair (invariant #2).
//
// The user's geometry is sacred (invariant #10): decimation runs only when the
// slider asks for it, never by default.
// =============================================================================

import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, resample, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

/**
 * @typedef {Object} CompressSettings
 * @property {number} posBits    position quantization bits (8..16)
 * @property {number} nrmBits    normal quantization bits (6..12)
 * @property {number} texSize    texture max edge in px (powers of two)
 * @property {number} texQuality WebP quality 30..100 (100 keeps originals)
 * @property {number} decimate   percent of triangles to remove (0 = off)
 */

/** @type {CompressSettings} sensible defaults: visually safe, decimation off. */
export const DEFAULT_SETTINGS = {
  posBits: 12,
  nrmBits: 8,
  texSize: 2048,
  texQuality: 85,
  decimate: 0,
};

// -----------------------------------------------------------------------------
// Texture recompression (browser canvas -> WebP)
// -----------------------------------------------------------------------------

/**
 * Re-encode every raster texture: cap the size at settings.texSize and encode
 * as WebP at settings.texQuality. A texture is only replaced when the new
 * bytes are actually smaller. Undecodable images (e.g. KTX) are left alone.
 * @param {import('@gltf-transform/core').Document} doc
 * @param {CompressSettings} settings
 */
async function recompressTextures(doc, settings) {
  const textures = doc.getRoot().listTextures();
  if (!textures.length || settings.texQuality >= 100) return;

  let converted = false;
  for (const texture of textures) {
    const image = texture.getImage();
    const mime = texture.getMimeType();
    if (!image || !/^image\/(png|jpeg|webp)$/.test(mime)) continue;

    let bitmap;
    try {
      bitmap = await createImageBitmap(new Blob([image], { type: mime }));
    } catch {
      continue; // undecodable: keep the original bytes
    }

    const scale = Math.min(1, settings.texSize / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/webp', settings.texQuality / 100));
    if (!blob) continue; // WebP unsupported here: keep the original

    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length >= image.length && scale === 1) continue; // no win
    texture.setImage(bytes).setMimeType('image/webp');
    converted = true;
  }

  // Declare EXT_texture_webp once any texture actually became WebP.
  if (converted) doc.createExtension(EXTTextureWebP).setRequired(true);
}

// -----------------------------------------------------------------------------
// Pipeline
// -----------------------------------------------------------------------------

/**
 * Run the full optimization pipeline on a GLB.
 * @param {Uint8Array} glbBytes source GLB
 * @param {CompressSettings} settings knob values
 * @param {(fraction: number, label: string) => void} onProgress 0..1 within
 *   this pipeline, with a short stage label
 * @param {import('@gltf-transform/core').PlatformIO} [io] injectable for tests
 *   (defaults to a WebIO with all extensions + the pinned meshopt codecs)
 * @returns {Promise<Uint8Array>} optimized GLB
 */
export async function compressGLB(glbBytes, settings, onProgress, io) {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const platformIO = io || new WebIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

  onProgress(0.05, 'reading');
  const doc = await platformIO.readBinary(glbBytes);

  onProgress(0.2, 'optimizing');
  const transforms = [dedup(), prune()];
  if (settings.decimate > 0) {
    await MeshoptSimplifier.ready;
    transforms.push(
      weld(),
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: 1 - settings.decimate / 100,
        error: 0.01,
      }),
    );
  }
  transforms.push(
    resample(),
    quantize({
      quantizePosition: settings.posBits,
      quantizeNormal: settings.nrmBits,
      quantizeTexcoord: 12,
    }),
  );
  await doc.transform(...transforms);

  onProgress(0.55, 'textures');
  // Texture pass needs a canvas; skipped automatically outside the browser.
  if (typeof document !== 'undefined') await recompressTextures(doc, settings);

  onProgress(0.8, 'packing');
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

  onProgress(0.95, 'writing');
  return platformIO.writeBinary(doc);
}
