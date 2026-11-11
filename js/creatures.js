// Créatures NUÉE — Porteurs (colosses migrateurs), Méduses célestes, spores dérivantes
// Réponse au signal : ondes de points lumineux (aplats nets, aucun halo) + appels
import * as THREE from '../lib/three.module.js';
import { Simplex2, mulberry32, clamp, lerp } from './noise.js';
import { heightAt, RING_RADIUS, makeToonMaterial } from './world.js';

const SN = new Simplex2(551);
const UP = new THREE.Vector3(0, 1, 0);

const DOT_OFF = new THREE.Color(0x4a4460);
const DOT_ON = new THREE.Color(0xd88ab8);
const DOT_HOT = new THREE.Color(0xf2e2c8);

// scratch partagés — zéro allocation dans les updates par frame
const _tan = new THREE.Vector3(), _lat = new THREE.Vector3();
const _aw = new THREE.Vector3(), _hip = new THREE.Vector3(), _seg = new THREE.Vector3();
const _side = new THREE.Vector3(), _knee = new THREE.Vector3();
const _headP = new THREE.Vector3(), _neckA = new THREE.Vector3();
const _M = new THREE.Matrix4(), _P = new THREE.Vector3(), _S1 = new THREE.Vector3(1, 1, 1);
const _C = new THREE.Color(), _QI = new THREE.Quaternion();
const DOT_DAY = new THREE.Color(0xf0e8d4);

// ————— géométrie utilitaire : cylindre orienté entre deux points —————
const _dir = new THREE.Vector3(), _mid = new THREE.Vector3(), _q = new THREE.Quaternion();
function orientSegment(mesh, a, b, thickness) {
  _dir.subVectors(b, a);
  const len = _dir.length();
  _mid.addVectors(a, b).multiplyScalar(0.5);
  mesh.position.copy(_mid);
  _q.setFromUnitVectors(UP, _dir.normalize());
  mesh.quaternion.copy(_q);
  mesh.scale.set(thickness, len, thickness);
}

