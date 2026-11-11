// Monde NUÉE — terrain infini par chunks, aplats posterisés, props instanciés, lieux-dits
import * as THREE from '../lib/three.module.js';
import { Simplex2, mulberry32, smoothstep, lerp, clamp } from './noise.js';
import { TERRAIN, PROPS } from './palette.js';

const S = new Simplex2(4177);
const S2 = new Simplex2(9241);

export const CLOUD_LEVEL = -9;
export const RING_RADIUS = 700;

// ————— lieux-dits —————
export const POIS = [
  { name: 'La Cathédrale', sub: 'colonie fongique primaire', x: 80, z: -620, r: 150 },
  { name: 'Les Aiguilles', sub: 'champ cristallin', x: 620, z: 380, r: 170 },
  { name: 'La Mer de Lait', sub: 'bassin de condensation', x: -680, z: 240, r: 280 },
  { name: "L'Anneau", sub: 'couloir de migration', ring: RING_RADIUS, r: 70 },
  { name: 'Le Phare', sub: 'mesa sentinelle', x: 150, z: 820, r: 180 },
  { name: 'Les Arches', sub: "vestiges d'érosion", x: -420, z: -360, r: 150 },
];

// disques de mise en forme : { x, z, r, h, sharp } — sharp: bord raide (mesa)
const DISCS = [
  { x: 80, z: -620, r: 170, h: 4, sharp: 0 },      // Cathédrale : parvis plat
  { x: 620, z: 380, r: 180, h: 6, sharp: 0 },      // Aiguilles : plaine
  { x: -680, z: 240, r: 260, h: -26, sharp: 0 },   // Mer de Lait : bassin
  { x: 150, z: 820, r: 65, h: 92, sharp: 1 },      // Phare : mesa forcée
  { x: -420, z: -360, r: 160, h: 3, sharp: 0 },    // Arches : plaine
  { x: 0, z: -540, r: 90, h: 5, sharp: 0 },        // zone de départ
];

// ————— relief —————
export function heightAt(x, z) {
  let h = S.fbm(x * 0.0009, z * 0.0009, 3) * 18;
  h += S.fbm(x * 0.004 + 7.3, z * 0.004 - 2.1, 3) * 7;
  h += S.noise2(x * 0.02, z * 0.02) * 0.8;

  // bassins — mers de nuages
  const b = smoothstep(0.25, 0.75, S.fbm(x * 0.0006 - 11, z * 0.0006 + 5, 2) * 0.5 + 0.5);
  h -= b * b * 34;

  // mesas striées
  const m = S.fbm(x * 0.0012 + 31, z * 0.0012 - 17, 3) * 0.5 + 0.5;
  const plateau = smoothstep(0.60, 0.665, m);
  if (plateau > 0) {
    const mesaH = 55 + S.fbm(x * 0.008, z * 0.008, 2) * 6 + (m - 0.63) * 160;
    h = lerp(h, mesaH, plateau * 0.97);
    const m2 = smoothstep(0.685, 0.72, m);
    h = lerp(h, mesaH + 38, m2);
  }

  // couloir de migration : anneau aplani
  const r = Math.hypot(x, z);
  const c = 1 - smoothstep(40, 95, Math.abs(r - RING_RADIUS));
  if (c > 0) h = lerp(h, 1.6 + S.noise2(x * 0.01, z * 0.01) * 0.9, c * 0.9);

  // disques des lieux-dits
  for (const d of DISCS) {
    const dd = Math.hypot(x - d.x, z - d.z);
    if (dd < d.r) {
      const f = d.sharp
        ? 1 - smoothstep(d.r * 0.72, d.r, dd)
        : 1 - smoothstep(d.r * 0.45, d.r, dd);
      h = lerp(h, d.h + S.noise2(x * 0.015, z * 0.015) * 1.2, f * 0.95);
    }
  }
  return h;
}

export function normalAt(x, z, eps = 1.5) {
  const hl = heightAt(x - eps, z), hr = heightAt(x + eps, z);
  const hd = heightAt(x, z - eps), hu = heightAt(x, z + eps);
  const n = new THREE.Vector3(hl - hr, 2 * eps, hd - hu);
  return n.normalize();
}

// ————— biomes —————
// deux champs lents (température × aridité) découpent le monde en régions
export function biomeFields(x, z) {
  const temp = S.fbm(x * 0.00045 + 77, z * 0.00045 - 13, 2) * 0.5 + 0.5;
  const arid = S2.fbm(x * 0.00055 - 41, z * 0.00055 + 29, 2) * 0.5 + 0.5;
  return { temp, arid };
}

