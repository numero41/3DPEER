// Morph target detection + slider panel (styles in page.css).
export function collectMorphs(rootObject) {
  const morphs = new Map(); // name -> [{mesh, index}]
  rootObject.traverse((o) => {
    if (!o.isMesh || !o.morphTargetInfluences || !o.morphTargetInfluences.length) return;
    const dict = o.morphTargetDictionary;
    const names = {};
    if (dict) for (const [k, v] of Object.entries(dict)) names[v] = k;
    for (let i = 0; i < o.morphTargetInfluences.length; i++) {
      // fall back on a synthesized label for unnamed morphs (undefined OR '')
      const name = names[i] ? names[i] : (o.name || 'mesh') + '·' + i;
      if (!morphs.has(name)) morphs.set(name, []);
      morphs.get(name).push({ mesh: o, index: i });
    }
  });
  return morphs;
}

export function buildMorphPanel(morphs) {
  if (!morphs.size) return;
  const btn = document.createElement('button');
  btn.id = 'mbtn';
  btn.textContent = morphs.size + ' morphs';
  btn.title = 'Show / hide the morph sliders';
  document.body.appendChild(btn);
  const panel = document.createElement('div');
  panel.id = 'mpanel';
  for (const [name, list] of morphs) {
    const row = document.createElement('label');
    row.title = 'Morph: ' + name;
    const span = document.createElement('span');
    span.textContent = name;
    const r = document.createElement('input');
    r.type = 'range'; r.min = 0; r.max = 1; r.step = 0.01; r.value = 0;
    r.title = 'Blend ' + name;
    r.addEventListener('input', () => {
      for (const { mesh, index } of list) mesh.morphTargetInfluences[index] = parseFloat(r.value);
    });
    row.appendChild(span); row.appendChild(r);
    panel.appendChild(row);
  }
  const reset = document.createElement('button');
  reset.id = 'mreset'; reset.textContent = 'reset';
  reset.title = 'Reset all morph sliders to zero';
  reset.addEventListener('click', () => {
    panel.querySelectorAll('input').forEach((r) => { r.value = 0; r.dispatchEvent(new Event('input')); });
  });
  panel.prepend(reset);
  document.body.appendChild(panel);
  btn.addEventListener('click', () => panel.classList.toggle('open'));
}