function bumpySphere(rx, ry, rz, seed, bump = 0.16) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const s = new Simplex2(seed);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = 1 + s.fbm(v.x * 1.4, v.y * 1.4 + v.z, 2) * bump;
    v.multiplyScalar(n);
    pos.setXYZ(i, v.x * rx, v.y * ry, v.z * rz);
  }
  g.computeVertexNormals();
  // dégradé dos pâle / ventre mauve
  const col = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0xcfc9b4), belly = new THREE.Color(0x9a8bae);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const fy = clamp(pos.getY(i) / ry * 0.5 + 0.5, 0, 1);
    c.lerpColors(belly, top, fy > 0.42 ? 1 : 0); // deux aplats nets
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// ————— Porteur : colosse à quatre pattes sur l'Anneau —————
class Walker {
  constructor(scene, mat, angle, scale, seed) {
    this.scale = scale;
    this.angle = angle;
    this.speed = 3.0 / RING_RADIUS; // rad/s ~ 3 u/s
    this.group = new THREE.Group();
    scene.add(this.group);
    this.legLen1 = 23 * scale;
    this.legLen2 = 26 * scale;
    this.bodyH = 40 * scale;

    const rand = mulberry32(seed);
    this.body = new THREE.Mesh(bumpySphere(13 * scale, 8.5 * scale, 18 * scale, seed), mat);
    this.group.add(this.body);
    this.head = new THREE.Mesh(bumpySphere(4.4 * scale, 3.6 * scale, 5.2 * scale, seed + 5, 0.22), mat);
    this.group.add(this.head);
    this.neck = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 7), mat);
    this.neck.geometry = paintGrey(this.neck.geometry, 0xbfb8a4);
    this.group.add(this.neck);

    this.legs = [];
    const legGeom = paintGrey(new THREE.CylinderGeometry(1, 0.75, 1, 7), 0xbfb8a4);
    const footGeom = paintGrey(new THREE.BoxGeometry(2.6, 1.6, 3.4), 0x8d84a0);
    const attach = [
      new THREE.Vector3(-6.5, -3, 9), new THREE.Vector3(6.5, -3, 9),
      new THREE.Vector3(-6.5, -3, -9), new THREE.Vector3(6.5, -3, -9),
    ];
    const phases = [0, 0.5, 0.75, 0.25];
    for (let i = 0; i < 4; i++) {
      const upper = new THREE.Mesh(legGeom, mat);
      const lower = new THREE.Mesh(legGeom, mat);
      const foot = new THREE.Mesh(footGeom, mat);
      foot.scale.setScalar(scale);
      this.group.add(upper, lower, foot);
      this.legs.push({
        attach: attach[i].clone().multiplyScalar(scale),
        phase: phases[i],
        foot: new THREE.Vector3(), footStart: new THREE.Vector3(), footTarget: new THREE.Vector3(),
        swinging: false, upper, lower, footMesh: foot, init: false,
      });
    }

    // points dorsaux — onde lumineuse
    this.nDots = 30;
    this.dots = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.55 * scale, 6, 5),
      new THREE.MeshBasicMaterial(), this.nDots
    );
    this.dots.instanceColor = null;
    for (let i = 0; i < this.nDots; i++) this.dots.setColorAt(i, DOT_OFF);
    // les instances suivent le corps à travers le monde : pas de culling figé
    this.dots.frustumCulled = false;
    this.group.add(this.dots);

    this.pos = new THREE.Vector3();
    this.pulseT = -10; // temps depuis le déclenchement d'une onde
    this.pendingPulse = -1;
    this.gaitT = rand() * 4;
  }

  trigger(delay) { this.pendingPulse = delay; }

  update(dt, t, night) {
    this.angle += this.speed * dt;
    this.gaitT += dt;
    const r = RING_RADIUS;
    const cx = Math.cos(this.angle) * r, cz = Math.sin(this.angle) * r;
    const tangent = _tan.set(-Math.sin(this.angle), 0, Math.cos(this.angle));
    const lateral = _lat.set(Math.cos(this.angle + Math.PI / 2), 0, Math.sin(this.angle + Math.PI / 2));

    // pattes
    const T = 4.2; // période de marche
    const stride = 30 * this.scale;
    let footYSum = 0;
    for (const leg of this.legs) {
      const cyc = (this.gaitT / T + leg.phase) % 1;
      // point d'ancrage monde
      const aw = _aw.set(
        cx + leg.attach.x * lateral.x + tangent.x * leg.attach.z,
        0,
        cz + leg.attach.x * lateral.z + tangent.z * leg.attach.z
      );
      if (!leg.init) {
        leg.foot.set(aw.x, heightAt(aw.x, aw.z), aw.z);
        leg.init = true;
      }
      if (cyc < 0.32) {
        if (!leg.swinging) {
          leg.swinging = true;
          leg.footStart.copy(leg.foot);
          leg.footTarget.set(
            aw.x + tangent.x * stride * 0.6, 0, aw.z + tangent.z * stride * 0.6
          );
          leg.footTarget.y = heightAt(leg.footTarget.x, leg.footTarget.z);
        }
        const f = cyc / 0.32;
        leg.foot.lerpVectors(leg.footStart, leg.footTarget, f);
        leg.foot.y = lerp(leg.footStart.y, leg.footTarget.y, f) + Math.sin(f * Math.PI) * 5.5 * this.scale;
      } else {
        leg.swinging = false;
      }
      footYSum += leg.foot.y;
    }

    // corps
    const bodyY = footYSum / 4 + this.bodyH + Math.sin(this.gaitT * 1.5) * 0.8 * this.scale;
    this.pos.set(cx, bodyY, cz);
    this.body.position.copy(this.pos);
    this.body.quaternion.setFromAxisAngle(UP, -this.angle - Math.PI / 2);
    this.body.rotateX(Math.sin(this.gaitT * 1.5 + 1) * 0.02);

    // tête
    const headP = _headP.copy(this.pos).addScaledVector(tangent, 19 * this.scale);
    headP.y += -6 * this.scale + Math.sin(t * 0.7) * 1.2;
    this.head.position.copy(headP);
    this.head.quaternion.copy(this.body.quaternion);
    const neckA = _neckA.copy(this.pos).addScaledVector(tangent, 14 * this.scale);
    neckA.y += -1 * this.scale;
    orientSegment(this.neck, neckA, headP, 1.6 * this.scale);

    // IK jambes (isocèle approx.)
    for (const leg of this.legs) {
      const hip = _hip.copy(this.pos)
        .addScaledVector(tangent, leg.attach.z)
        .addScaledVector(lateral, leg.attach.x);
      hip.y += leg.attach.y;
      const seg = _seg.subVectors(leg.foot, hip);
      const d = Math.min(seg.length(), this.legLen1 + this.legLen2 - 0.5);
      const bendMag = Math.sqrt(Math.max(0, this.legLen1 * this.legLen1 - (d / 2) * (d / 2)));
      const side = _side.crossVectors(seg, tangent).normalize();
      if (side.lengthSq() < 0.01) side.set(1, 0, 0);
      const knee = _knee.copy(hip).addScaledVector(seg.normalize(), d / 2).addScaledVector(side, -bendMag * 0.85);
      knee.y += bendMag * 0.15;
      orientSegment(leg.upper, hip, knee, 1.5 * this.scale);
      orientSegment(leg.lower, knee, leg.foot, 1.05 * this.scale);
      leg.footMesh.position.copy(leg.foot);
      leg.footMesh.position.y += 0.8 * this.scale;
      leg.footMesh.quaternion.setFromAxisAngle(UP, -this.angle - Math.PI / 2);
    }

    // onde de points
    if (this.pendingPulse >= 0) {
      this.pendingPulse -= dt;
      if (this.pendingPulse < 0) this.pulseT = 0;
    }
    if (this.pulseT >= 0) this.pulseT += dt;
    // pulsation ambiante nocturne
    if (night > 0.5 && this.pulseT > 9) this.pulseT = 0;

    const M = _M, P = _P, Q2 = this.body.quaternion, Sc = _S1;
    const travel = this.pulseT >= 0 ? this.pulseT / 2.6 : -1; // l'onde parcourt le corps en ~2.6 s
    const C = _C;
    for (let i = 0; i < this.nDots; i++) {
      const f = i / (this.nDots - 1);
      // épine dorsale : arc tête → queue
      const lx = 0, ly = (6.0 + Math.sin(f * Math.PI) * 1.8) * this.scale, lz = (0.5 - f) * 32 * this.scale;
      P.set(lx, ly, lz).applyQuaternion(Q2).add(this.pos);
      M.compose(P, Q2, Sc);
      this.dots.setMatrixAt(i, M);
      let k = 0;
      if (travel >= 0 && travel < 1.4) {
        const dd = Math.abs((1 - f) - travel); // de la tête vers la queue
        k = Math.max(0, 1 - dd / 0.12);
      }
      C.copy(DOT_OFF);
      if (k > 0.02) C.lerpColors(DOT_ON, DOT_HOT, k).lerp(DOT_OFF, 1 - Math.min(1, k * 1.6));
      this.dots.setColorAt(i, C);
    }
    this.dots.instanceMatrix.needsUpdate = true;
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
  }
}

