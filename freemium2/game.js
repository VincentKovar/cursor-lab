import * as THREE from 'three';

// ─── Constants ───────────────────────────────────────────────────────────────
const META_SCORE = 500;
const WEAPON_UNLOCK = [0, 150, 300];
const WEAPONS = [
  { id: 0, name: 'Ad Blast (T.I.D.S.)', ammo: '∞', fireRate: 0.12, damage: 18, type: 'banner' },
  { id: 1, name: 'Microtransaction Grenade (F.V.E.M.)', ammo: 8, fireRate: 1.2, damage: 80, type: 'grenade' },
  { id: 2, name: 'Subscription Trap (P.E.S.)', ammo: 5, fireRate: 0.8, damage: 8, type: 'trap' },
];
const SLOGANS = ['OPTIMIZE.', 'EXTRACT.', 'RETAIN.', 'OPTIMIZE. EXTRACT. RETAIN.', 'ENGAGEMENT IS MANDATORY.', 'YOUR DATA IS OUR PRODUCT.'];
const MAX_USERS = 8;
const ACRONYMS = ['LTV', 'ARPU', 'MAU', 'DAU', 'CAC', 'MRR', 'EBITDA'];
const NORMAL_COLOR = 0x6c5eb5;       // C64 light-blue — body
const NORMAL_HEAD_COLOR = 0x70d4e8;  // C64 cyan — head
const CHASE_COLORS = [0x00eaff, 0xff00d4];
const CHASE_DURATION = 10;

// Hidden door easter egg
// TEMP: lowered from 0.4 to 0.1 for testing — raise back to 0.4 once confirmed working.
const DOOR_REVEAL_FRACTION = 0.1;
const DOOR_REVEAL_SCORE = META_SCORE * DOOR_REVEAL_FRACTION; // 10% of meta-reveal threshold
const DOOR_CODE = 'SKID00';

// ─── State ───────────────────────────────────────────────────────────────────
const userUnitNum = String(Math.floor(Math.random() * 900000) + 100000);
let gameStarted = false;
let gamePaused = false;
let metaShown = false;
let sessionStart = 0;
let player = { health: 100, maxHealth: 100, score: 0, kills: 0, respawns: 0, weapon: 0, grenadeAmmo: 8, trapAmmo: 5 };
let keys = {};
let joystick = { active: false, dx: 0, dy: 0, touchId: null };
let lookDrag = { active: false, lastX: 0 };
let projectiles = [];
let traps = [];
let explosions = [];
let deathEffects = [];
let lastFire = 0;
let yaw = 0;
let pitch = 0;
let voicesLoaded = false;
let speechQueue = [];
let speaking = false;

// Users (opponents)
let users = [];
let targetUserCount = 2 + Math.floor(Math.random() * 3);
let targetTimer = 8 + Math.random() * 8;
let userSpawnTimer = 1;

// Yellow orbs (Pac-Man mechanic)
let orbs = [];
let orbSpawnTimer = 2;
let chaseMode = false;
let chaseTimer = 0;
let chaseColor = CHASE_COLORS[0];

// CMI stock ticker
const STOCK_HISTORY_LEN = 30;
let stockPrice = 100;
let stockHistory = new Array(STOCK_HISTORY_LEN).fill(100);
let stockDrawTimer = 0;
const stockCanvas = document.getElementById('stockCanvas');
const stockCtx = stockCanvas.getContext('2d');

// Hidden door easter egg
let doorRevealed = false;
let doorModalOpen = false;
let doorGlitchTimer = 2 + Math.random() * 3;

// ─── Three.js setup ──────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1c1547);
scene.fog = new THREE.Fog(0x1c1547, 20, 55);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.6, 0);

// Lighting — C64 glow
scene.add(new THREE.AmbientLight(0x6c5eb5, 0.65));
const mainLight = new THREE.DirectionalLight(0x70d4e8, 0.9);
mainLight.position.set(0, 15, 0);
mainLight.castShadow = true;
mainLight.shadow.mapSize.set(1024, 1024);
mainLight.shadow.camera.near = 0.5;
mainLight.shadow.camera.far = 50;
mainLight.shadow.camera.left = -25;
mainLight.shadow.camera.right = 25;
mainLight.shadow.camera.top = 25;
mainLight.shadow.camera.bottom = -25;
scene.add(mainLight);
const fillLight = new THREE.DirectionalLight(0x8e44ad, 0.3);
fillLight.position.set(-10, 8, -5);
scene.add(fillLight);

// ─── Arena ───────────────────────────────────────────────────────────────────
const ARENA = 22;
const WALL_H = 6;

function makeTextTexture(text, w = 512, h = 128) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#352879';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f4e04d';
  ctx.font = 'bold 28px Courier New, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

const floorGeo = new THREE.PlaneGeometry(ARENA * 2, ARENA * 2, 40, 40);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x231a5e, roughness: 0.3, metalness: 0.1 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Grid lines on floor
const gridHelper = new THREE.GridHelper(ARENA * 2, 44, 0x70d4e8, 0x8e44ad);
gridHelper.position.y = 0.01;
scene.add(gridHelper);

