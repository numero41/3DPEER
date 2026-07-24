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
