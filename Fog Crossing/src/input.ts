// Pointer-events input router. Predictive swipe: intent fires the moment
// travel crosses the threshold — no waiting for pointerup.
export type Intent = 'ADVANCE' | 'STRAFE_L' | 'STRAFE_R' | 'RETREAT';

const SWIPE_PX = 24;
const TAP_MS = 250;
const TAP_PX = 12;
const PEER_MS = 350;

export class InputRouter {
  onIntent: (i: Intent) => void = () => {};
  onPeer: (active: boolean) => void = () => {};
  onAnyPress: () => void = () => {};
  enabled = false;

  private sx = 0; private sy = 0; private st = 0;
  private down = false; private consumed = false;
  private peering = false;
  private peerTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const wasEnabled = this.enabled;   // the gesture that starts a run must not also move
      this.onAnyPress();
      if (!wasEnabled || !this.enabled) return;
      this.down = true; this.consumed = false;
      this.sx = e.clientX; this.sy = e.clientY; this.st = performance.now();
      this.peerTimer = setTimeout(() => {
        if (this.down && !this.consumed) { this.peering = true; this.onPeer(true); }
      }, PEER_MS);
    });

    el.addEventListener('pointermove', (e) => {
      if (!this.down || this.consumed || !this.enabled) return;
      const dx = e.clientX - this.sx, dy = e.clientY - this.sy;
      const d = Math.hypot(dx, dy);
      if (d >= SWIPE_PX) {
        this.consumed = true;
        this.clearPeer();
        if (Math.abs(dx) > Math.abs(dy)) this.onIntent(dx < 0 ? 'STRAFE_L' : 'STRAFE_R');
        else this.onIntent(dy > 0 ? 'RETREAT' : 'ADVANCE');
      }
    });

    const up = (e: PointerEvent) => {
      if (!this.down) return;
      this.down = false;
      const wasPeering = this.peering;
      this.clearPeer();
      if (!this.enabled || this.consumed || wasPeering) return;
      const dt = performance.now() - this.st;
      const d = Math.hypot(e.clientX - this.sx, e.clientY - this.sy);
      if (dt < TAP_MS && d < TAP_PX) this.onIntent('ADVANCE');
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);

    // Desktop testing convenience.
    window.addEventListener('keydown', (e) => {
      this.onAnyPress();
      if (!this.enabled) return;
      const map: Record<string, Intent> = {
        ArrowUp: 'ADVANCE', KeyW: 'ADVANCE', Space: 'ADVANCE',
        ArrowLeft: 'STRAFE_L', KeyA: 'STRAFE_L',
        ArrowRight: 'STRAFE_R', KeyD: 'STRAFE_R',
        ArrowDown: 'RETREAT', KeyS: 'RETREAT',
      };
      const i = map[e.code];
      if (i) { e.preventDefault(); this.onIntent(i); }
    });

    document.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  }

  private clearPeer() {
    if (this.peerTimer) { clearTimeout(this.peerTimer); this.peerTimer = null; }
    if (this.peering) { this.peering = false; this.onPeer(false); }
  }
}
