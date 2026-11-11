# Shattermoon Vanguard (working title) — v0.1 prototype

An original sci-fi first-person looter-shooter for browser + iPhone. Everything is procedural:
low-poly Three.js geometry, WebAudio-synthesized sounds, no downloaded art/audio, no CDN.
Three.js r170 is vendored in `vendor/` (MIT, see vendor/THREE-LICENSE.txt).

## Run locally
    cd /workspace/shattermoon-vanguard
    python3 -m http.server 8811
    open http://localhost:8811/
(ES modules need http://, not file://.)

Debug/test URL flags: `?debug=1` (short waves, boss on wave 3, Super pre-charged, weaker enemies),
`?wave=6` (start at the boss), `?god=1` (no damage), `?touch=1` (force phone controls), `?autostart=1`.

## Controls
Desktop: WASD move · Shift sprint · mouse aim (click to lock) · left click fire · right click ADS ·
Space jump / double-jump / hold to glide · R reload · 1/2/3 or wheel swap · Q grenade · C melee · F Super · Tab gear · Esc pause.

iPhone (landscape): left thumb = floating move stick (push far up to sprint) · right thumb drag = aim
(dragging on FIRE also aims) · FIRE · ⤒ jump/glide · ✸ grenade · ✊ melee · ✦ Super · ⇄ swap · ⟳ reload · ◎ ADS · ⚙ gear · ❚❚ pause.
Light aim-assist is on for touch only.

## Files
index.html, style.css, game.js (game loop, player, enemies, HUD, UI), world.js (arena/sky), loot.js (weapons/perks), audio.js (synth SFX).
Save data: localStorage key `shattermoon_vanguard_v1`.

## Capacitor (later, not done yet)
Copy these files into a Capacitor project's `www/` (capacitor.config.json included, appId com.dhavalpatel.shattermoon),
then `npx cap add ios && npx cap sync ios`. Lock orientation to landscape in Xcode.
Before shipping: run a trademark/App Store name search — "Shattermoon" is also the name of a small studio (shattermoon.com) and a novel.
