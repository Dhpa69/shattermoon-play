// Shattermoon Vanguard — original sci-fi looter-shooter. (c) Dhaval Patel. All assets procedural.
import * as THREE from './vendor/three.module.min.js';
import { buildWorld, glowSprite, glowTexture, ARENA_R } from './world.js';
import { QUALITY, Q_ORDER, createPost } from './gfx.js';
import * as M from './models.js';
import * as L from './loot.js';
import { sfx, initAudio, setMuted, isMuted } from './audio.js';

const $ = id => document.getElementById(id);
const V3 = THREE.Vector3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const GOD = params.has('god');
const START_WAVE = Math.max(1, parseInt(params.get('wave') || '1', 10));
// iPadOS Safari reports itself as a Mac ("desktop-class browsing"), so detect touch via maxTouchPoints too
const IS_IPAD = /iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const IS_TOUCH = params.has('touch') || IS_IPAD || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const BOSS_WAVE = DEBUG ? 3 : 6;
const MAX_ALIVE = IS_TOUCH ? 11 : 15;

// ---------------- Renderer ----------------
const canvas = $('c');
// quality: saved choice, else auto (touch devices start on 'medium', desktop on 'high'); ?q=low|medium|high overrides
let QNAME = (() => { const p = params.get('q'); if (QUALITY[p]) return p; try { const sv = JSON.parse(localStorage.getItem('shattermoon_vanguard_v1') || '{}'); if (QUALITY[sv.quality]) return sv.quality; } catch {} return IS_TOUCH ? 'medium' : 'high'; })();
let Qs = QUALITY[QNAME];
let post = null;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_TOUCH && !Qs.post, powerPreference: 'high-performance', stencil: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// DPR cap: per-tier ratio cap plus a total pixel budget so big Retina screens (iPad Pro 13" = 2732x2048) stay at 60fps
const PX_BUDGET = { low: 1.1e6, medium: 2.0e6, high: 2.8e6 };
const prCap = () => Math.max(0.75, Math.min(window.devicePixelRatio || 1, Qs.pr, Math.sqrt(PX_BUDGET[QNAME] / Math.max(1, innerWidth * innerHeight))));
let pixelRatio = prCap();
renderer.setPixelRatio(pixelRatio);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, 1, 0.05, 900);
camera.rotation.order = 'YXZ';
scene.add(camera);
const world = buildWorld(scene, renderer, Qs);
const colliders = world.colliders;
// one reusable muzzle-flash light + one explosion light (fixed light count = no shader recompiles)
const flashLight = new THREE.PointLight(0xffc080, 0, 9, 2); scene.add(flashLight);
const boomLight = new THREE.PointLight(0xff9040, 0, 22, 2); scene.add(boomLight);
let boomT = 0;
function applyQuality() {
  Qs = QUALITY[QNAME];
  world.sun.castShadow = Qs.shadows;
  if (Qs.shadows) { world.sun.shadow.mapSize.set(Qs.shadowRes, Qs.shadowRes); if (world.sun.shadow.map) { world.sun.shadow.map.dispose(); world.sun.shadow.map = null; } }
  pixelRatio = prCap(); renderer.setPixelRatio(pixelRatio); resize();
  document.body.classList.toggle('lowq', !Qs.post);
}
let UI = 1, lastPrArea = 0;
// UI scale for big touch screens: phones stay 1.0, iPad 11" ~1.27, iPad 13" ~1.4
function uiScale() {
  const m = Math.min(innerWidth, innerHeight), s = IS_TOUCH ? Math.max(1, Math.min(1.45, 1 + (m - 430) / 1500)) : 1;
  document.documentElement.style.setProperty('--ui', s.toFixed(3)); document.documentElement.style.setProperty('--uim', (1 + (s - 1) * 0.75).toFixed(3));
  document.body.classList.toggle('tablet', s > 1.05); return s;
}

function resize() {
  UI = uiScale();
  const area = innerWidth * innerHeight; if (area !== lastPrArea) { lastPrArea = area; const cap = prCap(); if (pixelRatio > cap || pixelRatio < cap - 0.3) { pixelRatio = cap; renderer.setPixelRatio(pixelRatio); } }
  renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  if (typeof post !== 'undefined' && post) { post.composer.setPixelRatio(pixelRatio); post.composer.setSize(innerWidth, innerHeight); }
}
addEventListener('resize', resize);
if (IS_TOUCH) document.body.classList.add('touchmode'); if (IS_IPAD) document.body.classList.add('ipad');

// ---------------- Save ----------------
const SAVE_KEY = 'shattermoon_vanguard_v1';
function defaultSave() { const inv = L.starterLoadout('flare'); return { cls: 'flare', inv, equipped: inv.map(w => w.id), best: { wave: 0, kills: 0, wins: 0 }, sens: 1, muted: false }; }
let save;
try { save = JSON.parse(localStorage.getItem(SAVE_KEY)) || defaultSave(); } catch { save = defaultSave(); }
if (!save.inv || !save.equipped || save.inv.length < 3) save = defaultSave();
function persist() { try { save.quality = QNAME; localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {} }
setMuted(!!save.muted);
const getW = id => save.inv.find(w => w.id === id);
const equipped = () => save.equipped.map(getW);
const powerLevel = () => Math.floor(equipped().reduce((s, w) => s + w.power, 0) / 3);

// ---------------- Classes ----------------
const CLASSES = {
  flare: { name: 'FLARE', el: 'flare', color: '#ff7a2a', hex: 0xff7a2a, desc: 'Burn everything.',
    gren: 'Ember Burst — fiery explosion that sets enemies ablaze.', melee: 'Searing Palm — burning strike.', sup: 'SUNFORGE — 12s of hurling explosive flaming hammers.' },
  storm: { name: 'STORM', el: 'storm', color: '#59d0ff', hex: 0x59d0ff, desc: 'Speed and lightning.',
    gren: 'Arc Pulse — sticks and pulses lightning 3 times.', melee: 'Static Jab — chains lightning to nearby foes.', sup: 'TEMPEST — 9s of chain-lightning from your hands, faster movement.' },
  abyss: { name: 'ABYSS', el: 'abyss', color: '#b066ff', hex: 0xb066ff, desc: 'Bend the void.',
    gren: 'Abyss Vortex — a black hole that pulls and grinds enemies.', melee: 'Null Strike — grants a void overshield.', sup: 'SINGULARITY — launch a massive orb that erases everything nearby.' },
};

// ---------------- Input ----------------
const keys = {};
const input = { fire: false, ads: false, jumpHeld: false, jumpPressed: false, moveX: 0, moveY: 0, sprint: false, lookDX: 0, lookDY: 0 };
let pointerLocked = false;
addEventListener('keydown', e => {
  if (e.code === 'Tab') e.preventDefault();
  if (keys[e.code]) return; keys[e.code] = true;
  if (S.mode === 'play') {
    if (e.code === 'Space') { input.jumpPressed = true; input.jumpHeld = true; }
    if (e.code === 'KeyR') reload();
    if (e.code === 'Digit1') swapTo(0); if (e.code === 'Digit2') swapTo(1); if (e.code === 'Digit3') swapTo(2);
    if (e.code === 'KeyQ' || e.code === 'KeyG') throwGrenade();
    if (e.code === 'KeyC' || e.code === 'KeyV') doMelee();
    if (e.code === 'KeyF') castSuper();
    if (e.code === 'Tab' || e.code === 'KeyI') openInventory();
    if (e.code === 'Escape' || e.code === 'KeyP') pauseGame();
  } else if (e.code === 'Escape' || e.code === 'Tab') {
    if (S.mode === 'pause' && e.code === 'Escape') resumeGame();
    else if (!$('inv').classList.contains('hidden')) closeInventory();
  }
});
addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'Space') input.jumpHeld = false; });
canvas.addEventListener('mousedown', e => {
  initAudio();
  if (S.mode !== 'play' || IS_TOUCH) return;
  if (!pointerLocked && canvas.requestPointerLock) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch {} }
  if (e.button === 0) input.fire = true; if (e.button === 2) input.ads = true;
});
addEventListener('mouseup', e => { if (e.button === 0) input.fire = false; if (e.button === 2) input.ads = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => { if (pointerLocked && S.mode === 'play') { input.lookDX += e.movementX * 0.0022; input.lookDY += e.movementY * 0.0022; } });
addEventListener('wheel', e => { if (S.mode === 'play') swapTo((P.slot + (e.deltaY > 0 ? 1 : 2)) % 3); }, { passive: true });
document.addEventListener('pointerlockchange', () => { pointerLocked = document.pointerLockElement === canvas; if (!pointerLocked && S.mode === 'play' && !IS_TOUCH && S.hadLock) pauseGame(); if (pointerLocked) S.hadLock = true; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; input.fire = false; });

// touch controls
const touch = { stickId: null, stickOrigin: { x: 0, y: 0 }, lookIds: new Map() };
function setupTouch() {
  const base = $('stickBase'), knob = $('stickKnob');
  const btn = (id, down, up) => {
    const el = $(id);
    el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); initAudio(); el.classList.add('down'); for (const t of e.changedTouches) touch.lookIds.set(t.identifier, { x: t.clientX, y: t.clientY, btn: id }); down && down(); }, { passive: false });
    const end = e => { e.preventDefault(); el.classList.remove('down'); for (const t of e.changedTouches) touch.lookIds.delete(t.identifier); up && up(); };
    el.addEventListener('touchend', end, { passive: false }); el.addEventListener('touchcancel', end, { passive: false });
  };
  btn('bFire', () => input.fire = true, () => input.fire = false);
  btn('bJump', () => { input.jumpPressed = true; input.jumpHeld = true; }, () => input.jumpHeld = false);
  btn('bReload', reload); btn('bGren', throwGrenade); btn('bMelee', doMelee); btn('bSuper', castSuper);
  btn('bAds', () => input.ads = !input.ads); btn('bSwap', () => swapTo((P.slot + 1) % 3));
  const surface = document.body;
  surface.addEventListener('touchstart', e => {
    if (S.mode !== 'play') return;
    for (const t of e.changedTouches) {
      if (t.target.closest && t.target.closest('button,.wslot')) continue;
      if (t.clientX < innerWidth * 0.42 && touch.stickId === null) {
        touch.stickId = t.identifier; touch.stickOrigin = { x: t.clientX, y: t.clientY };
        base.style.left = (t.clientX - 60) + 'px'; base.style.top = (t.clientY - 60) + 'px'; // scaled around its centre via CSS base.style.bottom = 'auto'; base.classList.add('on');
      } else touch.lookIds.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
  }, { passive: true });
  surface.addEventListener('touchmove', e => {
    if (S.mode === 'play') e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === touch.stickId) {
        let dx = t.clientX - touch.stickOrigin.x, dy = t.clientY - touch.stickOrigin.y; const d = Math.hypot(dx, dy), m = 55 * UI;
        if (d > m) { dx *= m / d; dy *= m / d; }
        knob.style.transform = `translate(${dx / UI}px,${dy / UI}px)`;
        input.moveX = dx / m; input.moveY = -dy / m; input.sprint = d > m * 0.95 && dy < -m * 0.6;
      } else if (touch.lookIds.has(t.identifier)) {
        const p = touch.lookIds.get(t.identifier);
        input.lookDX += (t.clientX - p.x) * 0.0052; input.lookDY += (t.clientY - p.y) * 0.0052;
        p.x = t.clientX; p.y = t.clientY;
      }
    }
  }, { passive: false });
  const endT = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === touch.stickId) { touch.stickId = null; input.moveX = input.moveY = 0; input.sprint = false; knob.style.transform = ''; base.classList.remove('on'); base.style.left = ''; base.style.top = ''; base.style.bottom = ''; }
      const p = touch.lookIds.get(t.identifier); if (p && !p.btn) touch.lookIds.delete(t.identifier);
    }
  };
  surface.addEventListener('touchend', endT); surface.addEventListener('touchcancel', endT);
  $('tPause').addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); pauseGame(); }, { passive: false });
  $('tInv').addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); openInventory(); }, { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault());
}

// ---------------- Game state ----------------
const S = { mode: 'title', t: 0, wave: 0, kills: 0, crits: 0, shots: 0, hits: 0, engrams: 0, runStart: 0, revives: 3, waveQueue: [], spawnT: 0, betweenT: 0, waveTotal: 1, waveDone: 0, boss: null, victory: false, hadLock: false, deathT: 0, slowmo: 0 };
const P = {
  pos: new V3(0, 1.4, 0), vel: new V3(), yaw: 0, pitch: 0, onGround: true, jumps: 0, gliding: false,
  hp: 100, shield: 100, over: 0, lastHit: -99, dead: false, slot: 0, ammo: [0, 0, 0], reserve: [Infinity, Infinity, 0],
  reloadT: 0, swapT: 0, fireCd: 0, burstLeft: 0, grenCd: 0, meleeCd: 0, superCharge: 0, superT: 0, superCd: 0,
  recoil: 0, adsK: 0, kick: 0, kickYaw: 0, bob: 0, buffs: { bloodrush: 0, bloodrushT: 0, overcharge: 0, lastKill: -99 }, hitCount: 0, burnT: 0,
};
const RADIUS = 0.42, EYE = 1.65, STEP = 0.75, GRAV = 24, WALK = 6.6, SPRINT = 9.8, JUMP_V = 8.4, DJUMP_V = 7.6;
const GREN_CD = 16, MELEE_CD = 6;
let wp = [null, null, null]; // weapon params per slot

function loadWeapons(refill = true) {
  const eq = equipped();
  wp = eq.map(L.weaponParams);
  for (let i = 0; i < 3; i++) {
    if (refill) P.ammo[i] = wp[i].mag; else P.ammo[i] = Math.min(P.ammo[i], wp[i].mag);
  }
  if (refill) P.reserve = [Infinity, Infinity, wp[2].reserve ? Math.round(wp[2].reserve * 0.5) : 0];
  buildViewmodel(); renderWeaponHud();
}

// ---------------- Collision ----------------
function groundAt(x, z, feetY, r = 0.2) {
  let h = 0;
  for (const c of colliders) {
    if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r && c.top <= feetY + STEP && c.top > h) h = c.top;
  }
  return h;
}
function pushOut(pos, r, feetY) {
  for (const c of colliders) {
    if (c.top <= feetY + STEP) continue;
    const cx = clamp(pos.x, c.minX, c.maxX), cz = clamp(pos.z, c.minZ, c.maxZ);
    let dx = pos.x - cx, dz = pos.z - cz; const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; pos.x += dx * k; pos.z += dz * k; }
      else { // inside: push to nearest face
        const l = pos.x - c.minX, rr = c.maxX - pos.x, b = pos.z - c.minZ, f = c.maxZ - pos.z, m = Math.min(l, rr, b, f);
        if (m === l) pos.x = c.minX - r; else if (m === rr) pos.x = c.maxX + r; else if (m === b) pos.z = c.minZ - r; else pos.z = c.maxZ + r;
      }
    }
  }
  const d = Math.hypot(pos.x, pos.z), lim = ARENA_R - r - 0.5;
  if (d > lim) { pos.x *= lim / d; pos.z *= lim / d; }
}
// ray vs world boxes; returns distance or Infinity
function rayWorld(o, d, maxD) {
  let best = maxD;
  if (d.y < -1e-6) { const tg = -o.y / d.y; if (tg > 0 && tg < best) best = tg; }
  for (const c of colliders) {
    let tmin = 0, tmax = best;
    for (const [oa, da, mn, mx] of [[o.x, d.x, c.minX, c.maxX], [o.y, d.y, 0, c.top], [o.z, d.z, c.minZ, c.maxZ]]) {
      if (Math.abs(da) < 1e-9) { if (oa < mn || oa > mx) { tmin = Infinity; break; } }
      else { let t1 = (mn - oa) / da, t2 = (mx - oa) / da; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) { tmin = Infinity; break; } }
    }
    if (tmin < best && tmin >= 0) best = tmin;
  }
  return best;
}
function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r, h = b * b - cc;
  if (h < 0) return Infinity; const t = -b - Math.sqrt(h); return t >= 0 ? t : (cc < 0 ? 0 : Infinity);
}
function hasLOS(a, b) { const d = new V3().subVectors(b, a); const len = d.length(); d.divideScalar(len); return rayWorld(a, d, len) >= len - 0.3; }