function paintGrey(geom, hex) {
  const c = new THREE.Color(hex);
  const n = geom.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geom;
}

// ————— Méduse céleste —————
class Medusa {
  constructor(scene, mat, seed) {
    const rand = mulberry32(seed);
    this.seed = seed;
    this.phase = rand() * Math.PI * 2;
    this.center = new THREE.Vector3((rand() - 0.5) * 1600, 0, (rand() - 0.5) * 1600);
    this.alt = 70 + rand() * 90;
    this.scale = 0.8 + rand() * 1.6;
    this.group = new THREE.Group();
    scene.add(this.group);

    // cloche — profil lathe, deux aplats
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI * 0.52;
      pts.push(new THREE.Vector2(Math.sin(a) * 6, Math.cos(a) * 4.4 - 1.2));
    }
    const bellGeom = new THREE.LatheGeometry(pts, 14);
    bellGeom.computeVertexNormals();
    paintGrey(bellGeom, 0xcdc2e4);
    this.bell = new THREE.Mesh(bellGeom, mat);
    this.bell.scale.setScalar(this.scale);
    this.group.add(this.bell);

    // tentacules — lignes fines
    this.tentacles = [];
    const tMat = new THREE.LineBasicMaterial({ color: 0x8d84b0, transparent: true, opacity: 0.9 });
    for (let i = 0; i < 6; i++) {
      const nPts = 9;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nPts * 3), 3));
      const line = new THREE.Line(geo, tMat);
      line.frustumCulled = false;
      this.group.add(line);
      this.tentacles.push({ line, a: (i / 6) * Math.PI * 2, nPts });
    }

    // anneau de points sous la cloche
    this.nDots = 12;
    this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42 * this.scale, 6, 5), new THREE.MeshBasicMaterial(), this.nDots);
    for (let i = 0; i < this.nDots; i++) this.dots.setColorAt(i, DOT_OFF);
    this.dots.frustumCulled = false;
    this.group.add(this.dots);

    this.pos = new THREE.Vector3();
    this.pulseT = -10;
    this.pendingPulse = -1;
  }

  trigger(delay) { this.pendingPulse = delay; }

  update(dt, t, night) {
    const s = this.scale;
    const drift = 0.018;
    this.pos.set(
      this.center.x + SN.fbm(t * drift + this.seed, this.seed * 3, 2) * 420,
      0,
      this.center.z + SN.fbm(this.seed * 7, t * drift - this.seed, 2) * 420
    );
    const ground = heightAt(this.pos.x, this.pos.z);
    this.pos.y = Math.max(ground + 40, 0) + this.alt * 0.6 + Math.sin(t * 0.22 + this.phase) * 9;

    const squash = 1 + Math.sin(t * 0.9 + this.phase) * 0.14;
    this.bell.position.copy(this.pos);
    this.bell.scale.set(s * (2 - squash) * 0.5 + s * 0.5, s * squash, s * (2 - squash) * 0.5 + s * 0.5);

    for (const tc of this.tentacles) {
      const arr = tc.line.geometry.attributes.position.array;
      const rim = 5.4 * s;
      const bx = Math.cos(tc.a) * rim, bz = Math.sin(tc.a) * rim;
      const len = 16 * s;
      for (let k = 0; k < tc.nPts; k++) {
        const f = k / (tc.nPts - 1);
        arr[k * 3] = this.pos.x + bx + Math.sin(t * 0.8 + f * 2.4 + tc.a * 2) * 2.2 * f * s;
        arr[k * 3 + 1] = this.pos.y - 1.5 * s - f * len;
        arr[k * 3 + 2] = this.pos.z + bz + Math.cos(t * 0.7 + f * 2.1 + tc.a * 2) * 2.2 * f * s;
      }
      tc.line.geometry.attributes.position.needsUpdate = true;
    }

    if (this.pendingPulse >= 0) {
      this.pendingPulse -= dt;
      if (this.pendingPulse < 0) this.pulseT = 0;
    }
    if (this.pulseT >= 0) this.pulseT += dt;
    if (night > 0.5 && this.pulseT > 12) this.pulseT = 0;

    const M = _M, P = _P, Q = _QI, Sc = _S1;
    const C = _C;
    const travel = this.pulseT >= 0 ? this.pulseT / 1.6 : -1;
    for (let i = 0; i < this.nDots; i++) {
      const a = (i / this.nDots) * Math.PI * 2;
      P.set(Math.cos(a) * 4.6 * s, -1.2 * s, Math.sin(a) * 4.6 * s).add(this.pos);
      M.compose(P, Q, Sc);
      this.dots.setMatrixAt(i, M);
      let k = 0;
      if (travel >= 0 && travel < 1.5) {
        const dd = Math.abs((i / this.nDots) - (travel % 1));
        k = Math.max(0, 1 - Math.min(dd, 1 - dd) / 0.14);
      }
      C.copy(DOT_OFF);
      if (k > 0.02) C.lerpColors(DOT_ON, DOT_HOT, k * 0.6).lerp(DOT_OFF, 1 - Math.min(1, k * 1.5));
      this.dots.setColorAt(i, C);
    }
    this.dots.instanceMatrix.needsUpdate = true;
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
  }
}

