// Shattermoon Vanguard — optional Sign in with Apple (iOS app only) + iCloud progress sync.
// No server: the Apple user ID + the name/email Apple shares on the very first sign-in are kept on-device
// (localStorage) and mirrored to the player's own iCloud key-value store. On the web, everyone plays as a guest.
const cap = window.Capacitor;
const params = new URLSearchParams(location.search);
export const IS_NATIVE_IOS = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform() && typeof cap.getPlatform === 'function' && cap.getPlatform() === 'ios');
// ?simios — test-only: shows the Apple button in a desktop browser with a mocked sign-in (used for screenshots)
const SIM = !IS_NATIVE_IOS && params.has('simios');
export const APPLE_ENABLED = IS_NATIVE_IOS || SIM;

const ACC_KEY = 'shattermoon_account_v1';
const PROFILES_KEY = 'shattermoon_apple_profiles_v1';

function readJSON(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } }
function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

// short stable hash so iCloud keys stay well under Apple's 64-byte key limit
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

function call(method, opts = {}) {
  if (SIM) return mock(method, opts);
  if (!IS_NATIVE_IOS || typeof cap.nativePromise !== 'function') return Promise.reject(new Error('Sign in with Apple is only available in the iOS app'));
  return cap.nativePromise('AppleAuth', method, opts);
}
function mock(method) {
  if (method === 'authorize') return new Promise(r => setTimeout(() => r({ user: '000000.simulated0apple0user.0000', givenName: 'Dhaval', familyName: 'Patel', email: 'sim@privaterelay.appleid.com' }), 300));
  if (method === 'credentialState') return Promise.resolve({ state: 'authorized' });
  if (method === 'kvGet') return Promise.resolve({ value: null });
  return Promise.resolve({});
}

export function getAccount() {
  if (!APPLE_ENABLED) return null;
  const a = readJSON(ACC_KEY, null);
  return a && typeof a.user === 'string' && a.user ? a : null;
}
export function saveKeyFor(base, acc) { return acc ? `${base}@apple:${hash(acc.user)}` : base; }
export function cloudKey(acc) { return acc ? `sv_${hash(acc.user)}` : null; }

// Returns the stored account. Apple only shares name/email the FIRST time someone signs in to this app,
// so remember them per Apple ID (and in iCloud) for later sign-ins / other devices.
export async function signIn() {
  const r = await call('authorize');
  if (!r || !r.user) throw new Error('No Apple ID returned');
  const profiles = readJSON(PROFILES_KEY, {});
  const prev = profiles[r.user] || {};
  let name = (r.givenName || '').trim() || prev.name || '';
  let email = (r.email || '').trim() || prev.email || '';
  const pk = `pf_${hash(r.user)}`;
  if (!name || !email) { try { const c = await call('kvGet', { key: pk }); const p = c && c.value ? JSON.parse(c.value) : null; if (p) { name = name || p.name || ''; email = email || p.email || ''; } } catch {} }
  const acc = { user: r.user, name, email, since: Date.now() };
  profiles[r.user] = { name, email }; writeJSON(PROFILES_KEY, profiles); writeJSON(ACC_KEY, acc);
  if (name || email) call('kvSet', { key: pk, value: JSON.stringify({ name, email }) }).catch(() => {});
  return acc;
}
export function signOut() { try { localStorage.removeItem(ACC_KEY); } catch {} }

// If the player revoked this app in Settings › Apple ID, drop back to guest.
export async function verify(acc) {
  if (!acc || SIM) return true;
  try { const r = await call('credentialState', { user: acc.user }); if (r && r.state === 'revoked') { signOut(); return false; } } catch {}
  return true;
}

export async function cloudGet(acc) {
  const k = cloudKey(acc); if (!k || !IS_NATIVE_IOS) return null;
  try { const r = await call('kvGet', { key: k }); return r && r.value ? JSON.parse(r.value) : null; } catch { return null; }
}
let pushTimer = 0, pending = null;
export function cloudPush(acc, data) {
  const k = cloudKey(acc); if (!k || !IS_NATIVE_IOS) return;
  pending = data; clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { const v = JSON.stringify(pending); pending = null; call('kvSet', { key: k, value: v }).catch(() => {}); }, 1500);
}
export const APPLE_LOGO = '<svg class="alogo" viewBox="0 0 170 170" aria-hidden="true"><path fill="currentColor" d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.197-2.12-9.973-3.17-14.34-3.17-4.58 0-9.492 1.05-14.746 3.17-5.262 2.13-9.501 3.24-12.742 3.35-4.929.21-9.842-1.96-14.746-6.52-3.13-2.73-7.045-7.41-11.735-14.04-5.032-7.08-9.169-15.29-12.41-24.65-3.471-10.11-5.211-19.9-5.211-29.378 0-10.857 2.346-20.221 7.045-28.068 3.693-6.303 8.606-11.275 14.755-14.925s12.793-5.51 19.948-5.629c3.915 0 9.049 1.211 15.429 3.591 6.362 2.388 10.447 3.599 12.238 3.599 1.339 0 5.877-1.416 13.57-4.239 7.275-2.618 13.415-3.702 18.445-3.275 13.63 1.1 23.87 6.473 30.68 16.153-12.19 7.386-18.22 17.731-18.1 31.002.11 10.337 3.86 18.939 11.23 25.769 3.34 3.17 7.07 5.62 11.22 7.36-.9 2.61-1.85 5.11-2.86 7.51zM119.11 7.24c0 8.102-2.96 15.667-8.86 22.669-7.12 8.324-15.732 13.134-25.071 12.375a25.222 25.222 0 0 1-.188-3.07c0-7.778 3.386-16.102 9.399-22.908 3.002-3.446 6.82-6.311 11.45-8.597 4.62-2.252 8.99-3.497 13.1-3.71.12 1.083.17 2.166.17 3.24z"/></svg>';
