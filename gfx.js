// Shattermoon Vanguard — rendering core: procedural textures, material patches, post-processing, quality tiers.
import * as THREE from './vendor/three.module.min.js';
import { EffectComposer } from './vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/addons/postprocessing/OutputPass.js';
import { ShaderPass } from './vendor/addons/postprocessing/ShaderPass.js';

// ---------- quality ----------
// low: no post, no shadows, fewer particles · medium: bloom + grade, no shadows
// high: bloom + light shafts + soft shadows (iPad Pro / Vision Pro / desktop) · ultra: 4K shadows, more scatter + particles
// (the settings menu also offers AUTO, which picks a tier per device — see autoQuality() in game.js)
export const QUALITY = {
  low: { post: false, shadows: false, shadowRes: 0, shadowBox: 0, pr: 1.0, particles: 0.5, dust: 120, lights: true, shafts: 0, scatter: 0.5, sparks: 0.5 },
  medium: { post: true, shadows: false, shadowRes: 0, shadowBox: 0, pr: 1.35, particles: 0.8, dust: 240, lights: true, shafts: 0, scatter: 0.75, sparks: 0.8 },
  high: { post: true, shadows: true, shadowRes: 2048, shadowBox: 30, pr: 1.5, particles: 1, dust: 400, lights: true, shafts: 20, scatter: 1, sparks: 1 },
  ultra: { post: true, shadows: true, shadowRes: 4096, shadowBox: 36, pr: 2.0, particles: 1.25, dust: 560, lights: true, shafts: 32, scatter: 1.4, sparks: 1.3 },
};
export const Q_ORDER = ['low', 'medium', 'high', 'ultra'];

// ---------- atmospheric fog (patched into every lit/unlit material that uses scene.fog) ----------
// Exp2 distance fog + analytic low-lying height mist + sun in-scattering (fog glows warm toward the sun):
// a cheap "volumetric" look with zero extra passes.
export const SUN_DIR_FOG = new THREE.Vector3(-0.5, 0.42, -1).normalize();
(function patchFog() {
  const C = THREE.ShaderChunk; const v = SUN_DIR_FOG;
  C.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vFogView;\n#endif';
  C.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogView = mvPosition.xyz;\n#endif';
  C.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogView;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear; uniform float fogFar;
	#endif
	const vec3 SV_SUN = vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)});