// poids continus de chaque biome (0..1), utilisés par couleur + flore + journal
export function biomeWeights(x, z, h) {
  const { temp, arid } = biomeFields(x, z);
  const desert = smoothstep(0.56, 0.68, arid);
  const fungal = smoothstep(0.60, 0.70, temp) * (1 - smoothstep(0.38, 0.50, arid));
  const coralW = (1 - smoothstep(0.30, 0.42, temp)) * (1 - smoothstep(0.40, 0.52, arid));
  const moor = (1 - smoothstep(0.30, 0.42, temp)) * smoothstep(0.50, 0.62, arid);
  const marsh = smoothstep(-3.2, -4.5, h) * (1 - smoothstep(-8.0, -9.5, h)) * (1 - desert);
  return { temp, arid, desert, fungal, coral: coralW, moor, marsh };
}

export function biomeIdAt(x, z) {
  const h = heightAt(x, z);
  if (h < -8) return 'mer';
  if (h > 48) return 'mesa';
  const w = biomeWeights(x, z, h);
  if (w.marsh > 0.5) return 'vasiere';
  if (w.desert > 0.5) return 'desert';
  if (w.fungal > 0.5) return 'fongique';
  if (w.coral > 0.5) return 'coraux';
  if (w.moor > 0.5) return 'lande';
  return 'prairie';
}

// ————— couleur du sol —————
const _col = new THREE.Color();
const _bc = new THREE.Color();
const CACHE = {};
for (const k in TERRAIN) { CACHE[k] = new THREE.Color(TERRAIN[k]); }

function terrainColor(x, z, h, ny, concave, out) {
  const moist = S.fbm(x * 0.003 + 101, z * 0.003 - 33, 2) * 0.5 + 0.5;
  const lichen = S2.fbm(x * 0.013 - 7, z * 0.013 + 13, 2) * 0.5 + 0.5;
  // trame les frontières de bandes — évite les marches d'escalier de la grille
  h += S2.noise2(x * 0.09, z * 0.09) * 1.4;

  if (ny < 0.62) {
    // falaises striées — universelles
    const stripe = (Math.floor(h * 0.42 + S.noise2(x * 0.05, z * 0.05) * 0.6) % 2 + 2) % 2;
    out.copy(stripe ? CACHE.cliffDark : CACHE.cliff);
    if (h > 46) out.lerp(CACHE.cliffRose, 0.35);
  } else if (h < -7.5) {
    out.copy(CACHE.deep);
  } else if (h >= 48) {
    out.copy(CACHE.mesaTop);
    if (lichen > 0.68) out.lerp(CACHE.coral, 0.4);
  } else {
    const w = biomeWeights(x, z, h);

    // prairie — base
    if (h < -4) out.copy(CACHE.shore);
    else {
      out.lerpColors(CACHE.sage, CACHE.moss, smoothstep(0.35, 0.7, moist));
      if (lichen > 0.72) out.lerp(CACHE.coral, smoothstep(0.72, 0.82, lichen));
      else if (lichen < 0.18) out.lerp(CACHE.lavender, smoothstep(0.18, 0.08, lichen));
      if (h > 26) out.lerp(CACHE.highland, smoothstep(26, 40, h) * 0.7);
    }

    // désert minéral — strates plates sable/ocre/rose
    if (w.desert > 0.01) {
      const band = ((Math.floor(h * 0.6 + S.noise2(x * 0.03, z * 0.03) * 1.1) % 3) + 3) % 3;
      _bc.copy(band === 0 ? CACHE.sand : band === 1 ? CACHE.ochre : CACHE.sandRose);
      if (lichen > 0.8) _bc.lerp(CACHE.coralRust, 0.3);
      out.lerp(_bc, w.desert);
    }
    // forêt fongique — sol sombre moucheté
    if (w.fungal > 0.01) {
      _bc.copy(CACHE.fungal);
      if (moist > 0.58) _bc.lerp(CACHE.fungalMoss, smoothstep(0.58, 0.75, moist));
      const dots = S2.noise2(x * 0.6, z * 0.6);
      if (dots > 0.62) _bc.lerp(CACHE.fungalPale, 0.55); // mouchetis de spores
      out.lerp(_bc, w.fungal);
    }
    // champ de coraux — lit rose pâle, taches rouille
    if (w.coral > 0.01) {
      _bc.copy(CACHE.coralBed);
      if (lichen > 0.55) _bc.lerp(CACHE.coralRust, smoothstep(0.55, 0.75, lichen));
      if (lichen < 0.2) _bc.lerp(CACHE.marshMint, 0.4);
      out.lerp(_bc, w.coral);
    }
    // lande lavande — bruyère grise
    if (w.moor > 0.01) {
      _bc.lerpColors(CACHE.moor, CACHE.moorRock, smoothstep(0.4, 0.7, lichen));
      out.lerp(_bc, w.moor);
    }
    // vasière — vase mauve sombre, écume menthe
    if (w.marsh > 0.01) {
      _bc.copy(CACHE.marsh);
      if (lichen > 0.74) _bc.lerp(CACHE.marshMint, 0.5);
      out.lerp(_bc, w.marsh);
    }
  }

  if (concave > 0.35) out.lerp(CACHE.pine, 0.35); // creux assombris
  const j = 1 + S2.noise2(x * 0.6, z * 0.6) * 0.035; // grain d'encrage
  out.multiplyScalar(j);
}

