import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ============================================================
// MAZE — left half (11 cols); mirrored to 21x21.
// # wall  . pellet  P power core  G ghost spawn  S player spawn
// ============================================================
const HALF = [
  '###########',
  '#P.........',
  '#.###.###.#',
  '#.........#',
  '#.###.#.#.#',
  '#.....#.#..',
  '#####.#.#.#',
  '#.....#....',
  '#.###.###.#',
  '#.#...##...',
  '#.....#.GG.',
  '#.#...##...',
  '#.###.#.#.#',
  '#.........#',
  '#.#.###.#..',
  '#.#.#...#.#',
  '#...#.#....',
  '###.#.#.#.#',
  '#.....#....',
  '#P........S',
  '###########',
];
const MAZE = HALF.map(row => {
  const full = row.split('');
  for (let c = 0; c < 10; c++) {
    let ch = row[c];
    if (ch === 'S') ch = '.';
    full[20 - c] = ch;
  }
  return full.join('');
});
const ROWS = MAZE.length, COLS = MAZE[0].length;
const CELL = 4, WALL_H = 5;
// interior bounds (cell centers of the innermost walkable ring) — a hard backstop
// that keeps ghosts from ever leaving the maze even if grid logic hiccups.
const MAZE_MIN_X = (1 - COLS / 2 + 0.5) * CELL, MAZE_MAX_X = (COLS - 2 - COLS / 2 + 0.5) * CELL;
const MAZE_MIN_Z = (1 - ROWS / 2 + 0.5) * CELL, MAZE_MAX_Z = (ROWS - 2 - ROWS / 2 + 0.5) * CELL;

const isWall = (r, c) => r < 0 || c < 0 || r >= ROWS || c >= COLS || MAZE[r][c] === '#';
const cellToWorld = (r, c) => new THREE.Vector3((c - COLS / 2 + 0.5) * CELL, 0, (r - ROWS / 2 + 0.5) * CELL);
const worldToCell = (p) => ({ r: Math.floor(p.z / CELL + ROWS / 2), c: Math.floor(p.x / CELL + COLS / 2) });

// ============================================================
// AUDIO — fully procedural WebAudio
// ============================================================
const AudioSys = {
  ctx: null, master: null, riffTimer: null, droneNodes: [],
  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.startDrone();
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  startDrone() {
    const t = this.ctx.currentTime;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 160; lp.Q.value = 6;
    const g = this.ctx.createGain(); g.gain.value = 0.10;
    lp.connect(g); g.connect(this.master);
    [[36.7, 'sawtooth'], [36.9, 'sawtooth'], [55.0, 'triangle']].forEach(([f, type]) => {
      const o = this.ctx.createOscillator();
      o.type = type; o.frequency.value = f; o.start(t);
      o.connect(lp); this.droneNodes.push(o);
    });
    const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
    lfo.frequency.value = 0.07; lg.gain.value = 90;
    lfo.connect(lg); lg.connect(lp.frequency); lfo.start(t);
  },
  blip() {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(1760, t + 0.05);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.1);
  },
  noiseBuf() {
    if (this._nb) return this._nb;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return (this._nb = buf);
  },
  shotgun() {
    const t = this.ctx.currentTime;
    // noise blast
    const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuf();
    const nf = this.ctx.createBiquadFilter(); nf.type = 'lowpass';
    nf.frequency.setValueAtTime(3200, t);
    nf.frequency.exponentialRampToValueAtTime(120, t + 0.28);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.55, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    n.connect(nf); nf.connect(ng); ng.connect(this.master);
    n.start(t); n.stop(t + 0.35);
    // sub thump
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.2);
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.3);
    // mechanical pump
    const p = this.ctx.createBufferSource(); p.buffer = this.noiseBuf();
    const pf = this.ctx.createBiquadFilter(); pf.type = 'bandpass'; pf.frequency.value = 1800; pf.Q.value = 4;
    const pg = this.ctx.createGain();
    pg.gain.setValueAtTime(0, t + 0.3);
    pg.gain.linearRampToValueAtTime(0.25, t + 0.34);
    pg.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    p.connect(pf); pf.connect(pg); pg.connect(this.master);
    p.start(t + 0.3); p.stop(t + 0.5);
  },
  hurt() {
    // pained "yelp" — quick upward flick then a hard downward cry, plus a
    // sharp impact transient up front, so demon damage reads distinctly more
    // "ouchy" than the plain wall-bump grunt() below.
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(280, t);
    o.frequency.exponentialRampToValueAtTime(460, t + 0.035);
    o.frequency.exponentialRampToValueAtTime(85, t + 0.32);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.45, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.36);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.4);
    // sharp noise punch on impact
    const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuf();
    const nf = this.ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 1.4;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.28, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    n.connect(nf); nf.connect(ng); ng.connect(this.master);
    n.start(t); n.stop(t + 0.09);
  },
  grunt() {
    // short pained "unh" when the player smacks a wall
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(78, t + 0.14);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.2);
    // breathy exhale
    const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuf();
    const nf = this.ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 520; nf.Q.value = 1.2;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.12, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    n.connect(nf); nf.connect(ng); ng.connect(this.master);
    n.start(t); n.stop(t + 0.16);
  },
  clone() {
    // digital "split" chirp — two detuned square blips, so a duplication
    // reads distinctly from the plain immune-hit feedback.
    const t = this.ctx.currentTime;
    [0, 7].forEach((detune, i) => {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'square';
      o.detune.value = detune;
      o.frequency.setValueAtTime(520, t + i * 0.03);
      o.frequency.exponentialRampToValueAtTime(1400, t + i * 0.03 + 0.14);
      g.gain.setValueAtTime(0.0001, t + i * 0.03);
      g.gain.exponentialRampToValueAtTime(i === 0 ? 0.22 : 0.16, t + i * 0.03 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.03 + 0.22);
      o.connect(g); g.connect(this.master);
      o.start(t + i * 0.03); o.stop(t + i * 0.03 + 0.25);
    });
  },
  growl(proximity = 1) {
    // low guttural demon growl — plays when a ghost is close to the player,
    // even through walls, so proximity is felt without needing line of sight.
    // `proximity` in [0,1]: 1 = right on top of the player, 0 = at growl range.
    const t = this.ctx.currentTime;
    const vol = 0.12 + proximity * 0.22;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(58 + proximity * 20, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.08);
    g.gain.setValueAtTime(vol, t + 0.28);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    // tremolo growl texture
    const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
    lfo.frequency.value = 18; lg.gain.value = 0.08;
    lfo.connect(lg); lg.connect(g.gain); lfo.start(t); lfo.stop(t + 0.5);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.52);
    // gravelly noise bed
    const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuf();
    const nf = this.ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 200; nf.Q.value = 0.8;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(vol * 0.5, t + 0.08);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
    n.connect(nf); nf.connect(ng); ng.connect(this.master);
    n.start(t); n.stop(t + 0.5);
  },
  klaxon() {
    // 1.5s two-tone alarm when the exit door appears
    const t = this.ctx.currentTime;
    const dur = 1.5, toneLen = 0.28;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200;
    const master = this.ctx.createGain(); master.gain.value = 0.3;
    f.connect(master); master.connect(this.master);
    for (let ti = 0; ti * toneLen < dur; ti++) {
      const start = t + ti * toneLen;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = ti % 2 === 0 ? 880 : 660;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(1, start + 0.02);
      g.gain.setValueAtTime(1, start + toneLen - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, start + toneLen);
      o.connect(g); g.connect(f);
      o.start(start); o.stop(start + toneLen);
    }
  },
  ghostDie() {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(1200, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.5);
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.6);
    const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuf();
    const nf = this.ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 2000;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.2, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    n.connect(nf); nf.connect(ng); ng.connect(this.master);
    n.start(t); n.stop(t + 0.45);
  },
  // Heavy industrial power-riff: distorted power chords, 10s
  riffNote(t, freq, dur) {
    const ws = this.ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 6); }
    ws.curve = curve;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.setValueAtTime(0.28, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2500;
    ws.connect(f); f.connect(g); g.connect(this.master);
    [1, 1.5, 2.003].forEach(mult => {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = freq * mult;
      o.connect(ws); o.start(t); o.stop(t + dur);
    });
    // kick under each note
    const k = this.ctx.createOscillator(), kg = this.ctx.createGain();
    k.type = 'sine';
    k.frequency.setValueAtTime(150, t);
    k.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    kg.gain.setValueAtTime(0.5, t);
    kg.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    k.connect(kg); kg.connect(this.master);
    k.start(t); k.stop(t + 0.2);
  },
  powerRiff() {
    const E = 41.2, G = 49.0, A = 55.0, C = 65.4;
    const pattern = [E, E, G, E, E, A, G, E, E, E, C, A, G, E, G, A];
    const step = 0.22;
    const t0 = this.ctx.currentTime + 0.05;
    for (let rep = 0; rep < 3; rep++) {
      pattern.forEach((f, i) => this.riffNote(t0 + (rep * 16 + i) * step, f, step * 0.9));
    }
  },
  win() {
    const t = this.ctx.currentTime;
    [261.6, 329.6, 392, 523.3, 659.3, 784].forEach((f, i) => {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0.15, t + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.4);
      o.connect(g); g.connect(this.master);
      o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.45);
    });
  },
};