// ————— Raie céleste : vols en V, battement d'ailes plat —————
class MantaFlock {
  constructor(scene, mat, seed, n = 6) {
    const rand = mulberry32(seed);
    this.seed = seed;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.members = [];
    this.prevLeader = new THREE.Vector3();
    this.yaw = 0;

    // géométries partagées du vol
    const bodyGeom = paintGrey(new THREE.CapsuleGeometry(0.5, 2.0, 3, 7), 0xd8d2bc);
    bodyGeom.rotateX(Math.PI / 2);
    bodyGeom.scale(1.35, 0.42, 1);
    const wingR = paintGrey(new THREE.BoxGeometry(2.6, 0.07, 1.2), 0xcdc4a8);
    wingR.translate(1.3, 0, -0.1);
    const wingL = paintGrey(new THREE.BoxGeometry(2.6, 0.07, 1.2), 0xcdc4a8);
    wingL.translate(-1.3, 0, -0.1);
    const tail = paintGrey(new THREE.BoxGeometry(0.08, 0.5, 0.9), 0xb08ca0);
    tail.translate(0, 0.1, -1.6);

    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      const scale = 1.1 + rand() * 0.9;
      const body = new THREE.Mesh(bodyGeom, mat);
      const wl = new THREE.Mesh(wingL, mat);
      const wr = new THREE.Mesh(wingR, mat);
      const tl = new THREE.Mesh(tail, mat);
      g.add(body, wl, wr, tl);
      g.scale.setScalar(scale);
      this.group.add(g);
      const row = Math.ceil(i / 2);
      this.members.push({
        g, wl, wr,
        flapPhase: rand() * Math.PI * 2,
        offset: new THREE.Vector3((i % 2 ? 1 : -1) * row * 9, (rand() - 0.5) * 6, -row * 8),
        pos: new THREE.Vector3(), init: false,
      });
    }

