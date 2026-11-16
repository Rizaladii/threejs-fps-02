// Grenades: thrown projectiles with a ballistic arc and a bounce, then a fuse.
// Ember Charge explodes (radius damage, blocked by walls); Veil Smoke blooms into a
// sphere that blocks bot line-of-sight for its duration. No assets, meshes only.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { GRENADES } from './weapons.js';
import { segmentHitsBox } from './map.js';

const GRAVITY = 12;
const BOUNCE = 0.38;

export function createGrenades(scene, colliders) {
  const projectiles = [];
  const smokes = [];
  const group = new THREE.Group();
  scene.add(group);

  const heMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.danger), roughness: 0.5, metalness: 0.3 });
  const smokeMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.smoke), roughness: 1, metalness: 0 });
  const heGeometry = new THREE.SphereGeometry(0.09, 10, 8);
  const smokeGeometry = new THREE.SphereGeometry(1, 18, 12);

  function throwGrenade(kind, from, direction, speed = 11) {
    const def = GRENADES[kind];
    if (!def) return null;
    const mesh = new THREE.Mesh(heGeometry, kind === 'ember' ? heMaterial : smokeMaterial);
    mesh.position.copy(from);
    mesh.castShadow = true;
    group.add(mesh);
    const projectile = {
      kind, def, mesh,
      velocity: new THREE.Vector3(direction.x * speed, direction.y * speed + 2.2, direction.z * speed),
      fuse: def.fuse,
      exploded: false,
    };
    projectiles.push(projectile);
    return projectile;
  }

  // AABB point probe for the bouncing projectile (radius 0.09, negligible).
  function blocked(x, y, z) {
    for (const box of colliders) {
      if (x >= box.min.x && x <= box.max.x && y >= box.min.y && y <= box.max.y && z >= box.min.z && z <= box.max.z) return box;
    }
    return null;
  }

  // onExplode(kind, position, def) is called once per detonation; main.js applies
  // damage and effects. Returns nothing; step is pure simulation plus meshes.
  function step(dt, onExplode) {
    for (let i = projectiles.length - 1; i >= 0; i -= 1) {
      const p = projectiles[i];
      p.velocity.y -= GRAVITY * dt;
      const next = p.mesh.position.clone().addScaledVector(p.velocity, dt);
      const hit = blocked(next.x, next.y, next.z);
      if (hit) {
        // Bounce off the face the projectile crossed: reverse the dominant axis.
        const px = p.mesh.position;
        const dx = Math.min(Math.abs(next.x - hit.min.x), Math.abs(next.x - hit.max.x));
        const dy = Math.min(Math.abs(next.y - hit.min.y), Math.abs(next.y - hit.max.y));
        const dz = Math.min(Math.abs(next.z - hit.min.z), Math.abs(next.z - hit.max.z));
        if (dx <= dy && dx <= dz) p.velocity.x *= -BOUNCE;
        else if (dy <= dz) p.velocity.y *= -BOUNCE;
        else p.velocity.z *= -BOUNCE;
        p.velocity.multiplyScalar(0.7);
        next.copy(px);
      }
      if (next.y < 0.09) {
        next.y = 0.09;
        p.velocity.y = Math.abs(p.velocity.y) * BOUNCE;
        p.velocity.x *= 0.8;
        p.velocity.z *= 0.8;
      }
      p.mesh.position.copy(next);
      p.fuse -= dt;
      if (p.fuse <= 0) {
        group.remove(p.mesh);
        projectiles.splice(i, 1);
        if (p.kind === 'veil') {
          const mesh = new THREE.Mesh(smokeGeometry, new THREE.MeshStandardMaterial({
            color: new THREE.Color(PALETTE.smoke), roughness: 1, transparent: true, opacity: 0.5, depthWrite: false,
          }));
          mesh.position.copy(next);
          mesh.position.y = Math.max(1.2, next.y);
          mesh.scale.setScalar(0.4);
          group.add(mesh);
          smokes.push({ x: mesh.position.x, y: mesh.position.y, z: mesh.position.z, r: p.def.radius, left: p.def.duration, mesh, growing: true });
        }
        onExplode(p.kind, next, p.def);
      }
    }
    for (let i = smokes.length - 1; i >= 0; i -= 1) {
      const smoke = smokes[i];
      smoke.left -= dt;
      const target = smoke.growing ? Math.min(1, smoke.mesh.scale.x + dt * 1.4) : 1;
      smoke.mesh.scale.setScalar(target);
      if (target >= 1) smoke.growing = false;
      smoke.mesh.material.opacity = Math.min(0.5, smoke.left * 0.15);
      if (smoke.left <= 0) {
        group.remove(smoke.mesh);
        smokes.splice(i, 1);
      }
    }
  }

  function clear() {
    for (const p of projectiles) group.remove(p.mesh);
    for (const s of smokes) group.remove(s.mesh);
    projectiles.length = 0;
    smokes.length = 0;
  }

  return {
    throwGrenade,
    step,
    clear,
    smokes,
    // Smoke spheres for map.lineOfSight.
    smokeSpheres() {
      return smokes.map((s) => ({ x: s.x, y: s.y, z: s.z, r: s.r * s.mesh.scale.x }));
    },
  };
}