// ============================================================
// SCENE
// ============================================================
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02040a);
scene.fog = new THREE.FogExp2(0x02040a, 0.035);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 200);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.3, 0.3);
composer.addPass(bloom);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// Lighting
const hemi = new THREE.HemisphereLight(0x2244aa, 0x0a0510, 0.9);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0x18243a, 2.0);
scene.add(ambient);

// ---- Textures (procedural canvas) ----
function makeWallTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#141820'; g.fillRect(0, 0, 256, 256);
  // metal panels
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const shade = 16 + Math.floor(Math.random() * 14);
    g.fillStyle = `rgb(${shade},${shade + 4},${shade + 10})`;
    g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(x * 64 + 2, y * 64 + 58, 60, 4);
  }
  // rivets
  g.fillStyle = '#3a4250';
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    g.beginPath(); g.arc(x * 64 + 8, y * 64 + 8, 2.5, 0, 7); g.fill();
    g.beginPath(); g.arc(x * 64 + 56, y * 64 + 56, 2.5, 0, 7); g.fill();
  }
  // grime streaks
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.25})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 10 + Math.random() * 40);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
function makeFloorTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#0c0e14'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(0,180,220,0.18)'; g.lineWidth = 2;
  g.strokeRect(4, 4, 248, 248);
  g.strokeStyle = 'rgba(60,70,90,0.4)'; g.lineWidth = 1;
  for (let i = 32; i < 256; i += 32) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
  }
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.3})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 3 + Math.random() * 6, 3 + Math.random() * 6);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---- Floor & ceiling ----
const floorTex = makeFloorTexture();
floorTex.repeat.set(COLS, ROWS);
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(COLS * CELL, ROWS * CELL),
  new THREE.MeshStandardMaterial({ map: floorTex, metalness: 0.8, roughness: 0.5, envMapIntensity: 0.55 })
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const ceil = new THREE.Mesh(
  new THREE.PlaneGeometry(COLS * CELL, ROWS * CELL),
  new THREE.MeshStandardMaterial({ color: 0x05070c, metalness: 0.6, roughness: 0.8 })
);
ceil.rotation.x = Math.PI / 2;
ceil.position.y = WALL_H;
scene.add(ceil);

// env map for metallic sheen
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.background = new THREE.Color(0x0a1428);
const el1 = new THREE.Mesh(new THREE.SphereGeometry(5), new THREE.MeshBasicMaterial({ color: 0x0088ff }));
el1.position.set(20, 10, 0); envScene.add(el1);
const el2 = new THREE.Mesh(new THREE.SphereGeometry(5), new THREE.MeshBasicMaterial({ color: 0xff2266 }));
el2.position.set(-20, 10, 10); envScene.add(el2);
scene.environment = pmrem.fromScene(envScene, 0.04).texture;

// ---- Walls (instanced) + neon trim ----
const wallCells = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (MAZE[r][c] === '#') wallCells.push([r, c]);

const wallTex = makeWallTexture();
const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, metalness: 0.6, roughness: 0.55, envMapIntensity: 0.5 });
const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);
const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallCells.length);
{
  const m = new THREE.Matrix4();
  wallCells.forEach(([r, c], i) => {
    const p = cellToWorld(r, c);
    m.makeTranslation(p.x, WALL_H / 2, p.z);
    walls.setMatrixAt(i, m);
  });
}
scene.add(walls);

// neon trim: glowing strip along wall bases facing corridors
const trimMat = new THREE.MeshBasicMaterial({ color: 0x0086bb });
const trimGeo = new THREE.BoxGeometry(CELL, 0.09, CELL);
const trims = new THREE.InstancedMesh(trimGeo, trimMat, wallCells.length * 2);
{
  const m = new THREE.Matrix4();
  wallCells.forEach(([r, c], i) => {
    const p = cellToWorld(r, c);
    m.makeScale(1.02, 1, 1.02).setPosition(p.x, 0.25, p.z);
    trims.setMatrixAt(i * 2, m);
    m.makeScale(1.02, 1, 1.02).setPosition(p.x, WALL_H - 0.25, p.z);
    trims.setMatrixAt(i * 2 + 1, m);
  });
}
scene.add(trims);

// industrial pipes along some corridor ceilings
const pipeMat = new THREE.MeshStandardMaterial({ color: 0x2a3040, metalness: 0.9, roughness: 0.3 });
for (let r = 1; r < ROWS - 1; r += 4) {
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, COLS * CELL, 8), pipeMat);
  pipe.rotation.z = Math.PI / 2;
  pipe.position.set(0, WALL_H - 0.5, (r - ROWS / 2 + 0.5) * CELL);
  scene.add(pipe);
}

// sparse colored point lights in corridors
const lightSpots = [[3, 3], [3, 17], [10, 10], [17, 3], [17, 17], [7, 10], [13, 10], [10, 3], [10, 17]];
const corridorLights = [];
lightSpots.forEach(([r, c], i) => {
  if (isWall(r, c)) return;
  const p = cellToWorld(r, c);
  const col = i % 3 === 0 ? 0xff2255 : i % 3 === 1 ? 0x00aaff : 0x8833ff;
  const l = new THREE.PointLight(col, 4, 14, 1.8);
  l.position.set(p.x, WALL_H - 1, p.z);
  scene.add(l);
  corridorLights.push({ light: l, baseColor: new THREE.Color(col), baseIntensity: 4 });
});

// ============================================================
// PELLETS & POWER CORES
// ============================================================
const pellets = []; // {r,c,pos,alive,idx}
const cores = [];   // {mesh,light,pos,alive}
let ghostSpawns = [], playerSpawn = null;

for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const ch = MAZE[r][c];
  const p = cellToWorld(r, c);
  if (ch === '.') pellets.push({ r, c, pos: p, alive: true, idx: pellets.length });
  else if (ch === 'P') cores.push({ pos: p, alive: true });
  else if (ch === 'G') ghostSpawns.push(p);
  else if (ch === 'S') playerSpawn = p;
}

