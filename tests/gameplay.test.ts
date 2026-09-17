import { describe, expect, it } from 'vitest';
import { World } from '../src/world';
import { Player, collides, overlapsBlock } from '../src/player';
import { mine, place, raycast, type Hit } from '../src/gameplay';
const idle = { forward: 0, right: 0, jump: false, sprint: false };
function platform(): World {
  const world = new World('physics');
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) world.set(x, 50, z, 3);
  return world;
}
describe('voxel DDA raycasting', () => {
  it('finds the first block and outward placement normal', () => {
    const w = new World('ray'); w.set(0, 55, -3, 7); w.set(0, 55, -4, 3);
    const hit = raycast(w, { x: 0.5, y: 55.5, z: 0.5 }, { x: 0, y: 0, z: -1 });
    expect(hit?.block).toEqual({ x: 0, y: 55, z: -3 }); expect(hit?.normal).toEqual({ x: 0, y: 0, z: 1 });
    expect(hit?.distance).toBeCloseTo(2.5); expect(hit?.id).toBe(7);
  });
  it('respects reach and normalizes non-unit directions', () => {
    const w = new World('reach'); w.set(0, 55, -3, 1);
    expect(raycast(w, { x: 0.5, y: 55.5, z: 0.5 }, { x: 0, y: 0, z: -10 }, 2)).toBeNull();
    expect(raycast(w, { x: 0.5, y: 55.5, z: 0.5 }, { x: 0, y: 0, z: -10 }, 3)?.distance).toBeCloseTo(2.5);
  });
  it('handles zero components and exact negative boundaries', () => {
    const w = new World('boundary'); w.set(-1, 55, 0, 3);
    expect(raycast(w, { x: 0, y: 55.5, z: 0.5 }, { x: -1, y: 0, z: 0 })?.block.x).toBe(-1);
    expect(raycast(w, { x: 0, y: 55, z: 0 }, { x: 0, y: 0, z: 0 })).toBeNull();
    expect(raycast(w, { x: NaN, y: 55, z: 0 }, { x: 1, y: 0, z: 0 })).toBeNull();
  });
});
describe('mining and safe placement', () => {
  it('mines normal blocks but never bedrock', () => {
    const w = new World('mine'); w.set(0, 55, 0, 3);
    const hit: Hit = { block: { x: 0, y: 55, z: 0 }, normal: { x: 0, y: 1, z: 0 }, id: 3, distance: 1 };
    expect(mine(w, hit)).toBe(true); expect(w.get(0, 55, 0)).toBe(0);
    expect(mine(w, { ...hit, block: { x: 0, y: 0, z: 0 }, id: 9 })).toBe(false);
    expect(mine(w, null)).toBe(false);
  });
  it('places adjacent to the face without overwriting occupied cells', () => {
    const w = new World('place'); w.set(0, 55, 0, 3);
    const hit: Hit = { block: { x: 0, y: 55, z: 0 }, normal: { x: 0, y: 1, z: 0 }, id: 3, distance: 2 };
    const player = { x: 3, y: 55, z: 3 };
    expect(place(w, hit, 7, player)).toBe(true); expect(w.get(0, 56, 0)).toBe(7);
    expect(place(w, hit, 8, player)).toBe(false);
  });
  it('rejects placements intersecting the player or outside reach', () => {
    const w = new World('self'); w.set(0, 55, 0, 3);
    const hit: Hit = { block: { x: 0, y: 55, z: 0 }, normal: { x: 0, y: 1, z: 0 }, id: 3, distance: 1 };
    expect(place(w, hit, 7, { x: 0.5, y: 56, z: 0.5 })).toBe(false);
    expect(place(w, { ...hit, distance: 7 }, 7, { x: 3, y: 55, z: 3 })).toBe(false);
    expect(place(w, hit, 9, { x: 3, y: 55, z: 3 })).toBe(false);
    expect(overlapsBlock({ x: 0.5, y: 56, z: 0.5 }, 0, 55, 0)).toBe(false);
  });
});
describe('player physics', () => {
  it('lands on blocks without sinking or clipping', () => {
    const w = platform(), p = new Player(w); p.position = { x: 0.5, y: 54, z: 0.5 };
    for (let i = 0; i < 180; i++) p.update(1 / 60, idle);
    expect(p.position.y).toBeCloseTo(51, 3); expect(p.grounded).toBe(true); expect(collides(w, p.position)).toBe(false);
  });
  it('jumps from the ground and comes back down', () => {
    const w = platform(), p = new Player(w); p.position = { x: 0.5, y: 51, z: 0.5 }; p.update(1 / 60, idle);
    p.update(1 / 60, { ...idle, jump: true }); expect(p.velocityY).toBeGreaterThan(0); expect(p.position.y).toBeGreaterThan(51);
    for (let i = 0; i < 180; i++) p.update(1 / 60, idle);
    expect(p.position.y).toBeCloseTo(51, 3);
  });
  it('cannot tunnel through walls at sprint speed', () => {
    const w = platform();
    for (let z = -4; z <= 4; z++) for (let y = 51; y <= 54; y++) w.set(2, y, z, 3);
    const p = new Player(w); p.position = { x: 0.5, y: 51, z: 0.5 };
    for (let i = 0; i < 120; i++) p.update(1 / 30, { ...idle, right: 1, sprint: true });
    expect(p.position.x).toBeLessThanOrEqual(1.7001); expect(p.position.x).toBeGreaterThan(1.69); expect(collides(w, p.position)).toBe(false);
  });
  it('normalizes diagonal speed and rejects invalid frame time', () => {
    const w = platform(), a = new Player(w), b = new Player(w);
    a.position = { x: 0.5, y: 55, z: 0.5 }; b.position = { ...a.position };
    a.update(0.02, { ...idle, forward: 1 }); b.update(0.02, { ...idle, forward: 1, right: 1 });
    expect(Math.hypot(a.position.x - 0.5, a.position.z - 0.5)).toBeCloseTo(Math.hypot(b.position.x - 0.5, b.position.z - 0.5));
    const before = { ...a.position }; a.update(NaN, idle); expect(a.position).toEqual(before);
  });
  it('clamps pitch and produces a unit look direction', () => {
    const p = new Player(new World('look')); p.look(200, 100000, 0.002);
    expect(p.pitch).toBe(-1.54); const d = p.direction(); expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1);
  });
});