// ————— géométries de props (couleurs vertex neutres, teintées par instance) —————
function mergeGeoms(geoms) {
  // certaines géométries THREE (icosaèdre, octaèdre) sont non-indexées :
  // on uniformise tout en non-indexé avant concaténation
  const parts = geoms.map((g) => (g.index ? g.toNonIndexed() : g));
  let vCount = 0;
  for (const g of parts) vCount += g.attributes.position.count;
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  let vo = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    col.set(g.attributes.color.array, vo * 3);
    vo += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

function paint(geom, color, mul = 1) {
  const c = new THREE.Color(color).multiplyScalar(mul);
  const n = geom.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geom;
}

function mushroomGeom(capRatio = 1) {
  const trunk = paint(new THREE.CylinderGeometry(0.32, 0.55, 3.4, 7, 1), 0xded4bc, 0.92);
  trunk.translate(0, 1.7, 0);
  const cap = new THREE.SphereGeometry(1.55 * capRatio, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.42);
  cap.scale(1, 0.62, 1); cap.translate(0, 3.15, 0);
  paint(cap, 0xffffff);
  const under = new THREE.CylinderGeometry(1.42 * capRatio, 0.5, 0.3, 10, 1);
  under.translate(0, 3.12, 0);
  paint(under, 0xb08ca0, 0.9);
  return mergeGeoms([trunk, cap, under]);
}

function bulbTreeGeom() {
  const trunk = paint(new THREE.CylinderGeometry(0.16, 0.3, 3.6, 6, 1), 0xc4b89c, 0.85);
  trunk.translate(0, 1.8, 0);
  const parts = [trunk];
  const rand = mulberry32(77);
  for (let i = 0; i < 4; i++) {
    const s = 0.55 + rand() * 0.5;
    const b = new THREE.SphereGeometry(s, 8, 6);
    b.translate((rand() - 0.5) * 1.3, 3.4 + rand() * 1.1, (rand() - 0.5) * 1.3);
    paint(b, 0xffffff);
    parts.push(b);
  }
  return mergeGeoms(parts);
}

function coralGeom() {
  const rand = mulberry32(41);
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const s = 0.35 + rand() * 0.6;
    const b = new THREE.IcosahedronGeometry(s, 1);
    b.translate((rand() - 0.5) * 1.6, s * 0.7 + rand() * 0.7, (rand() - 0.5) * 1.6);
    paint(b, 0xffffff, 0.94 + rand() * 0.12);
    parts.push(b);
  }
  return mergeGeoms(parts);
}

function crystalGeom() {
  const rand = mulberry32(63);
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const c = new THREE.OctahedronGeometry(0.7 + rand() * 0.5, 0);
    c.scale(0.55, 2.2 + rand() * 1.6, 0.55);
    c.rotateZ((rand() - 0.5) * 0.5); c.rotateX((rand() - 0.5) * 0.5);
    c.translate((rand() - 0.5) * 1.2, 1.1, (rand() - 0.5) * 1.2);
    paint(c, 0xffffff, 0.96 + rand() * 0.1);
    parts.push(c);
  }
  return mergeGeoms(parts);
}

function tuftGeom() {
  const rand = mulberry32(29);
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const c = new THREE.ConeGeometry(0.09, 0.9 + rand() * 0.7, 4, 1);
    c.translate((rand() - 0.5) * 0.5, 0.45, (rand() - 0.5) * 0.5);
    c.rotateZ((rand() - 0.5) * 0.3);
    paint(c, 0xffffff);
    parts.push(c);
  }
  return mergeGeoms(parts);
}

// fougère : éventail de cônes aplatis
function fernGeom() {
  const rand = mulberry32(97);
  const parts = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const len = 1.6 + rand() * 0.9;
    const c = new THREE.ConeGeometry(0.22, len, 4, 1);
    c.scale(1, 1, 0.22); // lame plate
    c.translate(0, len * 0.5, 0);
    c.rotateX(-0.9 - rand() * 0.5); // penchée vers l'extérieur
    c.rotateY((i / n) * Math.PI * 2 + rand() * 0.4);
    paint(c, 0xffffff, 0.9 + rand() * 0.2);
    parts.push(c);
  }
  return mergeGeoms(parts);
}