const pelletGeo = new THREE.SphereGeometry(0.22, 12, 12);
const pelletMat = new THREE.MeshBasicMaterial({ color: 0xffee33 });
const pelletMesh = new THREE.InstancedMesh(pelletGeo, pelletMat, pellets.length);
scene.add(pelletMesh);
const _m4 = new THREE.Matrix4();
function updatePellets(t) {
  pellets.forEach((p, i) => {
    if (!p.alive) { _m4.makeScale(0, 0, 0); }
    else {
      const bob = Math.sin(t * 2.5 + p.idx * 0.7) * 0.15;
      const s = 1 + Math.sin(t * 4 + p.idx) * 0.15;
      _m4.makeScale(s, s, s).setPosition(p.pos.x, 1.1 + bob, p.pos.z);
    }
    pelletMesh.setMatrixAt(i, _m4);
  });
  pelletMesh.instanceMatrix.needsUpdate = true;
}

cores.forEach(core => {
  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.7, 1),
    new THREE.MeshStandardMaterial({ color: 0x33ddff, emissive: 0x00aaff, emissiveIntensity: 2.5, metalness: 0.4, roughness: 0.2 })
  );
  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.95, 1),
    new THREE.MeshBasicMaterial({ color: 0x66eeff, wireframe: true, transparent: true, opacity: 0.6 })
  );
  mesh.add(shell);
  mesh.position.set(core.pos.x, 1.4, core.pos.z);
  scene.add(mesh);
  const light = new THREE.PointLight(0x00ccff, 8, 14, 1.5);
  light.position.copy(mesh.position);
  scene.add(light);
  core.mesh = mesh; core.light = light;
});

// ============================================================
// GHOSTS — cyber-demons
// ============================================================
// First 4 are active from the start. The last 3 are reinforcements that join
// the hunt as the player clears the maze (50% / 75% / 100% of the pellets).
// behavior tags layer a second AI trait on top of the base chase weight:
//   aggro  — jitter (see AGGRO_RADIUS below) tightens up at close range, so
//            the ghost reliably turns onto the player instead of wandering past
//   corner — paths by real shortest-grid-distance (BFS) instead of straight-line
//            distance, so it doesn't get fooled by walls near the target
//   burst  — periodically sprints when it gets close (see BURST_* below)
// CLYDE and REAPER are left with the plain straight-line greedy behavior.
const GHOST_DEFS = [
  { name: 'BLINKY', color: 0xff2222, chase: 1.0, behavior: 'aggro' },   // pure hunter
  { name: 'PINKY', color: 0xff44cc, chase: 0.85, behavior: 'corner' },  // ambusher (targets ahead)
  { name: 'INKY', color: 0x22ddff, chase: 0.75, behavior: 'corner' },
  { name: 'CLYDE', color: 0xff9922, chase: 0.6 },
  { name: 'SPECTRE', color: 0x88ff44, chase: 0.9, behavior: 'burst' }, // reinforcement @ 50%
  { name: 'WRAITH', color: 0xff5500, chase: 0.95, behavior: 'burst' }, // reinforcement @ 75%
  { name: 'REAPER', color: 0xaa00ff, chase: 1.0 },   // reinforcement @ 100%
];
const BASE_GHOSTS = 4;
// Max simultaneous ghosts (base 7 + clones) — keeps light/particle count and
// clone chaos bounded.
const GHOST_CAP = 10;
// Chance a shot into a non-vulnerable ("immune") ghost splits off a clone.
const CLONE_CHANCE = 0.35;
// Chase-commitment multiplier: ghosts ease off (drop to 0.92x speed) less often,
// so they pursue more relentlessly. Commitment probability is still capped at
// 1.0. Was stacked to 1.18 * 1.15 (+35.7%) while ghosts were still stuck near
// their spawn (see the movement-freeze fix above) to compensate for them
// barely moving. Now that they actually reach the player, that stacked value
// reads as too relentless — dropped back to just the first +18% layer so
// mid-pack ghosts (INKY, CLYDE, and now PINKY/SPECTRE/WRAITH too) fall back
// under the cap and regain their speed-dropout variance.
const AGGRO = 1.18;
// Base chase speed. Was boosted 15% on top of the original 3.4 units/s for
// the same stuck-ghost-compensation reason above; trimmed to +8% now that
// movement actually works.
const CHASE_SPEED = 3.4 * 1.08;
// Extra speed multiplier at 100% pellet progress (e.g. 0.6 = up to +60% faster).
const HUNT_SPEED_RAMP = 0.6;
// World-unit radius within which a hunting ghost growls at the player, even
// through walls — proximity dread without needing line of sight.
const GROWL_RANGE = CELL * 3;
const FRIGHT_COLOR = 0x2244ff;
// 'aggro' behavior: within this radius, direction-choice jitter scales down
// (to AGGRO_MIN_JITTER at the closest) so the ghost reliably turns onto the
// player instead of the randomization drowning out the chase signal. Kept
// above zero on purpose — reads as "alert", not unavoidable.
const AGGRO_RADIUS = CELL * 2;
const AGGRO_MIN_JITTER = 0.15;
// 'burst' behavior: sprint speed multiplier, trigger radius, duration and
// cooldown. Multiplier is capped well below what could tunnel through a
// 1-cell-thick wall given the engine's dt clamp (game.js tick(), 0.05s max).
const BURST_TRIGGER_RADIUS = CELL * 3;
const BURST_SPEED_MUL = 1.7;
const BURST_DURATION = 1.1;
const BURST_COOLDOWN = 4.5;

function buildGhostMesh(color) {
  const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 1.6,
    metalness: 0.3, roughness: 0.35, transparent: true, opacity: 0.92,
  });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  head.position.y = 0.3;
  grp.add(head);
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, 0.9, 16, 1, true), mat);
  skirt.position.y = -0.15;
  grp.add(skirt);
  // fractured armor plates
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x111318, metalness: 0.95, roughness: 0.25 });
  for (let i = 0; i < 5; i++) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 0.06), plateMat);
    const a = (i / 5) * Math.PI * 2;
    plate.position.set(Math.cos(a) * 0.72, -0.1, Math.sin(a) * 0.72);
    plate.lookAt(0, -0.1, 0);
    grp.add(plate);
  }
  // horns
  const hornMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, metalness: 0.9, roughness: 0.3 });
  [-1, 1].forEach(s => {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.55, 8), hornMat);
    horn.position.set(0.35 * s, 0.95, 0);
    horn.rotation.z = -0.5 * s;
    grp.add(horn);
  });
  // eyes
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  [-1, 1].forEach(s => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), eyeMat);
    eye.position.set(0.26 * s, 0.45, 0.55);
    grp.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), pupilMat);
    pupil.position.set(0.26 * s, 0.45, 0.68);
    grp.add(pupil);
  });
  // wireframe overlay for frightened "fractured" state
  const fright = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.0, 1),
    new THREE.MeshBasicMaterial({ color: 0x66aaff, wireframe: true, transparent: true, opacity: 0.9 })
  );
  fright.visible = false;
  grp.add(fright);
  return { grp, mat, fright };
}

// Shortest-path grid distance from (originR, originC) to every reachable cell,
// for 'corner' behavior ghosts. The maze is small (21x21) and this only runs
// at cell-center decision points, so a fresh BFS per decision is cheap.
function bfsDistanceGrid(originR, originC) {
  const dist = Array.from({ length: ROWS }, () => new Array(COLS).fill(Infinity));
  if (isWall(originR, originC)) return dist;
  dist[originR][originC] = 0;
  const queue = [[originR, originC]];
  for (let qi = 0; qi < queue.length; qi++) {
    const [r, c] = queue[qi];
    const d = dist[r][c];
    for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nr = r + dr, nc = c + dc;
      if (isWall(nr, nc) || dist[nr][nc] !== Infinity) continue;
      dist[nr][nc] = d + 1;
      queue.push([nr, nc]);
    }
  }
  return dist;
}

