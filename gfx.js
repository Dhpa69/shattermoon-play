// Shattermoon Vanguard — rendering core: procedural textures, material patches, post-processing, quality tiers.
import * as THREE from './vendor/three.module.min.js';
import { EffectComposer } from './vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/addons/postprocessing/OutputPass.js';
import { ShaderPass } from './vendor/addons/postprocessing/ShaderPass.js';

// ---------- quality ----------
// low: no post, no shadows, fewer particles · medium: bloom + grade, no shadows · high: bloom + soft shadows
export const QUALITY = {
  low: { post: false, shadows: false, shadowRes: 0, pr: 1.0, particles: 0.5, dust: 120, lights: true },
  medium: { post: true, shadows: false, shadowRes: 0, pr: 1.35, particles: 0.8, dust: 240, lights: true },
  high: { post: true, shadows: true, shadowRes: 2048, pr: 1.5, particles: 1, dust: 400, lights: true },
};
export const Q_ORDER = ['low', 'medium', 'high'];

// ---------- tileable value noise ----------
function makeNoise(seed) {
  const perm = new Uint8Array(512); let s = seed >>> 0;
  const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = new Float32Array(256); for (let i = 0; i < 256; i++) val[i] = r();
  const h = (x, y) => val[perm[(x & 255) + perm[y & 255]]];
  // periodic noise with period P (in lattice cells)
  return (x, y, P) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P, x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
    const a = h(x0, y0), b = h(x1, y0), c = h(x0, y1), d = h(x1, y1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
function fbm(n, x, y, P, oct = 5) { let a = 0, amp = 0.5, f = 1, tot = 0; for (let o = 0; o < oct; o++) { a += n(x * f, y * f, P * f) * amp; tot += amp; amp *= 0.5; f *= 2; } return a / tot; }

// RGBA DataTexture: rgb = albedo (sRGB), a = height (used for bump + roughness variation)
function dataTex(size, fn) {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, g, b, h] = fn(x / size, y / size); const i = (y * size + x) * 4;
    d[i] = r * 255; d[i + 1] = g * 255; d[i + 2] = b * 255; d[i + 3] = h * 255;
  }
  const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
  t.needsUpdate = true; return t;
}
const cl = v => Math.max(0, Math.min(1, v));
let _tex = null;
export function textures() {
  if (_tex) return _tex;
  const n = makeNoise(7), n2 = makeNoise(91);
  // weathered stone blocks
  const stone = dataTex(256, (u, v) => {
    const base = fbm(n, u * 8, v * 8, 8), fine = fbm(n2, u * 16, v * 16, 16, 3);
    // block seams
    const bu = u * 2, bv = v * 4 + (Math.floor(u * 2) % 2) * 0.5; const fu = bu - Math.floor(bu), fv = bv - Math.floor(bv);
    const seam = Math.min(fu, 1 - fu, (fv) / 2, (1 - fv) / 2) * 4; const s = cl(seam * 6 + base * 0.6 - 0.15);
    // cracks: thin ridges of noise
    const cr = Math.abs(fbm(n, u * 6 + 3.1, v * 6 + 1.7, 6, 4) - 0.5); const crack = cl(cr * 22);
    const h = cl((0.45 + base * 0.45 + fine * 0.1) * (0.4 + 0.6 * s) * (0.75 + 0.25 * crack));
    const k = 0.7 + base * 0.25 + fine * 0.06; const moss = cl((n2(u * 5, v * 5, 5) - 0.62) * 3);
    return [cl(k * 0.80 * (0.8 + 0.2 * s) * (0.85 + 0.15 * crack) - moss * 0.1), cl(k * 0.74 * (0.8 + 0.2 * s) * (0.85 + 0.15 * crack) + moss * 0.03), cl(k * 0.80 * (0.8 + 0.2 * s) * (0.85 + 0.15 * crack) - moss * 0.05), h];
  });
  // cracked lunar dust / rock ground
  const ground = dataTex(256, (u, v) => {
    const a = fbm(n, u * 6, v * 6, 6), b = fbm(n2, u * 16, v * 16, 16, 3);
    const cr = Math.abs(fbm(n2, u * 4 + 9, v * 4 + 2, 4, 4) - 0.5); const crack = cl(cr * 16);
    const peb = cl((n(u * 32, v * 32, 32) - 0.72) * 4);
    const h = cl(0.3 + a * 0.4 + b * 0.25 + peb * 0.25) * (0.6 + 0.4 * crack);
    const k = 0.68 + a * 0.25 + b * 0.08 + peb * 0.1;
    return [cl(k * 0.95 * (0.85 + 0.15 * crack)), cl(k * 0.82 * (0.85 + 0.15 * crack)), cl(k * 0.8 * (0.85 + 0.15 * crack)), h];
  });
  // moon surface with craters
  const moon = dataTex(256, (u, v) => {
    let h = fbm(n, u * 8, v * 8, 8) * 0.6 + fbm(n2, u * 32, v * 32, 32, 3) * 0.25;
    for (let i = 0; i < 26; i++) { const cx = (n(i * 7.3, 1.1, 256) * 1), cy = n2(i * 3.1, 7.7, 256), rr = 0.02 + n(i, i, 256) * 0.07; let dx = Math.abs(u - cx), dy = Math.abs(v - cy); dx = Math.min(dx, 1 - dx); dy = Math.min(dy, 1 - dy); const d = Math.hypot(dx, dy) / rr; if (d < 1.3) h += d < 1 ? -0.25 * (1 - d * d) : 0.12 * (1.3 - d) / 0.3; }
    const k = cl(0.55 + h * 0.5); return [k * 0.92, k * 0.88, k, cl(h + 0.3)];
  });
  // metal panel (weapons / armor)
  const panel = dataTex(128, (u, v) => {
    const a = fbm(n2, u * 16, v * 16, 16, 3); const pu = (u * 4) % 1, pv = (v * 3) % 1;
    const seam = Math.min(pu, 1 - pu, pv, 1 - pv) < 0.03 ? 0.3 : 1; const k = (0.8 + a * 0.2) * seam;
    return [k, k, k, cl(seam * 0.8 + a * 0.2)];
  });
  _tex = { stone, ground, moon, panel }; return _tex;
}

