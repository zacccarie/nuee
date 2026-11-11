// Mer de nuages — plan animé, bruit posterisé en trois tons, aucune lueur
import * as THREE from '../lib/three.module.js';
import { CLOUD_LEVEL } from './world.js';

const VERT = /* glsl */`
  varying vec3 vPosW;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */`
  uniform vec3 uBase;
  uniform vec3 uShadow;
  uniform vec3 uCrest;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uCamPos;
  uniform float uTime;
  varying vec3 vPosW;

  // bruit valeur 2D suffisant pour des volutes posterisées
  float hash21(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i), b = hash21(i + vec2(1, 0));
    float c = hash21(i + vec2(0, 1)), d = hash21(i + vec2(1, 1));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
      s += a * vnoise(p);
      p = p * 2.03 + vec2(17.3, -9.1);
      a *= 0.5;
    }
    return s;
  }

  void main() {
    // coordonnées repliées : le hash float32 dégénère à grande distance de l'origine
    vec2 p = mod(vPosW.xz, 8192.0) * 0.005;
    // déformation de domaine — volutes lentes
    vec2 warp = vec2(fbm(p * 0.9 + uTime * 0.008), fbm(p * 0.9 - uTime * 0.006));
    float n = fbm(p + warp * 1.4 + vec2(uTime * 0.004, 0.0));
    // trois tons posterisés
    vec3 col = uBase;
    col = mix(col, uShadow, smoothstep(0.40, 0.46, 1.0 - n));
    col = mix(col, uCrest, smoothstep(0.57, 0.62, n));
    float d = distance(vPosW, uCamPos);
    float fogF = smoothstep(uFogNear, uFogFar, d);
    col = mix(col, uFogColor, fogF);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class CloudSea {
  constructor(scene) {
    this.uniforms = {
      uBase: { value: new THREE.Color(0xf2ecd8) },
      uShadow: { value: new THREE.Color(0xd8d2e4) },
      uCrest: { value: new THREE.Color(0xfbf7ea) },
      uFogColor: { value: new THREE.Color(0xe4e0d0) },
      uFogNear: { value: 160 },
      uFogFar: { value: 920 },
      uCamPos: { value: new THREE.Vector3() },
      uTime: { value: 0 },
    };
    const geom = new THREE.PlaneGeometry(4200, 4200, 1, 1);
    geom.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.position.y = CLOUD_LEVEL;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(cy, camPos, t) {
    const u = this.uniforms;
    // teinte du jour : base = sea, ombre = cloudSh, crête = léger éclaircissement
    u.uBase.value.copy(cy.sea);
    u.uShadow.value.copy(cy.cloudSh);
    u.uCrest.value.copy(cy.sea).multiplyScalar(1.14);
    u.uFogColor.value.copy(cy.fog);
    u.uCamPos.value.copy(camPos);
    u.uTime.value = t;
    this.mesh.position.x = camPos.x;
    this.mesh.position.z = camPos.z;
  }
}
