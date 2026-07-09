# FOG CROSSING — Production Architecture Blueprint

**Genre:** Discrete lane-crossing survival (Frogger, 1981) × low-poly fog-horror (Silent Hill, 1999)
**Target:** Mobile Web PWA, portrait 9:16, 60 FPS on mid-tier devices, deployable to GitHub Pages as static files.
**Stack:** TypeScript (strict), Three.js, zero external physics engine, Vite build, hand-rolled Service Worker.

---

## 1. ARCHITECTURAL OVERVIEW

### 1.1 Module Layout

```
/src
├── main.ts                 # Bootstrap: canvas, WebGL context, DI wiring
├── core/
│   ├── GameLoop.ts         # Fixed-timestep loop + browser lifecycle
│   ├── StateMachine.ts     # BOOT → TITLE → PLAYING → DEATH → RESULTS
│   └── EventBus.ts         # Typed pub/sub (mitt-style, ~40 LOC, no deps)
├── world/
│   ├── LaneManager.ts      # Procedural lane ring buffer, spawn/despawn
│   ├── LaneTypes.ts        # Lane archetype definitions (data, not code)
│   ├── HazardPool.ts       # Object pools for all moving hazards
│   └── Grid.ts             # Grid ↔ world-space math (single source of truth)
├── player/
│   ├── PlayerController.ts # Grid state, hop tweening, death checks
│   └── InputRouter.ts      # Pointer events → discrete move intents
├── atmosphere/
│   ├── FogDirector.ts      # FogExp2 density choreography
│   ├── Flashlight.ts       # Player spotlight rig
│   └── Sanity.ts           # Sanity meter → threat/render modulation
├── render/
│   ├── SceneComposer.ts    # Camera, renderer config, resize handling
│   └── materials/          # Vertex-color + custom ShaderMaterial library
├── audit/
│   └── Invariants.ts       # Per-tick self-verification (Section 5)
└── sw.ts                    # Service Worker (built separately, root scope)
```

Rules: modules communicate through the `EventBus` and typed interfaces only. Rendering never mutates simulation state; simulation never touches Three.js objects directly except through a `SyncPass` that copies sim → scene graph once per render frame.

### 1.2 Game Loop — Fixed Timestep with Render Interpolation

Mobile browsers throttle `requestAnimationFrame` unpredictably (Low Power Mode caps at 30 Hz; backgrounding stops it entirely). A fixed simulation timestep decouples correctness from frame delivery:

```ts
const SIM_HZ = 60;
const SIM_DT = 1000 / SIM_HZ;
const MAX_FRAME_DELTA = 250; // ms — clamp after tab resume / GC pause

class GameLoop {
  private accumulator = 0;
  private last = 0;

  frame = (now: number) => {
    let delta = Math.min(now - this.last, MAX_FRAME_DELTA);
    this.last = now;
    this.accumulator += delta;

    while (this.accumulator >= SIM_DT) {
      this.sim.tick(SIM_DT);          // deterministic, integer tick counter
      this.audit.verify(this.sim);    // Section 5 invariant checks
      this.accumulator -= SIM_DT;
    }
    const alpha = this.accumulator / SIM_DT;
    this.renderer.render(alpha);      // interpolate visuals between ticks
    this.rafId = requestAnimationFrame(this.frame);
  };
}
```

- `MAX_FRAME_DELTA` clamp prevents the "spiral of death" and prevents hazards teleporting through the player after a long pause.
- The simulation is deterministic per tick (seeded PRNG — mulberry32, 32-bit state), which makes replay-based bug reports and invariant auditing possible.

### 1.3 Browser Lifecycle Handling

