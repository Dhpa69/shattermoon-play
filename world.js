// Shattermoon Vanguard — arena / sky builder. All geometry and textures are procedural.
import * as THREE from './vendor/three.module.min.js';
import { textures, triplanar } from './gfx.js';

export const ARENA_R = 56;
export const SUN_DIR = new THREE.Vector3(-0.5, 0.42, -1).normalize();
export const FOG_COLOR = new THREE.Color(0x3b2a48);

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

let _glowTex = null;
export function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.7)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.16)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  _glowTex = new THREE.CanvasTexture(c); _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}
// glow sprite; `boost` > 1 pushes the color into HDR so bloom picks it up
export function glowSprite(color, size, opacity = 1, boost = 1.6) {
  const m = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(color).multiplyScalar(boost), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  const s = new THREE.Sprite(m); s.scale.set(size, size, size); return s;
}

// ---------- sky shader (shared by the world and the reflection env map) ----------
function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x05081c) }, mid: { value: new THREE.Color(0x24183f) }, hor: { value: FOG_COLOR.clone().lerp(new THREE.Color(0xe0784a), 0.35) },
      sunDir: { value: SUN_DIR }, moonDir: { value: new THREE.Vector3(-160, 150, -330).normalize() }, uTime: { value: 0 } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 top, mid, hor, sunDir, moonDir; uniform float uTime; varying vec3 vP;
      float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
      float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float fbm(vec3 p){ float a=0.0, w=0.5; for(int i=0;i<4;i++){ a+=n3(p)*w; p*=2.03; w*=0.5; } return a; }
      void main(){ vec3 d = normalize(vP); float h = d.y;
        vec3 c = mix(hor, mid, smoothstep(-0.02, 0.25, h));
        c = mix(c, top, smoothstep(0.22, 0.8, h));
        // nebula bands
        float neb = fbm(d * 3.0 + vec3(0.0, 0.0, uTime * 0.003));
        float band = smoothstep(0.35, 0.0, abs(d.y - 0.45 + d.x * 0.35));
        c += vec3(0.32, 0.10, 0.42) * pow(neb, 2.2) * band * 0.9 + vec3(0.05, 0.12, 0.25) * pow(fbm(d * 6.0 + 4.0), 3.0) * band;
        // sun bloom on the horizon + moon glow
        float s = max(dot(d, sunDir), 0.0);
        c += vec3(1.0, 0.5, 0.25) * (pow(s, 12.0) * 0.55 + pow(s, 200.0) * 2.0);
        float m = max(dot(d, moonDir), 0.0);
        c += vec3(1.0, 0.55, 0.3) * pow(m, 30.0) * 0.5 + vec3(0.6, 0.35, 0.8) * pow(m, 6.0) * 0.15;
        // stars (cell hash)
        vec3 sp = d * 220.0; vec3 cell = floor(sp); float st = h3(cell);
        if (st > 0.985 && h > -0.02) { vec3 f = fract(sp) - 0.5; float tw = 0.6 + 0.4 * sin(uTime * (1.0 + st * 6.0) + st * 50.0);
          c += vec3(0.85, 0.9, 1.0) * smoothstep(0.32, 0.0, length(f)) * tw * smoothstep(0.0, 0.25, h) * (st - 0.985) * 120.0; }
        if (h < -0.02) c = mix(hor * 0.7, vec3(0.06, 0.04, 0.08), smoothstep(-0.02, -0.3, h));
        gl_FragColor = vec4(c, 1.0); }`
  });
}

function displace(geo, amt, freq, seed) {
  const p = geo.attributes.position, v = new THREE.Vector3(), R = rng(seed);
  const o1 = R() * 10, o2 = R() * 10;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); const l = v.length() || 1;
    const k = 1 + amt * (Math.sin(v.x * freq + o1) * Math.cos(v.y * freq * 1.3 + o2) * 0.6 + Math.sin(v.z * freq * 2.1 + v.x * 0.7) * 0.4) / 1;
    v.multiplyScalar(k); p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals(); return geo;
}

export function buildWorld(scene, renderer, Qs) {
  const colliders = []; // {minX,maxX,minZ,maxZ,top}
  const R = rng(1337);
  const updaters = [];
  const T = textures();

  // ---------- Sky ----------
  const skyMat = skyMaterial();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), skyMat);
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

  // reflection environment (PMREM of the sky) so PBR metals/armor pick up the dusk colors
  try {
    const envScene = new THREE.Scene(); const es = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMaterial()); envScene.add(es);
    const pm = new THREE.PMREMGenerator(renderer); const rt = pm.fromScene(envScene, 0.02); scene.environment = rt.texture; pm.dispose();
    scene.environmentIntensity = 0.55;
  } catch (e) { /* env map optional */ }

  // ---------- Shattered moon ----------
  const moon = new THREE.Group();
  const moonMat = new THREE.MeshStandardMaterial({ map: T.moon, color: 0xc9c0d8, roughness: 0.95, metalness: 0, emissive: 0x1a1228, fog: false, bumpMap: T.moon, bumpScale: 3 });
  const lavaMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff7a30).multiplyScalar(2.2), fog: false });
  const coreGeo = displace(new THREE.IcosahedronGeometry(52, 5), 0.035, 0.09, 3);
  // carve a wedge out of the moon (cheap: drop faces in a cone) so the glowing core shows through
  {
    const idx = coreGeo.index ? coreGeo.index.array : null, pos = coreGeo.attributes.position, keep = []; const cdir = new THREE.Vector3(0.55, -0.2, 0.8).normalize(), a = new THREE.Vector3();
    const n = idx ? idx.length : pos.count;
    for (let i = 0; i < n; i += 3) { const i0 = idx ? idx[i] : i; a.fromBufferAttribute(pos, i0).normalize(); if (a.dot(cdir) < 0.82) keep.push(idx ? idx[i] : i, idx ? idx[i + 1] : i + 1, idx ? idx[i + 2] : i + 2); }
    coreGeo.setIndex(keep);
  }
  const core = new THREE.Mesh(coreGeo, moonMat); moon.add(core);
  const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(47, 3), lavaMat); moon.add(inner);
  const innerShell = new THREE.Mesh(new THREE.IcosahedronGeometry(51, 3), new THREE.MeshStandardMaterial({ color: 0x2a1a22, roughness: 1, side: THREE.BackSide, fog: false, emissive: 0x401008 })); moon.add(innerShell);
  const moonGlow = glowSprite(0xff8a4a, 300, 0.5, 1.2); moonGlow.material.fog = false; moonGlow.position.set(20, -6, 30); moon.add(moonGlow);
  const moonHalo = glowSprite(0x9a7aff, 420, 0.18, 1); moonHalo.material.fog = false; moon.add(moonHalo);
  const frags = [];
  for (let i = 0; i < 34; i++) {
    const big = i < 8; const g = displace(new THREE.DodecahedronGeometry(1, big ? 1 : 0), 0.15, 2.5, i + 10);
    const f = new THREE.Mesh(g, moonMat);
    const t = i / 34, a = t * Math.PI * 2.4 - 0.6, d = 62 + R() * (big ? 45 : 80);
    f.position.set(28 + Math.cos(a) * d * 0.7, -8 + (R() - 0.5) * 30 + Math.sin(a) * 14, 44 + Math.sin(a) * d * 0.35);
    const s = big ? 5 + R() * 11 : 1.2 + R() * 4; f.scale.set(s, s * (0.6 + R() * 0.6), s);
    f.userData.spin = (R() - 0.5) * 0.25; frags.push(f); moon.add(f);
    if (big) { const lv = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), lavaMat); f.add(lv); lv.position.set(0.45, 0, 0.45); const gl = glowSprite(0xff7a30, 3.5, 0.5, 1.4); gl.material.fog = false; f.add(gl); }
  }
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc9a0).multiplyScalar(0.9), transparent: true, opacity: 0.22, fog: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(80, 130, 96, 1), ringMat);
  ring.rotation.x = Math.PI / 2.3; ring.rotation.y = 0.3; moon.add(ring);
  // dust belt: points around ring
  { const N = 900, p = new Float32Array(N * 3); for (let i = 0; i < N; i++) { const a = R() * Math.PI * 2, r = 78 + R() * 60; p[i * 3] = Math.cos(a) * r; p[i * 3 + 1] = (R() - 0.5) * 4; p[i * 3 + 2] = Math.sin(a) * r; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const belt = new THREE.Points(g, new THREE.PointsMaterial({ color: new THREE.Color(0xffd0a8).multiplyScalar(1.4), size: 1.4, map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    belt.rotation.copy(ring.rotation); belt.rotation.x -= Math.PI / 2; moon.add(belt); updaters.push(dt => belt.rotation.z += dt * 0.004); }
  moon.position.set(-160, 150, -330); moon.rotation.set(0.2, 0.6, 0.1);
  scene.add(moon);

  // ---------- Lights / fog ----------
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0095);
  const hemi = new THREE.HemisphereLight(0x9fb0ff, 0x5a4034, 1.15); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc49a, 2.6); sun.position.copy(SUN_DIR).multiplyScalar(60); scene.add(sun); scene.add(sun.target);
  sun.shadow.camera.left = -38; sun.shadow.camera.right = 38; sun.shadow.camera.top = 38; sun.shadow.camera.bottom = -38; sun.shadow.camera.near = 1; sun.shadow.camera.far = 160;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
  const rim = new THREE.DirectionalLight(0x7a6cff, 0.8); rim.position.set(1, 0.3, 1); scene.add(rim);

  // ---------- Ground ----------
  const gGeo = new THREE.PlaneGeometry(360, 360, 96, 96); gGeo.rotateX(-Math.PI / 2);
  const gp = gGeo.attributes.position, gc = new Float32Array(gp.count * 3);
  const cA = new THREE.Color(0x6a5560), cB = new THREE.Color(0x8a6d62), cC = new THREE.Color(0x3c3048), cD = new THREE.Color(0x4a4f6a), tmp = new THREE.Color();
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i), d = Math.hypot(x, z);
    let y = Math.sin(x * 0.21) * Math.cos(z * 0.17) * 0.08;
    if (d > ARENA_R + 4) { const k = (d - ARENA_R - 4); y = Math.min(k * 0.35, 22) + Math.sin(x * 0.08) * Math.cos(z * 0.07) * Math.min(k * 0.2, 8) + Math.sin(x * 0.31 + z * 0.2) * Math.min(k * 0.05, 1.5); }
    gp.setY(i, Math.max(y, d < ARENA_R ? -0.02 : y));
    if (d < ARENA_R) gp.setY(i, Math.max(0, y) * 0.0);
    const n = (Math.sin(x * 0.31) * Math.cos(z * 0.27) + Math.sin(x * 0.07 + z * 0.05)) * 0.25 + 0.5;
    tmp.copy(cA).lerp(cB, n); if (d < 12) tmp.lerp(cD, 0.25 * (1 - d / 12)); if (d > ARENA_R + 6) tmp.lerp(cC, Math.min((d - ARENA_R) / 40, 0.8));
    gc[i * 3] = tmp.r; gc[i * 3 + 1] = tmp.g; gc[i * 3 + 2] = tmp.b;
  }
  gGeo.setAttribute('color', new THREE.BufferAttribute(gc, 3)); gGeo.computeVertexNormals();
  const groundMat = triplanar(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02 }), T.ground, { scale: 0.11, bump: 0.35, macro: 0.12 });
  const ground = new THREE.Mesh(gGeo, groundMat); ground.receiveShadow = true; scene.add(ground);

  // glowing rune circles on the floor
  const runeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6fe3ff).multiplyScalar(2), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
  const rune1 = new THREE.Mesh(new THREE.RingGeometry(6.2, 6.5, 96), runeMat); rune1.rotation.x = -Math.PI / 2; rune1.position.y = 1.43; scene.add(rune1);
  const rune2 = new THREE.Mesh(new THREE.RingGeometry(3.6, 3.75, 6), runeMat); rune2.rotation.x = -Math.PI / 2; rune2.position.y = 1.43; scene.add(rune2);
  const rune3 = new THREE.Mesh(new THREE.RingGeometry(4.6, 4.7, 3), runeMat); rune3.rotation.x = -Math.PI / 2; rune3.position.y = 1.43; scene.add(rune3);
  const runeOuter = new THREE.Mesh(new THREE.RingGeometry(ARENA_R - 0.5, ARENA_R, 128), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff8a5a).multiplyScalar(1.6), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); runeOuter.rotation.x = -Math.PI / 2; runeOuter.position.y = 0.03; scene.add(runeOuter);

  // ---------- Ruins ----------
  const boxes = []; // {x,y,z,sx,sy,sz,ry,col, collide, kind}
  const addBox = (x, z, sx, sy, sz, opt = {}) => {
    const b = { x, y: opt.y ?? sy / 2, z, sx, sy, sz, ry: opt.ry || 0, rx: opt.rx || 0, rz: opt.rz || 0, col: opt.col ?? (0.75 + R() * 0.3), collide: opt.collide !== false, kind: opt.kind || 'block' };
    boxes.push(b);
    if (b.collide) colliders.push({ minX: x - sx / 2, maxX: x + sx / 2, minZ: z - sz / 2, maxZ: z + sz / 2, top: b.y + sy / 2 });
    return b;
  };
  const deco = []; // visual-only extras
  const addDeco = (x, y, z, sx, sy, sz, opt = {}) => deco.push({ x, y, z, sx, sy, sz, ry: opt.ry || 0, rx: opt.rx || 0, rz: opt.rz || 0, col: opt.col ?? (0.7 + R() * 0.3) });
  // central dais with steps
  addBox(0, 0, 16, 1.4, 16, { kind: 'dais' });
  addDeco(0, 1.42, 0, 16.4, 0.12, 16.4, { col: 0.6 });
  for (const [dx, dz, sx, sz] of [[0, 9, 6, 2], [0, -9, 6, 2], [9, 0, 2, 6], [-9, 0, 2, 6]]) addBox(dx, dz, sx, 0.7, sz);
  const pillar = (x, z, h, y0 = 0, w = 1.4, collide = true) => {
    addBox(x, z, w, h, w, { y: y0 + h / 2, kind: 'pillar', collide });
    addDeco(x, y0 + 0.25, z, w * 1.35, 0.5, w * 1.35, { col: 0.65 }); // base
    if (h > 3.5 && R() < 0.65) addDeco(x, y0 + h - 0.2, z, w * 1.3, 0.4, w * 1.3, { col: 0.7 }); // capital
    else for (let k = 0; k < 3; k++) addDeco(x + (R() - 0.5) * w * 2.5, 0.25, z + (R() - 0.5) * w * 2.5, 0.3 + R() * 0.5, 0.3 + R() * 0.4, 0.3 + R() * 0.5, { ry: R() * 3, rx: R(), col: 0.6 }); // rubble
  };
  for (const [x, z, h] of [[6, 6, 5.5], [-6, 6, 3.2], [6, -6, 2.4], [-6, -6, 6.4]]) pillar(x, z, h, 1.4);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.1, d = 30 + (i % 3) * 4;
    const h = R() < 0.3 ? 1.6 + R() * 1.4 : 4 + R() * 6;
    pillar(Math.cos(a) * d, Math.sin(a) * d, h, 0, 1.8);
  }
  for (let i = 0; i < 14; i++) {
    const a = R() * Math.PI * 2, d = 16 + R() * 34;
    const long = 4 + R() * 6, h = 1.2 + R() * 1.1, horiz = R() < 0.5;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    addBox(x, z, horiz ? long : 1, h, horiz ? 1 : long, { kind: 'wall' });
    addDeco(x, h + 0.08, z, (horiz ? long : 1) + 0.12, 0.16, (horiz ? 1 : long) + 0.12, { col: 0.6 }); // coping
  }
  for (let i = 0; i < 6; i++) {
    const a = R() * Math.PI * 2, d = 20 + R() * 28, len = 6 + R() * 4, horiz = R() < 0.5;
    addBox(Math.cos(a) * d, Math.sin(a) * d, horiz ? len : 1.7, 1.7, horiz ? 1.7 : len, { kind: 'toppled' });
  }
  const arches = [];
  for (const [x, z, horiz] of [[0, 22, true], [22, -14, false], [-24, -10, false], [-14, 26, true]]) {
    const w = 6;
    addBox(horiz ? x - w / 2 : x, horiz ? z : z - w / 2, 1.6, 6, 1.6, { kind: 'pillar' });
    addBox(horiz ? x + w / 2 : x, horiz ? z : z + w / 2, 1.6, 6, 1.6, { kind: 'pillar' });
    addBox(x, z, horiz ? w + 2 : 1.8, 1.2, horiz ? 1.8 : w + 2, { y: 6.6, collide: false });
    addDeco(x, 7.35, z, horiz ? w + 2.6 : 2.2, 0.3, horiz ? 2.2 : w + 2.6, { col: 0.6 });
    addDeco(x, 6.6, z, horiz ? 0.8 : 1.9, 1.5, horiz ? 1.9 : 0.8, { col: 0.9 }); // keystone
    arches.push({ x, z, horiz });
  }
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + R() * 0.1, d = ARENA_R + 3 + R() * 6;
    addBox(Math.cos(a) * d, Math.sin(a) * d, 3 + R() * 3, 8 + R() * 16, 2 + R() * 2, { ry: a + R(), rz: (R() - 0.5) * 0.4, collide: false });
  }
  const stoneMat = triplanar(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.03 }), T.stone, { scale: 0.3, bump: 0.45, macro: 0.12 });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const all = boxes.concat(deco);
  const inst = new THREE.InstancedMesh(boxGeo, stoneMat, all.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), base = new THREE.Color(0x9a8ea6), warm = new THREE.Color(0xb0907e), cool = new THREE.Color(0x7c8098);
  all.forEach((b, i) => {
    e.set(b.rx, b.collide ? 0 : b.ry, b.rz); q.setFromEuler(e);
    m4.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.sx, b.sy, b.sz));
    inst.setMatrixAt(i, m4);
    inst.setColorAt(i, tmp.copy(base).lerp(R() < 0.5 ? warm : cool, R()).multiplyScalar(b.col));
  });
  inst.castShadow = true; inst.receiveShadow = true; scene.add(inst);
  // glowing tech-trim strips on tall colliders + arch keystone runes
  const trimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5fd8ff).multiplyScalar(2.4) });
  const trims = boxes.filter(b => b.collide && b.sy > 2.5);
  const trimInst = new THREE.InstancedMesh(boxGeo, trimMat, trims.length * 2 + arches.length);
  let ti = 0;
  trims.forEach(b => {
    m4.compose(new THREE.Vector3(b.x, b.y + b.sy * 0.18, b.z), q.identity(), new THREE.Vector3(b.sx + 0.04, 0.08, b.sz + 0.04)); trimInst.setMatrixAt(ti++, m4);
    m4.compose(new THREE.Vector3(b.x, b.y - b.sy * 0.3, b.z), q.identity(), new THREE.Vector3(b.sx + 0.03, 0.04, b.sz + 0.03)); trimInst.setMatrixAt(ti++, m4);
  });
  for (const a of arches) { m4.compose(new THREE.Vector3(a.x + (a.horiz ? 0 : 0.96), 6.6, a.z + (a.horiz ? 0.96 : 0)), q.identity(), new THREE.Vector3(a.horiz ? 0.35 : 0.04, 0.9, a.horiz ? 0.04 : 0.35)); trimInst.setMatrixAt(ti++, m4);
    const g = glowSprite(0x5fd8ff, 3, 0.35); g.position.set(a.x, 6.6, a.z); scene.add(g); }
  scene.add(trimInst);

  // ---------- Rocks ----------
  const rockMat = triplanar(new THREE.MeshStandardMaterial({ color: 0x8a7a88, roughness: 0.9, flatShading: true }), T.stone, { scale: 0.45, bump: 0.4, macro: 0.12 });
  const rockGeo = displace(new THREE.IcosahedronGeometry(1, 1), 0.28, 1.7, 5);
  const RN = 90, rocks = new THREE.InstancedMesh(rockGeo, rockMat, RN);
  for (let i = 0; i < RN; i++) {
    const a = R() * Math.PI * 2, outside = i < 40, d = outside ? ARENA_R + 2 + R() * 30 : 10 + R() * (ARENA_R - 12);
    const s = outside ? 1.5 + R() * 4 : 0.25 + R() * 0.55;
    const x = Math.cos(a) * d, z = Math.sin(a) * d, y = outside ? Math.min((d - ARENA_R - 4) * 0.35, 22) * (d > ARENA_R + 4 ? 1 : 0) : 0;
    e.set(R() * 3, R() * 3, R() * 3); q.setFromEuler(e);
    m4.compose(new THREE.Vector3(x, y + s * 0.3, z), q, new THREE.Vector3(s * (0.8 + R() * 0.6), s * (0.5 + R() * 0.5), s * (0.8 + R() * 0.6)));
    rocks.setMatrixAt(i, m4); rocks.setColorAt(i, tmp.setRGB(0.8 + R() * 0.25, 0.75 + R() * 0.2, 0.8 + R() * 0.25));
  }
  rocks.castShadow = true; rocks.receiveShadow = true; scene.add(rocks);

  // ---------- Crystals (clusters) ----------
  const crysGeo = new THREE.OctahedronGeometry(1, 0); crysGeo.translate(0, 1, 0); crysGeo.scale(1, 1, 1);
  const crysMat = new THREE.MeshStandardMaterial({ color: 0x9aeeff, emissive: 0x2ab8ff, emissiveIntensity: 1.6, roughness: 0.12, metalness: 0.1, flatShading: true, transparent: true, opacity: 0.92 });
  const CN = 110, crys = new THREE.InstancedMesh(crysGeo, crysMat, CN);
  const crysGlows = [];
  let ci = 0;
  for (let c = 0; c < 26 && ci < CN; c++) {
    const a = R() * Math.PI * 2, d = 12 + R() * (ARENA_R + 14), outside = d > ARENA_R;
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d, cy = outside && d > ARENA_R + 4 ? Math.min((d - ARENA_R - 4) * 0.35, 22) : 0;
    const sz = outside ? 1.4 + R() * 2 : 0.45 + R() * 0.5; const n = 3 + Math.floor(R() * 3);
    for (let k = 0; k < n && ci < CN; k++) {
      const s = sz * (k === 0 ? 1 : 0.4 + R() * 0.5);
      e.set((R() - 0.5) * (k ? 1.1 : 0.3), R() * 3, (R() - 0.5) * (k ? 1.1 : 0.3)); q.setFromEuler(e);
      m4.compose(new THREE.Vector3(cx + (R() - 0.5) * sz * 1.2, cy, cz + (R() - 0.5) * sz * 1.2), q, new THREE.Vector3(s * 0.38, s * 1.5, s * 0.38));
      crys.setMatrixAt(ci++, m4);
    }
    const g = glowSprite(0x4fc8ff, sz * 6, 0.32, 1.2); g.position.set(cx, cy + sz, cz); scene.add(g); crysGlows.push(g);
  }
  crys.count = ci; scene.add(crys);

  // ---------- Distant mountains + ruin silhouettes (unfogged, tinted by hand) ----------
  const ridge = (radius, base, height, seed, cTop, cBot, segs = 220) => {
    const Rr = rng(seed), pos = [], col = [], idx = [];
    const ph = [Rr() * 6, Rr() * 6, Rr() * 6];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      let h = height * (0.45 + 0.3 * Math.sin(a * 3 + ph[0]) + 0.18 * Math.sin(a * 7 + ph[1]) + 0.1 * Math.sin(a * 17 + ph[2]) + 0.06 * Math.sin(a * 41));
      if (Rr() < 0.04) h += height * 0.35; // spires
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      pos.push(x, base, z, x, base + h, z);
      col.push(cBot.r, cBot.g, cBot.b, cTop.r, cTop.g, cTop.b);
      if (i < segs) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
    m.renderOrder = -5; scene.add(m); return m;
  };
  const hz = FOG_COLOR.clone();
  ridge(430, -20, 95, 11, hz.clone().lerp(new THREE.Color(0xb86a6a), 0.25).multiplyScalar(0.95), hz.clone());
  ridge(300, -10, 70, 23, hz.clone().multiplyScalar(0.62).lerp(new THREE.Color(0x2a1d3a), 0.3), hz.clone().multiplyScalar(0.8));
  // ruined spires on the near ridge
  const spireMat = new THREE.MeshBasicMaterial({ color: hz.clone().multiplyScalar(0.5), fog: false });
  for (let i = 0; i < 14; i++) {
    const a = R() * Math.PI * 2, r = 250 + R() * 30, h = 40 + R() * 70, w = 4 + R() * 8;
    const s = new THREE.Mesh(boxGeo, spireMat); s.position.set(Math.cos(a) * r, h / 2 + 10, Math.sin(a) * r); s.scale.set(w, h, w); s.rotation.set(0, R() * 3, (R() - 0.5) * 0.25); s.renderOrder = -4; scene.add(s);
    if (R() < 0.5) { const l = glowSprite(0xff9a5a, 10, 0.25, 1); l.material.fog = false; l.position.set(s.position.x, h + 8, s.position.z); scene.add(l); }
  }

  // ---------- Ambient particles: drifting dust + embers (animated in shader) ----------
  const dustN = Qs.dust, dp = new Float32Array(dustN * 3), dSeed = new Float32Array(dustN);
  for (let i = 0; i < dustN; i++) { dp[i * 3] = (R() - 0.5) * 130; dp[i * 3 + 1] = R() * 16; dp[i * 3 + 2] = (R() - 0.5) * 130; dSeed[i] = R(); }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3)); dg.setAttribute('seed', new THREE.BufferAttribute(dSeed, 1));
  const dustMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uMap: { value: glowTexture() }, uScale: { value: 400 } },
    vertexShader: `attribute float seed; uniform float uTime, uScale; varying float vA; varying vec3 vC;
      void main(){ vec3 p = position; float t = uTime * (0.2 + seed * 0.4);
        p.x += sin(t + seed * 30.0) * 2.0; p.z += cos(t * 0.8 + seed * 17.0) * 2.0; p.y = mod(p.y + uTime * (seed > 0.8 ? 0.9 : 0.15), 16.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        float ember = step(0.8, seed); gl_PointSize = (ember > 0.5 ? 0.22 : 0.12) * uScale / -mv.z;
        vA = (0.35 + 0.65 * sin(uTime * 2.0 + seed * 40.0) * 0.5 + 0.5) * smoothstep(60.0, 8.0, -mv.z) * (ember > 0.5 ? 1.0 : 0.5);
        vC = ember > 0.5 ? vec3(2.2, 0.9, 0.35) : vec3(0.9, 0.75, 0.7); }`,
    fragmentShader: 'uniform sampler2D uMap; varying float vA; varying vec3 vC; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vC * t.a * vA, t.a * vA); }',
  });
  const dust = new THREE.Points(dg, dustMat); dust.frustumCulled = false; scene.add(dust);

  updaters.push((dt, t, cam) => {
    sky.position.copy(cam.position);
    skyMat.uniforms.uTime.value = t; dustMat.uniforms.uTime.value = t;
    dustMat.uniforms.uScale.value = (renderer.domElement.height || 720) * 0.5;
    for (const f of frags) { f.rotation.y += f.userData.spin * dt; f.rotation.x += f.userData.spin * 0.5 * dt; }
    ring.rotation.z += dt * 0.01; core.rotation.y += dt * 0.004;
    runeMat.opacity = 0.32 + Math.sin(t * 2) * 0.12; rune2.rotation.z += dt * 0.2; rune3.rotation.z -= dt * 0.12;
    crysMat.emissiveIntensity = 1.4 + Math.sin(t * 1.3) * 0.3;
    // shadow camera follows the viewer
    sun.target.position.set(cam.position.x, 0, cam.position.z); sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 70);
  });

  return { colliders, sun, hemi, update: (dt, t, cam) => updaters.forEach(u => u(dt, t, cam)) };
}
