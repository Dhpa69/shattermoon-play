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
for (const k in G) { const g = G[k]; if (!g.index) G[k] = g; }
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

// ---------- materials ----------
export function enemyMats(armorHex, eyeHex, edge = 0xffa040, glowI = 2.6) {
  const T = textures();
  const armor = dissolvable(new THREE.MeshStandardMaterial({ color: armorHex, roughness: 0.4, metalness: 0.5 }), edge);
  const dark = dissolvable(new THREE.MeshStandardMaterial({ color: 0x2a2432, roughness: 0.65, metalness: 0.3 }), edge);
  const trim = dissolvable(new THREE.MeshStandardMaterial({ color: 0xc8c0d4, roughness: 0.28, metalness: 0.85 }), edge);
  const glow = dissolvable(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: eyeHex, emissiveIntensity: glowI, roughness: 1 }), edge);
  const cloth = dissolvable(new THREE.MeshStandardMaterial({ color: new THREE.Color(armorHex).multiplyScalar(0.45), roughness: 0.95, metalness: 0, side: THREE.DoubleSide }), edge);
  return { armor, dark, trim, glow, cloth };
}

// ---------- enemy templates ----------
const TPL = {};
function skitterTpl() {
  const b = new Builder();
  b.pivot('body', 'root', 0, 0.62, 0).pivot('head', 'body', 0, 0.22, 0.5).pivot('sac', 'body', 0, 0.2, -0.45);
  // segmented abdomen + thorax
  b.add('body', 'armor', 'sph', 0, 0, 0, 0.42, 0.3, 0.55).add('body', 'dark', 'sph', 0, -0.06, 0.05, 0.36, 0.24, 0.5);
  for (let i = 0; i < 4; i++) b.add('body', 'armor', 'box', 0, 0.2 - i * 0.02, 0.28 - i * 0.2, 0.5 - i * 0.04, 0.06, 0.16, -0.25 + i * 0.12); // dorsal plates
  for (let i = 0; i < 3; i++) b.add('body', 'trim', 'cone4', 0, 0.3, 0.2 - i * 0.22, 0.05, 0.22, 0.05, -0.4); // spines
  b.add('sac', 'armor', 'sph', 0, 0, 0, 0.32, 0.28, 0.38).add('sac', 'glow', 'sph', 0, 0.06, -0.08, 0.2, 0.17, 0.24);
  b.add('head', 'armor', 'sph', 0, 0, 0, 0.26, 0.2, 0.28).add('head', 'dark', 'box', 0, -0.1, 0.12, 0.3, 0.08, 0.2);
  for (const [x, y, s] of [[-0.1, 0.06, 0.055], [0.1, 0.06, 0.055], [-0.17, 0.0, 0.04], [0.17, 0.0, 0.04], [-0.06, 0.12, 0.035], [0.06, 0.12, 0.035]]) b.add('head', 'glow', 'sphLo', x, y, 0.24, s, s, s);
  b.add('head', 'trim', 'cone4', -0.1, -0.14, 0.3, 0.035, 0.22, 0.035, 1.9, 0, 0.35).add('head', 'trim', 'cone4', 0.1, -0.14, 0.3, 0.035, 0.22, 0.035, 1.9, 0, -0.35); // mandibles
  const legs = [];
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1, row = Math.floor(i / 2), z = 0.3 - row * 0.3, n = 'leg' + i, k = 'knee' + i;
    b.pivot(n, 'body', side * 0.32, -0.02, z).pivot(k, n, side * 0.36, 0.22, 0);
    b.add(n, 'dark', 'cyl6', side * 0.18, 0.11, 0, 0.045, 0.44, 0.045, 0, 0, side * -1.05);
    b.add(n, 'armor', 'sphLo', side * 0.36, 0.22, 0, 0.07, 0.07, 0.07);
    b.add(k, 'dark', 'cyl6', side * 0.08, -0.38, 0, 0.035, 0.8, 0.035, 0, 0, side * 0.2);
    b.add(k, 'trim', 'cone4', side * 0.16, -0.8, 0, 0.035, 0.12, 0.035, Math.PI);
    legs.push(n);
  }
  return { tpl: b.done(), legs };
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
  return { tpl: b.done() };
}

