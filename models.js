// Shattermoon Vanguard — procedural character + weapon models built from composed primitives.
// Parts are merged per (pivot, material) so each enemy costs only a handful of draw calls.
import * as THREE from './vendor/three.module.min.js';
import { mergeGeometries } from './vendor/addons/utils/BufferGeometryUtils.js';
import { dissolvable, textures } from './gfx.js';
import { glowSprite } from './world.js';

const G = {
  box: new THREE.BoxGeometry(1, 1, 1), sph: new THREE.SphereGeometry(1, 14, 10), sphLo: new THREE.SphereGeometry(1, 8, 6),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 12), cyl6: new THREE.CylinderGeometry(1, 1, 1, 6), cone: new THREE.ConeGeometry(1, 1, 8), cone4: new THREE.ConeGeometry(1, 1, 4),
  oct: new THREE.OctahedronGeometry(1, 0), ico: new THREE.IcosahedronGeometry(1, 0), dodec: new THREE.DodecahedronGeometry(1, 0), tor: new THREE.TorusGeometry(1, 0.12, 6, 24),
  capsule: new THREE.CapsuleGeometry(0.5, 1, 4, 10),
};
// polyhedra (oct/ico/dodec) are non-indexed: give them a trivial index so they merge with indexed primitives
for (const k in G) { const g = G[k]; if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]); }
// all built-ins are indexed; strip to position/normal/uv so merges always match
for (const k in G) { const g = G[k]; for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a); }

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
class Builder {
  constructor() { this.pivots = { root: { parent: null, pos: new THREE.Vector3(), parts: {} } }; }
  pivot(name, parent, x, y, z) { this.pivots[name] = { parent, pos: new THREE.Vector3(x, y, z), parts: {} }; return this; }
  // add a primitive in the pivot's local space
  add(pv, mat, geo, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    const g = (typeof geo === 'string' ? G[geo] : geo).clone();
    _e.set(rx, ry, rz); _q.setFromEuler(_e); _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)); g.applyMatrix4(_m);
    (this.pivots[pv].parts[mat] ||= []).push(g); return this;
  }
  // returns a template: { build(mats) -> {group, pivots, meshes} }
  done() {
    const merged = {};
    for (const [name, p] of Object.entries(this.pivots)) { merged[name] = {}; for (const [mk, list] of Object.entries(p.parts)) merged[name][mk] = mergeGeometries(list, false); }
    const pivots = this.pivots;
    return {
      build(mats, { shadows = false } = {}) {
        const objs = {}, meshes = [];
        for (const [name, p] of Object.entries(pivots)) {
          const o = name === 'root' ? new THREE.Group() : new THREE.Group(); o.position.copy(p.pos); objs[name] = o;
          for (const [mk, geo] of Object.entries(merged[name])) { const m = new THREE.Mesh(geo, mats[mk]); m.castShadow = shadows && mk !== 'glow'; m.userData.mk = mk; o.add(m); meshes.push(m); }
        }
        for (const [name, p] of Object.entries(pivots)) if (p.parent) objs[p.parent].add(objs[name]);
        return { group: objs.root, pivots: objs, meshes };
      },
    };
  }
}

// ---------- detail level (LOD by quality tier) ----------
// 0 = low (phones on LOW: no greebles, fewer bone segments, no bump), 1 = full detail
let DETAIL = 1;
export function setModelDetail(d) { d = d ? 1 : 0; if (d === DETAIL) return; DETAIL = d; for (const k in TPL) delete TPL[k]; guardianTpl = null; }
const rimOf = (hex, k = 0.32) => new THREE.Color(hex).lerp(new THREE.Color(0xc8d4ff), 0.45).multiplyScalar(k);
function setRim(mats, col) { for (const k in mats) if (mats[k].userData.dis) mats[k].userData.dis.uRim.value.copy(col); }

// ---------- materials ----------
export function enemyMats(armorHex, eyeHex, edge = 0xffa040, glowI = 2.6, kind = '') {
  const T = textures(), hi = DETAIL > 0;
  let armor, dark, trim;
  if (kind === 'husk') {
    // cracked bone-white chitin: procedural crack bump + roughness, green energy glowing out of the cracks
    armor = new THREE.MeshStandardMaterial({ color: armorHex, roughness: 0.58, metalness: 0.02, map: T.crackH, roughnessMap: T.crackH, emissive: eyeHex, emissiveMap: T.crackE, emissiveIntensity: 1.4 });
    if (hi) { armor.bumpMap = T.crackH; armor.bumpScale = 1.6; }
    armor.envMapIntensity = 0.55;
    trim = new THREE.MeshStandardMaterial({ color: new THREE.Color(armorHex).multiplyScalar(0.7), roughness: 0.48, metalness: 0.05, map: T.crackH });
    if (hi) { trim.bumpMap = T.crackH; trim.bumpScale = 1.4; }
    dark = new THREE.MeshStandardMaterial({ color: 0x272a2c, roughness: 0.72, metalness: 0.08, emissive: eyeHex, emissiveMap: T.crackE, emissiveIntensity: 0.6 });
  } else {
    armor = new THREE.MeshStandardMaterial({ color: armorHex, roughness: 0.4, metalness: 0.5, roughnessMap: T.panel });
    if (hi) { armor.bumpMap = T.panel; armor.bumpScale = 0.9; }
    dark = new THREE.MeshStandardMaterial({ color: 0x2a2432, roughness: 0.65, metalness: 0.3 });
    trim = new THREE.MeshStandardMaterial({ color: 0xc8c0d4, roughness: 0.28, metalness: 0.85, roughnessMap: T.panel });
  }
  const mats = {
    armor: dissolvable(armor, edge), dark: dissolvable(dark, edge), trim: dissolvable(trim, edge),
    glow: dissolvable(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: eyeHex, emissiveIntensity: glowI, roughness: 1 }), edge),
    cloth: dissolvable(new THREE.MeshStandardMaterial({ color: new THREE.Color(armorHex).multiplyScalar(0.45), roughness: 0.95, metalness: 0, side: THREE.DoubleSide }), edge),
  };
  if (kind === 'husk') mats.dome = dissolvable(new THREE.MeshStandardMaterial({ color: 0x0c1a12, emissive: new THREE.Color(eyeHex).lerp(new THREE.Color(0xffffff), 0.35), emissiveIntensity: 0.85, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.58, depthWrite: false }), edge);
  setRim(mats, kind === 'husk' ? new THREE.Color(eyeHex).multiplyScalar(0.22) : rimOf(eyeHex, 0.3));
  mats.glow.userData.dis.uRim.value.setRGB(0, 0, 0);
  return mats;
}