// ---------------- Effects ----------------
// particles (one draw call)
const PN = 700;
const pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 3), pVel = new Float32Array(PN * 3), pLife = new Float32Array(PN), pMax = new Float32Array(PN);
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.3, map: glowTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
particles.frustumCulled = false; scene.add(particles);
let pIdx = 0; for (let i = 0; i < PN; i++) pPos[i * 3 + 1] = -999;
const _c = new THREE.Color();
function burst(pos, color, n = 10, speed = 6, life = 0.5, up = 2) {
  _c.set(color).multiplyScalar(2.2);
  for (let k = 0; k < n; k++) {
    const i = pIdx; pIdx = (pIdx + 1) % PN;
    pPos[i * 3] = pos.x; pPos[i * 3 + 1] = pos.y; pPos[i * 3 + 2] = pos.z;
    const a = Math.random() * Math.PI * 2, b = Math.random() * 2 - 1, s = speed * (0.3 + Math.random() * 0.7), r = Math.sqrt(1 - b * b);
    pVel[i * 3] = Math.cos(a) * r * s; pVel[i * 3 + 1] = b * s + up; pVel[i * 3 + 2] = Math.sin(a) * r * s;
    pCol[i * 3] = _c.r; pCol[i * 3 + 1] = _c.g; pCol[i * 3 + 2] = _c.b; pLife[i] = pMax[i] = life * (0.5 + Math.random() * 0.5);
  }
}
function updateParticles(dt) {
  for (let i = 0; i < PN; i++) {
    if (pLife[i] <= 0) continue;
    pLife[i] -= dt; if (pLife[i] <= 0) { pPos[i * 3 + 1] = -999; continue; }
    pVel[i * 3 + 1] -= 9 * dt;
    pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    const f = Math.max(0, 1 - dt * 3); pCol[i * 3] *= f; pCol[i * 3 + 1] *= f; pCol[i * 3 + 2] *= f;
  }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
}
// tracers: thin additive streaks (HDR color so bloom makes them glow)
const tracers = [];
const trGeo = new THREE.CylinderGeometry(1, 0.35, 1, 5, 1, true); trGeo.translate(0, 0.5, 0);
const _up = new V3(0, 1, 0);
for (let i = 0; i < 28; i++) {
  const l = new THREE.Mesh(trGeo, new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  l.visible = false; l.frustumCulled = false; scene.add(l); tracers.push({ l, life: 0 });
}
let trIdx = 0;
function tracer(a, b, color = 0xffe0a0, life = 0.06, width = 0.018) {
  const t = tracers[trIdx]; trIdx = (trIdx + 1) % tracers.length;
  const d = _tmpV.subVectors(b, a), len = d.length(); if (len < 0.01) return;
  t.l.position.copy(a); t.l.quaternion.setFromUnitVectors(_up, d.divideScalar(len)); t.l.scale.set(width, len, width);
  t.l.material.color.set(color).multiplyScalar(3); t.l.material.opacity = 1; t.l.visible = true; t.life = t.max = life;
}
const _tmpV = new V3();
// impact decals: scorch + ember glow, oriented to surface
const decals = [];
const decalTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, 'rgba(0,0,0,0.9)'); gr.addColorStop(0.5, 'rgba(10,6,4,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const decalGeo = new THREE.PlaneGeometry(1, 1);
for (let i = 0; i < 40; i++) {
  const m = new THREE.Mesh(decalGeo, new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, opacity: 0 }));
  const em = new THREE.Mesh(decalGeo, new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xff9040, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -5, opacity: 0 }));
  em.scale.setScalar(0.45); m.add(em); m.visible = false; scene.add(m); decals.push({ m, em, life: 0 });
}
let dcIdx = 0;
function surfaceNormal(p) {
  if (p.y < 0.05) return new V3(0, 1, 0);
  let best = null, bd = 0.08;
  for (const c of colliders) {
    if (p.x < c.minX - 0.05 || p.x > c.maxX + 0.05 || p.z < c.minZ - 0.05 || p.z > c.maxZ + 0.05 || p.y > c.top + 0.05) continue;
    for (const [d, n] of [[Math.abs(p.x - c.minX), [-1, 0, 0]], [Math.abs(p.x - c.maxX), [1, 0, 0]], [Math.abs(p.z - c.minZ), [0, 0, -1]], [Math.abs(p.z - c.maxZ), [0, 0, 1]], [Math.abs(p.y - c.top), [0, 1, 0]]]) if (d < bd) { bd = d; best = n; }
  }
  return best ? new V3(...best) : null;
}
function decal(p, size = 0.35, ember = 0xff9040) {
  if (QNAME === 'low') return;
  const n = surfaceNormal(p); if (!n) return;
  const d = decals[dcIdx]; dcIdx = (dcIdx + 1) % decals.length;
  d.m.position.copy(p).addScaledVector(n, 0.015); d.m.lookAt(_tmpV.copy(d.m.position).add(n)); d.m.rotateZ(Math.random() * 6);
  d.m.scale.setScalar(size * (0.7 + Math.random() * 0.6)); d.m.visible = true; d.m.material.opacity = 0.85; d.em.material.color.set(ember).multiplyScalar(2.5); d.em.material.opacity = 1; d.life = 8;
}
function updateDecals(dt) { for (const d of decals) { if (d.life <= 0) continue; d.life -= dt; d.em.material.opacity = Math.max(0, 1 - (8 - d.life) * 2.5); if (d.life < 2) d.m.material.opacity = d.life / 2 * 0.85; if (d.life <= 0) d.m.visible = false; } }
// lightning bolt (jagged line)
const bolts = [];
for (let i = 0; i < 10; i++) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(10 * 3), 3));
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  l.frustumCulled = false; scene.add(l); bolts.push({ l, life: 0 });
}
let boltIdx = 0;
function bolt(a, b, color = 0x9fe8ff) {
  const t = bolts[boltIdx]; boltIdx = (boltIdx + 1) % bolts.length;
  const arr = t.l.geometry.attributes.position.array;
  for (let i = 0; i < 10; i++) { const k = i / 9, j = (i === 0 || i === 9) ? 0 : 0.5; arr[i * 3] = a.x + (b.x - a.x) * k + rand(-j, j); arr[i * 3 + 1] = a.y + (b.y - a.y) * k + rand(-j, j); arr[i * 3 + 2] = a.z + (b.z - a.z) * k + rand(-j, j); }
  t.l.geometry.attributes.position.needsUpdate = true; t.l.material.color.set(color).multiplyScalar(3); t.l.material.opacity = 1; t.life = t.max = 0.12;
  // a few glowing sparks along the arc + a thick glow streak
  burst(b, color, 3, 3, 0.25, 0.5);
  tracer(a, b, color, 0.09, 0.03);
  netFx('bolt', a, b, color);
}
// explosion spheres
const exGeo = new THREE.IcosahedronGeometry(1, 3);
const shockGeo = new THREE.RingGeometry(0.8, 1, 48); shockGeo.rotateX(-Math.PI / 2);
const explosions = [];
for (let i = 0; i < 10; i++) {
  const m = new THREE.Mesh(exGeo, new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  const core = new THREE.Mesh(exGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  const ring = new THREE.Mesh(shockGeo, new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const glow = glowSprite(0xffa040, 1, 0); m.visible = core.visible = ring.visible = false; scene.add(m, core, ring, glow); explosions.push({ m, core, ring, glow, life: 0 });
}
let exIdx = 0;
function explosionFx(pos, radius, color, fromNet = false) {
  const e = explosions[exIdx]; exIdx = (exIdx + 1) % explosions.length;
  e.m.position.copy(pos); e.core.position.copy(pos); e.glow.position.copy(pos); e.ring.position.set(pos.x, Math.max(groundAt(pos.x, pos.z, pos.y + 0.5), 0) + 0.08, pos.z);
  e.m.material.color.set(color).multiplyScalar(2.2); e.ring.material.color.set(color).multiplyScalar(2.5); e.glow.material.color.set(color).multiplyScalar(2);
  e.core.material.color.set(color).lerp(new THREE.Color(0xffffff), 0.6).multiplyScalar(3);
  e.m.visible = e.core.visible = e.ring.visible = true; e.life = e.max = 0.55; e.r = radius;
  burst(pos, color, Math.round(30 * Qs.particles), radius * 2.4, 0.8, 3); burst(pos, 0xfff0d0, Math.round(10 * Qs.particles), radius * 3.5, 0.35, 1);
  boomLight.position.copy(pos); boomLight.color.set(color); boomLight.intensity = Math.min(160, 40 * radius); boomLight.distance = radius * 5; boomT = 0.3;
  if (pos.distanceTo(camera.position) < radius * 4) { S.shake = Math.max(S.shake || 0, Math.min(0.6, radius * 0.06)); rumble(0.5, 0.8, 140); }
  decal(new V3(pos.x, Math.max(groundAt(pos.x, pos.z, pos.y + 0.5), 0), pos.z), radius * 0.7, color);
  if (!fromNet) netFx('ex', pos, radius, color);
}
function updateExplosions(dt) {
  for (const e of explosions) if (e.life > 0) {
    e.life -= dt; const k = 1 - e.life / e.max;
    e.m.scale.setScalar(e.r * (0.35 + k * 0.85)); e.m.material.opacity = (1 - k) * (1 - k) * 0.7;
    e.core.scale.setScalar(e.r * 0.45 * (1 - k * 0.7)); e.core.material.opacity = Math.max(0, 1 - k * 2.2);
    e.ring.scale.setScalar(e.r * (0.3 + k * 1.6)); e.ring.material.opacity = (1 - k) * 0.9;
    e.glow.scale.setScalar(e.r * 4 * (0.5 + k)); e.glow.material.opacity = (1 - k) * 0.8;
    if (e.life <= 0) { e.m.visible = e.core.visible = e.ring.visible = false; e.glow.material.opacity = 0; }
  }
  if (boomT > 0) { boomT -= dt; boomLight.intensity *= Math.max(0, 1 - dt * 9); if (boomT <= 0) boomLight.intensity = 0; }
}
// ground telegraph rings (boss slam)
const ringGeo = new THREE.RingGeometry(0.85, 1, 48); ringGeo.rotateX(-Math.PI / 2);
const discGeo = new THREE.CircleGeometry(1, 48); discGeo.rotateX(-Math.PI / 2);
function makeTelegraph(pos, r, dur, color = 0xff3a2a) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.add(ring, disc); g.position.set(pos.x, groundAt(pos.x, pos.z, pos.y + 3) + 0.06, pos.z); ring.scale.setScalar(r); disc.scale.setScalar(0.01);
  scene.add(g); return { g, ring, disc, r, t: 0, dur };
}
// damage numbers (DOM pool)
const dmgLayer = $('dmgLayer');
const dnPool = [];
for (let i = 0; i < 36; i++) { const d = document.createElement('div'); d.className = 'dn'; d.style.display = 'none'; dmgLayer.appendChild(d); dnPool.push({ el: d, life: 0, pos: new V3(), vx: 0 }); }
let dnIdx = 0;
function dmgNumber(pos, amount, crit, shield, el = null) {
  const d = dnPool[dnIdx]; dnIdx = (dnIdx + 1) % dnPool.length;
  d.el.textContent = Math.round(amount); d.el.className = 'dn' + (crit ? ' crit' : '') + (shield ? ' shield' : '') + (el ? ' el-' + el : '');
  d.pos.copy(pos).add(new V3(rand(-0.3, 0.3), rand(0, 0.3), rand(-0.3, 0.3))); d.life = 0.8; d.el.style.display = '';
}
const _proj = new V3();
function updateDmgNumbers(dt) {
  for (const d of dnPool) {
    if (d.life <= 0) continue;
    d.life -= dt; if (d.life <= 0) { d.el.style.display = 'none'; continue; }
    d.pos.y += dt * 1.2;
    _proj.copy(d.pos).project(camera);
    if (_proj.z > 1) { d.el.style.opacity = 0; continue; }
    const x = (_proj.x * 0.5 + 0.5) * innerWidth, y = (-_proj.y * 0.5 + 0.5) * innerHeight;
    d.el.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%) scale(${1 + Math.max(0, d.life - 0.65) * 3})`;
    d.el.style.left = '0px'; d.el.style.top = '0px'; d.el.style.opacity = Math.min(1, d.life * 3);
  }
}
let hitmarkT = 0;
function hitmark(kind) { const h = $('hitmark'); h.className = 'on ' + kind; hitmarkT = kind === 'kill' ? 0.22 : 0.09; }
function killfeed(text, color = '#fff') {
  const kf = $('killfeed'); const d = document.createElement('div'); d.innerHTML = text; d.style.borderColor = color; kf.prepend(d);
  while (kf.children.length > 5) kf.lastChild.remove(); setTimeout(() => d.remove(), 4000);
}
function toast(html, color = '#fff') { const t = document.createElement('div'); t.className = 'toast'; t.style.setProperty('--r', color); t.innerHTML = html; $('toasts').appendChild(t); setTimeout(() => t.remove(), 3600); }
let bannerT = 0;
function banner(text, sub = '', dur = 2.6, share = false) { if (share) netSend({ t: 'banner', text, sub, dur }); const b = $('banner'); b.innerHTML = text + (sub ? `<small>${sub}</small>` : ''); b.classList.add('on'); bannerT = dur; }
let hintT = 0;
function hint(text, dur = 3) { $('hint').textContent = text; hintT = dur; }

// ---------------- Enemies ----------------
const EDEF = {
  skitter: { name: 'Skitter', hp: 85, speed: 7.2, r: 0.5, head: { y: 0.98, f: 0.5, r: 0.32 }, body: [{ y: 0.6, f: 0, r: 0.55 }], dmg: 12, super: 3, drop: 0.08, heavy: 0.05, color: 0x3a2c2a, eye: 0xff4a2a },
  lancer: { name: 'Lancer', hp: 170, speed: 4.3, r: 0.5, head: { y: 1.8, f: 0, r: 0.3 }, body: [{ y: 1.2, f: 0, r: 0.52 }, { y: 0.55, f: 0, r: 0.42 }], dmg: 8, super: 5, drop: 0.16, heavy: 0.1, color: 0x4d5a42, eye: 0xffa020 },
  bulwark: { name: 'Bulwark', hp: 520, shield: 380, speed: 3.1, r: 0.85, head: { y: 2.5, f: 0.1, r: 0.42 }, body: [{ y: 1.7, f: 0, r: 0.9 }, { y: 0.8, f: 0, r: 0.72 }], dmg: 20, super: 14, drop: 0.75, heavy: 0.45, color: 0x5a3a5e, eye: 0xff3a9a },
  regent: { name: 'The Hollow Regent', hp: 7000, shield: 2000, speed: 2.4, r: 1.7, head: { y: 5.3, f: 0.3, r: 0.9 }, body: [{ y: 3.6, f: 0, r: 1.75 }, { y: 1.6, f: 0, r: 1.45 }], dmg: 28, super: 40, drop: 1, heavy: 1, color: 0x2c2440, eye: 0xffd04a },
};
const BOX = new THREE.BoxGeometry(1, 1, 1);
const SPH = new THREE.SphereGeometry(1, 16, 12);
const CONE = new THREE.ConeGeometry(1, 1, 5);
const eyeMats = {}; const eyeMat = c => eyeMats[c] || (eyeMats[c] = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.5) }));
// elemental shield bubble: fresnel rim + hex shimmer
const shieldMats = {};
const shieldMat = el => shieldMats[el] || (shieldMats[el] = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
  uniforms: { uColor: { value: new THREE.Color(L.ELEMENTS[el].hex).multiplyScalar(1.1) }, uTime: { value: 0 }, uHit: { value: 0 } },
  vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vP = position; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }',
  fragmentShader: `uniform vec3 uColor; uniform float uTime, uHit; varying vec3 vN; varying vec3 vV; varying vec3 vP;
    void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);
      vec2 h = vP.xy * 7.0 + vec2(vP.z * 3.0, uTime * 0.6); vec2 g = abs(fract(h) - 0.5); float hex = smoothstep(0.42, 0.5, max(g.x, g.y));
      float a = f * 0.7 + hex * 0.08 * (0.6 + 0.4 * sin(uTime * 3.0 + vP.y * 6.0)) + uHit * 0.35;
      gl_FragColor = vec4(uColor * a, a); }`,
}));
function part(g, geo, mat, x, y, z, sx, sy, sz, name) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); g.add(m); if (name) g.userData[name] = m; return m; }

function buildEnemyMesh(type, e) {
  const d = EDEF[type];
  const { group: g, rig } = M.buildEnemyModel(type, { shadows: Qs.shadows });
  e.rig = rig; const P = rig.pivots;
  // muzzle glow sprite attached to the weapon pivot (charges up during telegraphs)
  e.muzzle = glowSprite(d.eye, 0.01, 1, 2.5);
  if (type === 'lancer') { e.muzzle.position.set(-0.05, -1.2, 0.1); P.armR.add(e.muzzle); }
  else if (type === 'bulwark') { e.muzzle.position.set(0, -0.75, 1.1); P.armR.add(e.muzzle); }
  else if (type === 'regent') { e.muzzle.position.set(0, 0, 0.3); P.core.add(e.muzzle); }
  else { e.muzzle.position.set(0, 0.1, 0.4); P.head.add(e.muzzle); }
  if (type === 'regent') g.scale.setScalar(1.0);
  if (d.shield) {
    const sh = new THREE.Mesh(SPH, shieldMat(e.shieldEl)); const s = type === 'regent' ? 3.9 : 1.75;
    sh.scale.set(s * 0.85, s, s * 0.85); sh.position.y = type === 'regent' ? 3.4 : 1.45; g.add(sh); e.shieldMesh = sh;
  }
  return g;
}
// dying enemies dissolve + shatter instead of popping out of existence
const dying = [];
function startDeathFx(e) {
  const c = centerPos(e);
  dying.push({ mesh: e.mesh, rig: e.rig, t: 0, dur: e.type === 'regent' ? 2.2 : 0.9, c });
  if (e.shieldMesh) e.shieldMesh.visible = false;
  const n = Math.round((e.type === 'regent' ? 90 : e.type === 'bulwark' ? 40 : 24) * Qs.particles);
  burst(c, e.d.eye, n, e.type === 'regent' ? 14 : 6, 0.9, 3); burst(c, 0x6a5a7a, Math.round(n * 0.5), 4, 0.8, 1.5);
  if (e.type === 'regent') { for (let i = 0; i < 5; i++) setTimeout(() => explosionFx(c.clone().add(new V3(rand(-3, 3), rand(-2, 3), rand(-3, 3))), 4, i % 2 ? 0xffd04a : 0xff7a2a), i * 280); }
}
function updateDying(dt) {
  for (let i = dying.length - 1; i >= 0; i--) {
    const d = dying[i]; d.t += dt; const k = Math.min(1, d.t / d.dur);
    M.setEnemyDissolve(d.rig, 0.02 + k * 1.0); M.setEnemyFlash(d.rig, 0);
    d.mesh.position.y -= dt * 0.3; d.mesh.rotation.z += dt * 0.15;
    if (Math.random() < 0.5 * Qs.particles) burst(d.c.clone().add(new V3(rand(-0.5, 0.5), rand(-0.6, 0.6), rand(-0.5, 0.5))), M.ENEMY_LOOK[d.rig.type].edge, 1, 1.5, 0.5, 1.5);
    if (k >= 1) { scene.remove(d.mesh); M.disposeEnemy(d.rig); dying.splice(i, 1); }
  }
}

const enemies = [];
let enemyPower = 100, enemySeq = 0;
function spawnEnemy(type, pos) {
  const d = EDEF[type];
  const hpMult = (1 + (S.wave - 1) * (type === 'regent' ? 0.06 : 0.16)) * (DEBUG ? 0.4 : 1) * (1 + (coopCount() - 1) * (type === 'regent' ? 0.8 : 0.55));
  const e = {
    type, d, pos: pos.clone(), yaw: 0, hp: d.hp * hpMult, maxHp: d.hp * hpMult, shield: (d.shield || 0) * hpMult, maxShield: (d.shield || 0) * hpMult,
    shieldEl: ['flare', 'storm', 'abyss'][Math.floor(Math.random() * 3)], state: 'move', stT: 0, atkCd: rand(0.8, 2.0), strafe: Math.random() < 0.5 ? 1 : -1, strafeT: rand(1, 3),
    avoid: Math.random() < 0.5 ? 1 : -1, moveK: 0, los: false, losT: 0, flash: 0, burnT: 0, anim: Math.random() * 10, dead: false, burstLeft: 0, phase: 1, cycle: 0, vy: 0, spawnT: 0.4,
  };
  e.id = ++enemySeq;
  e.mesh = buildEnemyMesh(type, e);
  e.mesh.position.copy(e.pos); scene.add(e.mesh);
  enemies.push(e);
  burst(new V3(e.pos.x, e.pos.y + 1, e.pos.z), 0xb066ff, 18, 5, 0.6, 2);
  return e;
}
function headPos(e, out = new V3()) { const h = e.d.head; return out.set(e.pos.x + Math.sin(e.yaw) * h.f, e.pos.y + h.y, e.pos.z + Math.cos(e.yaw) * h.f); }
function centerPos(e, out = new V3()) { return out.set(e.pos.x, e.pos.y + e.d.body[0].y, e.pos.z); }

function weaponDmgMult(power) {
  const pm = clamp(1 + (power - enemyPower) * 0.015, 0.6, 1.5);
  return pm * (1 + 0.1 * P.buffs.bloodrush) * (P.buffs.overcharge > 0 ? 1.3 : 1);
}

function damageEnemy(e, amount, { crit = false, element = 'kinetic', at = null, weapon = null, silent = false, by = 'local' } = {}) {
  if (e.dead) return false;
  const p = at || centerPos(e);
  e.flash = 0.08;
  if (NET.role === 'client') { // host owns enemy health: show feedback locally, send the damage
    if (!silent) dmgNumber(p, e.shield > 0 ? amount * (element === e.shieldEl ? 2.5 : element === 'kinetic' ? 0.7 : 1) : amount, crit && e.shield <= 0, e.shield > 0, e.shield > 0 ? e.shieldEl : null);
    if (e.shieldMesh) e.shieldMesh.material.uniforms.uHit.value = 1;
    netQueueDamage(e, amount, crit, element, weapon); return false;
  }
  if (e.shieldMesh && e.shield > 0) e.shieldMesh.material.uniforms.uHit.value = 1;
  if (e.shield > 0) {
    let m = element === e.shieldEl ? 2.5 : element === 'kinetic' ? 0.7 : 1;
    if (weapon && weapon.perks.includes('surge') && element !== 'kinetic') m *= 1.5;
    const dmg = amount * m; e.shield -= dmg;
    if (!silent && by === 'local') dmgNumber(p, dmg, false, true, e.shieldEl);
    if (e.shield <= 0) {
      e.shield = 0; if (e.shieldMesh) e.shieldMesh.visible = false; sfx.shieldBreak();
      burst(centerPos(e), L.ELEMENTS[e.shieldEl].hex, 30, 8, 0.8, 2);
      if (element === e.shieldEl) { explodeAt(centerPos(e), 5, 140 * weaponDmgMult(powerLevel()), element, e); killfeed(`${L.ELEMENTS[element].icon} Shield shattered!`, L.ELEMENTS[element].color); }
      if (e.type === 'regent') banner('SHIELD BROKEN', 'Unload everything!', 2, true);
    }
    return false;
  }
  const dmg = amount;
  e.hp -= dmg;
  if (!silent && by === 'local') dmgNumber(p, dmg, crit, false);
  if (e.hp <= 0) { killEnemy(e, { crit, weapon, element, by }); return true; }
  if (e.type === 'regent' && e.phase === 1 && e.hp < e.maxHp * 0.5) {
    e.phase = 2; e.shield = e.maxShield * 0.7; e.shieldEl = ['flare', 'storm', 'abyss'].filter(x => x !== e.shieldEl)[Math.floor(Math.random() * 2)];
    e.shieldMesh.material = shieldMat(e.shieldEl); e.shieldMesh.visible = true;
    banner('THE REGENT ENRAGES', `${L.ELEMENTS[e.shieldEl].name} shield reforms`, 2.5, true); sfx.boss();
    M.setEnemyGlowColor(e.rig, 0xff3a2a); explosionFx(centerPos(e), 7, 0xff3a2a);
    for (let i = 0; i < 4; i++) S.waveQueue.push(i < 3 ? 'skitter' : 'lancer');
  }
  return false;
}

function killEnemy(e, { crit, weapon, element, by = 'local' } = {}) {
  e.dead = true;
  const c = centerPos(e);
  if (e.type === 'regent') { explosionFx(c, 8, 0xffd04a); sfx.explode(true); }
  startDeathFx(e);
  netOnKill(e, by, crit);
  if (by === 'local') killCredit(e, { crit, weapon, c });
  // drops (host rolls; partner gets an independent roll on their own device)
  rollDrops(e, c, true);
  if (NET.role === 'host' && coopActive()) for (const pid of NET.players.keys()) rollDrops(e, c, pid);
  if (S.boss === e) { S.boss = null; onBossDefeated(); }
}
function rollDrops(e, c, local) {
  const d = e.d, drops = [];
  if (e.type === 'regent') drops.push(['e', -1.5, 0, 3], ['e', 1.5, 0, 2], ['e', 0, 1.5, 2]);
  else {
    if (Math.random() < d.drop * (DEBUG ? 2.5 : 1)) drops.push(['e', 0, 0, L.rollRarity(S.wave, e.type === 'bulwark' ? 25 : 0)]);
    if (Math.random() < d.heavy) drops.push(['a', 0, 0, 0]);
  }
  for (const [k, dx, dz, r] of drops) {
    const p = c.clone().add(new V3(dx, 0, dz));
    if (local === true) { if (k === 'e') dropEngram(p, r); else dropAmmo(p); }
    else sendTo(local, { t: 'drop', k, p: [p.x, p.y, p.z], r });
  }
}
// rewards for the player who landed the kill (runs on that player's own device)
function killCredit(e, { crit, weapon, c }) {
  S.kills++; sfx.kill(); hitmark('kill'); rumble(0.3, 0.5, 90);
  addSuper(e.d.super);
  killfeed(`${crit ? '<b style="color:#ffd84a">✦</b> ' : ''}${e.d.name} defeated${crit ? ' (precision)' : ''}`, crit ? '#ffd84a' : '#fff');
  P.buffs.lastKill = S.t;
  if (weapon) {
    const has = p => weapon.perks.includes(p);
    if (has('bloodrush')) { P.buffs.bloodrush = Math.min(3, P.buffs.bloodrush + 1); P.buffs.bloodrushT = 5; }
    if (has('swifthands') && crit) { P.ammo[P.slot] = Math.min(wp[P.slot].mag, P.ammo[P.slot] + Math.ceil(wp[P.slot].mag * 0.4)); }
    if (has('vampiric')) P.hp = Math.min(P.hpMax || 100, P.hp + 20);
    if (has('chainstorm')) { let n = 0; for (const o of enemies) { if (o.dead || n >= 3) continue; if (o.pos.distanceTo(e.pos) < 10) { bolt(c, centerPos(o)); damageEnemy(o, 90 * weaponDmgMult(weapon.power), { element: 'storm' }); n++; } } sfx.zap(); }
    if (has('phoenix')) explodeAt(c, 5, 120 * weaponDmgMult(weapon.power), 'flare', e);
  }
}

// ---------------- Projectiles / zones ----------------
const projectiles = [];
const zones = [];
function spawnProjectile(o) {
  const spr = glowSprite(o.color || 0xffffff, o.size || 0.8, 1);
  spr.position.copy(o.pos); scene.add(spr);
  let core = null;
  if (o.core) { core = new THREE.Mesh(SPH, eyeMat(o.core)); core.scale.setScalar(o.coreSize || 0.12); spr.add(core); core.scale.divideScalar(o.size || 0.8); }
  const p = { grav: 0, life: 4, splash: 0, r: 0.25, ...o, spr };
  projectiles.push(p); return p;
}
function explodeAt(pos, r, dmg, element, ignore = null, hurtsPlayer = false) {
  explosionFx(pos, r, L.ELEMENTS[element]?.hex ?? 0xffa040, hurtsPlayer); sfx.explode(r > 8);
  for (const e of enemies) {
    if (hurtsPlayer && NET.role === 'client') break; // enemy splash vs enemies is resolved on the host
    if (e.dead || e === ignore) continue;
    const dist = centerPos(e).distanceTo(pos) - e.d.r;
    if (dist < r) damageEnemy(e, dmg * (1 - 0.5 * Math.max(0, dist) / r), { element, at: centerPos(e) });
  }
  if (hurtsPlayer) { const pd = new V3(P.pos.x, P.pos.y + 1, P.pos.z).distanceTo(pos); if (pd < r) damagePlayer(dmg * (1 - 0.5 * pd / r), pos); }
}
function updateProjectiles(dt) {
  const pc = new V3(P.pos.x, P.pos.y + 1.0, P.pos.z);
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.life -= dt;
    if (p.homing) {
      if (!p.target || p.target.dead) { let best = 30, bt = null; for (const e of enemies) { if (e.dead) continue; const dd = centerPos(e).distanceTo(p.pos); if (dd < best) { best = dd; bt = e; } } p.target = bt; }
      if (p.target) { const want = centerPos(p.target).sub(p.pos).normalize().multiplyScalar(p.vel.length()); p.vel.lerp(want, Math.min(1, dt * 6)); }
    }
    p.vel.y -= p.grav * dt;
    const step = p.vel.clone().multiplyScalar(dt), len = step.length();
    const dir = step.clone().divideScalar(len || 1);
    let hit = false, hitEnemy = null;
    const wt = rayWorld(p.pos, dir, len + p.r);
    if (wt < len + p.r) { hit = true; p.pos.addScaledVector(dir, Math.max(0, wt - p.r)); }
    else p.pos.add(step);
    if (!hit && p.owner === 'p') {
      for (const e of enemies) { if (e.dead) continue; if (centerPos(e).distanceTo(p.pos) < e.d.r + p.r + 0.3 || headPos(e).distanceTo(p.pos) < e.d.head.r + p.r) { hit = true; hitEnemy = e; break; } }
    }
    if (!hit && p.owner === 'e' && p.pos.distanceTo(pc) < 0.75 + p.r) { hit = true; if (!p.splash) damagePlayer(p.dmg, p.pos); }
    if (p.trail && Math.random() < 0.7) burst(p.pos, p.trail, 1, 0.6, 0.35, 0.2);
    p.spr.position.copy(p.pos);
    if (hit || p.life <= 0) {
      if (p.onHit) p.onHit(p, hitEnemy);
      else if (p.splash) explodeAt(p.pos, p.splash, p.dmg, p.element || 'kinetic', null, p.owner === 'e');
      else if (hitEnemy) { damageEnemy(hitEnemy, p.dmg, { element: p.element, weapon: p.weapon }); hitmark('hit'); }
      else burst(p.pos, p.color || 0xffffff, 6, 3, 0.3, 1);
      scene.remove(p.spr); projectiles.splice(i, 1);
    }
  }
  for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i]; z.t += dt;
    if (z.type === 'pulse') {
      z.next -= dt;
      if (z.next <= 0 && z.n > 0) {
        z.n--; z.next = 0.55; sfx.zap(); burst(z.pos, 0x59d0ff, 20, 6, 0.4, 1);
        for (const e of enemies) { if (e.dead) continue; const c = centerPos(e); if (c.distanceTo(z.pos) < z.r) { bolt(z.pos, c); damageEnemy(e, z.dmg, { element: 'storm' }); } }
      }
      if (z.n <= 0) { scene.remove(z.obj); zones.splice(i, 1); }
    } else if (z.type === 'vortex') {
      z.obj.rotation.y += dt * 6; z.obj.scale.setScalar(z.r * 0.45 * (1 + Math.sin(z.t * 20) * 0.05));
      if (Math.random() < 0.8) burst(z.pos.clone().add(new V3(rand(-z.r, z.r), rand(0, 2), rand(-z.r, z.r))), 0xb066ff, 1, 1, 0.5, 0);
      for (const e of enemies) {
        if (e.dead) continue; const c = centerPos(e), dd = c.distanceTo(z.pos);
        if (dd < z.r) { damageEnemy(e, z.dps * dt, { element: 'abyss', silent: true }); if (e.type !== 'regent') { const pull = new V3().subVectors(z.pos, e.pos).setY(0).normalize().multiplyScalar(3 * dt); e.pos.add(pull); } z.acc = (z.acc || 0) + z.dps * dt; }
      }
      z.tick = (z.tick || 0) + dt; if (z.tick > 0.3 && z.acc) { dmgNumber(z.pos.clone().add(new V3(0, 1.5, 0)), z.acc, false, false); z.acc = 0; z.tick = 0; }
      if (z.t > z.dur) { explodeAt(z.pos, z.r, 60, 'abyss'); scene.remove(z.obj); zones.splice(i, 1); }
    }
  }
}

// ---------------- Loot drops ----------------
const engrams = [];
const ammoMat = new THREE.MeshStandardMaterial({ color: 0x6a3aaa, emissive: 0x9a4dff, emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.6 });
function dropEngram(pos, rarity) {
  const en = M.buildEngram(rarity, L.RARITY[rarity].hex);
  const g = en.group, m = en.spin[0];
  const p = pos.clone(); p.y = Math.max(groundAt(p.x, p.z, p.y + 1), 0) + 1.0;
  g.position.copy(p); scene.add(g);
  burst(p, L.RARITY[rarity].hex, 16, 4, 0.6, 3);
  engrams.push({ g, m, en, rarity, pos: p, t: 0, kind: 'engram', vel: new V3(rand(-2, 2), 4, rand(-2, 2)) });
}
function dropAmmo(pos) {
  const g = new THREE.Group(); const m = new THREE.Mesh(BOX, ammoMat); m.scale.set(0.35, 0.22, 0.5); g.add(m); g.add(glowSprite(0x9a4dff, 1.2, 0.6));
  const p = pos.clone(); p.y = Math.max(groundAt(p.x, p.z, p.y + 1), 0) + 0.5; g.position.copy(p); scene.add(g);
  engrams.push({ g, m, pos: p, t: 0, kind: 'ammo', vel: new V3(rand(-1.5, 1.5), 3, rand(-1.5, 1.5)) });
}
function updateDrops(dt) {
  for (let i = engrams.length - 1; i >= 0; i--) {
    const d = engrams[i]; d.t += dt;
    if (d.vel) { d.pos.addScaledVector(d.vel, dt); d.vel.y -= 12 * dt; const gy = groundAt(d.pos.x, d.pos.z, d.pos.y) + (d.kind === 'engram' ? 1.0 : 0.4); if (d.pos.y < gy) { d.pos.y = gy; d.vel = null; d.baseY = gy; } }
    const dx = P.pos.x - d.pos.x, dz = P.pos.z - d.pos.z, dist = Math.hypot(dx, dz), dy = Math.abs(P.pos.y + 1 - d.pos.y);
    if (!d.vel && dist < 6 && dy < 3) { d.pos.x += dx / dist * dt * 8; d.pos.z += dz / dist * dt * 8; }
    d.g.position.set(d.pos.x, d.pos.y + (d.vel ? 0 : Math.sin(d.t * 3) * 0.15), d.pos.z);
    d.m.rotation.y += dt * 2.5;
    if (d.en) { d.en.spin[1].rotation.y -= dt * 1.2; d.en.spin[1].rotation.x += dt * 0.7; d.en.ring.scale.setScalar(1 + Math.sin(d.t * 4) * 0.15); d.en.ring.position.y = -(d.g.position.y - groundAt(d.pos.x, d.pos.z, d.pos.y)) + 0.05; }
    if (!P.dead && dist < 1.6 && dy < 2.5) { pickup(d); scene.remove(d.g); engrams.splice(i, 1); }
    else if (d.t > 90) { scene.remove(d.g); engrams.splice(i, 1); }
  }
}
function pickup(d) {
  if (d.kind === 'ammo') {
    const max = wp[2].reserve || 0; P.reserve[2] = Math.min(max, P.reserve[2] + Math.ceil(max * 0.4)); sfx.pickup(0);
    toast('<b>Heavy ammo</b> picked up', '#9a4dff'); renderWeaponHud(); return;
  }
  const w = L.rollWeapon(Math.max(powerLevel(), enemyPower - 4), d.rarity);
  save.inv.push(w); S.engrams++;
  // inventory cap
  if (save.inv.length > 60) { const eqIds = new Set(save.equipped); const junk = save.inv.filter(x => !eqIds.has(x.id)).sort((a, b) => a.rarity - b.rarity || a.power - b.power)[0]; if (junk) save.inv.splice(save.inv.indexOf(junk), 1); }
  persist();
  const r = L.RARITY[w.rarity]; sfx.pickup(w.rarity);
  const cur = getW(save.equipped[w.slot]);
  const up = w.power > cur.power ? ' <span style="color:#6f6">▲ upgrade</span>' : '';
  toast(`<b>${w.name}</b> · ${r.name} ${L.ARCH[w.arch].name} ${L.ELEMENTS[w.element].icon} ✦${w.power}${up}`, r.color);
  if (up) hint(IS_TOUCH ? 'New upgrade! Tap ⚙ to equip it' : 'New upgrade! Press TAB to equip it', 3);
}

// ---------------- Enemy AI ----------------
const _v = new V3(), _w = new V3();
function enemyFire(e, target, speed, dmg, opts = {}) {
  e.mesh.updateMatrixWorld(true); const from = e.muzzle.getWorldPosition(new V3());
  const lead = target.clone().addScaledVector(P.vel, from.distanceTo(target) / speed * 0.6);
  const dir = lead.sub(from).normalize();
  dir.x += rand(-1, 1) * (opts.spread || 0.03); dir.y += rand(-1, 1) * (opts.spread || 0.03) * 0.5; dir.z += rand(-1, 1) * (opts.spread || 0.03); dir.normalize();
  if (opts.yawOff) dir.applyAxisAngle(new V3(0, 1, 0), opts.yawOff);
  const pr = { pos: from, vel: dir.multiplyScalar(speed), owner: 'e', dmg: dmg * enemyDmgMult(), color: e.d.eye, size: opts.size || 0.7, core: 0xffffff, coreSize: opts.core || 0.08, splash: opts.splash || 0, element: opts.element || 'kinetic', life: 3, r: opts.r || 0.15, trail: Qs.particles > 0.6 ? e.d.eye : 0 };
  spawnProjectile(pr);
  netEnemyShot(pr);
  burst(from, e.d.eye, 4, 2, 0.2, 0);
  sfx.enemyShot();
}
function enemyDmgMult() { return clamp(1 - (powerLevel() - enemyPower) * 0.012, 0.55, 1.5); }

const _rp = new V3();
function updateEnemies(dt) {
  const localPP = P.pos, localChest = new V3(localPP.x, localPP.y + 1.2, localPP.z);
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.dead) { enemies.splice(i, 1); continue; }
    const d = e.d;
    // co-op: target the nearest standing player
    let pp = localPP, pChest = localChest, tgtRemote = false;
    const tpid = pickTarget(e.pos.x, e.pos.z);
    if (tpid !== null) { pp = _rp.copy(NET.players.get(tpid).pos); pChest = new V3(pp.x, pp.y + 1.2, pp.z); tgtRemote = true; }
    const hurt = (amt, from) => tgtRemote ? netHurtRemote(tpid, amt, from) : damagePlayer(amt, from);
    const targetDead = tgtRemote ? false : P.dead;
    e.anim += dt; e.stT += dt;
    const dx = pp.x - e.pos.x, dz = pp.z - e.pos.z, dist = Math.hypot(dx, dz) || 0.001;
    const tx = dx / dist, tz = dz / dist;
    e.losT -= dt; if (e.losT <= 0) { e.losT = 0.25 + Math.random() * 0.15; e.los = !targetDead && hasLOS(headPos(e, _v), pChest); }
    if (e.burnT > 0) { e.burnT -= dt; damageEnemy(e, 28 * dt, { element: 'flare', silent: true }); if (Math.random() < 0.4) burst(centerPos(e), 0xff7a2a, 1, 1.5, 0.4, 2); if (e.dead) continue; }
    let mx = 0, mz = 0, spd = d.speed;
    e.atkCd -= dt; e.strafeT -= dt; if (e.strafeT <= 0) { e.strafe *= -1; e.strafeT = rand(1.2, 3); }
    if (targetDead) { mx = -tx * 0.3; mz = -tz * 0.3; spd *= 0.3; }
    else if (e.type === 'skitter') {
      if (e.state === 'move') {
        const wob = Math.sin(e.anim * 4 + i) * 0.5;
        mx = tx - tz * wob; mz = tz + tx * wob;
        if (dist < 2.1 && e.atkCd <= 0 && Math.abs(pp.y - e.pos.y) < 2) { e.state = 'tele'; e.stT = 0; }
      } else if (e.state === 'tele') {
        spd = 0;
        if (e.stT > 0.35) { if (dist < 2.6 && Math.abs(pp.y - e.pos.y) < 2.2) hurt(d.dmg * enemyDmgMult(), e.pos); e.state = 'move'; e.atkCd = 1.1; burst(headPos(e), d.eye, 6, 3, 0.3); }
      }
    } else if (e.type === 'lancer' || e.type === 'bulwark') {
      const near = e.type === 'lancer' ? 11 : 7, far = e.type === 'lancer' ? 22 : 15;
      if (e.state === 'move') {
        if (!e.los || dist > far) { mx = tx; mz = tz; }
        else if (dist < near) { mx = -tx; mz = -tz; }
        mx += -tz * e.strafe * 0.9; mz += tx * e.strafe * 0.9;
        if (e.los && e.atkCd <= 0 && dist < 34) { e.state = 'tele'; e.stT = 0; if (dist < 30) sfx.telegraph(); }
        if (e.type === 'bulwark' && dist < 3.5 && e.atkCd <= 0) { e.state = 'shove'; e.stT = 0; }
      } else if (e.state === 'tele') {
        spd *= 0.2; const tt = e.type === 'lancer' ? 0.6 : 0.9;
        e.muzzle.scale.setScalar(Math.min(1, e.stT / tt) * (e.type === 'lancer' ? 1.2 : 2.2));
        if (e.stT > tt) { e.state = 'fire'; e.stT = 0; e.burstLeft = e.type === 'lancer' ? 3 : 1; e.shotT = 0; }
      } else if (e.state === 'fire') {
        spd *= 0.3; e.shotT -= dt;
        if (e.shotT <= 0 && e.burstLeft > 0) {
          e.burstLeft--; e.shotT = 0.13;
          if (e.type === 'lancer') enemyFire(e, pChest, 32, d.dmg, { spread: 0.035 });
          else enemyFire(e, pChest, 19, d.dmg, { size: 1.6, core: 0.2, r: 0.35, splash: 2.2, spread: 0.02, element: e.shieldEl });
        }
        if (e.burstLeft <= 0) { e.state = 'move'; e.atkCd = e.type === 'lancer' ? rand(1.8, 2.8) : rand(2.8, 3.6); e.muzzle.scale.setScalar(0.01); }
      } else if (e.state === 'shove') {
        spd = 0; if (e.stT > 0.5) { if (dist < 4) { hurt(25 * enemyDmgMult(), e.pos); if (!tgtRemote) { P.vel.x += tx * 12; P.vel.z += tz * 12; P.vel.y += 4; P.onGround = false; } } e.state = 'move'; e.atkCd = 2.5; }
      }
    } else if (e.type === 'regent') {
      const rate = e.phase === 2 ? 0.7 : 1;
      if (e.state === 'move') {
        if (dist > 12) { mx = tx; mz = tz; } else if (dist < 7) { mx = -tx; mz = -tz; }
        mx += -tz * e.strafe * 0.5; mz += tx * e.strafe * 0.5;
        if (e.atkCd <= 0) {
          const atk = ['volley', 'slam', 'volley', 'summon', 'slam'][e.cycle++ % 5];
          e.state = atk; e.stT = 0;
          if (atk === 'slam') { e.tele = makeTelegraph(pp.clone(), 6.5, 1.4 * rate); sfx.telegraph(); netSend({ t: 'slam', p: [pp.x, pp.y, pp.z], r: 6.5, dur: 1.4 * rate }); }
          if (atk === 'volley') sfx.telegraph();
          if (atk === 'summon') { banner('THE REGENT CALLS', 'Reinforcements incoming', 1.8, true); for (let k = 0; k < 4; k++) S.waveQueue.push(k < 3 ? 'skitter' : 'lancer'); }
        }
      } else if (e.state === 'volley') {
        spd *= 0.2; e.muzzle.scale.setScalar(Math.min(1, e.stT) * 4);
        if (e.stT > 1.0 * rate) { const n = e.phase === 2 ? 9 : 7; for (let k = 0; k < n; k++) enemyFire(e, pChest, 18, 18, { yawOff: (k - (n - 1) / 2) * 0.13, spread: 0.005, size: 1.5, core: 0.2, r: 0.4, splash: 2, element: e.shieldEl }); e.state = 'move'; e.atkCd = rand(2.2, 3) * rate; e.muzzle.scale.setScalar(0.01); }
      } else if (e.state === 'slam') {
        spd = 0; const tg = e.tele; tg.t += dt; const k = Math.min(1, tg.t / tg.dur); tg.disc.scale.setScalar(tg.r * k); tg.ring.material.opacity = 0.5 + Math.sin(tg.t * 25) * 0.4;
        if (tg.t >= tg.dur) {
          explosionFx(tg.g.position, tg.r, 0xff4a2a); sfx.explode(true);
          const dd = Math.hypot(pp.x - tg.g.position.x, pp.z - tg.g.position.z);
          const ld = Math.hypot(localPP.x - tg.g.position.x, localPP.z - tg.g.position.z);
          if (ld < tg.r && localPP.y - tg.g.position.y < 2.5) { damagePlayer(45 * enemyDmgMult(), tg.g.position); P.vel.y = 7; P.onGround = false; }
          scene.remove(tg.g); e.tele = null; e.state = 'move'; e.atkCd = rand(1.8, 2.6) * rate;
        }
      } else if (e.state === 'summon') { spd = 0; if (e.stT > 0.8) { e.state = 'move'; e.atkCd = 2 * rate; } }
    }
    // steering
    let ml = Math.hypot(mx, mz);
    if (ml > 0.01) {
      mx /= ml; mz /= ml;
      _v.set(e.pos.x, e.pos.y + 0.5, e.pos.z); _w.set(mx, 0, mz);
      if (rayWorld(_v, _w, d.r + 1.4) < d.r + 1.4) { const a = 1.2 * e.avoid, c = Math.cos(a), s = Math.sin(a); const nx = mx * c - mz * s, nz = mx * s + mz * c; mx = nx; mz = nz; if (Math.random() < 0.01) e.avoid *= -1; }
      // separation
      for (const o of enemies) { if (o === e || o.dead) continue; const ox = e.pos.x - o.pos.x, oz = e.pos.z - o.pos.z, od = Math.hypot(ox, oz), min = d.r + o.d.r + 0.3; if (od < min && od > 0.01) { mx += ox / od * 0.8; mz += oz / od * 0.8; } }
      ml = Math.hypot(mx, mz); mx /= ml; mz /= ml;
      e.pos.x += mx * spd * dt; e.pos.z += mz * spd * dt;
    }
    pushOut(e.pos, d.r, e.pos.y);
    const gy = groundAt(e.pos.x, e.pos.z, e.pos.y, 0.1);
    if (e.pos.y > gy) { e.vy -= GRAV * dt; e.pos.y = Math.max(gy, e.pos.y + e.vy * dt); } else { e.pos.y = gy; e.vy = 0; }
    const wantYaw = Math.atan2(tx, tz);
    let dy = wantYaw - e.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    e.yaw += dy * Math.min(1, dt * 8);
    e.mesh.position.copy(e.pos); e.mesh.rotation.y = e.yaw;
    e.moveK += ((ml > 0.01 && d.speed > 0 ? spd / d.speed : 0) - e.moveK) * Math.min(1, dt * 8);
    visualEnemy(e, dt);
  }
}
// visuals shared by host-simulated enemies and client puppets
function visualEnemy(e, dt) {
  if (e.spawnT > 0) { e.spawnT -= dt; e.mesh.scale.setScalar(1 - Math.max(0, e.spawnT) * 2); M.setEnemyDissolve(e.rig, Math.max(0, e.spawnT) * 2); }
  const k = e.tele ? Math.min(1, e.tele.t / e.tele.dur) : 0;
  M.animateEnemy(e.rig, dt, Math.min(1, e.moveK || 0), e.state, { phase: e.phase, k });
  if (e.type === 'regent') e.mesh.position.y += 0.3 + Math.sin(e.anim * 1.5) * 0.2;
  if (e.flash > 0) e.flash -= dt;
  M.setEnemyFlash(e.rig, e.flash > 0 ? 1.4 : 0);
  if (e.shieldMesh) { e.shieldMesh.visible = e.shield > 0; const u = e.shieldMesh.material.uniforms; u.uTime.value = S.t; u.uHit.value = Math.max(0, u.uHit.value - dt * 5); }
}

// ---------------- Player damage ----------------
function damagePlayer(amount, from) {
  if (P.dead || GOD || S.mode !== 'play') return;
  if (P.superT > 0) amount *= 0.5;
  P.lastHit = S.t;
  if (P.over > 0) { const a = Math.min(P.over, amount); P.over -= a; amount -= a; }
  if (P.shield > 0) { const a = Math.min(P.shield, amount); P.shield -= a; amount -= a; }
  P.hp -= amount;
  $('vignette').style.opacity = clamp(0.25 + (1 - P.hp / 100) * 0.6, 0, 0.9);
  sfx.hurt();
  if (P.hp <= 0) playerDie();
}

// ---------------- Viewmodel (separate pass so the gun never clips into walls) ----------------
const vmScene = new THREE.Scene();
const vmCam = new THREE.PerspectiveCamera(54, 1, 0.01, 10);
vmScene.add(new THREE.HemisphereLight(0xb8c4ff, 0x503830, 1.1));
const vmSun = new THREE.DirectionalLight(0xffd0a8, 2.2); vmSun.position.set(-1, 2, 1); vmScene.add(vmSun);
const vmRim = new THREE.DirectionalLight(0x8a7aff, 1.2); vmRim.position.set(1.5, 0.5, -1); vmScene.add(vmRim);
const vmFlashLight = new THREE.PointLight(0xffc080, 0, 1.5, 2); vmScene.add(vmFlashLight);
const vmRoot = new THREE.Group(); vmScene.add(vmRoot);
vmScene.environment = scene.environment; vmScene.environmentIntensity = 0.9;
let vmGun = null, vmModel = null, vmMuzzle = new THREE.Object3D(), vmFlash = null, vmSuperOrb = null;
function buildViewmodel() {
  if (vmGun) vmRoot.remove(vmGun);
  const w = equipped()[P.slot]; if (!w) return;
  vmModel = M.buildWeaponModel(w.arch, L.RARITY[w.rarity].hex, L.ELEMENTS[w.element].hex === 0xe9e9e9 ? 0xffc070 : L.ELEMENTS[w.element].hex);
  const g = vmModel.group;
  vmMuzzle = vmModel.muzzle; vmFlash = { material: vmModel.flashMat }; vmModel.flash.visible = false;
  g.scale.setScalar(0.6); vmGun = g; vmRoot.add(g);
}
vmSuperOrb = glowSprite(0xffffff, 0.5, 0); vmSuperOrb.position.set(-0.25, -0.2, -0.55); vmRoot.add(vmSuperOrb);
const vmHome = new V3(0.17, -0.17, -0.5), vmAds = new V3(0, -0.098, -0.4);
let vmKick = 0;
const vmSway = { x: 0, y: 0, lx: 0, ly: 0 };
function updateViewmodel(dt, moving, sprinting) {
  if (!vmGun) return;
  P.bob += dt * (moving ? (sprinting ? 13 : 9) : 1.5);
  const amp = moving && P.onGround ? (sprinting ? 0.025 : 0.012) : 0.003;
  const home = vmHome.clone().lerp(vmAds, P.adsK);
  let drop = 0;
  if (P.reloadT > 0) drop = Math.sin(Math.min(1, 1 - P.reloadT / wp[P.slot].reload) * Math.PI) * 0.18;
  if (P.swapT > 0) drop = P.swapT / wp[P.slot].swap * 0.35;
  vmKick = Math.max(0, vmKick - dt * 8);
  // look sway: the gun lags behind camera rotation
  const dyaw = P.yaw - (vmSway.lx ?? P.yaw), dpit = P.pitch - (vmSway.ly ?? P.pitch); vmSway.lx = P.yaw; vmSway.ly = P.pitch;
  const sk = 1 - P.adsK * 0.75;
  vmSway.x += (clamp(dyaw * 1.6, -0.06, 0.06) * sk - vmSway.x) * Math.min(1, dt * 10); vmSway.y += (clamp(-dpit * 1.6, -0.05, 0.05) * sk - vmSway.y) * Math.min(1, dt * 10);
  const air = P.onGround ? 0 : clamp(P.vel.y * -0.004, -0.03, 0.03);
  vmGun.position.set(home.x + Math.cos(P.bob) * amp * (1 - P.adsK * 0.8) - vmSway.x * 0.5, home.y + Math.abs(Math.sin(P.bob)) * amp - drop + (sprinting ? -0.04 : 0) + vmSway.y * 0.4 + air, home.z + vmKick * 0.08);
  vmGun.rotation.set(vmKick * 0.25 + (P.reloadT > 0 ? -drop * 2 : 0) + vmSway.y, (sprinting ? 0.5 : 0) + vmSway.x, (sprinting ? 0.3 : 0) + vmSway.x * 1.5 + Math.cos(P.bob) * amp * 2);
  if (vmModel.mag) vmModel.mag.position.y = (vmModel.magY ??= vmModel.mag.position.y) - (P.reloadT > 0 ? Math.sin(Math.min(1, 1 - P.reloadT / wp[P.slot].reload) * Math.PI) * 0.25 : 0);
  // muzzle flash fade
  const fo = vmModel.flashMat.opacity; vmModel.flash.visible = fo > 0.01;
  if (fo > 0) { vmModel.flashMat.opacity = Math.max(0, fo - dt * 22); vmModel.flash.rotation.z = Math.random() * 6; vmModel.flash.scale.setScalar(0.8 + Math.random() * 0.5); }
  flashLight.intensity = Math.max(0, flashLight.intensity - dt * 260); vmFlashLight.intensity = flashLight.intensity * 0.06;
  vmSuperOrb.material.opacity = P.superT > 0 ? 0.9 : 0;
  if (P.superT > 0) { vmSuperOrb.material.color.setHex(CLASSES[save.cls].hex).multiplyScalar(2.5); vmSuperOrb.scale.setScalar(0.45 + Math.sin(S.t * 18) * 0.05); }
}

// ---------------- Player weapons ----------------
function curW() { return equipped()[P.slot]; }
function swapTo(i) {
  if (i === P.slot || P.dead || S.mode !== 'play') return;
  P.slot = i; P.reloadT = 0; P.swapT = wp[i].swap; P.burstLeft = 0; buildViewmodel(); renderWeaponHud(); sfx.click();
}
function reload() {
  const w = wp[P.slot];
  if (P.reloadT > 0 || P.ammo[P.slot] >= w.mag || P.reserve[P.slot] <= 0 || P.swapT > 0) return;
  P.reloadT = w.reload; sfx.reload();
  if (curW().perks.includes('overcharge') && S.t - P.buffs.lastKill < 3) { P.buffs.overcharge = 5; killfeed('Overcharge Clip active', '#ffcf8a'); }
}
function finishReload() {
  const w = wp[P.slot], need = w.mag - P.ammo[P.slot], take = Math.min(need, P.reserve[P.slot]);
  P.ammo[P.slot] += take; if (P.reserve[P.slot] !== Infinity) P.reserve[P.slot] -= take;
  renderWeaponHud();
}
const _o = new V3(), _d = new V3(), _hit = new V3();
function camDir(out) { return out.set(0, 0, -1).applyEuler(camera.rotation); }
function muzzleWorld() {
  // approximate: offset from camera to the right/down so tracers start near the gun
  return new V3(0.22, -0.2, -0.6).applyEuler(camera.rotation).add(camera.position);
}
function aimAssist(dir) {
  if (!IS_TOUCH && !(PAD.active && save.padAA !== false)) return dir;
  let best = 0.06, bestDir = null;
  for (const e of enemies) {
    if (e.dead) continue;
    for (const pt of [headPos(e, new V3()), centerPos(e, new V3())]) {
      const to = pt.sub(camera.position); const dist = to.length(); if (dist > 45) continue; to.divideScalar(dist);
      const ang = Math.acos(clamp(to.dot(dir), -1, 1));
      if (ang < best && hasLOS(camera.position, camera.position.clone().addScaledVector(to, dist - 0.5))) { best = ang; bestDir = to.clone(); }
    }
  }
  return bestDir ? dir.clone().lerp(bestDir, 0.75).normalize() : dir;
}
function hitscan(o, dir, maxD) {
  let best = rayWorld(o, dir, maxD), be = null, crit = false;
  for (const e of enemies) {
    if (e.dead) continue;
    const th = raySphere(o, dir, headPos(e, _v), e.d.head.r * 1.15);
    if (th < best) { best = th; be = e; crit = true; }
    for (const b of e.d.body) { _w.set(e.pos.x, e.pos.y + b.y, e.pos.z); const tb = raySphere(o, dir, _w, b.r); if (tb < best) { best = tb; be = e; crit = false; } }
    if (e.shield > 0 && e.shieldMesh) { _w.copy(e.shieldMesh.position).applyMatrix4(e.mesh.matrixWorld); const ts = raySphere(o, dir, _w, e.shieldMesh.scale.y * 0.9); if (ts < best) { best = ts; be = e; crit = false; } }
  }
  return { t: best, enemy: be, crit };
}
function fireWeapon() {
  const w = wp[P.slot], item = curW();
  P.ammo[P.slot]--; S.shots++;
  P.fireCd = w.burst ? (P.burstLeft > 1 ? w.interval : w.burstGap) : w.interval;
  if (w.burst) { P.burstLeft = P.burstLeft > 1 ? P.burstLeft - 1 : 0; }
  sfx.shot(item.arch);
  const fcol = L.ELEMENTS[item.element].hex === 0xe9e9e9 ? 0xffd090 : L.ELEMENTS[item.element].hex;
  vmFlash.material.opacity = 1; vmFlash.material.color.setHex(fcol).multiplyScalar(2.5);
  flashLight.color.setHex(fcol); flashLight.intensity = item.arch === 'rocket' || item.arch === 'hand' ? 40 : 22; flashLight.position.copy(muzzleWorld());
  vmFlashLight.color.setHex(fcol); vmFlashLight.position.set(vmGun.position.x, vmGun.position.y + 0.05, vmGun.position.z - 0.3);
  rumble(item.arch === 'hand' || item.arch === 'rocket' ? 0.55 : 0.18, item.arch === 'rocket' ? 0.9 : 0.35, item.arch === 'auto' || item.arch === 'mg' ? 40 : 80);
  vmKick = Math.min(1, vmKick + (item.arch === 'hand' || item.arch === 'rocket' ? 1 : 0.35));
  const kick = w.recoil * (1 - P.adsK * 0.4);
  P.kick += kick; P.kickYaw += rand(-0.4, 0.4) * kick;
  camera.position.copy(P.pos).add(new V3(0, EYE, 0)); camera.rotation.set(P.pitch - P.kick, P.yaw + P.kickYaw, 0);
  const moving = Math.hypot(P.vel.x, P.vel.z) > 1;
  const spread = w.spread * (1 - P.adsK * 0.7) * (moving ? 1.6 : 1) * (P.onGround ? 1 : 2);
  let dir = camDir(_d).clone();
  dir.x += rand(-1, 1) * spread; dir.y += rand(-1, 1) * spread; dir.z += rand(-1, 1) * spread; dir.normalize();
  dir = aimAssist(dir);
  const mz = muzzleWorld();
  const elHex = L.ELEMENTS[item.element].hex;
  if (w.projectile) {
    spawnProjectile({ pos: mz, vel: dir.clone().multiplyScalar(60), owner: 'p', dmg: w.dmg * weaponDmgMult(item.power), splash: w.splash, element: item.element, color: elHex === 0xe9e9e9 ? 0xffa040 : elHex, size: 1.0, core: 0xffffff, coreSize: 0.1, trail: 0xffb070, life: 5, r: 0.2 });
    renderWeaponHud(); return;
  }
  const h = hitscan(camera.position, dir, 200);
  _hit.copy(camera.position).addScaledVector(dir, Math.min(h.t, 200));
  tracer(mz, _hit, elHex === 0xe9e9e9 ? 0xffe0a0 : elHex, 0.05);
  netShot(mz, _hit, elHex === 0xe9e9e9 ? 0xffe0a0 : elHex);
  if (h.enemy) {
    const e = h.enemy;
    let dmg = w.dmg * weaponDmgMult(item.power);
    if (h.t > w.range) dmg *= Math.max(0.5, 1 - (h.t - w.range) / w.range);
    const crit = h.crit && e.shield <= 0;
    if (crit) { dmg *= w.crit; S.crits++; }
    S.hits++;
    burst(_hit, crit ? 0xffd84a : (e.shield > 0 ? L.ELEMENTS[e.shieldEl].hex : 0xffb070), crit ? 9 : 6, 4, 0.25, 1);
    rumble(0.1, crit ? 0.5 : 0.25, 40);
    const killed = damageEnemy(e, dmg, { crit, element: item.element, at: _hit.clone(), weapon: item });
    if (!killed) { hitmark(crit ? 'crit' : 'hit'); sfx.hit(crit); }
    if (crit && item.perks.includes('shatter')) explodeAt(_hit.clone(), 2, dmg * 0.35, item.element, null);
    P.hitCount++;
    if (item.perks.includes('starbolt') && P.hitCount % 4 === 0) spawnProjectile({ pos: mz.clone(), vel: dir.clone().multiplyScalar(22).add(new V3(0, 4, 0)), owner: 'p', dmg: 120 * weaponDmgMult(item.power), element: item.element, color: 0xffcc33, size: 0.9, homing: true, trail: 0xffe080, life: 3, r: 0.2, weapon: item });
  } else if (h.t < 200) { burst(_hit, 0xffc890, 6, 3.5, 0.22, 1.5); burst(_hit, 0x8a7a70, 3, 1.5, 0.4, 0.5); decal(_hit, item.arch === 'hand' || item.arch === 'scout' ? 0.28 : 0.2, fcol); }
  renderWeaponHud();
}
function updateWeapon(dt) {
  P.fireCd -= dt;
  if (P.swapT > 0) { P.swapT -= dt; return; }
  if (P.reloadT > 0) { P.reloadT -= dt; if (P.reloadT <= 0) finishReload(); return; }
  if (P.superT > 0 && save.cls !== 'abyss') { updateSuperFire(dt); return; }
  const w = wp[P.slot];
  const wantFire = input.fire || (w.burst && P.burstLeft > 0);
  if (wantFire && P.fireCd <= 0) {
    if (P.ammo[P.slot] <= 0) { if (P.reserve[P.slot] > 0) reload(); else { sfx.dry(); if (P.slot === 2) { hint('Out of heavy ammo — pick up purple bricks', 2); swapTo(0); } } return; }
    if (w.burst && P.burstLeft === 0) P.burstLeft = w.burst;
    fireWeapon();
    if (P.ammo[P.slot] <= 0 && P.reserve[P.slot] > 0) setTimeout(() => reload(), 120);
  }
}

// ---------------- Abilities ----------------
function addSuper(v) { const was = P.superCharge >= 100; P.superCharge = Math.min(100, P.superCharge + v); if (!was && P.superCharge >= 100 && P.superT <= 0) { killfeed('<b>SUPER READY</b>', CLASSES[save.cls].color); hint(IS_TOUCH ? 'Super ready — tap ✦' : 'Super ready — press F', 2.5); } }
function throwGrenade() {
  if (S.mode !== 'play' || P.dead || P.grenCd > 0) return;
  P.grenCd = GREN_CD; sfx.grenade();
  const cls = save.cls, c = CLASSES[cls];
  const dir = camDir(new V3());
  const pm = weaponDmgMult(powerLevel());
  spawnProjectile({ pos: muzzleWorld(), vel: dir.multiplyScalar(19).add(new V3(0, 4.5, 0)), grav: 16, owner: 'p', color: c.hex, size: 0.9, core: 0xffffff, coreSize: 0.1, trail: c.hex, life: 3, r: 0.18,
    onHit: (p) => {
      if (cls === 'flare') { explodeAt(p.pos, 5, 170 * pm, 'flare'); for (const e of enemies) if (!e.dead && centerPos(e).distanceTo(p.pos) < 5.5) e.burnT = 3; }
      else if (cls === 'storm') { const o = glowSprite(0x59d0ff, 2, 0.9); o.position.copy(p.pos); scene.add(o); zones.push({ type: 'pulse', pos: p.pos.clone(), obj: o, n: 3, next: 0.05, r: 5, dmg: 85 * pm, t: 0 }); }
      else { const o = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({ color: 0x8a3aff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })); o.position.copy(p.pos); scene.add(o); zones.push({ type: 'vortex', pos: p.pos.clone(), obj: o, r: 5.5, dps: 120 * pm, dur: 3, t: 0 }); }
    } });
}
function doMelee() {
  if (S.mode !== 'play' || P.dead || P.meleeCd > 0) return;
  P.meleeCd = MELEE_CD; sfx.melee(); vmKick = 1;
  const fwd = new V3(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
  let best = null, bd = 4.2;
  for (const e of enemies) { if (e.dead) continue; const to = new V3(e.pos.x - P.pos.x, 0, e.pos.z - P.pos.z); const d = to.length() - e.d.r; if (d < bd && to.normalize().dot(fwd) > 0.45) { bd = d; best = e; } }
  const cls = save.cls, c = CLASSES[cls], pm = weaponDmgMult(powerLevel());
  const at = camera.position.clone().addScaledVector(camDir(new V3()), 1.5);
  burst(at, c.hex, 16, 5, 0.35, 0);
  if (!best) return;
  P.vel.addScaledVector(fwd, 8);
  const cp = centerPos(best);
  damageEnemy(best, 160 * pm, { element: c.el, at: cp, crit: false }); hitmark('hit');
  if (cls === 'flare') best.burnT = 4;
  if (cls === 'storm') { let n = 0; for (const o of enemies) { if (o === best || o.dead || n >= 2) continue; if (o.pos.distanceTo(best.pos) < 9) { bolt(cp, centerPos(o)); damageEnemy(o, 80 * pm, { element: 'storm' }); n++; } } sfx.zap(); }
  if (cls === 'abyss') { P.over = 60; killfeed('Void overshield', c.color); }
}
function castSuper() {
  if (S.mode !== 'play' || P.dead || P.superCharge < 100 || P.superT > 0) return;
  P.superCharge = 0; sfx.superCast();
  const cls = save.cls, c = CLASSES[cls];
  banner(c.sup.split(' — ')[0], '', 1.4);
  burst(P.pos.clone().add(new V3(0, 1, 0)), c.hex, 50, 10, 0.8, 4);
  if (cls === 'flare') { P.superT = 12; P.superFireCd = 0; }
  else if (cls === 'storm') { P.superT = 9; P.superFireCd = 0; }
  else {
    P.superT = 0.6; P.shield = 100; P.over = 60;
    const dir = camDir(new V3());
    spawnProjectile({ pos: muzzleWorld(), vel: dir.multiplyScalar(30), owner: 'p', color: 0x9a4dff, size: 4, core: 0x1a0030, coreSize: 0.9, trail: 0xc080ff, life: 4, r: 0.6,
      onHit: (p) => { explodeAt(p.pos, 11, 3200 * weaponDmgMult(powerLevel()), 'abyss'); explosionFx(p.pos, 11, 0x5a1aaa); } });
  }
}
function updateSuperFire(dt) {
  P.superFireCd -= dt;
  const cls = save.cls, pm = weaponDmgMult(powerLevel());
  if (cls === 'flare' && input.fire && P.superFireCd <= 0) {
    P.superFireCd = 0.42; vmKick = 1; sfx.grenade();
    const dir = aimAssist(camDir(new V3()));
    spawnProjectile({ pos: muzzleWorld(), vel: dir.multiplyScalar(48).add(new V3(0, 1.5, 0)), grav: 4, owner: 'p', color: 0xff7a2a, size: 1.6, core: 0xffe0a0, coreSize: 0.22, trail: 0xff9a40, life: 3, r: 0.3,
      onHit: (p) => { explodeAt(p.pos, 5, 320 * pm, 'flare'); for (const e of enemies) if (!e.dead && centerPos(e).distanceTo(p.pos) < 5) e.burnT = 3; } });
  }
  if (cls === 'storm' && input.fire && P.superFireCd <= 0) {
    P.superFireCd = 0.1; const fwd = camDir(new V3()); let n = 0;
    const src = muzzleWorld();
    const cands = enemies.filter(e => !e.dead).map(e => ({ e, c: centerPos(e) })).filter(o => { const to = o.c.clone().sub(camera.position); const d = to.length(); return d < 24 && to.normalize().dot(fwd) > 0.82; }).sort((a, b) => a.c.distanceTo(camera.position) - b.c.distanceTo(camera.position));
    for (const o of cands) { if (n >= 3) break; bolt(src, o.c); damageEnemy(o.e, 45 * pm, { element: 'storm', silent: n > 0 }); n++; }
    if (!n) bolt(src, camera.position.clone().addScaledVector(fwd, 14));
    sfx.zap();
  }
}

// ---------------- Player update ----------------
function updatePlayer(dt) {
  // look
  const sens = save.sens || 1;
  P.yaw -= input.lookDX * sens; P.pitch -= input.lookDY * sens; input.lookDX = input.lookDY = 0;
  P.pitch = clamp(P.pitch, -1.45, 1.45);
  P.kick *= Math.max(0, 1 - dt * (IS_TOUCH ? 7 : 4.5)); P.kickYaw *= Math.max(0, 1 - dt * 6);
  if (P.dead) return;
  // move
  let mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + input.moveX, my = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) + input.moveY;
  const ml = Math.hypot(mx, my); if (ml > 1) { mx /= ml; my /= ml; }
  const ads = input.ads && P.reloadT <= 0 && P.superT <= 0;
  P.adsK += ((ads ? 1 : 0) - P.adsK) * Math.min(1, dt * 12);
  const sprinting = (keys.ShiftLeft || keys.ShiftRight || input.sprint) && my > 0.3 && !ads && P.reloadT <= 0 && !input.fire;
  let speed = (sprinting ? SPRINT : WALK) * (ads ? 0.6 : 1) * (P.superT > 0 && save.cls === 'storm' ? 1.35 : 1);
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
  const wx = (fx * my + rx * mx) * speed, wz = (fz * my + rz * mx) * speed;
  const acc = P.onGround ? 14 : 3.5;
  P.vel.x += (wx - P.vel.x) * Math.min(1, dt * acc); P.vel.z += (wz - P.vel.z) * Math.min(1, dt * acc);
  if (input.jumpPressed) {
    input.jumpPressed = false;
    if (P.onGround) { P.vel.y = JUMP_V; P.onGround = false; P.jumps = 1; sfx.jump(); }
    else if (P.jumps < 2) { P.vel.y = DJUMP_V; P.jumps = 2; sfx.jump(); burst(P.pos.clone(), CLASSES[save.cls].hex, 14, 3, 0.4, -1); }
  }
  P.gliding = false;
  if (!P.onGround) {
    P.vel.y -= GRAV * dt;
    if (input.jumpHeld && P.vel.y < -1.5 && P.jumps >= 1) { P.vel.y = Math.max(P.vel.y, -2.0); P.gliding = true; if (Math.random() < 0.3) burst(P.pos.clone(), CLASSES[save.cls].hex, 1, 1, 0.3, -1); }
  }
  P.pos.x += P.vel.x * dt; P.pos.z += P.vel.z * dt; P.pos.y += P.vel.y * dt;
  pushOut(P.pos, RADIUS, P.pos.y);
  const g = groundAt(P.pos.x, P.pos.z, P.pos.y, 0.25);
  if (P.pos.y <= g) { if (!P.onGround && P.vel.y < -12) burst(P.pos.clone(), 0xaaaaaa, 8, 2, 0.3, 0); P.pos.y = g; P.vel.y = 0; P.onGround = true; P.jumps = 0; }
  else if (P.onGround && P.pos.y - g < 0.6 && P.vel.y <= 0) { P.pos.y = g; }
  else P.onGround = false;
  // regen
  if (S.t - P.lastHit > 3.2) { if (P.shield < 100) P.shield = Math.min(100, P.shield + 55 * dt); else if (P.hp < 100) P.hp = Math.min(100, P.hp + 35 * dt); }
  if (S.t - P.lastHit > 1) { const v = $('vignette'); v.style.opacity = Math.max(0, parseFloat(v.style.opacity || 0) - dt * 0.8); }
  // timers
  P.grenCd = Math.max(0, P.grenCd - dt); P.meleeCd = Math.max(0, P.meleeCd - dt);
  if (P.superT > 0) { P.superT -= dt; if (P.superT <= 0) { P.superT = 0; killfeed('Super ended', '#aaa'); } }
  else addSuper(dt * 0.55);
  if (P.buffs.bloodrushT > 0) { P.buffs.bloodrushT -= dt; if (P.buffs.bloodrushT <= 0) P.buffs.bloodrush = 0; }
  if (P.buffs.overcharge > 0) P.buffs.overcharge -= dt;
  updateWeapon(dt);
  // camera
  camera.position.set(P.pos.x, P.pos.y + EYE, P.pos.z);
  S.shake = Math.max(0, (S.shake || 0) - dt * 1.8); const sh = S.shake * S.shake;
  camera.rotation.set(P.pitch - P.kick + (Math.random() - 0.5) * sh * 0.08, P.yaw + P.kickYaw + (Math.random() - 0.5) * sh * 0.08, 0);
  const zoom = wp[P.slot].zoom || 1.3;
  const fov = 74 / (1 + (zoom - 1) * P.adsK) + (sprinting ? 6 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 12); camera.updateProjectionMatrix(); }
  $('crosshair').classList.toggle('ads', P.adsK > 0.5);
  updateViewmodel(dt, ml > 0.1 && P.onGround, sprinting);
}

// ---------------- Waves ----------------
function waveList(n) {
  const q = [];
  const cs = 1 + (coopCount() - 1) * 0.4; // more players, more enemies
  const sk = Math.round((DEBUG ? 3 : 4 + n * 2) * cs), la = Math.round((DEBUG ? 1 + (n > 1 ? 1 : 0) : 1 + n) * cs), bu = DEBUG ? (n >= 2 ? 1 : 0) + (coopCount() > 2 ? 1 : 0) : Math.floor(n / 2 * cs);
  for (let i = 0; i < sk; i++) q.push('skitter'); for (let i = 0; i < la; i++) q.push('lancer'); for (let i = 0; i < bu; i++) q.push('bulwark');
  // interleave: majors arrive mid-wave
  return q.sort(() => Math.random() - 0.5);
}
function startWave(n) {
  S.wave = n; enemyPower = 100 + (n - 1) * 4;
  if (n === BOSS_WAVE) {
    S.waveQueue = DEBUG ? ['skitter', 'skitter'] : ['skitter', 'skitter', 'skitter', 'lancer', 'lancer'];
    S.waveTotal = 1; S.waveDone = 0; S.bossPending = 2.5;
    banner('THE HOLLOW REGENT', 'Final wave — destroy the boss', 3); sfx.boss();
  } else {
    S.waveQueue = waveList(n); S.waveTotal = S.waveQueue.length; S.waveDone = 0;
    banner(`WAVE ${n} / ${BOSS_WAVE}`, n === 1 ? 'Rift breach detected — hold the ruins' : `Enemy power ✦${enemyPower}`, 2.4); sfx.wave();
  }
  S.spawnT = 1.2;
}
function spawnPoint(minDist = 22) {
  for (let k = 0; k < 30; k++) {
    const a = Math.random() * Math.PI * 2, d = rand(36, ARENA_R - 3);
    const p = new V3(Math.cos(a) * d, 0, Math.sin(a) * d);
    if (Math.hypot(p.x - P.pos.x, p.z - P.pos.z) < minDist) continue;
    pushOut(p, 1.0, 0); p.y = groundAt(p.x, p.z, 0.1); return p;
  }
  return new V3(0, 0, -ARENA_R + 5);
}
function updateWaves(dt) {
  if (S.betweenT > 0) { S.betweenT -= dt; if (S.betweenT <= 0) startWave(S.wave + 1); return; }
  if (S.bossPending > 0) {
    S.bossPending -= dt;
    if (S.bossPending <= 0) {
      const p = spawnPoint(26); const b = spawnEnemy('regent', p); S.boss = b; b.shieldEl = 'flare'; b.shieldMesh.material = shieldMat('flare');
      $('bossbar').classList.remove('hidden'); explosionFx(p.clone().add(new V3(0, 3, 0)), 6, 0xffd04a);
      killfeed(`<b>${b.d.name}</b> has arrived — ${L.ELEMENTS.flare.icon} Flare shield`, '#ffd04a');
    }
  }
  S.spawnT -= dt;
  const alive = enemies.filter(e => !e.dead).length;
  if (S.waveQueue.length && S.spawnT <= 0 && alive < maxAlive()) {
    const type = S.waveQueue.shift(); spawnEnemy(type, spawnPoint());
    S.spawnT = DEBUG ? 0.25 : rand(0.35, 0.8);
    if (type === 'bulwark') killfeed(`⚠ ${EDEF.bulwark.name} incoming`, '#ff3a9a');
  }
  if (S.wave === BOSS_WAVE && S.boss && !S.waveQueue.length && alive < 4) { S.adsT = (S.adsT || 0) + dt; if (S.adsT > 14) { S.adsT = 0; S.waveQueue.push('skitter', 'skitter', 'lancer'); } }
  if (S.wave !== BOSS_WAVE && !S.waveQueue.length && alive === 0 && S.betweenT <= 0) {
    banner('WAVE CLEARED', S.wave + 1 === BOSS_WAVE ? 'Something big is coming…' : 'Next wave in 5s', 2.5); sfx.victory();
    S.best = Math.max(S.best || 0, S.wave); S.betweenT = DEBUG ? 1.5 : 5; P.shield = 100;
  }
}
function onBossDefeated() {
  $('bossbar').classList.add('hidden'); S.victory = true; netSend({ t: 'victory' });
  banner('VICTORY', 'The Regent has fallen — collect your engrams', 4); sfx.victory();
  for (const e of enemies) if (!e.dead) { e.hp = 0; killEnemy(e, {}); }
  S.waveQueue = [];
  setTimeout(() => { if (S.mode === 'play' || S.mode === 'dead') showResults(true); }, 7000);
}

// ---------------- Death / results ----------------
function playerDie() {
  P.dead = true; P.hp = 0; S.mode = 'dead'; input.fire = false;
  if (document.pointerLockElement) document.exitPointerLock();
  $('death').classList.remove('hidden');
  if (coopActive()) { S.coopDown = true; NET.rv = 0; $('deathMsg').innerHTML = `You're down! A teammate can revive you by standing next to you.`; $('deathCount').textContent = '✚'; netSend({ t: 'downed', pid: NET.myPid }); return; }
  if (S.revives > 0) { S.revives--; $('deathMsg').textContent = `Reviving… (${S.revives} revive${S.revives === 1 ? '' : 's'} left after this)`; S.deathT = 5; }
  else { $('deathMsg').textContent = 'No revives left.'; S.deathT = 2.5; S.finalDeath = true; }
}
function updateDeath(dt) {
  if (S.coopDown) { camera.position.set(P.pos.x, P.pos.y + 0.5, P.pos.z); camera.rotation.z = Math.min(0.4, camera.rotation.z + dt * 0.3); return; }
  S.deathT -= dt; $('deathCount').textContent = Math.max(0, Math.ceil(S.deathT));
  camera.position.y = Math.max(P.pos.y + 0.5, camera.position.y - dt); camera.rotation.z = Math.min(0.4, camera.rotation.z + dt * 0.3);
  if (S.deathT <= 0) {
    $('death').classList.add('hidden');
    if (S.finalDeath) { showResults(false); return; }
    P.dead = false; P.hp = 100; P.shield = 100; P.vel.set(0, 0, 0); P.pos.set(0, 1.4, 0); camera.rotation.z = 0; S.mode = 'play';
    for (const e of enemies) if (!e.dead && e.pos.distanceTo(P.pos) < 10) { const a = Math.atan2(e.pos.z, e.pos.x); e.pos.set(Math.cos(a) * 20, 0, Math.sin(a) * 20); }
    for (let i = projectiles.length - 1; i >= 0; i--) if (projectiles[i].owner === 'e') { scene.remove(projectiles[i].spr); projectiles.splice(i, 1); }
    $('vignette').style.opacity = 0; hint('Back in the fight!', 2);
  }
}
function showResults(win) {
  S.mode = 'results'; if (document.pointerLockElement) document.exitPointerLock();
  NET.inRun = false; S.coopDown = false; $('death').classList.add('hidden'); $('partner').classList.add('hidden'); $('revive').classList.add('hidden'); removeRemoteAvatar();
  $('againBtn').disabled = NET.role === 'client' && NET.connected; $('againBtn').textContent = $('againBtn').disabled ? 'WAITING FOR HOST…' : '↻ PLAY AGAIN';
  $('hud').classList.add('hidden'); $('touch').classList.add('hidden');
  const time = Math.round(S.t - S.runStart), acc = S.shots ? Math.round(S.hits / S.shots * 100) : 0;
  const reached = win ? BOSS_WAVE : Math.max(0, S.wave - 1);
  save.best.wave = Math.max(save.best.wave || 0, reached); save.best.kills = Math.max(save.best.kills || 0, S.kills); if (win) save.best.wins = (save.best.wins || 0) + 1; persist();
  $('resTitle').textContent = win ? 'VICTORY' : 'DEFEAT'; $('resTitle').className = win ? '' : 'red';
  const rows = [['Waves cleared', `${reached} / ${BOSS_WAVE}`], ['Kills', S.kills], ['Precision hits', S.crits], ['Accuracy', acc + '%'], ['Engrams collected', S.engrams], ['Time', `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`], ['Power level', '✦ ' + powerLevel()], ['Best wave', save.best.wave], ['Boss kills', save.best.wins || 0]];
  $('resStats').innerHTML = rows.map(([a, b]) => `<span>${a}</span><b>${b}</b>`).join('');
  $('results').classList.remove('hidden');
}