// palette per type (armor, eye/emissive)
export const ENEMY_LOOK = {
  skitter: { armor: 0x8a5a48, eye: 0xff5a2a, edge: 0xff6a2a },
  lancer: { armor: 0x8a9c72, eye: 0xffa020, edge: 0xffb040 },
  bulwark: { armor: 0x9a64a8, eye: 0xff3a9a, edge: 0xff50b0 },
  regent: { armor: 0x6a5a88, eye: 0xffc84a, edge: 0xffd060 },
};
export function buildEnemyModel(type, { shadows = false } = {}) {
  if (!TPL[type]) TPL[type] = type === 'skitter' ? skitterTpl() : type === 'lancer' ? lancerTpl() : type === 'bulwark' ? bulwarkTpl() : regentTpl();
  const L = ENEMY_LOOK[type], mats = enemyMats(L.armor, L.eye, L.edge, type === 'regent' ? 1.7 : 2.6);
  const { group, pivots, meshes } = TPL[type].tpl.build(mats, { shadows });
  const rig = { type, pivots, mats, legs: TPL[type].legs || null, t: Math.random() * 10 };
  // light glows (sprites) for bloom focus
  if (type === 'skitter') { const g = glowSprite(L.eye, 0.8, 0.55); g.position.set(0, 0.25, 0.75); pivots.head.add(g); const s = glowSprite(0xff7a30, 0.9, 0.4); pivots.sac.add(s); }
  if (type === 'lancer') { const g = glowSprite(L.eye, 0.6, 0.6); g.position.set(0, 0.12, 0.22); pivots.head.add(g); }
  if (type === 'bulwark') { const g = glowSprite(L.eye, 1, 0.6); g.position.set(0, 0.12, 0.3); pivots.head.add(g); const c = glowSprite(L.eye, 1.2, 0.4); c.position.set(0, 0.7, 0.6); pivots.torso.add(c); }
  if (type === 'regent') {
    const h = glowSprite(L.eye, 7, 0.12); pivots.halo.add(h);
    const c = glowSprite(L.eye, 3.2, 0.7); pivots.core.add(c); rig.coreGlow = c;
    const e = glowSprite(L.eye, 2.2, 0.5); e.position.set(0, 0.12, 0.6); pivots.head.add(e);
    // orbiting shards
    rig.shards = [];
    for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(G.oct, mats.glow); m.scale.set(0.16, 0.5, 0.16); group.add(m); rig.shards.push(m); }
  }
  return { group, rig, meshes };
}