// ---------- enemy templates ----------
const TPL = {};
// Husk: hunched, gaunt biped. Bone-white cracked chitin over dark sinew, long hooked claws held forward,
// narrow skull with a translucent glowing dome, a green core burning inside the ribcage, energy leaking at knees/ankles.
function huskTpl() {
  const b = new Builder(), hi = DETAIL > 0;
  b.pivot('hips', 'root', 0, 0.9, 0).pivot('torso', 'hips', 0, 0.06, 0).pivot('head', 'torso', 0, 0.66, 0.1).pivot('core', 'torso', 0, 0.3, 0.0)
    .pivot('armL', 'torso', -0.25, 0.54, 0.02).pivot('armR', 'torso', 0.25, 0.54, 0.02).pivot('foreL', 'armL', 0, -0.34, 0).pivot('foreR', 'armR', 0, -0.34, 0)
    .pivot('handL', 'foreL', 0, -0.36, 0).pivot('handR', 'foreR', 0, -0.36, 0)
    .pivot('legL', 'hips', -0.16, 0, 0).pivot('legR', 'hips', 0.16, 0, 0).pivot('shinL', 'legL', 0, -0.36, 0.05).pivot('shinR', 'legR', 0, -0.36, 0.05)
    .pivot('footL', 'shinL', 0, -0.36, -0.12).pivot('footR', 'shinR', 0, -0.36, -0.12);
  // pelvis
  b.add('hips', 'dark', 'box', 0, 0, 0, 0.26, 0.12, 0.16).add('hips', 'armor', 'sph', 0, 0.02, 0.05, 0.17, 0.09, 0.1).add('hips', 'armor', 'sph', 0, 0, -0.06, 0.15, 0.08, 0.09);
  if (hi) for (const sx of [-1, 1]) b.add('hips', 'trim', 'cone4', sx * 0.1, -0.08, 0.07, 0.03, 0.14, 0.02, Math.PI, 0, sx * 0.2);
  // spine column + vertebrae
  b.add('torso', 'dark', 'box', 0, 0.3, -0.1, 0.06, 0.6, 0.06);
  const nv = hi ? 7 : 4; for (let i = 0; i < nv; i++) b.add('torso', 'trim', 'box', 0, 0.06 + i * (0.56 / nv), -0.14, 0.075, 0.04, 0.05, 0.2);
  // ribcage: bone hoops around the glowing core
  const nr = hi ? 5 : 3;
  for (let i = 0; i < nr; i++) { const k = i / (nr - 1), y = 0.14 + k * 0.32, w = 0.2 - Math.abs(k - 0.55) * 0.08; b.add('torso', 'armor', 'tor', 0, y, 0.0, w, w * 0.78, hi ? 0.35 : 0.5, Math.PI / 2 + 0.15); }
  b.add('torso', 'dark', 'sph', 0, 0.3, -0.03, 0.12, 0.2, 0.09); // sinew behind the ribs
  // collar yoke, back plates, shoulder plates with spurs
  b.add('torso', 'armor', 'sph', 0, 0.55, 0.0, 0.27, 0.09, 0.16).add('torso', 'armor', 'sph', 0, 0.48, -0.08, 0.24, 0.17, 0.17);
  for (const sx of [-1, 1]) {
    b.add('torso', 'armor', 'sph', sx * 0.25, 0.55, -0.01, 0.16, 0.12, 0.17, 0, 0, sx * -0.35).add('torso', 'trim', 'cone4', sx * 0.31, 0.68, -0.06, 0.03, 0.16, 0.03, -0.4, 0, sx * -0.5);
    b.add('torso', 'armor', 'sph', sx * 0.135, 0.3, -0.01, 0.075, 0.18, 0.13, 0, 0, sx * 0.12);
    if (hi) b.add('torso', 'armor', 'box', sx * 0.12, 0.4, -0.13, 0.12, 0.2, 0.03, 0.3, sx * 0.3, 0);
  }
  b.add('torso', 'dark', 'cyl6', 0, 0.62, 0.06, 0.035, 0.16, 0.035, 0.6); // neck
  b.add('core', 'glow', 'sph', 0, 0, 0, 0.075, 0.09, 0.07);
  // head: narrow skull, jaw, brow, glowing eye slits, mandible hooks, translucent dome with a lit brain inside
  b.add('head', 'armor', 'sph', 0, -0.01, 0.05, 0.085, 0.1, 0.14).add('head', 'trim', 'box', 0, -0.09, 0.1, 0.07, 0.04, 0.12).add('head', 'armor', 'box', 0, 0.025, 0.15, 0.11, 0.03, 0.05, 0.3);
  for (const sx of [-1, 1]) b.add('head', 'glow', 'sphLo', sx * 0.035, 0.0, 0.18, 0.018, 0.012, 0.01).add('head', 'trim', 'cone4', sx * 0.05, -0.11, 0.16, 0.012, 0.08, 0.012, 2.4, 0, sx * 0.3);
  b.add('head', 'dome', 'sph', 0, 0.07, -0.02, 0.11, 0.1, 0.13).add('head', 'glow', 'sphLo', 0, 0.07, -0.02, 0.055, 0.05, 0.07);
  // long thin arms, bone plates, hooked claws
  for (const s of ['L', 'R']) {
    const sx = s === 'L' ? -1 : 1;
    b.add('arm' + s, 'dark', 'cyl6', 0, -0.17, 0, 0.03, 0.34, 0.03).add('arm' + s, 'armor', 'sph', sx * 0.012, -0.14, 0.01, 0.052, 0.16, 0.058).add('arm' + s, 'armor', 'sphLo', 0, -0.34, 0, 0.045, 0.045, 0.045);
    b.add('fore' + s, 'dark', 'cyl6', 0, -0.18, 0, 0.025, 0.36, 0.025).add('fore' + s, 'armor', 'sph', 0, -0.16, 0.02, 0.058, 0.17, 0.062);
    if (hi) b.add('fore' + s, 'trim', 'cone4', sx * 0.02, -0.05, -0.03, 0.012, 0.1, 0.012, -2.6);
    b.add('hand' + s, 'trim', 'box', 0, -0.03, 0.0, 0.05, 0.06, 0.04);
    for (let c = 0; c < 3; c++) { const dx = (c - 1) * 0.022; b.add('hand' + s, 'trim', 'cone4', dx, -0.1, 0.0, 0.012, 0.12, 0.012, Math.PI).add('hand' + s, 'armor', 'cone4', dx, -0.17, 0.035, 0.009, 0.09, 0.009, Math.PI - 1.0); }
  }
  // long digitigrade legs, energy leaking from cracked knees and ankles
  for (const s of ['L', 'R']) {
    const sx = s === 'L' ? -1 : 1;
    b.add('leg' + s, 'dark', 'cyl6', 0, -0.18, 0.02, 0.045, 0.36, 0.045, -0.1).add('leg' + s, 'armor', 'sph', sx * 0.01, -0.16, 0.03, 0.088, 0.2, 0.092, -0.1);
    if (hi) b.add('leg' + s, 'armor', 'box', sx * 0.06, -0.12, 0.0, 0.03, 0.2, 0.11, 0, 0, sx * 0.12);
    b.add('leg' + s, 'armor', 'sph', 0, -0.36, 0.06, 0.055, 0.055, 0.06).add('leg' + s, 'glow', 'sphLo', 0, -0.37, 0.1, 0.028, 0.022, 0.014);
    b.add('shin' + s, 'dark', 'cyl6', 0, -0.18, -0.06, 0.035, 0.4, 0.035, 0.33).add('shin' + s, 'armor', 'sph', 0, -0.15, -0.06, 0.066, 0.2, 0.07, 0.33);
    b.add('foot' + s, 'glow', 'sphLo', 0, 0, 0, 0.032, 0.03, 0.032).add('foot' + s, 'dark', 'cyl6', 0, -0.09, 0.03, 0.03, 0.2, 0.03, -0.35).add('foot' + s, 'armor', 'box', 0, -0.15, 0.05, 0.075, 0.07, 0.12);
    for (let c = -1; c <= 1; c++) b.add('foot' + s, 'trim', 'cone4', c * 0.035, -0.17, 0.1, 0.018, 0.13, 0.012, Math.PI / 2, c * 0.25, 0);
    if (hi) b.add('foot' + s, 'trim', 'cone4', 0, -0.15, -0.05, 0.015, 0.08, 0.015, -Math.PI / 2);
  }
  return { tpl: b.done() };
}
function lancerTpl() {
  const b = new Builder();
  b.pivot('hips', 'root', 0, 0.95, 0).pivot('torso', 'hips', 0, 0.1, 0).pivot('head', 'torso', 0, 0.78, 0.02)
    .pivot('legL', 'hips', -0.17, 0, 0).pivot('legR', 'hips', 0.17, 0, 0).pivot('shinL', 'legL', 0, -0.45, 0).pivot('shinR', 'legR', 0, -0.45, 0)
    .pivot('armL', 'torso', -0.38, 0.55, 0).pivot('armR', 'torso', 0.38, 0.55, 0).pivot('cape', 'torso', 0, 0.6, -0.2);
  b.add('hips', 'dark', 'box', 0, 0, 0, 0.42, 0.2, 0.26).add('hips', 'cloth', 'box', 0, -0.25, 0.14, 0.3, 0.4, 0.02);
  b.add('torso', 'armor', 'box', 0, 0.35, 0, 0.56, 0.5, 0.32).add('torso', 'armor', 'box', 0, 0.62, 0.02, 0.62, 0.18, 0.34)
    .add('torso', 'trim', 'box', 0, 0.38, 0.17, 0.3, 0.3, 0.03).add('torso', 'glow', 'box', 0, 0.42, 0.19, 0.1, 0.14, 0.02)
    .add('torso', 'dark', 'box', 0, 0.06, 0, 0.44, 0.18, 0.26);
  b.add('torso', 'armor', 'sph', -0.38, 0.62, 0, 0.17, 0.12, 0.2).add('torso', 'armor', 'sph', 0.38, 0.62, 0, 0.17, 0.12, 0.2)
    .add('torso', 'trim', 'cone4', -0.42, 0.74, 0, 0.05, 0.22, 0.05, 0, 0, 0.4).add('torso', 'trim', 'cone4', 0.42, 0.74, 0, 0.05, 0.22, 0.05, 0, 0, -0.4);
  // hooded head with visor slit + crest
  b.add('head', 'cloth', 'sph', 0, 0.12, -0.03, 0.2, 0.23, 0.22).add('head', 'armor', 'box', 0, 0.1, 0.08, 0.26, 0.24, 0.2)
    .add('head', 'glow', 'box', 0, 0.12, 0.185, 0.2, 0.04, 0.02).add('head', 'trim', 'cone4', 0, 0.32, 0, 0.04, 0.24, 0.12);
  for (const s of ['L', 'R']) {
    const sx = s === 'L' ? -1 : 1;
    b.add('leg' + s, 'dark', 'box', 0, -0.22, 0, 0.16, 0.46, 0.18).add('leg' + s, 'armor', 'box', 0, -0.16, 0.06, 0.18, 0.28, 0.1);
    b.add('shin' + s, 'dark', 'box', 0, -0.22, 0, 0.13, 0.44, 0.14).add('shin' + s, 'armor', 'box', 0, -0.2, 0.06, 0.15, 0.3, 0.06).add('shin' + s, 'dark', 'box', 0, -0.45, 0.06, 0.16, 0.08, 0.28);
    b.add('arm' + s, 'dark', 'box', 0, -0.22, 0, 0.12, 0.42, 0.12).add('arm' + s, 'armor', 'box', sx * 0.02, -0.12, 0, 0.15, 0.2, 0.15);
  }
  // rifle held in right arm, pointing forward
  // rifle runs down the arm axis (-y) so it points forward when the arm is raised
  b.add('armR', 'dark', 'box', -0.05, -0.62, 0.06, 0.08, 0.8, 0.11).add('armR', 'trim', 'box', -0.05, -0.9, 0.1, 0.04, 0.5, 0.04).add('armR', 'glow', 'box', -0.05, -0.56, 0.125, 0.05, 0.3, 0.02)
    .add('armR', 'trim', 'cyl', -0.05, -1.12, 0.1, 0.03, 0.14, 0.03);
  b.add('cape', 'cloth', 'box', 0, -0.55, 0, 0.5, 1.1, 0.02);
  if (DETAIL > 0) { // layered chest plate, belt, knee guards, back spines, eye lenses
    b.add('torso', 'trim', 'box', 0, 0.22, 0.17, 0.4, 0.05, 0.03).add('torso', 'armor', 'box', 0, 0.5, 0.19, 0.42, 0.1, 0.04, -0.25);
    b.add('hips', 'trim', 'box', 0, 0.08, 0, 0.46, 0.06, 0.3).add('hips', 'glow', 'box', 0, 0.08, 0.152, 0.06, 0.03, 0.01);
    for (const s of ['L', 'R']) b.add('shin' + s, 'trim', 'box', 0, -0.02, 0.1, 0.14, 0.1, 0.05, 0.3);
    for (let i = 0; i < 3; i++) b.add('torso', 'trim', 'cone4', 0, 0.62 - i * 0.16, -0.2, 0.04, 0.2, 0.04, -0.9);
    b.add('head', 'glow', 'sphLo', -0.06, 0.12, 0.19, 0.025, 0.02, 0.01).add('head', 'glow', 'sphLo', 0.06, 0.12, 0.19, 0.025, 0.02, 0.01);
  }
  return { tpl: b.done() };
}
function bulwarkTpl() {
  const b = new Builder();
  b.pivot('hips', 'root', 0, 1.0, 0).pivot('torso', 'hips', 0, 0.15, 0).pivot('head', 'torso', 0, 1.3, 0.25)
    .pivot('legL', 'hips', -0.38, 0, 0).pivot('legR', 'hips', 0.38, 0, 0)
    .pivot('armL', 'torso', -0.95, 1.0, 0).pivot('armR', 'torso', 0.95, 1.0, 0).pivot('vents', 'torso', 0, 0.8, -0.55);
  b.add('hips', 'dark', 'box', 0, 0, 0, 0.9, 0.35, 0.6);
  b.add('torso', 'armor', 'box', 0, 0.6, 0, 1.5, 1.0, 0.95).add('torso', 'armor', 'box', 0, 1.15, 0.05, 1.7, 0.4, 1.05)
    .add('torso', 'trim', 'box', 0, 0.6, 0.49, 0.9, 0.7, 0.05).add('torso', 'glow', 'sph', 0, 0.7, 0.52, 0.18, 0.18, 0.06)
    .add('torso', 'dark', 'box', 0, 0.12, 0, 1.2, 0.3, 0.8);
  for (let i = 0; i < 3; i++) b.add('torso', 'trim', 'box', 0, 0.25 + i * 0.22, 0.5, 1.2 - i * 0.1, 0.04, 0.04);
  b.add('vents', 'dark', 'box', 0, 0, 0, 1.0, 0.7, 0.3);
  for (let i = 0; i < 3; i++) b.add('vents', 'glow', 'cyl6', -0.3 + i * 0.3, 0.1, -0.16, 0.08, 0.5, 0.08);
  b.add('head', 'armor', 'box', 0, 0.1, 0, 0.5, 0.42, 0.48).add('head', 'dark', 'box', 0, 0.02, 0.2, 0.42, 0.2, 0.15);
  for (const x of [-0.13, 0, 0.13]) b.add('head', 'glow', 'sphLo', x, 0.12, 0.25, 0.05, 0.05, 0.03);
  for (const s of ['L', 'R']) {
    const sx = s === 'L' ? -1 : 1;
    b.add('torso', 'armor', 'sph', sx * 0.95, 1.15, 0, 0.5, 0.38, 0.55).add('torso', 'trim', 'box', sx * 1.05, 1.42, 0, 0.5, 0.08, 0.6, 0, 0, sx * -0.3);
    b.add('leg' + s, 'dark', 'box', 0, -0.5, 0, 0.42, 0.95, 0.45).add('leg' + s, 'armor', 'box', 0, -0.38, 0.12, 0.48, 0.55, 0.3).add('leg' + s, 'dark', 'box', 0, -0.95, 0.1, 0.5, 0.15, 0.7);
    b.add('arm' + s, 'dark', 'box', 0, -0.4, 0, 0.36, 0.8, 0.4).add('arm' + s, 'armor', 'box', 0, -0.6, 0.05, 0.44, 0.45, 0.46);
  }
  // arm cannon (right)
  b.add('armR', 'dark', 'cyl', 0, -0.75, 0.5, 0.2, 1.0, 0.2, Math.PI / 2).add('armR', 'trim', 'tor', 0, -0.75, 0.8, 0.22, 0.22, 0.4)
    .add('armR', 'glow', 'cyl', 0, -0.75, 1.0, 0.12, 0.04, 0.12, Math.PI / 2).add('armR', 'trim', 'box', 0, -0.52, 0.4, 0.1, 0.1, 0.8);
  // shield plate (left)
  b.add('armL', 'armor', 'box', -0.15, -0.6, 0.35, 0.12, 1.1, 0.8).add('armL', 'glow', 'box', -0.22, -0.6, 0.35, 0.02, 0.6, 0.06);
  if (DETAIL > 0) { // reactor ring around the chest core, shoulder spikes, horned faceguard, rivets, leg glow seams
    b.add('torso', 'trim', 'tor', 0, 0.7, 0.5, 0.3, 0.3, 0.4);
    for (const sx of [-1, 1]) {
      b.add('torso', 'trim', 'cone4', sx * 1.1, 1.62, -0.1, 0.08, 0.42, 0.08, -0.2, 0, sx * -0.5).add('head', 'trim', 'cone4', sx * 0.24, 0.36, 0.05, 0.05, 0.3, 0.05, 0.3, 0, sx * -0.5);
      for (let i = 0; i < 3; i++) b.add('torso', 'trim', 'sphLo', sx * 0.62, 0.3 + i * 0.25, 0.49, 0.035, 0.035, 0.02);
    }
    b.add('legL', 'glow', 'box', 0, -0.38, 0.28, 0.2, 0.03, 0.02).add('legR', 'glow', 'box', 0, -0.38, 0.28, 0.2, 0.03, 0.02);
  }
  return { tpl: b.done() };
}
function regentTpl() {
  const b = new Builder();
  b.pivot('base', 'root', 0, 0, 0).pivot('torso', 'root', 0, 2.6, 0).pivot('head', 'torso', 0, 2.55, 0.25)
    .pivot('armL', 'torso', -2.1, 1.9, 0).pivot('armR', 'torso', 2.1, 1.9, 0).pivot('crown', 'head', 0, 0.75, 0).pivot('core', 'torso', 0, 1.15, 0.85)
    .pivot('halo', 'torso', 0, 2.8, -1.1);
  // robed lower body (layered cones) + feet claws
  b.add('base', 'cloth', 'cone', 0, 1.35, 0, 1.9, 2.7, 1.7).add('base', 'armor', 'cone', 0, 1.9, 0, 1.4, 1.6, 1.25)
    .add('base', 'trim', 'tor', 0, 0.12, 0, 1.85, 1.65, 1.2, Math.PI / 2).add('base', 'glow', 'tor', 0, 1.25, 0, 1.6, 1.45, 0.25, Math.PI / 2);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; b.add('base', 'dark', 'cone4', Math.cos(a) * 1.7, 0.3, Math.sin(a) * 1.5, 0.22, 0.8, 0.22, Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6); }
  // torso
  b.add('torso', 'armor', 'box', 0, 1.1, 0, 2.6, 1.9, 1.5).add('torso', 'armor', 'box', 0, 2.0, 0, 3.4, 0.7, 1.8).add('torso', 'dark', 'box', 0, 0.2, 0, 2.0, 0.6, 1.3)
    .add('torso', 'trim', 'box', 0, 1.15, 0.76, 1.6, 1.4, 0.06).add('torso', 'trim', 'tor', 0, 1.15, 0.8, 0.55, 0.55, 0.6);
  for (let i = 0; i < 4; i++) b.add('torso', 'glow', 'box', -1.05 + i * 0.7, 0.3, 0.68, 0.04, 0.3, 0.03);
  for (const sx of [-1, 1]) {
    b.add('torso', 'armor', 'sph', sx * 1.9, 2.15, 0, 0.9, 0.7, 0.95).add('torso', 'trim', 'cone4', sx * 2.15, 2.9, -0.2, 0.18, 1.5, 0.18, -0.2, 0, sx * -0.35)
      .add('torso', 'trim', 'cone4', sx * 1.7, 2.8, 0.2, 0.12, 1.0, 0.12, 0.1, 0, sx * -0.2).add('torso', 'glow', 'sphLo', sx * 1.9, 2.2, 0.85, 0.12, 0.12, 0.08);
  }
  b.add('core', 'glow', 'ico', 0, 0, 0, 0.42, 0.42, 0.42).add('core', 'trim', 'tor', 0, 0, -0.05, 0.62, 0.62, 0.9);
  // head: horned mask with burning eye slit
  b.add('head', 'armor', 'box', 0, 0.1, 0, 1.15, 1.05, 1.05).add('head', 'dark', 'box', 0, -0.15, 0.4, 0.95, 0.45, 0.35)
    .add('head', 'glow', 'box', 0, 0.12, 0.54, 0.85, 0.12, 0.04).add('head', 'glow', 'sphLo', 0, -0.2, 0.56, 0.1, 0.1, 0.04)
    .add('head', 'trim', 'cone4', -0.6, 0.55, 0, 0.12, 0.9, 0.12, 0, 0, 0.6).add('head', 'trim', 'cone4', 0.6, 0.55, 0, 0.12, 0.9, 0.12, 0, 0, -0.6);
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; b.add('crown', 'glow', 'cone4', Math.cos(a) * 0.55, 0.25 + (i % 2) * 0.2, Math.sin(a) * 0.55, 0.08, 0.6 + (i % 2) * 0.35, 0.08); }
  b.add('crown', 'trim', 'tor', 0, 0, 0, 0.6, 0.6, 0.6, Math.PI / 2);
  b.add('halo', 'trim', 'tor', 0, 0, 0, 1.9, 1.9, 0.5).add('halo', 'glow', 'tor', 0, 0, 0, 2.2, 2.2, 0.15);
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; b.add('halo', 'trim', 'cone4', Math.cos(a) * 2.4, Math.sin(a) * 2.4, 0, 0.07, 0.5, 0.07, 0, 0, a - Math.PI / 2); }
  for (const s of ['L', 'R']) {
    const sx = s === 'L' ? -1 : 1;
    b.add('arm' + s, 'dark', 'box', 0, -0.9, 0, 0.6, 1.8, 0.65).add('arm' + s, 'armor', 'box', 0, -0.6, 0.05, 0.75, 0.9, 0.75)
      .add('arm' + s, 'trim', 'box', 0, -1.85, 0.2, 0.5, 0.4, 0.5)
      .add('arm' + s, 'glow', 'cone4', sx * 0.05, -2.6, 0.55, 0.05, 1.5, 0.1, 0.5); // energy blade
  }
  if (DETAIL > 0) { // glowing weak points ringed in metal, great swept horns, tusks, spine crystals
    for (const sx of [-1, 1]) {
      b.add('torso', 'trim', 'tor', sx * 1.9, 2.2, 0.86, 0.26, 0.26, 0.5).add('torso', 'glow', 'sph', sx * 1.9, 2.2, 0.86, 0.17, 0.17, 0.09);
      b.add('head', 'trim', 'cone4', sx * 0.75, 0.95, -0.2, 0.16, 1.7, 0.16, -0.35, 0, sx * -0.45);
      b.add('head', 'armor', 'cone4', sx * 0.42, -0.55, 0.48, 0.08, 0.5, 0.08, Math.PI - 0.3, 0, sx * 0.2);
      b.add('torso', 'armor', 'box', sx * 0.85, 0.35, 0.72, 0.55, 0.6, 0.08, 0, sx * 0.2, 0);
    }
    for (let i = 0; i < 5; i++) b.add('torso', 'glow', 'oct', 0, 0.5 + i * 0.42, -0.82, 0.12, 0.24, 0.12);
  }
  return { tpl: b.done() };
}

