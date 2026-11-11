// NUÉE — relevé de biosphère. Orchestration.
// piège à erreurs consultable via eval (les logs du preview sont muets sur les erreurs de page)
window.__errs = [];
window.addEventListener('error', (e) => window.__errs.push(String((e.error && e.error.stack) || e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errs.push('promise: ' + e.reason));

import * as THREE from '../lib/three.module.js';
import { DayCycle } from './palette.js';
import { World, heightAt, biomeIdAt } from './world.js';
import { Sky } from './sky.js';
import { CloudSea } from './cloudsea.js';
import { Creatures } from './creatures.js';
import { Thermals } from './thermals.js';
import { Player } from './player.js';
import { Ambience } from './audio.js';
import { UI } from './ui.js';
import { InkPass } from './post.js';

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
// 1.5 max : encre plus charnue (style gravure) et meilleure tenue GPU
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 5000);
camera.position.set(0, 20, -440);

// lumières — pas d'ombres portées : les aplats et l'encre font le travail
const sun = new THREE.DirectionalLight(0xfff6e4, 1.0);
scene.add(sun);
scene.add(sun.target);
const hemi = new THREE.HemisphereLight(0xbcc6e0, 0x94907c, 0.9);
scene.add(hemi);

const cycle = new DayCycle();
cycle.eval();

const world = new World(scene);
const sky = new Sky(scene);
const sea = new CloudSea(scene);
const creatures = new Creatures(scene);
const thermals = new Thermals(scene);
const player = new Player(scene, camera, world.toonMat);
const audio = new Ambience();
const ui = new UI();
ui.onRecord = () => audio.confirm();
const ink = new InkPass(renderer, camera);

// pré-génération autour du départ pour éviter le trou initial
for (let i = 0; i < 60; i++) world.update(player.pos.x, player.pos.z);

// ————— entrée dans le jeu —————
let running = false;
document.getElementById('intro').addEventListener('click', () => {
  audio.init();
  renderer.domElement.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  player.locked = locked;
  running = locked;
  if (locked) ui.enterGame();
  else ui.exitGame();
});

// signal
let pingCooldown = 0;
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyE' && running && pingCooldown <= 0) {
    pingCooldown = 2.5;
    audio.ping();
    const answers = creatures.ping(player.pos);
    for (const a of answers) {
      audio.answer(a.type, a.delay);
      ui.journal.record('creature:' + a.type);
    }
  }
  // débogage : T accélère le cycle du jour tant que la touche est enfoncée
});

let timeScale = 1;
window.addEventListener('keydown', (e) => { if (e.code === 'KeyT') timeScale = 60; });
window.addEventListener('keyup', (e) => { if (e.code === 'KeyT') timeScale = 1; });
window.addEventListener('blur', () => { timeScale = 1; });

function onResize() {
  // fallback : certains contextes headless rapportent 0×0
  const w = window.innerWidth || 1600, h = window.innerHeight || 900;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  ink.setSize(size.x, size.y);
}
window.addEventListener('resize', onResize);
onResize();

// ————— boucle —————
const clock = new THREE.Clock();
let elapsed = 0;
let lastTick = performance.now();
let biomeTimer = 0.5;

function frame() {
  lastTick = performance.now();
  // auto-réparation si le canvas a été créé à 0×0
  if (renderer.domElement.width === 0 || renderer.domElement.height === 0) onResize();
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  const t = elapsed;

  cycle.advance(dt, timeScale);
  const cy = cycle.out;

  if (running) {
    player.lift = thermals.liftAt(player.pos);
    player.update(dt);
    pingCooldown -= dt;
    // relevé de biome par séjour prolongé
    biomeTimer -= dt;
    if (biomeTimer <= 0) {
      biomeTimer = 0.5;
      ui.journal.tickBiome(biomeIdAt(player.pos.x, player.pos.z), 0.5);
    }
  } else {
    player.idleOrbit(t, dt);
  }

  world.update(player.pos.x, player.pos.z);
  thermals.update(dt, t, player.pos, cy);
  world.setCycle(cy, camera.position);
  sky.update(cy, camera.position, t);
  sea.update(cy, camera.position, t);
  creatures.update(dt, t, player.pos, cy);
  audio.update(dt, player.speed ?? 0, cy.night);
  ui.update(dt, t, player, running);

  // lumières
  sun.position.copy(camera.position).addScaledVector(cy.sunDir, 600);
  sun.target.position.copy(camera.position);
  sun.color.copy(cy.light);
  sun.intensity = cy.lightI * 1.15;
  hemi.color.copy(cy.hemiSky);
  hemi.groundColor.copy(cy.hemiGnd);
  hemi.intensity = 0.75;

  ink.render(scene, camera, t);
}

// poignée de debug (eval preview + console)
window.__nuee = {
  player, camera, cycle, world, creatures, sky, sea, renderer, ink, heightAt, thermals, biomeIdAt, ui,
  setTime(t) { cycle.t = t; cycle.eval(); },
  goto(x, z, y = null, yaw = null) {
    player.pos.set(x, y ?? (heightAt(x, z) + 12), z);
    player.vel.set(0, 0, 0);
    if (yaw !== null) player.yaw = yaw;
  },
  drive(on) { running = on; },
  frame() { frame(); },
};

function rafLoop() {
  frame();
  requestAnimationFrame(rafLoop);
}
requestAnimationFrame(rafLoop);
// relais si rAF est gelé (onglet masqué, preview headless)
setInterval(() => {
  if (performance.now() - lastTick > 200) frame();
}, 66);