// roseau : tiges fines à nœuds
function reedGeom() {
  const rand = mulberry32(113);
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const hgt = 2.2 + rand() * 1.8;
    const stem = new THREE.CylinderGeometry(0.045, 0.06, hgt, 4, 1);
    const ox = (rand() - 0.5) * 0.7, oz = (rand() - 0.5) * 0.7;
    stem.translate(ox, hgt / 2, oz);
    stem.rotateZ((rand() - 0.5) * 0.16);
    paint(stem, 0xffffff);
    parts.push(stem);
    const tip = new THREE.SphereGeometry(0.11, 5, 4);
    tip.translate(ox + (rand() - 0.5) * 0.2, hgt + 0.05, oz);
    paint(tip, 0xb08ca0, 1.0);
    parts.push(tip);
  }
  return mergeGeoms(parts);
}

// arbre-parapluie à étages : trois chapeaux empilés
function tieredGeom() {
  const rand = mulberry32(131);
  const trunk = paint(new THREE.CylinderGeometry(0.22, 0.4, 4.6, 6, 1), 0xded4bc, 0.9);
  trunk.translate(0, 2.3, 0);
  const parts = [trunk];
  for (let i = 0; i < 3; i++) {
    const r = 1.9 - i * 0.55;
    const cap = new THREE.SphereGeometry(r, 9, 4, 0, Math.PI * 2, 0, Math.PI * 0.38);
    cap.scale(1, 0.5, 1);
    cap.translate(0, 2.1 + i * 1.2, 0);
    paint(cap, 0xffffff, 1 - i * 0.06);
    parts.push(cap);
    const under = new THREE.CylinderGeometry(r * 0.9, 0.28, 0.18, 9, 1);
    under.translate(0, 2.06 + i * 1.2, 0);
    paint(under, 0xb08ca0, 0.85);
    parts.push(under);
  }
  return mergeGeoms(parts);
}

// orgues : faisceau de tuyaux verticaux (désert)
function pipesGeom() {
  const rand = mulberry32(149);
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const hgt = 1.4 + rand() * 2.6;
    const p = new THREE.CapsuleGeometry(0.28 + rand() * 0.14, hgt, 3, 6);
    p.translate((rand() - 0.5) * 1.1, hgt / 2 + 0.3, (rand() - 0.5) * 1.1);
    paint(p, 0xffffff, 0.92 + rand() * 0.16);
    parts.push(p);
  }
  return mergeGeoms(parts);
}

// menhir : monolithe anguleux
function menhirGeom() {
  const m = new THREE.CylinderGeometry(0.5, 0.95, 3.6, 5, 1);
  m.translate(0, 1.7, 0);
  m.rotateY(0.4);
  paint(m, 0xffffff);
  return mergeGeoms([m]);
}

// anémone : boule centrale + tentacules boutonnés
function anemoneGeom() {
  const rand = mulberry32(167);
  const core = new THREE.SphereGeometry(0.42, 8, 6);
  core.translate(0, 0.42, 0);
  paint(core, 0xded4bc, 0.9);
  const parts = [core];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rand() * 0.3;
    const len = 0.8 + rand() * 0.5;
    const el = 0.5 + rand() * 0.7;
    const stem = new THREE.CylinderGeometry(0.05, 0.06, len, 4, 1);
    stem.translate(0, len / 2, 0);
    stem.rotateZ(Math.PI / 2 - el);
    stem.rotateY(a);
    stem.translate(0, 0.42, 0);
    paint(stem, 0xffffff, 0.85);
    parts.push(stem);
    const tip = new THREE.SphereGeometry(0.13, 5, 4);
    const dx = Math.cos(a) * Math.cos(el) * len, dy = Math.sin(el) * len, dz = -Math.sin(a) * Math.cos(el) * len;
    tip.translate(dx, 0.42 + dy, dz);
    paint(tip, 0xffffff);
    parts.push(tip);
  }
  return mergeGeoms(parts);
}

// fleur-cloche : hampe courbée + clochette pendante
function bellflowerGeom() {
  const rand = mulberry32(181);
  const parts = [];
  const seg = 3;
  let px = 0, py = 0, ang = 0;
  for (let i = 0; i < seg; i++) {
    const len = 1.2;
    const s = new THREE.CylinderGeometry(0.06, 0.075, len, 4, 1);
    s.translate(0, len / 2, 0);
    s.rotateZ(ang);
    s.translate(px, py, 0);
    paint(s, 0x8fae7f, 0.9);
    parts.push(s);
    px += Math.sin(ang) * -len; py += Math.cos(ang) * len;
    ang += 0.45;
  }
  const bell = new THREE.ConeGeometry(0.5, 0.9, 7, 1, true);
  bell.rotateX(Math.PI); // cloche vers le bas
  bell.rotateZ(0.5);
  bell.translate(px - 0.3, py - 0.15, 0);
  paint(bell, 0xffffff);
  parts.push(bell);
  const stamen = new THREE.SphereGeometry(0.12, 5, 4);
  stamen.translate(px - 0.42, py - 0.55, 0);
  paint(stamen, 0xe3d9b8);
  parts.push(stamen);
  return mergeGeoms(parts);
}