// ---------- shader patches ----------
// World-space triplanar albedo + derivative bump + roughness variation. Works with InstancedMesh.
export function triplanar(mat, tex, { scale = 0.25, bump = 1.0, macro = 0.06, rough = 0.35 } = {}) {
  mat.userData.tp = { tex, scale, bump, macro, rough };
  mat.onBeforeCompile = sh => {
    sh.uniforms.tpMap = { value: tex }; sh.uniforms.tpScale = { value: scale }; sh.uniforms.tpBump = { value: bump }; sh.uniforms.tpMacro = { value: macro }; sh.uniforms.tpRough = { value: rough };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTpPos; varying vec3 vTpNrm;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 tpW = vec4(transformed, 1.0); vec3 tpN = objectNormal;
        #ifdef USE_INSTANCING
          tpW = instanceMatrix * tpW; tpN = mat3(instanceMatrix) * tpN;
        #endif
        tpW = modelMatrix * tpW; vTpPos = tpW.xyz; vTpNrm = normalize(mat3(modelMatrix) * tpN);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTpPos; varying vec3 vTpNrm; uniform sampler2D tpMap; uniform float tpScale, tpBump, tpMacro, tpRough;\nvec4 tpSample(float s){ vec3 bw = pow(abs(vTpNrm), vec3(4.0)); bw /= (bw.x+bw.y+bw.z); return texture2D(tpMap, vTpPos.zy*s)*bw.x + texture2D(tpMap, vTpPos.xz*s)*bw.y + texture2D(tpMap, vTpPos.xy*s)*bw.z; }')
      .replace('#include <map_fragment>', `vec4 tpT = tpSample(tpScale); vec4 tpM = tpSample(tpScale * tpMacro);
        diffuseColor.rgb *= tpT.rgb * (0.75 + 0.5 * tpM.rgb); float tpH = tpT.a * 0.8 + tpM.a * 0.2;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (0.5 - tpH) * tpRough, 0.04, 1.0);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec2 dH = vec2(dFdx(tpH), dFdy(tpH)) * tpBump; vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
          vec3 R1 = cross(sy, normal), R2 = cross(normal, sx); float det = dot(sx, R1) * faceDirection;
          vec3 g = sign(det) * (dH.x * R1 + dH.y * R2); normal = normalize(abs(det) * normal - g); }`);
  };
  mat.customProgramCacheKey = () => 'tp';
  return mat;
}