#endif`;
  C.fog_fragment = `#ifdef USE_FOG
	float svFogDist = length(vFogView);
	vec3 svFogDirW = normalize((vec4(vFogView / max(svFogDist, 1e-4), 0.0) * viewMatrix).xyz);
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp(- fogDensity * fogDensity * svFogDist * svFogDist);
	#else
		float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
	#endif
	// height mist: density ~ exp(-k*y), integrated along the view ray (thicker near the ground, thins with altitude)
	float svFy0 = max(cameraPosition.y, 0.0), svFdy = svFogDirW.y * svFogDist; const float svHk = 0.32;
	float svHAvg = abs(svFdy) > 0.05 ? (exp(-svHk * svFy0) - exp(-svHk * (svFy0 + svFdy))) / (svHk * svFdy) : exp(-svHk * svFy0);
	float svMist = 1.0 - exp(- svFogDist * 0.0048 * clamp(svHAvg, 0.0, 1.5));
	fogFactor = clamp(fogFactor + svMist * (1.0 - fogFactor), 0.0, 1.0);
	float svSunAmt = max(dot(svFogDirW, SV_SUN), 0.0);
	vec3 svFogCol = fogColor * (1.0 + 0.12 * svMist) + vec3(1.0, 0.52, 0.28) * (pow(svSunAmt, 6.0) * 0.3 + pow(svSunAmt, 32.0) * 0.4);
	gl_FragColor.rgb = mix( gl_FragColor.rgb, svFogCol, fogFactor );
#endif`;
})();

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
  // cracked bone chitin: voronoi edge cracks (tileable). crackH = height (cracks recessed), crackE = emissive mask
  const CG = 3, rr = makeNoise(333), pts = [];
  for (let j = 0; j < CG; j++) for (let i = 0; i < CG; i++) pts.push([(i + 0.15 + rr(i * 3.7, j * 1.3, 64) * 0.7) / CG, (j + 0.15 + rr(i * 1.9, j * 5.1, 64) * 0.7) / CG]);
  const CS = 256, CR = new Float32Array(CS * CS * 3);
  for (let y = 0; y < CS; y++) for (let x = 0; x < CS; x++) {
    const u = x / CS, v = y / CS, gi = Math.floor(u * CG), gj = Math.floor(v * CG); let f1 = 9, f2 = 9;
    for (let oj = -1; oj <= 1; oj++) for (let oi = -1; oi <= 1; oi++) {
      const ii = gi + oi, jj = gj + oj, wi = (ii + CG) % CG, wj = (jj + CG) % CG, p = pts[wj * CG + wi];
      const cx = p[0] + Math.floor(ii / CG), cy = p[1] + Math.floor(jj / CG); const d = Math.hypot(u - cx, v - cy);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    const w = (f2 - f1) + (fbm(n, u * 12, v * 12, 12, 3) - 0.5) * 0.03; // wobble the crack lines
    const fine = Math.abs(fbm(n2, u * 10 + 5, v * 10 + 2, 10, 4) - 0.5); const o = (y * CS + x) * 3;
    CR[o] = 1 - cl(w / 0.022); CR[o + 1] = cl(1 - fine * 30) * 0.6; CR[o + 2] = f1 * CG;
  }
  const crackAt = (u, v) => { const o = ((Math.floor(v * CS) % CS) * CS + (Math.floor(u * CS) % CS)) * 3; return [CR[o], CR[o + 1], CR[o + 2]]; };
  const crackH = dataTex(CS, (u, v) => { const [c, f, f1] = crackAt(u, v); const b = fbm(n, u * 8, v * 8, 8); const k = cl(0.84 + b * 0.16 - c * 0.5 - f * 0.12 - f1 * 0.06); return [k, k * 0.97, k * 0.92, k]; });
  const crackE = dataTex(CS, (u, v) => { const [c] = crackAt(u, v); const m = cl((fbm(n2, u * 3 + 7, v * 3 + 3, 3, 3) - 0.34) * 4); const e = cl((c - 0.45) * 2.2) * m; return [e, e, e, 1]; });
  crackE.colorSpace = THREE.NoColorSpace;
  _tex = { stone, ground, moon, panel, crackH, crackE }; return _tex;
}