    // points sous les ailes — réponse au signal
    this.nDots = n * 4;
    this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 6, 5), new THREE.MeshBasicMaterial(), this.nDots);
    for (let i = 0; i < this.nDots; i++) this.dots.setColorAt(i, DOT_OFF);
    this.dots.frustumCulled = false;
    this.group.add(this.dots);

    this.pos = new THREE.Vector3();
    this.pulseT = -10;
    this.pendingPulse = -1;
  }

  trigger(delay) { this.pendingPulse = delay; }

  update(dt, t, night) {
    // trajectoire du meneur : dérive lente sur bruit
    const drift = 0.016;
    const lx = SN.fbm(t * drift + this.seed, this.seed * 5, 2) * 950;
    const lz = SN.fbm(this.seed * 9, t * drift - this.seed * 2, 2) * 950;
    const ground = heightAt(lx, lz);
    const ly = Math.max(ground + 30, -2) + 42 + Math.sin(t * 0.3 + this.seed) * 8;
    this.pos.set(lx, ly, lz);

    // cap du vol
    const dx = lx - this.prevLeader.x, dz = lz - this.prevLeader.z;
    if (dx * dx + dz * dz > 1e-6) this.yaw = Math.atan2(dx, dz);
    this.prevLeader.set(lx, ly, lz);

    const cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
    let di = 0;
    const travel = this.pulseT >= 0 ? this.pulseT / 1.4 : -1;
    for (let i = 0; i < this.members.length; i++) {
      const m = this.members[i];
      // offset de formation tourné selon le cap
      const ox = m.offset.x * cosY + m.offset.z * sinY;
      const oz = -m.offset.x * sinY + m.offset.z * cosY;
      _P.set(lx + ox, ly + m.offset.y + Math.sin(t * 0.7 + i * 1.3) * 2.5, lz + oz);
      if (!m.init) { m.pos.copy(_P); m.init = true; }
      m.pos.lerp(_P, 1 - Math.exp(-1.4 * dt));
      m.g.position.copy(m.pos);
      m.g.rotation.set(0, this.yaw, 0);
      // battement : rotation des ailes en opposition
      const flap = Math.sin(t * 2.8 + m.flapPhase) * 0.55;
      m.wl.rotation.z = -flap;
      m.wr.rotation.z = flap;

      // points sous les ailes
      for (let k = 0; k < 4; k++) {
        const wx = (k < 2 ? -1 : 1) * (0.9 + (k % 2) * 1.2);
        _P.set(wx, -0.25, 0.2 - (k % 2) * 0.6).applyEuler(m.g.rotation).multiplyScalar(m.g.scale.x).add(m.pos);
        _M.compose(_P, _QI, _S1);
        this.dots.setMatrixAt(di, _M);
        let kk = 0;
        if (travel >= 0 && travel < 1.4) {
          const f = i / this.members.length;
          const dd = Math.abs(f - (travel % 1));
          kk = Math.max(0, 1 - Math.min(dd, 1 - dd) / 0.2);
        }
        _C.copy(DOT_OFF);
        if (kk > 0.02) _C.lerpColors(DOT_ON, DOT_HOT, kk * 0.7).lerp(DOT_OFF, 1 - Math.min(1, kk * 1.5));
        this.dots.setColorAt(di, _C);
        di++;
      }
    }
    this.dots.instanceMatrix.needsUpdate = true;
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;

    if (this.pendingPulse >= 0) {
      this.pendingPulse -= dt;
      if (this.pendingPulse < 0) this.pulseT = 0;
    }
    if (this.pulseT >= 0) this.pulseT += dt;
    if (night > 0.5 && this.pulseT > 10) this.pulseT = 0;
  }
}