| Event | Action |
|---|---|
| `visibilitychange → hidden` | `cancelAnimationFrame`, mute `AudioContext` (`suspend()`), snapshot sim state to `sessionStorage` |
| `visibilitychange → visible` | Reset `last = performance.now()`, zero the accumulator, resume audio on next user gesture (iOS requirement), show a 1-tick "breathe" frame before re-enabling input |
| `pagehide` / `freeze` | Persist run state (score, seed, tick count) — survives iOS PWA process eviction |
| `webglcontextlost` | `event.preventDefault()`, pause state machine |
| `webglcontextrestored` | Re-run `SceneComposer.rebuild()` — all materials/geometry are factory-created, so rebuild is a pure function of sim state |
| `resize` / `orientationchange` | Re-fit camera frustum; if landscape, show a "rotate device" overlay and pause |

Pause is a **state-machine transition**, not a boolean flag — entering `PAUSED` detaches the input router and freezes the sanity/threat clocks so backgrounding is never punished.

### 1.4 Service Worker — 100% Offline Playability

Everything is static and versioned, so the strategy is **precache-everything, cache-first, atomic version swap**:

```ts
// sw.ts — no Workbox; ~80 LOC hand-rolled for bundle discipline
const VERSION = 'fog-crossing-v__BUILD_HASH__';   // injected at build
const PRECACHE = self.__MANIFEST__;                // emitted by Vite plugin:
// ['/', '/index.html', '/assets/app.[hash].js', '/assets/atlas.[hash].ktx2', ...]

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true })
      .then(hit => hit ?? fetch(e.request))
  );
});
```

Key decisions:

- **Cache-first, not stale-while-revalidate.** The game is fully self-contained; there is no dynamic content. Cache-first gives instant loads and guaranteed offline start.
- **Atomic updates:** all assets are content-hashed; a new build gets a new `VERSION` cache. The old version keeps serving until the new one fully installs — a mid-download network drop can never brick the installed app.
- **Update UX:** the page listens for `controllerchange` and shows a non-blocking "New version — restart?" toast; never force-reload mid-run.
- **GitHub Pages specifics:** SW registered with `scope: './'`, all manifest paths relative (Pages serves from `/repo-name/`). `manifest.webmanifest` sets `"display": "fullscreen"`, `"orientation": "portrait"`, maskable icons at 192/512.
- **Budget:** total precache target ≤ 3 MB (JS ~150 KB gz, Three.js tree-shaken ~120 KB gz, audio ~1.5 MB Opus/CAF dual-encode, textures ~500 KB KTX2). Small enough that install completes on one bar of LTE.

---

## 2. GAMEPLAY MECHANICS & INPUT HOOKS

### 2.1 The Grid Is the Truth; 3D Is a Projection

The player's authoritative state is integer grid coordinates. World space is derived, never stored:

```ts
const CELL = 1.0;        // 1 world unit per cell
const LANES_VISIBLE = 14; // rows in the active window
const COLS = 7;           // playfield width; col ∈ [-3, +3]

// Grid.ts — the ONLY place this conversion exists
export const gridToWorld = (col: number, row: number): THREE.Vector3 =>
  new THREE.Vector3(col * CELL, 0, -row * CELL); // forward = -Z

export const worldToCol = (x: number) => Math.round(x / CELL);
```

Player sim state: `{ col: int, row: int, hop: HopTween | null, riding: Hazard | null }`.

### 2.2 Input → Movement Mapping Matrix

| Gesture | Detection rule | Intent | Grid delta | 3D result |
|---|---|---|---|---|
| **Tap** | pointerup < 200 ms after pointerdown, travel < 12 px | `ADVANCE` | `row + 1` | Hop forward 1 cell (−Z) |
| **Swipe left** | travel ≥ 24 px, |dx| > |dy|, dx < 0 | `STRAFE_L` | `col − 1` | Hop left 1 cell (−X) |
| **Swipe right** | travel ≥ 24 px, |dx| > |dy|, dx > 0 | `STRAFE_R` | `col + 1` | Hop right 1 cell (+X) |
| **Swipe down** | travel ≥ 24 px, |dy| > |dx|, dy > 0 | `RETREAT` | `row − 1` | Hop backward 1 cell (+Z) |
| **Swipe up** | travel ≥ 24 px, |dy| > |dx|, dy < 0 | `ADVANCE` | `row + 1` | Same as tap (generous alias) |
| Long-press | > 350 ms, no travel | `PEER` | none | Flashlight beam tightens & extends (Section 3.2) |