// ---------------- Run lifecycle ----------------
function clearRun() {
  for (const e of enemies) scene.remove(e.mesh); enemies.length = 0;
  for (const p of projectiles) scene.remove(p.spr); projectiles.length = 0;
  for (const z of zones) scene.remove(z.obj); zones.length = 0;
  for (const d of engrams) scene.remove(d.g); engrams.length = 0;
}
function startRun() {
  initAudio(); clearRun();
  Object.assign(S, { mode: 'play', kills: 0, crits: 0, shots: 0, hits: 0, engrams: 0, runStart: S.t, revives: 3, waveQueue: [], betweenT: 0, boss: null, victory: false, finalDeath: false, bossPending: 0, adsT: 0 });
  Object.assign(P, { hp: 100, shield: 100, over: 0, dead: false, slot: 0, reloadT: 0, swapT: 0, fireCd: 0, burstLeft: 0, grenCd: 0, meleeCd: 0, superCharge: DEBUG ? 100 : 0, superT: 0, kick: 0, kickYaw: 0, yaw: 0, pitch: 0 });
  P.pos.set(0, 1.4, 0); P.vel.set(0, 0, 0); P.buffs = { bloodrush: 0, bloodrushT: 0, overcharge: 0, lastKill: -99 };
  camera.rotation.z = 0;
  loadWeapons(true);
  ['title', 'results', 'pause', 'death', 'inv', 'help'].forEach(id => $(id).classList.add('hidden'));
  $('hud').classList.remove('hidden'); $('bossbar').classList.add('hidden');
  if (IS_TOUCH && !PAD.active) $('touch').classList.remove('hidden');
  setAbilityColors(); setPrompts();
  S.coopDown = false; NET.rv = 0; NET.slams.length = 0; NET.dmgQ.clear();
  NET.inRun = NET.connected && NET.players.size > 0;
  for (const R of NET.players.values()) { R.down = false; R.lastT = S.t; }
  if (NET.role === 'host' && NET.inRun) netSend({ t: 'start', wave: START_WAVE > 1 ? Math.min(START_WAVE, BOSS_WAVE) : 1 });
  if (NET.role !== 'client' || !NET.connected) startWave(START_WAVE > 1 ? Math.min(START_WAVE, BOSS_WAVE) : 1);
  else { S.wave = 1; banner('CO-OP', `Fireteam of ${1 + NET.players.size}`, 2); }
  if (PAD.active) hint(PAD.style === 'ps' ? 'R2 fire · L2 aim · ✕ jump · L1 grenade · R1 melee · L1+R1 Super' : 'RT fire · LT aim · A jump · LB grenade · RB melee · LB+RB Super', 5);
  else if (!IS_TOUCH) hint('Click to aim with the mouse · WASD move · Space jump · Q grenade · F super', 5);
  else hint('Left thumb: move · Right thumb: aim · Hold FIRE', 4);
}
function pauseGame() {
  if (S.mode !== 'play') return;
  S.mode = 'pause'; input.fire = false; if (document.pointerLockElement) document.exitPointerLock();
  $('pause').classList.remove('hidden'); $('muteBtn').textContent = isMuted() ? '🔇 SOUND OFF' : '🔊 SOUND ON';
}
function resumeGame() { ['pause', 'inv', 'help'].forEach(id => $(id).classList.add('hidden')); S.mode = 'play'; S.hadLock = false; initAudio(); }
function quitToTitle() { if (NET.role === 'host' && NET.connected) netSend({ t: 'title' }); NET.inRun = false; S.coopDown = false; clearRun(); S.mode = 'title'; ['pause', 'results', 'inv', 'death', 'hud', 'touch', 'help'].forEach(id => $(id).classList.add('hidden')); $('title').classList.remove('hidden'); renderTitle(); }
S.invReturn = null;
function openInventory() {
  if (S.mode === 'play') { S.invReturn = 'play'; S.mode = 'inv'; input.fire = false; if (document.pointerLockElement) document.exitPointerLock(); }
  else S.invReturn = S.mode;
  $('inv').classList.remove('hidden'); invState.slot = invState.slot ?? 0; renderInventory();
}
function closeInventory() {
  $('inv').classList.add('hidden');
  for (const w of save.inv) w.isNew = false; persist();
  if (S.invReturn === 'play') { S.mode = 'play'; loadWeapons(false); S.hadLock = false; }
  else if (S.invReturn === 'pause') S.mode = 'pause';
  if (S.mode === 'title') renderTitle();
}