const trailGeo = new THREE.PlaneGeometry(0.7, 0.7);
class Ghost {
  constructor(def, spawn, active = true) {
    this.def = def;
    this.spawn = spawn.clone();
    this.active = active; // reinforcements start inactive until the maze is cleared
    const { grp, mat, fright } = buildGhostMesh(def.color);
    this.mesh = grp; this.mat = mat; this.frightMesh = fright;
    this.light = new THREE.PointLight(def.color, 5, 12, 1.8);
    this.mesh.add(this.light);
    scene.add(this.mesh);
    this.dir = new THREE.Vector3(1, 0, 0);
    this.trail = [];
    this.trailClock = 0;
    this.lastSafe = this.spawn.clone();
    this.growlCooldown = 0;
    this.isClone = false; // identity flag, not touched by reset() — used to sweep clones on restart
    this.reset();
  }
  reset() {
    this.pos = this.spawn.clone();
    this.lastSafe = this.spawn.clone();
    this.state = 'chase'; // chase | fright | dead
    this.deadTimer = 0;
    this.speed = CHASE_SPEED;
    this.growlCooldown = 0;
    this.burstTimer = 0;
    this.burstCooldown = 0;
    this.mesh.visible = this.active;
    this.applyLook(false);
  }
  activate() {
    this.active = true;
    this.reset();
    spawnExplosion(this.spawn.clone().setY(1.1), this.def.color, 24, 6);
  }
  applyLook(frightened) {
    if (frightened) {
      this.mat.color.set(FRIGHT_COLOR);
      this.mat.emissive.set(FRIGHT_COLOR);
      this.mat.emissiveIntensity = 1.2;
      this.light.color.set(FRIGHT_COLOR);
      this.frightMesh.visible = true;
    } else {
      this.mat.color.set(this.def.color);
      this.mat.emissive.set(this.def.color);
      this.mat.emissiveIntensity = 1.6;
      this.light.color.set(this.def.color);
      this.frightMesh.visible = false;
    }
  }
  targetPoint(player) {
    if (this.state === 'fright') return null;
    const t = player.pos.clone();
    if (this.def.name === 'PINKY') t.add(player.forward.clone().multiplyScalar(CELL * 3));
    if (this.def.name === 'CLYDE' && this.pos.distanceTo(player.pos) < CELL * 4) {
      return cellToWorld(ROWS - 2, 1); // retreats to corner when close
    }
    if (this.def.name === 'INKY') t.add(new THREE.Vector3(Math.sin(perfNow() * 0.3) * CELL * 2, 0, Math.cos(perfNow() * 0.3) * CELL * 2));
    return t;
  }
  update(dt, t, player, powerMode, progress = 0) {
    if (this.state === 'dead') {
      this.deadTimer -= dt;
      if (this.deadTimer <= 0) this.reset();
      return;
    }
    // proximity growl: hunting ghosts growl as they close in, audible through
    // walls (no line-of-sight check) so the player feels the threat before seeing it.
    this.growlCooldown = Math.max(0, this.growlCooldown - dt);
    if (this.state === 'chase' && this.growlCooldown <= 0) {
      const distToPlayer = this.pos.distanceTo(player.pos);
      if (distToPlayer < GROWL_RANGE) {
        const proximity = 1 - distToPlayer / GROWL_RANGE;
        AudioSys.growl(proximity);
        this.growlCooldown = 2.2 - proximity * 1.5; // closer -> growls more often
      }
    }
    // Chase commitment ramps from this ghost's base value up to a guaranteed
    // 100% as the player clears more pellets ("lights") — by a fully-cleared
    // maze, ghosts never ease off and always take the optimal chase direction.
    const baseCommit = Math.min(1, this.def.chase * AGGRO);
    const commit = baseCommit + (1 - baseCommit) * progress;
    // Hunt speed also climbs with pellet progress, up to +60% at 100% cleared.
    const huntSpeedMul = 1 + progress * HUNT_SPEED_RAMP;
    // 'burst' behavior: sprint for BURST_DURATION once the player is within
    // range, then cool down before it can trigger again.
    if (this.def.behavior === 'burst') {
      this.burstCooldown = Math.max(0, this.burstCooldown - dt);
      if (this.burstTimer > 0) {
        this.burstTimer -= dt;
      } else if (this.burstCooldown <= 0 && this.pos.distanceTo(player.pos) < BURST_TRIGGER_RADIUS) {
        this.burstTimer = BURST_DURATION;
        this.burstCooldown = BURST_COOLDOWN;
      }
    }
    const burstMul = this.def.behavior === 'burst' && this.burstTimer > 0 ? BURST_SPEED_MUL : 1;
    const speed = this.state === 'fright' ? 2.1 : this.speed * huntSpeedMul * burstMul * (Math.random() < commit ? 1 : 0.92);
    const cell = worldToCell(this.pos);

    // self-heal: if we've somehow ended up off-grid or inside a wall, snap back to
    // the last cell we knew was walkable (falls back to spawn) so ghosts can never
    // leak out of the maze.
    if (isWall(cell.r, cell.c)) {
      this.pos.copy(this.lastSafe);
      this.dir.set(1, 0, 0);
      this.mesh.position.set(this.pos.x, 1.1, this.pos.z);
      return;
    }
    this.lastSafe.copy(this.pos);

    const center = cellToWorld(cell.r, cell.c);
    const distToCenter = Math.hypot(this.pos.x - center.x, this.pos.z - center.z);

    if (distToCenter < speed * dt * 1.5) {
      // choose new direction at cell center
      const target = this.targetPoint(player);
      // 'corner' behavior: path by real shortest-grid-distance instead of
      // straight-line distance, so walls near the target don't fool it into
      // the wrong corner. Falls back to the player's own cell if the target
      // point (e.g. PINKY's ambush lead) lands inside a wall.
      let bfsGrid = null;
      if (this.def.behavior === 'corner' && this.state !== 'fright' && target) {
        let tc = worldToCell(target);
        if (isWall(tc.r, tc.c)) tc = worldToCell(player.pos);
        bfsGrid = bfsDistanceGrid(tc.r, tc.c);
      }
      // 'aggro' behavior: jitter shrinks as the player gets closer, so the
      // ghost's own chase signal stops getting drowned out right when it
      // matters most. Floored above zero — alert, not unavoidable.
      const jitterMag = this.def.behavior === 'aggro'
        ? 1.5 * Math.max(AGGRO_MIN_JITTER, Math.min(1, this.pos.distanceTo(player.pos) / AGGRO_RADIUS))
        : 1.5;
      const options = [];
      const dirs = [[0, 1, 1, 0], [0, -1, -1, 0], [1, 0, 0, 1], [-1, 0, 0, -1]]; // dr,dc,dx,dz
      for (const [dr, dc, dx, dz] of dirs) {
        const nr = cell.r + dr, nc = cell.c + dc;
        if (isWall(nr, nc)) continue;
        // avoid reversing unless forced
        if (dx === -Math.round(this.dir.x) && dz === -Math.round(this.dir.z) && Math.abs(dx) + Math.abs(dz) > 0) {
          options.push({ dx, dz, score: -Infinity });
          continue;
        }
        const next = cellToWorld(nr, nc);
        let score;
        if (this.state === 'fright') score = next.distanceTo(player.pos); // flee: farther is better
        else if (bfsGrid) score = -(bfsGrid[nr][nc] === Infinity ? 999 : bfsGrid[nr][nc]) * CELL;
        else if (target) score = -next.distanceTo(target); // chase: closer is better
        else score = Math.random();
        score += Math.random() * jitterMag; // jitter so they don't stack
        options.push({ dx, dz, score });
      }
      if (options.length) {
        options.sort((a, b) => b.score - a.score);
        const best = options[0].score === -Infinity ? options[options.length - 1] : options[0];
        this.dir.set(best.dx, 0, best.dz);
        // NOTE: deliberately not snapping pos to center here — this decision
        // re-triggers every frame near a center (distToCenter after one step
        // is always < the 1.5x threshold below), so resetting pos here made
        // ghosts unable to advance more than ~1 frame's movement from any
        // center. Position keeps advancing from wherever it actually is;
        // the wall-collision fallback below still snaps to center if needed.
      } else {
        // boxed in (shouldn't happen in this maze, but guard anyway): reverse
        // rather than freeze, so a ghost is never stationary
        this.dir.negate();
      }
    }
    // never step into a wall cell, regardless of timing/jitter
    const nextPos = this.pos.clone().addScaledVector(this.dir, speed * dt);
    const nextCell = worldToCell(nextPos);
    if (isWall(nextCell.r, nextCell.c)) {
      this.pos.copy(center);
    } else {
      this.pos.copy(nextPos);
    }
    // hard containment: clamp to the interior of the maze as an absolute backstop
    this.pos.x = Math.max(MAZE_MIN_X, Math.min(MAZE_MAX_X, this.pos.x));
    this.pos.z = Math.max(MAZE_MIN_Z, Math.min(MAZE_MAX_Z, this.pos.z));

    // float + face movement
    const bobY = 1.1 + Math.sin(t * 3 + this.def.color) * 0.18;
    this.mesh.position.set(this.pos.x, bobY, this.pos.z);
    if (this.dir.lengthSq() > 0.01) {
      const look = this.pos.clone().add(this.dir);
      this.mesh.lookAt(look.x, bobY, look.z);
    }
    // frightened blink near end
    if (this.state === 'fright') {
      const blink = powerMode.timer < 3 && Math.sin(t * 14) > 0;
      this.mat.emissive.set(blink ? 0xffffff : FRIGHT_COLOR);
    }
    // neon trail
    this.trailClock += dt;
    if (this.trailClock > 0.07) {
      this.trailClock = 0;
      const tp = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({
        color: this.state === 'fright' ? FRIGHT_COLOR : this.def.color,
        transparent: true, opacity: 0.5, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      tp.position.set(this.pos.x, 0.6, this.pos.z);
      tp.rotation.x = -Math.PI / 2;
      tp.userData.life = 0.6;
      scene.add(tp);
      this.trail.push(tp);
    }
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const tp = this.trail[i];
      tp.userData.life -= dt;
      tp.material.opacity = tp.userData.life * 0.8;
      tp.scale.setScalar(1 + (0.6 - tp.userData.life) * 1.5);
      if (tp.userData.life <= 0) {
        scene.remove(tp); tp.material.dispose();
        this.trail.splice(i, 1);
      }
    }
  }
  kill() {
    this.state = 'dead';
    this.deadTimer = 6;
    this.mesh.visible = false;
    spawnExplosion(this.pos.clone().setY(1.1), this.def.color);
    AudioSys.ghostDie();
  }
}

// Fully removes a ghost from the scene and frees its GPU resources — used to
// sweep cloned ghosts on restart, since the base 7 are otherwise permanent.
function disposeGhost(g) {
  scene.remove(g.mesh);
  g.mesh.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material.dispose();
    }
  });
  for (const tp of g.trail) { scene.remove(tp); tp.material.dispose(); }
  g.trail.length = 0;
}

