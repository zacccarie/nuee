// L'esquif — pilotage à effet de sol, caméra épaule, coussin au relief
import * as THREE from '../lib/three.module.js';
import { heightAt } from './world.js';
import { clamp, lerp } from './noise.js';

function paintGeom(geom, hex, mul = 1) {
  const c = new THREE.Color(hex).multiplyScalar(mul);
  const n = geom.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geom;
}

export class Player {
  constructor(scene, camera, toonMat) {
    this.camera = camera;
    this.pos = new THREE.Vector3(0, 16, -540);
    this.vel = new THREE.Vector3();
    this.yaw = -Math.PI / 4; // face à la Cathédrale
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0;
    this.boost = 0;
    this.energy = 1;   // jauge de surrégime
    this.lift = 0;     // portance thermique (fournie par main)
    this.keys = {};
    this.locked = false;

    // — l'esquif, aplats posés sur primitives —
    this.craft = new THREE.Group();
    const hull = new THREE.Mesh(paintGeom(new THREE.CapsuleGeometry(0.7, 3.4, 4, 8), 0xe6ddc4), toonMat);
    hull.rotation.x = Math.PI / 2;
    hull.scale.set(1, 1, 0.55);
    this.craft.add(hull);
    const deck = new THREE.Mesh(paintGeom(new THREE.BoxGeometry(1.1, 0.18, 2.6), 0xd97a5c), toonMat);
    deck.position.y = 0.42;
    this.craft.add(deck);
    const canopy = new THREE.Mesh(paintGeom(new THREE.SphereGeometry(0.52, 10, 7), 0x55628e), toonMat);
    canopy.position.set(0, 0.55, 0.7);
    canopy.scale.set(1, 0.75, 1.35);
    this.craft.add(canopy);
    const finGeom = paintGeom(new THREE.BoxGeometry(2.9, 0.1, 1.0), 0xb7a8d4);
    const fin = new THREE.Mesh(finGeom, toonMat);
    fin.position.set(0, 0.1, -1.15);
    this.craft.add(fin);
    const tail = new THREE.Mesh(paintGeom(new THREE.BoxGeometry(0.1, 0.9, 0.8), 0xd97a5c), toonMat);
    tail.position.set(0, 0.55, -1.9);
    this.craft.add(tail);
    const skidGeom = paintGeom(new THREE.CylinderGeometry(0.09, 0.09, 2.6, 5), 0x8d84a0);
    for (const sx of [-0.75, 0.75]) {
      const skid = new THREE.Mesh(skidGeom, toonMat);
      skid.rotation.x = Math.PI / 2;
      skid.position.set(sx, -0.55, 0);
      this.craft.add(skid);
    }
    scene.add(this.craft);

    this.camTarget = new THREE.Vector3();
    this.tmpF = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.bindInput();
  }