// ---------------- HUD ----------------
function setAbilityColors() { const c = CLASSES[save.cls]; for (const id of ['abGren', 'abMelee', 'abSuper', 'bSuper']) $(id).style.setProperty('--el', c.color); $('abSuper').querySelector('circle').style.stroke = c.color; }
function renderWeaponHud() {
  const eq = equipped();
  $('weapons').innerHTML = eq.map((w, i) => {
    const r = L.RARITY[w.rarity], el = L.ELEMENTS[w.element];
    const res = P.reserve[i] === Infinity ? '∞' : P.reserve[i];
    return `<div class="wslot ${i === P.slot ? 'on' : ''}" data-i="${i}" style="border-color:${r.color}"><span><span class="nm" style="color:${r.color}">${w.name}</span><br><span class="el" style="color:${el.color}">${el.icon} ${L.ARCH[w.arch].name}</span></span><span class="am">${P.ammo[i]}<small>${res}</small></span></div>`;
  }).join('');
}
$('weapons').addEventListener('click', e => { const s = e.target.closest('.wslot'); if (s) swapTo(+s.dataset.i); });
$('weapons').addEventListener('touchstart', e => { const s = e.target.closest('.wslot'); if (s) { e.preventDefault(); e.stopPropagation(); swapTo(+s.dataset.i); } }, { passive: false });
const radar = $('radar').getContext('2d');
let hudT = 0;
function updateHud(dt) {
  hudT += dt;
  if (hitmarkT > 0) { hitmarkT -= dt; if (hitmarkT <= 0) $('hitmark').className = ''; }
  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) $('banner').classList.remove('on'); }
  if (hintT > 0) { hintT -= dt; if (hintT <= 0) $('hint').textContent = ''; }
  if (hudT < 0.05) return; hudT = 0;
  $('shieldBar').firstElementChild.style.width = clamp((P.shield + P.over) / 100 * 100, 0, 100) + '%';
  $('shieldBar').classList.toggle('over', P.over > 0);
  $('hpBar').firstElementChild.style.width = clamp(P.hp, 0, 100) + '%';
  $('hpNum').textContent = Math.max(0, Math.round(P.hp + P.shield + P.over));
  { const ab = $('ammoBig'), w = wp[P.slot]; ab.querySelector('b').textContent = P.ammo[P.slot]; ab.querySelector('small').textContent = P.reloadT > 0 ? 'RELOADING' : (P.reserve[P.slot] === Infinity ? '∞' : P.reserve[P.slot]) + ' RESERVE'; ab.classList.toggle('low', w && P.ammo[P.slot] <= Math.ceil(w.mag * 0.2)); }
  $('powerTag').textContent = `✦ ${powerLevel()}` + (P.buffs.bloodrush ? `  ·  Bloodrush x${P.buffs.bloodrush}` : '') + (P.buffs.overcharge > 0 ? '  ·  Overcharge' : '');
  const setAb = (id, frac, ready) => { const el = $(id); el.querySelector('circle').style.strokeDashoffset = 107 * (1 - frac); el.classList.toggle('cd', !ready); el.classList.toggle('ready', ready); };
  setAb('abGren', 1 - P.grenCd / GREN_CD, P.grenCd <= 0);
  setAb('abMelee', 1 - P.meleeCd / MELEE_CD, P.meleeCd <= 0);
  setAb('abSuper', P.superT > 0 ? 1 : P.superCharge / 100, P.superCharge >= 100 || P.superT > 0);
  $('bSuper').classList.toggle('ready', P.superCharge >= 100);
  if (IS_TOUCH) { const sc = CLASSES[save.cls].color, f = P.superT > 0 ? 100 : P.superCharge; $('bSuper').style.background = `conic-gradient(${sc}99 ${f}%, #ffffff14 ${f}%)`; $('bSuper').style.opacity = f >= 100 ? 1 : 0.75; }
  $('bGren').style.opacity = P.grenCd <= 0 ? 1 : 0.4; $('bMelee').style.opacity = P.meleeCd <= 0 ? 1 : 0.4;
  // objective
  const alive = enemies.filter(e => !e.dead).length;
  if (S.wave === BOSS_WAVE) { $('objTitle').textContent = 'FINAL WAVE · BOSS'; $('objSub').textContent = S.boss ? `Defeat ${EDEF.regent.name}` : (S.victory ? 'Victory!' : 'The Regent approaches…'); $('objBar').firstElementChild.style.width = S.boss ? (100 - (S.boss.hp / S.boss.maxHp) * 100) + '%' : (S.victory ? '100%' : '0%'); }
  else { const done = S.waveTotal - S.waveQueue.length - alive; $('objTitle').textContent = `RIFT BREACH · WAVE ${S.wave}/${BOSS_WAVE}`; $('objSub').textContent = S.betweenT > 0 ? `Next wave in ${Math.ceil(S.betweenT)}…` : `Hostiles remaining: ${S.waveQueue.length + alive}`; $('objBar').firstElementChild.style.width = clamp(done / S.waveTotal * 100, 0, 100) + '%'; }
  if (S.boss) { $('bossHp').style.width = (S.boss.hp / S.boss.maxHp * 100) + '%'; $('bossShield').style.width = (S.boss.shield / S.boss.maxShield * 100) + '%'; $('bossShield').style.background = L.ELEMENTS[S.boss.shieldEl].color; }
  // radar
  const R = radar, W = 180, cx = 90, cy = 90; R.clearRect(0, 0, W, W);
  R.fillStyle = 'rgba(10,8,24,0.55)'; R.beginPath(); R.arc(cx, cy, 86, 0, Math.PI * 2); R.fill();
  R.strokeStyle = 'rgba(255,255,255,0.25)'; R.lineWidth = 1; for (const rr of [30, 58, 86]) { R.beginPath(); R.arc(cx, cy, rr, 0, Math.PI * 2); R.stroke(); }
  R.fillStyle = 'rgba(255,255,255,0.08)'; R.beginPath(); R.moveTo(cx, cy); R.arc(cx, cy, 86, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); R.fill();
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw), sc = 86 / 42;
  const dot = (x, z, color, size, shape) => { const dx = x - P.pos.x, dz = z - P.pos.z; let u = (dx * rx + dz * rz) * sc, v = (dx * fx + dz * fz) * sc; const l = Math.hypot(u, v); if (l > 84) { u *= 84 / l; v *= 84 / l; } R.fillStyle = color; R.beginPath(); if (shape === 'd') { R.moveTo(cx + u, cy - v - size); R.lineTo(cx + u + size, cy - v); R.lineTo(cx + u, cy - v + size); R.lineTo(cx + u - size, cy - v); } else R.arc(cx + u, cy - v, size, 0, Math.PI * 2); R.fill(); };
  for (const d of engrams) dot(d.pos.x, d.pos.z, d.kind === 'ammo' ? '#9a4dff' : L.RARITY[d.rarity].color, 4, 'd');
  for (const e of enemies) if (!e.dead) dot(e.pos.x, e.pos.z, e.type === 'regent' ? '#ffd04a' : e.type === 'bulwark' ? '#ff3a9a' : '#ff4a3a', e.type === 'regent' ? 7 : e.type === 'bulwark' ? 5 : 3.5);
  R.fillStyle = '#fff'; R.beginPath(); R.moveTo(cx, cy - 7); R.lineTo(cx + 5, cy + 5); R.lineTo(cx - 5, cy + 5); R.fill();
}