const wallMat = new THREE.MeshStandardMaterial({ color: 0x352879, roughness: 0.2, metalness: 0.05 });
const wallPositions = [
  { pos: [0, WALL_H / 2, -ARENA], rot: [0, 0, 0], slogan: SLOGANS[0] },
  { pos: [0, WALL_H / 2, ARENA], rot: [0, Math.PI, 0], slogan: SLOGANS[1] },
  { pos: [-ARENA, WALL_H / 2, 0], rot: [0, Math.PI / 2, 0], slogan: SLOGANS[2] },
  { pos: [ARENA, WALL_H / 2, 0], rot: [0, -Math.PI / 2, 0], slogan: SLOGANS[3] },
];
wallPositions.forEach(w => {
  const geo = new THREE.BoxGeometry(ARENA * 2, WALL_H, 0.3);
  const mat = wallMat.clone();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...w.pos);
  mesh.rotation.set(...w.rot);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  scene.add(mesh);

  const signGeo = new THREE.PlaneGeometry(8, 1.5);
  const signMat = new THREE.MeshBasicMaterial({ map: makeTextTexture(w.slogan), transparent: true });
  const sign = new THREE.Mesh(signGeo, signMat);
  sign.position.set(w.pos[0], w.pos[1] + 0.5, w.pos[2]);
  sign.rotation.set(...w.rot);
  const offset = w.pos[2] === -ARENA ? 0.16 : w.pos[2] === ARENA ? -0.16 : w.pos[0] === -ARENA ? 0.16 : -0.16;
  if (w.pos[2] !== 0) sign.position.z += offset;
  else sign.position.x += offset;
  scene.add(sign);
});

// Ceiling panels
for (let x = -3; x <= 3; x++) {
  for (let z = -3; z <= 3; z++) {
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(5.5, 5.5),
      new THREE.MeshStandardMaterial({ color: 0x6c5eb5, emissive: 0x70d4e8, emissiveIntensity: 0.15 })
    );
    panel.rotation.x = Math.PI / 2;
    panel.position.set(x * 6, WALL_H - 0.1, z * 6);
    scene.add(panel);
  }
}

// Pillars
const pillarMat = new THREE.MeshStandardMaterial({ color: 0x4a3a8f, roughness: 0.4 });
[[-8, -8], [8, -8], [-8, 8], [8, 8]].forEach(([x, z]) => {
  const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, WALL_H, 1.2), pillarMat);
  p.position.set(x, WALL_H / 2, z);
  p.castShadow = true;
  scene.add(p);
});

// ─── Low cover obstacles (CHANGE 4) ──────────────────────────────────────────
const OBSTACLE_H = 0.9;
const obstacleColors = [0x4a3a8f, 0x3a2d82, 0x57469e];
const OBSTACLE_POSITIONS = [
  [5, 5], [-5, 5], [5, -5], [-6, -10], [10, 2], [-10, -2],
  [2, 11], [-2, -11], [13, -6], [-13, 6], [0, 16], [16, 0],
];
OBSTACLE_POSITIONS.forEach(([x, z], i) => {
  const mat = new THREE.MeshStandardMaterial({ color: obstacleColors[i % obstacleColors.length], roughness: 0.45 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, OBSTACLE_H, 1.6), mat);
  box.position.set(x, OBSTACLE_H / 2, z);
  box.castShadow = true;
  box.receiveShadow = true;
  scene.add(box);
});

// ─── Hidden door easter egg (CHANGE 2) ───────────────────────────────────────
// Tucked into the corner where the north wall (z = -ARENA) meets the west
// wall (x = -ARENA). Color is only a hair off the surrounding wall color —
// meant to be missed unless you're looking for it.
const doorMat = new THREE.MeshStandardMaterial({ color: 0x3a2d82, roughness: 0.22, metalness: 0.05, emissive: 0x000000, emissiveIntensity: 0 });
const doorGeo = new THREE.BoxGeometry(2.2, 3.4, 0.14);
const door = new THREE.Mesh(doorGeo, doorMat);
door.position.set(-ARENA + 3, 3.4 / 2, -ARENA + 0.22);
door.receiveShadow = true;
scene.add(door);
const doorPos2D = new THREE.Vector2(door.position.x, door.position.z);

// Faint infinity mark, like something scratched into the wall — not gated by
// score, just a quiet clue for anyone looking closely at the door itself.
const doorSymbolCanvas = document.createElement('canvas');
doorSymbolCanvas.width = 128; doorSymbolCanvas.height = 128;
const doorSymbolCtx = doorSymbolCanvas.getContext('2d');
doorSymbolCtx.clearRect(0, 0, 128, 128);
doorSymbolCtx.fillStyle = 'rgba(112, 212, 232, 0.4)'; // C64 cyan, low opacity — etched, not lit
doorSymbolCtx.font = '64px Georgia, serif';
doorSymbolCtx.textAlign = 'center';
doorSymbolCtx.textBaseline = 'middle';
doorSymbolCtx.fillText('∞', 64, 70);
const doorSymbolTex = new THREE.CanvasTexture(doorSymbolCanvas);
doorSymbolTex.needsUpdate = true;
const doorSymbolMat = new THREE.MeshBasicMaterial({ map: doorSymbolTex, transparent: true, depthWrite: false });
const doorSymbol = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), doorSymbolMat);
doorSymbol.position.set(door.position.x, door.position.y, door.position.z + doorGeo.parameters.depth / 2 + 0.005);
scene.add(doorSymbol);

// ─── User (opponent) factory (CHANGE 1: simple humanoid look) ──────────────
const bounds = ARENA - 1;

