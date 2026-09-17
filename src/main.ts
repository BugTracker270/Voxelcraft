import './style.css';
import { BLOCKS, World } from './world';
import { Player, collides } from './player';
import { HOTBAR, mine, place, raycast, type Hit } from './gameplay';
import { GameRenderer } from './renderer';
import { decodeSave, loadSave, persistSave, type SaveData } from './storage';
function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing interface element: ${id}`);
  return node as T;
}
const canvas = element<HTMLCanvasElement>('game');
const menu = element('menu'), hud = element('hud'), toast = element('toast');
const resumeButton = element<HTMLButtonElement>('resume');
const continueButton = element<HTMLButtonElement>('continue');
const exportButton = element<HTMLButtonElement>('export');
const seedInput = element<HTMLInputElement>('seed');
const soundInput = element<HTMLInputElement>('sound');
const debug = element('debug');
let toastTimer = 0;
function notify(message: string, duration = 4500): void {
  toast.textContent = message; toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { toast.hidden = true; }, duration);
}
function fatal(message: string): void {
  const box = element('fatal'); box.textContent = message; box.hidden = false;
}
function boot(): void {
  if (!canvas.requestPointerLock) throw new Error('This game requires a desktop browser with pointer lock. Try current Chrome, Firefox, Edge, or Safari with a keyboard and mouse.');
  const renderer = new GameRenderer(canvas);
  let world = new World('wildflower');
  let player = new Player(world); player.yaw = -0.65; player.pitch = -0.12;
  let active = false, playing = false, stopped = false;
  let selected = 0, time = 250, hit: Hit | null = null;
  let sensitivity = 0.002, lastAction = 0, actionButton: number | null = null;
  let saved: SaveData | null = null;
  let audio: AudioContext | null = null;
  const keys = new Set<string>();
  try { saved = loadSave(); continueButton.hidden = !saved; }
  catch (error) { notify(`Saved world could not be loaded: ${message(error)} Your existing browser save has not been changed.`, 10000); }
  const hotbar = element('hotbar');
  const slots = HOTBAR.map((id, i) => {
    const button = document.createElement('button'); button.className = 'slot'; button.type = 'button';
    button.title = `${i + 1}: ${BLOCKS[id].name}`; button.setAttribute('aria-label', button.title);
    const number = document.createElement('span'); number.className = 'slot-number'; number.textContent = String(i + 1);
    const icon = document.createElement('span'); icon.className = 'block-icon'; icon.style.setProperty('--block', BLOCKS[id].color); icon.setAttribute('aria-hidden', 'true');
    button.append(number, icon); button.addEventListener('click', () => choose(i)); hotbar.append(button); return button;
  });
  function choose(index: number): void {
    selected = (index + HOTBAR.length) % HOTBAR.length;
    slots.forEach((slot, i) => { slot.classList.toggle('selected', i === selected); slot.setAttribute('aria-pressed', String(i === selected)); });
    element('selected-name').textContent = BLOCKS[HOTBAR[selected]].name;
  }
  choose(0);
  function snapshot(): SaveData {
    return { version: 1, seed: world.seedText, edits: [...world.edits.values()], player: { ...player.position }, yaw: player.yaw, pitch: player.pitch, selected, time };
  }
  function save(announce = false): boolean {
    if (!active) return false;
    try { const data = snapshot(); persistSave(data); saved = data; if (announce) notify('World saved on this device.'); return true; }
    catch (error) { notify(message(error), 8000); return false; }
  }
  function clearInput(): void { keys.clear(); actionButton = null; }
  function pause(): void {
    playing = false; clearInput(); menu.hidden = false; hud.hidden = true; document.body.classList.remove('playing');
    resumeButton.hidden = !active; continueButton.hidden = active || !saved;
    if (active) { element('panel-title').textContent = 'Take a little breather.'; element('menu-description').textContent = 'Your world will be right here.'; save(); resumeButton.focus(); }
  }
  async function lock(): Promise<void> {
    try {
      if (soundInput.checked && !audio) audio = new AudioContext();
      if (audio?.state === 'suspended') void audio.resume().catch(() => undefined);
    } catch { soundInput.checked = false; }
    try { await canvas.requestPointerLock(); }
    catch { notify('Mouse capture was blocked. Click Return to world to try again. Embedded pages may need to open the game in a new tab.'); }
  }
  function start(data: SaveData | null, seed: string): void {
    renderer.reset(); world = new World(data?.seed ?? seed); player = new Player(world);
    if (data) {
      for (const [x, y, z, id] of data.edits) world.set(x, y, z, id);
      world.chunks.clear(); world.dirty.clear();
      player.position = { ...data.player }; player.yaw = data.yaw; player.pitch = data.pitch;
      if (collides(world, player.position)) player.respawn();
    } else { player.yaw = -0.65; player.pitch = -0.12; }
    time = data?.time ?? 250; choose(data?.selected ?? 0); hit = null; clearInput();
    active = true; exportButton.disabled = false; resumeButton.hidden = false; continueButton.hidden = true;
    seedInput.value = world.seedText; save(); void lock();
  }
  function tone(id: number, placing: boolean): void {
    if (!soundInput.checked || !audio || audio.state !== 'running') return;
    const now = audio.currentTime, oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.type = 'triangle'; oscillator.frequency.setValueAtTime((placing ? 180 : 110) + id * 18, now);
    oscillator.frequency.exponentialRampToValueAtTime(45, now + 0.09);
    gain.gain.setValueAtTime(0.055, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(now); oscillator.stop(now + 0.13);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  function act(button: number): void {
    hit = raycast(world, player.eye(), player.direction());
    if (!hit) return;
    if (button === 1) { const index = HOTBAR.findIndex(id => id === hit?.id); if (index >= 0) choose(index); return; }
    const target = hit;
    const changed = button === 0 ? mine(world, target) : button === 2 ? place(world, target, HOTBAR[selected], player.position) : false;
    if (changed) { if (button === 0) renderer.burst(target.block, target.id); tone(button === 0 ? target.id : HOTBAR[selected], button === 2); }
    else if (world.edits.size >= 50000) notify('This world has reached its 50,000 edited-block limit. Export a backup before creating a new world.');
  }
  element('new-world').addEventListener('click', () => {
    const seed = seedInput.value.trim();
    if (!seed) { notify('Give your world a seed first. Any name or number works.'); seedInput.focus(); return; }
    if ((active || saved) && !confirm('Create a new world and replace the single browser save? Export your current world first if you want to keep it.')) return;
    start(null, seed);
  });
  continueButton.addEventListener('click', () => { if (saved) start(saved, saved.seed); });
  resumeButton.addEventListener('click', () => { if (active) void lock(); });
  exportButton.addEventListener('click', () => {
    if (!active) return;
    const blob = new Blob([JSON.stringify(snapshot())], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url;
    link.download = `voxelcraft-${world.seedText.replace(/[^a-z0-9_-]/gi, '-').slice(0, 40)}.json`;
    document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('World exported. Keep the JSON file as your backup.');
  });
  const fileInput = element<HTMLInputElement>('import-file');
  element('import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]; fileInput.value = ''; if (!file) return;
    try {
      if (file.size > 3000000) throw new Error('Save is too large (3 MB maximum).');
      const data = decodeSave(await file.text());
      if ((active || saved) && !confirm('Import this world and replace the single browser save? Export your current world first to keep it.')) return;
      // Import is not a pointer-lock gesture after asynchronous file IO. Load it, then let the user click Continue.
      persistSave(data); saved = data; active = false; playing = false; exportButton.disabled = true;
      resumeButton.hidden = true; continueButton.hidden = false; seedInput.value = data.seed;
      element('panel-title').textContent = 'Your world is ready.';
      element('menu-description').textContent = 'Choose Continue saved world to explore your import.';
      notify('World imported and saved. Click Continue saved world.');
    } catch (error) { notify(`Import failed: ${message(error)}`, 8000); }
  });
  element<HTMLSelectElement>('distance').addEventListener('change', event => {
    const radius = Number((event.target as HTMLSelectElement).value);
    if (Number.isInteger(radius) && radius >= 2 && radius <= 5) renderer.radius = radius;
  });
  element<HTMLInputElement>('sensitivity').addEventListener('input', event => { sensitivity = Number((event.target as HTMLInputElement).value) / 1000; });
  document.addEventListener('pointerlockchange', () => {
    playing = active && document.pointerLockElement === canvas;
    if (playing) { menu.hidden = true; hud.hidden = false; document.body.classList.add('playing'); clearInput(); }
    else pause();
  });
  document.addEventListener('pointerlockerror', () => { pause(); notify('Mouse capture failed. Click Return to world, or open the game outside its embed.'); });
  document.addEventListener('mousemove', event => { if (playing) player.look(event.movementX, event.movementY, sensitivity); });
  document.addEventListener('keydown', event => {
    if (!playing) return;
    const recognized = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyF', 'KeyR', 'F3'];
    if (recognized.includes(event.code) || /^Digit[1-8]$/.test(event.code)) event.preventDefault();
    keys.add(event.code);
    if (event.repeat) return;
    if (/^Digit[1-8]$/.test(event.code)) choose(Number(event.code.slice(5)) - 1);
    if (event.code === 'KeyF') save(true);
    if (event.code === 'KeyR') { player.respawn(); notify('Returned to the world spawn.'); }
    if (event.code === 'F3') debug.hidden = !debug.hidden;
  });
  document.addEventListener('keyup', event => keys.delete(event.code));
  document.addEventListener('mousedown', event => {
    if (!playing) return; event.preventDefault();
    actionButton = event.button === 1 ? null : event.button; lastAction = performance.now(); act(event.button);
  });
  document.addEventListener('mouseup', () => { actionButton = null; });
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  document.addEventListener('wheel', event => { if (playing) { event.preventDefault(); choose(selected + Math.sign(event.deltaY)); } }, { passive: false });
  window.addEventListener('blur', () => { clearInput(); if (document.pointerLockElement === canvas) document.exitPointerLock(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearInput(); if (document.pointerLockElement === canvas) document.exitPointerLock(); save(); }
  });
  window.addEventListener('pagehide', () => { save(); });
  window.addEventListener('beforeunload', event => { if (active && !save()) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('resize', () => renderer.resize());
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); stopped = true; save(); if (document.pointerLockElement === canvas) document.exitPointerLock();
    fatal('The graphics context was lost. Your world save was attempted; if storage failed, use Export world before reloading. Reload the page to restore graphics, and try a lower view distance.');
  });
  const autosave = window.setInterval(() => { if (active && !document.hidden) save(); }, 20000);
  let previous = performance.now(), frames = 0, fps = 0, nextFps = previous + 1000, nextHud = 0;
  function frame(now: number): void {
    if (stopped) return;
    try {
      const dt = Math.min((now - previous) / 1000, 0.05); previous = now;
      if (document.hidden) { requestAnimationFrame(frame); return; }
      if (playing) {
        const input = { forward: Number(keys.has('KeyW')) - Number(keys.has('KeyS')), right: Number(keys.has('KeyD')) - Number(keys.has('KeyA')), jump: keys.has('Space'), sprint: keys.has('ShiftLeft') || keys.has('ShiftRight') };
        player.update(dt, input); time = (time + dt) % 1200;
        hit = raycast(world, player.eye(), player.direction());
        if (actionButton !== null && now - lastAction >= 180) { act(actionButton); lastAction = now; }
      }
      renderer.stream(world, player.position);
      renderer.render(player, playing ? hit : null, time, playing ? dt : 0);
      frames++;
      if (now >= nextFps) { fps = frames; frames = 0; nextFps = now + 1000; }
      if (playing && now > nextHud) {
        nextHud = now + 150;
        element('coordinates').textContent = `${Math.floor(player.position.x)} / ${Math.floor(player.position.y)} / ${Math.floor(player.position.z)}`;
        element('target').textContent = hit ? BLOCKS[hit.id].name : '';
        if (!debug.hidden) debug.textContent = `${fps} FPS · ${renderer.gl.info.render.calls} draw calls\n${renderer.meshes.size} visible chunks · ${world.chunks.size} cached\n${renderer.gl.info.render.triangles.toLocaleString()} triangles\n${world.edits.size.toLocaleString()} edited blocks\nSeed: ${world.seedText}`;
      }
      requestAnimationFrame(frame);
    } catch (error) {
      stopped = true; clearInterval(autosave); save(); if (document.pointerLockElement === canvas) document.exitPointerLock();
      fatal(`The game stopped: ${message(error)}. Export your world if possible, then reload.`);
    }
  }
  requestAnimationFrame(frame);
  window.addEventListener('pagehide', event => { if (!event.persisted) { stopped = true; clearInterval(autosave); renderer.dispose(); void audio?.close(); } });
}
function message(error: unknown): string { return error instanceof Error ? error.message : 'An unexpected error occurred.'; }
try { boot(); } catch (error) { fatal(`Voxelcraft could not start. ${message(error)} Ensure hardware acceleration and WebGL2 are enabled, then reload.`); }