// ---------------- Title / class pick ----------------
function renderTitle() {
  $('classPick').innerHTML = Object.entries(CLASSES).map(([k, c]) => `<div class="cls ${save.cls === k ? 'sel' : ''}" data-k="${k}" style="--el:${c.color}"><h3>${L.ELEMENTS[c.el].icon} ${c.name}</h3><p class="k">${c.desc}</p><p>✸ ${c.gren}</p><p class="x">✊ ${c.melee}</p><p>✦ ${c.sup}</p></div>`).join('');
  $('titleStats').innerHTML = `POWER ✦ ${powerLevel()} · BEST WAVE ${save.best.wave || 0}/${BOSS_WAVE} · BOSS KILLS ${save.best.wins || 0} · ${save.inv.length} WEAPONS`;
}
$('classPick').addEventListener('click', e => { const c = e.target.closest('.cls'); if (!c) return; initAudio(); sfx.click(); save.cls = c.dataset.k; persist(); renderTitle(); if (NET.role === 'client') netSend({ t: 'cls', cls: save.cls }); else if (NET.role === 'host') broadcastRoster(); if (PAD.active) setPadFocus($('classPick').querySelector(`[data-k="${save.cls}"]`)); });

// ---------------- Inventory ----------------
const invState = { slot: 0, sel: null };
function cardHtml(w, opts = {}) {
  const r = L.RARITY[w.rarity], el = L.ELEMENTS[w.element];
  const cur = getW(save.equipped[w.slot]);
  const up = !opts.eq && w.power > cur.power ? '<span class="up">▲</span>' : '';
  return `<div class="card ${opts.eq ? 'eq' : ''} ${invState.sel === w.id ? 'sel' : ''}" data-id="${w.id}" style="--r:${r.color}">${w.isNew ? '<span class="new">NEW</span>' : ''}${opts.head ? `<div class="slotHead">${opts.head}</div>` : ''}<div class="t">${w.name}</div><div class="s"><span style="color:${el.color}">${el.icon} ${L.ARCH[w.arch].name}</span><span class="p">${up}✦${w.power}</span></div></div>`;
}
function renderInventory() {
  $('invPower').textContent = `POWER ✦ ${powerLevel()}`;
  const eq = equipped();
  $('invSlots').innerHTML = eq.map((w, i) => `<div data-slot="${i}" style="${invState.slot === i ? 'outline:1px dashed #fff8;outline-offset:2px' : ''}">${cardHtml(w, { eq: true, head: L.SLOT_NAMES[i].toUpperCase() })}</div>`).join('') + `<div class="slotHead" style="margin-top:8px">CLASS</div>` + Object.entries(CLASSES).map(([k, c]) => `<button class="btn small" data-cls="${k}" style="border-color:${save.cls === k ? c.color : '#fff3'};color:${c.color}">${L.ELEMENTS[c.el].icon} ${c.name}</button>`).join('');
  const list = save.inv.filter(w => w.slot === invState.slot).sort((a, b) => b.power - a.power || b.rarity - a.rarity);
  $('invList').innerHTML = list.map(w => cardHtml(w, { eq: save.equipped.includes(w.id) })).join('') || '<p>No weapons</p>';
  const sel = getW(invState.sel) || eq[invState.slot]; invState.sel = sel.id;
  const r = L.RARITY[sel.rarity], el = L.ELEMENTS[sel.element], p = L.weaponParams(sel), isEq = save.equipped.includes(sel.id);
  const statRow = (n, v) => `<div class="stat"><span>${n}</span><i><b style="width:${v}%"></b></i><span>${v}</span></div>`;
  const perkHtml = sel.perks.map(k => { const pk = L.PERKS[k] || L.EXOTIC_PERKS[k]; return `<div class="perk"><b>${L.EXOTIC_PERKS[k] ? '★ ' : ''}${pk.name}</b>${pk.desc}</div>`; }).join('') || '<div class="perk" style="opacity:.6">No perks (Common)</div>';
  $('invDetail').innerHTML = `<div class="det" style="--r:${r.color}"><h3>${sel.name}</h3><div class="sub">${r.name} ${L.ARCH[sel.arch].name} · <span style="color:${el.color}">${el.icon} ${el.name}</span></div>
    <div style="font-size:26px;font-weight:900;color:#ffd970">✦ ${sel.power}</div>
    <div style="opacity:.75;margin:4px 0 8px">${Math.round(p.dmg)} dmg · ${L.ARCH[sel.arch].rpm} rpm · ${p.mag} mag</div>
    <div class="btns" style="margin:0 0 8px">${isEq ? '<button class="btn" disabled style="opacity:.6">EQUIPPED</button>' : `<button class="btn primary" id="eqBtn">EQUIP</button><button class="btn danger" id="disBtn">DISMANTLE</button>`}</div>
    ${statRow('Impact', sel.stats.impact)}${statRow('Range', sel.stats.range)}${statRow('Stability', sel.stats.stability)}${statRow('Handling', sel.stats.handling)}${statRow('Reload', sel.stats.reload)}${statRow('Magazine', sel.stats.mag)}
    ${perkHtml}</div>`;
  const eb = $('eqBtn'); if (eb) eb.onclick = () => { save.equipped[sel.slot] = sel.id; sel.isNew = false; persist(); sfx.pickup(sel.rarity); renderInventory(); };
  const db = $('disBtn'); if (db) db.onclick = () => { save.inv = save.inv.filter(x => x.id !== sel.id); invState.sel = null; persist(); sfx.click(); renderInventory(); };
}
$('inv').addEventListener('click', e => {
  const cl = e.target.closest('[data-cls]'); if (cl) { save.cls = cl.dataset.cls; persist(); setAbilityColors(); renderInventory(); return; }
  const sl = e.target.closest('[data-slot]'); if (sl) { invState.slot = +sl.dataset.slot; invState.sel = save.equipped[invState.slot]; renderInventory(); return; }
  const c = e.target.closest('.card'); if (c) { invState.sel = c.dataset.id; const w = getW(c.dataset.id); invState.slot = w.slot; renderInventory(); }
});
function equipBest() { for (let s = 0; s < 3; s++) { const best = save.inv.filter(w => w.slot === s).sort((a, b) => b.power - a.power || b.rarity - a.rarity)[0]; if (best) save.equipped[s] = best.id; } persist(); renderInventory(); }

