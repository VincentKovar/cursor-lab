// The grid is the truth; 3D is a projection. This is the ONLY place the
// conversion lives.
export const CELL = 1.0;
export const COLS = 7;               // columns: -3 .. +3
export const COL_MIN = -3;
export const COL_MAX = 3;
export const LANES_AHEAD = 13;       // rows generated past the player
export const LANES_BEHIND = 5;       // rows kept behind before recycling

export const SIM_HZ = 60;
export const SIM_DT = 1000 / SIM_HZ; // ms
export const HOP_TICKS = 7;          // ~117ms hop
export const HOP_TICKS_MIRE = 10;    // wading is slow

export const gridX = (col: number) => col * CELL;
export const gridZ = (row: number) => -row * CELL;
export const worldToCol = (x: number) => Math.round(x / CELL);
