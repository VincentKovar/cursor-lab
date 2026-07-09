# PACOOM

**RIP & CHOMP.** A 3D first-person shooter fusing classic Pac-Man mechanics with the dark industrial atmosphere of Doom — built with Three.js, WebGL post-processing bloom, and fully procedural WebAudio sound.

## Play

Any static server works (ES modules require http, not file://):

```bash
python3 -m http.server 4173
# open http://localhost:4173
```

Three.js loads from the jsDelivr CDN, so an internet connection is required on first load.

## Controls

| Input | Action |
|---|---|
| WASD | Move |
| Mouse | Look |
| Left click | Fire plasma shotgun |
| Shift | Sprint |

## How it works

- Collect all **235 plasma spheres** in the neon labyrinth to win.
- Four **cyber-demons** — Blinky (red, relentless hunter), Pinky (pink, ambushes ahead of you), Inky (cyan, erratic), Clyde (orange, cowardly) — float through the maze leaving neon trails. Contact costs 20% health.
- Your shotgun can't hurt them... until you grab a **Super-Charged Plasma Core** (the pulsing blue icosahedra in the four corners). The lights strobe red, an industrial metal riff kicks in, and for 10 seconds the demons turn blue, fractured, and killable (+200 each). They respawn from the central pen — stay moving.
- HUD: health (bottom-left), pellets remaining + score (bottom-right), live tactical minimap (top-center).

## Tech

- **Three.js** (r160) — instanced maze geometry, procedural canvas textures, PMREM environment reflections, UnrealBloomPass.
- **WebAudio** — every sound is synthesized at runtime: pickup blips, shotgun blast (filtered noise + sub thump + pump rack), damage growls, ghost obliteration, ambient dread-drone, and a tanh-waveshaped power-chord riff for power mode.
- No build step, no dependencies to install. Three files: `index.html`, `style.css`, `game.js`.