### 2.3 Zero-Perceived-Lag Input Pipeline

1. **Pointer Events only** (`pointerdown/up/move` on the canvas with `touch-action: none` CSS) — kills the 300 ms click delay and double-tap-zoom without any library. `preventDefault()` on `touchstart` blocks iOS Safari's rubber-banding.
2. **Classify on `pointerup`**, but *predict* on `pointermove`: once cumulative travel crosses the 24 px swipe threshold, the intent is locked and executed immediately — the player doesn't need to lift their thumb. Median gesture-to-hop latency lands under one frame.
3. **Intent queue, depth 1.** Input during an in-flight hop buffers exactly one intent, consumed the tick the hop lands. This gives the classic Frogger "drum-roll" cadence without letting inputs pile up. A second input overwrites the buffered one.
4. **Hop execution is a fixed-duration tween** (7 sim ticks ≈ 117 ms): position lerps `gridToWorld(from) → gridToWorld(to)` with a parabolic Y arc (`y = 0.35 · sin(π·t)`) and a squash-stretch scale keyframe. **Collision identity switches to the destination cell at t = 0** — the sim treats the player as already in the target cell the moment the hop starts; the tween is purely cosmetic. This one rule eliminates the entire class of "hit mid-jump by something in the lane I left" ambiguities.
5. **Illegal moves** (off-grid columns, hopping into a wall lane) are rejected at intent time with a 2-tick "bump" animation and a muffled thud — feedback without movement.

### 2.4 Lane Generation Engine — Endless Ring Buffer

Lanes are the world. The engine maintains a **ring buffer of `LANES_VISIBLE + 6` lane slots**, recycled as the player advances. Nothing is ever allocated at runtime after boot.

**Lane archetypes** (data-driven, in `LaneTypes.ts`):

| Archetype | Traversal rule | Hazard | Horror dressing |
|---|---|---|---|
| `ASH_FIELD` | Safe rest lane | none | Drifting ash particles, half-buried debris |
| `ROAD_RUST` | Dodge lane | Wrecked cars gliding silently, headlights dead | Wet asphalt shader, distant engine drone |
| `GRATE_GAP` | Ride lane (logs → grates) | Rusted grate platforms sliding over a void; standing on floor = fall | Sub-bass rumble from below, orange glow in gaps |
| `RAIL_LINE` | Timing lane | Ghost train: rare, lethal, telegraphed 90 ticks early by rail-hum + fog flash | Track vibration camera shake |
| `SIREN_MIRE` | Slow lane | Player hop cost ×2 ticks while a patroller (Section 4.1) walks it | Knee-deep fog plane, wading audio |
| `WALL_BREACH` | Gate lane | Static wall with 1–2 gap columns forcing lateral movement | Chain-link + flashlight-reactive graffiti |

**Difficulty curve as constraint-based sampling:** the generator picks the next archetype from a weight table keyed to `row` depth, with hard rules — never two `RAIL_LINE`s adjacent, a guaranteed `ASH_FIELD` at least every 5 lanes (interval shrinks as sanity drops, Section 4.2), `WALL_BREACH` gaps always reachable from the previous lane's safe columns (validated by a 1-step flood check at generation time).

**Spawn/despawn thresholds are keyed to player row, not camera** (the camera is a soft-follow of the player and can lag during shake):

```ts
// LaneManager.tick()
const AHEAD = 12, BEHIND = 4;
while (this.maxRow < player.row + AHEAD) this.recycleLane(this.maxRow + 1);
// recycleLane pops the slot at (player.row - BEHIND - 1), reconfigures its
// mesh set + hazard pool bindings for the new archetype, repositions at maxRow+1
```