function makeUserLabel(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#ff4466'; ctx.font = 'bold 18px Courier New'; ctx.textAlign = 'center';
  ctx.fillText(text, 128, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function createUser() {
  const group = new THREE.Group();

  // Body: capsule (cylinder + rounded caps) — reads as a torso/legs silhouette
  // rather than a blocky soldier.
  const bodyMat = new THREE.MeshStandardMaterial({ color: NORMAL_COLOR, emissive: 0x241a4d, emissiveIntensity: 0.3, roughness: 0.55 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.95, 4, 10), bodyMat);
  body.position.y = 0.91; // capsule half-height (0.475 + 0.32) so feet touch the floor
  body.castShadow = true;
  group.add(body);

  // Head: simple sphere
  const headMat = new THREE.MeshStandardMaterial({ color: NORMAL_HEAD_COLOR, emissive: 0x143842, emissiveIntensity: 0.35, roughness: 0.5 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 14), headMat);
  head.position.y = 1.92;
  head.rotation.x = 0.5; // tilted down, looking at the device
  head.castShadow = true;
  group.add(head);

  // Device held in front (phone / handheld console) — a small flat rectangle
  const device = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.46, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xf4e04d, emissiveIntensity: 0.25 })
  );
  device.position.set(0, 1.42, 0.4);
  device.rotation.x = -0.6;
  group.add(device);

  const labelTex = makeUserLabel('USER');
  const labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, transparent: true }));
  labelSprite.position.y = 2.55;
  labelSprite.scale.set(2.0, 0.5, 1);
  group.add(labelSprite);

  const angle = Math.random() * Math.PI * 2;
  const dist = 6 + Math.random() * 14;
  group.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
  scene.add(group);

  return {
    group, body, head, device, labelSprite,
    health: 100, maxHealth: 100, alive: true,
    pauseTimer: 0, frozen: false,
    wanderTarget: new THREE.Vector3(group.position.x, 0, group.position.z),
    speed: 1.2 + Math.random() * 0.6,
  };
}

function pickWanderTarget(u) {
  u.wanderTarget.set((Math.random() * 2 - 1) * bounds * 0.85, 0, (Math.random() * 2 - 1) * bounds * 0.85);
}

function spawnUser() {
  if (users.filter(u => u.alive).length >= MAX_USERS) return;
  const u = createUser();
  if (chaseMode) setUserChaseColor(u);
  users.push(u);
}

function despawnOneUser() {
  const idx = users.findIndex(u => u.alive);
  if (idx === -1) return;
  const u = users[idx];
  scene.remove(u.group);
  users.splice(idx, 1);
}

function setUserChaseColor(u) {
  u.body.material.color.setHex(chaseColor);
  u.body.material.emissive.setHex(chaseColor);
  u.head.material.color.setHex(chaseColor);
  u.head.material.emissive.setHex(chaseColor);
}

function setUserNormalColor(u) {
  u.body.material.color.setHex(NORMAL_COLOR);
  u.body.material.emissive.setHex(0x241a4d);
  u.head.material.color.setHex(NORMAL_HEAD_COLOR);
  u.head.material.emissive.setHex(0x143842);
}

// ─── Yellow orbs (Pac-Man pickup) ───────────────────────────────────────────
function createOrb() {
  const geo = new THREE.SphereGeometry(0.4, 16, 16);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffee00, emissive: 0xffee00, emissiveIntensity: 1.2 });
  const mesh = new THREE.Mesh(geo, mat);
  const angle = Math.random() * Math.PI * 2;
  const dist = Math.random() * bounds * 0.8;
  mesh.position.set(Math.cos(angle) * dist, 1.3, Math.sin(angle) * dist);
  const light = new THREE.PointLight(0xffee00, 1.5, 6);
  light.position.copy(mesh.position);
  scene.add(mesh);
  scene.add(light);
  return { mesh, light, life: 10 + Math.random() * 10, tick: Math.random() * 10 };
}

function removeOrb(idx) {
  const o = orbs[idx];
  scene.remove(o.mesh);
  scene.remove(o.light);
  orbs.splice(idx, 1);
}

function triggerChaseMode() {
  chaseMode = true;
  chaseTimer = CHASE_DURATION;
  chaseColor = CHASE_COLORS[Math.floor(Math.random() * CHASE_COLORS.length)];
  users.forEach(u => { if (u.alive) setUserChaseColor(u); });
  // AUDIO PLACEHOLDER: orb-pickup / ghost-mode-activated stinger
  // To replace: swap the Web Speech API call or audio source here
  speak('USERS ACTIVATED!');
}

function endChaseMode() {
  chaseMode = false;
  users.forEach(u => { if (u.alive) setUserNormalColor(u); });
}

// ─── Speech / audio engine ───────────────────────────────────────────────────
// AUDIO PLACEHOLDER: core text-to-speech engine used for all announcer lines
// To replace: swap the Web Speech API call or audio source here (e.g. route
// `speak()` to an <audio> element / Howler.js instance playing pre-recorded
// voice clips instead of calling speechSynthesis).
function loadVoices() {
  if (voicesLoaded) return;
  const v = speechSynthesis.getVoices();
  if (v.length) voicesLoaded = true;
}
speechSynthesis.onvoiceschanged = loadVoices;
loadVoices();

function getRoboticVoice() {
  const voices = speechSynthesis.getVoices();
  return voices.find(v => /Daniel|Samantha|Google US English|Microsoft David|Fred/i.test(v.name))
    || voices.find(v => v.lang.startsWith('en'))
    || voices[0];
}

function speak(text) {
  if (!window.speechSynthesis) return;
  speechQueue.push(text);
  processSpeech();
}

function processSpeech() {
  if (speaking || !speechQueue.length) return;
  speaking = true;
  const text = speechQueue.shift();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.92;
  u.pitch = 0.15;
  u.volume = 1.0;
  const voice = getRoboticVoice();
  if (voice) u.voice = voice;
  u.onend = () => { speaking = false; setTimeout(processSpeech, 200); };
  u.onerror = () => { speaking = false; processSpeech(); };
  speechSynthesis.speak(u);
}

