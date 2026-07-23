// Gltf mode: GLB optimized by gltf-transform (CLI, proven toolchain)
// then dropped as-is into the envelope.
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export function optimizeGlb({ input, hasTex, texSize, tmpDir }) {
  const tmp = path.join(tmpDir, '.3dpeer-tmp.glb');
  const texFlags = hasTex ? ` --texture-compress webp --texture-size ${texSize}` : '';
  execSync(`npx gltf-transform optimize "${input}" "${tmp}" --compress meshopt --simplify false${texFlags}`,
    { stdio: 'pipe' });
  const glb = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  return glb;
}