// palmier-plume : tronc + frondes plates rayonnantes
function palmGeom() {
  const rand = mulberry32(199);
  const trunk = paint(new THREE.CylinderGeometry(0.14, 0.26, 3.8, 6, 1), 0xc4a884, 0.9);
  trunk.translate(0, 1.9, 0);
  const parts = [trunk];
  for (let i = 0; i < 7; i++) {
    const len = 1.8 + rand() * 0.6;
    const f = new THREE.ConeGeometry(0.3, len, 4, 1);
    f.scale(1, 1, 0.14);
    f.translate(0, len * 0.5, 0);
    f.rotateX(-1.25 - rand() * 0.35); // retombantes
    f.rotateY((i / 7) * Math.PI * 2);
    f.translate(0, 3.8, 0);
    paint(f, 0xffffff, 0.9 + rand() * 0.2);
    parts.push(f);
  }
  return mergeGeoms(parts);
}

// ————— matériaux —————
export function makeToonMaterial() {
  const data = new Uint8Array([120, 185, 255]);
  const grad = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  grad.minFilter = grad.magFilter = THREE.NearestFilter;
  grad.needsUpdate = true;
  return new THREE.MeshToonMaterial({ gradientMap: grad, vertexColors: true });
}

const TERRAIN_VERT = /* glsl */`
  varying vec3 vColor;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vColor = color;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const TERRAIN_FRAG = /* glsl */`
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform float uLightI;
  uniform vec3 uHemiSky;
  uniform vec3 uHemiGnd;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uCamPos;
  varying vec3 vColor;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 N = normalize(vNormalW);
    float ndl = dot(N, normalize(uLightDir)) * 0.5 + 0.5;
    // trois bandes de lumière, transitions courtes
    float band = 0.52
      + smoothstep(0.36, 0.41, ndl) * 0.22
      + smoothstep(0.60, 0.65, ndl) * 0.26;
    vec3 hemi = mix(uHemiGnd, uHemiSky, N.y * 0.5 + 0.5);
    vec3 col = vColor * (uLightColor * band * uLightI + hemi * 0.55);
    float d = distance(vPosW, uCamPos);
    float fogF = smoothstep(uFogNear, uFogFar, d);
    // brouillard posterisé en 3 paliers — couches d'illustration
    fogF = floor(fogF * 4.0) / 4.0 + smoothstep(0.0, 1.0, fract(fogF * 4.0)) * 0.25;
    col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.chunkSize = 200;
    this.res = 40;
    this.radius = 5;
    this.chunks = new Map();
    this.group = new THREE.Group();
    scene.add(this.group);

    this.terrainUniforms = {
      uLightDir: { value: new THREE.Vector3(0.5, 0.8, 0.2) },
      uLightColor: { value: new THREE.Color(0xfff6e4) },
      uLightI: { value: 1 },
      uHemiSky: { value: new THREE.Color(0xbcc6e0) },
      uHemiGnd: { value: new THREE.Color(0x94907c) },
      uFogColor: { value: new THREE.Color(0xe4e0d0) },
      uFogNear: { value: 160 },
      uFogFar: { value: 920 },
      uCamPos: { value: new THREE.Vector3() },
    };
    this.terrainMat = new THREE.ShaderMaterial({
      uniforms: this.terrainUniforms,
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
      vertexColors: true,
    });

    this.toonMat = makeToonMaterial();
    this.geoms = {
      mushroom: mushroomGeom(),
      bulb: bulbTreeGeom(),
      coral: coralGeom(),
      crystal: crystalGeom(),
      tuft: tuftGeom(),
      fern: fernGeom(),
      reed: reedGeom(),
      tiered: tieredGeom(),
      pipes: pipesGeom(),
      menhir: menhirGeom(),
      anemone: anemoneGeom(),
      bellflower: bellflowerGeom(),
      palm: palmGeom(),
    };
    this.buildLandmarks();
  }

  // ————— contenus fixes des lieux-dits —————
  buildLandmarks() {
    const g = new THREE.Group();

    // La Cathédrale : anneau de champignons colossaux
    const rand = mulberry32(2026);
    const giant = mushroomGeom(1.15);
    const nGiant = 9;
    const cath = new THREE.InstancedMesh(giant, this.toonMat, nGiant);
    const M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), Sc = new THREE.Vector3();
    const capCols = [PROPS.capTeal, PROPS.capRose, PROPS.capCream, PROPS.capCoral];
    for (let i = 0; i < nGiant; i++) {
      const a = (i / nGiant) * Math.PI * 2 + rand() * 0.3;
      const r = 55 + rand() * 45;
      const x = 80 + Math.cos(a) * r, z = -620 + Math.sin(a) * r;
      const s = 14 + rand() * 12; // hauteur 48–88 u
      P.set(x, heightAt(x, z) - 1, z);
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      Sc.set(s * (0.8 + rand() * 0.3), s, s * (0.8 + rand() * 0.3));
      M.compose(P, Q, Sc);
      cath.setMatrixAt(i, M);
      cath.setColorAt(i, new THREE.Color(capCols[i % capCols.length]));
    }
    cath.instanceMatrix.needsUpdate = true;
    if (cath.instanceColor) cath.instanceColor.needsUpdate = true;
    g.add(cath);

    // Les Arches : trois demi-tores de pierre
    const archGeom = paint(new THREE.TorusGeometry(22, 3.2, 8, 20, Math.PI), 0xffffff);
    const arches = new THREE.InstancedMesh(archGeom, this.toonMat, 3);
    for (let i = 0; i < 3; i++) {
      const x = -420 + (rand() - 0.5) * 160, z = -360 + (rand() - 0.5) * 160;
      P.set(x, heightAt(x, z), z);
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
      const s = 0.7 + rand() * 0.9;
      Sc.set(s, s * (0.8 + rand() * 0.4), s);
      M.compose(P, Q, Sc);
      arches.setMatrixAt(i, M);
      arches.setColorAt(i, new THREE.Color(PROPS.stone));
    }
    arches.instanceMatrix.needsUpdate = true;
    if (arches.instanceColor) arches.instanceColor.needsUpdate = true;
    g.add(arches);

    // Le Phare : couronne d'arbres-bulbes pâles au sommet de la mesa
    const crown = new THREE.InstancedMesh(this.geoms.bulb, this.toonMat, 14);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = 14 + rand() * 30;
      const x = 150 + Math.cos(a) * r, z = 820 + Math.sin(a) * r;
      const s = 2.2 + rand() * 1.8;
      P.set(x, heightAt(x, z) - 0.3, z);
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      Sc.set(s, s, s);
      M.compose(P, Q, Sc);
      crown.setMatrixAt(i, M);
      crown.setColorAt(i, new THREE.Color(PROPS.bulbPale));
    }
    crown.instanceMatrix.needsUpdate = true;
    if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
    g.add(crown);

    // Les Aiguilles : champ de cristaux géants
    const spikes = new THREE.InstancedMesh(this.geoms.crystal, this.toonMat, 40);
    for (let i = 0; i < 40; i++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 150;
      const x = 620 + Math.cos(a) * r, z = 380 + Math.sin(a) * r;
      const s = 2.5 + rand() * rand() * 9;
      P.set(x, heightAt(x, z) - 0.5, z);
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      Sc.set(s, s, s);
      M.compose(P, Q, Sc);
      spikes.setMatrixAt(i, M);
      spikes.setColorAt(i, new THREE.Color(i % 3 ? PROPS.crystal : PROPS.crystalPale));
    }
    spikes.instanceMatrix.needsUpdate = true;
    if (spikes.instanceColor) spikes.instanceColor.needsUpdate = true;
    g.add(spikes);

    this.scene.add(g);
  }

  // ————— chunks —————
  key(cx, cz) { return cx + '|' + cz; }

  buildChunk(cx, cz) {
    const size = this.chunkSize, res = this.res;
    const x0 = cx * size, z0 = cz * size;
    const nv = res + 1;
    const pos = new Float32Array(nv * nv * 3);
    const col = new Float32Array(nv * nv * 3);
    const nor = new Float32Array(nv * nv * 3);
    const idx = new Uint32Array(res * res * 6);
    const step = size / res;
    const eps = step * 0.8;

    let p = 0;
    for (let j = 0; j <= res; j++) {
      for (let i = 0; i <= res; i++) {
        const x = x0 + i * step, z = z0 + j * step;
        const h = heightAt(x, z);
        pos[p * 3] = x; pos[p * 3 + 1] = h; pos[p * 3 + 2] = z;
        // normale par différences centrales
        const hl = heightAt(x - eps, z), hr = heightAt(x + eps, z);
        const hd = heightAt(x, z - eps), hu = heightAt(x, z + eps);
        let nx = hl - hr, ny = 2 * eps, nz = hd - hu;
        const nl = Math.hypot(nx, ny, nz);
        nx /= nl; ny /= nl; nz /= nl;
        nor[p * 3] = nx; nor[p * 3 + 1] = ny; nor[p * 3 + 2] = nz;
        // concavité (laplacien) pour assombrir les creux
        const concave = clamp((hl + hr + hd + hu - 4 * h) * 0.25, 0, 2);
        terrainColor(x, z, h, ny, concave, _col);
        col[p * 3] = _col.r; col[p * 3 + 1] = _col.g; col[p * 3 + 2] = _col.b;
        p++;
      }
    }
    let q = 0;
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const a = j * nv + i, b = a + 1, c = a + nv, d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b;
        idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geom.setIndex(new THREE.BufferAttribute(idx, 1));
    const mesh = new THREE.Mesh(geom, this.terrainMat);
    mesh.frustumCulled = true;

    const group = new THREE.Group();
    group.add(mesh);
    this.scatterProps(group, cx, cz);
    this.group.add(group);
    return { group };
  }

  scatterProps(group, cx, cz) {
    const size = this.chunkSize;
    const x0 = cx * size, z0 = cz * size;
    const rand = mulberry32((cx * 73856093) ^ (cz * 19349663) ^ 4177);
    // chaque espèce est gardée par son biome (w = biomeWeights)
    const OPEN = (w) => w.desert < 0.5 && w.fungal < 0.5 && w.coral < 0.5 && w.moor < 0.5 && w.marsh < 0.4;
    const kinds = [
      // — prairie & partout herbeux —
      { geom: this.geoms.tuft, tries: 46, cols: [PROPS.tuft, PROPS.capTeal, PROPS.tuftRose], sMin: 0.8, sMax: 1.8,
        ok: (h, ny, li, mo, w) => h > -3 && h < 34 && ny > 0.72 && w.desert < 0.4 && w.marsh < 0.4 },
      { geom: this.geoms.mushroom, tries: 8, cols: [PROPS.capTeal, PROPS.capCoral, PROPS.capRose, PROPS.capCream], sMin: 0.7, sMax: 2.4,
        ok: (h, ny, li, mo, w) => h > -2 && h < 26 && ny > 0.78 && mo > 0.45 && OPEN(w) },
      { geom: this.geoms.coral, tries: 14, cols: [PROPS.coralPink, PROPS.coralOrange, PROPS.coralGreen], sMin: 0.6, sMax: 2.0,
        ok: (h, ny, li, mo, w) => h > -2 && h < 26 && ny > 0.75 && li > 0.6 && OPEN(w) },
      { geom: this.geoms.bulb, tries: 5, cols: [PROPS.bulb, PROPS.bulbPale], sMin: 0.8, sMax: 2.0,
        ok: (h, ny, li, mo, w) => h > 0 && h < 30 && ny > 0.8 && mo < 0.45 && OPEN(w) },
      { geom: this.geoms.fern, tries: 10, cols: [PROPS.fern, PROPS.fernTeal], sMin: 0.7, sMax: 1.6,
        ok: (h, ny, li, mo, w) => h > -2 && h < 28 && ny > 0.75 && mo > 0.5 && w.desert < 0.3 },
      // — forêt fongique : dense, haute —
      { geom: this.geoms.mushroom, tries: 34, cols: [PROPS.capTeal, PROPS.capViolet, PROPS.capRose], sMin: 1.2, sMax: 4.2,
        ok: (h, ny, li, mo, w) => h > -2 && h < 34 && ny > 0.7 && w.fungal > 0.5 },
      { geom: this.geoms.tiered, tries: 12, cols: [PROPS.capViolet, PROPS.capTeal, PROPS.capCream], sMin: 1.2, sMax: 3.2,
        ok: (h, ny, li, mo, w) => h > -2 && h < 34 && ny > 0.72 && w.fungal > 0.5 },
      { geom: this.geoms.fern, tries: 16, cols: [PROPS.fernTeal, PROPS.fern], sMin: 0.9, sMax: 2.0,
        ok: (h, ny, li, mo, w) => h > -2 && h < 34 && ny > 0.72 && w.fungal > 0.5 },
      // — champ de coraux : colonies géantes —
      { geom: this.geoms.coral, tries: 24, cols: [PROPS.coralPink, PROPS.coralOrange, PROPS.capRose], sMin: 1.0, sMax: 3.4,
        ok: (h, ny, li, mo, w) => h > -3 && h < 30 && ny > 0.72 && w.coral > 0.55 },
      { geom: this.geoms.anemone, tries: 12, cols: [PROPS.anemone, PROPS.anemonePale], sMin: 0.8, sMax: 2.2,
        ok: (h, ny, li, mo, w) => h > -3 && h < 30 && ny > 0.75 && (w.coral > 0.5 || w.moor > 0.5) },
      // — désert minéral —
      { geom: this.geoms.pipes, tries: 11, cols: [PROPS.pipes, PROPS.pipesRose], sMin: 0.8, sMax: 2.6,
        ok: (h, ny, li, mo, w) => h > -2 && h < 40 && ny > 0.72 && w.desert > 0.55 },
      { geom: this.geoms.menhir, tries: 4, cols: [PROPS.menhir, PROPS.stone], sMin: 1.0, sMax: 3.6,
        ok: (h, ny, li, mo, w) => h > -2 && h < 42 && ny > 0.7 && w.desert > 0.6 },
      { geom: this.geoms.palm, tries: 3, cols: [PROPS.palm, PROPS.fernTeal], sMin: 1.0, sMax: 2.2,
        ok: (h, ny, li, mo, w) => h > -2 && h < 30 && ny > 0.8 && w.desert > 0.45 && w.desert < 0.7 && mo > 0.55 },
      // — lande lavande —
      { geom: this.geoms.bulb, tries: 9, cols: [PROPS.bulbPale, PROPS.crystalPale], sMin: 0.7, sMax: 1.7,
        ok: (h, ny, li, mo, w) => h > -2 && h < 40 && ny > 0.75 && w.moor > 0.55 },
      { geom: this.geoms.tuft, tries: 22, cols: [PROPS.tuftLav, PROPS.crystalPale], sMin: 0.8, sMax: 1.6,
        ok: (h, ny, li, mo, w) => h > -2 && h < 40 && ny > 0.72 && w.moor > 0.5 },
      // — vasière —
      { geom: this.geoms.reed, tries: 26, cols: [PROPS.reed, PROPS.marshMint ?? PROPS.reed, PROPS.fernTeal], sMin: 0.8, sMax: 1.9,
        ok: (h, ny, li, mo, w) => w.marsh > 0.45 && ny > 0.7 },
      { geom: this.geoms.bellflower, tries: 7, cols: [PROPS.bellflower, PROPS.anemone], sMin: 0.9, sMax: 2.0,
        ok: (h, ny, li, mo, w) => w.marsh > 0.5 && ny > 0.75 },
      // — cristaux : lande et désert froids —
      { geom: this.geoms.crystal, tries: 6, cols: [PROPS.crystal, PROPS.crystalPale], sMin: 0.5, sMax: 1.6,
        ok: (h, ny, li, mo, w) => h > -2 && h < 40 && ny > 0.7 && (li < 0.2 || w.moor > 0.5 || w.desert > 0.6) },
    ];
    const M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), Sc = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);
    const C = new THREE.Color();
    for (const k of kinds) {
      const placed = [];
      for (let t = 0; t < k.tries; t++) {
        const x = x0 + rand() * size, z = z0 + rand() * size;
        const h = heightAt(x, z);
        const li = S2.fbm(x * 0.013 - 7, z * 0.013 + 13, 2) * 0.5 + 0.5;
        const mo = S.fbm(x * 0.003 + 101, z * 0.003 - 33, 2) * 0.5 + 0.5;
        const bw = biomeWeights(x, z, h);
        const hl = heightAt(x - 1.5, z), hr = heightAt(x + 1.5, z);
        const hd = heightAt(x, z - 1.5), hu = heightAt(x, z + 1.5);
        const ny = 3 / Math.hypot(hl - hr, 3, hd - hu);
        if (!k.ok(h, ny, li, mo, bw)) continue;
        placed.push({ x, z, h, s: k.sMin + rand() * (k.sMax - k.sMin), rot: rand() * Math.PI * 2, ci: (rand() * k.cols.length) | 0 });
      }
      if (!placed.length) continue;
      const im = new THREE.InstancedMesh(k.geom, this.toonMat, placed.length);
      placed.forEach((pl, i) => {
        P.set(pl.x, pl.h - 0.15, pl.z);
        Q.setFromAxisAngle(UP, pl.rot);
        Sc.set(pl.s, pl.s, pl.s);
        M.compose(P, Q, Sc);
        im.setMatrixAt(i, M);
        C.setHex(k.cols[pl.ci] ?? k.cols[0]);
        im.setColorAt(i, C);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      group.add(im);
    }
  }

  update(px, pz) {
    const cs = this.chunkSize;
    const ccx = Math.floor(px / cs), ccz = Math.floor(pz / cs);
    const needed = new Set();
    let built = false;
    for (let dz = -this.radius; dz <= this.radius; dz++) {
      for (let dx = -this.radius; dx <= this.radius; dx++) {
        if (dx * dx + dz * dz > (this.radius + 0.5) * (this.radius + 0.5)) continue;
        const cx = ccx + dx, cz = ccz + dz;
        const k = this.key(cx, cz);
        needed.add(k);
        if (!built && !this.chunks.has(k)) {
          this.chunks.set(k, this.buildChunk(cx, cz));
          built = true; // un chunk par frame max — mais la purge tourne quand même
        }
      }
    }
    const shared = Object.values(this.geoms);
    for (const [k, chunk] of this.chunks) {
      if (!needed.has(k)) {
        chunk.group.traverse((o) => {
          if (o.isInstancedMesh) o.dispose(); // libère instanceMatrix/instanceColor GPU
          if (o.geometry && !shared.includes(o.geometry)) o.geometry.dispose();
        });
        this.group.remove(chunk.group);
        this.chunks.delete(k);
      }
    }
  }

  setCycle(cy, camPos) {
    const u = this.terrainUniforms;
    u.uLightDir.value.copy(cy.sunDir);
    u.uLightColor.value.copy(cy.light);
    u.uLightI.value = cy.lightI;
    u.uHemiSky.value.copy(cy.hemiSky);
    u.uHemiGnd.value.copy(cy.hemiGnd);
    u.uFogColor.value.copy(cy.fog);
    u.uCamPos.value.copy(camPos);
  }
}
