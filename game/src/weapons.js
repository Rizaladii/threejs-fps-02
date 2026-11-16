// Weapons: four invented guns and two grenades. Every number lives here; main.js
// owns the ray and the damage, bots.js reads the same table for bot fire. Spread
// punishes moving and rewards standing still and crouching; the Longshot rewards
// aiming down sights. No real gun names, no Counter-Strike names.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  picket: {
    id: 'picket', name: 'Picket Pistol', price: 0, mag: 12, reserve: 48,
    gap: 0.16, reload: 1.3, damage: 26, headMult: 3,
    spreadStill: 0.004, spreadMove: 0.03, auto: false, zoom: 1, kick: 0.011,
    speed: 5.2, tracer: PALETTE.ink,
  },
  rook: {
    id: 'rook', name: 'Rook Rifle', price: 2700, mag: 30, reserve: 90,
    gap: 0.1, reload: 2.0, damage: 33, headMult: 3,
    spreadStill: 0.0025, spreadMove: 0.03, auto: true, zoom: 1, kick: 0.013,
    speed: 5.2, tracer: PALETTE.accent,
  },
  hornet: {
    id: 'hornet', name: 'Hornet SMG', price: 1500, mag: 25, reserve: 100,
    gap: 0.07, reload: 1.6, damage: 22, headMult: 3,
    spreadStill: 0.004, spreadMove: 0.034, auto: true, zoom: 1, kick: 0.008,
    speed: 5.6, tracer: PALETTE.teal,
  },
  longshot: {
    id: 'longshot', name: 'Longshot', price: 4000, mag: 5, reserve: 15,
    gap: 1.15, reload: 2.8, damage: 92, headMult: 2,
    spreadStill: 0.0006, spreadMove: 0.05, auto: false, zoom: 2.6, kick: 0.03,
    speed: 4.8, tracer: PALETTE.danger,
  },
};

export const GRENADES = {
  ember: { id: 'ember', name: 'Ember Charge', price: 300, kind: 'he', radius: 6, damage: 90, fuse: 1.4 },
  veil: { id: 'veil', name: 'Veil Smoke', price: 300, kind: 'smoke', radius: 3.5, duration: 12, fuse: 0.6 },
};

const MUZZLE_TIME = 0.06;

// Distinct silhouettes from boxes only: pistol short, rifle long with mag, SMG
// stubby with a suppressor, sniper long with a scope tube.
function buildModel(def) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const light = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(def.tracer), roughness: 0.5, metalness: 0.2 });
  const group = new THREE.Group();
  function part(geo, mat, x, y, z) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  }
  if (def.id === 'picket') {
    part(new THREE.BoxGeometry(0.05, 0.09, 0.22), light, 0, 0, -0.1);
    part(new THREE.BoxGeometry(0.045, 0.12, 0.07), dark, 0, -0.09, 0.02);
  } else if (def.id === 'rook') {
    part(new THREE.BoxGeometry(0.09, 0.1, 0.42), light, 0, 0, 0);
    part(new THREE.BoxGeometry(0.045, 0.045, 0.4), dark, 0, 0.025, -0.38);
    part(new THREE.BoxGeometry(0.075, 0.08, 0.22), dark, 0, -0.02, 0.3);
    part(new THREE.BoxGeometry(0.05, 0.14, 0.06), accent, 0, -0.11, -0.05);
  } else if (def.id === 'hornet') {
    part(new THREE.BoxGeometry(0.08, 0.09, 0.3), light, 0, 0, -0.05);
    part(new THREE.BoxGeometry(0.04, 0.04, 0.24), dark, 0, 0.02, -0.3);
    part(new THREE.BoxGeometry(0.06, 0.16, 0.08), dark, 0, -0.1, 0.02);
    part(new THREE.BoxGeometry(0.07, 0.07, 0.12), accent, 0, 0, 0.2);
  } else {
    part(new THREE.BoxGeometry(0.08, 0.09, 0.55), dark, 0, 0, -0.1);
    part(new THREE.BoxGeometry(0.035, 0.035, 0.5), light, 0, 0.02, -0.55);
    part(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), accent, 0, 0.07, -0.05).rotation.x = Math.PI / 2;
    part(new THREE.BoxGeometry(0.06, 0.1, 0.14), dark, 0, -0.03, 0.28);
  }
  group.position.set(0.24, -0.2, -0.42);
  return group;
}

export function createWeapons(camera) {
  const models = {};
  for (const def of Object.values(WEAPONS)) {
    const model = buildModel(def);
    model.visible = false;
    camera.add(model);
    models[def.id] = model;
  }

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  // Owned weapons keep their own magazines; the pistol is always owned.
  const owned = {
    picket: { mag: WEAPONS.picket.mag, reserve: WEAPONS.picket.reserve },
  };
  const state = {
    current: 'picket', cooldown: 0, reloadLeft: 0, flash: 0, kick: 0,
    grenades: { ember: 0, veil: 0 },
  };
  models.picket.visible = true;

  function currentDef() {
    return WEAPONS[state.current];
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.current];
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (currentDef().reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const slot = owned[state.current];
        const need = currentDef().mag - slot.mag;
        const take = Math.min(need, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
      }
    }
  }

  return {
    state,
    owned,
    currentDef,
    step,
    ready() {
      const slot = owned[state.current];
      return slot.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = currentDef().gap;
      state.flash = MUZZLE_TIME;
      state.kick = 0.055;
    },
    takeRound() {
      const slot = owned[state.current];
      if (slot.mag <= 0) return false;
      slot.mag -= 1;
      return true;
    },
    reload() {
      const def = currentDef();
      const slot = owned[state.current];
      if (state.reloadLeft > 0 || slot.mag === def.mag || slot.reserve === 0) return;
      state.reloadLeft = def.reload;
    },
    spread(speed, aiming, crouched) {
      const def = currentDef();
      let spread = def.spreadStill + Math.min(1, speed / 5.2) * def.spreadMove;
      if (aiming) spread *= def.id === 'longshot' ? 0.25 : 0.55;
      if (crouched) spread *= 0.75;
      return spread;
    },
    select(id) {
      if (!owned[id] || id === state.current) return false;
      models[state.current].visible = false;
      state.current = id;
      models[id].visible = true;
      state.reloadLeft = 0;
      state.cooldown = Math.max(state.cooldown, 0.25);
      return true;
    },
    buy(id) {
      if (owned[id]) return false;
      owned[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
      return true;
    },
    refillAll() {
      for (const id of Object.keys(owned)) {
        owned[id].mag = WEAPONS[id].mag;
        owned[id].reserve = WEAPONS[id].reserve;
      }
      state.reloadLeft = 0;
      state.cooldown = 0;
    },
    moveSpeed() {
      return currentDef().speed;
    },
    zoom() {
      return currentDef().zoom;
    },
    ammo() {
      const slot = owned[state.current];
      return { mag: slot.mag, reserve: slot.reserve };
    },
  };
}