  bindInput() {
    window.addEventListener('keydown', (e) => { this.keys[e.code] = true; });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0021;
      this.pitch -= e.movementY * 0.0017;
      this.pitch = clamp(this.pitch, -0.72, 0.62);
    });
  }

  get forward() {
    this.tmpF.set(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    return this.tmpF;
  }

  update(dt) {
    const k = this.keys;
    const fwd = this._fwd.copy(this.forward);

    // poussée — le surrégime consomme la jauge
    const boosting = (k['ShiftLeft'] || k['ShiftRight']) && k['KeyW'] && this.energy > 0.02;
    this.boost = lerp(this.boost, boosting ? 1 : 0, 1 - Math.exp(-4 * dt));
    const maxSpeed = 38 + this.boost * 52;
    let thrust = 0;
    if (k['KeyW']) thrust = 34 + this.boost * 60;
    if (k['KeyS']) thrust = -20;
    this.vel.addScaledVector(fwd, thrust * dt);
    // dérive latérale douce A/D
    const right = this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    if (k['KeyA']) this.vel.addScaledVector(right, -22 * dt);
    if (k['KeyD']) this.vel.addScaledVector(right, 22 * dt);
    // vertical
    if (k['Space']) this.vel.y += 30 * dt;
    if (k['KeyC'] || k['ControlLeft']) this.vel.y -= 30 * dt;
    // portance thermique — la colonne soulève l'esquif
    if (this.lift > 0) this.vel.y += 34 * this.lift * dt;

    // traînée
    const drag = 1 - Math.exp(-1.4 * dt);
    this.vel.multiplyScalar(1 - drag * 0.8);
    const sp = this.vel.length();
    if (sp > maxSpeed) this.vel.multiplyScalar(maxSpeed / sp);

    this.pos.addScaledVector(this.vel, dt);

    // coussin au relief
    const ground = heightAt(this.pos.x, this.pos.z);
    const minY = ground + 2.4;
    if (this.pos.y < minY) {
      this.pos.y = lerp(this.pos.y, minY, 1 - Math.exp(-12 * dt));
      if (this.pos.y < minY - 0.01) this.pos.y = minY;
      if (this.vel.y < 0) this.vel.y *= 0.2;
    }
    if (this.pos.y > 340) { this.pos.y = 340; this.vel.y = Math.min(this.vel.y, 0); }

    // orientation de l'esquif : cap + assiette + gîte dans les virages
    const targetRoll = clamp(-this.vel.dot(right) * 0.012, -0.5, 0.5);
    this.roll = lerp(this.roll, targetRoll, 1 - Math.exp(-5 * dt));
    this.euler.set(this.pitch * 0.7, this.yaw, this.roll);
    this.craft.quaternion.setFromEuler(this.euler);
    this.craft.position.copy(this.pos);
    this.craft.position.y += Math.sin(performance.now() * 0.002) * 0.06; // respiration au repos

    // caméra
    const camDist = 10 + sp * 0.05;
    const desired = this._desired.copy(this.pos).addScaledVector(fwd, -camDist);
    desired.y += 3.2 + this.pitch * -2.5;
    // la caméra ne passe pas sous le sol
    const camGround = heightAt(desired.x, desired.z) + 1.4;
    if (desired.y < camGround) desired.y = camGround;
    const kf = 1 - Math.exp(-7 * dt);
    this.camera.position.lerp(desired, kf);
    this.camTarget.copy(this.pos).addScaledVector(fwd, 14);
    this.camTarget.y += 1.1;
    this.camera.lookAt(this.camTarget);
    const targetFov = 62 + this.boost * 9;
    this.camera.fov = lerp(this.camera.fov, targetFov, 1 - Math.exp(-4 * dt));
    this.camera.updateProjectionMatrix();

    this.speed = sp;
    this.alt = this.pos.y - ground;
    this.heading = ((-this.yaw * 180 / Math.PI) % 360 + 360) % 360;

    // jauge : drain au surrégime, recharge en rase-mottes et dans les thermiques
    const drain = this.boost * 0.30;
    const recharge = 0.05 + (this.alt < 7 ? 0.26 : 0) + this.lift * 0.4;
    this.energy = clamp(this.energy + (recharge - drain) * dt, 0, 1);
  }

  // dérive contemplative pour l'écran d'accueil
  idleOrbit(t, dt) {
    // l'esquif reste posé dans le cadre, respiration lente
    this.euler.set(0, this.yaw, Math.sin(t * 0.4) * 0.02);
    this.craft.quaternion.setFromEuler(this.euler);
    this.craft.position.copy(this.pos);
    this.craft.position.y += Math.sin(t * 1.1) * 0.3;
    const r = 46;
    const a = t * 0.04;
    const cx = this.pos.x + Math.cos(a) * r;
    const cz = this.pos.z + Math.sin(a) * r;
    const desired = new THREE.Vector3(
      cx,
      Math.max(this.pos.y + 15, heightAt(cx, cz) + 9),
      cz
    );
    this.camera.position.lerp(desired, 1 - Math.exp(-1.2 * dt));
    this.camTarget.copy(this.pos).add(new THREE.Vector3(0, 3, 0));
    this.camera.lookAt(this.camTarget);
  }
}
