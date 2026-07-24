// =============================================================================
// bounds.js
//
// World-space bounds of a model's VISIBLE geometry, shared by the artifact
// stage, the workbench stage and the annotation pin layer — one implementation
// so framing and pin-leader lengths agree between the site and the artifact.
//
// Two traps this helper exists for:
//   1. Hidden prims (USD proxy/guide meshes) must not count — Box3
//      .setFromObject would frame a model on its collision geometry.
//   2. Quantized SKINNED meshes (every compressed artifact) keep their
//      dequantization inside the skin's inverse bind matrices, so their
//      bind-space geometry box is meaninglessly small — the box must be
//      computed through the skinning transform (SkinnedMesh
//      .computeBoundingBox, r151+), or the artifact frames a 1.5 m avatar
//      as a 30 cm object.
// =============================================================================

import * as THREE from 'three';

/**
 * Compute the world-space bounding box of an object's visible meshes,
 * following skinned deformation at the current pose. Falls back to
 * Box3.setFromObject when nothing visible is found (empty or all-hidden
 * scenes still need a framable box).
 * @param {THREE.Object3D} object the model root
 * @returns {THREE.Box3}
 */
export function visibleWorldBounds(object) {
  const box = new THREE.Box3();
  const meshBox = new THREE.Box3();
  object.updateWorldMatrix(true, true);
  object.traverse((node) => {
    if (!node.isMesh || !node.visible) return;
    // Visibility is inherited: skip meshes under a hidden ancestor.
    for (let p = node.parent; p && p !== object.parent; p = p.parent) {
      if (!p.visible) return;
    }
    if (node.isSkinnedMesh) {
      // Skinned-space box (bone transforms applied vertex by vertex).
      node.computeBoundingBox();
      meshBox.copy(node.boundingBox);
    } else {
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      if (!node.geometry.boundingBox) return;
      meshBox.copy(node.geometry.boundingBox);
    }
    meshBox.applyMatrix4(node.matrixWorld);
    box.union(meshBox);
  });
  if (box.isEmpty()) box.setFromObject(object);
  return box;
}