// palette per type (armor, eye/emissive). Husk variants are recolors/rescales of one design.
export const ENEMY_LOOK = {
  husk: { armor: 0xf2ead6, eye: 0x7dffa8, edge: 0x5dff8e, kind: 'husk' },
  huskRunner: { armor: 0xc4ccb4, eye: 0xc4ff6a, edge: 0xb0ff5a, kind: 'husk', model: 'husk', scale: 0.8 },
  huskBrute: { armor: 0xa69a88, eye: 0x4dffd0, edge: 0x40ffc0, kind: 'husk', model: 'husk', scale: 1.4 },
  lancer: { armor: 0x8a9c72, eye: 0xffa020, edge: 0xffb040 },
  bulwark: { armor: 0x9a64a8, eye: 0xff3a9a, edge: 0xff50b0 },
  regent: { armor: 0x6a5a88, eye: 0xffc84a, edge: 0xffd060 },
};
export function buildEnemyModel(type, { shadows = false } = {}) {
  const L = ENEMY_LOOK[type] || ENEMY_LOOK.husk, mk = L.model || type;
  if (!TPL[mk]) TPL[mk] = mk === 'husk' ? huskTpl() : mk === 'lancer' ? lancerTpl() : mk === 'bulwark' ? bulwarkTpl() : regentTpl();
  const mats = enemyMats(L.armor, L.eye, L.edge, mk === 'regent' ? 1.7 : mk === 'husk' ? 2.2 : 2.6, L.kind || '');
  const { group, pivots, meshes } = TPL[mk].tpl.build(mats, { shadows });
  for (const m of meshes) if (m.userData.mk === 'dome') { m.castShadow = false; m.renderOrder = 2; }
  const rig = { type: mk, variant: type, pivots, mats, legs: null, t: Math.random() * 10, fl: 0 };
  // light glows (sprites) for bloom focus
  if (mk === 'husk') { const g = glowSprite(L.eye, 0.55, 0.45); g.position.set(0, 0.07, -0.02); pivots.head.add(g); const c = glowSprite(L.eye, 0.6, 0.55); pivots.core.add(c); rig.coreGlow = c; }
  if (mk === 'lancer') { const g = glowSprite(L.eye, 0.6, 0.6); g.position.set(0, 0.12, 0.22); pivots.head.add(g); }
  if (mk === 'bulwark') { const g = glowSprite(L.eye, 1, 0.6); g.position.set(0, 0.12, 0.3); pivots.head.add(g); const c = glowSprite(L.eye, 1.2, 0.4); c.position.set(0, 0.7, 0.6); pivots.torso.add(c); }
  if (mk === 'regent') {
    const h = glowSprite(L.eye, 7, 0.12); pivots.halo.add(h);
    const c = glowSprite(L.eye, 3.2, 0.7); pivots.core.add(c); rig.coreGlow = c;
    const e = glowSprite(L.eye, 2.2, 0.5); e.position.set(0, 0.12, 0.6); pivots.head.add(e);
    if (DETAIL > 0) for (const sx of [-1, 1]) { const w = glowSprite(L.eye, 1.3, 0.5); w.position.set(sx * 1.9, 2.2, 0.95); pivots.torso.add(w); }
    // orbiting shards
    rig.shards = [];
    for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(G.oct, mats.glow); m.scale.set(0.16, 0.5, 0.16); group.add(m); rig.shards.push(m); }
  }
  return { group, rig, meshes, scale: L.scale || 1 };
}

