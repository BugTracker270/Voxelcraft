import { World, type Vec3 } from './world';
import { overlapsBlock } from './player';
export const HOTBAR = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export interface Hit { block: Vec3; normal: Vec3; id: number; distance: number }
export function raycast(world: World, origin: Vec3, direction: Vec3, reach = 6): Hit | null {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (!Number.isFinite(length) || length < 1e-9 || ![origin.x, origin.y, origin.z, reach].every(Number.isFinite) || reach < 0) return null;
  const d = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
  const cell = { x: Math.floor(origin.x), y: Math.floor(origin.y), z: Math.floor(origin.z) };
  const step = { x: Math.sign(d.x), y: Math.sign(d.y), z: Math.sign(d.z) };
  const delta = { x: Math.abs(1 / d.x), y: Math.abs(1 / d.y), z: Math.abs(1 / d.z) };
  const edge = (axis: keyof Vec3) => d[axis] === 0 ? Infinity : ((d[axis] > 0 ? cell[axis] + 1 : cell[axis]) - origin[axis]) / d[axis];
  const next = { x: edge('x'), y: edge('y'), z: edge('z') };
  let distance = 0;
  let normal: Vec3 = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 128 && distance <= reach; i++) {
    const id = world.get(cell.x, cell.y, cell.z);
    if (id) return { block: { ...cell }, normal, id, distance };
    const axis = next.x <= next.y && next.x <= next.z ? 'x' : next.y <= next.z ? 'y' : 'z';
    distance = next[axis]; next[axis] += delta[axis]; cell[axis] += step[axis];
    normal = { x: 0, y: 0, z: 0 }; normal[axis] = -step[axis];
  }
  return null;
}
export function mine(world: World, hit: Hit | null): boolean {
  if (!hit || hit.distance > 6) return false;
  const { x, y, z } = hit.block;
  const id = world.get(x, y, z);
  return id > 0 && id !== 9 && world.set(x, y, z, 0);
}
export function place(world: World, hit: Hit | null, id: number, player: Vec3): boolean {
  if (!hit || hit.distance > 6 || !Number.isInteger(id) || id < 1 || id > 8 || Math.abs(hit.normal.x) + Math.abs(hit.normal.y) + Math.abs(hit.normal.z) !== 1) return false;
  const x = hit.block.x + hit.normal.x, y = hit.block.y + hit.normal.y, z = hit.block.z + hit.normal.z;
  if (world.get(x, y, z) !== 0 || overlapsBlock(player, x, y, z)) return false;
  return world.set(x, y, z, id);
}