// Build all 7 ghosts on the G cells. The first BASE_GHOSTS are active immediately;
// the rest are reinforcements that lie dormant until the player clears the maze.
const ghosts = GHOST_DEFS.map((def, i) => new Ghost(def, ghostSpawns[i % ghostSpawns.length].clone().add(
  new THREE.Vector3((i % 2) * 1.2 - 0.6, 0, Math.floor(i / 2) * 1.2 - 0.6)
), i < BASE_GHOSTS));

// ============================================================
// EXIT DOOR — a glowing yellow door that appears once the maze is 100% cleared.
// Reaching it wins the level.
// ============================================================
const DOOR_W = 2.0, DOOR_H = 3.6;
const exit = {
  active: false,
  group: null,
  pos: new THREE.Vector3(),   // world position of the door face
  cell: { r: 0, c: 0 },       // corridor cell in front of the door
  glowMat: null,
  light: null,
};
function buildDoor() {
  const grp = new THREE.Group();
  // frame
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1a1206, metalness: 0.8, roughness: 0.4 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W + 0.4, DOOR_H + 0.4, 0.3), frameMat);
  grp.add(frame);
  // glowing panel
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xffe93b, emissive: 0xffcc00, emissiveIntensity: 2.4, metalness: 0.3, roughness: 0.2,
  });
  const panel = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W, DOOR_H, 0.18), glowMat);
  panel.position.z = 0.12;
  grp.add(panel);
  // vertical seam + hardware so it reads as a real door
  const seamMat = new THREE.MeshBasicMaterial({ color: 0x2a1e00 });
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.06, DOOR_H - 0.2, 0.02), seamMat);
  seam.position.z = 0.22;
  grp.add(seam);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.3 }));
  handle.position.set(DOOR_W * 0.3, 0, 0.24);
  grp.add(handle);
  // EXIT chevrons above the door
  const chevMat = new THREE.MeshBasicMaterial({ color: 0xfff2a0 });
  for (let i = 0; i < 3; i++) {
    const chev = new THREE.Mesh(new THREE.BoxGeometry(0.5 - i * 0.12, 0.08, 0.05), chevMat);
    chev.position.set(0, DOOR_H / 2 + 0.35 + i * 0.16, 0.25);
    grp.add(chev);
  }
  const light = new THREE.PointLight(0xffdd44, 0, 16, 1.6);
  light.position.z = 1.0;
  grp.add(light);
  grp.visible = false;
  scene.add(grp);
  exit.group = grp; exit.glowMat = glowMat; exit.light = light;
}
buildDoor();

// Candidate outer-boundary wall cells whose inward neighbour is a corridor, so
// the door reads as a genuine way *out* of the maze.
function exitCandidates() {
  const out = [];
  const push = (wr, wc, cr, cc) => {
    if (isWall(wr, wc) && !isWall(cr, cc)) out.push({ wr, wc, cr, cc });
  };
  for (let c = 1; c < COLS - 1; c++) { push(0, c, 1, c); push(ROWS - 1, c, ROWS - 2, c); }
  for (let r = 1; r < ROWS - 1; r++) { push(r, 0, r, 1); push(r, COLS - 1, r, COLS - 2); }
  return out;
}
function placeExit() {
  const cands = exitCandidates();
  const pick = cands[Math.floor(Math.random() * cands.length)];
  const wallW = cellToWorld(pick.wr, pick.wc);
  const corrW = cellToWorld(pick.cr, pick.cc);
  // door sits on the wall face between the wall cell and the corridor cell
  exit.pos.set((wallW.x + corrW.x) / 2, DOOR_H / 2, (wallW.z + corrW.z) / 2);
  exit.cell = { r: pick.cr, c: pick.cc };
  exit.group.position.copy(exit.pos);
  // nudge the door a hair into the corridor and face it toward the player's path
  const nrm = new THREE.Vector3(corrW.x - wallW.x, 0, corrW.z - wallW.z).normalize();
  exit.group.position.addScaledVector(nrm, 0.06);
  exit.group.lookAt(corrW.x, DOOR_H / 2, corrW.z);
}
function openExit() {
  if (exit.active) return;
  placeExit();
  exit.active = true;
  exit.group.visible = true;
  document.getElementById('exit-panel').classList.remove('hidden');
  flashMsg('THE MAZE OPENS — FIND THE EXIT');
  AudioSys.klaxon();
}
function closeExit() {
  exit.active = false;
  if (exit.group) exit.group.visible = false;
  const panel = document.getElementById('exit-panel');
  if (panel) panel.classList.add('hidden');
}