const lerp = (a, b, k) => a + (b - a) * k;
// per-frame procedural animation; `move` 0..1, `state` string from AI; extra: { phase, k, stT, hit }
export function animateEnemy(rig, dt, move, state, extra = {}) {
  // living emissives: eyes/cores breathe, flare brighter while winding up an attack
  const gm = rig.mats && rig.mats.glow;
  if (gm) { rig.glowT = (rig.glowT || Math.random() * 6) + dt; rig.glowI ??= gm.emissiveIntensity;
    const atk = state === 'tele' || state === 'fire' || state === 'shove' ? 1.6 : 1;
    gm.emissiveIntensity = rig.glowI * atk * (0.78 + 0.22 * Math.sin(rig.glowT * 4.2) + 0.08 * Math.sin(rig.glowT * 13.7)); }
  // hit flinch: a sharp recoil that springs back
  if (extra.hit) rig.fl = 1; rig.fl = Math.max(0, (rig.fl || 0) - dt * 6); const fl = rig.fl * rig.fl;
  rig.t += dt; const t = rig.t, P = rig.pivots;
  if (rig.type === 'husk') {
    // fast lurching sprint: long strides, side-to-side lurch, claws raised and swinging
    rig.ph = (rig.ph || 0) + dt * (5 + move * 7.5); const ph = rig.ph, s = Math.sin(ph), c = Math.cos(ph), m = move;
    const br = Math.sin(t * 2.1);
    P.legL.rotation.x = -s * 0.8 * m - 0.12; P.legR.rotation.x = s * 0.8 * m - 0.12;
    P.legL.rotation.z = -0.2; P.legR.rotation.z = 0.2;
    P.shinL.rotation.x = 0.4 + Math.max(0, s) * 1.0 * m; P.shinR.rotation.x = 0.4 + Math.max(0, -s) * 1.0 * m;
    P.footL.rotation.x = -(P.legL.rotation.x + P.shinL.rotation.x) * 0.85; P.footR.rotation.x = -(P.legR.rotation.x + P.shinR.rotation.x) * 0.85;
    P.footL.rotation.z = 0.2; P.footR.rotation.z = -0.2;
    P.hips.position.y = 0.86 - m * 0.05 + Math.abs(c) * 0.08 * m + br * 0.006;
    P.hips.rotation.y = s * 0.16 * m; P.hips.rotation.z = c * 0.06 * m;
    P.torso.rotation.x = 0.5 + 0.25 * m + br * 0.03; P.torso.rotation.y = -s * 0.22 * m; P.torso.rotation.z = -c * 0.1 * m;
    P.torso.scale.set(1, 1 + br * 0.015, 1 + br * 0.035);
    P.head.rotation.x = -0.5 - 0.22 * m + s * 0.05 * m; P.head.rotation.y = Math.sin(t * 0.8) * 0.3 * (1 - m) + (Math.sin(t * 0.9) > 0.85 ? Math.sin(t * 31) * 0.12 : 0);
    P.head.rotation.z = Math.sin(t * 0.6) * 0.1;
    let aL = -0.85 + s * 0.6 * m, aR = -0.85 - s * 0.6 * m, fL = -1.05 + c * 0.25 * m, fR = -1.05 - c * 0.25 * m, zL = -0.12 - 0.12 * m, zR = 0.12 + 0.12 * m, tx = 0;
    if (state === 'tele') { // lunge + swipe: claws wind up high, then rake down as it leaps
      const k = extra.stT || 0, wind = Math.min(1, k / 0.18), strike = k > 0.18 ? Math.min(1, (k - 0.18) / 0.14) : 0;
      aR = lerp(lerp(aR, -2.6, wind), 0.25, strike); fR = lerp(lerp(fR, -0.5, wind), -0.25, strike); zR = lerp(0.2, 0.45, wind * (1 - strike));
      aL = lerp(lerp(aL, -2.3, wind), 0.1, Math.max(0, strike - 0.25) / 0.75); fL = lerp(fL, -0.6, wind); zL = lerp(-0.2, -0.45, wind * (1 - strike));
      tx = lerp(-0.25, 0.55, strike) * wind;
    }
    P.armL.rotation.set(aL, 0, zL); P.armR.rotation.set(aR, 0, zR); P.foreL.rotation.x = fL; P.foreR.rotation.x = fR;
    P.handL.rotation.x = -0.35; P.handR.rotation.x = -0.35;
    P.torso.rotation.x += tx - fl * 0.5; P.head.rotation.x -= fl * 0.4; P.torso.rotation.z += fl * 0.15;
    const cp = 1 + Math.sin(t * 5) * 0.12 + (state === 'tele' ? 0.3 : 0); P.core.scale.setScalar(cp);
    if (rig.coreGlow) rig.coreGlow.scale.setScalar(0.6 * cp);
  } else if (rig.type === 'lancer' || rig.type === 'bulwark') {
    const big = rig.type === 'bulwark', sp = big ? 5.5 : 8, sw = Math.sin(t * sp) * (big ? 0.4 : 0.6) * move;
    P.legL.rotation.x = sw; P.legR.rotation.x = -sw;
    if (P.shinL) { P.shinL.rotation.x = Math.max(0, -sw) * 0.9; P.shinR.rotation.x = Math.max(0, sw) * 0.9; }
    P.hips.position.y = (big ? 1.0 : 0.95) + Math.abs(Math.cos(t * sp)) * (big ? 0.06 : 0.05) * move + Math.sin(t * 1.6) * 0.015;
    P.torso.rotation.y = Math.sin(t * sp) * 0.08 * move; P.torso.rotation.x = 0.05 + Math.sin(t * 1.6) * 0.02 - fl * (big ? 0.15 : 0.35);
    const aim = state === 'tele' || state === 'fire';
    P.armL.rotation.x = aim ? -1.2 : -sw * 0.6 + Math.sin(t * 1.3) * 0.05;
    P.armR.rotation.x = aim ? -1.45 + (state === 'fire' ? Math.sin(t * 40) * 0.05 : 0) : -0.9 + Math.sin(t * 1.3) * 0.05;
    if (big) { P.armL.rotation.x = state === 'shove' ? -1.4 : -0.5 - sw * 0.3; if (P.vents) P.vents.scale.y = 1 + Math.sin(t * 4) * 0.06; }
    P.head.rotation.y = Math.sin(t * 0.9) * 0.2; P.head.rotation.x = Math.sin(t * 1.4) * 0.05 - fl * 0.3;
    if (P.cape) P.cape.rotation.x = 0.15 + move * 0.35 + Math.sin(t * 3.1) * 0.08;
  } else if (rig.type === 'regent') {
    const ph2 = extra.phase === 2;
    P.torso.position.y = 2.6 + Math.sin(t * 1.5) * 0.18; P.torso.rotation.y = Math.sin(t * 0.7) * 0.1; P.torso.rotation.x = -fl * 0.06;
    P.crown.rotation.y += dt * (ph2 ? 2.4 : 0.8); P.crown.position.y = 0.75 + Math.sin(t * 2.2) * 0.08;
    P.halo.rotation.z += dt * (ph2 ? 1.2 : 0.35);
    const raise = state === 'volley' ? -1.6 : state === 'slam' ? -2.6 + Math.min(1, extra.k || 0) * 2.4 : state === 'summon' ? -2.9 : -0.25;
    P.armL.rotation.x = raise + Math.sin(t * 1.1) * 0.08; P.armR.rotation.x = (state === 'summon' ? -2.9 : raise) + Math.sin(t * 1.3 + 1) * 0.08;
    P.armL.rotation.z = -0.25 - (state === 'summon' ? 0.4 : 0); P.armR.rotation.z = 0.25 + (state === 'summon' ? 0.4 : 0);
    const cp = 1 + Math.sin(t * (ph2 ? 9 : 4)) * 0.12; P.core.scale.setScalar(cp); P.core.rotation.z += dt * 2;
    if (rig.coreGlow) rig.coreGlow.scale.setScalar((ph2 ? 4.2 : 3.2) * cp);
    rig.shards.forEach((m, i) => { const a = t * (ph2 ? 1.6 : 0.7) + i / rig.shards.length * Math.PI * 2, r = 3.2 + Math.sin(t + i) * 0.3; m.position.set(Math.cos(a) * r, 3.8 + Math.sin(a * 2 + i) * 0.8, Math.sin(a) * r); m.rotation.y += dt * 3; });
  }
}
// death pose: k 0..1 — knees buckle and the body folds forward while it dissolves
export function poseEnemyDeath(rig, k) {
  const P = rig.pivots, e = 1 - (1 - k) * (1 - k);
  if (rig.type === 'husk') {
    P.hips.position.y = 0.86 * (1 - e * 0.72); P.legL.rotation.x = -0.12 - 0.9 * e; P.legR.rotation.x = -0.12 - 0.7 * e;
    P.shinL.rotation.x = 0.4 + 1.7 * e; P.shinR.rotation.x = 0.4 + 1.9 * e; P.footL.rotation.x = 0.3 * e; P.footR.rotation.x = 0.3 * e;
    P.torso.rotation.x = 0.7 + 0.75 * e; P.torso.rotation.z = 0.15 * e; P.head.rotation.x = 0.4 * e - 0.4 * (1 - e);
    P.armL.rotation.set(-0.8 * (1 - e) + 0.15 * e, 0, -0.28 - 0.35 * e); P.armR.rotation.set(-0.8 * (1 - e) + 0.25 * e, 0, 0.28 + 0.4 * e);
    P.foreL.rotation.x = -0.9 * (1 - e) - 0.1; P.foreR.rotation.x = -0.9 * (1 - e) - 0.1;
  } else if (rig.type === 'lancer' || rig.type === 'bulwark') {
    P.hips.position.y = (rig.type === 'bulwark' ? 1.0 : 0.95) * (1 - e * 0.45); P.torso.rotation.x = 0.05 + 0.9 * e;
    P.legL.rotation.x = -0.8 * e; P.legR.rotation.x = -0.5 * e; if (P.shinL) { P.shinL.rotation.x = 1.4 * e; P.shinR.rotation.x = 1.2 * e; }
    P.armL.rotation.x = -0.3 * e; P.armR.rotation.x = -0.4 * e; P.head.rotation.x = 0.5 * e;
  }
}
export function setEnemyFlash(rig, v) { for (const k in rig.mats) rig.mats[k].userData.dis.uFlash.value = v; }
export function setEnemyDissolve(rig, v) { for (const k in rig.mats) rig.mats[k].userData.dis.uDis.value = v; }
export function setEnemyGlowColor(rig, hex) { rig.mats.glow.emissive.setHex(hex); }
export function disposeEnemy(rig) { for (const k in rig.mats) rig.mats[k].dispose(); }

