// Shattermoon Vanguard — weapons, rarity, perks, loot rolls.
export const RARITY = [
  { id: 'common', name: 'Common', color: '#e2e2e2', hex: 0xe2e2e2, perks: 0, pow: [-3, 2] },
  { id: 'rare', name: 'Rare', color: '#4f8bff', hex: 0x4f8bff, perks: 1, pow: [0, 4] },
  { id: 'legendary', name: 'Legendary', color: '#b45cff', hex: 0xb45cff, perks: 2, pow: [2, 7] },
  { id: 'exotic', name: 'Exotic', color: '#ffcc33', hex: 0xffcc33, perks: 2, pow: [4, 10] },
];
export const ELEMENTS = {
  kinetic: { name: 'Kinetic', color: '#e9e9e9', hex: 0xe9e9e9, icon: '◆' },
  flare: { name: 'Flare', color: '#ff7a2a', hex: 0xff7a2a, icon: '🔥' },
  storm: { name: 'Storm', color: '#59d0ff', hex: 0x59d0ff, icon: '⚡' },
  abyss: { name: 'Abyss', color: '#b066ff', hex: 0xb066ff, icon: '🌀' },
};
export const SLOT_NAMES = ['Primary', 'Special', 'Heavy'];
// base archetypes (before stats)
export const ARCH = {
  auto:   { name: 'Auto Rifle',      slot: 0, rpm: 600, dmg: 15, crit: 1.6, mag: 32, reload: 2.0, range: 30, spread: 0.010, recoil: 0.010, zoom: 1.3 },
  pulse:  { name: 'Pulse Rifle',     slot: 0, rpm: 900, burst: 3, burstGap: 0.30, dmg: 20, crit: 1.7, mag: 36, reload: 2.1, range: 38, spread: 0.005, recoil: 0.008, zoom: 1.4 },
  hand:   { name: 'Hand Cannon',     slot: 1, rpm: 140, dmg: 64, crit: 2.0, mag: 10, reload: 2.2, range: 34, spread: 0.003, recoil: 0.05, zoom: 1.3 },
  scout:  { name: 'Scout Rifle',     slot: 1, rpm: 260, dmg: 40, crit: 1.9, mag: 15, reload: 2.0, range: 60, spread: 0.0015, recoil: 0.022, zoom: 2.0 },
  rocket: { name: 'Rocket Launcher', slot: 2, rpm: 55,  dmg: 520, crit: 1.0, mag: 1, reload: 2.4, range: 200, spread: 0, recoil: 0.08, zoom: 1.4, projectile: true, splash: 6, reserve: 6 },
  mg:     { name: 'Machine Gun',     slot: 2, rpm: 720, dmg: 32, crit: 1.5, mag: 60, reload: 3.1, range: 42, spread: 0.014, recoil: 0.011, zoom: 1.3, reserve: 240 },
};
export const ARCH_BY_SLOT = [['auto', 'pulse'], ['hand', 'scout'], ['rocket', 'mg']];

export const PERKS = {
  bloodrush:  { name: 'Bloodrush',       desc: 'Kills grant +10% damage for 5s. Stacks 3x.' },
  swifthands: { name: 'Swift Hands',     desc: 'Precision kills instantly refill 40% of the magazine.' },
  shatter:    { name: 'Shatter Rounds',  desc: 'Precision hits cause a small explosion.' },
  overcharge: { name: 'Overcharge Clip', desc: 'Reloading within 3s of a kill grants +30% damage for 5s.' },
  deepmag:    { name: 'Deep Magazine',   desc: '+30% magazine size.' },
  vampiric:   { name: 'Vampiric Rounds', desc: 'Kills restore 20 health.' },
  surge:      { name: 'Element Surge',   desc: '+50% damage against elemental shields.' },
  steady:     { name: 'Steady Hand',     desc: '-35% recoil and +15% range.' },
};
export const EXOTIC_PERKS = {
  starbolt:   { name: 'Starcaller',  desc: 'Every 4th hit launches a homing star bolt.' },
  chainstorm: { name: 'Chain Storm', desc: 'Kills arc lightning to 3 nearby enemies.' },
  phoenix:    { name: 'Phoenix Rite', desc: 'Kills detonate in a burst of fire.' },
};
const PRE = ['Ashen', 'Vesper', 'Hollow', 'Solace', 'Cinder', 'Gilded', 'Quiet', 'Ember', 'Rift', 'Lumen', 'Halcyon', 'Sable', 'Pale', 'Broken', 'Last', 'Wandering', 'Iron-Bound', 'Glass'];
const NOUN = ['Oath', 'Verdict', 'Requiem', 'Lantern', 'Vow', 'Gambit', 'Herald', 'Tempest', 'Covenant', 'Hymn', 'Ledger', 'Comet', 'Answer', 'Sermon', 'Promise', 'Thorn', 'Halo', 'Reckoning'];
const EXO_NAMES = { starbolt: 'Starcaller', chainstorm: 'Wyrmglass', phoenix: 'Pale Sovereign' };

