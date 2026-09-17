import { describe, expect, it } from 'vitest';
import { CHUNK, HEIGHT, LIMIT, World, seedNumber } from '../src/world';
import { decodeSave, validateSave, type SaveData } from '../src/storage';
const valid = (): SaveData => ({ version: 1, seed: 'test', edits: [[1, 50, -1, 7]], player: { x: 0.5, y: 50, z: 0.5 }, yaw: 0, pitch: 0, selected: 0, time: 250 });
describe('deterministic terrain and chunk storage', () => {
  it('generates identical chunks from identical seeds', () => {
    expect(new World('orchard').chunk(-1, 2)).toEqual(new World('orchard').chunk(-1, 2));
  });
  it('uses the seed to change terrain', () => {
    expect(seedNumber('orchard')).not.toBe(seedNumber('desert'));
    expect(new World('orchard').chunk(0, 0)).not.toEqual(new World('desert').chunk(0, 0));
  });
  it('bounds terrain heights and protects world boundaries', () => {
    const w = new World('bounds');
    for (let x = -100; x <= 100; x += 7) { expect(w.surface(x, x)).toBeGreaterThanOrEqual(15); expect(w.surface(x, x)).toBeLessThan(48); }
    expect(w.get(0, -1, 0)).toBe(9); expect(w.get(0, 0, 0)).toBe(9);
    expect(w.get(0, HEIGHT, 0)).toBe(0); expect(w.get(LIMIT, 20, 0)).toBe(9);
    expect(w.set(0, 0, 0, 0)).toBe(false); expect(w.set(LIMIT, 50, 0, 1)).toBe(false);
  });
  it('addresses negative block coordinates correctly', () => {
    const w = new World('negative');
    expect(w.set(-1, 55, -17, 7)).toBe(true);
    expect(w.get(-1, 55, -17)).toBe(7); expect(w.get(-0.5, 55.2, -16.5)).toBe(7);
    expect(w.get(15, 55, 15)).toBe(0);
  });
  it('invalidates both sides of positive and negative chunk seams', () => {
    const w = new World('seams');
    w.set(0, 55, 0, 3); expect(w.dirty.has('-1,0')).toBe(true); expect(w.dirty.has('0,-1')).toBe(true);
    w.dirty.clear(); w.set(-1, 55, -1, 4);
    expect(w.dirty.has('0,-1')).toBe(true); expect(w.dirty.has('-1,0')).toBe(true);
    w.set(CHUNK - 1, 55, 4, 1); expect(w.dirty.has('1,0')).toBe(true);
  });
  it('retains edits, including air, after unloading and regenerating', () => {
    const w = new World('persistence');
    w.set(-2, 3, 0, 0); w.set(-1, 55, 0, 8);
    w.trim(100, 100, 2); expect(w.chunks.size).toBe(0);
    expect(w.get(-2, 3, 0)).toBe(0); expect(w.get(-1, 55, 0)).toBe(8);
    expect(w.edits.size).toBe(2);
  });
  it('does not depend on neighboring chunk generation order', () => {
    const a = new World('forest'), b = new World('forest');
    a.chunk(-1, 0); a.chunk(0, 0); b.chunk(0, 0); b.chunk(-1, 0);
    expect(a.chunk(0, 0)).toEqual(b.chunk(0, 0)); expect(a.chunk(-1, 0)).toEqual(b.chunk(-1, 0));
  });
  it('rejects invalid coordinates and block types without recording edits', () => {
    const w = new World('validation');
    for (const [x, y, z, id] of [[NaN, 2, 0, 1], [0, 1.5, 0, 1], [0, 55, 0, 9], [0, 55, 0, -1], [0, HEIGHT, 0, 1]]) expect(w.set(x, y, z, id)).toBe(false);
    expect(w.edits.size).toBe(0);
  });
  it('finds a spawn with body clearance', () => {
    const w = new World('wildflower'), p = w.spawn();
    expect(w.get(p.x, p.y, p.z)).toBe(0); expect(w.get(p.x, p.y + 1, p.z)).toBe(0);
  });
});
describe('versioned save validation', () => {
  it('round trips a world snapshot', () => { expect(decodeSave(JSON.stringify(valid()))).toEqual(valid()); });
  it('restores a saved edit', () => {
    const save = decodeSave(JSON.stringify(valid())), w = new World(save.seed);
    for (const [x, y, z, id] of save.edits) w.set(x, y, z, id);
    expect(w.get(1, 50, -1)).toBe(7);
  });
  it('rejects malformed, oversized, and unsupported files', () => {
    expect(() => decodeSave('{')).toThrow('valid JSON');
    expect(() => decodeSave(' '.repeat(3000001))).toThrow('too large');
    expect(() => validateSave({ ...valid(), version: 2 })).toThrow('version');
    expect(() => validateSave(null)).toThrow();
  });
  it('rejects invalid block edits and excessive edit counts', () => {
    for (const edit of [[0, 0, 0, 1], [0, 64, 0, 1], [2048, 4, 0, 1], [0, 4, 0, 9], [0.5, 4, 0, 1], [0, 4, 0, NaN]]) expect(() => validateSave({ ...valid(), edits: [edit] })).toThrow();
    expect(() => validateSave({ ...valid(), edits: Array.from({ length: 50001 }, () => [0, 55, 0, 1]) })).toThrow();
  });
  it('rejects invalid player states and seeds', () => {
    for (const patch of [{ seed: '' }, { seed: 'x'.repeat(81) }, { player: { x: Infinity, y: 50, z: 0 } }, { yaw: NaN }, { pitch: 2 }, { selected: 8 }, { time: -1 }, { time: 1200 }]) expect(() => validateSave({ ...valid(), ...patch })).toThrow();
  });
});