// ---------- shader patches ----------
// set once at boot from the starting tier (needs a reload to change)
const TP = { detail: true };
export function setTextureDetail(on) { TP.detail = !!on; }
// World-space triplanar albedo + derivative bump + roughness variation. Works with InstancedMesh.
export function triplanar(mat, tex, { scale = 0.25, bump = 1.0, macro = 0.06, rough = 0.35, ao = 0 } = {}) {
  mat.userData.tp = { tex, scale, bump, macro, rough, ao };
  mat.onBeforeCompile = sh => {
    sh.uniforms.tpMap = { value: tex }; sh.uniforms.tpScale = { value: scale }; sh.uniforms.tpBump = { value: bump }; sh.uniforms.tpMacro = { value: macro }; sh.uniforms.tpRough = { value: rough }; sh.uniforms.tpAO = { value: ao };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTpPos; varying vec3 vTpNrm;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 tpW = vec4(transformed, 1.0); vec3 tpN = objectNormal;
        #ifdef USE_INSTANCING
          tpW = instanceMatrix * tpW; tpN = mat3(instanceMatrix) * tpN;
        #endif
        tpW = modelMatrix * tpW; vTpPos = tpW.xyz; vTpNrm = normalize(mat3(modelMatrix) * tpN);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTpPos; varying vec3 vTpNrm; uniform sampler2D tpMap; uniform float tpScale, tpBump, tpMacro, tpRough, tpAO;\nvec4 tpSample(float s){ vec3 bw = pow(abs(vTpNrm), vec3(4.0)); bw /= (bw.x+bw.y+bw.z); return texture2D(tpMap, vTpPos.zy*s)*bw.x + texture2D(tpMap, vTpPos.xz*s)*bw.y + texture2D(tpMap, vTpPos.xy*s)*bw.z; }')
      .replace('#include <map_fragment>', `vec4 tpT = tpSample(tpScale); vec4 tpM = tpSample(tpScale * tpMacro);
        #ifdef TP_DETAIL
        vec4 tpD = tpSample(tpScale * 3.7); // micro detail layer (breaks up tiling, adds grain up close) — high/ultra only
        #else
        vec4 tpD = vec4(0.5);
        #endif
        diffuseColor.rgb *= tpT.rgb * (0.75 + 0.5 * tpM.rgb) * (0.9 + 0.2 * tpD.rgb); float tpH = tpT.a * 0.72 + tpM.a * 0.18 + tpD.a * 0.1;
        diffuseColor.rgb *= mix(0.68, 1.0, smoothstep(0.08, 0.55, tpH)); // cavity AO: crevices + seams darken
        if (tpAO > 0.0) diffuseColor.rgb *= mix(1.0 - tpAO, 1.0, smoothstep(0.0, 1.1, vTpPos.y)); // contact shadow where ruins meet the ground`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (0.5 - tpH) * tpRough, 0.04, 1.0);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec2 dH = vec2(dFdx(tpH), dFdy(tpH)) * tpBump; vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
          vec3 R1 = cross(sy, normal), R2 = cross(normal, sx); float det = dot(sx, R1) * faceDirection;
          vec3 g = sign(det) * (dH.x * R1 + dH.y * R2); normal = normalize(abs(det) * normal - g); }`);
  };
  if (TP.detail) mat.defines = Object.assign(mat.defines || {}, { TP_DETAIL: '' });
  mat.customProgramCacheKey = () => 'tp2' + (TP.detail ? 'd' : '');
  return mat;
}

// Dissolve-on-death: noise discard with a glowing burn edge. uniforms live on mat.userData.dis
export function dissolvable(mat, edgeColor = 0xffa040) {
  const u = { uDis: { value: 0 }, uEdge: { value: new THREE.Color(edgeColor).multiplyScalar(4) }, uFlash: { value: 0 }, uRim: { value: new THREE.Color(0, 0, 0) } };
  mat.userData.dis = u;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = sh => {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev(sh);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vDsPos;').replace('#include <project_vertex>', '#include <project_vertex>\nvDsPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vDsPos; uniform float uDis, uFlash; uniform vec3 uEdge, uRim;
      float dsH(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
      float dsN(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(dsH(i),dsH(i+vec3(1,0,0)),f.x),mix(dsH(i+vec3(0,1,0)),dsH(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(dsH(i+vec3(0,0,1)),dsH(i+vec3(1,0,1)),f.x),mix(dsH(i+vec3(0,1,1)),dsH(i+vec3(1,1,1)),f.x),f.y),f.z); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float dsv = dsN(vDsPos * 3.1) * 0.65 + dsN(vDsPos * 9.0) * 0.35;
        if (uDis > 0.0) { if (dsv < uDis) discard; totalEmissiveRadiance += uEdge * smoothstep(uDis + 0.09, uDis, dsv); }
        totalEmissiveRadiance += vec3(uFlash);
        // rim light: a fresnel edge glow so characters read against the sky and fog
        { float rimF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0); totalEmissiveRadiance += uRim * (rimF * rimF * rimF); }`);
  };
  mat.customProgramCacheKey = () => 'dis' + (mat.userData.tp ? 'tp' : '');
  return mat;
}

