// Palette NUÉE — aplats Moebius, cycle du jour en keyframes interpolées
import * as THREE from '../lib/three.module.js';
import { smoothstep, lerp } from './noise.js';

export const INK = new THREE.Color(0x232833);

// Couleurs de terrain (sRGB hex → converties linéaire par THREE.Color)
export const TERRAIN = {
  cliff:      0x8891b0,
  cliffDark:  0x707a9c,
  cliffRose:  0xa79ab2,
  shore:      0xd9cba6,
  sage:       0x9db487,
  moss:       0x6fa392,
  coral:      0xdd8a68,
  lavender:   0xb9aed6,
  highland:   0xa49ac4,
  mesaTop:    0xb8c09a,
  deep:       0x3f6a63,
  pine:       0x2f4f45,
  // désert minéral
  sand:       0xdfc394,
  ochre:      0xd39a6a,
  sandRose:   0xc98a80,
  // forêt fongique
  fungal:     0x4a6b60,
  fungalMoss: 0x7a6a9e,
  fungalPale: 0xd8d2b0,
  // champ de coraux
  coralBed:   0xd8b4a8,
  coralRust:  0xc06a52,
  // lande lavande
  moor:       0xafa6cc,
  moorRock:   0x8e8aa8,
  // vasière
  marsh:      0x635a78,
  marshMint:  0xb8d8c4,
};

export const PROPS = {
  capTeal:    0x6fa392,
  capCoral:   0xdd8a68,
  capRose:    0xc98d9e,
  capCream:   0xe3d9b8,
  capViolet:  0x9a7fae,
  bulb:       0xc9d67a,
  bulbPale:   0xdde3a8,
  coralPink:  0xe0907a,
  coralOrange:0xdf9a5c,
  coralGreen: 0xa8c47f,
  crystal:    0xb7a8d4,
  crystalPale:0xcdc2e4,
  tuft:       0x8fae7f,
  tuftLav:    0xa89cc8,
  tuftRose:   0xcc9a94,
  stone:      0x9aa0b8,
  fern:       0x7fae74,
  fernTeal:   0x6a9e8e,
  reed:       0xc4bc8e,
  pipes:      0x9ab48e,
  pipesRose:  0xc49a8e,
  menhir:     0x9a94b0,
  anemone:    0xe0a0b4,
  anemonePale:0xd8c4e0,
  bellflower: 0xd8a0c0,
  palm:       0x8fae7f,
};

// ————— cycle du jour —————
// t ∈ [0,1) : 0 aube, 0.18 jour, 0.42 or, 0.52 crépuscule, 0.62 nuit, 0.92 fin de nuit
const KEYS = [
  { t: 0.00, skyTop: 0x9187b8, skyMid: 0xc9a9b4, skyHor: 0xf0d9b4, fog: 0xe9d6b8,
    light: 0xffe3c0, lightI: 0.85, hemiSky: 0xc0b4d8, hemiGnd: 0x8a8474,
    sun: 0xfff0d0, sunSize: 0.028, stars: 0.0, cloud: 0xf2e4cc, cloudSh: 0xd4bcc4, sea: 0xefe4cc },
  { t: 0.18, skyTop: 0x7d8fc0, skyMid: 0xaebad8, skyHor: 0xece5d2, fog: 0xe4e0d0,
    light: 0xfff6e4, lightI: 1.0, hemiSky: 0xbcc6e0, hemiGnd: 0x94907c,
    sun: 0xfffbe8, sunSize: 0.02, stars: 0.0, cloud: 0xf6f1e2, cloudSh: 0xd8d2e4, sea: 0xf2ecd8 },
  { t: 0.42, skyTop: 0x8380b4, skyMid: 0xc493a8, skyHor: 0xf0c491, fog: 0xecc9a0,
    light: 0xffddb0, lightI: 0.9, hemiSky: 0xbaa8cc, hemiGnd: 0x8c8270,
    sun: 0xffe8c4, sunSize: 0.03, stars: 0.0, cloud: 0xf4e0c8, cloudSh: 0xd0b4c8, sea: 0xf0e0c4 },
  { t: 0.52, skyTop: 0x655f96, skyMid: 0xb27795, skyHor: 0xe8a878, fog: 0xd3a48c,
    light: 0xffc890, lightI: 0.62, hemiSky: 0x9c8cc0, hemiGnd: 0x746a64,
    sun: 0xffd8a0, sunSize: 0.038, stars: 0.12, cloud: 0xe4c4b4, cloudSh: 0xb494ac, sea: 0xe0c8ac },
  { t: 0.62, skyTop: 0x10142a, skyMid: 0x232a4d, skyHor: 0x3a4470, fog: 0x2e3450,
    light: 0x8c94c8, lightI: 0.32, hemiSky: 0x3c4470, hemiGnd: 0x252838,
    sun: 0xd8d4e8, sunSize: 0.024, stars: 1.0, cloud: 0x394064, cloudSh: 0x272c48, sea: 0x2c3152 },
  { t: 0.92, skyTop: 0x151936, skyMid: 0x2c3258, skyHor: 0x4a4a74, fog: 0x363a58,
    light: 0x9a9ecc, lightI: 0.36, hemiSky: 0x444c78, hemiGnd: 0x2a2c3c,
    sun: 0xd8d4e8, sunSize: 0.024, stars: 0.85, cloud: 0x404668, cloudSh: 0x2c3050, sea: 0x323758 },
];