// ============================================================
// PARTICLES (explosions / sparks)
// ============================================================
const particles = [];
const partGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
function spawnExplosion(pos, color, count = 40, speed = 7) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
  for (let i = 0; i < count; i++) {
    const p = new THREE.Mesh(partGeo, mat.clone());
    p.position.copy(pos);
    p.userData.vel = new THREE.Vector3(
      (Math.random() - 0.5), Math.random() * 0.8, (Math.random() - 0.5)
    ).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.6));
    p.userData.life = 0.5 + Math.random() * 0.5;
    p.scale.setScalar(1 + Math.random() * 2);
    scene.add(p);
    particles.push(p);
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.userData.life -= dt;
    p.userData.vel.y -= 12 * dt;
    p.position.addScaledVector(p.userData.vel, dt);
    if (p.position.y < 0.05) { p.position.y = 0.05; p.userData.vel.y *= -0.4; }
    p.material.opacity = Math.min(1, p.userData.life * 2);
    p.rotation.x += dt * 8; p.rotation.y += dt * 6;
    if (p.userData.life <= 0) {
      scene.remove(p); p.material.dispose();
      particles.splice(i, 1);
    }
  }
}

// ============================================================
// WEAPON — plasma shotgun (attached to camera)
// ============================================================
const gun = new THREE.Group();
{
  const metal = new THREE.MeshStandardMaterial({ color: 0x1c2028, metalness: 0.9, roughness: 0.3 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x0d0f14, metalness: 0.85, roughness: 0.4 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x00ffcc });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.7), metal);
  body.position.set(0, 0, -0.35); gun.add(body);
  const barrelTop = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.75, 12), darkMetal);
  barrelTop.rotation.x = Math.PI / 2; barrelTop.position.set(-0.045, 0.09, -0.6); gun.add(barrelTop);
  const barrelTop2 = barrelTop.clone(); barrelTop2.position.x = 0.045; gun.add(barrelTop2);
  const pump = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.25), darkMetal);
  pump.position.set(0, -0.09, -0.55); gun.add(pump);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.2, 0.25), metal);
  stock.position.set(0, -0.1, -0.02); stock.rotation.x = 0.3; gun.add(stock);
  // plasma vents
  for (let i = 0; i < 3; i++) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.02, 0.05), glow);
    vent.position.set(0, 0.02, -0.25 - i * 0.12);
    gun.add(vent);
  }
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.015, 8, 16), glow);
  coil.position.set(0, 0.09, -0.9); gun.add(coil);
  const coil2 = coil.clone(); coil2.position.z = -0.82; coil2.scale.setScalar(0.9); gun.add(coil2);
}
gun.scale.setScalar(0.55);
gun.position.set(0.26, -0.24, -0.5);
gun.rotation.y = 0.05;
camera.add(gun);
scene.add(camera);

const muzzleLight = new THREE.PointLight(0x66ffee, 0, 8);
muzzleLight.position.set(0, 0.09, -1.0);
gun.add(muzzleLight);
const muzzleFlash = new THREE.Mesh(
  new THREE.SphereGeometry(0.12, 8, 8),
  new THREE.MeshBasicMaterial({ color: 0xaaffee, transparent: true, opacity: 0 })
);
muzzleFlash.position.set(0, 0.09, -1.0);
gun.add(muzzleFlash);

// ============================================================
// PLAYER
// ============================================================
// Ghost contact damage, 15% deadlier than the original 20.
const GHOST_DAMAGE = 20 * 1.15;
const player = {
  pos: playerSpawn.clone(),
  vel: new THREE.Vector3(),
  yaw: Math.PI, pitch: 0,
  health: 100, score: 0,
  radius: 0.45,
  forward: new THREE.Vector3(0, 0, -1),
  bobPhase: 0,
  invuln: 0,
  fireCooldown: 0,
  recoil: 0,
  bumpCooldown: 0,
};
// ~6 cm bounce-back when the player smacks a wall (world units ≈ metres)
const WALL_BOUNCE = 0.06;
const keys = {};
addEventListener('keydown', e => { keys[e.code] = true; });
addEventListener('keyup', e => { keys[e.code] = false; });

function moveWithCollision(dt) {
  const speed = (keys['ShiftLeft'] || keys['ShiftRight']) ? 9 : 6;
  const f = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const s = new THREE.Vector3(-f.z, 0, f.x);
  const move = new THREE.Vector3();
  if (keys['KeyW']) move.add(f);
  if (keys['KeyS']) move.sub(f);
  if (keys['KeyD']) move.add(s);
  if (keys['KeyA']) move.sub(s);
  const moving = move.lengthSq() > 0;
  if (moving) move.normalize().multiplyScalar(speed * dt);

  // axis-separated slide collision against wall cells
  const tryAxis = (dx, dz) => {
    const nx = player.pos.x + dx, nz = player.pos.z + dz;
    const R = player.radius;
    for (const sx of [-R, 0, R]) for (const sz of [-R, 0, R]) {
      const cell = worldToCell(new THREE.Vector3(nx + sx, 0, nz + sz));
      if (isWall(cell.r, cell.c)) return false;
    }
    player.pos.x = nx; player.pos.z = nz;
    return true;
  };
  const movedX = tryAxis(move.x, 0);
  const movedZ = tryAxis(0, move.z);

  // wall bump: an attempted move was blocked by a wall this frame
  const bumpedX = move.x !== 0 && !movedX;
  const bumpedZ = move.z !== 0 && !movedZ;
  if (bumpedX || bumpedZ) {
    // bounce ~6 cm back off the wall on the blocked axis/axes
    if (bumpedX) player.pos.x -= Math.sign(move.x) * WALL_BOUNCE;
    if (bumpedZ) player.pos.z -= Math.sign(move.z) * WALL_BOUNCE;
    if (player.bumpCooldown <= 0) {
      AudioSys.grunt();
      player.bumpCooldown = 0.45; // don't machine-gun the grunt while sliding along a wall
    }
  }
  return moving;
}

// pointer lock
let locked = false;
canvas.ownerDocument.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
});
addEventListener('mousemove', e => {
  if (!locked || game.state !== 'playing') return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch -= e.movementY * 0.0022;
  player.pitch = Math.max(-1.4, Math.min(1.4, player.pitch));
});
addEventListener('mousedown', e => {
  if (game.state === 'playing' && locked && e.button === 0) shoot();
});

// ============================================================
// SHOOTING
// ============================================================
const raycaster = new THREE.Raycaster();
function shoot() {
  if (player.fireCooldown > 0) return;
  player.fireCooldown = 0.55;
  player.recoil = 1;
  AudioSys.shotgun();
  muzzleLight.intensity = 30;
  muzzleFlash.material.opacity = 1;

  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const dir = raycaster.ray.direction;

  // check ghosts (sphere test along ray)
  let hitGhost = null, hitDist = Infinity;
  for (const g of ghosts) {
    if (!g.active || g.state === 'dead') continue;
    const toG = g.mesh.position.clone().sub(camera.position);
    const proj = toG.dot(dir);
    if (proj < 0 || proj > 35) continue;
    const perp = toG.clone().addScaledVector(dir, -proj).length();
    if (perp < 1.1 && proj < hitDist) { hitGhost = g; hitDist = proj; }
  }
  // wall distance so we can't shoot through walls
  const wallHits = raycaster.intersectObject(walls);
  const wallDist = wallHits.length ? wallHits[0].distance : Infinity;

  if (hitGhost && hitDist < wallDist) {
    if (hitGhost.state === 'fright') {
      hitGhost.kill();
      player.score += 200;
      flashMsg('DEMON OBLITERATED  +200');
    } else {
      // shot passes through — they are still ethereal, but the impact can
      // shear off a duplicate. Capped so the maze can't spiral out of control.
      spawnExplosion(hitGhost.mesh.position.clone(), 0xffffff, 12, 4);
      if (ghosts.length < GHOST_CAP && Math.random() < CLONE_CHANCE) {
        const clone = new Ghost(hitGhost.def, hitGhost.pos.clone(), true);
        clone.isClone = true;
        ghosts.push(clone);
        spawnExplosion(clone.pos.clone().setY(1.1), hitGhost.def.color, 24, 6);
        AudioSys.clone();
        flashMsg('DEMON CLONED!');
      } else {
        flashMsg('IMMUNE — FIND A PLASMA CORE');
      }
    }
  } else if (wallHits.length) {
    spawnExplosion(wallHits[0].point, 0x66ffee, 14, 4);
  }
  updateHUD();
}

