import * as THREE from 'three';
import { SIM_DT, gridZ, gridX } from './grid';
import { InputRouter } from './input';
import { LaneManager } from './world';
import { Player, type DeathCause } from './player';
import { AudioEngine } from './audio';
import { FogDirector, Flashlight, AshField, GrainPass, StaticWall, Searchlight, FOG_COLOR } from './fx';

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: false, powerPreference: 'high-performance',
});
renderer.setClearColor(FOG_COLOR);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 22);

scene.add(new THREE.HemisphereLight(0x2a3040, 0x0c0a09, 1.5));
const moon = new THREE.DirectionalLight(0x39404f, 0.5);
moon.position.set(3, 8, 2);
scene.add(moon);

const fogDir = new FogDirector(scene);
const grain = new GrainPass();
const ash = new AshField(scene);
const staticWall = new StaticWall(scene);
const searchlight = new Searchlight(scene);

const world = new LaneManager(scene, (Math.random() * 2 ** 31) | 0);
const player = new Player(scene);
const flashlight = new Flashlight(player.rig);
const audio = new AudioEngine();
const input = new InputRouter(document.body);

// ---------------------------------------------------------------------------
// UI refs
// ---------------------------------------------------------------------------
const $ = (id: string) => document.getElementById(id)!;
const titleEl = $('title'), deathEl = $('death'), hudEl = $('hud');
const vignette = $('vignette'), redpulse = $('redpulse');

const CAUSE_TEXT: Record<DeathCause, string> = {
  HAZARD: 'something on the road found you',
  TRAIN: 'you never heard it coming',
  FALL: 'the grates did not hold you',
  STATIC: 'the fog behind you was not empty',
  DRAGGED: 'carried into the dark',
};

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
type GameState = 'TITLE' | 'PLAYING' | 'DYING' | 'DEAD';
let state: GameState = 'TITLE';
let sanity = 100;
let cleanStreak = 0;
let idleTimer = 0;
let staticRow = -4;
let dyingT = 0;
let peerHeld = false;
let best = Number(localStorage.getItem('fog-best') ?? 0);

function fear() { return (100 - sanity) / 100; }

function sanityHit(amount: number) {
  sanity = Math.max(0, Math.min(100, sanity + amount));
  world.sanity = sanity;
  audio.sanityLow(sanity < 25);
  vignette.style.opacity = String(0.45 + fear() * 0.45);
  redpulse.style.opacity = String(Math.max(0, (30 - sanity) / 30) * 0.8);
}

// wire player events → sanity + audio
player.onHop = () => { audio.hop(); idleTimer = 0; };
player.onBump = () => audio.bump();
player.onError = (kind) => {
  cleanStreak = 0;
  if (kind === 'bump') sanityHit(-4);
  else if (kind === 'retreat') sanityHit(-2);
  else if (kind === 'nearmiss') {
    sanityHit(-6); audio.nearMiss();
    if (Math.random() < 0.3) audio.honk();   // a startled blare out of the fog
  }
};
player.onCleanHop = () => {
  cleanStreak++;
  if (cleanStreak >= 5) { cleanStreak = 0; sanityHit(8); }
  if (world.typeFor(player.row) === 'ASH') sanityHit(10);
};
player.onDeath = (cause) => {
  (window as any).__lastDeath = cause;
  state = 'DYING';
  dyingT = 0;
  input.enabled = false;
  audio.death();
  audio.trainHum(false);
  $('deathCause').textContent = CAUSE_TEXT[cause];
};

world.onTrainHum = (on) => {
  audio.trainHum(on);
  if (on) fogDir.thin = 0.025;   // the fog parts down the track — a lie of safety
};
world.onTrainPass = () => audio.trainPass();

input.onIntent = (i) => { if (state === 'PLAYING') player.intent(i, world); };
input.onPeer = (on) => { peerHeld = on; };
input.onAnyPress = () => {
  audio.start();
  audio.resume();
  if (state === 'TITLE') startRun();
  else if (state === 'DEAD' && deathReady) startRun();
};

function startRun() {
  world.reset();
  player.reset();
  sanity = 100; world.sanity = 100;
  cleanStreak = 0; idleTimer = 0;
  staticRow = -4; dyingT = 0; deathReady = false;
  world.ensure(0);
  sanityHit(0);
  titleEl.classList.add('hidden');
  deathEl.classList.add('hidden');
  hudEl.style.opacity = '1';
  audio.setDroneLevel(0.5);
  state = 'PLAYING';
  input.enabled = true;
}

function showDeath() {
  state = 'DEAD';
  best = Math.max(best, player.maxRow);
  localStorage.setItem('fog-best', String(best));
  $('deathDepth').textContent = `depth ${player.maxRow}`;
  $('deathBest').textContent = `deepest crossing ${best}`;
  deathEl.classList.remove('hidden');
  hudEl.style.opacity = '0';
  audio.setDroneLevel(0.18);
  // brief lockout so a panic tap doesn't instant-restart
  setTimeout(() => { deathReady = true; }, 900);
}
let deathReady = false;

// ---------------------------------------------------------------------------
// Simulation tick (fixed 60 Hz, deterministic ordering)
// ---------------------------------------------------------------------------
const DT = SIM_DT / 1000;