// per-frame procedural animation; `move` 0..1, `state` string from AI
export function animateEnemy(rig, dt, move, state, extra = {}) {
  rig.t += dt; const t = rig.t, P = rig.pivots;
  if (rig.type === 'skitter') {
    const sp = 18, a = Math.sin(t * sp) * 0.5 * move;
    rig.legs.forEach((n, i) => { const ph = (i % 2) ^ (Math.floor(i / 2) % 2) ? 1 : -1; P[n].rotation.y = a * ph * 0.7; P[n].rotation.z = (i % 2 ? -1 : 1) * Math.max(0, Math.sin(t * sp + (ph > 0 ? 0 : Math.PI))) * 0.35 * move; });
    P.body.position.y = 0.62 + Math.abs(Math.sin(t * sp)) * 0.04 * move + Math.sin(t * 2) * 0.015;
    P.body.rotation.x = state === 'tele' ? -0.5 : -0.08 + Math.sin(t * 3) * 0.03;
    P.head.rotation.x = state === 'tele' ? 0.5 : Math.sin(t * 5) * 0.08; P.head.rotation.y = Math.sin(t * 1.7) * 0.15;
    const pul = 1 + Math.sin(t * 6) * 0.08; P.sac.scale.set(pul, pul, pul);
  } else if (rig.type === 'lancer' || rig.type === 'bulwark') {
    const big = rig.type === 'bulwark', sp = big ? 5.5 : 8, sw = Math.sin(t * sp) * (big ? 0.4 : 0.6) * move;
    P.legL.rotation.x = sw; P.legR.rotation.x = -sw;
    if (P.shinL) { P.shinL.rotation.x = Math.max(0, -sw) * 0.9; P.shinR.rotation.x = Math.max(0, sw) * 0.9; }
    P.hips.position.y = (big ? 1.0 : 0.95) + Math.abs(Math.cos(t * sp)) * (big ? 0.06 : 0.05) * move + Math.sin(t * 1.6) * 0.015;
    P.torso.rotation.y = Math.sin(t * sp) * 0.08 * move; P.torso.rotation.x = 0.05 + Math.sin(t * 1.6) * 0.02;
    const aim = state === 'tele' || state === 'fire';
    P.armL.rotation.x = aim ? -1.2 : -sw * 0.6 + Math.sin(t * 1.3) * 0.05;
    P.armR.rotation.x = aim ? -1.45 + (state === 'fire' ? Math.sin(t * 40) * 0.05 : 0) : -0.9 + Math.sin(t * 1.3) * 0.05;
    if (big) { P.armL.rotation.x = state === 'shove' ? -1.4 : -0.5 - sw * 0.3; if (P.vents) P.vents.scale.y = 1 + Math.sin(t * 4) * 0.06; }
    P.head.rotation.y = Math.sin(t * 0.9) * 0.2; P.head.rotation.x = Math.sin(t * 1.4) * 0.05;
    if (P.cape) P.cape.rotation.x = 0.15 + move * 0.35 + Math.sin(t * 3.1) * 0.08;
  } else if (rig.type === 'regent') {
    const ph2 = extra.phase === 2;
    P.torso.position.y = 2.6 + Math.sin(t * 1.5) * 0.18; P.torso.rotation.y = Math.sin(t * 0.7) * 0.1;
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
export function setEnemyFlash(rig, v) { for (const k in rig.mats) rig.mats[k].userData.dis.uFlash.value = v; }
export function setEnemyDissolve(rig, v) { for (const k in rig.mats) rig.mats[k].userData.dis.uDis.value = v; }
export function setEnemyGlowColor(rig, hex) { rig.mats.glow.emissive.setHex(hex); }
export function disposeEnemy(rig) { for (const k in rig.mats) rig.mats[k].dispose(); }

// ---------- Guardian (player avatar: co-op partner + title backdrop) ----------
let guardianTpl = null;
function buildGuardianTpl() {
  const b = new Builder();
  b.pivot('hips', 'root', 0, 0.98, 0).pivot('torso', 'hips', 0, 0.08, 0).pivot('head', 'torso', 0, 0.72, 0.02)
    .pivot('legL', 'hips', -0.13, 0, 0).pivot('legR', 'hips', 0.13, 0, 0).pivot('shinL', 'legL', 0, -0.46, 0).pivot('shinR', 'legR', 0, -0.46, 0)
    .pivot('armL', 'torso', -0.3, 0.56, 0).pivot('armR', 'torso', 0.3, 0.56, 0).pivot('cloak', 'torso', 0, 0.62, -0.16);
  b.add('hips', 'dark', 'box', 0, 0, 0, 0.36, 0.18, 0.22).add('hips', 'cloth', 'box', 0, -0.24, 0.12, 0.26, 0.36, 0.02).add('hips', 'trim', 'box', 0, 0.02, 0.12, 0.12, 0.08, 0.02);
  b.add('torso', 'armor', 'box', 0, 0.32, 0, 0.46, 0.46, 0.26).add('torso', 'armor', 'box', 0, 0.55, 0.02, 0.5, 0.16, 0.3)
    .add('torso', 'trim', 'box', 0, 0.36, 0.14, 0.26, 0.24, 0.03).add('torso', 'glow', 'box', 0, 0.4, 0.157, 0.06, 0.1, 0.01).add('torso', 'dark', 'box', 0, 0.06, 0, 0.38, 0.16, 0.22);
  b.add('torso', 'armor', 'sph', -0.3, 0.56, 0, 0.14, 0.1, 0.16).add('torso', 'armor', 'sph', 0.3, 0.56, 0, 0.14, 0.1, 0.16);
  b.add('head', 'armor', 'sph', 0, 0.12, 0, 0.16, 0.18, 0.17).add('head', 'dark', 'box', 0, 0.11, 0.1, 0.24, 0.1, 0.1).add('head', 'glow', 'box', 0, 0.12, 0.155, 0.2, 0.045, 0.01)
    .add('head', 'trim', 'box', 0, 0.28, 0, 0.04, 0.06, 0.3);
  for (const s of ['L', 'R']) {
    b.add('leg' + s, 'dark', 'box', 0, -0.22, 0, 0.15, 0.46, 0.17).add('leg' + s, 'armor', 'box', 0, -0.2, 0.05, 0.16, 0.24, 0.1);
    b.add('shin' + s, 'dark', 'box', 0, -0.22, 0, 0.12, 0.44, 0.13).add('shin' + s, 'armor', 'box', 0, -0.18, 0.05, 0.14, 0.26, 0.06).add('shin' + s, 'dark', 'box', 0, -0.45, 0.05, 0.14, 0.08, 0.26);
    b.add('arm' + s, 'dark', 'box', 0, -0.22, 0, 0.11, 0.42, 0.11).add('arm' + s, 'armor', 'box', 0, -0.36, 0, 0.13, 0.18, 0.13);
  }
  b.add('armR', 'dark', 'box', -0.04, -0.56, 0.06, 0.07, 0.62, 0.11).add('armR', 'trim', 'box', -0.04, -0.82, 0.1, 0.035, 0.4, 0.035).add('armR', 'glow', 'box', -0.04, -0.5, 0.118, 0.02, 0.2, 0.02)
    .add('armR', 'dark', 'box', -0.04, -0.4, 0.0, 0.05, 0.12, 0.1);
  b.add('cloak', 'cloth', 'box', 0, -0.5, 0, 0.42, 1.0, 0.02);
  return b.done();
}
export function buildGuardian(classHex, { shadows = false } = {}) {
  guardianTpl ||= buildGuardianTpl();
  const T = textures();
  const mats = {
    armor: new THREE.MeshStandardMaterial({ color: 0x9a96aa, roughness: 0.38, metalness: 0.55 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x24202c, roughness: 0.6, metalness: 0.3 }),
    trim: new THREE.MeshStandardMaterial({ color: classHex, roughness: 0.3, metalness: 0.7 }),
    glow: new THREE.MeshStandardMaterial({ color: 0, emissive: classHex, emissiveIntensity: 3 }),
    cloth: new THREE.MeshStandardMaterial({ color: new THREE.Color(classHex).multiplyScalar(0.55), roughness: 0.9, side: THREE.DoubleSide }),
  };
  const { group, pivots } = guardianTpl.build(mats, { shadows });
  const vis = glowSprite(classHex, 0.5, 0.7); vis.position.set(0, 0.12, 0.2); pivots.head.add(vis);
  return { group, rig: { type: 'guardian', pivots, mats, t: 0 } };
}
export function setGuardianColor(g, hex) { g.rig.mats.trim.color.setHex(hex); g.rig.mats.glow.emissive.setHex(hex); g.rig.mats.cloth.color.setHex(hex).multiplyScalar(0.55); }
export function animateGuardian(g, dt, move, { pitch = 0, down = false, firing = false } = {}) {
  pitch = Math.max(-0.6, Math.min(0.6, pitch || 0));
  const r = g.rig, P = r.pivots; r.t += dt; const t = r.t, sw = Math.sin(t * 9) * 0.6 * move;
  P.legL.rotation.x = sw; P.legR.rotation.x = -sw; P.shinL.rotation.x = Math.max(0, -sw); P.shinR.rotation.x = Math.max(0, sw);
  P.hips.position.y = 0.98 + Math.abs(Math.cos(t * 9)) * 0.04 * move + Math.sin(t * 1.8) * 0.01;
  P.armR.rotation.x = -1.45 - pitch * 0.8 + (firing ? Math.sin(t * 50) * 0.04 : 0); P.armL.rotation.x = -1.2 - pitch * 0.7; P.armL.rotation.z = 0.5;
  P.head.rotation.x = -pitch * 0.5; P.cloak.rotation.x = 0.15 + move * 0.4 + Math.sin(t * 3) * 0.06;
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
export function buildWeaponModel(arch, rarityHex, elementHex) {
  const T = textures();
  const body = new THREE.MeshStandardMaterial({ color: 0x4a4760, roughness: 0.4, metalness: 0.45 });
  const shell = new THREE.MeshStandardMaterial({ color: 0xd4d0dc, roughness: 0.35, metalness: 0.25 });
  const lens = new THREE.MeshStandardMaterial({ color: 0x101018, emissive: elementHex, emissiveIntensity: 0.35, roughness: 0.05, metalness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8b6c6, roughness: 0.22, metalness: 0.95 });
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
  // first-person arms (gloved hands + armored forearms)
  const hand = (x, y, z, rx, ry) => { const h = new THREE.Group(); h.position.set(x, y, z); h.rotation.set(rx, ry, 0);
    const a = new THREE.Mesh(G.box, armor); a.scale.set(0.085, 0.085, 0.36); a.position.z = 0.2; h.add(a);
    const gl = new THREE.Mesh(G.box, glove); gl.scale.set(0.07, 0.09, 0.1); h.add(gl);
    const cuff = new THREE.Mesh(G.box, acc); cuff.scale.set(0.09, 0.09, 0.02); cuff.position.z = 0.04; h.add(cuff); g.add(h); return h; };
  hand(0.01, -0.12, 0.1, 0.35, 0);
  if (arch !== 'hand') hand(-0.02, -0.07, arch === 'rocket' ? -0.28 : -0.3, 0.2, 0.5);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, arch === 'rocket' ? 0.04 : 0.02, tip); g.add(muzzle);
  // muzzle flash: two crossed additive quads + glow sprite
  const fm = new THREE.MeshBasicMaterial({ color: 0xffffff, map: flashTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0 });
  const flash = new THREE.Group(); for (let i = 0; i < 2; i++) { const q = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.5), fm); q.rotation.set(Math.PI / 2, 0, i * Math.PI / 2); q.position.z = -0.2; flash.add(q); }
  const fq = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), fm); flash.add(fq); flash.position.copy(muzzle.position); g.add(flash);
  return { group: g, muzzle, flash, flashMat: fm, mag };
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
