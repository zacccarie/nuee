// Thermiques — colonnes de spores ascendantes ; portance gratuite pour l'esquif
import * as THREE from '../lib/three.module.js';
import { mulberry32 } from './noise.js';
import { heightAt } from './world.js';

const CELL = 320;       // une cellule de grille = un thermique potentiel
const RATE = 0.70;      // seuil d'apparition
const RADIUS = 15;      // rayon d'influence
const HEIGHT = 150;     // hauteur de la colonne
const POOL = 8;

function cellHash(cx, cz) {
  return mulberry32(((cx * 73856093) ^ (cz * 19349663) ^ 7919) >>> 0);
}

// centres de thermiques dans un rayon autour d'un point (déterministe)
export function thermalCenters(px, pz, range = 1200) {
  const out = [];
  const c0x = Math.floor((px - range) / CELL), c1x = Math.floor((px + range) / CELL);
  const c0z = Math.floor((pz - range) / CELL), c1z = Math.floor((pz + range) / CELL);
  for (let cz = c0z; cz <= c1z; cz++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      const r = cellHash(cx, cz);
      if (r() < RATE) continue;
      const x = (cx + 0.15 + r() * 0.7) * CELL;
      const z = (cz + 0.15 + r() * 0.7) * CELL;
      const h = heightAt(x, z);
      if (h < -4 || h > 46) continue; // ni mer de nuages, ni mesa
      out.push({ x, z, h });
    }
  }
  return out;
}

export class Thermals {
  constructor(scene) {
    this.columns = [];
    // pastille ronde
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const cx = c.getContext('2d');
    cx.fillStyle = '#ffffff';
    cx.beginPath(); cx.arc(16, 16, 12, 0, Math.PI * 2); cx.fill();
    const sprite = new THREE.CanvasTexture(c);

    for (let i = 0; i < POOL; i++) {
      const n = 110;
      const pos = new Float32Array(n * 3);
      const seed = mulberry32(500 + i);
      for (let k = 0; k < n; k++) {
        const a = seed() * Math.PI * 2;
        const r = Math.sqrt(seed()) * (RADIUS - 4);
        pos[k * 3] = Math.cos(a) * r;
        pos[k * 3 + 1] = seed() * HEIGHT;
        pos[k * 3 + 2] = Math.sin(a) * r;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        color: 0xf0e8d4, size: 1.5, sizeAttenuation: true,
        map: sprite, alphaTest: 0.5, transparent: true, opacity: 0.55, depthWrite: false,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.visible = false;
      scene.add(pts);
      this.columns.push({ pts, center: null });
    }
    this.active = [];
    this.scanTimer = 0;
  }

  update(dt, t, playerPos, cy) {
    // le scan de la grille est throttlé — les centres bougent avec le joueur, pas avec le temps
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 0.8;
      this.active = thermalCenters(playerPos.x, playerPos.z, 900);
      this.active.sort((a, b) =>
        ((a.x - playerPos.x) ** 2 + (a.z - playerPos.z) ** 2) -
        ((b.x - playerPos.x) ** 2 + (b.z - playerPos.z) ** 2));
    }
    for (let i = 0; i < POOL; i++) {
      const col = this.columns[i];
      const c = this.active[i];
      if (!c) { col.pts.visible = false; col.center = null; continue; }
      col.center = c;
      col.pts.visible = true;
      col.pts.position.set(c.x, c.h, c.z);
      // ascension : boucle verticale
      const arr = col.pts.geometry.attributes.position.array;
      for (let k = 0; k < arr.length; k += 3) {
        arr[k + 1] += (14 + (k % 9)) * dt;
        if (arr[k + 1] > HEIGHT) arr[k + 1] -= HEIGHT;
        // léger tournoiement
        const a = 0.25 * dt;
        const x = arr[k], z = arr[k + 2];
        arr[k] = x * Math.cos(a) - z * Math.sin(a);
        arr[k + 2] = x * Math.sin(a) + z * Math.cos(a);
      }
      col.pts.geometry.attributes.position.needsUpdate = true;
      col.pts.material.color.copy(cy.night > 0.5 ? new THREE.Color(0xd88ab8) : new THREE.Color(0xf0e8d4));
    }
  }

  // portance 0..1 à une position donnée
  liftAt(pos) {
    for (const col of this.columns) {
      if (!col.center) continue;
      const c = col.center;
      const d = Math.hypot(pos.x - c.x, pos.z - c.z);
      if (d < RADIUS && pos.y < c.h + HEIGHT && pos.y > c.h - 4) {
        return 1 - (d / RADIUS) * 0.5;
      }
    }
    return 0;
  }
}