- **Fog is the despawn mask**: `BEHIND = 4` and `AHEAD = 12` both sit past the fog's ~99% extinction distance (Section 3.1), so recycling is never visible. No pop-in, no pop-out, zero allocation.
- Hazards are owned by lane slots and come from per-archetype **object pools** (`HazardPool`) sized at worst-case density (e.g. 6 cars/lane × max concurrent road lanes). Pool exhaustion is a build-time assertion, not a runtime allocation.
- Hazard motion is pure kinematics: `x(t) = wrap(x0 + v · tick)` across `[-COLS/2 − 2, +COLS/2 + 2]` with wraparound — deterministic, replayable, and trivially checkable by the auditor.
- **Backward-scroll kill wall:** a fog bank ("The Static") advances from behind at a slow fixed rate that ratchets up with depth — the Frogger timer reimagined as dread. If `player.row < staticRow`, death. This also bounds `BEHIND` recycling safely.

---

## 3. ESTABLISHING THE ATMOSPHERE (THREE.JS IMPLEMENTATION)

### 3.1 Fog as Both Aesthetic and Optimization

`THREE.FogExp2` is the core trick — one uniform, per-pixel exponential falloff, essentially free:

```ts
scene.fog = new THREE.FogExp2(0x0d0d10, 0.16);
scene.background = new THREE.Color(0x0d0d10); // MUST match — infinite fog illusion
renderer.setClearColor(0x0d0d10);
```

- Density 0.16 ⇒ ~95% extinction at ~13.7 world units (`d = √(−ln(0.05))/0.16`), comfortably inside the 12-lane spawn horizon. **The far plane is pulled to 20 units** — fog culls fragments *visually*, the tight frustum culls them *computationally*. Draw distance problems cease to exist by design.
- **Fog choreography** (`FogDirector`): density is a smoothed signal, not a constant.
  - Baseline breathing: `density = base + 0.012 · sin(t · 0.11)` — subliminal, keeps the fog feeling alive.
  - Event spikes: rail-line telegraph briefly *thins* the fog down the track (a lie of safety); sanity loss *thickens* it (Section 4.2).
  - All transitions are exponentially smoothed (`density += (target − density) · 0.03` per tick) — never stepped.
- Fog color shifts hue slightly with sanity (neutral gray-blue → faint rust-red at low sanity) by lerping the fog color uniform — costs nothing.

### 3.2 The Flashlight — One Real Light, Total Control

Lighting budget: **one `THREE.SpotLight` + one `HemisphereLight`**, nothing else. No shadow maps.

```ts
const flash = new THREE.SpotLight(0xfff2d8, 18.0, /*distance*/ 9.5,
                                  /*angle*/ Math.PI / 7, /*penumbra*/ 0.55,
                                  /*decay*/ 2.2);
flash.castShadow = false;                       // biggest single perf win
playerRig.add(flash, flash.target);
flash.position.set(0, 0.9, 0);
flash.target.position.set(0, 0.15, -6);         // aims down-forward into fog
```

- **Custom drop-off:** `distance: 9.5` hard-clamps the light's reach inside the fog wall, and `decay: 2.2` (slightly super-physical) makes the beam die fast — a cone of safety that never reveals the spawn horizon. Beam sway: ±1.5° noise on the target, amplified during hops.
- **"PEER" mechanic** (long-press): tween `angle → π/10`, `distance → 12.5` for up to 1.5 s — trade situational width for depth to scout rail lanes. While peering, the player can't move; risk/reward in one uniform tween.
- **Fake volumetrics** for the visible beam: an open cone geometry with an additive-blend `ShaderMaterial` — fresnel-faded edges, fragment alpha falls off with distance and with a cheap 2-octave noise scroll to simulate fog motes drifting through the beam. Depth-write off, one draw call, no post-processing pass needed.
- Hemisphere fill: `new THREE.HemisphereLight(0x11131a, 0x050505, 0.35)` so unlit geometry silhouettes against fog instead of going pure black.
- Renderer config: `antialias: false` (fog hides aliasing), `powerPreference: 'high-performance'`, `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))` with a dynamic fallback to 1.5 if the frame-time EMA exceeds 17 ms for 120 consecutive frames.

