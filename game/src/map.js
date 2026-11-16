// FOUNDRY: an original industrial map, 40 x 30 m. Attackers spawn south, defenders
// north; the Kiln bombsite sits at the north end. Two lanes (Furnace Lane west, Crane
// Lane east) and a mid floor around a central furnace block the sightlines. Every box
// is a collider for movement and a surface a bullet stops on. Waypoints form the graph
// bots route over; segment tests here answer line-of-sight for them.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint nodes: [x, z, neighbours by index]. Lanes west/east, mid connectors,
// site approaches, site, defender spawn.
const WAYPOINTS = [
  [-2, 12, [1, 10, 2]], // 0 attacker spawn west
  [2, 12, [0, 11, 6]], // 1 attacker spawn east
  [-14, 10, [0, 3]], // 2 furnace lane south
  [-14, 4, [2, 4, 12]], // 3 furnace lane
  [-14, -2, [3, 5, 14]], // 4 furnace lane
  [-14, -8, [4, 17]], // 5 furnace lane north
  [14, 10, [1, 7]], // 6 crane lane south
  [14, 4, [6, 8, 13]], // 7 crane lane
  [14, -2, [7, 9, 15]], // 8 crane lane
  [14, -8, [8, 18]], // 9 crane lane north
  [-4, 8, [0, 11, 12]], // 10 mid south west
  [4, 8, [1, 10, 13]], // 11 mid south east
  [-4, 2, [10, 13, 3, 14]], // 12 mid west
  [4, 2, [11, 12, 7, 15]], // 13 mid east
  [-4, -4, [12, 15, 4, 16]], // 14 mid north west
  [4, -4, [13, 14, 8, 16]], // 15 mid north east
  [0, -8, [14, 15, 17, 18]], // 16 site front
  [-3, -11, [5, 16, 19]], // 17 site west
  [3, -11, [9, 16, 19]], // 18 site east
  [0, -12, [17, 18]], // 19 plant spot
  [-10, -13, [17, 22]], // 20 defender spawn west
  [10, -13, [18, 22]], // 21 defender spawn east
  [0, -14, [20, 21, 19]], // 22 defender spawn mid
];