// ============================================================
// GAME STATE / POWER MODE
// ============================================================
const game = { state: 'title', pelletsLeft: pellets.length, time: 0, reinforced: [false, false, false] };
const powerMode = { active: false, timer: 0 };

// Reinforcement ghosts + the level exit trigger as the maze empties out.
function onPelletCleared() {
  const cleared = (pellets.length - game.pelletsLeft) / pellets.length;
  if (cleared >= 0.5 && !game.reinforced[0]) {
    game.reinforced[0] = true; ghosts[BASE_GHOSTS].activate();
    flashMsg('REINFORCEMENT INBOUND');
  }
  if (cleared >= 0.75 && !game.reinforced[1]) {
    game.reinforced[1] = true; ghosts[BASE_GHOSTS + 1].activate();
    flashMsg('ANOTHER HUNTER JOINS');
  }
  if (game.pelletsLeft <= 0 && !game.reinforced[2]) {
    game.reinforced[2] = true; ghosts[BASE_GHOSTS + 2].activate();
    openExit(); // maze is empty — the win is now reaching the door
  }
}

function activatePower() {
  powerMode.active = true;
  powerMode.timer = 10;
  AudioSys.powerRiff();
  ghosts.forEach(g => { if (g.state !== 'dead') { g.state = 'fright'; g.applyLook(true); } });
  document.getElementById('power-flash').classList.add('strobe');
  document.getElementById('power-timer').classList.remove('hidden');
  flashMsg('RIP AND TEAR');
}
function endPower() {
  powerMode.active = false;
  ghosts.forEach(g => { if (g.state === 'fright') { g.state = 'chase'; g.applyLook(false); } });
  document.getElementById('power-flash').classList.remove('strobe');
  document.getElementById('power-timer').classList.add('hidden');
}

let msgTimeout = null;
function flashMsg(text) {
  const el = document.getElementById('msg-flash');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(msgTimeout);
  msgTimeout = setTimeout(() => el.classList.remove('show'), 1400);
}

function damagePlayer(amount, fromPos) {
  if (player.invuln > 0) return;
  player.invuln = 1.2;
  player.health = Math.max(0, player.health - amount);
  AudioSys.hurt();
  const df = document.getElementById('damage-flash');
  df.style.opacity = 1;
  setTimeout(() => (df.style.opacity = 0), 180);
  // knockback
  const kb = player.pos.clone().sub(fromPos).setY(0).normalize().multiplyScalar(2.5);
  const cell = worldToCell(player.pos.clone().add(kb));
  if (!isWall(cell.r, cell.c)) player.pos.add(kb);
  updateHUD();
  if (player.health <= 0) endGame(false);
}

function endGame(won) {
  game.state = 'over';
  document.exitPointerLock();
  const screen = document.getElementById('end-screen');
  screen.classList.remove('hidden');
  screen.classList.toggle('win', won);
  document.getElementById('end-title').textContent = won ? 'MAZE CLEARED' : 'YOU DIED';
  document.getElementById('end-stats').innerHTML =
    `SCORE: ${player.score}<br>PELLETS CONSUMED: ${pellets.length - game.pelletsLeft} / ${pellets.length}`;
  if (won) AudioSys.win();
}

function resetGame() {
  player.pos.copy(playerSpawn);
  player.health = 100; player.score = 0;
  player.yaw = Math.PI; player.pitch = 0; player.invuln = 0; player.bumpCooldown = 0;
  pellets.forEach(p => (p.alive = true));
  cores.forEach(c => { c.alive = true; c.mesh.visible = true; c.light.intensity = 8; });
  // sweep any clones spawned last run — the base 7 are the only permanent ghosts
  for (let i = ghosts.length - 1; i >= 0; i--) {
    if (ghosts[i].isClone) { disposeGhost(ghosts[i]); ghosts.splice(i, 1); }
  }
  ghosts.forEach((g, i) => { g.active = i < BASE_GHOSTS; g.reset(); });
  game.pelletsLeft = pellets.length;
  game.reinforced = [false, false, false];
  closeExit();
  endPower();
  updateHUD();
}

// ============================================================
// HUD
// ============================================================
const hudEls = {
  health: document.getElementById('health-value'),
  healthFill: document.getElementById('health-fill'),
  pellets: document.getElementById('pellet-count'),
  score: document.getElementById('score-value'),
  powerFill: document.getElementById('power-fill'),
  exitDist: document.getElementById('exit-dist'),
};
function updateHUD() {
  hudEls.health.textContent = `${Math.round(player.health)}%`;
  hudEls.healthFill.style.width = `${player.health}%`;
  const low = player.health <= 30;
  hudEls.health.classList.toggle('low', low);
  hudEls.healthFill.classList.toggle('low', low);
  hudEls.pellets.textContent = game.pelletsLeft;
  hudEls.score.textContent = player.score;
}

// minimap
const mmCanvas = document.getElementById('minimap');
const mm = mmCanvas.getContext('2d');
function drawMinimap() {
  const W = mmCanvas.width, radius = 6, scale = W / (radius * 2 + 1);
  mm.clearRect(0, 0, W, W);
  mm.fillStyle = 'rgba(0,10,18,0.85)';
  mm.fillRect(0, 0, W, W);
  const pc = worldToCell(player.pos);
  const px = player.pos.x / CELL + COLS / 2, pz = player.pos.z / CELL + ROWS / 2;
  const toScreen = (c, r) => [(c - px + radius + 0.5) * scale, (r - pz + radius + 0.5) * scale];

  for (let r = pc.r - radius; r <= pc.r + radius; r++) {
    for (let c = pc.c - radius; c <= pc.c + radius; c++) {
      if (r < 0 || c < 0 || r >= ROWS || c >= COLS || !isWall(r, c)) continue;
      const [x, y] = toScreen(c - 0.5, r - 0.5);
      mm.fillStyle = 'rgba(0,200,255,0.16)';
      mm.fillRect(x, y, scale, scale);
      mm.strokeStyle = 'rgba(0,220,255,0.6)';
      mm.lineWidth = 1;
      mm.strokeRect(x, y, scale, scale);
    }
  }
  // pellets
  mm.fillStyle = '#ffe93b';
  for (const p of pellets) {
    if (!p.alive || Math.abs(p.r - pc.r) > radius || Math.abs(p.c - pc.c) > radius) continue;
    const [x, y] = toScreen(p.c, p.r);
    mm.beginPath(); mm.arc(x, y, 1.6, 0, 7); mm.fill();
  }
  // cores
  for (const cr of cores) {
    if (!cr.alive) continue;
    const cc = worldToCell(cr.pos);
    if (Math.abs(cc.r - pc.r) > radius || Math.abs(cc.c - pc.c) > radius) continue;
    const [x, y] = toScreen(cc.c, cc.r);
    mm.fillStyle = '#33ddff';
    mm.beginPath(); mm.arc(x, y, 4 + Math.sin(game.time * 6) * 1.2, 0, 7); mm.fill();
  }
  // ghosts
  for (const g of ghosts) {
    if (!g.active || g.state === 'dead') continue;
    const gc = worldToCell(g.pos);
    if (Math.abs(gc.r - pc.r) > radius || Math.abs(gc.c - pc.c) > radius) continue;
    const [x, y] = toScreen(gc.c + (g.pos.x / CELL + COLS / 2 - gc.c - 0.5), gc.r + (g.pos.z / CELL + ROWS / 2 - gc.r - 0.5));
    mm.fillStyle = g.state === 'fright' ? '#4466ff' : '#' + g.def.color.toString(16).padStart(6, '0');
    mm.beginPath(); mm.arc(x, y, 3.5, 0, 7); mm.fill();
  }
  // exit door: pulsing yellow marker, clamped to the minimap edge with an arrow
  // when it's beyond view so the player can always navigate toward it
  if (exit.active) {
    const exCol = exit.pos.x / CELL + COLS / 2, exRow = exit.pos.z / CELL + ROWS / 2;
    let vc = exCol - px, vr = exRow - pz;
    const mag = Math.max(Math.abs(vc), Math.abs(vr));
    const clamped = mag > radius;
    if (clamped) { const k = radius / mag; vc *= k; vr *= k; }
    const x = (vc + radius + 0.5) * scale, y = (vr + radius + 0.5) * scale;
    const pulse = 3 + Math.sin(game.time * 6) * 1.4;
    mm.fillStyle = clamped ? '#ffd21a' : '#ffe93b';
    mm.shadowColor = '#ffe93b'; mm.shadowBlur = 8;
    if (clamped) {
      const ang = Math.atan2(vr, vc);
      mm.save(); mm.translate(x, y); mm.rotate(ang);
      mm.beginPath(); mm.moveTo(6, 0); mm.lineTo(-4, 4); mm.lineTo(-4, -4); mm.closePath(); mm.fill();
      mm.restore();
    } else {
      mm.fillRect(x - pulse, y - pulse, pulse * 2, pulse * 2);
    }
    mm.shadowBlur = 0;
  }

  // player arrow
  const cxy = W / 2;
  mm.save();
  mm.translate(cxy, cxy);
  mm.rotate(-player.yaw + Math.PI);
  mm.fillStyle = '#0ffce0';
  mm.shadowColor = '#0ffce0'; mm.shadowBlur = 6;
  mm.beginPath();
  mm.moveTo(0, -6); mm.lineTo(4.5, 5); mm.lineTo(0, 2.5); mm.lineTo(-4.5, 5);
  mm.closePath(); mm.fill();
  mm.restore();
}