### 3.3 Asset Strategy — Procedural Everything

**No external 3D model files at all.** Every mesh is built at boot from Three.js primitives, merged and vertex-colored:

- **Vertex-color low-poly kit:** all materials are ~three shared `MeshLambertMaterial({ vertexColors: true })` instances. Color lives in geometry, so hundreds of visually distinct props share materials → minimal state changes.
- **Procedural prop generators** (`makeWreckedCar(seed)`, `makeGrate(seed)`, `makeStreetlamp(seed)`): compose Box/Cylinder primitives, apply seeded vertex jitter (±4% on positions) so no two wrecks are identical, bake grime as darkened vertex bands, then `BufferGeometryUtils.mergeGeometries` into one buffer per prop archetype.
- **Instancing:** every repeated element — lane tiles, cars, grates, fence posts, ash debris — is an `InstancedMesh` per archetype with per-instance color. The entire visible world targets **≤ 30 draw calls**.
- **Silent Hill grain without post-processing:** a full-screen film-grain/vignette quad rendered last (additive noise `ShaderMaterial`, `depthTest: false`, animated by a time uniform). One draw call versus a full `EffectComposer` pipeline — on mobile, avoiding the extra framebuffer pass is worth ~2 ms.
- **Textures:** exactly one 512² procedurally-generated-at-boot noise atlas (canvas-generated, uploaded once) used by the beam, grain, and ash shaders. Zero texture downloads.
- **The Patroller** (Section 4.1) is the one "hero" asset: an articulated primitive-built humanoid (8 boxes, hierarchical transforms, ~2-bone procedural walk cycle driven by sine phase). Deliberately stiff and wrong-looking — mannequin uncanny is the aesthetic, and it costs nothing.
- **Audio:** Web Audio API, no library. Loops (drone, rail hum, ash wind) as small Opus files with CAF fallback for iOS Safari; one-shots synthesized (filtered noise bursts for hops/thuds). A single `ConvolverNode` with a tiny generated impulse response supplies the "outdoors but claustrophobic" tail.

---

## 4. FAIL-STATES & PROGRESSION HIERARCHY

### 4.1 Threat Taxonomy & Patrol Logic

Three behavioral tiers, all operating on grid logic (never continuous steering — hazards must remain readable):

1. **Kinematic hazards** (cars, grates, train): constant-velocity lane-bound movement, deterministic from `(seed, lane, tick)`. Collision = lethal cell overlap (or, for grates, *absence* of overlap). Speed per lane sampled at lane spawn from a depth-scaled range.
2. **The Patroller** (mire lanes): a grid-walker moving 1 cell per N ticks along its lane, reversing at edges. **Reactive rule:** if the player enters the same lane, it re-targets toward the player's column; N shrinks with sanity (Section 4.2). It kills on cell contact but *cannot leave its lane* — pressure, always escapable, always readable.
3. **The Static** (rear fog wall): row-based, unkillable, advances `staticRow` at `0.004 + depth · k` rows/tick. Punishes camping; its distance is telegraphed by rear fog density and a rising audio hiss rather than any UI element.

**Fail-states:** vehicle/patroller cell overlap → death; standing on `GRATE_GAP` floor when no grate occupies the cell at tick end → fall; `player.row < staticRow` → consumed; sanity floor → breakdown (below).

Death is diegetic: fog snaps to density 0.6, flashlight gutters out over 20 ticks, then results. Deterministic seed + input log means the death replay is a free feature (re-simulate last 300 ticks from snapshot).

### 4.2 The Sanity Meter — Error-Driven Intensity Scaling

