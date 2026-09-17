export const CHUNK = 16;
export const HEIGHT = 64;
export const LIMIT = 2048;
export const BLOCKS = [
  { name: 'Air', color: '#ffffff' },
  { name: 'Grass', color: '#80ad4b' },
  { name: 'Earth', color: '#926346' },
  { name: 'Stone', color: '#8c939a' },
  { name: 'Sand', color: '#e2cf91' },
  { name: 'Timber', color: '#987049' },
  { name: 'Leaves', color: '#4d8648' },
  { name: 'Brick', color: '#ba725c' },
  { name: 'Cobalt', color: '#5d9ba8' },
  { name: 'Bedrock', color: '#414753' }
] as const;
export interface Vec3 { x: number; y: number; z: number }
export type Edit = [number, number, number, number];
export function hash(x: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function seedNumber(text: string): number {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
function noise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), u = smooth(x - ix), v = smooth(z - iz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
export const chunkKey = (x: number, z: number) => `${x},${z}`;
const index = (x: number, y: number, z: number) => (y * CHUNK + z) * CHUNK + x;
export class World {
  readonly chunks = new Map<string, Uint8Array>();
  readonly edits = new Map<string, Edit>();
  readonly dirty = new Set<string>();
  readonly seed: number;
  constructor(readonly seedText: string) { this.seed = seedNumber(seedText); }
  surface(x: number, z: number): number {
    return Math.floor(15 + noise(x / 90, z / 90, this.seed) * 21 + noise(x / 24, z / 24, this.seed + 1) * 8 + noise(x / 9, z / 9, this.seed + 2) * 3);
  }
  chunk(cx: number, cz: number): Uint8Array {
    const key = chunkKey(cx, cz);
    const cached = this.chunks.get(key);
    if (cached) return cached;
    const data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    const put = (x: number, y: number, z: number, id: number, onlyAir = false) => {
      const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
      if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 1 || y >= HEIGHT) return;
      const i = index(lx, y, lz);
      if (!onlyAir || data[i] === 0) data[i] = id;
    };
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const wx = cx * CHUNK + x, wz = cz * CHUNK + z, h = this.surface(wx, wz);
      for (let y = 0; y <= h; y++) {
        data[index(x, y, z)] = y === 0 ? 9 : y === h ? (h < 24 ? 4 : 1) : y > h - 4 ? 2 : 3;
      }
    }
    // Examine neighboring tree cells too, so canopies cross chunk borders deterministically.
    for (let tz = Math.floor((cz * CHUNK - 3) / 8); tz <= Math.floor((cz * CHUNK + CHUNK + 3) / 8); tz++) {
      for (let tx = Math.floor((cx * CHUNK - 3) / 8); tx <= Math.floor((cx * CHUNK + CHUNK + 3) / 8); tx++) {
        if (hash(tx, tz, this.seed + 7) < 0.46) continue;
        const x = tx * 8 + 2 + Math.floor(hash(tx, tz, this.seed + 8) * 4);
        const z = tz * 8 + 2 + Math.floor(hash(tx, tz, this.seed + 9) * 4);
        const h = this.surface(x, z);
        if (h < 24 || h > 43) continue;
        const top = h + 5;
        for (let y = top - 2; y <= top + 1; y++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
          if (Math.abs(dx) + Math.abs(dz) + Math.max(0, y - top) > 3) continue;
          put(x + dx, y, z + dz, 6, true);
        }
        for (let y = h + 1; y <= top; y++) put(x, y, z, 5);
      }
    }
    for (const [x, y, z, id] of this.edits.values()) {
      if (Math.floor(x / CHUNK) === cx && Math.floor(z / CHUNK) === cz) put(x, y, z, id);
    }
    this.chunks.set(key, data);
    return data;
  }
  get(x: number, y: number, z: number): number {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0 || Math.abs(x) >= LIMIT || Math.abs(z) >= LIMIT) return 9;
    if (y >= HEIGHT) return 0;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    return this.chunk(cx, cz)[index(x - cx * CHUNK, y, z - cz * CHUNK)];
  }
  set(x: number, y: number, z: number, id: number): boolean {
    if (![x, y, z, id].every(Number.isInteger) || y < 1 || y >= HEIGHT || Math.abs(x) >= LIMIT || Math.abs(z) >= LIMIT || id < 0 || id > 8) return false;
    if (this.get(x, y, z) === id) return false;
    const key = `${x},${y},${z}`;
    if (!this.edits.has(key) && this.edits.size >= 50000) return false;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    this.chunk(cx, cz)[index(x - cx * CHUNK, y, z - cz * CHUNK)] = id;
    this.edits.set(key, [x, y, z, id]);
    this.dirty.add(chunkKey(cx, cz));
    if (x % CHUNK === 0) this.dirty.add(chunkKey(cx - 1, cz));
    if ((x + 1) % CHUNK === 0) this.dirty.add(chunkKey(cx + 1, cz));
    if (z % CHUNK === 0) this.dirty.add(chunkKey(cx, cz - 1));
    if ((z + 1) % CHUNK === 0) this.dirty.add(chunkKey(cx, cz + 1));
    return true;
  }
  spawn(): Vec3 {
    for (let x = 0; x < 48; x++) {
      const y = this.surface(x, 0) + 1;
      if (!this.get(x, y, 0) && !this.get(x, y + 1, 0)) return { x: x + 0.5, y: y + 0.02, z: 0.5 };
    }
    return { x: 0.5, y: 52, z: 0.5 };
  }
  trim(cx: number, cz: number, radius: number): void {
    for (const key of this.chunks.keys()) {
      const [x, z] = key.split(',').map(Number);
      if (Math.abs(x - cx) > radius || Math.abs(z - cz) > radius) this.chunks.delete(key);
    }
  }
}