// ─── Announcer (Mortal Kombat style) ────────────────────────────────────────
const ANNOUNCER_POOL = [
  'MONETIZE', 'INTEGRATE', 'SYNERGIZE', 'STAKEHOLDER VALUE',
  'OPTIMIZE', 'ENGAGEMENT OPTIMIZED', 'EXTRACT', 'LEVERAGE', 'RETENTION'
];
let announcerTimer = 6 + Math.random() * 8;
function tickAnnouncer(dt) {
  announcerTimer -= dt;
  if (announcerTimer <= 0) {
    announcerTimer = 8 + Math.random() * 17; // 8s - 25s between calls
    const line = ANNOUNCER_POOL[Math.floor(Math.random() * ANNOUNCER_POOL.length)];
    // AUDIO PLACEHOLDER: randomly-timed announcer bark (corporate buzzword pool)
    // To replace: swap the Web Speech API call or audio source here
    speak(line + '!');
  }
}

// ─── Projectiles & effects ───────────────────────────────────────────────────
function fireWeapon() {
  const w = WEAPONS[player.weapon];
  if (player.score < WEAPON_UNLOCK[player.weapon]) return;
  const now = performance.now() / 1000;
  if (now - lastFire < w.fireRate) return;

  if (w.type === 'grenade') {
    if (player.grenadeAmmo <= 0) return;
    player.grenadeAmmo--;
    lastFire = now;
    throwGrenade();
    updateHud();
    return;
  }
  if (w.type === 'trap') {
    if (player.trapAmmo <= 0) return;
    player.trapAmmo--;
    lastFire = now;
    placeTrap();
    updateHud();
    return;
  }

  lastFire = now;
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  const bannerGeo = new THREE.BoxGeometry(1.0, 0.6, 0.04);
  const bannerMat = new THREE.MeshBasicMaterial({ color: 0xffee00 });
  const mesh = new THREE.Mesh(bannerGeo, bannerMat);
  mesh.position.copy(camera.position).add(dir.clone().multiplyScalar(0.5));
  mesh.lookAt(mesh.position.clone().add(dir));
  scene.add(mesh);
  projectiles.push({ mesh, vel: dir.multiplyScalar(28), life: 2, damage: w.damage, type: 'banner' });
}

function throwGrenade() {
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(pitch * 0.5, yaw, 0, 'YXZ'));
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 0.08, 20),
    new THREE.MeshStandardMaterial({ color: 0xffcc00, metalness: 0.9, roughness: 0.15, emissive: 0xaa8800, emissiveIntensity: 0.4 })
  );
  mesh.rotation.x = Math.PI / 2;
  mesh.position.copy(camera.position).add(new THREE.Vector3(0, -0.2, 0));
  scene.add(mesh);
  projectiles.push({
    mesh, vel: dir.multiplyScalar(12).add(new THREE.Vector3(0, 6, 0)),
    life: 3, damage: WEAPONS[1].damage, type: 'grenade', gravity: true, fuse: 1.8, spin: 14 + Math.random() * 6
  });
}

function placeTrap() {
  const pos = camera.position.clone();
  pos.y = 0.05;
  pos.add(new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, yaw, 0, 'YXZ')).multiplyScalar(2.5));

  const ringGeo = new THREE.RingGeometry(0.8, 1.6, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x00aa55, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(pos);
  scene.add(ring);

  const labelC = document.createElement('canvas');
  labelC.width = 256; labelC.height = 64;
  const ctx = labelC.getContext('2d');
  ctx.fillStyle = '#00aa55'; ctx.font = 'bold 22px Courier New'; ctx.textAlign = 'center';
  ctx.fillText('ANNUAL PLAN', 128, 38);
  const tex = new THREE.CanvasTexture(labelC);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.5), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  label.rotation.x = -Math.PI / 2;
  label.position.set(pos.x, 0.06, pos.z);
  scene.add(label);

  traps.push({ ring, label, pos: pos.clone(), life: 12, tick: 0 });
}

function spawnExplosion(pos) {
  for (let i = 0; i < 12; i++) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffcc00'; ctx.font = 'bold 36px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('₥', 32, 32);
    const tex = new THREE.CanvasTexture(c);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sprite.position.copy(pos);
    sprite.scale.set(0.5, 0.5, 1);
    scene.add(sprite);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 6 + 2, (Math.random() - 0.5) * 8);
    explosions.push({ sprite, vel, life: 1.2 });
  }
  // Area damage to nearby users
  const BLAST_RADIUS = 8;
  users.forEach(u => {
    if (!u.alive) return;
    const dist = u.group.position.distanceTo(pos);
    if (dist < BLAST_RADIUS) damageUser(u, WEAPONS[1].damage);
  });
}

function spawnDeathEffect(pos) {
  const text = ACRONYMS[Math.floor(Math.random() * ACRONYMS.length)];
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 44px Courier New'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#00aa55'; ctx.shadowBlur = 12;
  ctx.fillText(text, 128, 48);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.position.copy(pos).add(new THREE.Vector3(0, 1.4, 0));
  sprite.scale.set(0.01, 0.01, 1);
  scene.add(sprite);
  deathEffects.push({ sprite, life: 1.0, age: 0 });

  for (let i = 0; i < 10; i++) {
    const pc = document.createElement('canvas');
    pc.width = 32; pc.height = 32;
    const pctx = pc.getContext('2d');
    pctx.fillStyle = '#cc2244'; pctx.beginPath(); pctx.arc(16, 16, 14, 0, Math.PI * 2); pctx.fill();
    const ptex = new THREE.CanvasTexture(pc);
    const psprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: ptex, transparent: true }));
    psprite.position.copy(pos).add(new THREE.Vector3(0, 1, 0));
    psprite.scale.set(0.25, 0.25, 1);
    scene.add(psprite);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 5 + 1, (Math.random() - 0.5) * 6);
    explosions.push({ sprite: psprite, vel, life: 0.8 });
  }
}