Sanity `S ∈ [0, 100]` is a hidden pressure system driven by **structural player errors**, not time:

| Event | ΔS |
|---|---|
| Illegal-move bump (wall/edge) | −4 |
| Near-miss (hazard passes through an 8-way adjacent cell) | −6 |
| Retreat hop (`RETREAT` intent) | −2 |
| Idle > 3 s on a non-rest lane | −1.5/s |
| Riding a grate to lane completion | +3 |
| 5 consecutive clean forward hops | +8 (streak resets on any error) |
| Reaching an `ASH_FIELD` rest lane | +10, clamped |

Design intent: **panic is punished, composure is rewarded** — hesitation and scrambling (the natural fear responses) are exactly what feeds the system, making the horror self-inflicted.

**Sanity drives four output channels**, each a smoothed mapping (never stepped, so the player feels the world closing in rather than seeing a difficulty slider):

```ts
// Sanity.ts — evaluated once per tick, consumed by other systems
threatSpeedMul  = lerp(1.0, 1.45, (100 - S) / 100);  // hazard velocity scale (new spawns only — see audit rule)
patrollerPeriod = lerp(24, 10, (100 - S) / 100);      // ticks per patroller step
fogDensityBias  = lerp(0.0, 0.07, (100 - S) / 100);   // added to FogDirector target
restLaneInterval= Math.round(lerp(5, 8, (100 - S) / 100)); // rest lanes get rarer
```

Below S = 25, perceptual-only distortions activate: audio detunes ±30 cents, the film-grain uniform doubles, the flashlight flickers on a Poisson schedule, and phantom silhouettes (fog-colored, non-colliding, 0-cost) appear at the fog edge. **None of these change collision truth** — the game gets *scarier*, not unfairly harder, at the perceptual layer. At S = 0: 3-second "breakdown" (input locked, fog whiteout) that costs distance against The Static — survivable, but terrifying, and it resets S to 40.

**Progression:** score = max row depth. Milestone rows unlock cosmetic-only flashlight tints and start-shrine checkpoints every 50 rows (run restarts there with baseline sanity). No upgrades that alter scoring/threat math — depth is the only difficulty axis, keeping leaderboard runs comparable.

---

## 5. SELF-VERIFICATION PROTOCOL