// ---------- Guardian (player avatar: co-op partner + title backdrop) ----------
// Layered sci-fi armor: helmet with a wraparound visor glow, layered shoulder pads, chest plate over an undersuit,
// gauntlets, knee guards, boots, a jump pack and a split cloak that sways. Trim/visor = class colour, accent = player colour.
let guardianTpl = null;
function buildGuardianTpl() {
  const b = new Builder(), hi = DETAIL > 0;
  b.pivot('hips', 'root', 0, 1.0, 0).pivot('torso', 'hips', 0, 0.06, 0).pivot('head', 'torso', 0, 0.74, 0.02)
    .pivot('legL', 'hips', -0.12, -0.02, 0).pivot('legR', 'hips', 0.12, -0.02, 0).pivot('shinL', 'legL', 0, -0.47, 0).pivot('shinR', 'legR', 0, -0.47, 0)
    .pivot('armL', 'torso', -0.31, 0.6, 0).pivot('armR', 'torso', 0.31, 0.6, 0).pivot('foreL', 'armL', 0, -0.3, 0).pivot('foreR', 'armR', 0, -0.3, 0)
    .pivot('cloakL', 'torso', -0.1, 0.62, -0.19).pivot('cloakR', 'torso', 0.1, 0.62, -0.19);
  // hips: undersuit, accent belt with glowing buckle, armored tassets, tabard
  b.add('hips', 'dark', 'box', 0, 0, 0, 0.32, 0.16, 0.2).add('hips', 'accent', 'box', 0, 0.05, 0, 0.35, 0.05, 0.23).add('hips', 'glow', 'box', 0, 0.05, 0.118, 0.06, 0.028, 0.01);
  for (const sx of [-1, 1]) b.add('hips', 'armor', 'box', sx * 0.12, -0.09, 0.07, 0.12, 0.16, 0.035, -0.12, 0, sx * 0.12);
  b.add('hips', 'cloth', 'box', 0, -0.22, 0.12, 0.15, 0.36, 0.015);
  // torso: undersuit, segmented abdomen, chest plate, sloped upper plate, trim + accent stripes, collar
  b.add('torso', 'dark', 'box', 0, 0.28, 0, 0.34, 0.5, 0.21);
  if (hi) for (let i = 0; i < 3; i++) b.add('torso', 'armor', 'box', 0, 0.08 + i * 0.075, 0.1, 0.27 - i * 0.01, 0.055, 0.03);
  b.add('torso', 'armor', 'box', 0, 0.47, 0, 0.44, 0.24, 0.26).add('torso', 'armor', 'box', 0, 0.56, 0.12, 0.38, 0.11, 0.06, -0.4)
    .add('torso', 'trim', 'box', 0, 0.45, 0.133, 0.06, 0.2, 0.02).add('torso', 'glow', 'box', 0, 0.5, 0.145, 0.025, 0.07, 0.01);
  for (const sx of [-1, 1]) b.add('torso', 'accent', 'box', sx * 0.15, 0.44, 0.131, 0.035, 0.16, 0.02);
  b.add('torso', 'dark', 'cyl', 0, 0.66, 0, 0.09, 0.08, 0.09);
  // layered shoulder pads
  for (const sx of [-1, 1]) {
    b.add('torso', 'armor', 'sph', sx * 0.31, 0.62, 0, 0.14, 0.09, 0.15).add('torso', 'armor', 'box', sx * 0.35, 0.6, 0, 0.17, 0.045, 0.21, 0, 0, sx * -0.45)
      .add('torso', 'trim', 'box', sx * 0.41, 0.55, 0, 0.13, 0.02, 0.215, 0, 0, sx * -0.6);
    if (hi) b.add('torso', 'armor', 'box', sx * 0.39, 0.52, 0, 0.12, 0.035, 0.18, 0, 0, sx * -0.75).add('torso', 'accent', 'box', sx * 0.43, 0.48, 0, 0.09, 0.015, 0.182, 0, 0, sx * -0.85);
  }
  // jump pack with glowing thrusters
  b.add('torso', 'dark', 'box', 0, 0.42, -0.15, 0.28, 0.3, 0.1).add('torso', 'armor', 'box', 0, 0.46, -0.2, 0.24, 0.18, 0.03);
  for (const sx of [-1, 1]) b.add('torso', 'trim', 'cyl6', sx * 0.08, 0.24, -0.16, 0.04, 0.07, 0.04).add('torso', 'glow', 'cyl6', sx * 0.08, 0.2, -0.16, 0.03, 0.012, 0.03);
  // helmet: dome, faceplate, wraparound visor, crest, ear discs, antenna
  b.add('head', 'dark', 'cyl', 0, -0.02, 0, 0.07, 0.08, 0.07).add('head', 'armor', 'sph', 0, 0.12, -0.01, 0.135, 0.15, 0.155)
    .add('head', 'armor', 'box', 0, 0.06, 0.08, 0.19, 0.12, 0.1).add('head', 'glow', 'box', 0, 0.125, 0.128, 0.19, 0.042, 0.03);
  for (const sx of [-1, 1]) b.add('head', 'glow', 'box', sx * 0.105, 0.125, 0.07, 0.02, 0.038, 0.09, 0, sx * 0.55, 0).add('head', 'trim', 'cyl', sx * 0.135, 0.1, -0.01, 0.05, 0.03, 0.05, 0, 0, Math.PI / 2);
  b.add('head', 'trim', 'box', 0, 0.27, -0.01, 0.032, 0.045, 0.26);
  if (hi) b.add('head', 'dark', 'box', 0, 0.02, 0.13, 0.08, 0.035, 0.02).add('head', 'accent', 'cyl6', 0.12, 0.24, -0.07, 0.006, 0.16, 0.006, -0.25);
  // legs: thigh + armored plate + accent stripe + knee guard; shin guard + boot with toe cap
  for (const s of ['L', 'R']) {
    const sx = s === 'L' ? -1 : 1;
    b.add('leg' + s, 'dark', 'box', 0, -0.22, 0, 0.14, 0.46, 0.16).add('leg' + s, 'armor', 'box', 0, -0.16, 0.055, 0.15, 0.26, 0.07)
      .add('leg' + s, 'accent', 'box', sx * 0.072, -0.2, 0, 0.012, 0.3, 0.06).add('leg' + s, 'armor', 'box', 0, -0.45, 0.075, 0.13, 0.1, 0.06, 0.15);
    b.add('shin' + s, 'dark', 'box', 0, -0.22, 0, 0.12, 0.44, 0.13).add('shin' + s, 'armor', 'box', 0, -0.2, 0.05, 0.13, 0.3, 0.06)
      .add('shin' + s, 'dark', 'box', 0, -0.44, 0.04, 0.14, 0.09, 0.27).add('shin' + s, 'armor', 'box', 0, -0.41, 0.15, 0.14, 0.05, 0.1);
    if (hi) b.add('shin' + s, 'trim', 'box', 0, -0.07, 0.085, 0.09, 0.03, 0.02);
    // arms: undersuit, bicep plate; forearm gauntlet with accent band + glow strip, glove
    b.add('arm' + s, 'dark', 'box', 0, -0.15, 0, 0.1, 0.3, 0.1).add('arm' + s, 'armor', 'box', 0, -0.1, 0, 0.12, 0.15, 0.12);
    b.add('fore' + s, 'armor', 'box', 0, -0.12, 0, 0.125, 0.2, 0.125).add('fore' + s, 'accent', 'box', 0, -0.03, 0, 0.13, 0.03, 0.13)
      .add('fore' + s, 'glow', 'box', 0, -0.13, 0.064, 0.018, 0.11, 0.005).add('fore' + s, 'dark', 'box', 0, -0.27, 0, 0.08, 0.1, 0.09);
  }
  // rifle carried on the right forearm (points forward when the arm is raised)
  b.add('foreR', 'dark', 'box', -0.05, -0.32, 0.07, 0.08, 0.62, 0.11).add('foreR', 'trim', 'box', -0.05, -0.62, 0.1, 0.04, 0.4, 0.04)
    .add('foreR', 'glow', 'box', -0.05, -0.27, 0.128, 0.05, 0.26, 0.02).add('foreR', 'trim', 'cyl', -0.05, -0.84, 0.1, 0.03, 0.14, 0.03);
  // split cloak with accent hem
  for (const s of ['L', 'R']) { const sx = s === 'L' ? -1 : 1;
    b.add('cloak' + s, 'cloth', 'box', sx * 0.02, -0.5, 0, 0.22, 1.0, 0.02);
    if (hi) b.add('cloak' + s, 'accent', 'box', sx * 0.02, -0.995, 0, 0.222, 0.03, 0.024);
  }
  return b.done();
}
export function buildGuardian(classHex, { shadows = false, accent = 0xffd970 } = {}) {
  guardianTpl ||= buildGuardianTpl();
  const T = textures(), hi = DETAIL > 0;
  const armor = new THREE.MeshStandardMaterial({ color: 0xa8a4b8, roughness: 0.36, metalness: 0.55, roughnessMap: T.panel });
  if (hi) { armor.bumpMap = T.panel; armor.bumpScale = 0.8; }
  const mats = {
    armor: dissolvable(armor, classHex),
    dark: dissolvable(new THREE.MeshStandardMaterial({ color: 0x23202b, roughness: 0.62, metalness: 0.3 }), classHex),
    trim: dissolvable(new THREE.MeshStandardMaterial({ color: classHex, roughness: 0.28, metalness: 0.75 }), classHex),
    accent: dissolvable(new THREE.MeshStandardMaterial({ color: accent, roughness: 0.32, metalness: 0.6, emissive: accent, emissiveIntensity: 0.18 }), classHex),
    glow: dissolvable(new THREE.MeshStandardMaterial({ color: 0, emissive: classHex, emissiveIntensity: 3 }), classHex),
    cloth: dissolvable(new THREE.MeshStandardMaterial({ color: new THREE.Color(classHex).multiplyScalar(0.5), roughness: 0.9, side: THREE.DoubleSide }), classHex),
  };
  setRim(mats, rimOf(classHex, 0.34)); mats.glow.userData.dis.uRim.value.setRGB(0, 0, 0);
  const { group, pivots } = guardianTpl.build(mats, { shadows });
  const vis = glowSprite(classHex, 0.5, 0.7); vis.position.set(0, 0.125, 0.16); pivots.head.add(vis);
  return { group, rig: { type: 'guardian', pivots, mats, t: 0, ph: 0, sk: 0, yv: 0, fl: 0, lastYaw: null } };
}
export function setGuardianColor(g, hex) {
  const m = g.rig.mats; m.trim.color.setHex(hex); m.glow.emissive.setHex(hex); m.cloth.color.setHex(hex).multiplyScalar(0.5);
  setRim(m, rimOf(hex, 0.34)); m.glow.userData.dis.uRim.value.setRGB(0, 0, 0);
}
export function setGuardianAccent(g, hex) { const a = g.rig.mats.accent; if (a) { a.color.setHex(hex); a.emissive.setHex(hex); } }
export function guardianHit(g) { g.rig.fl = 1; }
export function animateGuardian(g, dt, move, { pitch = 0, down = false, firing = false } = {}) {
  pitch = Math.max(-0.6, Math.min(0.6, pitch || 0));
  const r = g.rig, P = r.pivots; r.t += dt; const t = r.t;
  r.ph += dt * (6 + move * 5); const s = Math.sin(r.ph), c = Math.cos(r.ph), br = Math.sin(t * 1.9);
  // sprint blend: rifle lowers and the free arm swings when running flat out and not shooting
  r.sk += ((move > 0.85 && !firing ? 1 : 0) - r.sk) * Math.min(1, dt * 6); const sk = r.sk;
  r.fl = Math.max(0, r.fl - dt * 5); const fl = r.fl * r.fl;
  // turning speed drives the cloak (smoothed)
  const yaw = g.group.rotation.y; if (r.lastYaw !== null && dt > 0) { let d = yaw - r.lastYaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; r.yv += (d / dt - r.yv) * Math.min(1, dt * 5); } r.lastYaw = yaw;
  // legs: walk/run cycle
  P.legL.rotation.x = -s * 0.65 * move; P.legR.rotation.x = s * 0.65 * move;
  P.shinL.rotation.x = Math.max(0, s) * 1.05 * move; P.shinR.rotation.x = Math.max(0, -s) * 1.05 * move;
  // hips bob + counter-rotation, idle breathing
  P.hips.position.y = 1.0 + Math.abs(c) * 0.05 * move - move * 0.03 + br * 0.005;
  P.hips.rotation.y = s * 0.1 * move; P.torso.rotation.y = -s * 0.14 * move;
  P.torso.rotation.x = 0.05 * move + 0.1 * sk * move + br * 0.012 - fl * 0.3; P.torso.scale.set(1 + br * 0.008, 1, 1 + br * 0.012);
  // arms: aiming pose blended with sprint swing
  const kick = firing ? Math.sin(t * 50) * 0.04 : 0;
  P.armR.rotation.x = lerp(-1.45 - pitch * 0.8 + kick, -0.55 + s * 0.12, sk); P.armR.rotation.z = lerp(0, 0.08, sk); P.foreR.rotation.x = lerp(-0.05, -0.95, sk);
  P.armL.rotation.x = lerp(-1.25 - pitch * 0.7, s * 0.7 * move, sk); P.armL.rotation.z = lerp(0.55, -0.08, sk); P.foreL.rotation.x = lerp(-0.35, -0.45 - Math.max(0, -s) * 0.4, sk);
  if (!firing && move < 0.05) { P.armL.rotation.x += br * 0.02; P.armR.rotation.x += br * 0.015; }
  P.head.rotation.x = -pitch * 0.5 + br * 0.01 + fl * 0.25; P.head.rotation.y = -P.torso.rotation.y * 0.8;
  // cloak sway: wind idle + stride + lag behind turns
  const turn = Math.max(-0.35, Math.min(0.35, -r.yv * 0.07));
  P.cloakL.rotation.x = 0.1 + move * 0.6 + Math.sin(t * 3.1) * 0.05 + s * 0.07 * move; P.cloakR.rotation.x = 0.1 + move * 0.6 + Math.sin(t * 3.1 + 0.8) * 0.05 - s * 0.07 * move;
  P.cloakL.rotation.z = turn - 0.04; P.cloakR.rotation.z = turn + 0.04;
  g.group.rotation.x = 0; P.hips.rotation.x = down ? -1.3 : 0; if (down) P.hips.position.y = 0.3;
}