// ————— l'anneau du signal —————
class PingRing {
  constructor(scene) {
    this.n = 72;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.n * 3), 3));
    this.mat = new THREE.LineBasicMaterial({ color: 0xf2e2c8, transparent: true, opacity: 0 });
    this.line = new THREE.LineLoop(geo, this.mat);
    this.line.frustumCulled = false;
    scene.add(this.line);
    this.active = false;
    this.origin = new THREE.Vector3();
    this.r = 0;
  }

  fire(origin) {
    this.origin.copy(origin);
    this.r = 2;
    this.active = true;
  }

  update(dt) {
    if (!this.active) return;
    this.r += 130 * dt;
    if (this.r > 420) { this.active = false; this.mat.opacity = 0; return; }
    this.mat.opacity = 0.85 * (1 - this.r / 420);
    const arr = this.line.geometry.attributes.position.array;
    for (let i = 0; i < this.n; i++) {
      const a = (i / this.n) * Math.PI * 2;
      const x = this.origin.x + Math.cos(a) * this.r;
      const z = this.origin.z + Math.sin(a) * this.r;
      arr[i * 3] = x;
      arr[i * 3 + 1] = heightAt(x, z) + 1.2;
      arr[i * 3 + 2] = z;
    }
    this.line.geometry.attributes.position.needsUpdate = true;
  }
}

