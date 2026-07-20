/* =========================================================================
   ASTEROID BELT — a gyroscopic rail shooter
   Asteroids (1979) fracture physics × Star Fox (1993) forward rail flight.
   Vanilla JS, zero dependencies. Tilt to fly, tap to fire.
   ========================================================================= */

(() => {
  "use strict";

  // ---------------------------------------------------------------- canvas
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, CX = 0, CY = 0, FOCAL = 0, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    CX = W / 2;
    CY = H / 2;
    FOCAL = Math.min(W, H) * 0.9; // perspective strength
  }
  window.addEventListener("resize", resize);
  resize();

  // ------------------------------------------------------------- constants
  const PLAYER_Z = 2.2;        // ship depth plane
  const SPAWN_Z = 55;          // where rocks materialize
  const FIELD_X = 7;           // half-extent of playfield at player depth
  const FIELD_Y = 5;
  const BULLET_SPEED = 95;
  const BULLET_LIFE = 0.8;
  const SHIELD_MAX = 100;
  const HIT_DAMAGE = 24;
  const SHIELD_REGEN = 3.5;    // per second, after a quiet delay
  const REGEN_DELAY = 4;
  const COMBO_WINDOW = 2.6;    // seconds between kills to keep the chain
  const SECTOR_TIME = 22;      // seconds per sector (wave)
  const HI_KEY = "asteroid-belt-hiscore";

  const WEAPONS = {
    pulse:  { name: "PULSE LASER", rate: 0.20, color: "#7dfaff", shots: 1, spread: 0,    r: 0.28 },
    tri:    { name: "TRI-CANNON",  rate: 0.26, color: "#ffd166", shots: 3, spread: 0.16, r: 0.28 },
    vulcan: { name: "VULCAN",      rate: 0.075, color: "#ff7dfa", shots: 1, spread: 0.05, r: 0.22 },
    plasma: { name: "PLASMA ORB",  rate: 0.5,  color: "#8dff7d", shots: 1, spread: 0,    r: 0.95, pierce: true },
  };
  const WEAPON_TIME = 14; // seconds a pickup weapon lasts

  const POWERUP_TYPES = [
    { type: "tri",    color: "#ffd166", glyph: "≡" },
    { type: "vulcan", color: "#ff7dfa", glyph: "»" },
    { type: "plasma", color: "#8dff7d", glyph: "◉" },
    { type: "shield", color: "#7dfaff", glyph: "S" },
  ];

  // ROCK SIZES: score follows classic Asteroids (small pays most)
  const ROCK = {
    3: { r: 3.1, score: 20,  child: 2, children: [2, 3] },
    2: { r: 1.7, score: 50,  child: 1, children: [2, 3] },
    1: { r: 0.85, score: 100, child: 0, children: [] },
  };

  // ------------------------------------------------------------------ state
  const S = {
    mode: "title",             // title | playing | gameover
    time: 0,
    score: 0,
    hiscore: Number(localStorage.getItem(HI_KEY) || 0),
    kills: 0,
    sector: 1,
    sectorClock: 0,
    shield: SHIELD_MAX,
    lastHitAt: -99,
    combo: 0,
    comboClock: 0,
    weapon: "pulse",
    weaponClock: 0,
    fireCooldown: 0,
    speed: 14,                 // forward rail speed (world units / s)
    spawnClock: 0,
    shake: 0,
    flash: 0,
  };

  const ship = { x: 0, y: 0, tx: 0, ty: 0, r: 0.55, bank: 0 };
  const aim = { x: 0, y: 0 }; // reticle offset ahead of ship

  let asteroids = [];
  let bullets = [];
  let particles = [];
  let powerups = [];
  let stars = [];

  function initStars() {
    stars = [];
    for (let i = 0; i < 140; i++) {
      stars.push({
        x: (Math.random() * 2 - 1) * FIELD_X * 3,
        y: (Math.random() * 2 - 1) * FIELD_Y * 3,
        z: 1 + Math.random() * SPAWN_Z,
      });
    }
  }
  initStars();

  // ------------------------------------------------------------------ input
  const input = {
    firing: false,
    gyro: false,
    beta0: null, gamma0: null,   // calibration
    tiltX: 0, tiltY: 0,          // -1..1
    mouseX: 0, mouseY: 0,
    usingMouse: false,
    keys: {},
  };

  function orientationHandler(e) {
    if (e.beta == null || e.gamma == null) return;
    let beta = e.beta, gamma = e.gamma;
    // Remap axes when the phone is held landscape
    const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    if (angle === 90)  { const t = beta; beta = -gamma; gamma = t; }
    if (angle === -90 || angle === 270) { const t = beta; beta = gamma; gamma = -t; }

    if (input.beta0 === null) { input.beta0 = beta; input.gamma0 = gamma; }
    // ~18° of tilt = full deflection; subtle by design
    input.tiltX = clamp((gamma - input.gamma0) / 18, -1, 1);
    input.tiltY = clamp((beta - input.beta0) / 18, -1, 1);
    input.gyro = true;
    input.usingMouse = false;
  }

  async function enableGyro() {
    const status = document.getElementById("gyro-status");
    try {
      if (typeof DeviceOrientationEvent !== "undefined" &&
          typeof DeviceOrientationEvent.requestPermission === "function") {
        const res = await DeviceOrientationEvent.requestPermission(); // iOS gate
        if (res !== "granted") {
          status.textContent = "GYRO DENIED — TOUCH-DRAG MODE";
          return;
        }
      }
      window.addEventListener("deviceorientation", orientationHandler);
      status.textContent = "";
    } catch {
      status.textContent = "NO GYRO — TOUCH-DRAG MODE";
    }
  }

  function recalibrate() { input.beta0 = null; input.gamma0 = null; }

  // Pointer: fire on press; on touch without gyro, dragging steers.
  let touchSteer = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (S.mode !== "playing") return;
    input.firing = true;
    if (e.pointerType !== "mouse" && !input.gyro) {
      touchSteer = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: ship.tx, sy: ship.ty };
    }
    ensureAudio();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") {
      input.mouseX = e.clientX;
      input.mouseY = e.clientY;
      input.usingMouse = true;
    } else if (touchSteer && e.pointerId === touchSteer.id) {
      const k = 3.2 / Math.min(W, H);
      input.tiltX = clamp(touchSteer.sx / FIELD_X + (e.clientX - touchSteer.x) * k, -1, 1);
      input.tiltY = clamp(touchSteer.sy / FIELD_Y + (e.clientY - touchSteer.y) * k, -1, 1);
    }
  });
  const endPointer = (e) => {
    input.firing = false;
    if (touchSteer && e.pointerId === touchSteer.id) touchSteer = null;
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  window.addEventListener("keydown", (e) => {
    input.keys[e.code] = true;
    if (e.code === "Space") { input.firing = true; e.preventDefault(); }
    if (e.code === "KeyC") recalibrate();
  });
  window.addEventListener("keyup", (e) => {
    input.keys[e.code] = false;
    if (e.code === "Space") input.firing = false;
  });

  // ------------------------------------------------------------------ audio
  let AC = null;
  function ensureAudio() {
    if (!AC) {
      try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    }
    if (AC.state === "suspended") AC.resume();
  }

  function tone(freq, dur, type = "square", vol = 0.12, slideTo = null) {
    if (!AC || AC.state !== "running") return;
    const t = AC.currentTime;
    const o = AC.createOscillator();
    const g = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(AC.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise(dur, vol = 0.2, low = 400) {
    if (!AC || AC.state !== "running") return;
    const t = AC.currentTime;
    const len = Math.floor(AC.sampleRate * dur);
    const buf = AC.createBuffer(1, len, AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = AC.createBufferSource();
    src.buffer = buf;
    const f = AC.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(2400, t);
    f.frequency.exponentialRampToValueAtTime(low, t + dur);
    const g = AC.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(AC.destination);
    src.start(t);
  }

  const sfx = {
    zap:    () => tone(880, 0.09, "square", 0.07, 220),
    plasma: () => tone(140, 0.25, "sawtooth", 0.1, 60),
    boom:   (size) => noise(0.25 + size * 0.12, 0.14 + size * 0.05, 260 - size * 50),
    hit:    () => { noise(0.4, 0.3, 120); tone(90, 0.35, "sawtooth", 0.15, 40); },
    pickup: () => { tone(523, 0.09, "square", 0.09); setTimeout(() => tone(784, 0.09, "square", 0.09), 80); setTimeout(() => tone(1046, 0.14, "square", 0.09), 160); },
    sector: () => { tone(392, 0.12, "triangle", 0.1); setTimeout(() => tone(587, 0.2, "triangle", 0.1), 130); },
    over:   () => tone(300, 1.1, "sawtooth", 0.15, 40),
  };

  // ------------------------------------------------------------------ utils
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // Perspective projection: world (x, y, z) -> screen
  function project(x, y, z) {
    const s = FOCAL / z;
    return { x: CX + (x - ship.x * 0.35) * s, y: CY + (y - ship.y * 0.35) * s, s };
  }

  // ----------------------------------------------------------------- rocks
  function makeShape() {
    // Jagged vector polygon + a few interior fracture lines: "high-poly wireframe"
    const n = 9 + Math.floor(Math.random() * 4);
    const pts = [];
    for (let i = 0; i < n; i++) {
      pts.push({ a: (i / n) * Math.PI * 2, r: rand(0.62, 1.05) });
    }
    const cracks = [];
    for (let i = 0; i < 3; i++) {
      cracks.push([Math.floor(Math.random() * n), Math.floor(Math.random() * n)]);
    }
    return { pts, cracks };
  }

  function spawnAsteroid(size, x, y, z, vx, vy, vz) {
    asteroids.push({
      size,
      r: ROCK[size].r,
      x, y, z,
      vx, vy, vz,
      rot: Math.random() * Math.PI * 2,
      vrot: rand(-1.6, 1.6),
      shape: makeShape(),
      hp: size === 3 ? 2 : 1,
      hue: Math.random() < 0.18 ? "#ff7dfa" : (Math.random() < 0.3 ? "#9db4ff" : "#cfd8e3"),
    });
  }

  function spawnWaveRock() {
    const size = Math.random() < 0.62 ? 3 : 2;
    const x = rand(-FIELD_X, FIELD_X);
    const y = rand(-FIELD_Y, FIELD_Y);
    const drift = 0.35 + S.sector * 0.06;
    spawnAsteroid(size, x, y, SPAWN_Z * rand(0.9, 1.15),
      rand(-drift, drift), rand(-drift, drift),
      -(S.speed * rand(0.15, 0.4))); // extra closure speed on top of rail speed
  }

  function fracture(a, impactVX, impactVY) {
    const info = ROCK[a.size];
    if (!info.child) return;
    const n = info.children[Math.floor(Math.random() * info.children.length)];
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const kick = rand(1.4, 2.6) * (4 - a.size); // smaller fragments fly faster
      spawnAsteroid(
        info.child,
        a.x + Math.cos(ang) * a.r * 0.4,
        a.y + Math.sin(ang) * a.r * 0.4,
        a.z + rand(-0.5, 0.5),
        a.vx + Math.cos(ang) * kick + impactVX * 0.3,
        a.vy + Math.sin(ang) * kick + impactVY * 0.3,
        a.vz * rand(1.05, 1.35)
      );
    }
  }

  // ------------------------------------------------------------- particles
  function burst(x, y, z, color, count, power) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = rand(1, 4) * power;
      particles.push({
        x, y, z,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, vz: rand(-3, 3),
        life: rand(0.3, 0.8), t: 0, color,
        len: rand(0.1, 0.4) * power,
      });
    }
  }

  // -------------------------------------------------------------- powerups
  function maybeDropPowerup(a) {
    if (Math.random() > 0.11) return;
    const p = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    powerups.push({
      ...p,
      x: a.x, y: a.y, z: a.z,
      vx: a.vx * 0.4, vy: a.vy * 0.4, vz: -S.speed * 0.1,
      rot: 0, r: 0.7,
    });
  }

  function applyPowerup(p) {
    sfx.pickup();
    if (p.type === "shield") {
      S.shield = Math.min(SHIELD_MAX, S.shield + 40);
    } else {
      S.weapon = p.type;
      S.weaponClock = WEAPON_TIME;
    }
    updateHUD(true);
  }

  // ----------------------------------------------------------------- combat
  function fire() {
    const w = WEAPONS[S.weapon];
    S.fireCooldown = w.rate;
    // Aim vector: from ship toward the reticle point deep in the field
    const AIM_Z = 30;
    for (let i = 0; i < w.shots; i++) {
      const off = (i - (w.shots - 1) / 2) * w.spread;
      const jitter = w.spread && w.shots === 1 ? rand(-w.spread, w.spread) : 0;
      const dx = (aim.x - ship.x) / (AIM_Z - PLAYER_Z) + off + jitter;
      const dy = (aim.y - ship.y) / (AIM_Z - PLAYER_Z) + (w.shots > 1 ? jitter : 0);
      bullets.push({
        x: ship.x, y: ship.y, z: PLAYER_Z + 0.3,
        vx: dx * BULLET_SPEED, vy: dy * BULLET_SPEED, vz: BULLET_SPEED,
        t: 0, w,
      });
    }
    (S.weapon === "plasma" ? sfx.plasma : sfx.zap)();
  }

  function killAsteroid(a, b) {
    const info = ROCK[a.size];
    S.kills++;
    S.combo++;
    S.comboClock = COMBO_WINDOW;
    const mult = comboMult();
    S.score += info.score * mult;
    fracture(a, b ? b.vx / BULLET_SPEED : 0, b ? b.vy / BULLET_SPEED : 0);
    maybeDropPowerup(a);
    burst(a.x, a.y, a.z, a.hue, 8 + a.size * 5, a.size);
    sfx.boom(a.size);
    if (mult > 1) popMult();
    updateHUD();
  }

  function comboMult() { return Math.min(5, 1 + Math.floor(S.combo / 4)); }

  function damageShip(a) {
    S.shield -= HIT_DAMAGE;
    S.lastHitAt = S.time;
    S.combo = 0;
    S.shake = 0.6;
    S.flash = 0.5;
    burst(a.x, a.y, a.z, "#ff5d5d", 22, 2.4);
    sfx.hit();
    if (navigator.vibrate) navigator.vibrate(80);
    updateHUD();
    if (S.shield <= 0) gameOver();
  }

  // ------------------------------------------------------------------ flow
  function startGame() {
    S.mode = "playing";
    S.time = 0; S.score = 0; S.kills = 0;
    S.sector = 1; S.sectorClock = 0;
    S.shield = SHIELD_MAX; S.lastHitAt = -99;
    S.combo = 0; S.comboClock = 0;
    S.weapon = "pulse"; S.weaponClock = 0; S.fireCooldown = 0;
    S.speed = 14; S.spawnClock = 0; S.shake = 0; S.flash = 0;
    ship.x = ship.y = ship.tx = ship.ty = 0;
    asteroids = []; bullets = []; particles = []; powerups = [];
    recalibrate();
    for (let i = 0; i < 6; i++) spawnWaveRock();
    document.getElementById("title-screen").classList.add("hidden");
    document.getElementById("gameover-screen").classList.add("hidden");
    document.getElementById("hud").classList.remove("hidden");
    banner("SECTOR 1");
    updateHUD(true);
  }

  function gameOver() {
    S.mode = "gameover";
    sfx.over();
    if (navigator.vibrate) navigator.vibrate([120, 60, 200]);
    const isNew = S.score > S.hiscore;
    if (isNew) {
      S.hiscore = S.score;
      localStorage.setItem(HI_KEY, String(S.hiscore));
    }
    document.getElementById("final-score").textContent = S.score.toLocaleString();
    document.getElementById("final-sector").textContent = S.sector;
    document.getElementById("final-kills").textContent = S.kills;
    document.getElementById("new-hiscore").classList.toggle("hidden", !isNew);
    document.getElementById("hud").classList.add("hidden");
    document.getElementById("gameover-screen").classList.remove("hidden");
  }

  function banner(text) {
    const el = document.getElementById("hud-banner");
    el.textContent = text;
    el.classList.remove("hidden");
    // restart the CSS animation
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
  }

  // ------------------------------------------------------------------- HUD
  const hudEls = {
    score: document.getElementById("hud-score"),
    hiscore: document.getElementById("hud-hiscore"),
    mult: document.getElementById("hud-multiplier"),
    shield: document.getElementById("hud-shield"),
    weapon: document.getElementById("hud-weapon"),
    wtimer: document.getElementById("hud-weapon-timer"),
    wtimerFill: document.getElementById("hud-weapon-timer-fill"),
  };

  function updateHUD(force) {
    hudEls.score.textContent = S.score.toLocaleString();
    hudEls.hiscore.textContent = Math.max(S.hiscore, S.score).toLocaleString();
    const m = comboMult();
    hudEls.mult.textContent = "×" + m;
    hudEls.mult.classList.toggle("active", m > 1);
    const pct = clamp(S.shield / SHIELD_MAX, 0, 1);
    hudEls.shield.style.width = (pct * 100) + "%";
    hudEls.shield.classList.toggle("low", pct < 0.3);
    if (force) hudEls.weapon.textContent = WEAPONS[S.weapon].name;
    hudEls.wtimer.style.visibility = S.weapon !== "pulse" ? "visible" : "hidden";
  }

  function popMult() {
    hudEls.mult.classList.add("pop");
    setTimeout(() => hudEls.mult.classList.remove("pop"), 150);
  }

  // ---------------------------------------------------------------- update
  function update(dt) {
    S.time += dt;

    // --- steering ---
    if (input.usingMouse) {
      ship.tx = clamp(((input.mouseX - CX) / (W / 2)) * FIELD_X, -FIELD_X, FIELD_X);
      ship.ty = clamp(((input.mouseY - CY) / (H / 2)) * FIELD_Y, -FIELD_Y, FIELD_Y);
    } else {
      let kx = 0, ky = 0;
      if (input.keys.ArrowLeft || input.keys.KeyA) kx -= 1;
      if (input.keys.ArrowRight || input.keys.KeyD) kx += 1;
      if (input.keys.ArrowUp || input.keys.KeyW) ky -= 1;
      if (input.keys.ArrowDown || input.keys.KeyS) ky += 1;
      if (kx || ky) { input.tiltX = clamp(input.tiltX + kx * dt * 3, -1, 1); input.tiltY = clamp(input.tiltY + ky * dt * 3, -1, 1); }
      ship.tx = input.tiltX * FIELD_X;
      ship.ty = input.tiltY * FIELD_Y;
    }
    const ease = 1 - Math.pow(0.0018, dt); // smooth, frame-rate independent
    const oldX = ship.x;
    ship.x += (ship.tx - ship.x) * ease;
    ship.y += (ship.ty - ship.y) * ease;
    ship.bank = clamp((ship.x - oldX) / Math.max(dt, 1e-4) / 14, -1, 1);
    aim.x = ship.x * 1.6; // reticle leads the ship outward
    aim.y = ship.y * 1.6;

    // --- pacing ---
    S.sectorClock += dt;
    if (S.sectorClock >= SECTOR_TIME) {
      S.sectorClock = 0;
      S.sector++;
      S.speed += 2.2;
      banner("SECTOR " + S.sector);
      sfx.sector();
    }
    const spawnEvery = Math.max(0.28, 1.35 - S.sector * 0.1);
    S.spawnClock -= dt;
    if (S.spawnClock <= 0 && asteroids.length < 26 + S.sector * 2) {
      S.spawnClock = spawnEvery * rand(0.7, 1.3);
      spawnWaveRock();
    }

    // --- combo decay ---
    if (S.combo > 0) {
      S.comboClock -= dt;
      if (S.comboClock <= 0) { S.combo = 0; updateHUD(); }
    }

    // --- shield regen ---
    if (S.shield < SHIELD_MAX && S.time - S.lastHitAt > REGEN_DELAY) {
      S.shield = Math.min(SHIELD_MAX, S.shield + SHIELD_REGEN * dt);
      updateHUD();
    }

    // --- weapon timer ---
    if (S.weapon !== "pulse") {
      S.weaponClock -= dt;
      hudEls.wtimerFill.style.width = clamp(S.weaponClock / WEAPON_TIME, 0, 1) * 100 + "%";
      if (S.weaponClock <= 0) { S.weapon = "pulse"; updateHUD(true); }
    }

    // --- firing ---
    S.fireCooldown -= dt;
    if (input.firing && S.fireCooldown <= 0) fire();

    // --- bullets ---
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.t += dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      const oldZ = b.z;
      b.z += b.vz * dt;
      if (b.t > BULLET_LIFE) { bullets.splice(i, 1); continue; }

      // swept z-collision against every rock
      for (let j = asteroids.length - 1; j >= 0; j--) {
        const a = asteroids[j];
        if (a.z < oldZ - a.r || a.z > b.z + a.r) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const rr = a.r + b.w.r;
        if (dx * dx + dy * dy < rr * rr) {
          a.hp--;
          if (a.hp <= 0) {
            asteroids.splice(j, 1);
            killAsteroid(a, b);
          } else {
            burst(b.x, b.y, a.z, "#ffffff", 5, 0.8);
            sfx.boom(0);
          }
          if (!b.w.pierce) { bullets.splice(i, 1); }
          break;
        }
      }
    }

    // --- asteroids ---
    for (let i = asteroids.length - 1; i >= 0; i--) {
      const a = asteroids[i];
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.z += (a.vz - S.speed) * dt;
      a.rot += a.vrot * dt;

      if (a.z <= PLAYER_Z) {
        // reached the camera plane: hit us or whistle past
        const dx = a.x - ship.x, dy = a.y - ship.y;
        const rr = a.r * 0.8 + ship.r; // forgive near-misses

        asteroids.splice(i, 1);
        if (dx * dx + dy * dy < rr * rr) damageShip(a);
        continue;
      }
      // wandering fragments get gently pulled back toward the corridor
      if (Math.abs(a.x) > FIELD_X * 2.2) a.vx -= Math.sign(a.x) * dt * 2;
      if (Math.abs(a.y) > FIELD_Y * 2.2) a.vy -= Math.sign(a.y) * dt * 2;
    }

    // --- powerups ---
    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.z += (p.vz - S.speed) * dt;
      p.rot += dt * 3;
      if (p.z <= PLAYER_Z) {
        const dx = p.x - ship.x, dy = p.y - ship.y;
        const rr = p.r + ship.r + 0.5; // generous magnet
        powerups.splice(i, 1);
        if (dx * dx + dy * dy < rr * rr) applyPowerup(p);
      }
    }

    // --- particles ---
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      if (p.t > p.life) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.z += (p.vz - S.speed * 0.6) * dt;
      if (p.z < 0.4) particles.splice(i, 1);
    }

    // --- stars ---
    for (const st of stars) {
      st.z -= S.speed * 1.4 * dt;
      if (st.z < 0.5) {
        st.z = SPAWN_Z;
        st.x = (Math.random() * 2 - 1) * FIELD_X * 3;
        st.y = (Math.random() * 2 - 1) * FIELD_Y * 3;
      }
    }

    S.shake = Math.max(0, S.shake - dt * 1.6);
    S.flash = Math.max(0, S.flash - dt * 1.8);
  }

  // ---------------------------------------------------------------- render
  function render() {
    ctx.fillStyle = "#02040a";
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    if (S.shake > 0) {
      ctx.translate(rand(-1, 1) * S.shake * 14, rand(-1, 1) * S.shake * 14);
    }

    // starfield streaks
    ctx.lineCap = "round";
    for (const st of stars) {
      const p1 = project(st.x, st.y, st.z);
      const p2 = project(st.x, st.y, st.z + S.speed * 0.06);
      const a = clamp(1.6 - st.z / SPAWN_Z * 1.6, 0.08, 0.9);
      ctx.strokeStyle = `rgba(160, 210, 255, ${a})`;
      ctx.lineWidth = clamp(p1.s * 0.012, 0.5, 2.5);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    // depth-sort: far things first
    const drawables = [];
    for (const a of asteroids) drawables.push({ z: a.z, kind: 0, o: a });
    for (const p of powerups) drawables.push({ z: p.z, kind: 1, o: p });
    for (const b of bullets) drawables.push({ z: b.z, kind: 2, o: b });
    for (const p of particles) drawables.push({ z: p.z, kind: 3, o: p });
    drawables.sort((m, n) => n.z - m.z);

    for (const d of drawables) {
      if (d.kind === 0) drawAsteroid(d.o);
      else if (d.kind === 1) drawPowerup(d.o);
      else if (d.kind === 2) drawBullet(d.o);
      else drawParticle(d.o);
    }

    if (S.mode === "playing") {
      drawReticle();
      drawShip();
    }

    ctx.restore();

    // damage flash vignette
    if (S.flash > 0) {
      const g = ctx.createRadialGradient(CX, CY, Math.min(W, H) * 0.25, CX, CY, Math.max(W, H) * 0.7);
      g.addColorStop(0, "rgba(255,60,60,0)");
      g.addColorStop(1, `rgba(255,60,60,${S.flash * 0.55})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawAsteroid(a) {
    const p = project(a.x, a.y, a.z);
    const R = a.r * p.s;
    if (R < 0.5 || p.x < -R || p.x > W + R || p.y < -R || p.y > H + R) return;
    const fog = clamp(1.25 - a.z / SPAWN_Z, 0.12, 1);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(a.rot);
    ctx.globalAlpha = fog;
    ctx.strokeStyle = a.hue;
    ctx.lineWidth = clamp(R * 0.06, 1, 3);
    ctx.shadowColor = a.hue;
    ctx.shadowBlur = clamp(R * 0.25, 2, 14);
    ctx.fillStyle = "rgba(8, 14, 24, 0.85)";
    ctx.beginPath();
    const pts = a.shape.pts;
    for (let i = 0; i < pts.length; i++) {
      const x = Math.cos(pts[i].a) * pts[i].r * R;
      const y = Math.sin(pts[i].a) * pts[i].r * R;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // interior fracture lines
    ctx.globalAlpha = fog * 0.45;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    for (const [i1, i2] of a.shape.cracks) {
      ctx.moveTo(Math.cos(pts[i1].a) * pts[i1].r * R, Math.sin(pts[i1].a) * pts[i1].r * R);
      ctx.lineTo(Math.cos(pts[i2].a) * pts[i2].r * R * 0.3, Math.sin(pts[i2].a) * pts[i2].r * R * 0.3);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawBullet(b) {
    const p1 = project(b.x, b.y, b.z);
    const p2 = project(b.x - b.vx * 0.02, b.y - b.vy * 0.02, b.z - b.vz * 0.025);
    ctx.save();
    ctx.strokeStyle = b.w.color;
    ctx.shadowColor = b.w.color;
    ctx.shadowBlur = 10;
    ctx.lineWidth = clamp(b.w.r * p1.s * 0.5, 1.5, b.w.pierce ? 16 : 7);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    if (b.w.pierce) {
      ctx.fillStyle = b.w.color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, clamp(b.w.r * p1.s * 0.45, 2, 26), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawParticle(p) {
    const pr = project(p.x, p.y, p.z);
    const a = 1 - p.t / p.life;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 6;
    ctx.lineWidth = clamp(pr.s * 0.02, 1, 3);
    const dx = p.vx * 0.04 * pr.s * 0.02, dy = p.vy * 0.04 * pr.s * 0.02;
    ctx.beginPath();
    ctx.moveTo(pr.x, pr.y);
    ctx.lineTo(pr.x + dx * p.len * 40, pr.y + dy * p.len * 40);
    ctx.stroke();
    ctx.restore();
  }

  function drawPowerup(p) {
    const pr = project(p.x, p.y, p.z);
    const R = p.r * pr.s;
    if (R < 1) return;
    ctx.save();
    ctx.translate(pr.x, pr.y);
    ctx.strokeStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 14;
    ctx.lineWidth = 2;
    // spinning hex pod
    ctx.rotate(p.rot);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.cos(a) * R, y = Math.sin(a) * R;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.rotate(-p.rot);
    ctx.fillStyle = p.color;
    ctx.font = `bold ${Math.max(10, R)}px "Courier New", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(p.glyph, 0, 1);
    ctx.restore();
  }

  function drawShip() {
    const p = project(ship.x, ship.y, PLAYER_Z);
    const s = ship.r * p.s;
    ctx.save();
    ctx.translate(p.x, p.y + s * 0.9);
    ctx.rotate(ship.bank * 0.5);
    ctx.scale(1, 1 - Math.abs(ship.bank) * 0.18); // slight roll foreshortening
    ctx.strokeStyle = "#7dfaff";
    ctx.shadowColor = "#7dfaff";
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2;
    ctx.fillStyle = "rgba(6, 20, 30, 0.9)";
    // arwing-ish dart
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.15);
    ctx.lineTo(s * 0.38, s * 0.25);
    ctx.lineTo(s * 1.15, s * 0.72);
    ctx.lineTo(s * 0.45, s * 0.62);
    ctx.lineTo(0, s * 0.95);
    ctx.lineTo(-s * 0.45, s * 0.62);
    ctx.lineTo(-s * 1.15, s * 0.72);
    ctx.lineTo(-s * 0.38, s * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // engine glow
    const fl = 0.6 + Math.random() * 0.4;
    ctx.strokeStyle = "#ff7dfa";
    ctx.shadowColor = "#ff7dfa";
    ctx.beginPath();
    ctx.moveTo(-s * 0.2, s * 0.8);
    ctx.lineTo(0, s * (0.95 + fl * 0.55));
    ctx.lineTo(s * 0.2, s * 0.8);
    ctx.stroke();
    // shield ring when recently hit or regenerating
    if (S.time - S.lastHitAt < 1.2) {
      const t = (S.time - S.lastHitAt) / 1.2;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = "#7dfaff";
      ctx.shadowColor = "#7dfaff";
      ctx.beginPath();
      ctx.arc(0, -s * 0.1, s * (1.6 + t * 1.4), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawReticle() {
    const AIM_Z = 30;
    const p = project(aim.x, aim.y, AIM_Z);
    const r = 14;
    ctx.save();
    ctx.strokeStyle = "rgba(125, 250, 255, 0.85)";
    ctx.shadowColor = "#7dfaff";
    ctx.shadowBlur = 8;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.moveTo(p.x - r * 1.7, p.y); ctx.lineTo(p.x - r * 0.6, p.y);
    ctx.moveTo(p.x + r * 0.6, p.y); ctx.lineTo(p.x + r * 1.7, p.y);
    ctx.moveTo(p.x, p.y - r * 1.7); ctx.lineTo(p.x, p.y - r * 0.6);
    ctx.moveTo(p.x, p.y + r * 0.6); ctx.lineTo(p.x, p.y + r * 1.7);
    ctx.stroke();
    // inner mid-range reticle for depth cue
    const p2 = project(aim.x * 0.7, aim.y * 0.7, AIM_Z * 0.5);
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(p2.x, p2.y, r * 1.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------- main loop
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (S.mode === "playing") update(dt);
    else {
      // ambient drift on menus
      S.time += dt;
      for (const st of stars) {
        st.z -= 6 * dt;
        if (st.z < 0.5) st.z = SPAWN_Z;
      }
      for (const a of asteroids) { a.rot += a.vrot * dt; a.z -= 2 * dt; if (a.z < 3) a.z = SPAWN_Z; }
    }
    render();
    requestAnimationFrame(frame);
  }

  // menu backdrop rocks
  for (let i = 0; i < 10; i++) {
    spawnAsteroid(Math.random() < 0.5 ? 3 : 2,
      rand(-FIELD_X, FIELD_X), rand(-FIELD_Y, FIELD_Y), rand(8, SPAWN_Z),
      0, 0, 0);
  }

  // --------------------------------------------------------------- buttons
  document.getElementById("btn-start").addEventListener("click", async () => {
    ensureAudio();
    await enableGyro(); // must happen inside the tap gesture (iOS)
    startGame();
  });
  document.getElementById("btn-restart").addEventListener("click", () => {
    ensureAudio();
    startGame();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && AC) AC.suspend();
    else if (AC) AC.resume();
    last = performance.now();
  });

  document.getElementById("hud-hiscore").textContent = S.hiscore.toLocaleString();
  requestAnimationFrame(frame);

  // ------------------------------------------------------------------- PWA
  // Offline install shell. A controller already present means this page's
  // own assets came from a prior install — any *later* controllerchange is
  // a genuine new version taking over, so reload to pick it up. A fresh
  // install shouldn't reload.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      const sw = navigator.serviceWorker;
      const hadController = !!sw.controller;
      const reg = await sw.register("./sw.js");

      let reloaded = false;
      sw.addEventListener("controllerchange", () => {
        if (!hadController || reloaded) return;
        reloaded = true;
        location.reload();
      });

      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) reg.update();
      });
    });
  }
  // Install prompt is left to the browser's own UI rather than a custom
  // button; we don't intercept or preventDefault() beforeinstallprompt.
})();