// ============================================================
// MAIN LOOP
// ============================================================
const perfNow = () => performance.now() / 1000;
const clock = new THREE.Clock();

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = (game.time += dt);

  if (game.state === 'playing' && locked) {
    const moving = moveWithCollision(dt);
    player.invuln = Math.max(0, player.invuln - dt);
    player.fireCooldown = Math.max(0, player.fireCooldown - dt);
    player.bumpCooldown = Math.max(0, player.bumpCooldown - dt);
    player.recoil = Math.max(0, player.recoil - dt * 4);

    // camera + head bob
    if (moving) player.bobPhase += dt * ((keys['ShiftLeft'] || keys['ShiftRight']) ? 13 : 9);
    const bobY = Math.sin(player.bobPhase * 2) * 0.045;
    const bobX = Math.sin(player.bobPhase) * 0.03;
    camera.position.set(player.pos.x + bobX * Math.cos(player.yaw), 1.7 + bobY, player.pos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch + player.recoil * 0.06;
    player.forward.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));

    // gun recoil + sway
    gun.position.z = -0.5 + player.recoil * 0.13;
    gun.position.y = -0.24 + Math.sin(player.bobPhase * 2) * 0.012;
    gun.rotation.x = player.recoil * 0.25;
    muzzleLight.intensity *= 0.75;
    muzzleFlash.material.opacity *= 0.72;

    // pellet pickup
    for (const p of pellets) {
      if (!p.alive) continue;
      const dx = p.pos.x - player.pos.x, dz = p.pos.z - player.pos.z;
      if (dx * dx + dz * dz < 1.2) {
        p.alive = false;
        game.pelletsLeft--;
        player.score += 10;
        AudioSys.blip();
        updateHUD();
        onPelletCleared();
      }
    }
    // core pickup
    for (const cr of cores) {
      if (!cr.alive) continue;
      const dx = cr.pos.x - player.pos.x, dz = cr.pos.z - player.pos.z;
      if (dx * dx + dz * dz < 1.8) {
        cr.alive = false;
        cr.mesh.visible = false;
        cr.light.intensity = 0;
        player.score += 50;
        activatePower();
        updateHUD();
      }
    }
    // power mode timer
    if (powerMode.active) {
      powerMode.timer -= dt;
      hudEls.powerFill.style.width = `${(powerMode.timer / 10) * 100}%`;
      if (powerMode.timer <= 0) endPower();
    }
    // ghosts — hunt harder the more of the maze the player has cleared
    const pelletProgress = pellets.length ? 1 - game.pelletsLeft / pellets.length : 0;
    for (const g of ghosts) {
      if (!g.active) continue;
      g.update(dt, t, player, powerMode, pelletProgress);
      if (g.state === 'chase') {
        const d = g.pos.distanceTo(player.pos);
        if (d < 1.1) damagePlayer(GHOST_DAMAGE, g.pos);
      }
    }

    // exit door: pulse it, report distance to the HUD, and check for reaching it
    if (exit.active) {
      exit.glowMat.emissiveIntensity = 2.0 + Math.sin(t * 5) * 1.2;
      exit.light.intensity = 5 + Math.sin(t * 5) * 3;
      const dx = exit.pos.x - player.pos.x, dz = exit.pos.z - player.pos.z;
      const dist = Math.hypot(dx, dz);
      hudEls.exitDist.textContent = `${Math.round(dist)} M`;
      if (dist < 1.6) endGame(true);
    }
  }

  // environment animation (always)
  updatePellets(t);
  updateParticles(dt);
  cores.forEach((cr, i) => {
    if (!cr.alive) return;
    cr.mesh.rotation.y += dt * 1.2;
    cr.mesh.rotation.x += dt * 0.5;
    const s = 1 + Math.sin(t * 4 + i) * 0.15;
    cr.mesh.scale.setScalar(s);
    cr.light.intensity = 6 + Math.sin(t * 5 + i) * 3;
  });
  // corridor lights: red strobe during power mode
  corridorLights.forEach((cl, i) => {
    if (powerMode.active) {
      cl.light.color.setHex(0xff1100);
      cl.light.intensity = Math.sin(t * 12 + i) > 0 ? 10 : 2;
    } else {
      cl.light.color.copy(cl.baseColor);
      cl.light.intensity = cl.baseIntensity + Math.sin(t * 2 + i * 2) * 1.5;
    }
  });
  trimMat.color.setHex(powerMode.active ? 0xbb1a00 : 0x0086bb);
  scene.fog.color.setHex(powerMode.active ? 0x180402 : 0x02040a);
  scene.background = scene.fog.color;

  if (game.state === 'playing') drawMinimap();
  composer.render();
}

// ============================================================
// BOOT
// ============================================================
function startGame() {
  AudioSys.init();
  AudioSys.resume();
  resetGame();
  game.state = 'playing';
  document.getElementById('title-screen').classList.add('hidden');
  document.getElementById('end-screen').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  canvas.requestPointerLock();
}
document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('restart-btn').addEventListener('click', startGame);
// re-lock on click if lock was lost mid-game
canvas.addEventListener('click', () => {
  if (game.state === 'playing' && !locked) canvas.requestPointerLock();
});

updateHUD();
tick();

// debug/testing hook
window.__pacoom = {
  game, player, ghosts, powerMode, pellets, cores, keys, exit, AudioSys,
  startGame, activatePower, shoot, tick, camera,
  openExit, onPelletCleared,
  forceLock: (v) => { locked = v; },
  clearPellets: (frac = 1) => {
    // testing helper: clear a fraction of the maze and fire the resulting triggers
    for (const p of pellets) {
      if (!p.alive) continue;
      if ((pellets.length - game.pelletsLeft) / pellets.length >= frac) break;
      p.alive = false; game.pelletsLeft--;
    }
    onPelletCleared(); updateHUD();
  },
};