The engine runs a **per-tick invariant auditor** (`audit/Invariants.ts`) — the same class of guarantee as an ECS sanity pass, tuned so its cost is unmeasurable (< 0.05 ms; it's integer comparisons over pooled arrays).

### 5.1 Invariant Set (evaluated every sim tick, after all systems update)

```ts
export function verify(sim: SimState): void {
  const p = sim.player;

  // I1 — GRID ALIGNMENT: authoritative player state is always integral & in bounds
  assert(Number.isInteger(p.col) && Number.isInteger(p.row), 'I1a: fractional grid state');
  assert(p.col >= -3 && p.col <= 3, 'I1b: column out of bounds');

  // I2 — TWEEN COHERENCE: a visual hop must terminate exactly on its target cell
  if (p.hop) {
    assert(p.hop.tick <= HOP_TICKS, 'I2a: hop overran duration');
    assert(cellEq(p.hop.to, { col: p.col, row: p.row }), 'I2b: hop target ≠ sim cell');
  } else {
    // when idle, render position must sit within ε of the authoritative cell
    const w = gridToWorld(p.col, p.row);
    assert(dist2(p.renderPos, w) < EPS2, 'I2c: idle drift from grid'); // ε = 1e-3
  }

  // I3 — TUNNELING GUARD: swept collision, not point sampling.
  // For every hazard in the player's row, test 1D segment overlap between the
  // hazard's [x(t-1), x(t)] sweep and the player's cell interval. A hazard
  // moving fast enough to cross a whole cell in one tick still registers.
  for (const h of sim.lanes.hazardsInRow(p.row)) {
    const sweep = interval(h.prevX, h.x).expand(h.halfWidth);
    if (sweep.overlaps(cellInterval(p.col))) sim.kill(DeathCause.HAZARD, h);
  }
  // Sim-rate cap makes tunneling structurally impossible as well:
  // build-time assert: maxHazardSpeed * SIM_DT < CELL  (hazards can never
  // skip a cell between ticks, so the sweep test is belt-and-suspenders)

  // I4 — RIDE CONSISTENCY (grate lanes): the player is either standing on a
  // grate whose interval contains their cell center, or they are falling.
  if (sim.lanes.archetype(p.row) === 'GRATE_GAP' && !p.hop) {
    const carrier = sim.lanes.grateUnder(p.col, p.row);
    assert(carrier === p.riding, 'I4a: riding-pointer mismatch');
    if (!carrier) sim.kill(DeathCause.FALL);
    else p.col = worldToCol(carrier.x + p.rideOffset); // re-quantize each tick:
    // riders never accumulate float error, and being carried off-grid
    // (|col| > 3) is a scripted death (dragged into the fog), not a stuck state.
  }

  // I5 — LANE TOPOLOGY: ring buffer must cover a contiguous, gap-free row range
  assert(sim.lanes.isContiguous(), 'I5a: lane ring buffer gap');
  assert(sim.lanes.minRow <= p.row && p.row <= sim.lanes.maxRow, 'I5b: player outside lane window');

  // I6 — NO STUCK STATES: from the player's cell, at least one of the 4 moves
  // must be legal OR the player must be on a moving carrier. Checked at lane
  // generation (flood-fill reachability) and re-checked live here.
  assert(sim.legalMoves(p).length > 0 || p.riding !== null, 'I6: player entombed');

  // I7 — DETERMINISM SEAL (dev builds): xor-fold of (tick, player cell, every
  // hazard's quantized x) into a rolling checksum. Replaying the input log
  // must reproduce the identical checksum stream.
  if (DEV) sim.checksum = fold(sim.checksum, sim.stateHash());
}
```

### 5.2 Failure Policy

- **Dev builds:** any assert throws, freezes the sim, and dumps `{ seed, tick, inputLog, snapshot }` to console + `localStorage` — a one-tap repro bundle.
- **Production builds:** asserts don't throw; they **self-heal + report**. I1/I2 violations snap the player to the nearest legal cell and cancel the tween; I5 forces a lane-window rebuild around the player; the event is counted into a session diagnostics blob. The player experiences at worst a one-frame correction; they never clip, never get stuck, never crash.
- **Speed-change safety rule:** sanity's `threatSpeedMul` applies only to *newly spawned* hazards; live hazards never change velocity mid-lane. This preserves the I3 build-time speed cap and means a player's read of a lane is never invalidated after they commit to a hop.

### 5.3 Test Harness

- **Headless sim:** the entire `world/` + `player/` layer imports zero Three.js and runs in Vitest under Node. CI runs 10,000-tick fuzz sessions (random valid inputs, random seeds) asserting the full invariant set and zero heap growth after warm-up (pool discipline check via `performance.memory` delta on Chrome runner).
- **Golden replays:** recorded input logs with expected checksum streams (I7) guard against any refactor silently changing simulation behavior.
- **Device gate:** a 60-second scripted run on a mid-tier Android reference (e.g. Pixel 6a-class) must hold p95 frame time < 16.7 ms and < 32 draw calls before any release tag.

---

## Deployment Pipeline (GitHub Pages)

1. `vite build` — content-hashed assets, SW manifest injection, `base: './'` for repo-relative paths.
2. CI: typecheck (strict), Vitest headless-sim suite, bundle-size gate (fail > 3 MB precache).
3. Push `dist/` to `gh-pages` branch via `actions/deploy-pages`. HTTPS (required for SW + PWA install) is automatic.
4. Post-deploy smoke: Lighthouse PWA audit ≥ installable, offline-start check via Playwright with network disabled.

**Total runtime dependency count: 1 (three).** Everything else is platform.