export function segmentHitsBox(a, b, box) {
  // Slab test: true when the segment a->b touches the AABB.
  const dir = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  let tmin = 0;
  let tmax = 1;
  const axes = ['x', 'y', 'z'];
  for (const axis of axes) {
    const d = dir[axis];
    const origin = a[axis];
    if (Math.abs(d) < 1e-9) {
      if (origin < box.min[axis] || origin > box.max[axis]) return false;
    } else {
      let t1 = (box.min[axis] - origin) / d;
      let t2 = (box.max[axis] - origin) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
  }
  return true;
}

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.04,
    });
  }
  const kilnGlow = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent),
    emissiveIntensity: 1.6, roughness: 0.6,
  });
  const lampGlow = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.ink), emissive: new THREE.Color(PALETTE.ink),
    emissiveIntensity: 1.2, roughness: 0.5,
  });

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function cylinder(radiusTop, radiusBottom, height, x, y, z, material, segments = 18) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Floor and perimeter: 40 x 30 m, 4.6 m walls, open sky.
  box(40.4, 0.4, 30.4, 0, -0.2, 0, 'surface');
  box(0.4, 4.6, 30.4, -20.2, 2.3, 0, 'hairline');
  box(0.4, 4.6, 30.4, 20.2, 2.3, 0, 'hairline');
  box(40.4, 4.6, 0.4, 0, 2.3, -15.2, 'hairline');
  box(40.4, 4.6, 0.4, 0, 2.3, 15.2, 'hairline');

  // Lane walls: x = -8 and x = +8, with two gaps each (mid connectors).
  for (const side of [-1, 1]) {
    const x = side * 8;
    box(0.5, 4.6, 9, x, 2.3, -10.5, 'surface'); // north segment
    box(0.5, 4.6, 6, x, 2.3, 1, 'surface'); // middle segment
    box(0.5, 4.6, 7, x, 2.3, 11.5, 'surface'); // south segment
  }

  // Central furnace: the mid sightline blocker, with a glowing slit.
  box(6, 4.4, 4, 0, 2.2, 0, 'hairline');
  const slit = new THREE.Mesh(new THREE.BoxGeometry(6.1, 0.5, 0.4), kilnGlow);
  slit.position.set(0, 1.1, 2.05);
  group.add(slit);
  const slitBack = slit.clone();
  slitBack.position.z = -2.05;
  group.add(slitBack);

  // The Kiln: a big cylinder at the north end, chimney, glow ring.
  const kiln = cylinder(2.6, 3.0, 3.4, 0, 1.7, -12.4, 'surface', 24);
  kiln.material = materials.surface;
  const kilnMouth = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.3, 24), kilnGlow);
  kilnMouth.position.set(0, 3.45, -12.4);
  group.add(kilnMouth);
  cylinder(0.9, 1.1, 5.2, -3.4, 2.6, -14.2, 'hairline', 12);

  // Site floor marking: amber inlay where the charge is planted.
  const siteMark = new THREE.Mesh(
    new THREE.BoxGeometry(6, 0.06, 4),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.55, roughness: 0.8 }),
  );
  siteMark.position.set(0, 0.03, -11.5);
  siteMark.receiveShadow = true;
  group.add(siteMark);

  // Cover: crates to crouch behind, stacks to climb sight over, barrels.
  const crates = [
    [-14, -5.5, 1.1], [-14, 5.5, 1.1], [-11.5, 0, 1.1], [14, -5.5, 1.1],
    [14, 5.5, 1.1], [11.5, 0, 1.1], [-4, -7.5, 1.1], [4, -7.5, 1.1],
    [-6, 8.5, 1.1], [6, 8.5, 1.1], [-2.5, -10.5, 1.1], [2.5, -10.5, 1.1],
  ];
  for (const [x, z, s] of crates) box(s, s, s, x, s / 2, z, 'hairline');
  box(2.2, 2.2, 1.2, -17.5, 1.1, -8, 'surface');
  box(2.2, 2.2, 1.2, 17.5, 1.1, -8, 'surface');
  box(1.2, 2.2, 2.2, -17.5, 1.1, 8, 'surface');
  box(1.2, 2.2, 2.2, 17.5, 1.1, 8, 'surface');
  cylinder(0.55, 0.55, 1.25, -11, 0.62, -12.5, 'muted', 12);
  cylinder(0.55, 0.55, 1.25, 11, 0.62, -12.5, 'muted', 12);
  cylinder(0.55, 0.55, 1.25, -6.5, 0.62, 11, 'muted', 12);
  cylinder(0.55, 0.55, 1.25, 6.5, 0.62, 11, 'muted', 12);

  // Overhead pipes along both side walls, and hanging lamps.
  for (const side of [-1, 1]) {
    box(0.3, 0.3, 28, side * 19.4, 3.9, 0, 'muted');
    box(0.3, 0.3, 28, side * 19.4, 3.5, 0, 'hairline');
  }
  for (const [x, z] of [[-14, 0], [14, 0], [0, 8], [0, -8], [-8, -12], [8, -12]]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.3), lampGlow);
    lamp.position.set(x, 4.3, z);
    group.add(lamp);
    const cord = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.05), materials.hairline);
    cord.position.set(x, 4.55, z);
    group.add(cord);
  }

  // Light: dusk hemisphere, warm key from the south-east, cool fill, kiln glow.
  const sky = new THREE.HemisphereLight(new THREE.Color('#5a6a72'), new THREE.Color(PALETTE.canvas), 0.9);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color('#ffd9a0'), 2.0);
  key.position.set(12, 16, 12);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -24;
  key.shadow.camera.right = 24;
  key.shadow.camera.top = 24;
  key.shadow.camera.bottom = -24;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.5);
  fill.position.set(-10, 10, -12);
  scene.add(fill);
  const kilnLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 26, 18, 1.6);
  kilnLight.position.set(0, 3.2, -11.5);
  scene.add(kilnLight);

  const site = new THREE.Box3(
    new THREE.Vector3(-3.4, 0, -13.6),
    new THREE.Vector3(3.4, 3, -9.4),
  );

  const waypoints = WAYPOINTS.map(([x, z, neighbours]) => ({ x, z, neighbours }));

  function nearestWaypoint(x, z) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < waypoints.length; i += 1) {
      const dx = waypoints[i].x - x;
      const dz = waypoints[i].z - z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  // Breadth-first route over the waypoint graph.
  function findPath(from, to) {
    if (from === to) return [to];
    const prev = new Array(waypoints.length).fill(-1);
    const queue = [from];
    prev[from] = from;
    while (queue.length > 0) {
      const current = queue.shift();
      for (const next of waypoints[current].neighbours) {
        if (prev[next] !== -1) continue;
        prev[next] = current;
        if (next === to) {
          const path = [to];
          let node = to;
          while (node !== from) { node = prev[node]; path.unshift(node); }
          return path;
        }
        queue.push(next);
      }
    }
    return [to];
  }

  function lineOfSight(a, b, smokeSpheres) {
    for (const box of colliders) {
      // Skip the floor: it never blocks a standing sightline.
      if (box.max.y <= 0.05) continue;
      if (segmentHitsBox(a, b, box)) return false;
    }
    for (const smoke of smokeSpheres) {
      if (segmentHitsSphere(a, b, smoke)) return false;
    }
    return true;
  }

  function segmentHitsSphere(a, b, sphere) {
    // Segment vs sphere: closest approach of the segment to the centre.
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dy * dy + dz * dz;
    let t = 0;
    if (lenSq > 0) {
      t = ((sphere.x - a.x) * dx + (sphere.y - a.y) * dy + (sphere.z - a.z) * dz) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }
    const cx = a.x + dx * t - sphere.x;
    const cy = a.y + dy * t - sphere.y;
    const cz = a.z + dz * t - sphere.z;
    return cx * cx + cy * cy + cz * cz < sphere.r * sphere.r;
  }

  return {
    colliders,
    shootables,
    site,
    waypoints,
    nearestWaypoint,
    findPath,
    lineOfSight,
    segmentHitsSphere,
    group,
    kilnLight,
    spawns: {
      attack: [[-4, 13], [0, 13.5], [4, 13], [-7, 12], [7, 12]],
      defend: [[-10, -13.5], [-4, -14], [0, -14], [4, -14], [10, -13.5]],
    },
  };
}
