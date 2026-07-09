import * as THREE from 'three';
import { CELL, COL_MIN, COL_MAX, LANES_AHEAD, LANES_BEHIND, gridX, gridZ } from './grid';
import { mulberry32, pick, range, lerp, type Rng } from './rng';

export type LaneType = 'ASH' | 'ROAD' | 'RAIL' | 'MIRE' | 'GRATE';

export interface Hazard {
  kind: 'car' | 'grate' | 'patroller';
  x: number; prevX: number;
  halfW: number;
  speed: number;               // units/sec, signed
  mesh: THREE.Object3D;
  stepTimer?: number;          // patroller
  walkPhase?: number;
}

export interface Lane {
  row: number;
  type: LaneType;
  group: THREE.Group;
  hazards: Hazard[];
  // rail state
  trainState: 'idle' | 'telegraph' | 'run' | 'cooldown';
  trainTimer: number;
  trainX: number;
  trainMesh: THREE.Object3D | null;
  signal: THREE.Mesh | null;
}

const WRAP = 8.5;              // hazard wrap extent in x
const LANE_W = 13;             // visual ground width

// ---------------------------------------------------------------------------
// Shared materials — vertex-color aesthetic on a tiny material set.
// ---------------------------------------------------------------------------
const matFor = new Map<number, THREE.MeshLambertMaterial>();
export function mat(color: number, emissive = 0): THREE.MeshLambertMaterial {
  const key = color * 16777216 + emissive;
  let m = matFor.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, emissive });
    matFor.set(key, m);
  }
  return m;
}

const box = (w: number, h: number, d: number, color: number, emissive = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, emissive));
  return m;
};

// Seeded vertex jitter so no two wrecks look identical.
function jitter(mesh: THREE.Mesh, rng: Rng, amt = 0.04) {
  const g = mesh.geometry.clone();
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i,
      p.getX(i) + (rng() - 0.5) * amt,
      p.getY(i) + (rng() - 0.5) * amt,
      p.getZ(i) + (rng() - 0.5) * amt);
  }
  p.needsUpdate = true;
  mesh.geometry = g;
  return mesh;
}

// ---------------------------------------------------------------------------
// Prop generators — everything is primitives; no model files exist.
// ---------------------------------------------------------------------------
export function makeCar(rng: Rng): THREE.Group {
  const g = new THREE.Group();
  const rusts = [0x3a2e26, 0x41332a, 0x2e2a28, 0x38312c, 0x452f24];
  const bodyC = pick(rng, rusts);
  const body = jitter(box(1.7, 0.42, 0.78, bodyC), rng, 0.07);
  body.position.y = 0.32;
  const cabin = jitter(box(0.92, 0.34, 0.7, bodyC), rng, 0.07);
  cabin.position.set(range(rng, -0.2, 0.2), 0.66, 0);
  // dim headlights — sickly amber glow that reads through the fog
  const lampMat = new THREE.MeshLambertMaterial({ color: 0x1a1712, emissive: 0xd9a04a });
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.16), lampMat);
  const eyeR = eyeL.clone();
  eyeL.position.set(0.87, 0.36, 0.2); eyeR.position.set(0.87, 0.36, -0.2);
  g.add(body, cabin, eyeL, eyeR);
  g.rotation.y = rng() > 0.5 ? 0 : Math.PI;
  return g;
}

export function makeGrate(rng: Rng): THREE.Group {
  const g = new THREE.Group();
  const plate = box(1.8, 0.1, 0.86, 0x2c2f33);
  plate.position.y = 0.05;
  g.add(plate);
  for (let i = -2; i <= 2; i++) {
    const bar = box(0.06, 0.05, 0.86, 0x44484e);
    bar.position.set(i * 0.34 + range(rng, -0.02, 0.02), 0.12, 0);
    g.add(bar);
  }
  return g;
}

