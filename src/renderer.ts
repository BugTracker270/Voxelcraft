import * as THREE from 'three';
import { BLOCKS, CHUNK, HEIGHT, World, chunkKey, hash, type Vec3 } from './world';
import { EYE_HEIGHT, Player } from './player';
import type { Hit } from './gameplay';
const FACES = [
  { n: [1, 0, 0], shade: 0.82, v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], shade: 0.72, v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], shade: 1, v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], shade: 0.55, v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], shade: 0.88, v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], shade: 0.76, v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] }
];
function atlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = 176; canvas.height = 16;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas textures are not supported by this browser.');
  const colors = ['#80ad4b', '#926346', '#926346', '#8c939a', '#e2cf91', '#987049', '#4d8648', '#ba725c', '#5d9ba8', '#414753', '#c49b65'];
  for (let tile = 0; tile < 11; tile++) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let color = colors[tile];
    let noise = (hash(x + tile * 19, y, 42) - 0.5) * 0.22;
    if (tile === 1 && y < 3 + Math.floor(hash(x, 0, 9) * 3)) color = colors[0];
    if (tile === 5 && x % 4 === 0) noise -= 0.15;
    if (tile === 7 && (y % 5 === 0 || (x + (Math.floor(y / 5) % 2) * 4) % 8 === 0)) color = '#d0b6a0';
    if (tile === 10 && Math.floor(Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5))) % 3 === 0) noise -= 0.2;
    const c = new THREE.Color(color); c.offsetHSL(0, 0, noise);
    ctx.fillStyle = `#${c.getHexString()}`; ctx.fillRect(tile * 16 + x, y, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false;
  return texture;
}
function tileFor(id: number, face: number): number {
  if (id === 1) return face === 2 ? 0 : face === 3 ? 2 : 1;
  if (id === 5 && (face === 2 || face === 3)) return 10;
  return id;
}
interface Particle { p: Vec3; v: Vec3; life: number }
export class GameRenderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(74, 1, 0.05, 260);
  readonly meshes = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>>();
  readonly texture = atlas();
  readonly material = new THREE.MeshLambertMaterial({ map: this.texture, vertexColors: true });
  readonly ambient = new THREE.HemisphereLight('#cce9ff', '#6a6747', 2);
  readonly sunlight = new THREE.DirectionalLight('#fff0d1', 2);
  readonly sky = new THREE.Color();
  readonly selection: THREE.LineSegments;
  readonly sun: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  readonly clouds: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
  readonly debris: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
  readonly particles: Particle[] = [];
  readonly dummy = new THREE.Object3D();
  private lastTrim = '';
  radius = 3;
  constructor(readonly canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping; this.gl.toneMappingExposure = 1.15;
    this.camera.rotation.order = 'YXZ';
    this.scene.background = this.sky;
    this.scene.fog = new THREE.Fog('#9cc9df', 20, 60);
    this.scene.add(this.ambient, this.sunlight);
    const box = new THREE.BoxGeometry(1.006, 1.006, 1.006);
    const edgeGeometry = new THREE.EdgesGeometry(box); box.dispose();
    this.selection = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: '#fff3cd', transparent: true, opacity: 0.9 }));
    this.selection.visible = false; this.scene.add(this.selection);
    this.sun = new THREE.Mesh(new THREE.BoxGeometry(9, 9, 1), new THREE.MeshBasicMaterial({ color: '#fff1ba', fog: false }));
    this.scene.add(this.sun);
    this.clouds = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.8 }), 25);
    for (let i = 0; i < 25; i++) {
      this.dummy.position.set((i % 5 - 2) * 36, 62 + hash(i, 1, 33) * 10, (Math.floor(i / 5) - 2) * 36);
      this.dummy.scale.set(12 + hash(i, 2, 8) * 14, 1.8, 5 + hash(i, 3, 8) * 8);
      this.dummy.rotation.set(0, 0, 0); this.dummy.updateMatrix(); this.clouds.setMatrixAt(i, this.dummy.matrix);
    }
    this.clouds.instanceMatrix.needsUpdate = true; this.scene.add(this.clouds);
    this.debris = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), new THREE.MeshLambertMaterial(), 48);
    this.debris.count = 0; this.debris.frustumCulled = false; this.scene.add(this.debris);
    this.resize();
  }
  resize(): void {
    this.gl.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
  }
  reset(): void {
    for (const mesh of this.meshes.values()) { this.scene.remove(mesh); mesh.geometry.dispose(); }
    this.meshes.clear(); this.particles.length = 0; this.debris.count = 0; this.lastTrim = '';
  }
  private build(world: World, cx: number, cz: number): void {
    const key = chunkKey(cx, cz), data = world.chunk(cx, cz);
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = [];
    for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const id = data[(y * CHUNK + z) * CHUNK + x];
      if (!id) continue;
      for (let f = 0; f < FACES.length; f++) {
        const face = FACES[f], [nx, ny, nz] = face.n;
        if (world.get(cx * CHUNK + x + nx, y + ny, cz * CHUNK + z + nz)) continue;
        const base = positions.length / 3, tile = tileFor(id, f);
        const variation = 0.94 + hash(cx * CHUNK + x, cz * CHUNK + z + y, 73) * 0.06;
        for (let v = 0; v < 4; v++) {
          const corner = face.v[v]; positions.push(x + corner[0], y + corner[1], z + corner[2]);
          normals.push(nx, ny, nz);
          const u = v === 1 || v === 2 ? 15.9 : 0.1, tv = v >= 2 ? 0.994 : 0.006;
          uvs.push((tile * 16 + u) / 176, tv);
          const shade = face.shade * variation; colors.push(shade, shade, shade);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices); geometry.computeBoundingSphere();
    const old = this.meshes.get(key);
    if (old) { this.scene.remove(old); old.geometry.dispose(); }
    const mesh = new THREE.Mesh(geometry, this.material); mesh.position.set(cx * CHUNK, 0, cz * CHUNK);
    this.scene.add(mesh); this.meshes.set(key, mesh); world.dirty.delete(key);
  }
  stream(world: World, position: Vec3): void {
    const cx = Math.floor(position.x / CHUNK), cz = Math.floor(position.z / CHUNK);
    const center = `${cx},${cz},${this.radius}`;
    if (center !== this.lastTrim) {
      for (const [key, mesh] of this.meshes) {
        const [x, z] = key.split(',').map(Number);
        if (Math.abs(x - cx) > this.radius || Math.abs(z - cz) > this.radius) {
          this.scene.remove(mesh); mesh.geometry.dispose(); this.meshes.delete(key);
        }
      }
      world.trim(cx, cz, this.radius + 2); this.lastTrim = center;
    }
    const queue: { x: number; z: number; priority: number }[] = [];
    for (let z = cz - this.radius; z <= cz + this.radius; z++) for (let x = cx - this.radius; x <= cx + this.radius; x++) {
      const key = chunkKey(x, z);
      if (!this.meshes.has(key) || world.dirty.has(key)) queue.push({ x, z, priority: (world.dirty.has(key) ? -1000 : 0) + (x - cx) ** 2 + (z - cz) ** 2 });
    }
    queue.sort((a, b) => a.priority - b.priority);
    const start = performance.now();
    for (let i = 0; i < Math.min(queue.length, 2); i++) {
      this.build(world, queue[i].x, queue[i].z);
      if (performance.now() - start > 6) break;
    }
    const fog = this.scene.fog as THREE.Fog;
    fog.near = (this.radius - 1) * CHUNK * 0.65; fog.far = this.radius * CHUNK - 2;
  }
  burst(position: Vec3, id: number): void {
    this.particles.length = 0;
    this.debris.material.color.set(BLOCKS[id].color);
    for (let i = 0; i < 20; i++) this.particles.push({ p: { x: position.x + 0.5, y: position.y + 0.5, z: position.z + 0.5 }, v: { x: (Math.random() - 0.5) * 4, y: Math.random() * 4, z: (Math.random() - 0.5) * 4 }, life: 0.6 + Math.random() * 0.3 });
  }
  render(player: Player, hit: Hit | null, time: number, dt: number): void {
    this.camera.position.set(player.position.x, player.position.y + EYE_HEIGHT, player.position.z);
    this.camera.rotation.set(player.pitch, player.yaw, 0);
    const angle = time / 1200 * Math.PI * 2;
    const daylight = THREE.MathUtils.smoothstep(Math.sin(angle), -0.2, 0.45);
    this.sky.set('#14223d').lerp(new THREE.Color('#a7d3e6'), daylight);
    (this.scene.fog as THREE.Fog).color.copy(this.sky);
    this.ambient.intensity = 0.65 + daylight * 1.35;
    this.sunlight.intensity = 0.15 + daylight * 1.8;
    this.sunlight.position.set(Math.cos(angle) * 80, Math.sin(angle) * 100, 35);
    this.sun.position.copy(this.camera.position).add(new THREE.Vector3(Math.cos(angle) * 110, Math.sin(angle) * 110, -50));
    this.sun.lookAt(this.camera.position); this.sun.visible = Math.sin(angle) > -0.15;
    this.clouds.position.set(Math.floor(player.position.x / 36) * 36 + (time % 36), 0, Math.floor(player.position.z / 36) * 36);
    this.selection.visible = hit !== null;
    if (hit) this.selection.position.set(hit.block.x + 0.5, hit.block.y + 0.5, hit.block.z + 0.5);
    let count = 0;
    for (const particle of this.particles) {
      particle.life -= dt; if (particle.life <= 0) continue;
      particle.v.y -= dt * 10;
      particle.p.x += particle.v.x * dt; particle.p.y += particle.v.y * dt; particle.p.z += particle.v.z * dt;
      this.dummy.position.set(particle.p.x, particle.p.y, particle.p.z);
      this.dummy.scale.setScalar(Math.min(1, particle.life * 4)); this.dummy.rotation.set(particle.life, particle.life * 2, 0);
      this.dummy.updateMatrix(); this.debris.setMatrixAt(count++, this.dummy.matrix);
    }
    this.debris.count = count; this.debris.instanceMatrix.needsUpdate = true;
    this.gl.render(this.scene, this.camera);
  }
  dispose(): void {
    this.reset(); this.material.dispose(); this.texture.dispose();
    this.selection.geometry.dispose(); (this.selection.material as THREE.Material).dispose();
    this.sun.geometry.dispose(); this.sun.material.dispose();
    this.clouds.geometry.dispose(); this.clouds.material.dispose();
    this.debris.geometry.dispose(); this.debris.material.dispose(); this.gl.dispose();
  }
}