// ————— spores —————
class Spores {
  constructor(scene) {
    this.n = 1400;
    this.range = 300;
    const pos = new Float32Array(this.n * 3);
    for (let i = 0; i < this.n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 600;
      pos[i * 3 + 1] = Math.random() * 220 - 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 600;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // pastille ronde nette (aplat, bord franc)
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const cx = c.getContext('2d');
    cx.fillStyle = '#ffffff';
    cx.beginPath(); cx.arc(16, 16, 13, 0, Math.PI * 2); cx.fill();
    const sprite = new THREE.CanvasTexture(c);
    this.mat = new THREE.PointsMaterial({
      color: 0xf0e8d4, size: 1.4, sizeAttenuation: true,
      map: sprite, alphaTest: 0.5, transparent: true, opacity: 0.75, depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt, t, playerPos, cy) {
    const arr = this.points.geometry.attributes.position.array;
    const R = this.range;
    for (let i = 0; i < this.n; i++) {
      arr[i * 3] += Math.sin(t * 0.3 + i) * 0.6 * dt;
      arr[i * 3 + 1] += (0.8 + Math.sin(t * 0.2 + i * 1.7) * 0.5) * dt;
      arr[i * 3 + 2] += Math.cos(t * 0.24 + i * 0.7) * 0.6 * dt;
      // enveloppe autour du joueur
      for (let a = 0; a < 3; a++) {
        const pc = a === 1 ? 0 : (a === 0 ? playerPos.x : playerPos.z);
        let v = arr[i * 3 + a] - pc;
        const lim = a === 1 ? 140 : R;
        if (v > lim) v -= lim * 2; else if (v < -lim) v += lim * 2;
        arr[i * 3 + a] = v + pc;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.mat.color.copy(cy.night > 0.5 ? DOT_ON : DOT_DAY);
    this.mat.opacity = 0.45 + cy.night * 0.3;
  }
}

// ————— gestionnaire —————
export class Creatures {
  constructor(scene) {
    this.toonMat = makeToonMaterial();
    this.walkers = [];
    for (let i = 0; i < 4; i++) {
      this.walkers.push(new Walker(scene, this.toonMat, (i / 4) * Math.PI * 2 + i * 0.22, 0.8 + i * 0.13, 100 + i * 17));
    }
    this.medusae = [];
    for (let i = 0; i < 10; i++) this.medusae.push(new Medusa(scene, this.toonMat, 300 + i * 31));
    this.mantas = [];
    for (let i = 0; i < 3; i++) this.mantas.push(new MantaFlock(scene, this.toonMat, 700 + i * 53, 5 + i));
    this.spores = new Spores(scene);
    this.ring = new PingRing(scene);
  }

  // renvoie la liste des réponses { type, delay } pour l'audio
  ping(origin) {
    this.ring.fire(origin);
    const answers = [];
    for (const w of this.walkers) {
      const d = w.pos.distanceTo(origin);
      if (d < 900) {
        const delay = d / 130 + 0.3;
        w.trigger(delay);
        answers.push({ type: 'walker', delay: delay + 0.4, dist: d });
      }
    }
    for (const m of this.medusae) {
      const d = m.pos.distanceTo(origin);
      if (d < 600) {
        const delay = d / 130 + 0.2;
        m.trigger(delay);
        answers.push({ type: 'medusa', delay: delay + 0.3, dist: d });
      }
    }
    for (const f of this.mantas) {
      const d = f.pos.distanceTo(origin);
      if (d < 700) {
        const delay = d / 130 + 0.2;
        f.trigger(delay);
        answers.push({ type: 'manta', delay: delay + 0.25, dist: d });
      }
    }
    return answers;
  }

  update(dt, t, playerPos, cy) {
    for (const w of this.walkers) w.update(dt, t, cy.night);
    for (const m of this.medusae) m.update(dt, t, cy.night);
    for (const f of this.mantas) f.update(dt, t, cy.night);
    this.spores.update(dt, t, playerPos, cy);
    this.ring.update(dt);
  }
}