export function makePatroller(): THREE.Group {
  // deliberately stiff, wrong-looking mannequin — 8 boxes, procedural walk
  const g = new THREE.Group();
  const skin = 0x201d22;
  const torso = box(0.34, 0.52, 0.2, skin); torso.position.y = 0.86; torso.name = 'torso';
  const head = box(0.2, 0.24, 0.2, 0x2a2229); head.position.y = 1.28; head.name = 'head';
  const mk = (nm: string, x: number, y: number, h: number) => {
    const limb = box(0.11, h, 0.11, skin);
    limb.geometry.translate(0, -h / 2, 0);   // pivot at top
    limb.position.set(x, y, 0); limb.name = nm;
    return limb;
  };
  g.add(torso, head,
    mk('armL', -0.26, 1.06, 0.5), mk('armR', 0.26, 1.06, 0.5),
    mk('legL', -0.1, 0.62, 0.62), mk('legR', 0.1, 0.62, 0.62));
  return g;
}

export function makeTrain(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const car = box(2.6, 1.5, 0.92, i === 0 ? 0x1c1a1e : 0x17161a);
    car.position.set(i * 2.75 - 5.5, 0.8, 0);
    g.add(car);
  }
  return g;
}

function makeDebris(rng: Rng): THREE.Mesh {
  const s = range(rng, 0.08, 0.35);
  const m = jitter(box(s, s * range(rng, 0.4, 1), s, pick(rng, [0x35322e, 0x2b2926, 0x3c352c])), rng, 0.1);
  m.rotation.y = rng() * Math.PI;
  return m;
}

function makeLampPost(rng: Rng): THREE.Group {
  const g = new THREE.Group();
  const pole = box(0.08, 2.6, 0.08, 0x23262b);
  pole.position.y = 1.3;
  pole.rotation.z = range(rng, -0.12, 0.12);   // everything leans, tired
  const head = box(0.4, 0.1, 0.12, 0x1c1f24);
  head.position.set(0.18, 2.6, 0);
  g.add(pole, head);
  return g;
}

function makeFence(rng: Rng, x: number): THREE.Group {
  const g = new THREE.Group();
  const post = box(0.06, 1.4, 0.06, 0x2a2d31); post.position.y = 0.7;
  const mesh = box(1.0, 1.1, 0.02, 0x1f2226); mesh.position.set(0, 0.8, 0);
  (mesh.material as THREE.MeshLambertMaterial).transparent = true;
  g.add(post, mesh);
  g.position.x = x;
  g.rotation.y = range(rng, -0.1, 0.1);
  return g;
}

// ---------------------------------------------------------------------------
// Lane construction
// ---------------------------------------------------------------------------
const GROUND: Record<LaneType, { color: number; emissive?: number }> = {
  ASH:   { color: 0x3a3733 },
  ROAD:  { color: 0x232326 },
  RAIL:  { color: 0x26231f },
  MIRE:  { color: 0x272a26 },
  GRATE: { color: 0x121013, emissive: 0x1c0703 }, // void glow beneath
};