// name tag sprite (canvas)
export function nameTag(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  g.font = 'bold 30px -apple-system,Segoe UI,Roboto,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(8,6,20,0.65)'; const w = Math.min(250, g.measureText(text).width + 34); g.fillRect(128 - w / 2, 10, w, 44);
  g.fillStyle = color; g.fillRect(128 - w / 2, 50, w, 4); g.fillStyle = '#fff'; g.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false, fog: false }));
  s.scale.set(1.2, 0.3, 1); s.renderOrder = 10; return s;
}

// ---------- First-person weapon models ----------
export function buildWeaponModel(arch, rarityHex, elementHex, classHex = 0x7fd8ff) {
  const T = textures();
  // PBR viewmodel: panel-lined bump + roughness breakup, clear-coated shell, brushed metal, heat-reactive emissives
  const body = new THREE.MeshStandardMaterial({ color: 0x4a4760, roughness: 0.42, metalness: 0.5, bumpMap: T.panel, bumpScale: 0.6, roughnessMap: T.panel });
  const shell = new THREE.MeshPhysicalMaterial({ color: 0xd8d4e2, roughness: 0.32, metalness: 0.2, clearcoat: 0.7, clearcoatRoughness: 0.18, bumpMap: T.panel, bumpScale: 0.35 });
  const lens = new THREE.MeshStandardMaterial({ color: 0x101018, emissive: elementHex, emissiveIntensity: 0.35, roughness: 0.05, metalness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8b6c6, roughness: 0.24, metalness: 0.95, roughnessMap: T.panel, envMapIntensity: 1.3 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x1c1a22, roughness: 0.85, metalness: 0.1 });
  const acc = new THREE.MeshStandardMaterial({ color: rarityHex, roughness: 0.3, metalness: 0.6, emissive: rarityHex, emissiveIntensity: 0.35 });
  const el = new THREE.MeshStandardMaterial({ color: 0, emissive: elementHex, emissiveIntensity: 3 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x2d2a36, roughness: 0.75, metalness: 0.2 });
  const armor = new THREE.MeshStandardMaterial({ color: 0x8c889c, roughness: 0.4, metalness: 0.6, map: T.panel });
  const g = new THREE.Group();
  const P = (mat, geo, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(G[geo], mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz); g.add(m); return m; };
  const cylZ = (mat, x, y, z, r, len) => P(mat, 'cyl', x, y, z, r, len, r, Math.PI / 2);
  let tip = -0.6, mag = null;
  if (arch === 'auto' || arch === 'pulse' || arch === 'mg') {
    const big = arch === 'mg' ? 1.3 : 1;
    P(body, 'box', 0, 0, -0.02, 0.085 * big, 0.11 * big, 0.46);            // receiver
    P(body, 'box', 0, 0.075 * big, -0.06, 0.06, 0.03, 0.34);                // top rail
    for (let i = 0; i < 6; i++) P(metal, 'box', 0, 0.095 * big, -0.2 + i * 0.05, 0.065, 0.012, 0.02);
    cylZ(metal, 0, 0.015, -0.42, 0.018 * big, 0.38);                         // barrel
    P(body, 'box', 0, 0.0, -0.33, 0.075 * big, 0.08, 0.2);                   // handguard
    for (let i = 0; i < 3; i++) P(el, 'box', 0.039 * big, 0.0, -0.39 + i * 0.05, 0.004, 0.035, 0.022); // vents glow
    cylZ(metal, 0, 0.015, -0.62, 0.028 * big, 0.06);                         // muzzle brake
    P(grip, 'box', 0, -0.1, 0.08, 0.055, 0.15, 0.07, 0.3);                    // grip
    mag = P(metal, 'box', 0, -0.11, -0.1, 0.05, arch === 'mg' ? 0.16 : 0.15, 0.08, -0.15);
    if (arch === 'mg') { P(body, 'box', 0, -0.12, -0.1, 0.2, 0.13, 0.16); P(acc, 'box', 0.1, -0.12, -0.1, 0.01, 0.1, 0.14); }
    P(body, 'box', 0, 0.02, 0.24, 0.06, 0.1, 0.18);                          // stock
    P(shell, 'box', 0, 0.02, -0.02, 0.092 * big, 0.06 * big, 0.3);           // light outer shell
    P(shell, 'box', 0, 0.035, -0.33, 0.08 * big, 0.04, 0.16);
    P(acc, 'box', 0.047 * big, -0.01, -0.05, 0.004, 0.02, 0.32);              // rarity stripe
    // optic
    P(body, 'box', 0, 0.105 * big, 0.0, 0.04, 0.03, 0.11); cylZ(metal, 0, 0.125 * big, 0.0, 0.022, 0.14);
    P(lens, 'box', 0, 0.125 * big, 0.072, 0.03, 0.03, 0.003); P(el, 'box', 0, 0.152 * big, 0.06, 0.006, 0.006, 0.006);
    if (arch === 'pulse') { P(acc, 'box', 0, -0.03, -0.25, 0.09, 0.02, 0.06); P(el, 'box', -0.045, 0.02, -0.15, 0.004, 0.02, 0.18); }
    tip = -0.66;
  } else if (arch === 'hand') {
    P(body, 'box', 0, 0.01, -0.08, 0.075, 0.09, 0.3);                        // frame
    cylZ(metal, 0, 0.03, -0.28, 0.025, 0.14);                                 // barrel
    P(metal, 'box', 0, 0.06, -0.18, 0.03, 0.03, 0.3);                         // top rib
    cylZ(metal, 0, 0.0, -0.03, 0.055, 0.1);                                   // cylinder
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; cylZ(grip, Math.cos(a) * 0.035, Math.sin(a) * 0.035, -0.03, 0.012, 0.105); }
    P(grip, 'box', 0, -0.11, 0.07, 0.055, 0.17, 0.075, 0.3);
    P(metal, 'box', 0, 0.05, 0.05, 0.03, 0.04, 0.03, 0.5);                    // hammer
    P(shell, 'box', 0, 0.04, -0.12, 0.08, 0.035, 0.22); P(acc, 'box', 0.041, 0.01, -0.1, 0.004, 0.02, 0.22);
    P(el, 'box', 0, 0.08, -0.32, 0.01, 0.015, 0.01); P(el, 'box', -0.039, 0.0, -0.12, 0.003, 0.02, 0.12);
    tip = -0.36;
  } else if (arch === 'scout') {
    P(body, 'box', 0, 0, 0, 0.075, 0.1, 0.55); P(shell, 'box', 0, 0.025, -0.05, 0.082, 0.05, 0.38);
    cylZ(metal, 0, 0.02, -0.46, 0.02, 0.36);
    P(body, 'box', 0, 0.0, -0.33, 0.07, 0.075, 0.16);
    cylZ(metal, 0, 0.125, -0.02, 0.035, 0.28); cylZ(body, 0, 0.125, -0.17, 0.045, 0.04); cylZ(body, 0, 0.125, 0.13, 0.042, 0.04);
    P(lens, 'box', 0, 0.125, 0.152, 0.05, 0.05, 0.003); P(body, 'box', 0, 0.085, -0.02, 0.03, 0.04, 0.06);
    P(grip, 'box', 0, -0.1, 0.08, 0.055, 0.15, 0.07, 0.3); mag = P(metal, 'box', 0, -0.1, -0.12, 0.05, 0.12, 0.07);
    P(body, 'box', 0, 0.0, 0.28, 0.055, 0.11, 0.14); P(acc, 'box', 0.04, 0.0, -0.05, 0.004, 0.03, 0.4);
    P(el, 'box', -0.039, 0.0, -0.33, 0.003, 0.03, 0.12);
    tip = -0.66;
  } else if (arch === 'rocket') {
    cylZ(shell, 0, 0.04, -0.15, 0.085, 0.82); cylZ(metal, 0, 0.04, -0.57, 0.095, 0.06); cylZ(metal, 0, 0.04, 0.27, 0.095, 0.06);
    cylZ(el, 0, 0.04, -0.6, 0.07, 0.01);
    for (let i = 0; i < 4; i++) cylZ(acc, 0, 0.04, -0.42 + i * 0.18, 0.089, 0.012);
    P(grip, 'box', 0, -0.09, 0.0, 0.055, 0.15, 0.07, 0.25); P(grip, 'box', 0, -0.08, -0.28, 0.05, 0.13, 0.06, 0.2);
    P(body, 'box', 0.105, 0.09, -0.05, 0.05, 0.08, 0.14); P(lens, 'box', 0.105, 0.09, 0.022, 0.035, 0.05, 0.003);
    tip = -0.6;
  }
  // first-person arms: layered gauntlets (sleeve, panel-lined plate, class accent band + glow strip, knuckle guard, fingers)
  const cls = new THREE.MeshStandardMaterial({ color: classHex, roughness: 0.3, metalness: 0.7 });
  const clsGlow = new THREE.MeshStandardMaterial({ color: 0, emissive: classHex, emissiveIntensity: 2.2 });
  const plate = new THREE.MeshStandardMaterial({ color: 0xa4a0b4, roughness: 0.36, metalness: 0.6, bumpMap: T.panel, bumpScale: 0.7, roughnessMap: T.panel });
  const hand = (x, y, z, rx, ry, side) => { const h = new THREE.Group(); h.position.set(x, y, z); h.rotation.set(rx, ry, 0);
    const add = (mat, sx, sy, sz, px, py, pz, rrx = 0) => { const m = new THREE.Mesh(G.box, mat); m.scale.set(sx, sy, sz); m.position.set(px, py, pz); m.rotation.x = rrx; h.add(m); return m; };
    add(glove, 0.08, 0.08, 0.4, 0, -0.005, 0.24);                    // sleeve
    add(plate, 0.092, 0.06, 0.26, 0, 0.022, 0.2);                    // forearm plate
    add(armor, 0.094, 0.04, 0.08, 0, 0.03, 0.36, -0.12);             // elbow-side plate
    add(cls, 0.096, 0.064, 0.02, 0, 0.012, 0.085);                   // class band
    add(clsGlow, 0.006, 0.012, 0.15, side * 0.047, 0.03, 0.2);       // glow strip
    add(glove, 0.072, 0.088, 0.1, 0, 0, 0);                          // glove
    add(armor, 0.076, 0.03, 0.06, 0, 0.04, -0.01);                   // knuckle guard
    for (let i = 0; i < 4; i++) add(glove, 0.016, 0.022, 0.05, -0.027 + i * 0.018, -0.02, -0.06, 0.6);
    add(acc, 0.09, 0.09, 0.016, 0, 0, 0.048);                        // rarity cuff
    g.add(h); return h; };
  hand(0.01, -0.12, 0.1, 0.35, 0, 1);
  if (arch !== 'hand') hand(-0.02, -0.07, arch === 'rocket' ? -0.28 : -0.3, 0.2, 0.5, -1);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, arch === 'rocket' ? 0.04 : 0.02, tip); g.add(muzzle);
  // muzzle flash: two crossed additive quads + glow sprite
  const fm = new THREE.MeshBasicMaterial({ color: 0xffd2a0, map: flashTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0 });
  const flash = new THREE.Group(); for (let i = 0; i < 2; i++) { const q = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.5), fm); q.rotation.set(Math.PI / 2, 0, i * Math.PI / 2); q.position.z = -0.2; flash.add(q); }
  const fq = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), fm); flash.add(fq); flash.position.copy(muzzle.position); g.add(flash);
  return { group: g, muzzle, flash, flashMat: fm, mag, elMat: el, metalMat: metal };
}
let _flash = null;
function flashTex() {
  if (_flash) return _flash;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, '#fff'); gr.addColorStop(0.3, 'rgba(255,220,150,.8)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = gr; g.beginPath(); for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, r = i % 2 ? 12 : 32; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); } g.fill();
  _flash = new THREE.CanvasTexture(c); _flash.colorSpace = THREE.SRGBColorSpace; return _flash;
}

