// 3dpeer — site workbench. No styles here: everything lives in site.css.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { collectMorphs } from '../viewer/morphs.js';
import { b85encode } from '../codec/base85.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// scene
// ---------------------------------------------------------------------------
const canvas = $('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x262626);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// loaded-model state
// ---------------------------------------------------------------------------
const state = {
  root: null, glbBytes: null, name: 'model',
  center: new THREE.Vector3(), dist: 4,
  originals: new Map(),      // mesh -> original material
  wireOverlays: [],
  mixer: null, actions: [], activeAction: null, clock: new THREE.Clock(),
};

function disposeCurrent() {
  if (!state.root) return;
  scene.remove(state.root);
  state.root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
  state.originals.clear(); state.wireOverlays = [];
  state.mixer = null; state.actions = []; state.activeAction = null;
}

function frameObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const dist = (maxDim / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))) * 1.4;
  camera.near = dist / 100; camera.far = dist * 100;
  camera.position.copy(center).add(new THREE.Vector3(1, 0.5, 1).normalize().multiplyScalar(dist));
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.minDistance = dist * 0.1; controls.maxDistance = dist * 8;
  controls.update();
  state.center.copy(center); state.dist = dist;
}

// ---------------------------------------------------------------------------
// loading
// ---------------------------------------------------------------------------
async function loadFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  let gltf;
  try {
    gltf = await new Promise((ok, ko) => loader.parse(bytes.buffer.slice(0), '', ok, ko));
  } catch (e) {
    setStatus('parse error: ' + (e.message || e)); return;
  }
  disposeCurrent();
  state.root = gltf.scene; state.glbBytes = bytes;
  state.name = file.name.replace(/\.(glb|gltf)$/i, '');
  scene.add(gltf.scene);
  gltf.scene.traverse((o) => {
    if (o.isSkinnedMesh) o.frustumCulled = false;
    if (o.isMesh) state.originals.set(o, o.material);
  });
  frameObject(gltf.scene);

  if (gltf.animations && gltf.animations.length) {
    state.mixer = new THREE.AnimationMixer(gltf.scene);
    state.actions = gltf.animations.map((clip) => ({ clip, action: state.mixer.clipAction(clip) }));
  }
  buildPanels(gltf);
  document.body.classList.add('loaded');
  setStatus(`${state.name} — ${(bytes.length / 1e6).toFixed(2)} MB loaded, processed locally`);
  applyDisplayMode(document.querySelector('input[name="dmode"]:checked').value);
}

function setStatus(msg) { $('status').textContent = msg; }

// drag-drop + input
['dragover', 'drop'].forEach((ev) =>
  addEventListener(ev, (e) => { e.preventDefault(); }));
addEventListener('drop', (e) => {
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadFile(f);
});
$('file-input').addEventListener('change', (e) => {
  if (e.target.files[0]) loadFile(e.target.files[0]);
});

// ---------------------------------------------------------------------------
// auto panels: morphs, parts, animations
// ---------------------------------------------------------------------------
function clearChildren(el) { while (el.firstChild) el.removeChild(el.firstChild); }

function buildPanels(gltf) {
  // morphs
  const morphs = collectMorphs(gltf.scene);
  const mBox = $('panel-morphs'), mList = $('morph-list');
  clearChildren(mList);
  mBox.classList.toggle('hidden', morphs.size === 0);
  $('morph-count').textContent = String(morphs.size);
  for (const [name, list] of morphs) {
    const row = document.createElement('label');
    row.className = 'slider-row';
    const span = document.createElement('span'); span.textContent = name;
    const r = document.createElement('input');
    r.type = 'range'; r.min = 0; r.max = 1; r.step = 0.01; r.value = 0;
    r.addEventListener('input', () => {
      for (const { mesh, index } of list) mesh.morphTargetInfluences[index] = parseFloat(r.value);
    });
    row.append(span, r); mList.appendChild(row);
  }
  $('morph-reset').onclick = () => mList.querySelectorAll('input').forEach((r) => {
    r.value = 0; r.dispatchEvent(new Event('input'));
  });

  // parts (show/hide per named mesh)
  const pBox = $('panel-parts'), pList = $('part-list');
  clearChildren(pList);
  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  pBox.classList.toggle('hidden', meshes.length < 2);
  meshes.forEach((m, i) => {
    const row = document.createElement('label');
    row.className = 'check-row';
    const c = document.createElement('input');
    c.type = 'checkbox'; c.checked = true;
    c.addEventListener('change', () => { m.visible = c.checked; });
    const span = document.createElement('span');
    span.textContent = m.name || 'mesh ' + i;
    row.append(c, span); pList.appendChild(row);
  });

  // animations
  const aBox = $('panel-anims');
  aBox.classList.toggle('hidden', state.actions.length === 0);
  if (state.actions.length) {
    const sel = $('anim-select');
    clearChildren(sel);
    state.actions.forEach(({ clip }, i) => {
      const o = document.createElement('option');
      o.value = String(i); o.textContent = clip.name || 'clip ' + i;
      sel.appendChild(o);
    });
    sel.onchange = () => playClip(parseInt(sel.value, 10));
    $('anim-toggle').onclick = () => {
      if (!state.activeAction) { playClip(parseInt(sel.value, 10)); return; }
      state.activeAction.action.paused = !state.activeAction.action.paused;
      $('anim-toggle').textContent = state.activeAction.action.paused ? 'play' : 'pause';
    };
    $('anim-scrub').oninput = (e) => {
      if (!state.activeAction) return;
      const a = state.activeAction;
      a.action.paused = true;
      a.action.time = parseFloat(e.target.value) * a.clip.duration;
      state.mixer.update(0);
      $('anim-toggle').textContent = 'play';
    };
  }
}

