# ASTEROID BELT

**Asteroids (1979) × Star Fox (1993)** — a gyroscopic rail shooter for the browser.

Your ship barrels forward through a cosmic graveyard on rails. Wireframe rocks
loom out of the deep field, and — true to Asteroids — blasting a big one doesn't
clear the screen, it *fractures* it into smaller, faster fragments you now have
to manage. Screen real estate is the real enemy.

## Play

Open `index.html` in a browser (or serve the folder with any static server).
No build step, no dependencies.

### Mobile (the intended experience)

- **Tilt** the phone to steer and aim — subtle, ~18° of tilt is full deflection.
  The gyro calibrates to however you're holding the phone when you hit ENGAGE.
- **Tap and hold** anywhere to fire.
- No gyro (or permission denied)? Touch-drag steers instead.
- iOS asks for motion-sensor permission on the ENGAGE tap — that's expected.

### Desktop fallback

- **Mouse** aims, **click or Space** fires, **WASD/arrows** also steer.
- **C** recalibrates the gyro center (mobile with keyboard, or if drift sets in).

## Systems

- **Fracture physics** — large rocks (20 pts) split into 2–3 mediums (50 pts),
  mediums into smalls (100 pts). Classic Asteroids scoring: the little fast
  ones pay the most. Large rocks take two hits.
- **Force field** — 100 shield, an impact costs 28. It slowly regenerates
  after 4 quiet seconds. Shield pods (`S`) restore a chunk instantly.
- **Arsenal** (timed pickups dropped by shattered rocks, ~14 s each):
  - `≡` **TRI-CANNON** — three-way spread
  - `»` **VULCAN** — very high rate of fire, slight scatter
  - `◉` **PLASMA ORB** — huge, slow-firing, pierces through everything it touches
- **Combo multiplier** — kills within 2.6 s of each other chain; every 4 kills
  bumps the multiplier, up to ×5. Getting hit resets it.
- **Sectors** — every 22 s the belt gets denser and the rail speed climbs.
- High score persists in `localStorage`.

## Tech notes

- Single canvas, pseudo-3D perspective projection (`screen = center + world × focal/z`),
  painter's-algorithm depth sort, fog-faded neon wireframes.
- `deviceorientation` for gyro with landscape axis remapping and
  `DeviceOrientationEvent.requestPermission()` for iOS.
- All sound is synthesized live with WebAudio — no audio assets.
- Files: `index.html` (shell + HUD), `style.css` (retro-glow HUD), `game.js` (everything else).
