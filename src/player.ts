import { HEIGHT, LIMIT, type Vec3, World } from './world';
export const PLAYER_RADIUS = 0.3;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;
export function overlapsBlock(p: Vec3, x: number, y: number, z: number): boolean {
  return p.x + PLAYER_RADIUS > x && p.x - PLAYER_RADIUS < x + 1 && p.y + PLAYER_HEIGHT > y && p.y < y + 1 && p.z + PLAYER_RADIUS > z && p.z - PLAYER_RADIUS < z + 1;
}
export function collides(world: World, p: Vec3): boolean {
  const e = 0.00001;
  for (let y = Math.floor(p.y + e); y <= Math.floor(p.y + PLAYER_HEIGHT - e); y++) {
    for (let z = Math.floor(p.z - PLAYER_RADIUS + e); z <= Math.floor(p.z + PLAYER_RADIUS - e); z++) {
      for (let x = Math.floor(p.x - PLAYER_RADIUS + e); x <= Math.floor(p.x + PLAYER_RADIUS - e); x++) {
        if (world.get(x, y, z)) return true;
      }
    }
  }
  return false;
}
export interface Movement { forward: number; right: number; jump: boolean; sprint: boolean }
export class Player {
  position: Vec3;
  yaw = 0;
  pitch = 0;
  grounded = false;
  velocityY = 0;
  constructor(readonly world: World) { this.position = world.spawn(); }
  look(dx: number, dy: number, sensitivity: number): void {
    this.yaw = (this.yaw - dx * sensitivity) % (Math.PI * 2);
    this.pitch = Math.max(-1.54, Math.min(1.54, this.pitch - dy * sensitivity));
  }
  direction(): Vec3 {
    return { x: -Math.sin(this.yaw) * Math.cos(this.pitch), y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * Math.cos(this.pitch) };
  }
  eye(): Vec3 { return { ...this.position, y: this.position.y + EYE_HEIGHT }; }
  respawn(): void { this.position = this.world.spawn(); this.velocityY = 0; this.grounded = false; }
  update(dt: number, input: Movement): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.05);
    const length = Math.max(1, Math.hypot(input.forward, input.right));
    const speed = input.sprint ? 7 : 4.5;
    const f = input.forward / length * speed, r = input.right / length * speed;
    const dx = (-Math.sin(this.yaw) * f + Math.cos(this.yaw) * r) * dt;
    const dz = (-Math.cos(this.yaw) * f - Math.sin(this.yaw) * r) * dt;
    if (input.jump && this.grounded) { this.velocityY = 8.5; this.grounded = false; }
    this.velocityY = Math.max(-35, this.velocityY - 25 * dt);
    const dy = this.velocityY * dt;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.15));
    this.grounded = false;
    for (let step = 0; step < steps; step++) {
      for (const [axis, amount] of [['x', dx / steps], ['z', dz / steps], ['y', dy / steps]] as const) {
        if (!amount) continue;
        const start = this.position[axis];
        this.position[axis] = start + amount;
        if (collides(this.world, this.position)) {
          let lo = 0, hi = 1;
          for (let i = 0; i < 12; i++) {
            const mid = (lo + hi) / 2;
            this.position[axis] = start + amount * mid;
            if (collides(this.world, this.position)) hi = mid; else lo = mid;
          }
          this.position[axis] = start + amount * lo;
          if (axis === 'y') { if (amount < 0) this.grounded = true; this.velocityY = 0; }
        }
      }
    }
    if (this.position.y < -10 || this.position.y > HEIGHT + 50 || Math.abs(this.position.x) >= LIMIT || Math.abs(this.position.z) >= LIMIT) this.respawn();
  }
}