function damageUser(u, amount) {
  if (!u.alive) return;
  // Ghost-mode Users (chasing after an orb pickup) are far more fragile — any hit kills them.
  u.health -= chaseMode ? u.maxHealth : amount;
  if (u.health <= 0) {
    u.health = 0;
    killUser(u);
  }
  updateHud();
}

function killUser(u) {
  u.alive = false;
  spawnDeathEffect(u.group.position.clone());
  scene.remove(u.group);
  users = users.filter(x => x !== u);
  player.kills++;
  player.score += 50;
  stockPrice = THREE.MathUtils.clamp(stockPrice + 8 + Math.random() * 6, 10, 200);
  // AUDIO PLACEHOLDER: kill-confirmation voice line ("churn event" callout)
  // To replace: swap the Web Speech API call or audio source here
  speak('ENGAGEMENT OPTIMIZED.');
  updateHud();
  checkMetaReveal();
}

function damagePlayer(amount) {
  player.health -= amount;
  stockPrice = THREE.MathUtils.clamp(stockPrice - amount * 0.4, 10, 200);
  document.getElementById('damageFlash').style.background = 'rgba(142,68,173,0.4)';
  setTimeout(() => { document.getElementById('damageFlash').style.background = 'rgba(142,68,173,0)'; }, 120);
  if (player.health <= 0) {
    player.health = 0;
    playerDeath();
  }
  updateHud();
}

function playerDeath() {
  gamePaused = true;
  // AUDIO PLACEHOLDER: player-death / session-ended voice line
  // To replace: swap the Web Speech API call or audio source here
  speak('YOUR SESSION HAS ENDED!');
  setTimeout(restartSession, 3500);
}

function restartSession() {
  player.health = player.maxHealth;
  player.score = 0;
  player.kills = 0;
  player.respawns = 0;
  player.grenadeAmmo = 8;
  player.trapAmmo = 5;
  player.weapon = 0;
  metaShown = false;
  sessionStart = performance.now();
  projectiles.forEach(p => scene.remove(p.mesh));
  traps.forEach(t => { scene.remove(t.ring); scene.remove(t.label); });
  deathEffects.forEach(d => scene.remove(d.sprite));
  explosions.forEach(e => scene.remove(e.sprite));
  orbs.forEach(o => { scene.remove(o.mesh); scene.remove(o.light); });
  users.forEach(u => scene.remove(u.group));
  projectiles = []; traps = []; explosions = []; deathEffects = []; orbs = []; users = [];
  chaseMode = false; chaseTimer = 0;
  targetUserCount = 2 + Math.floor(Math.random() * 3);
  targetTimer = 8 + Math.random() * 8;
  stockPrice = 100;
  stockHistory = new Array(STOCK_HISTORY_LEN).fill(100);
  doorRevealed = false;
  doorGlitchTimer = 1.5 + Math.random() * 4;
  doorMat.emissiveIntensity = 0;
  doorModalOpen = false;
  document.getElementById('doorModal').classList.remove('visible');
  document.getElementById('backdoorScreen').classList.remove('visible');
  player.respawns++;
  camera.position.set(0, 1.6, 0);
  yaw = 0; pitch = 0;
  gamePaused = false;
  updateHud();
}

function checkMetaReveal() {
  if (metaShown || player.score < META_SCORE) return;
  metaShown = true;
  gamePaused = true;
  document.getElementById('cmiOverlay').classList.add('visible');
}

// ─── Hidden door easter egg (CHANGE 2) ───────────────────────────────────────
function updateDoor(dt) {
  if (!doorRevealed) {
    if (player.score >= DOOR_REVEAL_SCORE) doorRevealed = true;
    return; // looks like a plain wall until revealed — no interaction, no effect
  }

  // Faint, intermittent rendering-glitch flicker. Never announced in the HUD.
  doorGlitchTimer -= dt;
  if (doorGlitchTimer <= 0) {
    doorGlitchTimer = 1.5 + Math.random() * 4;
    doorMat.emissive.setHex(Math.random() < 0.5 ? 0x70d4e8 : 0xff00d4);
    doorMat.emissiveIntensity = 0.35;
    setTimeout(() => { doorMat.emissiveIntensity = 0; }, 80 + Math.random() * 140);
  }

  if (!doorModalOpen) {
    const d = new THREE.Vector2(camera.position.x, camera.position.z).distanceTo(doorPos2D);
    if (d < 1.4) openDoorModal();
  }
}

function openDoorModal() {
  doorModalOpen = true;
  gamePaused = true;
  const input = document.getElementById('doorCodeInput');
  input.value = '';
  document.getElementById('doorModal').classList.add('visible');
  input.focus();
}

function closeDoorModal() {
  document.getElementById('doorModal').classList.remove('visible');
  document.getElementById('doorCodeInput').blur();
  doorModalOpen = false;
  gamePaused = false;
  // Fully restore input state — no stuck keys or look-drag left over from
  // whatever the player was doing the instant they walked into the door.
  keys = {};
  lookDrag.active = false;
  clock.getDelta(); // flush elapsed real time so the next frame doesn't get a huge dt jump
}