// ---------- Engram (loot) with rarity beam ----------
const beamMatCache = {};
function beamMat(hex) {
  return beamMatCache[hex] ||= new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uColor: { value: new THREE.Color(hex).multiplyScalar(2.2) }, uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 uColor; uniform float uTime; varying vec2 vUv; void main(){ float a = pow(1.0 - vUv.y, 1.6) * (0.6 + 0.4 * sin(vUv.y * 30.0 - uTime * 6.0)) ; float e = 1.0 - abs(vUv.x - 0.5) * 2.0; gl_FragColor = vec4(uColor * a * e, a * e); }',
  });
}
export function tickBeams(t) { for (const k in beamMatCache) beamMatCache[k].uniforms.uTime.value = t; }
export function buildEngram(rarity, hex) {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 1.2 + rarity * 0.5, roughness: 0.2, metalness: 0.7, flatShading: true, transparent: true, opacity: 0.85 }));
  shell.scale.y = 1.25;
  const inner = new THREE.Mesh(G.oct, new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(3) })); inner.scale.set(0.13, 0.2, 0.13);
  const cage = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(1.6), wireframe: true, transparent: true, opacity: 0.5 })); cage.scale.y = 1.25;
  g.add(shell, inner, cage, glowSprite(hex, 1.4 + rarity * 0.4, 0.75));
  // vertical light beam (two crossed quads); taller for rarer drops
  const h = [5, 9, 14, 22][rarity] || 6;
  const bm = beamMat(hex), beam = new THREE.Group();
  for (let i = 0; i < 2; i++) { const q = new THREE.Mesh(new THREE.PlaneGeometry(0.35 + rarity * 0.08, h), bm); q.position.y = h / 2 - 0.6; q.rotation.y = i * Math.PI / 2; beam.add(q); }
  g.add(beam);
  const ringM = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.55, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(2), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  ringM.rotation.x = -Math.PI / 2; ringM.position.y = -0.95; g.add(ringM);
  return { group: g, spin: [shell, cage], ring: ringM, beam };
}