const _c = {}; // couleurs de travail réutilisées
for (const k of ['skyTop','skyMid','skyHor','fog','light','hemiSky','hemiGnd','sun','cloud','cloudSh','sea'])
  _c[k] = [new THREE.Color(), new THREE.Color()];

export class DayCycle {
  constructor() {
    this.t = 0.10; // départ : matin
    this.length = 480; // secondes pour un cycle complet
    this.out = {
      skyTop: new THREE.Color(), skyMid: new THREE.Color(), skyHor: new THREE.Color(),
      fog: new THREE.Color(), light: new THREE.Color(), hemiSky: new THREE.Color(),
      hemiGnd: new THREE.Color(), sun: new THREE.Color(), cloud: new THREE.Color(),
      cloudSh: new THREE.Color(), sea: new THREE.Color(),
      lightI: 1, sunSize: 0.02, stars: 0, sunDir: new THREE.Vector3(),
      night: 0,
    };
  }

  advance(dt, scale = 1) {
    this.t = (this.t + (dt * scale) / this.length) % 1;
    this.eval();
  }

  eval() {
    const t = this.t;
    let a = KEYS[KEYS.length - 1], b = KEYS[0], ta = a.t - 1, tb = b.t;
    for (let i = 0; i < KEYS.length; i++) {
      const k = KEYS[i], next = KEYS[(i + 1) % KEYS.length];
      const tn = i + 1 < KEYS.length ? next.t : next.t + 1;
      if (t >= k.t && t < tn) { a = k; b = next; ta = k.t; tb = tn; break; }
    }
    const f = smoothstep(0, 1, (t - ta) / (tb - ta));
    const o = this.out;
    for (const key of ['skyTop','skyMid','skyHor','fog','light','hemiSky','hemiGnd','sun','cloud','cloudSh','sea']) {
      _c[key][0].setHex(a[key]); _c[key][1].setHex(b[key]);
      o[key].lerpColors(_c[key][0], _c[key][1], f);
    }
    o.lightI = lerp(a.lightI, b.lightI, f);
    o.sunSize = lerp(a.sunSize, b.sunSize, f);
    o.stars = lerp(a.stars, b.stars, f);
    o.night = smoothstep(0.54, 0.62, t) * (1 - smoothstep(0.92, 1.0, t));

    // course du soleil : lever à l'est (t=0), zénith sud (t≈0.3), coucher ouest (t≈0.58)
    const sunA = (t / 0.6) * Math.PI; // azimut/élévation sur la portion jour
    const el = Math.sin(Math.min(sunA, Math.PI)) * 0.9 + 0.06;
    const az = -Math.PI * 0.25 + (t / 0.6) * Math.PI * 1.4;
    if (t < 0.62) {
      o.sunDir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize();
    } else {
      // lune : arc opposé, bas sur l'horizon
      const nt = (t - 0.62) / 0.38;
      const naz = Math.PI * 0.7 - nt * Math.PI * 1.1;
      const nel = 0.35 + Math.sin(nt * Math.PI) * 0.3;
      o.sunDir.set(Math.cos(naz) * Math.cos(nel), Math.sin(nel), Math.sin(naz) * Math.cos(nel)).normalize();
    }
  }
}
