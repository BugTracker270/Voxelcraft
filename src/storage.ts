import { HEIGHT, LIMIT, type Edit, type Vec3 } from './world';
export const SAVE_KEY = 'voxelcraft.world.v1';
export interface SaveData {
  version: 1;
  seed: string;
  edits: Edit[];
  player: Vec3;
  yaw: number;
  pitch: number;
  selected: number;
  time: number;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function validateSave(value: unknown): SaveData {
  if (!record(value) || value.version !== 1) throw new Error('Unsupported save version.');
  if (typeof value.seed !== 'string' || !value.seed.trim() || value.seed.length > 80) throw new Error('Invalid world seed.');
  if (!Array.isArray(value.edits) || value.edits.length > 50000) throw new Error('Invalid block data or edit limit exceeded.');
  const edits: Edit[] = value.edits.map((e: unknown) => {
    if (!Array.isArray(e) || e.length !== 4 || !e.every(v => finite(v) && Number.isInteger(v))) throw new Error('Invalid block edit.');
    const [x, y, z, id] = e as number[];
    if (Math.abs(x) >= LIMIT || Math.abs(z) >= LIMIT || y < 1 || y >= HEIGHT || id < 0 || id > 8) throw new Error('Block edit outside world bounds.');
    return [x, y, z, id];
  });
  const p = value.player;
  if (!record(p) || !finite(p.x) || !finite(p.y) || !finite(p.z) || Math.abs(p.x) >= LIMIT - 1 || Math.abs(p.z) >= LIMIT - 1 || p.y < 0 || p.y > HEIGHT + 20) throw new Error('Invalid player position.');
  if (!finite(value.yaw) || Math.abs(value.yaw) > Math.PI * 2 || !finite(value.pitch) || Math.abs(value.pitch) > 1.54 || !finite(value.time) || value.time < 0 || value.time >= 1200 || !finite(value.selected) || !Number.isInteger(value.selected) || value.selected < 0 || value.selected > 7) throw new Error('Invalid player state.');
  return { version: 1, seed: value.seed, edits, player: { x: p.x, y: p.y, z: p.z }, yaw: value.yaw, pitch: value.pitch, time: value.time, selected: value.selected };
}
export function decodeSave(text: string): SaveData {
  if (text.length > 3000000) throw new Error('Save is too large (3 MB maximum).');
  try { return validateSave(JSON.parse(text) as unknown); }
  catch (error) { throw new Error(error instanceof SyntaxError ? 'Save file is not valid JSON.' : error instanceof Error ? error.message : 'Cannot read save.'); }
}
export function loadSave(): SaveData | null {
  const raw = localStorage.getItem(SAVE_KEY);
  return raw ? decodeSave(raw) : null;
}
export function persistSave(data: SaveData): void {
  const safe = validateSave(data);
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(safe)); }
  catch { throw new Error('Browser storage is unavailable or full. Export your world to keep a backup.'); }
}
