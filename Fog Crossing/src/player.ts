import * as THREE from 'three';
import { CELL, COL_MIN, COL_MAX, HOP_TICKS, HOP_TICKS_MIRE, gridX, gridZ, worldToCol } from './grid';
import type { Intent } from './input';
import type { LaneManager, Hazard } from './world';

export type DeathCause = 'HAZARD' | 'TRAIN' | 'FALL' | 'STATIC' | 'DRAGGED';

interface Hop {
  fromX: number; fromZ: number;
  toCol: number; toRow: number;
  tick: number; total: number;
}

export class Player {
  col = 0;
  row = 0;
  x = 0;                        // authoritative world x (float only while riding)
  hop: Hop | null = null;
  riding: Hazard | null = null;
  rideOffset = 0;
  buffered: Intent | null = null;
  alive = true;
  maxRow = 0;

  readonly rig: THREE.Group;    // player + flashlight parent
  private body: THREE.Group;

  onHop: () => void = () => {};
  onBump: () => void = () => {};
  onDeath: (cause: DeathCause) => void = () => {};
  onError: (kind: 'bump' | 'retreat' | 'nearmiss') => void = () => {};
  onCleanHop: () => void = () => {};

  constructor(scene: THREE.Scene) {
    this.rig = new THREE.Group();
    this.body = this.makeBody();
    this.rig.add(this.body);
    scene.add(this.rig);
    this.syncRender(0);
  }

  private makeBody(): THREE.Group {
    // small hooded wanderer — silhouette-first design
    const g = new THREE.Group();
    const coat = new THREE.Mesh(
      new THREE.ConeGeometry(0.24, 0.62, 6),
      new THREE.MeshLambertMaterial({ color: 0x4a4238 })
    );
    coat.position.y = 0.31;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0x57503f })
    );
    head.position.y = 0.68;
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.1, 0.08),
      new THREE.MeshLambertMaterial({ color: 0x6b5c33, emissive: 0x453208 })
    );
    lamp.position.set(0.16, 0.42, -0.12);
    g.add(coat, head, lamp);
    return g;
  }

  intent(i: Intent, world: LaneManager): void {
    if (!this.alive) return;
    if (this.hop) { this.buffered = i; return; } // depth-1 buffer
    this.execute(i, world);
  }

  private execute(i: Intent, world: LaneManager) {
    let dc = 0, dr = 0;
    if (i === 'ADVANCE') dr = 1;
    else if (i === 'RETREAT') dr = -1;
    else if (i === 'STRAFE_L') dc = -1;
    else dc = 1;

    const fromCol = this.riding ? worldToCol(this.x) : this.col;
    const toCol = Math.max(COL_MIN, Math.min(COL_MAX, fromCol + dc));
    if (dc !== 0 && fromCol + dc !== toCol) {
      // walked into the edge of the world
      this.onError('bump'); this.onBump();
      return;
    }
    const toRow = Math.max(0, this.row + dr);
    if (dr < 0 && toRow === this.row) { this.onError('bump'); this.onBump(); return; }
    if (dr < 0) this.onError('retreat');

    const fromX = this.riding ? this.x : gridX(this.col);
    const isMire = world.typeFor(this.row) === 'MIRE' || world.typeFor(toRow) === 'MIRE';
    // collision identity switches to destination NOW — the tween is cosmetic
    this.col = toCol;
    this.row = toRow;
    this.riding = null;
    this.x = gridX(toCol);
    this.hop = {
      fromX, fromZ: gridZ(toRow - dr),
      toCol, toRow,
      tick: 0, total: isMire ? HOP_TICKS_MIRE : HOP_TICKS,
    };
    this.maxRow = Math.max(this.maxRow, this.row);
    this.onHop();
    if (dr > 0) this.onCleanHop();
  }

  /** One fixed sim tick. Returns death cause or null. */
  tick(world: LaneManager, staticRow: number): DeathCause | null {
    if (!this.alive) return null;

    // hop progression
    if (this.hop) {
      this.hop.tick++;
      if (this.hop.tick >= this.hop.total) {
        this.hop = null;
        // landing on a grate lane: latch to carrier or fall
        if (world.typeFor(this.row) === 'GRATE') {
          const carrier = world.grateUnder(this.row, gridX(this.col));
          if (!carrier) return this.kill('FALL');
          this.riding = carrier;
          this.rideOffset = gridX(this.col) - carrier.x;
        }
        if (this.buffered) {
          const b = this.buffered; this.buffered = null;
          this.execute(b, world);
        }
      }
    }

    // riding: follow carrier, re-quantize col each tick (no float drift)
    if (this.riding && !this.hop) {
      this.x = this.riding.x + this.rideOffset;
      this.col = worldToCol(this.x);
      if (this.x < (COL_MIN - 0.6) * CELL || this.x > (COL_MAX + 0.6) * CELL) {
        return this.kill('DRAGGED');
      }
    } else if (!this.hop) {
      this.x = gridX(this.col);
    }

    // I3 — swept lethal overlap in the player's row (destination-cell identity)
    const hit = world.lethalAt(this.row, this.x);
    if (hit) return this.kill('HAZARD');
    if (world.trainCovers(this.row, this.x)) return this.kill('TRAIN');

    // grate lane with no carrier and no hop in flight = standing on the void
    if (!this.hop && !this.riding && world.typeFor(this.row) === 'GRATE') {
      const carrier = world.grateUnder(this.row, this.x);
      if (!carrier) return this.kill('FALL');
      this.riding = carrier;
      this.rideOffset = this.x - carrier.x;
    }

    // The Static consumed you
    if (this.row < staticRow) return this.kill('STATIC');

    // near-miss detection (adjacent row cells) for sanity system
    for (const r of [this.row]) {
      const near = world.lethalAt(r, this.x, 1.1);
      const direct = world.lethalAt(r, this.x, 0.34);
      if (near && !direct && Math.random() < 0.08) this.onError('nearmiss');
    }
    return null;
  }

  private kill(cause: DeathCause): DeathCause {
    this.alive = false;
    this.onDeath(cause);
    return cause;
  }

  /** Interpolated render sync. alpha ∈ [0,1] between sim ticks. */
  syncRender(alpha: number) {
    let px: number, pz: number, py = 0, squash = 1;
    if (this.hop) {
      const t = Math.min(1, (this.hop.tick + alpha) / this.hop.total);
      const e = t * t * (3 - 2 * t); // smoothstep
      px = this.hop.fromX + (gridX(this.hop.toCol) - this.hop.fromX) * e;
      pz = this.hop.fromZ + (gridZ(this.hop.toRow) - this.hop.fromZ) * e;
      py = Math.sin(Math.PI * t) * 0.32;
      squash = 1 + Math.sin(Math.PI * t) * 0.18;
    } else {
      px = this.x;
      pz = gridZ(this.row);
      const bob = Math.sin(performance.now() * 0.0022) * 0.012;
      py = bob;
    }
    this.rig.position.set(px, py, pz);
    this.body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
  }

  reset() {
    this.col = 0; this.row = 0; this.x = 0;
    this.hop = null; this.riding = null; this.buffered = null;
    this.alive = true; this.maxRow = 0;
    this.rig.visible = true;
    this.syncRender(0);
  }
}