function playClip(i) {
  state.actions.forEach(({ action }) => action.stop());
  const a = state.actions[i];
  a.action.reset().play(); a.action.paused = false;
  state.activeAction = a;
  $('anim-toggle').textContent = 'pause';
}

// ---------------------------------------------------------------------------
// display modes (monochrome)
// ---------------------------------------------------------------------------
const clayMat = new THREE.MeshStandardMaterial({ color: 0xb4b4b4, roughness: 0.9, metalness: 0 });
function makeMatcapTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(96, 96, 20, 128, 128, 150);
  grad.addColorStop(0, '#f5f5f5'); grad.addColorStop(0.55, '#9a9a9a');
  grad.addColorStop(0.85, '#333333'); grad.addColorStop(1, '#101010');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const matcapMat = new THREE.MeshMatcapMaterial({ matcap: makeMatcapTexture() });
const wireMat = new THREE.MeshBasicMaterial({ wireframe: true, color: 0xe6e6e6 });
// wire+shaded overlay: a dark, semi-transparent wire (DCC convention). Studio
// lighting keeps most surfaces mid-to-light, so a dark line reads where the old
// near-opaque #17110c did not; polygon offset lifts it off the shaded surface.
const wireOverlayMat = new THREE.MeshBasicMaterial({
  wireframe: true, color: 0x111111, transparent: true, opacity: 0.4,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
});

function clearWireOverlays() {
  state.wireOverlays.forEach((w) => w.parent && w.parent.remove(w));
  state.wireOverlays = [];
}

function applyDisplayMode(mode) {
  if (!state.root) return;
  clearWireOverlays();
  // Snapshot the real meshes first: the wireshaded branch adds child meshes,
  // and traverse() would otherwise walk into those overlays and recurse.
  const meshes = [];
  state.root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) {
    const orig = state.originals.get(o);
    const cloneFor = (m) => {
      const c = m.clone();
      c.morphTargets = orig && orig.morphTargets;
      return c;
    };
    if (mode === 'shaded') o.material = orig;
    else if (mode === 'clay') o.material = cloneFor(clayMat);
    else if (mode === 'matcap') o.material = cloneFor(matcapMat);
    else if (mode === 'wire') o.material = cloneFor(wireMat);
    else if (mode === 'wireshaded') {
      o.material = orig;
      if (!o.isSkinnedMesh) { // v0: the overlay does not follow bones
        const w = new THREE.Mesh(o.geometry, wireOverlayMat);
        o.add(w); state.wireOverlays.push(w);
      }
    }
  }
}
document.querySelectorAll('input[name="dmode"]').forEach((r) =>
  r.addEventListener('change', () => applyDisplayMode(r.value)));

// ---------------------------------------------------------------------------
// views + snapshot + fullscreen
// ---------------------------------------------------------------------------
const VIEWS = {
  front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0],
  right: [1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0], persp: [1, 0.5, 1],
};
document.querySelectorAll('[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    const d = VIEWS[b.dataset.view];
    camera.position.copy(state.center)
      .add(new THREE.Vector3(...d).normalize().multiplyScalar(state.dist));
    camera.updateProjectionMatrix();
    controls.update();
  }));

$('snapshot').addEventListener('click', () => {
  renderer.render(scene, camera);
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = state.name + '.png';
    a.click(); URL.revokeObjectURL(a.href);
  });
});

const stageEl = $('stage');
$('fullscreen').addEventListener('click', () => {
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsEl) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else (stageEl.requestFullscreen || stageEl.webkitRequestFullscreen).call(stageEl);
});
['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) =>
  document.addEventListener(ev, () => requestAnimationFrame(resize)));

// ---------------------------------------------------------------------------
// export: browser envelope (native gzip + base85) + template + viewer
// v0: the source GLB is embedded as-is (in-browser optimization to come)
// ---------------------------------------------------------------------------
async function gzipBytes(u8) {
  const resp = new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip')));
  return new Uint8Array(await resp.arrayBuffer());
}
function put(s, key, val) { return s.split('{{' + key + '}}').join(val); }

$('export').addEventListener('click', async () => {
  if (!state.glbBytes) return;
  setStatus('exporting…');
  const gz = await gzipBytes(state.glbBytes);
  const framed = new Uint8Array(4 + gz.length + (4 - (4 + gz.length) % 4) % 4);
  new DataView(framed.buffer).setUint32(0, gz.length, true);
  framed.set(gz, 4);
  const payload = b85encode(framed);
  const [tpl, css, viewer] = await Promise.all([
    fetch('assets/page.html').then((r) => r.text()),
    fetch('assets/page.css').then((r) => r.text()),
    fetch('assets/viewer-gltf.js').then((r) => r.text()),
  ]);
  let html = put(tpl, 'CSS', css);
  html = put(html, 'TITLE', state.name);
  html = put(html, 'CAPTION', `${state.name} · self-contained file · 0 requests`);
  html = put(html, 'PAYLOAD', payload);
  html = put(html, 'BUNDLE', viewer);
  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = state.name + '.3dpeer.html';
  a.click(); URL.revokeObjectURL(a.href);
  setStatus(`exported: ${state.name}.3dpeer.html — ${(blob.size / 1e6).toFixed(2)} MB`);
});

// ---------------------------------------------------------------------------
// loop
// ---------------------------------------------------------------------------
resize();
renderer.setAnimationLoop(() => {
  if (state.mixer && state.activeAction && !state.activeAction.action.paused) {
    state.mixer.update(state.clock.getDelta());
    const a = state.activeAction;
    $('anim-scrub').value = String((a.action.time % a.clip.duration) / a.clip.duration);
  } else state.clock.getDelta();
  controls.update();
  renderer.render(scene, camera);
});