function buildLaneVisual(lane: Lane, rng: Rng) {
  const g = lane.group;
  const spec = GROUND[lane.type];
  const ground = box(LANE_W, 0.12, 0.98, spec.color, spec.emissive ?? 0);
  ground.position.y = -0.06;
  g.add(ground);

  switch (lane.type) {
    case 'ASH': {
      const n = 2 + Math.floor(rng() * 4);
      for (let i = 0; i < n; i++) {
        const d = makeDebris(rng);
        d.position.set(range(rng, -6, 6), d.geometry.boundingBox ? 0 : 0.05, range(rng, -0.3, 0.3));
        g.add(d);
      }
      if (rng() > 0.55) {
        const lamp = makeLampPost(rng);
        lamp.position.set(pick(rng, [-5.2, 5.2]), 0, 0);
        g.add(lamp);
      }
      break;
    }
    case 'ROAD': {
      // faded center line fragments
      for (let x = -6; x < 6; x += 1.4) {
        if (rng() > 0.4) {
          const dash = box(0.5, 0.01, 0.05, 0x4a483e);
          dash.position.set(x + range(rng, -0.1, 0.1), 0.005, 0);
          g.add(dash);
        }
      }
      break;
    }
    case 'RAIL': {
      for (const z of [-0.28, 0.28]) {
        const rail = box(LANE_W, 0.06, 0.05, 0x55524c);
        rail.position.set(0, 0.05, z);
        g.add(rail);
      }
      for (let x = -6; x <= 6; x += 0.7) {
        const tie = box(0.16, 0.04, 0.8, 0x2b241d);
        tie.position.set(x + range(rng, -0.05, 0.05), 0.01, 0);
        g.add(tie);
      }
      // signal box at the edge — blinks during telegraph
      const sig = box(0.12, 0.12, 0.12, 0x330000, 0x000000);
      sig.material = new THREE.MeshLambertMaterial({ color: 0x330000, emissive: 0x000000 });
      sig.position.set(-4.4, 1.2, 0);
      const sigPole = box(0.05, 1.2, 0.05, 0x23262b);
      sigPole.position.set(-4.4, 0.6, 0);
      g.add(sig, sigPole);
      lane.signal = sig;
      break;
    }
    case 'MIRE': {
      // knee-deep fog plane
      const fogPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(LANE_W, 1.0),
        new THREE.MeshBasicMaterial({ color: 0x3d4148, transparent: true, opacity: 0.4, depthWrite: false })
      );
      fogPlane.rotation.x = -Math.PI / 2;
      fogPlane.position.y = 0.22;
      g.add(fogPlane);
      if (rng() > 0.5) g.add(makeFence(rng, pick(rng, [-5.5, 5.5])));
      break;
    }
    case 'GRATE': {
      // rim rails at lane edges
      for (const z of [-0.49, 0.49]) {
        const rim = box(LANE_W, 0.08, 0.06, 0x33363b);
        rim.position.set(0, 0.02, z);
        g.add(rim);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Lane manager — ring of lanes keyed to player row, deterministic per seed.
// ---------------------------------------------------------------------------
export class LaneManager {
  lanes = new Map<number, Lane>();
  maxRow = -1;
  minRow = 0;
  private laneRng: Rng;
  readonly scene: THREE.Scene;
  /** Called when the lethal train enters/leaves its run in a row. */
  onTrainHum: (on: boolean) => void = () => {};
  onTrainPass: () => void = () => {};
  sanity = 100;
  depthOf = (row: number) => row;

  constructor(scene: THREE.Scene, seed: number) {
    this.scene = scene;
    this.laneRng = mulberry32(seed);
  }

  typeFor(row: number): LaneType | undefined { return this.lanes.get(row)?.type; }
  lane(row: number): Lane | undefined { return this.lanes.get(row); }

  ensure(playerRow: number) {
    while (this.maxRow < playerRow + LANES_AHEAD) this.spawnLane(this.maxRow + 1);
    // backfill behind the start so the camera never sees raw void
    while (this.minRow > playerRow - LANES_BEHIND) this.spawnLane(this.minRow - 1, true);
    while (this.minRow < playerRow - LANES_BEHIND) this.despawnLane(this.minRow);
  }

  private lastTypes: LaneType[] = [];
  private sinceRest = 0;

  private pickType(row: number): LaneType {
    if (row < 3) return 'ASH';
    const rng = this.laneRng;
    const depth = Math.min(1, row / 120);
    const fear = (100 - this.sanity) / 100;
    const restEvery = Math.round(lerp(5, 8, fear));
    if (this.sinceRest >= restEvery) return 'ASH';

    const prev = this.lastTypes[this.lastTypes.length - 1];
    const weights: [LaneType, number][] = [
      ['ROAD', 3 + depth * 2],
      ['ASH', 2.2 - depth * 1.2],
      ['MIRE', 1 + depth * 1.5],
      ['GRATE', row > 8 ? 1.2 + depth * 1.4 : 0],
      ['RAIL', row > 12 && prev !== 'RAIL' ? 0.9 + depth : 0],
    ];
    let total = weights.reduce((s, [, w]) => s + w, 0);
    let r = rng() * total;
    for (const [t, w] of weights) { r -= w; if (r <= 0) return t; }
    return 'ROAD';
  }

  private spawnLane(row: number, behind = false) {
    const type = behind ? 'ASH' : this.pickType(row);
    this.lastTypes.push(type);
    if (this.lastTypes.length > 8) this.lastTypes.shift();
    this.sinceRest = type === 'ASH' ? 0 : this.sinceRest + 1;

    const group = new THREE.Group();
    group.position.z = gridZ(row);
    const lane: Lane = {
      row, type, group, hazards: [],
      trainState: 'idle', trainTimer: range(this.laneRng, 4, 11), trainX: 0,
      trainMesh: null, signal: null,
    };
    const rng = mulberry32((row * 2654435761) ^ 0x9e3779b9);
    buildLaneVisual(lane, rng);
    this.populateHazards(lane, rng);
    this.scene.add(group);
    this.lanes.set(row, lane);
    this.maxRow = Math.max(this.maxRow, row);
    this.minRow = Math.min(this.minRow, row);
  }

  private populateHazards(lane: Lane, rng: Rng) {
    const depth = Math.min(1, lane.row / 120);
    const fear = (100 - this.sanity) / 100;
    const speedMul = lerp(1.0, 1.45, fear) * (1 + depth * 0.8);
    const dir = rng() > 0.5 ? 1 : -1;

    if (lane.type === 'ROAD') {
      const n = 2 + Math.floor(rng() * 2 + depth * 1.5);
      const gap = (WRAP * 2) / n;
      const speed = range(rng, 1.1, 2.0) * speedMul * dir;
      for (let i = 0; i < n; i++) {
        const mesh = makeCar(rng);
        const h: Hazard = {
          kind: 'car', x: -WRAP + i * gap + range(rng, -0.5, 0.5), prevX: 0,
          halfW: 0.95, speed, mesh,
        };
        h.prevX = h.x;
        mesh.rotation.y = speed > 0 ? 0 : Math.PI;
        lane.group.add(mesh);
        lane.hazards.push(h);
      }
    } else if (lane.type === 'GRATE') {
      const n = 3;
      const gap = (WRAP * 2) / n;
      const speed = range(rng, 0.7, 1.3) * (1 + depth * 0.5) * dir;
      for (let i = 0; i < n; i++) {
        const mesh = makeGrate(rng);
        const h: Hazard = {
          kind: 'grate', x: -WRAP + i * gap + range(rng, -0.4, 0.4), prevX: 0,
          halfW: 0.9, speed, mesh,
        };
        h.prevX = h.x;
        lane.group.add(mesh);
        lane.hazards.push(h);
      }
    } else if (lane.type === 'MIRE') {
      const mesh = makePatroller();
      const startCol = Math.floor(range(rng, COL_MIN, COL_MAX + 1));
      const h: Hazard = {
        kind: 'patroller', x: startCol * CELL, prevX: startCol * CELL,
        halfW: 0.42, speed: dir, mesh, stepTimer: 0, walkPhase: 0,
      };
      mesh.position.x = h.x;
      lane.group.add(mesh);
      lane.hazards.push(h);
    }
  }

  private despawnLane(row: number) {
    const lane = this.lanes.get(row);
    if (!lane) { this.minRow = row + 1; return; }
    this.scene.remove(lane.group);
    // shared geometries/materials — dispose only per-lane geometry clones
    lane.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry) o.geometry.dispose();
    });
    this.lanes.delete(row);
    this.minRow = row + 1;
  }

  /** Advance every hazard one sim tick. dt in seconds. */
  tick(dt: number, playerRow: number, playerCol: number) {
    const fear = (100 - this.sanity) / 100;
    for (const lane of this.lanes.values()) {
      for (const h of lane.hazards) {
        h.prevX = h.x;
        if (h.kind === 'patroller') {
          const period = lerp(0.6, 0.32, fear);
          h.stepTimer! += dt;
          if (h.stepTimer! >= period) {
            h.stepTimer = 0;
            let step = h.speed;
            if (lane.row === playerRow) {
              // hunts: re-targets the player's column
              step = Math.sign(playerCol * CELL - h.x) || h.speed;
            }
            let nx = h.x + step * CELL;
            if (nx > COL_MAX * CELL || nx < COL_MIN * CELL) { h.speed = -h.speed; nx = h.x + h.speed * CELL; }
            h.x = nx;
          }
          // walk cycle
          h.walkPhase! += dt * 7;
          const ph = h.walkPhase!;
          const m = h.mesh as THREE.Group;
          m.position.x += (h.x - m.position.x) * Math.min(1, dt * 10);
          const swing = Math.sin(ph) * 0.5;
          (m.getObjectByName('legL') as THREE.Mesh).rotation.x = swing;
          (m.getObjectByName('legR') as THREE.Mesh).rotation.x = -swing;
          (m.getObjectByName('armL') as THREE.Mesh).rotation.x = -swing * 0.7;
          (m.getObjectByName('armR') as THREE.Mesh).rotation.x = swing * 0.7;
          (m.getObjectByName('head') as THREE.Mesh).rotation.y = Math.sin(ph * 0.3) * 0.6;
        } else {
          h.x += h.speed * dt;
          if (h.x > WRAP) h.x -= WRAP * 2;
          if (h.x < -WRAP) h.x += WRAP * 2;
          h.mesh.position.x = h.x;
        }
      }

      if (lane.type === 'RAIL') this.tickRail(lane, dt, playerRow);
    }
  }

  private tickRail(lane: Lane, dt: number, playerRow: number) {
    const near = Math.abs(lane.row - playerRow) <= LANES_AHEAD;
    if (!near) return;
    lane.trainTimer -= dt;
    switch (lane.trainState) {
      case 'idle':
        if (lane.trainTimer <= 0) {
          lane.trainState = 'telegraph';
          lane.trainTimer = 1.8;
          if (Math.abs(lane.row - playerRow) <= 8) this.onTrainHum(true);
        }
        break;
      case 'telegraph': {
        // blinking blood signal
        if (lane.signal) {
          const on = Math.sin(performance.now() * 0.02) > 0;
          (lane.signal.material as THREE.MeshLambertMaterial).emissive.setHex(on ? 0xaa1500 : 0x000000);
        }
        if (lane.trainTimer <= 0) {
          lane.trainState = 'run';
          lane.trainTimer = 2.2;
          lane.trainX = -22;
          if (!lane.trainMesh) {
            lane.trainMesh = makeTrain();
            lane.group.add(lane.trainMesh);
          }
          lane.trainMesh.visible = true;
          this.onTrainHum(false);
          if (Math.abs(lane.row - playerRow) <= 8) this.onTrainPass();
        }
        break;
      }
      case 'run':
        lane.trainX += 24 * dt;
        lane.trainMesh!.position.x = lane.trainX;
        if (lane.signal) (lane.signal.material as THREE.MeshLambertMaterial).emissive.setHex(0xaa1500);
        if (lane.trainX > 30) {
          lane.trainState = 'cooldown';
          lane.trainTimer = range(this.laneRng, 6, 14);
          lane.trainMesh!.visible = false;
          if (lane.signal) (lane.signal.material as THREE.MeshLambertMaterial).emissive.setHex(0x000000);
        }
        break;
      case 'cooldown':
        if (lane.trainTimer <= 0) { lane.trainState = 'idle'; lane.trainTimer = range(this.laneRng, 3, 8); }
        break;
    }
  }

  /** True if the train currently covers world x in this row. */
  trainCovers(row: number, x: number): boolean {
    const lane = this.lanes.get(row);
    if (!lane || lane.type !== 'RAIL' || lane.trainState !== 'run') return false;
    return x > lane.trainX - 1.5 && x < lane.trainX + 14.5;
  }

  railTelegraphing(row: number): boolean {
    const lane = this.lanes.get(row);
    return !!lane && lane.type === 'RAIL' && lane.trainState === 'telegraph';
  }

  /** Swept 1D overlap test — hazards can never tunnel through a cell. */
  lethalAt(row: number, x: number, halfPlayer = 0.34): Hazard | null {
    const lane = this.lanes.get(row);
    if (!lane) return null;
    for (const h of lane.hazards) {
      if (h.kind === 'grate') continue;
      const lo = Math.min(h.prevX, h.x) - h.halfW - halfPlayer;
      const hi = Math.max(h.prevX, h.x) + h.halfW + halfPlayer;
      if (x > lo && x < hi) return h;
    }
    return null;
  }

  /** Grate under x in a GRATE lane, or null (null == falling). */
  grateUnder(row: number, x: number): Hazard | null {
    const lane = this.lanes.get(row);
    if (!lane || lane.type !== 'GRATE') return null;
    for (const h of lane.hazards) {
      if (h.kind === 'grate' && Math.abs(x - h.x) < h.halfW + 0.15) return h;
    }
    return null;
  }

  reset() {
    for (const row of [...this.lanes.keys()]) this.despawnLane(row);
    this.lanes.clear();
    this.maxRow = -1; this.minRow = 0;
    this.lastTypes = []; this.sinceRest = 0;
    this.laneRng = mulberry32((Math.random() * 2 ** 31) | 0);
  }
}