function submitDoorCode() {
  const val = document.getElementById('doorCodeInput').value.trim().toUpperCase();
  document.getElementById('doorModal').classList.remove('visible');
  if (val === DOOR_CODE) {
    document.getElementById('backdoorScreen').classList.add('visible');
    // doorModalOpen / gamePaused stay true while the backdoor screen is shown
  } else {
    // Wrong code: close silently, resume with no indication the door was real.
    closeDoorModal();
  }
}

function closeBackdoorScreen() {
  document.getElementById('backdoorScreen').classList.remove('visible');
  closeDoorModal();
}

// ─── HUD ─────────────────────────────────────────────────────────────────────
function updateHud() {
  document.getElementById('userUnitId').textContent = `USER-UNIT #${userUnitNum}`;
  document.getElementById('hudHealth').textContent = Math.max(0, Math.ceil(player.health));
  const w = WEAPONS[player.weapon];
  document.getElementById('hudAmmo').textContent = w.type === 'banner' ? '∞' : w.type === 'grenade' ? player.grenadeAmmo : player.trapAmmo;
  document.getElementById('hudScore').textContent = player.score;
  document.getElementById('hudKills').textContent = player.kills;
  document.getElementById('hudRespawns').textContent = player.respawns;
  // The active weapon can never actually be locked (switchWeapon blocks that),
  // so show which slot is active instead of a "[LOCKED]" suffix that could never fire.
  document.getElementById('weaponName').textContent = `[${player.weapon + 1}/3] ${w.name}`;
  const aliveCount = users.filter(u => u.alive).length;
  document.getElementById('enemyHealthText').textContent = `${aliveCount}/${MAX_USERS}` + (chaseMode ? ' · CHASING' : '');
  document.getElementById('enemyBarFill').style.width = (aliveCount / MAX_USERS * 100) + '%';
  document.getElementById('enemyBarFill').style.background = chaseMode ? '#' + chaseColor.toString(16).padStart(6, '0') : '#cc2244';
}

function updateTimer() {
  if (!gameStarted || gamePaused) return;
  const elapsed = Math.floor((performance.now() - sessionStart) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  document.getElementById('hudTimer').textContent = `${m}:${s}`;
}

function updateStockTicker(dt) {
  // Gentle decorative drift so the line never goes flat between events.
  stockPrice = THREE.MathUtils.clamp(stockPrice + (Math.random() - 0.5) * 1.5, 10, 200);

  stockDrawTimer -= dt;
  if (stockDrawTimer > 0) return;
  stockDrawTimer = 0.2;

  stockHistory.push(stockPrice);
  if (stockHistory.length > STOCK_HISTORY_LEN) stockHistory.shift();

  const w = stockCanvas.width, h = stockCanvas.height;
  stockCtx.clearRect(0, 0, w, h);
  const min = Math.min(...stockHistory), max = Math.max(...stockHistory);
  const range = Math.max(max - min, 1);
  stockCtx.strokeStyle = stockHistory[stockHistory.length - 1] >= stockHistory[0] ? '#70d4e8' : '#f4e04d';
  stockCtx.lineWidth = 2;
  stockCtx.beginPath();
  stockHistory.forEach((v, i) => {
    const x = (i / (STOCK_HISTORY_LEN - 1)) * w;
    const y = h - ((v - min) / range) * h;
    if (i === 0) stockCtx.moveTo(x, y); else stockCtx.lineTo(x, y);
  });
  stockCtx.stroke();
}

// ─── Input ───────────────────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (doorModalOpen) return; // game is frozen behind the door dialog / backdoor screen
  keys[e.code] = true;
  if (e.code === 'Space') { e.preventDefault(); fireWeapon(); }
  if (e.code === 'Digit1') switchWeapon(0);
  if (e.code === 'Digit2') switchWeapon(1);
  if (e.code === 'Digit3') switchWeapon(2);
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

canvas.addEventListener('mousedown', e => {
  if (doorModalOpen) return;
  if (e.button === 0) { lookDrag.active = true; lookDrag.lastX = e.clientX; }
});
window.addEventListener('mousemove', e => {
  if (!lookDrag.active) return;
  yaw -= (e.clientX - lookDrag.lastX) * 0.004;
  lookDrag.lastX = e.clientX;
});
window.addEventListener('mouseup', () => { lookDrag.active = false; });

let weaponHintResetTimer = null;

function flashWeaponInfo(success) {
  const panel = document.getElementById('weaponInfo');
  panel.classList.remove('weapon-flash-ok', 'weapon-flash-locked');
  void panel.offsetWidth; // restart CSS animation even on repeated rapid presses
  panel.classList.add(success ? 'weapon-flash-ok' : 'weapon-flash-locked');
}

function switchWeapon(idx) {
  // Every press gets an immediate, visible response — either the switch lands
  // or the HUD clearly says why it didn't, instead of silently doing nothing.
  if (idx === player.weapon) {
    flashWeaponInfo(true);
    return;
  }
  if (player.score < WEAPON_UNLOCK[idx]) {
    flashWeaponInfo(false);
    const hint = document.getElementById('weaponHint');
    clearTimeout(weaponHintResetTimer);
    hint.textContent = `${WEAPONS[idx].name} LOCKED — reach ${WEAPON_UNLOCK[idx]} score`;
    weaponHintResetTimer = setTimeout(() => {
      hint.textContent = 'SPACE to fire · 1/2/3 to switch';
    }, 1400);
    return;
  }
  player.weapon = idx;
  flashWeaponInfo(true);
  updateHud();
}

// Mobile joystick
const joyZone = document.getElementById('joystickZone');
const joyKnob = document.getElementById('joystickKnob');
const JOY_R = 45;

joyZone.addEventListener('touchstart', e => {
  e.preventDefault();
  const t = e.changedTouches[0];
  joystick.active = true;
  joystick.touchId = t.identifier;
  updateJoystick(t);
}, { passive: false });

joyZone.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joystick.touchId) updateJoystick(t);
  }
}, { passive: false });