// ---------------- Buttons ----------------
const on = (id, fn) => $(id).addEventListener('click', () => { initAudio(); sfx.click(); fn(); });
on('playBtn', startRun); on('againBtn', startRun); on('homeBtn', quitToTitle);
on('gearBtn', openInventory); on('pGearBtn', openInventory); on('rGearBtn', openInventory);
on('invClose', closeInventory); on('bestBtn', equipBest);
on('helpBtn', () => $('help').classList.remove('hidden')); on('pHelpBtn', () => $('help').classList.remove('hidden')); on('helpClose', () => $('help').classList.add('hidden'));
on('resumeBtn', resumeGame); on('quitBtn', quitToTitle);
on('muteBtn', () => { setMuted(!isMuted()); save.muted = isMuted(); persist(); $('muteBtn').textContent = isMuted() ? '🔇 SOUND OFF' : '🔊 SOUND ON'; });
$('sens').value = save.sens || 1; $('sens').addEventListener('input', e => { save.sens = +e.target.value; persist(); });
$('padSens').value = save.padSens || 1; $('padSens').addEventListener('input', e => { save.padSens = +e.target.value; persist(); });
function renderSettings() {
  $('qualBtn').textContent = QNAME.toUpperCase(); $('invBtn').textContent = save.invertY ? 'ON' : 'OFF';
  $('aaBtn').textContent = save.padAA === false ? 'OFF' : 'ON'; $('rumBtn').textContent = save.rumble === false ? 'OFF' : 'ON'; $('sndBtn').textContent = isMuted() ? 'OFF' : 'ON';
}
function openSettings() { renderSettings(); $('settings').classList.remove('hidden'); }
on('setBtn', openSettings); on('pSetBtn', openSettings); on('setClose', () => $('settings').classList.add('hidden'));
on('qualBtn', () => { QNAME = Q_ORDER[(Q_ORDER.indexOf(QNAME) + 1) % 3]; applyQuality(); persist(); renderSettings(); toast(`Graphics: <b>${QNAME.toUpperCase()}</b>`, '#9fdcff'); });
on('invBtn', () => { save.invertY = !save.invertY; persist(); renderSettings(); });
on('aaBtn', () => { save.padAA = save.padAA === false; persist(); renderSettings(); });
on('rumBtn', () => { save.rumble = save.rumble === false; persist(); renderSettings(); if (save.rumble) rumble(0.4, 0.6, 150); });
on('sndBtn', () => { setMuted(!isMuted()); save.muted = isMuted(); persist(); renderSettings(); });
on('coopBtn', openCoop); on('coopClose', () => { $('coop').classList.add('hidden'); renderCoopTag(); });
on('hostBtn', () => { save.name = ($('coopName').value || 'Guardian').trim().slice(0, 12) || 'Guardian'; persist(); hostGame(); });
on('joinBtn', () => { save.name = ($('coopName').value || 'Guardian').trim().slice(0, 12) || 'Guardian'; persist(); joinGame($('joinCode').value); });
on('leaveBtn', () => leaveCoop()); on('readyBtn', toggleReady); on('coopStart', () => { if (NET.role === 'host') { $('coop').classList.add('hidden'); startRun(); } });
$('coopName').addEventListener('input', e => { save.name = e.target.value.trim().slice(0, 12) || 'Guardian'; persist(); });
$('joinCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); });
$('joinCode').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') joinGame(e.target.value); });
$('coopName').addEventListener('keydown', e => e.stopPropagation());

// ---------------- Title backdrop (3D guardian on the dais) ----------------
let titleGuardian = null;
function updateTitleScene(dt) {
  if (!titleGuardian) { titleGuardian = M.buildGuardian(CLASSES[save.cls].hex, { shadows: true }); titleGuardian.group.position.set(0, 1.4, 0); scene.add(titleGuardian.group);
    titleGuardian.aura = glowSprite(CLASSES[save.cls].hex, 3.5, 0.35); titleGuardian.aura.position.set(0, 1.2, 0); titleGuardian.group.add(titleGuardian.aura); }
  const g = titleGuardian; g.group.visible = true;
  if (g.cls !== save.cls) { g.cls = save.cls; M.setGuardianColor(g, CLASSES[save.cls].hex); g.aura.material.color.setHex(CLASSES[save.cls].hex).multiplyScalar(1.6); burst(new V3(0, 2.4, 0), CLASSES[save.cls].hex, 30, 4, 0.8, 2); }
  const a = 0.55 + Math.sin(S.t * 0.05) * 0.18, wide = innerWidth / innerHeight > 1.25, D = wide ? 4.2 : 5.6;
  g.group.rotation.y = a - 0.45 + Math.sin(S.t * 0.3) * 0.08;
  M.animateGuardian(g, dt, 0, { pitch: 0.55 });
  g.rig.pivots.armR.rotation.x = -0.35; g.rig.pivots.armL.rotation.x = -0.2; g.rig.pivots.armL.rotation.z = 0.15;
  const rx = Math.cos(a), rz = -Math.sin(a), off = wide ? 3.1 : 0;
  camera.position.set(Math.sin(a) * D, 2.45 + Math.sin(S.t * 0.2) * 0.05, Math.cos(a) * D);
  camera.lookAt(-rx * off, 2.6, -rz * off); camera.rotation.z = 0;
  if (Math.random() < 0.3) burst(new V3(rand(-0.6, 0.6), 1.5, rand(-0.6, 0.6)), CLASSES[save.cls].hex, 1, 0.6, 1.2, 1.2);
}

// ---------------- Main loop ----------------
const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, fpsCheck = 0, lowFpsStreak = 0;
const fpsLog = [];
const FIXED = params.has('fixedstep'); // test/capture mode: the harness advances time with __game.step()
let frameMs = 0;
function frame() {
  if (FIXED) return;
  requestAnimationFrame(frame);
  tick(Math.min(clock.getDelta(), 0.05));
}
function tick(dt, draw = true) {
  const t0 = performance.now();
  S.t += dt;
  padUpdate(dt);
  netUpdate(dt);
  if (titleGuardian) titleGuardian.group.visible = false;
  if (S.mode === 'play') {
    updatePlayer(dt);
    if (NET.role === 'client') updatePuppets(dt); else { updateWaves(dt); updateEnemies(dt); }
    updateProjectiles(dt); updateDrops(dt); updateCoop(dt);
  } else if (S.mode === 'dead') {
    if (NET.role === 'client') updatePuppets(dt); else { if (coopActive()) updateWaves(dt); updateEnemies(dt); }
    updateProjectiles(dt); updateDrops(dt); updateDeath(dt); updateCoop(dt);
  } else if (S.mode === 'title' || S.mode === 'results') {
    updateTitleScene(dt);
    if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); }
  } else if (coopActive() && (S.mode === 'pause' || S.mode === 'inv')) {
    // the world keeps running during co-op (you can't pause your partner)
    if (NET.role === 'client') updatePuppets(dt); else { updateWaves(dt); updateEnemies(dt); }
    updateProjectiles(dt); updateCoop(dt);
  }
  for (const t of tracers) if (t.life > 0) { t.life -= dt; t.l.material.opacity = Math.max(0, t.life / t.max); if (t.life <= 0) t.l.visible = false; }
  for (const b of bolts) if (b.life > 0) { b.life -= dt; b.l.material.opacity = Math.max(0, b.life / b.max); }
  updateExplosions(dt); updateDecals(dt); updateDying(dt); M.tickBeams(S.t);
  updateParticles(dt); updateDmgNumbers(dt);
  world.update(dt, S.t, camera);
  if (S.mode === 'play' || S.mode === 'dead') updateHud(dt);
  const showVm = S.mode === 'play' || ((S.mode === 'pause' || S.mode === 'inv') && S.invReturn !== 'title');
  vmCam.aspect = camera.aspect; vmCam.updateProjectionMatrix();
  if (!draw) {} else if (Qs.post) {
    if (!post) { post = createPost(renderer, scene, camera, vmScene, vmCam); resize(); }
    post.vp.enabled = showVm;
    post.grade.uniforms.uTime.value = S.t % 100;
    post.grade.uniforms.uHurt.value = S.mode === 'play' || S.mode === 'dead' ? clamp(1 - P.hp / 100, 0, 1) * (S.t - P.lastHit < 3 ? 1 : 0.5) : 0;
    post.composer.render(dt);
  } else {
    renderer.autoClear = true;
    renderer.render(scene, camera);
    if (showVm) { renderer.autoClear = false; renderer.clearDepth(); renderer.render(vmScene, vmCam); }
  }
  // dynamic resolution (and, if that is not enough, quality) to protect frame rate on phones
  fpsAcc += dt; fpsN++; fpsCheck += dt;
  if (fpsCheck > 2.5) {
    const fps = fpsN / fpsAcc; S.fps = Math.round(fps); fpsLog.push(S.fps); if (fpsLog.length > 60) fpsLog.shift();
    if (FIXED) {} else if (fps < 48 && pixelRatio > 0.75) { pixelRatio = Math.max(0.75, pixelRatio - 0.15); renderer.setPixelRatio(pixelRatio); resize(); }
    else if (fps > 58 && pixelRatio < prCap() - 0.1 && S.mode === 'play') { pixelRatio += 0.1; renderer.setPixelRatio(pixelRatio); resize(); }
    if (S.mode === 'play' && fps < 34 && pixelRatio <= 0.8 && AUTO_Q && !FIXED) { if (++lowFpsStreak >= 2 && QNAME !== 'low') { QNAME = Q_ORDER[Q_ORDER.indexOf(QNAME) - 1]; applyQuality(); toast(`Graphics lowered to <b>${QNAME.toUpperCase()}</b> for smoother play`, '#9fdcff'); lowFpsStreak = 0; } } else lowFpsStreak = 0;
    fpsAcc = 0; fpsN = 0; fpsCheck = 0;
  }
  frameMs = frameMs * 0.9 + (performance.now() - t0) * 0.1;
}
const AUTO_Q = !params.get('q');