// ---------- post-processing ----------
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.3 }, uTime: { value: 0 }, uHurt: { value: 0 }, uTint: { value: new THREE.Color(0, 0, 0) }, uCA: { value: 0.0016 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig, uTime, uHurt, uCA; uniform vec3 uTint; varying vec2 vUv;
    void main(){ vec2 dc = vUv - 0.5; float r2 = dot(dc, dc);
      // subtle chromatic aberration, only toward the screen edges (stronger when hurt)
      vec2 caO = dc * r2 * (uCA * 4.0 + uHurt * 0.01);
      vec4 c = texture2D(tDiffuse, vUv); vec3 col = vec3(texture2D(tDiffuse, vUv + caO).r, c.g, texture2D(tDiffuse, vUv - caO).b);
      float l = dot(col, vec3(0.299,0.587,0.114));
      // lift/gamma/gain grade: cool teal-violet shadows, warm amber highlights
      col = col * vec3(1.02, 1.0, 0.98) + vec3(0.004, 0.006, 0.018) * (1.0 - l);
      col += mix(vec3(-0.012,0.0,0.03), vec3(0.035,0.014,-0.022), smoothstep(0.2,0.85,l));
      col = mix(vec3(l), col, 1.1); // a touch of saturation
      col = clamp(col, 0.0, 1.0); col = mix(col, col * col * (3.0 - 2.0 * col), 0.22); // soft filmic S-curve
      vec2 d = vUv - 0.5; float v = smoothstep(0.85, 0.2, length(d * vec2(1.0, 0.85)));
      col *= mix(1.0 - uVig, 1.0, v);
      col = mix(col, col * 0.6 + vec3(0.5,0.02,0.02), uHurt * (1.0 - v) * 0.8);
      col += uTint;
      float g = fract(sin(dot(vUv * 1000.0 + uTime, vec2(12.9898,78.233))) * 43758.5453);
      col += (g - 0.5) * 0.018;
      gl_FragColor = vec4(col, c.a); }`,
};
// screen-space light shafts (god rays) toward the sun; samples only bright pixels near the sun so glows elsewhere
// don't streak. The pass is disabled entirely when the sun is off screen.
const ShaftsShader = {
  defines: { N: 20 },
  uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uAmt: { value: 0 }, uAspect: { value: 1.6 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uAmt, uAspect; varying vec2 vUv;
    void main(){ vec4 base = texture2D(tDiffuse, vUv);
      vec2 delta = (vUv - uSun) * (0.78 / float(N)); vec2 uv = vUv; float decay = 1.0; vec3 acc = vec3(0.0);
      float jitter = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
      uv -= delta * jitter;
      for (int i = 0; i < N; i++) {
        uv -= delta; vec3 s = min(texture2D(tDiffuse, uv).rgb, vec3(2.0));
        vec2 ds = (uv - uSun) * vec2(uAspect, 1.0);
        float near = exp(-dot(ds, ds) * 24.0);
        float b = clamp(dot(s, vec3(0.3, 0.55, 0.15)) - 0.55, 0.0, 1.0);
        acc += s * b * near * decay; decay *= 0.94;
      }
      vec2 dp = (vUv - uSun) * vec2(uAspect, 1.0); float falloff = exp(-dot(dp, dp) * 3.0);
      gl_FragColor = vec4(base.rgb + min(acc * (uAmt * 0.9 / float(N)) * falloff, vec3(0.35)) * vec3(1.0, 0.72, 0.5), base.a); }`,
};
export function createPost(renderer, scene, camera, vmScene, vmCam, Qs = null) {
  const composer = new EffectComposer(renderer);
  const rp = new RenderPass(scene, camera);
  const vp = new RenderPass(vmScene, vmCam); vp.clear = false; vp.clearDepth = true;
  // wider, softer bloom with a slightly higher threshold (glows read as light, not as white blobs)
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.62, 0.62, 0.92);
  const shafts = new ShaderPass(ShaftsShader); shafts.enabled = false;
  const out = new OutputPass();
  const grade = new ShaderPass(GradeShader);
  composer.addPass(rp); composer.addPass(vp); composer.addPass(shafts); composer.addPass(bloom); composer.addPass(out); composer.addPass(grade);
  const post = { composer, rp, vp, bloom, grade, shafts, setQuality(q) {
    const n = q.shafts | 0; post.shaftN = n; if (n && shafts.material.defines.N !== n) { shafts.material.defines.N = n; shafts.material.needsUpdate = true; }
    if (!n) shafts.enabled = false;
  } };
  if (Qs) post.setQuality(Qs);
  return post;
}