// Dissolve-on-death: noise discard with a glowing burn edge. uniforms live on mat.userData.dis
export function dissolvable(mat, edgeColor = 0xffa040) {
  const u = { uDis: { value: 0 }, uEdge: { value: new THREE.Color(edgeColor).multiplyScalar(4) }, uFlash: { value: 0 } };
  mat.userData.dis = u;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = sh => {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev(sh);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vDsPos;').replace('#include <project_vertex>', '#include <project_vertex>\nvDsPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vDsPos; uniform float uDis, uFlash; uniform vec3 uEdge;
      float dsH(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
      float dsN(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(dsH(i),dsH(i+vec3(1,0,0)),f.x),mix(dsH(i+vec3(0,1,0)),dsH(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(dsH(i+vec3(0,0,1)),dsH(i+vec3(1,0,1)),f.x),mix(dsH(i+vec3(0,1,1)),dsH(i+vec3(1,1,1)),f.x),f.y),f.z); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float dsv = dsN(vDsPos * 3.1) * 0.65 + dsN(vDsPos * 9.0) * 0.35;
        if (uDis > 0.0) { if (dsv < uDis) discard; totalEmissiveRadiance += uEdge * smoothstep(uDis + 0.09, uDis, dsv); }
        totalEmissiveRadiance += vec3(uFlash);`);
  };
  mat.customProgramCacheKey = () => 'dis' + (mat.userData.tp ? 'tp' : '');
  return mat;
}

// ---------- post-processing ----------
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.32 }, uTime: { value: 0 }, uHurt: { value: 0 }, uTint: { value: new THREE.Color(0, 0, 0) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig, uTime, uHurt; uniform vec3 uTint; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); vec3 col = c.rgb;
      float l = dot(col, vec3(0.299,0.587,0.114));
      // split tone: cool shadows, warm highlights
      col += mix(vec3(-0.012,0.0,0.03), vec3(0.03,0.012,-0.02), smoothstep(0.2,0.8,l));
      col = mix(vec3(l), col, 1.08); // a touch of saturation
      col = (col - 0.5) * 1.04 + 0.5;
      vec2 d = vUv - 0.5; float v = smoothstep(0.85, 0.2, length(d * vec2(1.0, 0.85)));
      col *= mix(1.0 - uVig, 1.0, v);
      col = mix(col, col * 0.6 + vec3(0.5,0.02,0.02), uHurt * (1.0 - v) * 0.8);
      col += uTint;
      float g = fract(sin(dot(vUv * 1000.0 + uTime, vec2(12.9898,78.233))) * 43758.5453);
      col += (g - 0.5) * 0.018;
      gl_FragColor = vec4(col, c.a); }`,
};
export function createPost(renderer, scene, camera, vmScene, vmCam) {
  const composer = new EffectComposer(renderer);
  const rp = new RenderPass(scene, camera);
  const vp = new RenderPass(vmScene, vmCam); vp.clear = false; vp.clearDepth = true;
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 0.9);
  const out = new OutputPass();
  const grade = new ShaderPass(GradeShader);
  composer.addPass(rp); composer.addPass(vp); composer.addPass(bloom); composer.addPass(out); composer.addPass(grade);
  return { composer, rp, vp, bloom, grade };
}