const pick = a => a[Math.floor(Math.random() * a.length)];
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
let uid = Date.now() % 100000;
export const newId = () => 'w' + (uid++).toString(36) + Math.floor(Math.random() * 1e4).toString(36);

export function rollRarity(wave, boost = 0) {
  const r = Math.random() * 100 - boost - wave * 1.2;
  if (r < 3) return 3; if (r < 18) return 2; if (r < 50) return 1; return 0;
}

export function rollWeapon(basePower, rarityIdx, slot = null, forceArch = null, forceElem = null) {
  const rar = RARITY[rarityIdx];
  slot = slot ?? ri(0, 2);
  const arch = forceArch || pick(ARCH_BY_SLOT[slot]);
  let element = forceElem || (slot === 0 && rarityIdx < 2 ? 'kinetic' : pick(slot === 0 ? ['kinetic', 'flare', 'storm', 'abyss'] : ['flare', 'storm', 'abyss']));
  const lo = 35 + rarityIdx * 6, hi = 75 + rarityIdx * 8;
  const stats = { impact: ri(lo, hi), range: ri(lo, hi), stability: ri(lo, hi), handling: ri(lo, hi), reload: ri(lo, hi), mag: ri(lo, hi) };
  for (const k in stats) stats[k] = Math.min(100, stats[k]);
  const perks = [];
  const keys = Object.keys(PERKS);
  while (perks.length < rar.perks) { const k = pick(keys); if (!perks.includes(k)) perks.push(k); }
  let name = pick(PRE) + ' ' + pick(NOUN);
  if (rarityIdx === 3) { const ex = pick(Object.keys(EXOTIC_PERKS)); perks.unshift(ex); name = EXO_NAMES[ex]; }
  const power = Math.max(100, Math.round(basePower + ri(rar.pow[0], rar.pow[1])));
  return { id: newId(), arch, slot, name, rarity: rarityIdx, element, power, stats, perks, isNew: true };
}

export function weaponParams(w) {
  const a = ARCH[w.arch], s = w.stats, has = p => w.perks.includes(p);
  const steady = has('steady');
  return {
    ...a,
    dmg: a.dmg * (0.85 + s.impact / 100 * 0.3),
    mag: Math.max(1, Math.round(a.mag * (0.8 + s.mag / 100 * 0.4) * (has('deepmag') ? 1.3 : 1))),
    reload: a.reload * (1.25 - s.reload / 100 * 0.5),
    recoil: a.recoil * (1.3 - s.stability / 100 * 0.6) * (steady ? 0.65 : 1),
    range: a.range * (0.8 + s.range / 100 * 0.4) * (steady ? 1.15 : 1),
    swap: 0.6 - s.handling / 100 * 0.35,
    interval: 60 / a.rpm,
  };
}

export function starterLoadout(cls) {
  const el = cls || 'flare';
  return [
    { ...rollWeapon(100, 0, 0, 'auto', 'kinetic'), name: 'Frontier Standard', power: 100, isNew: false },
    { ...rollWeapon(100, 0, 1, 'hand', el), name: 'Settler\'s Word', power: 100, isNew: false },
    { ...rollWeapon(100, 0, 2, 'rocket', el), name: 'Breach Charge', power: 100, isNew: false },
  ];
}
