// Post-process NUÉE — contours à l'encre (profondeur + laplacien), grain de papier discret
// Aucun bloom, aucun halo : uniquement des lignes et des aplats.
import * as THREE from '../lib/three.module.js';

const POST_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const POST_FRAG = /* glsl */`
  #include <packing>
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uResolution;
  uniform float uNear;
  uniform float uFar;
  uniform vec3 uInk;
  uniform float uTime;
  uniform float uGrain;
  varying vec2 vUv;

  float linearDepth(vec2 uv) {
    float z = texture2D(tDepth, uv).x;
    return -perspectiveDepthToViewZ(z, uNear, uFar);
  }

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 px = 1.0 / uResolution;
    vec3 col = texture2D(tColor, vUv).rgb;

    float dc = linearDepth(vUv);

    // trois rayons d'échantillonnage → trait d'encre gras (~4 px)
    float edge = 0.0;
    for (int k = 1; k <= 3; k++) {
      vec2 o = px * float(k) * 1.15;
      float dl = linearDepth(vUv - vec2(o.x, 0.0));
      float dr = linearDepth(vUv + vec2(o.x, 0.0));
      float dd = linearDepth(vUv - vec2(0.0, o.y));
      float du = linearDepth(vUv + vec2(0.0, o.y));
      // silhouettes : gradient de profondeur relatif
      float grad = max(abs(dr - dl), abs(du - dd));
      float silhouette = smoothstep(0.010 * dc + 0.35, 0.022 * dc + 0.9, grad);
      // plis internes : laplacien (concavités/arêtes) — proche uniquement
      float lap = abs(dl + dr + du + dd - 4.0 * dc);
      float crease = smoothstep(0.004 * dc + 0.12, 0.012 * dc + 0.45, lap)
                   * (1.0 - smoothstep(120.0, 420.0, dc));
      edge = max(edge, max(silhouette, crease * 0.75) * (k == 1 ? 1.0 : (k == 2 ? 0.92 : 0.8)));
    }
    // les lignes s'estompent au loin — couches d'illustration
    edge *= 1.0 - smoothstep(380.0, 850.0, dc);

    col = mix(col, uInk, edge * 0.9);

    // grain de papier — modulé par la luminance pour ne pas bruiter la nuit
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    float g = (hash(vUv * uResolution * 0.5 + vec2(uTime * 0.7, 0.0)) - 0.5) * uGrain;
    col += g * (0.25 + 0.75 * smoothstep(0.0, 0.35, lum));

    // conversion linéaire → sRGB (le canvas n'applique pas de transform aux ShaderMaterial)
    col = clamp(col, 0.0, 1.0);
    col = mix(col * 12.92, 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class InkPass {
  constructor(renderer, camera) {
    this.renderer = renderer;
    this.camera = camera;
    this.enabled = true;
    this.grain = 0.045;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    size.x = Math.max(1, size.x); size.y = Math.max(1, size.y);
    this.rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.rt.depthTexture = new THREE.DepthTexture(size.x, size.y);
    this.rt.depthTexture.type = THREE.UnsignedIntType;

    this.uniforms = {
      tColor: { value: this.rt.texture },
      tDepth: { value: this.rt.depthTexture },
      uResolution: { value: new THREE.Vector2(size.x, size.y) },
      uNear: { value: camera.near },
      uFar: { value: camera.far },
      uInk: { value: new THREE.Color(0x232833) },
      uTime: { value: 0 },
      uGrain: { value: this.grain },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      depthWrite: false,
      depthTest: false,
    });
    // triangle plein écran
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, -1, 0, 3, -1, 0, -1, 3, 0,
    ]), 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
      0, 0, 2, 0, 0, 2,
    ]), 2));
    this.quad = new THREE.Mesh(geom, mat);
    this.quad.frustumCulled = false;
    this.postScene = new THREE.Scene();
    this.postScene.add(this.quad);
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h) {
    w = Math.max(1, w); h = Math.max(1, h);
    this.rt.setSize(w, h);
    this.uniforms.uResolution.value.set(w, h);
  }

  render(scene, camera, t) {
    if (!this.enabled) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }
    this.uniforms.uTime.value = t % 64; // borné : le hash float32 dégénère sinon en longue session
    this.uniforms.uNear.value = camera.near;
    this.uniforms.uFar.value = camera.far;
    this.uniforms.uGrain.value = this.grain;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
  }
}
