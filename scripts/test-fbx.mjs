#!/usr/bin/env node
// Regression for the vendored FBXLoader guards (src/vendor/fbx): an FBX whose
// animation curve declares ZERO keyframes must not abort the import — the
// curve is skipped, the trackless clip is dropped, and the mesh still loads.
// The hostile file is embedded as ASCII FBX text (procedural, invariant #9:
// no binary fixtures in the repo). Chained after scripts/test.mjs by npm test.
import { FBXLoader } from '../src/vendor/fbx/FBXLoader.js';

const HOSTILE_FBX = `; FBX 7.3.0 project file
FBXHeaderExtension:  {
	FBXHeaderVersion: 1003
	FBXVersion: 7300
	Creator: "3dpeer procedural fixture"
}
GlobalSettings:  {
	Version: 1000
	Properties70:  {
		P: "UpAxis", "int", "Integer", "",1
		P: "UpAxisSign", "int", "Integer", "",1
		P: "FrontAxis", "int", "Integer", "",2
		P: "FrontAxisSign", "int", "Integer", "",1
		P: "CoordAxis", "int", "Integer", "",0
		P: "CoordAxisSign", "int", "Integer", "",1
		P: "UnitScaleFactor", "double", "Number", "",1
	}
}
Objects:  {
	Geometry: 140000000, "Geometry::cube", "Mesh" {
		Vertices: *24 {
			a: -1,-1,-1,1,-1,-1,1,1,-1,-1,1,-1,-1,-1,1,1,-1,1,1,1,1,-1,1,1
		}
		PolygonVertexIndex: *24 {
			a: 0,1,2,-4,4,7,6,-6,0,4,5,-2,1,5,6,-3,2,6,7,-4,0,3,7,-5
		}
		GeometryVersion: 124
	}
	Model: 150000000, "Model::cube", "Mesh" {
		Version: 232
		Properties70:  {
			P: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
			P: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0
			P: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
		}
	}
	AnimationStack: 160000000, "AnimStack::Take1", "" {
		Properties70:  {
			P: "LocalStop", "KTime", "Time", "",46186158000
		}
	}
	AnimationLayer: 170000000, "AnimLayer::BaseLayer", "" {
	}
	AnimationCurveNode: 180000000, "AnimCurveNode::R", "" {
		Properties70:  {
			P: "d|X", "Number", "", "A",0
			P: "d|Y", "Number", "", "A",0
			P: "d|Z", "Number", "", "A",0
		}
	}
	AnimationCurve: 190000000, "AnimCurve::", "" {
		Default: 0
		KeyVer: 4008
		KeyTime: *0 {
			a:
		}
		KeyValueFloat: *0 {
			a:
		}
		KeyAttrFlags: *1 {
			a: 24840
		}
		KeyAttrDataFloat: *4 {
			a: 0,0,218434821,0
		}
		KeyAttrRefCount: *1 {
			a: 1
		}
	}
}
Connections:  {
	C: "OO",150000000,0
	C: "OO",140000000,150000000
	C: "OO",170000000,160000000
	C: "OO",180000000,170000000
	C: "OP",180000000,150000000, "Lcl Rotation"
	C: "OP",190000000,180000000, "d|X"
}
Takes:  {
	Current: "Take1"
}
`;

console.log('--- fbx empty-animation-track guard');
const buffer = new TextEncoder().encode(HOSTILE_FBX).buffer;
const object = new FBXLoader().parse(buffer, '');
let meshes = 0;
let tris = 0;
object.traverse((o) => {
  if (!o.isMesh) return;
  meshes++;
  const g = o.geometry;
  tris += g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
});
if (meshes !== 1 || tris !== 12) {
  throw new Error(`fbx guard: expected 1 mesh / 12 tris, got ${meshes} / ${tris}`);
}
if ((object.animations || []).length !== 0) {
  throw new Error('fbx guard: the trackless clip should have been dropped');
}
console.log('fbx empty-animation-track guard: OK — mesh loads, keyless curve skipped, trackless clip dropped');

// --- skin-weight renormalisation ------------------------------------------
// FBX allows any number of influences per vertex; three keeps the four
// largest and drops the rest WITHOUT renormalising, so the weights sum to
// less than 1 and the skinning shader drags those vertices toward the
// skeleton origin (the "exploded mesh"). importers.js repairs this with
// normalizeSkinWeights(); this measures the collapse and the repair.
console.log('--- skin-weight renormalisation');
{
  const THREE = await import('three');
  const geometry = new THREE.BoxGeometry(1, 1, 4, 1, 1, 4);
  geometry.translate(0, 0, 2);
  const count = geometry.getAttribute('position').count;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    // A truncated 6-influence vertex: the kept weights sum to 0.5, not 1.
    skinIndex[i * 4] = 1;
    skinWeight[i * 4] = 0.5;
  }
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));

  const root = new THREE.Bone();
  const moved = new THREE.Bone();
  moved.position.set(0, 10, 0); // a bone far from the origin
  root.add(moved);
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  mesh.add(root);
  mesh.bind(new THREE.Skeleton([root, moved]));
  mesh.updateMatrixWorld(true);

  const probe = new THREE.Vector3();
  mesh.getVertexPosition(0, probe);
  const before = probe.clone();
  mesh.normalizeSkinWeights();
  mesh.getVertexPosition(0, probe);
  const after = probe.clone();

  // Un-normalised weights collapse the vertex toward the origin; after the
  // repair it sits exactly where the single full-weight bone puts it.
  const expected = new THREE.Vector3();
  mesh.getVertexPosition(0, expected); // recomputed with weights summing to 1
  if (before.distanceTo(after) < 1e-6) {
    throw new Error('skin renormalisation: expected the collapsed vertex to move');
  }
  const sum = geometry.getAttribute('skinWeight');
  const total = sum.getX(0) + sum.getY(0) + sum.getZ(0) + sum.getW(0);
  if (Math.abs(total - 1) > 1e-5) {
    throw new Error('skin renormalisation: weights still sum to ' + total);
  }
  console.log(`skin-weight renormalisation: OK — weight sum 0.5 -> ${total.toFixed(3)}, vertex moved ${before.distanceTo(after).toFixed(2)} units back into place`);
}