function simTick() {
  if (state === 'PLAYING') {
    world.ensure(player.row);
    world.tick(DT, player.row, player.col);

    // The Static advances — faster with depth, never sleeps
    const staticSpeed = 0.22 + Math.min(0.5, player.maxRow * 0.004);
    staticRow += staticSpeed * DT;
    // it stalks — never more than 9 rows behind, so pressure never fully lifts
    staticRow = Math.max(staticRow, player.row - 9);

    player.tick(world, staticRow);

    // idle dread — hesitation feeds the fog
    if (!player.hop) {
      idleTimer += DT;
      if (idleTimer > 3 && world.typeFor(player.row) !== 'ASH') sanityHit(-1.5 * DT * 10 / 10);
    }

    // sanity output channels
    fogDir.bias = fear() * 0.03;

    audio.setStaticProximity(Math.max(0, 1 - (player.row - staticRow) / 6));
    audio.setDroneLevel(0.4 + fear() * 0.35);
  } else if (state === 'DYING') {
    dyingT += DT;
    fogDir.bias = 0.2 * Math.min(1, dyingT * 2);
    flashlight.gutterOut(dyingT * 2.5);
    if (dyingT > 1.1) { fogDir.bias = 0; showDeath(); }
  } else if (state === 'TITLE') {
    // slow attract drift
    world.ensure(0);
    world.tick(DT, -99, 0);
  }
}

// ---------------------------------------------------------------------------
// Render (interpolated) + camera
// ---------------------------------------------------------------------------
const camTarget = new THREE.Vector3();
let camZ = 6;

function render(alpha: number) {
  player.syncRender(alpha);

  // soft-follow landscape camera: high, behind, looking down the wide corridor
  const pz = player.rig.position.z;
  camZ += (pz + 4.1 - camZ) * 0.06;
  camera.position.set(player.rig.position.x * 0.35, 4.6, camZ);
  camTarget.set(player.rig.position.x * 0.55, 0.25, pz - 2.9);
  camera.lookAt(camTarget);

  const dt = DT; // fx tick at render cadence is fine — purely cosmetic
  fogDir.tick(dt, fear());
  flashlight.peer += ((peerHeld ? 1 : 0) - flashlight.peer) * 0.12;
  if (state !== 'DYING') flashlight.tick(dt, fear());
  ash.tick(dt, pz - 4);
  searchlight.tick(dt, pz);
  // the wall only materializes when the Static is truly upon you
  const proximity = state === 'PLAYING' ? Math.max(0, 1 - (player.row - staticRow) / 1.6) : 0;
  staticWall.tick(dt, gridZ(staticRow) + 2.0, proximity);
  grain.tick(dt, fear());
  audio.tick(dt, state === 'PLAYING' ? sanity : 100);

  if (state === 'PLAYING') hudEl.textContent = String(player.maxRow);

  renderer.render(scene, camera);
  grain.render(renderer);
}

// ---------------------------------------------------------------------------
// Fixed-timestep loop with browser lifecycle handling
// ---------------------------------------------------------------------------
const MAX_FRAME_DELTA = 250;
let last = performance.now();
let acc = 0;
let rafId = 0;

function frame(now: number) {
  const delta = Math.min(now - last, MAX_FRAME_DELTA);
  last = now;
  acc += delta;
  while (acc >= SIM_DT) { simTick(); acc -= SIM_DT; }
  render(acc / SIM_DT);
  rafId = requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelAnimationFrame(rafId);
    audio.suspend();
  } else {
    last = performance.now(); acc = 0;
    audio.resume();
    rafId = requestAnimationFrame(frame);
  }
});

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());

// attract-mode world behind the title
world.ensure(0);

if (import.meta.env.DEV) {
  (window as any).__fog = {
    player, world, searchlight,
    get state() { return state; },
    get sanity() { return sanity; },
    get staticRow() { return staticRow; },
  };
}
rafId = requestAnimationFrame(frame);

// PWA — offline shell (production only; dev server owns the scope in dev)
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  addEventListener('load', async () => {
    const sw = navigator.serviceWorker;
    // A controller already present means this page's own assets came from a
    // prior install — any *later* controllerchange is a genuine new version
    // taking over, so reload to pick it up. A fresh install shouldn't reload.
    const hadController = !!sw.controller;
    const reg = await sw.register('./sw.js');

    let reloaded = false;
    sw.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });

    // players often leave the tab open for a long session — check for a
    // fresh deploy each time they come back so updates land without a
    // manual cache clear.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) reg.update();
    });
  });
}

// PWA — install cue. Capture the deferred prompt and surface our own button;
// browsers only fire this when the app is actually installable.
const installBtn = document.getElementById('install') as HTMLButtonElement;
let deferredInstall: any = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  installBtn.hidden = false;
});
// keep the tap from also reaching the body handler (which starts a run)
installBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
// Fire on pointerup, not click: InputRouter cancels touchstart globally to
// kill scroll/zoom gestures during play, which per spec suppresses the
// synthesized click that would normally follow a touch tap. Pointer events
// aren't affected, so this is what actually fires on phones/tablets.
installBtn.addEventListener('pointerup', async (e) => {
  e.stopPropagation();
  if (!deferredInstall) return;
  installBtn.hidden = true;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
});
addEventListener('appinstalled', () => { installBtn.hidden = true; deferredInstall = null; });