function endJoystick(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === joystick.touchId) {
      joystick.active = false;
      joystick.dx = 0; joystick.dy = 0;
      joystick.touchId = null;
      joyKnob.style.transform = 'translate(-50%, -50%)';
    }
  }
}
joyZone.addEventListener('touchend', endJoystick);
joyZone.addEventListener('touchcancel', endJoystick);

function updateJoystick(t) {
  const rect = joyZone.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = t.clientX - cx;
  let dy = t.clientY - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > JOY_R) { dx = dx / dist * JOY_R; dy = dy / dist * JOY_R; }
  joystick.dx = dx / JOY_R;
  joystick.dy = dy / JOY_R;
  joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}

document.getElementById('btnShoot').addEventListener('touchstart', e => { e.preventDefault(); fireWeapon(); });
document.getElementById('btnSwitch').addEventListener('touchstart', e => {
  e.preventDefault();
  let next = (player.weapon + 1) % 3;
  for (let i = 0; i < 3; i++) {
    if (player.score >= WEAPON_UNLOCK[next]) { switchWeapon(next); return; }
    next = (next + 1) % 3;
  }
});
document.getElementById('btnLookL').addEventListener('touchstart', e => { e.preventDefault(); yaw += 0.08; });
document.getElementById('btnLookR').addEventListener('touchstart', e => { e.preventDefault(); yaw -= 0.08; });

document.getElementById('btnContinue').addEventListener('click', () => {
  document.getElementById('cmiOverlay').classList.remove('visible');
  restartSession();
});

// Hidden door modal controls
const doorCodeInput = document.getElementById('doorCodeInput');
doorCodeInput.addEventListener('keydown', e => {
  e.stopPropagation(); // never let game shortcuts (Space/1/2/3) fire while typing
  if (e.key === 'Enter') submitDoorCode();
  if (e.key === 'Escape') closeDoorModal();
});
document.getElementById('doorSubmit').addEventListener('click', submitDoorCode);
document.getElementById('doorCancel').addEventListener('click', closeDoorModal);
document.getElementById('closeSignalBtn').addEventListener('click', closeBackdoorScreen);

// ─── Game loop ───────────────────────────────────────────────────────────────
const clock = new THREE.Clock();

function updatePlayer(dt) {
  const speed = 6;
  const move = new THREE.Vector3();

  if (keys['ArrowUp'] || keys['KeyW']) move.z -= 1;
  if (keys['ArrowDown'] || keys['KeyS']) move.z += 1;
  if (keys['ArrowLeft'] || keys['KeyA']) move.x -= 1;
  if (keys['ArrowRight'] || keys['KeyD']) move.x += 1;
  if (joystick.active) { move.x += joystick.dx; move.z += joystick.dy; }

  if (move.lengthSq() > 0) {
    move.normalize();
    move.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    camera.position.x += move.x * speed * dt;
    camera.position.z += move.z * speed * dt;
  }

  camera.position.x = THREE.MathUtils.clamp(camera.position.x, -bounds, bounds);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, -bounds, bounds);
  camera.position.y = 1.6;

  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}

function updateUserPopulation(dt) {
  targetTimer -= dt;
  if (targetTimer <= 0) {
    targetTimer = 10 + Math.random() * 10;
    targetUserCount = 1 + Math.floor(Math.random() * MAX_USERS);
  }

  userSpawnTimer -= dt;
  if (userSpawnTimer <= 0) {
    userSpawnTimer = 0.7 + Math.random() * 1.0;
    const alive = users.filter(u => u.alive).length;
    if (alive < targetUserCount) spawnUser();
    else if (alive > targetUserCount) despawnOneUser();
  }
}

function updateUsers(dt) {
  users.forEach(u => {
    if (!u.alive) return;

    if (u.frozen) {
      // Held in place by an active Subscription Trap
    } else if (chaseMode) {
      // Aggressively chase the player
      const toPlayer = new THREE.Vector3().subVectors(camera.position, u.group.position);
      toPlayer.y = 0;
      const dist = toPlayer.length();
      if (dist > 0.6) {
        toPlayer.normalize();
        u.group.position.add(toPlayer.multiplyScalar((u.speed * 2.6) * dt));
        u.group.lookAt(camera.position.x, u.group.position.y, camera.position.z);
      }
      u.head.rotation.x = 0; // look up while chasing
      if (dist < 1.8) damagePlayer(14 * dt);
    } else {
      // Idle wander, hunched over device
      u.head.rotation.x = 0.5;
      if (u.pauseTimer > 0) {
        u.pauseTimer -= dt;
      } else {
        const toTarget = new THREE.Vector3().subVectors(u.wanderTarget, u.group.position);
        toTarget.y = 0;
        const dist = toTarget.length();
        if (dist < 0.5) {
          u.pauseTimer = 1 + Math.random() * 2.5;
          pickWanderTarget(u);
        } else {
          toTarget.normalize();
          u.group.position.add(toTarget.multiplyScalar(u.speed * dt));
          u.group.lookAt(u.wanderTarget.x, u.group.position.y, u.wanderTarget.z);
        }
      }
    }

    u.group.position.x = THREE.MathUtils.clamp(u.group.position.x, -bounds, bounds);
    u.group.position.z = THREE.MathUtils.clamp(u.group.position.z, -bounds, bounds);
  });

  if (!chaseMode) {
    player.score += Math.floor(dt * 1.5);
    checkMetaReveal();
  }
}

