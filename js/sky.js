// Ciel NUÉE — dôme en gradient d'aplats, soleil/lune en disque net, étoiles, nuages plats
import * as THREE from '../lib/three.module.js';
import { mulberry32 } from './noise.js';

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w * 0.99999; // toujours au fond
  }
`;

const SKY_FRAG = /* glsl */`
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uHor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uSunSize;
  uniform float uStars;
  uniform float uPlanetAmt;
  varying vec3 vDir;

  float hash21(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  void main() {
    vec3 d = normalize(vDir);
    float y = clamp(d.y, -0.12, 1.0);
    // gradient en deux segments — aplat d'illustration
    vec3 col = mix(uHor, uMid, smoothstep(-0.02, 0.22, y));
    col = mix(col, uTop, smoothstep(0.18, 0.62, y));

    // planète baguée à l'horizon — aplat, bandes plates, aucun halo
    vec3 pDir = normalize(vec3(-0.62, 0.20, -0.76));
    float pd = dot(d, pDir);
    float pIn = smoothstep(0.99585, 0.99615, pd);
    if (pIn > 0.001) {
      float band = mod(floor((d.y - pDir.y) * 42.0), 2.0);
      vec3 pc = band < 0.5 ? vec3(0.735, 0.70, 0.83) : vec3(0.62, 0.575, 0.745);
      // calotte polaire claire
      if ((d.y - pDir.y) > 0.052) pc = vec3(0.82, 0.80, 0.87);
      col = mix(col, pc, pIn * uPlanetAmt);
    }

    // disque solaire net, sans halo
    float ang = dot(d, normalize(uSunDir));
    float disc = smoothstep(1.0 - uSunSize * uSunSize * 2.2 - 0.0006, 1.0 - uSunSize * uSunSize * 2.2 + 0.0006, ang);
    col = mix(col, uSunColor, disc);

    // étoiles : points nets sur grille hachée
    if (uStars > 0.001 && d.y > 0.02) {
      vec2 sp = d.xz / (d.y + 0.35) * 38.0;
      vec2 cell = floor(sp);
      vec2 f = fract(sp);
      float h = hash21(cell);
      if (h > 0.93) {
        vec2 sc = vec2(fract(h * 71.3), fract(h * 137.7)) * 0.6 + 0.2;
        float dist = length(f - sc);
        float star = 1.0 - smoothstep(0.03, 0.055, dist);
        float tw = 0.75 + 0.25 * fract(h * 913.1);
        col = mix(col, vec3(0.93, 0.92, 0.88), star * tw * uStars * smoothstep(0.02, 0.2, d.y));
      }
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uTop: { value: new THREE.Color(0x7d8fc0) },
      uMid: { value: new THREE.Color(0xaebad8) },
      uHor: { value: new THREE.Color(0xece5d2) },
      uSunColor: { value: new THREE.Color(0xfffbe8) },
      uSunDir: { value: new THREE.Vector3(0.5, 0.5, 0) },
      uSunSize: { value: 0.02 },
      uStars: { value: 0 },
      uPlanetAmt: { value: 0.3 },
    };
    const geom = new THREE.SphereGeometry(2600, 32, 16);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);

    this.buildFlatClouds(scene);
  }

  // Nuages plats — silhouettes cumulus dessinées sur canvas, aplat + ombre plate
  buildFlatClouds(scene) {
    const rand = mulberry32(808);
    this.cloudMats = [];
    this.clouds = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const tex = this.cloudTexture(rand);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, alphaTest: 0.45,
        depthWrite: false, fog: false, side: THREE.DoubleSide,
      });
      this.cloudMats.push(mat);
      const w = 420 + rand() * 520;
      const geom = new THREE.PlaneGeometry(w, w * 0.38);
      const m = new THREE.Mesh(geom, mat);
      const a = rand() * Math.PI * 2;
      const r = 1350 + rand() * 750;
      m.position.set(Math.cos(a) * r, 190 + rand() * 260, Math.sin(a) * r);
      m.userData.baseAngle = a;
      m.userData.radius = r;
      m.userData.speed = 0.0016 + rand() * 0.0022;
      m.renderOrder = -5;
      this.clouds.add(m);
    }
    scene.add(this.clouds);
  }

  cloudTexture(rand) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 200;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 512, 200);
    const blobs = [];
    const n = 7 + (rand() * 5) | 0;
    for (let i = 0; i < n; i++) {
      blobs.push({
        x: 70 + rand() * 372,
        y: 120 + rand() * 30,
        r: 26 + rand() * 52,
      });
    }
    // silhouette aplat crème
    ctx.fillStyle = '#f4efdf';
    for (const b of blobs) {
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, Math.PI, 0); ctx.fill();
      ctx.fillRect(b.x - b.r, b.y, b.r * 2, 8);
    }
    // base plate
    ctx.fillStyle = '#f4efdf';
    ctx.fillRect(60, 120, 392, 14);
    // ombre plate sous la base — un seul aplat, pas de dégradé
    ctx.fillStyle = '#cfc6dd';
    ctx.fillRect(60, 128, 392, 7);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  update(cy, camPos, t) {
    const u = this.uniforms;
    u.uTop.value.copy(cy.skyTop);
    u.uMid.value.copy(cy.skyMid);
    u.uHor.value.copy(cy.skyHor);
    u.uSunColor.value.copy(cy.sun);
    u.uSunDir.value.copy(cy.sunDir);
    u.uSunSize.value = cy.sunSize;
    u.uStars.value = cy.stars;
    u.uPlanetAmt.value = 0.28 + cy.stars * 0.35;
    this.mesh.position.copy(camPos);
    this.clouds.position.set(camPos.x, 0, camPos.z);
    for (const m of this.clouds.children) {
      const a = m.userData.baseAngle + t * m.userData.speed;
      m.position.x = Math.cos(a) * m.userData.radius;
      m.position.z = Math.sin(a) * m.userData.radius;
      // billboard horizontal : face à la caméra, sans basculer
      m.lookAt(camPos.x, m.position.y, camPos.z);
    }
    for (const mat of this.cloudMats) mat.color.copy(cy.cloud);
  }
}