// ==== COOP_START ====
// ---------------- Online co-op: up to 4 players (PeerJS / WebRTC, star topology, host-authoritative) ----------------
// Host = player 0. Joiners connect only to the host; the host relays player state between joiners.
const NET = { role: null, connected: false, inRun: false, peer: null, conn: null, links: new Map(), players: new Map(), myPid: 0, ready: false, code: '', sendT: 0, snapT: 0, dmgQ: new Map(), shotsQ: [], slams: [], joinTimer: 0, rv: 0 };
const MAX_PLAYERS = 4;
const PCOLORS = ['#ffd970', '#7fd8ff', '#7fffb0', '#ff8ad8'];
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }] };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TYPES = ['skitter', 'lancer', 'bulwark', 'regent'], ELS = ['flare', 'storm', 'abyss'], STATES = ['move', 'tele', 'fire', 'shove', 'volley', 'slam', 'summon'];
const r2 = v => Math.round(v * 100) / 100;
function coopActive() { return NET.connected && NET.inRun && NET.players.size > 0; }
function coopCount() { return coopActive() ? 1 + NET.players.size : 1; }
function maxAlive() { return MAX_ALIVE + (coopCount() - 1) * 3; }
// messaging: joiner -> host; host -> everyone (or one player / everyone but one)
function rawSend(c, m) { if (c && c.open) { try { c.send(m); } catch (e) {} } }
function netSend(m) { if (!NET.connected) return; if (NET.role === 'client') rawSend(NET.conn, m); else if (NET.role === 'host') for (const c of NET.links.values()) rawSend(c, m); }
function sendTo(pid, m) { if (NET.role === 'host') rawSend(NET.links.get(pid), m); }
function relay(fromPid, m) { if (NET.role !== 'host') return; for (const [pid, c] of NET.links) if (pid !== fromPid) rawSend(c, m); }
function coopStatus(t) { const el = $('coopStatus'); if (el) el.innerHTML = t; renderCoopTag(); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function myName() { return (save.name || 'Guardian').slice(0, 12); }
function newCode() { let c = ''; for (let i = 0; i < 5; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return c; }
function hasPeerLib() { if (typeof window.Peer !== 'function') { coopStatus('Co-op library failed to load.'); return false; } return true; }
function roster() { const list = [{ pid: NET.myPid, name: myName(), cls: save.cls, ready: NET.role === 'host' ? true : NET.ready }]; for (const p of NET.players.values()) list.push({ pid: p.pid, name: p.name, cls: p.cls, ready: p.ready }); return list.sort((a, b) => a.pid - b.pid); }
function renderRoster() {
  const html = roster().map(p => `<div class="rrow"><i style="background:${PCOLORS[p.pid]}"></i><b style="color:${PCOLORS[p.pid]}">${escapeHtml(p.name)}${p.pid === NET.myPid ? ' <small>(you)</small>' : ''}</b><span style="color:${CLASSES[p.cls]?.color || '#fff'}">${L.ELEMENTS[CLASSES[p.cls]?.el || 'flare'].icon} ${CLASSES[p.cls]?.name || ''}</span><em>${p.pid === 0 ? 'HOST' : p.ready ? '✓ READY' : '… NOT READY'}</em></div>`).join('');
  const r = $('coopRoster'); if (r) { r.innerHTML = NET.connected || NET.role === 'host' ? html : ''; }
  $('readyBtn').classList.toggle('hidden', !(NET.role === 'client' && NET.connected)); $('readyBtn').textContent = NET.ready ? '✓ READY' : 'READY UP';
  $('coopStart').classList.toggle('hidden', NET.role !== 'host');
  $('coop').classList.toggle('hosting', NET.role === 'host'); $('coop').classList.toggle('joined', NET.role === 'client' && NET.connected);
  const hs = $('hostCode').querySelector('small'); if (hs) hs.textContent = NET.players.size ? `${1 + NET.players.size}/${MAX_PLAYERS} players — deploy whenever you're ready` : 'Waiting for players to join (up to 3)…';
  return html;
}
function renderCoopTag() {
  const tag = $('coopTag'); if (!tag) return;
  const n = 1 + NET.players.size;
  if (NET.connected && NET.players.size) { tag.classList.remove('hidden'); tag.innerHTML = `👥 Fireteam ${n}/${MAX_PLAYERS}: ` + roster().map(p => `<b style="color:${PCOLORS[p.pid]}">${escapeHtml(p.name)}</b>${p.pid !== 0 ? (p.ready ? ' ✓' : ' …') : ''}`).join(' · ') + (NET.role === 'host' ? ' — press DEPLOY' : ' — waiting for host'); }
  else if (NET.role === 'host' && NET.code) { tag.classList.remove('hidden'); tag.innerHTML = `👥 Hosting · room code <b>${NET.code}</b> · waiting for players (up to 3)`; }
  else tag.classList.add('hidden');
  $('playBtn').disabled = NET.role === 'client' && NET.connected; $('playBtn').style.opacity = $('playBtn').disabled ? 0.5 : 1;
  renderRoster();
}
function makePlayer(pid, name, cls) {
  let p = NET.players.get(pid);
  if (!p) { p = { pid, name: 'Guardian', cls: 'flare', ready: false, pos: new V3(0, 1.4, 0), tpos: new V3(0, 1.4, 0), yaw: 0, tyaw: 0, pitch: 0, hp: 100, down: false, rv: 0, lastT: S.t }; NET.players.set(pid, p); }
  if (name) p.name = String(name).slice(0, 12); if (cls && CLASSES[cls]) { if (p.av && p.cls !== cls) M.setGuardianColor(p.av, CLASSES[cls].hex); p.cls = cls; }
  return p;
}
function removePlayer(pid) { const p = NET.players.get(pid); if (!p) return; if (p.av) scene.remove(p.av.group); NET.players.delete(pid); }
function leaveCoop(silent = false) {
  netSend({ t: 'bye' });
  try { NET.conn && NET.conn.close(); } catch {} for (const c of NET.links.values()) try { c.close(); } catch {}
  try { NET.peer && NET.peer.destroy(); } catch {}
  for (const pid of [...NET.players.keys()]) removePlayer(pid);
  Object.assign(NET, { role: null, connected: false, inRun: false, peer: null, conn: null, code: '', myPid: 0, ready: false }); NET.links.clear();
  $('hostCode').classList.add('hidden'); if (!silent) coopStatus('Left co-op.'); renderCoopTag();
}
function hostGame() {
  if (!hasPeerLib()) return; leaveCoop(true);
  NET.role = 'host'; NET.myPid = 0; NET.code = newCode();
  coopStatus('Creating room…');
  const peer = new window.Peer('smv-' + NET.code.toLowerCase(), { config: ICE, debug: 1 }); NET.peer = peer;
  peer.on('open', () => { NET.connected = true; $('hostCode').classList.remove('hidden'); $('hostCode').querySelector('b').textContent = NET.code; coopStatus('Share this code — up to 3 friends can join.'); });
  peer.on('connection', c => {
    c.on('open', () => {
      let pid = 0; for (let i = 1; i < MAX_PLAYERS; i++) if (!NET.links.has(i)) { pid = i; break; }
      if (!pid) { rawSend(c, { t: 'full' }); setTimeout(() => c.close(), 300); return; }
      if (NET.inRun) { rawSend(c, { t: 'busy' }); setTimeout(() => c.close(), 300); return; }
      NET.links.set(pid, c); c.pid = pid;
      c.on('data', m => onHostData(pid, m));
      c.on('close', () => hostLostPlayer(pid));
      c.on('error', () => {});
    });
  });
  peer.on('error', err => { if (err.type === 'unavailable-id') { hostGame(); return; } coopStatus(err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' ? 'Can’t reach the co-op server. Check your internet.' : 'Co-op error: ' + escapeHtml(err.type || err.message)); });
}
function joinGame(code) {
  if (!hasPeerLib()) return;
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 4) { coopStatus('Enter the 5-character room code.'); return; }
  leaveCoop(true); NET.role = 'client'; NET.code = code;
  coopStatus('Connecting to room ' + code + '…');
  const peer = new window.Peer({ config: ICE, debug: 1 }); NET.peer = peer;
  peer.on('open', () => {
    const c = peer.connect('smv-' + code.toLowerCase(), { reliable: true, serialization: 'json' }); NET.conn = c;
    c.on('open', () => { NET.connected = true; clearTimeout(NET.joinTimer); rawSend(c, { t: 'hello', name: myName(), cls: save.cls, v: 3 }); coopStatus('Connected! Waiting for the host…'); sfx.pickup(2); });
    c.on('data', onClientData); c.on('close', clientLostHost); c.on('error', () => {});
  });
  peer.on('error', err => { coopStatus(err.type === 'peer-unavailable' ? 'No game found with code <b>' + code + '</b>.' : err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' ? 'Can’t reach the co-op server. Check your internet.' : 'Co-op error: ' + escapeHtml(err.type || err.message)); if (!NET.connected) NET.role = null; });
  clearTimeout(NET.joinTimer); NET.joinTimer = setTimeout(() => { if (!NET.connected && NET.role === 'client') coopStatus('Couldn’t connect. Try again — some cellular or strict networks block direct connections.'); }, 15000);
}
function broadcastRoster() { netSend({ t: 'roster', players: roster() }); renderCoopTag(); }
// ---- host side
function onHostData(pid, m) {
  if (!m || typeof m !== 'object') return;
  const p = NET.players.get(pid);
  switch (m.t) {
    case 'hello': { makePlayer(pid, m.name, m.cls); sendTo(pid, { t: 'welcome', pid, players: roster(), code: NET.code }); broadcastRoster(); toast(`👥 <b>${escapeHtml(NET.players.get(pid).name)}</b> joined`, PCOLORS[pid]); sfx.pickup(2); coopStatus(`${1 + NET.players.size}/${MAX_PLAYERS} players in the room. Press DEPLOY when ready.`); break; }
    case 'ready': if (p) { p.ready = !!m.r; broadcastRoster(); } break;
    case 'cls': if (p) { makePlayer(pid, null, m.cls); broadcastRoster(); } break;
    case 'st': if (p) { m.pid = pid; onPlayerState(m); relay(pid, m); } break;
    case 'dmg': for (const [id, amt, crit, el] of m.d) { const e = enemies.find(x => x.id === id); if (e && !e.dead) damageEnemy(e, amt, { crit: !!crit, element: ELS[el] || 'kinetic', by: pid, silent: true }); } break;
    case 'fx': m.pid = pid; onFx(m); relay(pid, m); break;
    case 'downed': case 'revived': case 'emote': m.pid = pid; onPlayerEvent(m); relay(pid, m); break;
    case 'bye': hostLostPlayer(pid); break;
  }
}
function hostLostPlayer(pid) {
  const c = NET.links.get(pid); if (!c && !NET.players.has(pid)) return;
  NET.links.delete(pid); try { c && c.close(); } catch {}
  const p = NET.players.get(pid), name = p ? p.name : 'A player';
  removePlayer(pid); netSend({ t: 'left', pid }); broadcastRoster();
  if (S.mode !== 'title' && NET.inRun) { killfeed(`<b>${escapeHtml(name)}</b> left the fireteam`, '#ffb070'); if (!NET.players.size) toast('Everyone else left — continuing <b>solo</b>', '#ffb070'); }
  else toast(`${escapeHtml(name)} left the room`, '#ffb070');
  coopStatus(`${1 + NET.players.size}/${MAX_PLAYERS} players in the room.`);
}
// ---- joiner side
function onClientData(m) {
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'welcome': NET.myPid = m.pid; applyRoster(m.players); coopStatus(`Joined as player ${m.pid + 1}. Press READY, then wait for the host to deploy.`); break;
    case 'roster': applyRoster(m.players); break;
    case 'full': coopStatus('That room is full (4 players max).'); leaveCoop(true); break;
    case 'busy': coopStatus('That fireteam is mid-run — ask the host to return to the title screen.'); leaveCoop(true); break;
    case 'start': ['coop', 'settings', 'help', 'inv', 'results'].forEach(id => $(id).classList.add('hidden')); startRun(); S.wave = m.wave || 1; break;
    case 'title': if (S.mode !== 'title') { NET.inRun = false; quitToTitle(); toast('Host returned to the title screen', '#9fdcff'); } break;
    case 'st': onPlayerState(m); break;
    case 'snap': onSnapshot(m); break;
    case 'kill': { const e = enemies.find(x => x.id === m.id); if (e && !e.dead) { e.dead = true; e.hp = 0; startDeathFx(e); if (m.by === NET.myPid) killCredit(e, { crit: !!m.crit, weapon: curW(), c: centerPos(e) }); } break; }
    case 'drop': { const p = new V3(...m.p); if (m.k === 'e') dropEngram(p, m.r); else dropAmmo(p); break; }
    case 'eshot': spawnProjectile({ pos: new V3(...m.p), vel: new V3(...m.v), owner: 'e', dmg: m.d * enemyDmgMult() / Math.max(0.01, m.m || 1), color: m.c, size: m.s, core: 0xffffff, coreSize: m.cs, splash: m.sp, element: m.el, life: 3, r: m.r, trail: Qs.particles > 0.6 ? m.c : 0 }); break;
    case 'slam': { const p = new V3(...m.p); NET.slams.push({ tg: makeTelegraph(p, m.r, m.dur), p }); sfx.telegraph(); break; }
    case 'hurt': damagePlayer(m.a, m.f ? new V3(...m.f) : null); break;
    case 'fx': onFx(m); break;
    case 'banner': banner(m.text, m.sub, m.dur); break;
    case 'victory': S.victory = true; $('bossbar').classList.add('hidden'); banner('VICTORY', 'The Regent has fallen — collect your engrams', 4); sfx.victory(); setTimeout(() => { if (S.mode === 'play' || S.mode === 'dead' || S.mode === 'pause' || S.mode === 'inv') showResults(true); }, 7000); break;
    case 'fail': if (S.mode !== 'results') { S.finalDeath = true; showResults(false); } break;
    case 'downed': case 'revived': case 'emote': onPlayerEvent(m); break;
    case 'bye': clientLostHost(); break;
    case 'left': { const p = NET.players.get(m.pid); if (p) { if (NET.inRun) killfeed(`<b>${escapeHtml(p.name)}</b> left the fireteam`, '#ffb070'); removePlayer(m.pid); } renderCoopTag(); break; }
  }
}
function applyRoster(list) {
  const keep = new Set();
  for (const r of list) { if (r.pid === NET.myPid) continue; keep.add(r.pid); const p = makePlayer(r.pid, r.name, r.cls); p.ready = !!r.ready; }
  for (const pid of [...NET.players.keys()]) if (!keep.has(pid)) removePlayer(pid);
  renderCoopTag();
}
function clientLostHost() {
  if (NET.role !== 'client') return;
  const inRun = NET.inRun && S.mode !== 'title';
  for (const pid of [...NET.players.keys()]) removePlayer(pid);
  try { NET.peer && NET.peer.destroy(); } catch {}
  Object.assign(NET, { role: null, connected: false, inRun: false, conn: null, peer: null, myPid: 0, ready: false });
  $('partner').classList.add('hidden'); $('revive').classList.add('hidden');
  if (inRun) {
    // keep playing solo: the mirrored enemies become real, locally simulated enemies
    S.waveQueue = []; S.waveTotal = Math.max(1, enemies.filter(e => !e.dead).length); S.waveDone = 0;
    for (const e of enemies) { e.state = 'move'; e.atkCd = rand(0.5, 1.5); e.stT = 0; e.tele = null; e.puppet = false; }
    if (S.wave === BOSS_WAVE && !S.boss) S.boss = enemies.find(e => e.type === 'regent' && !e.dead) || null;
    toast('Host disconnected — continuing <b>solo</b>', '#ffb070'); killfeed('Host left · solo mode', '#ffb070');
    if (P.dead && S.coopDown) { S.coopDown = false; S.deathT = 3; $('deathMsg').textContent = 'Fireteam gone — reviving…'; }
  } else toast('Lost connection to the host', '#ffb070');
  coopStatus('Disconnected from host.'); renderCoopTag();
}
// ---- shared handlers
function onPlayerState(m) {
  const R = NET.players.get(m.pid); if (!R) return;
  R.tpos.set(m.p[0], m.p[1], m.p[2]); R.tyaw = m.y; R.pitch = m.pi; R.hp = m.hp; R.sh = m.sh; R.firing = !!m.f; R.rv = m.rv || 0; R.lastT = S.t; R.lastMs = performance.now();
  if (m.c && m.c !== R.cls && CLASSES[m.c]) makePlayer(m.pid, null, m.c);
  R.down = !!m.dn;
  if (m.s) for (const s of m.s) tracer(new V3(s[0], s[1], s[2]), new V3(s[3], s[4], s[5]), s[6], 0.06);
}
function onPlayerEvent(m) {
  const R = NET.players.get(m.pid); if (!R) return;
  if (m.t === 'downed') { R.down = true; killfeed(`<b style="color:${PCOLORS[m.pid]}">${escapeHtml(R.name)}</b> is down — stand next to them to revive`, '#ff8a7a'); }
  else if (m.t === 'revived') { R.down = false; killfeed(`<b style="color:${PCOLORS[m.pid]}">${escapeHtml(R.name)}</b> is back up!`, '#7fffb0'); }
  else if (m.t === 'emote') showEmote(R, m.k);
}
function onFx(m) { if (m.k === 'ex') explosionFx(new V3(...m.p), m.r, m.c, true); else if (m.k === 'bolt') boltLocal(new V3(...m.a), new V3(...m.b), m.c); }
// host -> joiners: world snapshot
function sendSnapshot() {
  const e = enemies.filter(x => !x.dead).map(x => [x.id, TYPES.indexOf(x.type), r2(x.pos.x), r2(x.pos.y), r2(x.pos.z), r2(x.yaw), Math.round(x.hp), Math.round(x.maxHp), Math.round(x.shield), Math.round(x.maxShield), ELS.indexOf(x.shieldEl), STATES.indexOf(x.state), x.phase, r2(x.muzzle ? x.muzzle.scale.x : 0), r2(x.moveK || 0), x.tele ? r2(Math.min(1, x.tele.t / x.tele.dur)) : 0]);
  netSend({ t: 'snap', e, w: [S.wave, S.waveQueue.length, S.waveTotal, r2(S.betweenT), S.boss ? S.boss.id : 0, S.victory ? 1 : 0, enemyPower] });
}
function onSnapshot(m) {
  const [wave, q, tot, bt, bossId, vic, ep] = m.w;
  S.wave = wave; S.waveQueue = new Array(q).fill('x'); S.waveTotal = tot; S.betweenT = bt; enemyPower = ep;
  const seen = new Set();
  for (const a of m.e) {
    const [id, ti, x, y, z, yaw, hp, mhp, sh, msh, el, st, ph, muz, mk, tk] = a; seen.add(id);
    let e = enemies.find(o => o.id === id);
    if (!e) { e = spawnEnemy(TYPES[ti], new V3(x, y, z)); e.id = id; e.yaw = yaw; e.puppet = true; e.tpos = new V3(x, y, z); }
    if (e.dead) continue;
    e.tpos.set(x, y, z); e.tyaw = yaw; e.hp = hp; e.maxHp = mhp; e.shield = sh; e.maxShield = msh;
    const se = ELS[el]; if (se && se !== e.shieldEl) { e.shieldEl = se; if (e.shieldMesh) e.shieldMesh.material = shieldMat(se); }
    e.state = STATES[st] || 'move'; if (ph === 2 && e.phase !== 2) { e.phase = 2; M.setEnemyGlowColor(e.rig, 0xff3a2a); } e.moveK = mk; e.teleK = tk;
    if (e.muzzle) e.muzzle.scale.setScalar(Math.max(0.01, muz));
  }
  for (const e of enemies) if (!e.dead && e.puppet && !seen.has(e.id)) { e.dead = true; scene.remove(e.mesh); }
  const boss = bossId ? enemies.find(o => o.id === bossId) : null;
  if (boss && S.boss !== boss) { S.boss = boss; $('bossbar').classList.remove('hidden'); }
  if (!boss && S.boss && !S.victory) S.boss = null;
  if (vic) S.victory = true;
}
function updatePuppets(dt) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.dead) { enemies.splice(i, 1); continue; }
    e.anim += dt;
    if (e.tpos) e.pos.lerp(e.tpos, Math.min(1, dt * 12));
    let dy = (e.tyaw ?? e.yaw) - e.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2; e.yaw += dy * Math.min(1, dt * 10);
    if (e.burnT > 0) { e.burnT -= dt; netQueueDamage(e, 28 * dt, false, 'flare'); if (Math.random() < 0.4) burst(centerPos(e), 0xff7a2a, 1, 1.5, 0.4, 2); }
    e.mesh.position.copy(e.pos); e.mesh.rotation.y = e.yaw;
    e.tele = e.teleK ? { t: e.teleK, dur: 1 } : null;
    visualEnemy(e, dt);
  }
  for (let i = NET.slams.length - 1; i >= 0; i--) {
    const s = NET.slams[i], tg = s.tg; tg.t += dt; const k = Math.min(1, tg.t / tg.dur); tg.disc.scale.setScalar(tg.r * k); tg.ring.material.opacity = 0.5 + Math.sin(tg.t * 25) * 0.4;
    if (tg.t >= tg.dur) { explosionFx(tg.g.position, tg.r, 0xff4a2a, true); sfx.explode(true); const d = Math.hypot(P.pos.x - tg.g.position.x, P.pos.z - tg.g.position.z); if (d < tg.r && P.pos.y - tg.g.position.y < 2.5) { damagePlayer(45 * enemyDmgMult(), tg.g.position); P.vel.y = 7; P.onGround = false; } scene.remove(tg.g); NET.slams.splice(i, 1); }
  }
  if (S.boss && S.boss.dead) S.boss = null;
}
function netQueueDamage(e, amount, crit, element) {
  const k = e.id + ':' + element; const q = NET.dmgQ.get(k);
  if (q) { q[1] += amount; q[2] = q[2] || crit; } else NET.dmgQ.set(k, [e.id, amount, crit ? 1 : 0, ELS.indexOf(element)]);
}
function netOnKill(e, by, crit) { if (NET.role === 'host' && NET.connected) netSend({ t: 'kill', id: e.id, by: by === 'local' ? 0 : by, crit: crit ? 1 : 0 }); }
function netEnemyShot(pr) { if (NET.role === 'host' && coopActive()) netSend({ t: 'eshot', p: [r2(pr.pos.x), r2(pr.pos.y), r2(pr.pos.z)], v: [r2(pr.vel.x), r2(pr.vel.y), r2(pr.vel.z)], d: pr.dmg, m: enemyDmgMult(), c: pr.color, s: pr.size, cs: pr.coreSize, sp: pr.splash, el: pr.element, r: pr.r }); }
function netShot(a, b, color) { if (coopActive() && NET.shotsQ.length < 8) NET.shotsQ.push([r2(a.x), r2(a.y), r2(a.z), r2(b.x), r2(b.y), r2(b.z), color]); }
function netFx(k, a, b, c) {
  if (!coopActive()) return;
  if (k === 'ex') netSend({ t: 'fx', k, p: [r2(a.x), r2(a.y), r2(a.z)], r: b, c, pid: NET.myPid });
  else if (k === 'bolt' && !netFx.inBolt) netSend({ t: 'fx', k, a: [r2(a.x), r2(a.y), r2(a.z)], b: [r2(b.x), r2(b.y), r2(b.z)], c, pid: NET.myPid });
}
function boltLocal(a, b, c) { netFx.inBolt = true; try { bolt(a, b, c); } finally { netFx.inBolt = false; } }
// enemy targeting (host): nearest standing player; returns pid (null = local host player)
function pickTarget(x, z) {
  let best = P.dead ? Infinity : Math.hypot(P.pos.x - x, P.pos.z - z), pid = null;
  if (coopActive()) for (const p of NET.players.values()) { if (p.down || !p.av) continue; const d = Math.hypot(p.pos.x - x, p.pos.z - z); if (d < best) { best = d; pid = p.pid; } }
  return pid;
}
function netHurtRemote(pid, amt, from) { sendTo(pid, { t: 'hurt', a: amt, f: from ? [r2(from.x), r2(from.y), r2(from.z)] : null }); }
function netUpdate(dt) {
  if (!NET.connected) return;
  NET.sendT -= dt; NET.snapT -= dt;
  if (NET.inRun && NET.sendT <= 0) {
    NET.sendT = 0.05; // 20 Hz player state
    netSend({ t: 'st', pid: NET.myPid, p: [r2(P.pos.x), r2(P.pos.y), r2(P.pos.z)], y: r2(P.yaw), pi: r2(P.pitch), hp: Math.round(P.hp), sh: Math.round(P.shield), dn: P.dead ? 1 : 0, f: input.fire ? 1 : 0, c: save.cls, rv: r2(NET.rv), s: NET.shotsQ.length ? NET.shotsQ.splice(0) : undefined });
    if (NET.role === 'client' && NET.dmgQ.size) { netSend({ t: 'dmg', d: [...NET.dmgQ.values()].map(q => [q[0], r2(q[1]), q[2], q[3]]) }); NET.dmgQ.clear(); }
  }
  if (NET.role === 'host' && NET.inRun && NET.snapT <= 0 && NET.links.size) { NET.snapT = 1 / 15; sendSnapshot(); } // 15 Hz world snapshot
}
// ---- teammate avatars, revive, fail state
function ensureAvatar(R) {
  if (R.av) return;
  R.av = M.buildGuardian(CLASSES[R.cls].hex, { shadows: Qs.shadows }); scene.add(R.av.group);
  R.tag = M.nameTag(R.name, PCOLORS[R.pid]); R.tag.position.y = 2.35; R.av.group.add(R.tag);
  R.beacon = glowSprite(0x7fffb0, 2.2, 0); R.beacon.position.y = 0.6; R.av.group.add(R.beacon);
  R.ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(PCOLORS[R.pid]).multiplyScalar(1.6), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })); R.ring.rotation.x = -Math.PI / 2; R.ring.position.y = 0.05; R.av.group.add(R.ring);
  R.pos.copy(R.tpos);
}
function removeRemoteAvatar() { for (const R of NET.players.values()) if (R.av) { scene.remove(R.av.group); R.av = null; } }
const REVIVE_R = 2.6, REVIVE_T = 2.5;
function updateCoop(dt) {
  if (!coopActive()) { $('partner').classList.add('hidden'); $('revive').classList.add('hidden'); return; }
  let rows = '', nearDown = null, nearDownD = Infinity, anyHelper = false;
  for (const R of NET.players.values()) {
    ensureAvatar(R);
    const prev = R.pos.clone(); R.pos.lerp(R.tpos, Math.min(1, dt * 12));
    let dy = R.tyaw - R.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2; R.yaw += dy * Math.min(1, dt * 12);
    const sp = prev.distanceTo(R.pos) / Math.max(dt, 1e-3);
    R.av.group.position.copy(R.pos); R.av.group.rotation.y = R.yaw + Math.PI;
    M.animateGuardian(R.av, dt, Math.min(1, sp / 6), { pitch: R.pitch, down: R.down, firing: R.firing });
    R.beacon.material.opacity = R.down ? 0.6 + Math.sin(S.t * 6) * 0.3 : 0; R.tag.position.y = R.down ? 1.0 : 2.35;
    const d = Math.hypot(P.pos.x - R.pos.x, P.pos.z - R.pos.z);
    if (R.down && d < nearDownD) { nearDownD = d; nearDown = R; }
    if (!R.down && d < REVIVE_R) anyHelper = true;
    rows += `<div class="prow"><div class="pname" style="color:${PCOLORS[R.pid]}">${escapeHtml(R.name)} <small style="color:${CLASSES[R.cls].color}">${L.ELEMENTS[CLASSES[R.cls].el].icon}</small></div><div class="pbar"><i style="width:${clamp(R.hp, 0, 100)}%"></i></div>${R.down ? '<div class="pstate">DOWN — GO REVIVE</div>' : ''}</div>`;
    if (NET.role === 'host' && R.lastMs && performance.now() - R.lastMs > 20000) { hostLostPlayer(R.pid); return; } // silent for 20s: treat as gone
  }
  const pw = $('partner'); pw.classList.remove('hidden'); if (pw._h !== rows) { pw.innerHTML = rows; pw._h = rows; }
  // revive: the downed player's own device measures distance to standing teammates and fills the bar
  const rv = $('revive');
  if (P.dead && S.coopDown) {
    if (anyHelper) NET.rv = Math.min(1, NET.rv + dt / REVIVE_T); else NET.rv = Math.max(0, NET.rv - dt * 0.5);
    rv.classList.toggle('hidden', NET.rv <= 0); rv.querySelector('circle').style.strokeDashoffset = 107 * (1 - NET.rv); rv.querySelector('span').textContent = 'BEING REVIVED…';
    if (NET.rv >= 1) reviveSelf();
  } else if (nearDown && !P.dead) {
    const near = nearDownD < REVIVE_R;
    rv.classList.toggle('hidden', !near && (nearDown.rv || 0) <= 0); rv.querySelector('circle').style.strokeDashoffset = 107 * (1 - (nearDown.rv || 0)); rv.querySelector('span').textContent = near ? 'REVIVING ' + nearDown.name.toUpperCase() + '…' : 'MOVE CLOSER TO REVIVE ' + nearDown.name.toUpperCase();
  } else rv.classList.add('hidden');
  // the run fails only when every player is down (host decides)
  if (NET.role === 'host' && P.dead && S.coopDown && [...NET.players.values()].every(p => p.down) && S.mode !== 'results') { netSend({ t: 'fail' }); S.finalDeath = true; showResults(false); }
}
function reviveSelf() {
  NET.rv = 0; S.coopDown = false; P.dead = false; P.hp = 60; P.shield = 50; S.mode = 'play'; camera.rotation.z = 0;
  $('death').classList.add('hidden'); $('revive').classList.add('hidden'); $('vignette').style.opacity = 0;
  burst(P.pos.clone().add(new V3(0, 1, 0)), 0x7fffb0, 40, 6, 0.9, 3); hint('Revived by your fireteam!', 2.5); netSend({ t: 'revived', pid: NET.myPid }); sfx.pickup(3);
}
function showEmote(R, k) { if (!R || !R.av) return; const s = M.nameTag(k === 'wave' ? '👋  Hey!' : String(k).slice(0, 12), '#ffd970'); s.position.y = 2.8; R.av.group.add(s); setTimeout(() => R.av && R.av.group.remove(s), 2200); }
function sendEmote() { if (coopActive()) { netSend({ t: 'emote', k: 'wave', pid: NET.myPid }); hint('You waved 👋', 1.5); } else hint('👋', 1); }
// ---- co-op screen UI
function openCoop() {
  $('coop').classList.remove('hidden'); $('coopName').value = myName(); renderCoopTag();
  if (!$('osk').children.length) {
    $('osk').innerHTML = CODE_CHARS.split('').map(c => `<button data-k="${c}">${c}</button>`).join('') + '<button data-k="DEL" class="wide">⌫ DEL</button><button data-k="OK" class="wide">JOIN ▶</button>';
    $('osk').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const k = b.dataset.k, inp = $('joinCode'); if (k === 'DEL') inp.value = inp.value.slice(0, -1); else if (k === 'OK') joinGame(inp.value); else if (inp.value.length < 5) inp.value += k; sfx.click(); });
  }
}
function toggleReady() { if (NET.role !== 'client' || !NET.connected) return; NET.ready = !NET.ready; netSend({ t: 'ready', r: NET.ready }); renderCoopTag(); }
// closing the tab / app: tell the fireteam right away instead of waiting for the connection to time out
const sayBye = () => { if (NET.connected) netSend({ t: 'bye' }); };
window.addEventListener('pagehide', sayBye); window.addEventListener('beforeunload', sayBye);
// ==== COOP_END ====