function updateOrbs(dt) {
  orbSpawnTimer -= dt;
  if (orbSpawnTimer <= 0) {
    orbSpawnTimer = 3 + Math.random() * 5;
    if (orbs.length < 3 && Math.random() < 0.7) orbs.push(createOrb());
  }

  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i];
    o.tick += dt;
    o.life -= dt;
    o.mesh.position.y = 1.3 + Math.sin(o.tick * 2.5) * 0.2;
    o.mesh.rotation.y += dt * 2;
    o.light.position.copy(o.mesh.position);

    // Walked into
    const d = camera.position.distanceTo(o.mesh.position);
    if (d < 1.0) {
      triggerChaseMode();
      removeOrb(i);
      continue;
    }

    if (o.life <= 0) removeOrb(i);
  }
}

function updateChase(dt) {
  if (!chaseMode) return;
  chaseTimer -= dt;
  if (chaseTimer <= 0) endChaseMode();
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.life -= dt;

    if (p.spin) p.mesh.rotation.y += p.spin * dt;

    if (p.gravity) {
      p.vel.y -= 12 * dt;
      p.fuse -= dt;
      if (p.fuse <= 0 || p.mesh.position.y <= 0.1) {
        spawnExplosion(p.mesh.position.clone());
        scene.remove(p.mesh);
        projectiles.splice(i, 1);
        continue;
      }
    }

    p.mesh.position.add(p.vel.clone().multiplyScalar(dt));

    // Orb pickup via projectile
    for (let j = orbs.length - 1; j >= 0; j--) {
      if (p.mesh.position.distanceTo(orbs[j].mesh.position) < 1.0) {
        triggerChaseMode();
        removeOrb(j);
      }
    }

    if (p.type === 'banner') {
      for (const u of users) {
        if (!u.alive) continue;
        const d = p.mesh.position.distanceTo(u.group.position.clone().add(new THREE.Vector3(0, 1, 0)));
        if (d < 1.2) {
          damageUser(u, p.damage);
          player.score += 10;
          checkMetaReveal();
          scene.remove(p.mesh);
          projectiles.splice(i, 1);
          break;
        }
      }
      if (!projectiles.includes(p)) continue;
    }

    if (p.life <= 0 || p.mesh.position.length() > 60) {
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
    }
  }
}

function updateTraps(dt) {
  users.forEach(u => { u.frozen = false; });

  for (let i = traps.length - 1; i >= 0; i--) {
    const t = traps[i];
    t.life -= dt;
    t.tick += dt;
    t.ring.material.opacity = 0.4 + Math.sin(t.tick * 4) * 0.3;

    users.forEach(u => {
      if (!u.alive) return;
      const d = new THREE.Vector2(t.pos.x - u.group.position.x, t.pos.z - u.group.position.z).length();
      if (d < 1.6) {
        u.frozen = true;
        damageUser(u, WEAPONS[2].damage * dt * 2);
        player.score += Math.floor(dt * 5);
        checkMetaReveal();
      }
    });

    if (t.life <= 0) {
      scene.remove(t.ring);
      scene.remove(t.label);
      traps.splice(i, 1);
    }
  }
}

function updateExplosions(dt) {
  for (let i = explosions.length - 1; i >= 0; i--) {
    const e = explosions[i];
    e.life -= dt;
    e.sprite.position.add(e.vel.clone().multiplyScalar(dt));
    e.vel.y -= 8 * dt;
    e.sprite.material.opacity = e.life;
    if (e.life <= 0) {
      scene.remove(e.sprite);
      explosions.splice(i, 1);
    }
  }
}

function updateDeathEffects(dt) {
  for (let i = deathEffects.length - 1; i >= 0; i--) {
    const d = deathEffects[i];
    d.age += dt;
    const t = d.age / d.life;
    // pop then fade
    const scale = t < 0.3 ? 1.5 * (t / 0.3) : 1.5;
    d.sprite.scale.set(scale, scale * 0.4, 1);
    d.sprite.position.y += dt * 0.6;
    d.sprite.material.opacity = Math.max(0, 1 - t);
    if (d.age >= d.life) {
      scene.remove(d.sprite);
      deathEffects.splice(i, 1);
    }
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (gameStarted && !gamePaused) {
    updatePlayer(dt);
    updateUserPopulation(dt);
    updateUsers(dt);
    updateOrbs(dt);
    updateChase(dt);
    updateProjectiles(dt);
    updateTraps(dt);
    updateExplosions(dt);
    updateDeathEffects(dt);
    updateDoor(dt);
    tickAnnouncer(dt);
    updateTimer();
    updateStockTicker(dt);
    updateHud();
  }

  renderer.render(scene, camera);
}

// ─── Loading & start ─────────────────────────────────────────────────────────
let loadProgress = 0;
const loadInterval = setInterval(() => {
  loadProgress += 8 + Math.random() * 12;
  if (loadProgress >= 100) {
    loadProgress = 100;
    clearInterval(loadInterval);
    setTimeout(startGame, 400);
  }
  document.getElementById('loadingBarFill').style.width = loadProgress + '%';
}, 120);

function startGame() {
  document.getElementById('loadingScreen').classList.add('hidden');
  gameStarted = true;
  sessionStart = performance.now();
  for (let i = 0; i < targetUserCount; i++) spawnUser();
  updateHud();
  animate();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