// ==== PAD_START ====
// ---------------- Controller mode (Gamepad API, standard mapping) ----------------
// Works with DualSense/DualShock, Xbox, and MFi/Backbone pads on iPhone/iPad Safari, WKWebView and desktop browsers.
const PAD = { active: false, index: null, style: 'xb', id: '', prev: [], held: {}, ax: [0, 0, 0, 0], sprint: false, l1T: -1, r1T: -1, yT: -1, focus: null, navT: 0, navDir: null, lastRumble: 0, gp: null, polledOnce: false };
const BTN = { A: 0, B: 1, X: 2, Y: 3, L1: 4, R1: 5, L2: 6, R2: 7, SELECT: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16 };
const DEAD = 0.12;
function radial(x, y, curve = 1) {
  const m = Math.hypot(x, y); if (m < DEAD) return [0, 0];
  const k = Math.min(1, (m - DEAD) / (1 - DEAD)), c = Math.pow(k, curve) / m; return [x * c, y * c];
}
function padStyle(id) { return /054c|sony|dualsense|dualshock|playstation|wireless controller/i.test(id) && !/xbox|xinput|045e/i.test(id) ? 'ps' : 'xb'; }
function setPrompts() {
  const st = PAD.active ? PAD.style : 'kb';
  for (const el of document.querySelectorAll('.pr')) el.textContent = el.dataset[st] || el.dataset.kb;
  document.body.classList.toggle('padmode', PAD.active); document.body.classList.toggle('pad-ps', PAD.active && PAD.style === 'ps'); document.body.classList.toggle('pad-xb', PAD.active && PAD.style === 'xb');
  const ph = $('padHint'); if (ph) { ph.classList.toggle('hidden', !PAD.active); ph.textContent = PAD.active ? (PAD.style === 'ps' ? '🎮 D-pad / stick to move · ✕ select · ○ back' : '🎮 D-pad / stick to move · A select · B back') : ''; }
  if (S.mode === 'play' && IS_TOUCH) $('touch').classList.toggle('hidden', PAD.active);
}
function onPadConnect(gp) {
  PAD.active = true; PAD.index = gp.index; PAD.id = gp.id; PAD.style = padStyle(gp.id); PAD.prev = gp.buttons.map(b => b.pressed);
  setPrompts(); toast(`🎮 <b>Controller connected</b> · ${escapeHtml(gp.id.replace(/\(.*?\)/g, '').trim().slice(0, 40) || 'Gamepad')}`, '#9fdcff');
  input.fire = false; input.ads = false;
  if (S.mode !== 'play') padFocusFirst();
}
function onPadDisconnect() {
  PAD.active = false; PAD.index = null; PAD.gp = null; input.fire = false; input.ads = false; input.moveX = input.moveY = 0; input.sprint = false;
  clearPadFocus(); setPrompts(); toast('🎮 Controller disconnected', '#ffb070');
  if (S.mode === 'play' && !coopActive()) pauseGame();
}
addEventListener('gamepadconnected', e => { if (!PAD.active) onPadConnect(e.gamepad); });
addEventListener('gamepaddisconnected', e => { if (PAD.active && e.gamepad.index === PAD.index) onPadDisconnect(); });
function rumble(weak, strong, ms) {
  if (!PAD.active || save.rumble === false) return;
  const now = performance.now(); if (now - PAD.lastRumble < 35) return; PAD.lastRumble = now;
  try { const a = PAD.gp && PAD.gp.vibrationActuator; if (a && a.playEffect) { const p = a.playEffect('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: Math.min(1, weak), strongMagnitude: Math.min(1, strong) }); if (p && p.catch) p.catch(() => {}); } } catch {}
}
// ---- menu navigation
const SCREENS = ['settings', 'coop', 'help', 'inv', 'pause', 'results', 'death', 'title'];
function isShown(el) { return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'; }
function activeScreen() { for (const id of SCREENS) { const el = $(id); if (el && !el.classList.contains('hidden') && isShown(el)) return el; } return null; }
function focusables(root) {
  return [...root.querySelectorAll('button, input, .cls, .card, #invSlots [data-slot] .card')].filter(el => !el.disabled && isShown(el) && !(el.tagName === 'INPUT' && el.id === 'joinCode') && el.getBoundingClientRect().width > 0);
}
function clearPadFocus() { if (PAD.focus) PAD.focus.classList.remove('padfocus'); PAD.focus = null; }
function setPadFocus(el) { clearPadFocus(); if (!el) return; PAD.focus = el; el.classList.add('padfocus'); try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch {} if (el.tagName === 'INPUT' && el.type === 'text') el.focus(); else if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur(); }
function padFocusFirst() {
  const sc = activeScreen(); if (!sc) return; const list = focusables(sc); if (!list.length) return;
  const pref = sc.id === 'settings' ? list[0] : sc.querySelector('.btn.primary:not([disabled])') || list[0]; setPadFocus(list.includes(pref) ? pref : list[0]);
}
function padNav(dir) {
  const sc = activeScreen(); if (!sc) return; const list = focusables(sc); if (!list.length) return;
  if (!PAD.focus || !list.includes(PAD.focus)) { padFocusFirst(); return; }
  const r0 = PAD.focus.getBoundingClientRect(), cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
  let best = null, bs = Infinity;
  for (const el of list) {
    if (el === PAD.focus) continue; const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, dx = x - cx, dy = y - cy;
    const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy, across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 4) continue; const sc2 = along + across * 2.2; if (sc2 < bs) { bs = sc2; best = el; }
  }
  if (best) { setPadFocus(best); sfx.click(); }
}
function padActivate() {
  const el = PAD.focus; if (!el) { padFocusFirst(); return; }
  if (el.tagName === 'INPUT' && el.type === 'range') return;
  if (el.tagName === 'INPUT' && el.type === 'text') { if (el.id === 'coopName') { const names = ['Guardian', 'Dad', 'Kid', 'Hunter', 'Warlock', 'Titan', 'Nova', 'Ace']; const i = (names.indexOf(el.value) + 1) % names.length; el.value = names[i]; el.dispatchEvent(new Event('input')); } return; }
  el.click();
  setTimeout(() => { if (!PAD.focus || !document.body.contains(PAD.focus) || !isShown(PAD.focus)) padFocusFirst(); else { const sc = activeScreen(); if (sc && !sc.contains(PAD.focus)) padFocusFirst(); } }, 30);
}
function padBack() {
  const sc = activeScreen(); if (!sc) return; const id = sc.id;
  const map = { settings: 'setClose', coop: 'coopClose', help: 'helpClose', inv: 'invClose', pause: 'resumeBtn' };
  if (map[id]) { $(map[id]).click(); setTimeout(padFocusFirst, 30); }
}
function padRange(el, d) { const st = +el.step || 0.1; el.value = clamp(+el.value + d * st, +el.min, +el.max); el.dispatchEvent(new Event('input')); }
// ---- per-frame poll
function padUpdate(dt) {
  const list = navigator.getGamepads ? [...navigator.getGamepads()] : [];
  let gp = PAD.index !== null ? list[PAD.index] : null;
  if (!gp || !gp.connected) gp = list.find(g => g && g.connected && (g.mapping === 'standard' || g.buttons.length >= 16)) || null;
  if (!gp) { if (PAD.active && !PAD.gp) {} else if (PAD.active) onPadDisconnect(); return; }
  if (!PAD.active) { onPadConnect(gp); }
  PAD.gp = gp; PAD.index = gp.index;
  const b = gp.buttons.map((x, i) => i === BTN.L2 || i === BTN.R2 ? x.value > 0.35 || x.pressed : x.pressed);
  const down = i => b[i] && !PAD.prev[i], up = i => !b[i] && PAD.prev[i];
  const ax = gp.axes;
  const [lx, ly] = radial(ax[0] || 0, ax[1] || 0, 1), [rx, ry] = radial(ax[2] || 0, ax[3] || 0, 2.0);
  if (S.mode === 'play') {
    clearPadFocus();
    input.moveX = lx; input.moveY = -ly;
    if (down(BTN.L3)) PAD.sprint = !PAD.sprint; if (Math.hypot(lx, ly) < 0.3 || ly > 0.2) PAD.sprint = false; input.sprint = PAD.sprint;
    // look: rad/s with ADS slow-down, response curve applied in radial(); invert-Y option; aim-assist slowdown near enemies
    const sens = (save.padSens || 1) / (save.sens || 1), ads = P.adsK > 0.5 ? 0.55 : 1;
    let slow = 1; const tgt = save.padAA !== false ? padAimTarget() : null; if (tgt) slow = 0.6;
    input.lookDX += rx * 3.4 * sens * ads * slow * dt; input.lookDY += ry * 2.6 * sens * ads * slow * dt * (save.invertY ? -1 : 1);
    // light magnetism: while moving or aiming, gently pull toward the target under the crosshair
    if (tgt && (Math.hypot(rx, ry) > 0.05 || Math.hypot(lx, ly) > 0.2 || b[BTN.L2])) {
      const pull = Math.min(1, dt * 2.2) * 0.35, dyaw = tgt.yaw - P.yaw, dpi = tgt.pitch - P.pitch;
      P.yaw += Math.atan2(Math.sin(dyaw), Math.cos(dyaw)) * pull; P.pitch += dpi * pull;
    }
    if (down(BTN.R2)) input.fire = true; if (up(BTN.R2)) input.fire = false;
    if (down(BTN.L2)) input.ads = true; if (up(BTN.L2)) input.ads = false;
    if (down(BTN.A)) { input.jumpPressed = true; input.jumpHeld = true; } if (up(BTN.A)) input.jumpHeld = false;
    if (down(BTN.X)) reload();
    if (down(BTN.B)) doMelee();
    // Y: tap = swap primary/special, hold = heavy
    if (down(BTN.Y)) PAD.yT = 0; if (PAD.yT >= 0) { PAD.yT += dt; if (!b[BTN.Y]) { if (PAD.yT < 0.4) swapTo(P.slot === 0 ? 1 : 0); PAD.yT = -1; } else if (PAD.yT >= 0.4) { swapTo(2); PAD.yT = -1; } }
    // L1 grenade, R1 melee, both = Super (short grace window so the chord registers)
    if (down(BTN.L1)) PAD.l1T = 0; if (down(BTN.R1)) PAD.r1T = 0;
    if (PAD.l1T >= 0 && PAD.r1T >= 0) { castSuper(); PAD.l1T = PAD.r1T = -1; }
    if (PAD.l1T >= 0) { PAD.l1T += dt; if (PAD.l1T > 0.12) { throwGrenade(); PAD.l1T = -1; } }
    if (PAD.r1T >= 0) { PAD.r1T += dt; if (PAD.r1T > 0.12) { doMelee(); PAD.r1T = -1; } }
    if (down(BTN.UP)) swapTo(2); if (down(BTN.LEFT)) swapTo(0); if (down(BTN.RIGHT)) swapTo(1); if (down(BTN.DOWN)) sendEmote();
    if (down(BTN.START)) pauseGame(); else if (down(BTN.SELECT)) openInventory();
  } else {
    // menus
    if (input.fire) input.fire = false;
    const sc = activeScreen();
    if (sc && (!PAD.focus || !sc.contains(PAD.focus) || !isShown(PAD.focus))) padFocusFirst();
    let dir = null;
    if (b[BTN.UP] || ly < -0.6) dir = 'up'; else if (b[BTN.DOWN] || ly > 0.6) dir = 'down'; else if (b[BTN.LEFT] || lx < -0.6) dir = 'left'; else if (b[BTN.RIGHT] || lx > 0.6) dir = 'right';
    if (dir) {
      if (dir !== PAD.navDir) { PAD.navT = 0.38; PAD.navDir = dir; padDir(dir); }
      else { PAD.navT -= dt; if (PAD.navT <= 0) { PAD.navT = 0.12; padDir(dir); } }
    } else PAD.navDir = null;
    if (down(BTN.A)) padActivate();
    if (down(BTN.B)) padBack();
    if (down(BTN.START)) { if (S.mode === 'pause') resumeGame(); else if (sc && sc.id === 'title') $('playBtn').click(); }
    if (down(BTN.X) && sc && sc.id === 'inv') { const eb = $('eqBtn'); if (eb) eb.click(); }
    if (down(BTN.Y) && sc && sc.id === 'inv') $('bestBtn').click();
    if (down(BTN.SELECT) && sc && sc.id === 'inv') $('invClose').click();
  }
  PAD.prev = b;
}
function padDir(dir) {
  const el = PAD.focus;
  if (el && el.tagName === 'INPUT' && el.type === 'range' && (dir === 'left' || dir === 'right')) { padRange(el, dir === 'left' ? -1 : 1); return; }
  padNav(dir);
}
function padAimTarget() {
  const fwd = camDir(new V3()); let best = 0.09, out = null;
  for (const e of enemies) {
    if (e.dead) continue;
    const c = (e.shield > 0 ? centerPos(e) : headPos(e)).sub(camera.position), d = c.length(); if (d > 45) continue; c.divideScalar(d);
    const ang = Math.acos(clamp(c.dot(fwd), -1, 1)); const lim = best * (1 + 3 / Math.max(3, d));
    if (ang < lim) { best = ang; out = { yaw: Math.atan2(-c.x, -c.z), pitch: Math.asin(clamp(c.y, -1, 1)) }; }
  }
  return out;
}
// ==== PAD_END ====


// ---------------- Boot ----------------
if (IS_TOUCH) setupTouch();
applyQuality();
renderTitle(); loadWeapons(true);
$('loading').remove();
frame();
// portrait on a touch device: the rotate prompt covers the game, so pause solo play behind it
addEventListener('resize', () => { if (IS_TOUCH && innerHeight > innerWidth && S.mode === 'play' && !coopActive() && !PAD.active) pauseGame(); });
if (params.has('autostart')) startRun();

// test/debug hooks (used by automated tests; harmless in production)
window.__game = {
  S, P, enemies, engrams, save, input, CLASSES,
  startRun, spawnEnemy: (t, d = 12) => spawnEnemy(t, new V3(-Math.sin(P.yaw) * d, 0, -Math.cos(P.yaw) * d).add(new V3(P.pos.x, 0, P.pos.z))),
  aimAt: e => { const h = headPos(e), c = camera.position; const dx = h.x - c.x, dy = h.y - c.y, dz = h.z - c.z; P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(dy, Math.hypot(dx, dz)); P.kick = 0; P.kickYaw = 0; },
  aimBody: e => { const h = centerPos(e), c = camera.position; const dx = h.x - c.x, dy = h.y - c.y, dz = h.z - c.z; P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(dy, Math.hypot(dx, dz)); P.kick = 0; P.kickYaw = 0; },
  openInventory, closeInventory, equipBest, castSuper, throwGrenade, doMelee, swapTo, pauseGame, resumeGame,
  dropEngram: (r = 2) => dropEngram(new V3(P.pos.x + 1, P.pos.y + 1, P.pos.z), r),
  startWave, powerLevel, get fps() { return S.fps; }, get pixelRatio() { return pixelRatio; }, fpsLog,
  get quality() { return QNAME; }, setQuality: q => { QNAME = q; applyQuality(); },
  step: (n = 1, dt = 1 / 30, draw = 1) => { for (let i = 0; i < n; i++) tick(dt, !!draw && i === n - 1); }, get frameMs() { return frameMs; },
  killAll: () => { for (const e of enemies.slice()) if (!e.dead) killEnemy(e, {}); S.waveQueue.length = 0; },
  spawnAt: (t, x, z) => spawnEnemy(t, new V3(x, groundAt(x, z, 5), z)),
  forceDown: () => { if (!P.dead) playerDie(); }, hostGame, joinGame, leaveCoop, toggleReady, coopCount, padNav, padActivate, get padFocus() { return PAD.focus && (PAD.focus.id || PAD.focus.textContent.trim().slice(0, 20)); },
  renderer, NET, PAD, curW, net: () => NET, pad: () => PAD, camera,
};
