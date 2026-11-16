// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's
// rate. ?shot=start|play|end with &seed=N sets up a deterministic frame for a capture,
// renders it twice, then freezes it and sets window.__shotReady. No network requests:
// every import is relative, every texture is geometry and light.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createMap } from './map.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons, WEAPONS, GRENADES } from './weapons.js';
import { createGrenades } from './grenades.js';
import { createBots } from './bots.js';
import { createAudio } from './audio.js';
import { createSim, PLANT_SECONDS } from './sim.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = shot ? mulberry32(seed) : Math.random;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 22, 58);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const audio = createAudio();
const map = createMap(scene);
const hud = createHud();
const player = createPlayer(map.colliders, map.spawns.attack[0]);
const weapons = createWeapons(camera);
const grenades = createGrenades(scene, map.colliders);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const shootables = [];
const direction = new THREE.Vector3();
const effects = [];

const botEvents = {
  onBotShot(bot, pos) {
    const p = player.state.position;
    const dist = Math.hypot(p.x - pos.x, p.z - pos.z);
    if (dist < 26) audio.shot(bot.weapon);
    bots.hearShot(pos, bot.team);
  },
  onDamagePlayer(amount, from, headshot) {
    sim.damagePlayer(amount, from, headshot);
  },
  onKill(killer, victim, headshot) {
    sim.onBotKilled(killer, victim, headshot);
  },
  onChannel(bot, progress, kind) {
    hud.setChannel(progress, `${bot.name} ${kind === 'plant' ? 'PLANTING' : 'DEFUSING'}…`);
  },
  onPlantComplete() {
    sim.plantBomb(false);
  },
  onDefuseComplete() {
    sim.defuseBomb();
  },
};
const bots = createBots(scene, map, rand, botEvents);

const simEvents = {
  onRoundStart(round, score) {
    player.teleport(map.spawns.attack[0][0], map.spawns.attack[0][1], 0);
    weapons.refillAll();
    weapons.select('picket');
    grenades.clear();
    effects.length = 0;
    hud.setHealth(100);
    hud.setScore(score.attack, score.defend);
    hud.setMoney(sim.state.money);
    hud.setBomb('', false);
    hud.setChannel(0, '');
    hud.setKillfeed([]);
    hud.showBanner(`ROUND ${round}`, round === 1 ? 'Plant the charge at the Kiln — or wipe them out.' : 'Buy up. First to 5 takes the match.');
    if (!shot) {
      hud.showBuy(true, sim.state.money, weapons.owned, weapons.state.grenades);
      if (document.pointerLockElement) document.exitPointerLock();
    }
  },
  onPhase() {
    hud.showBuy(false, 0, {}, { ember: 0, veil: 0 });
    hud.showBanner('GO', 'The round is live.');
  },
  onRoundEnd(winner, reason, score, money) {
    hud.setScore(score.attack, score.defend);
    hud.setMoney(money);
    hud.showBuy(false, 0, {}, { ember: 0, veil: 0 });
    hud.setChannel(0, '');
    const reasonText = {
      elimination: 'Elimination',
      detonation: 'Detonation',
      defuse: 'Defuse',
      timeout: 'Time expired',
    }[reason] ?? reason;
    hud.showBanner(winner === 'attack' ? 'EMBERS WIN THE ROUND' : 'WARDENS WIN THE ROUND', reasonText, 3600);
    if (winner === 'attack') audio.roundWin();
    else audio.roundLose();
    if (!shot && document.pointerLockElement) document.exitPointerLock();
  },
  onMatchEnd(winner, score) {
    hud.showOverlay('match', `${winner === 'attack' ? 'Embers' : 'Wardens'} take the match ${score.attack}–${score.defend}. You scored ${sim.state.playerKills} eliminations.`);
    if (document.pointerLockElement) document.exitPointerLock();
  },
  onBombPlanted() {
    hud.showBanner('CHARGE PLANTED', 'Hold the Kiln until it blows.', 3000);
    audio.plantBeep(true);
  },
  onBombDetonated(pos) {
    spawnExplosion(pos, 7);
    audio.explosion();
    shake(0.6);
  },
  onBombDefused() {
    hud.showBanner('CHARGE DEFUSED', 'The Wardens hold the Kiln.', 3000);
    audio.roundLose();
  },
  onPlayerHurt(hp) {
    hud.setHealth(hp);
    hud.damageFlash();
    audio.hurt();
  },
  onPlayerDeath() {
    hud.showBanner('YOU ARE DOWN', 'Your team fights on without you.', 3000);
  },
  onKillfeed(entries) {
    hud.setKillfeed(entries);
  },
  onMoney(money) {
    hud.setMoney(money);
  },
};
const sim = createSim(map, bots, simEvents);

let plantProgress = 0;
let prevFiring = false;
let lastBeep = 0;
let shakeTime = 0;
let shakeMag = 0;
let started = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let targetFov = 74;

function shake(mag) {
  shakeTime = 0.5;
  shakeMag = mag;
}

function spawnExplosion(pos, radius) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 18, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false }),
  );
  mesh.position.set(pos.x, 1.2, pos.z);
  scene.add(mesh);
  const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 60, 22, 1.5);
  light.position.set(pos.x, 2, pos.z);
  scene.add(light);
  effects.push({ mesh, light, life: 0.7, max: radius });
}

function syncCamera() {
  const body = player.state;
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  let pitch = body.pitch;
  let yaw = body.yaw;
  if (shakeTime > 0) {
    pitch += (rand() * 2 - 1) * 0.02 * shakeMag;
    yaw += (rand() * 2 - 1) * 0.02 * shakeMag;
  }
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
}

function syncHud() {
  const ammo = weapons.ammo();
  hud.setAmmo(ammo.mag, ammo.reserve, weapons.currentDef().name);
  hud.setHealth(sim.state.playerHp);
  hud.setMoney(sim.state.money);
  const phase = sim.state.phase;
  if (phase === 'buy') hud.setTimer(sim.state.buyLeft, 'buy');
  else if (phase === 'live') hud.setTimer(sim.state.bomb.state === 'planted' ? sim.state.bomb.timer : sim.state.roundLeft, 'live');
  else hud.setTimer(0, 'live');
  hud.setScore(sim.state.score.attack, sim.state.score.defend);
  const attackAlive = (sim.state.playerAlive ? 1 : 0) + bots.aliveCount('attack');
  hud.setAlive(attackAlive, bots.aliveCount('defend'));
  hud.setGrenades(weapons.state.grenades.ember, weapons.state.grenades.veil);
  const bomb = sim.state.bomb;
  if (bomb.state === 'planted') {
    hud.setBomb(`CHARGE PLANTED — ${Math.ceil(bomb.timer)}s`, true);
    const interval = 0.3 + bomb.timer * 0.02;
    if (sim.state.time - lastBeep > interval) {
      lastBeep = sim.state.time;
      audio.plantBeep(bomb.timer < 10);
    }
  } else if (bomb.state === 'carried') {
    hud.setBomb(bomb.carrier === 'player' ? 'CHARGE READY — plant at the Kiln [hold E]' : 'TEAMMATE CARRIES THE CHARGE', false);
  } else if (bomb.state === 'detonated') {
    hud.setBomb('CHARGE DETONATED', true);
  } else {
    hud.setBomb('', false);
  }
  const spread = weapons.spread(player.groundSpeed(), input.state.aiming, player.state.crouching);
  hud.setCrosshairGap(6 + spread * 320);
}

function shoot() {
  if (!weapons.takeRound()) {
    audio.dryFire();
    return false;
  }
  camera.getWorldDirection(direction);
  const spread = weapons.spread(player.groundSpeed(), input.state.aiming, player.state.crouching);
  direction.x += (rand() * 2 - 1) * spread;
  direction.y += (rand() * 2 - 1) * spread;
  direction.z += (rand() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  shootables.length = 0;
  for (const mesh of map.shootables) shootables.push(mesh);
  for (const mesh of bots.hitMeshes) shootables.push(mesh);
  const hit = raycaster.intersectObjects(shootables, false)[0];
  if (hit) {
    const bot = hit.object.userData.bot;
    if (bot && bot.alive) {
      const def = weapons.currentDef();
      const headshot = hit.object.userData.part === 'head';
      const damage = Math.round(def.damage * (headshot ? def.headMult : 1));
      const wasAlive = bot.alive;
      bots.damageBot(bot, damage, 'player', headshot);
      hud.hitMarker(wasAlive && !bot.alive, 120);
      if (wasAlive && !bot.alive) audio.kill();
      else audio.hit();
    }
  }
  weapons.pullTrigger();
  audio.shot(weapons.currentDef().id);
  player.recoil(0.009 + rand() * 0.004, (rand() * 2 - 1) * 0.004);
  const p = player.state.position;
  bots.hearShot({ x: p.x, y: p.y + 1.4, z: p.z }, 'attack');
  return true;
}

function explodeGrenade(kind, pos, def) {
  if (kind === 'he') {
    spawnExplosion(pos, def.radius);
    audio.explosion();
    const p = player.state.position;
    if (Math.hypot(p.x - pos.x, p.z - pos.z) < 16) shake(0.35);
    // Damage every living fighter in the blast with a wall check.
    const targets = [];
    if (sim.state.playerAlive) targets.push({ isPlayer: true, pos: { x: p.x, y: p.y + 1.1, z: p.z } });
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      const bp = bot.mover.state.position;
      targets.push({ isPlayer: false, bot, pos: { x: bp.x, y: bp.y + 1.1, z: bp.z } });
    }
    for (const target of targets) {
      const dist = Math.hypot(target.pos.x - pos.x, target.pos.z - pos.z);
      if (dist > def.radius) continue;
      const from = { x: pos.x, y: pos.y + 0.4, z: pos.z };
      if (!map.lineOfSight(from, target.pos, [])) continue;
      const damage = Math.round(def.damage * (1 - (dist / def.radius) * 0.75));
      if (target.isPlayer) sim.damagePlayer(damage, 'player', false);
      else bots.damageBot(target.bot, damage, 'player', false);
    }
  }
}

function throwGrenade(kind) {
  if (weapons.state.grenades[kind] <= 0) return;
  weapons.state.grenades[kind] -= 1;
  camera.getWorldDirection(direction);
  const eye = new THREE.Vector3().copy(camera.position);
  grenades.throwGrenade(kind, eye, direction, 11);
  audio.click();
}

function handlePressed(pressed) {
  const phase = sim.state.phase;
  if (pressed.has('KeyB') && phase === 'buy') {
    const open = document.getElementById('buy-menu').hidden;
    hud.showBuy(open, sim.state.money, weapons.owned, weapons.state.grenades);
    if (open && document.pointerLockElement) document.exitPointerLock();
    else if (!open) input.requestLock();
  }
  if (phase === 'buy') {
    if (pressed.has('Digit1')) buyWeapon('rook');
    if (pressed.has('Digit2')) buyWeapon('hornet');
    if (pressed.has('Digit3')) buyWeapon('longshot');
    if (pressed.has('Digit5')) buyGrenade('ember');
    if (pressed.has('Digit6')) buyGrenade('veil');
  }
  if (phase === 'live' && sim.state.playerAlive) {
    if (pressed.has('Digit1')) weapons.select('rook');
    if (pressed.has('Digit2')) weapons.select('hornet');
    if (pressed.has('Digit3')) weapons.select('longshot');
    if (pressed.has('Digit4')) weapons.select('picket');
    if (pressed.has('KeyR')) weapons.reload();
    if (pressed.has('KeyG')) throwGrenade('ember');
    if (pressed.has('KeyH')) throwGrenade('veil');
  }
}

function buyWeapon(id) {
  if (sim.state.phase !== 'buy') return;
  if (!sim.buyWeapon(id, WEAPONS[id].price)) {
    audio.denied();
    return;
  }
  weapons.buy(id);
  weapons.select(id);
  audio.buy();
  hud.showBuy(true, sim.state.money, weapons.owned, weapons.state.grenades);
}

function buyGrenade(id) {
  if (sim.state.phase !== 'buy') return;
  if (weapons.state.grenades[id] >= 2) {
    audio.denied();
    return;
  }
  if (!sim.buyGrenade(id, GRENADES[id].price)) {
    audio.denied();
    return;
  }
  weapons.state.grenades[id] += 1;
  audio.buy();
  hud.showBuy(true, sim.state.money, weapons.owned, weapons.state.grenades);
}

function step(dt) {
  const phase = sim.state.phase;
  const pressed = input.takePressed();
  handlePressed(pressed);

  if (phase === 'live' || phase === 'buy') {
    if (sim.state.playerAlive) {
      player.step(dt, input.state.keys, weapons.moveSpeed());
    }
    weapons.step(dt);
    grenades.step(dt, (kind, pos, def) => explodeGrenade(kind, pos, def));

    // Plant channel: hold E inside the Kiln while carrying the charge.
    if (phase === 'live' && sim.state.playerAlive && sim.state.bomb.state === 'carried' && sim.state.bomb.carrier === 'player') {
      const p = player.state.position;
      if (input.state.keys.has('KeyE') && sim.playerInSite(p)) {
        plantProgress += dt;
        hud.setChannel(plantProgress / PLANT_SECONDS, 'PLANTING CHARGE…');
        if (plantProgress >= PLANT_SECONDS) {
          plantProgress = 0;
          hud.setChannel(0, '');
          sim.plantBomb(true);
        }
      } else if (plantProgress > 0) {
        plantProgress = 0;
        hud.setChannel(0, '');
      }
    }

    const ctx = {
      time: sim.state.time,
      player: {
        alive: sim.state.playerAlive,
        position: player.state.position,
        speed: player.groundSpeed(),
        crouched: player.state.crouching,
      },
      bomb: sim.state.bomb,
      phase,
      smokes: grenades.smokeSpheres(),
    };
    if (phase === 'live') bots.step(dt, ctx);
    bots.syncFigures();
  }

  sim.step(dt);

  // Effects: explosion spheres and lights fade out.
  for (let i = effects.length - 1; i >= 0; i -= 1) {
    const effect = effects[i];
    effect.life -= dt;
    const k = Math.max(0, effect.life / 0.7);
    effect.mesh.scale.setScalar(1 + (1 - k) * effect.max);
    effect.mesh.material.opacity = k * 0.9;
    effect.light.intensity = k * 60;
    if (effect.life <= 0) {
      scene.remove(effect.mesh);
      scene.remove(effect.light);
      effects.splice(i, 1);
    }
  }
  if (shakeTime > 0) shakeTime -= dt;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    const phase = sim.state.phase;
    if (phase === 'live' && sim.state.playerAlive && input.state.locked) {
      const def = weapons.currentDef();
      const firingEdge = input.state.firing && !prevFiring;
      if (def.auto ? input.state.firing : firingEdge) {
        if (weapons.ready()) shoot();
      }
    }
    prevFiring = input.state.firing;
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    // Aim zoom: the Longshot scopes in on right mouse.
    const zoom = input.state.aiming ? weapons.zoom() : 1;
    targetFov = 74 / zoom;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
      camera.updateProjectionMatrix();
    }
    syncCamera();
    syncHud();
  }
  renderer.render(scene, camera);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    audio.unlock();
    hud.hideOverlay();
    hud.showBuy(false, 0, {}, { ember: 0, veil: 0 });
  } else if (sim.state.phase === 'menu') {
    hud.showOverlay('start');
  } else if (sim.state.phase === 'matchover') {
    hud.showOverlay('match', `${sim.state.matchWinner === 'attack' ? 'Embers' : 'Wardens'} take the match ${sim.state.score.attack}–${sim.state.score.defend}. You scored ${sim.state.playerKills} eliminations.`);
  } else if (sim.state.phase === 'over') {
    hud.showOverlay('round', `${sim.state.overWinner === 'attack' ? 'Embers' : 'Wardens'} win the round — ${sim.state.overReason}. Score ${sim.state.score.attack}–${sim.state.score.defend}.`);
  } else if (sim.state.phase === 'buy') {
    hud.showBuy(true, sim.state.money, weapons.owned, weapons.state.grenades);
  } else if (started) {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  const phase = sim.state.phase;
  if (phase === 'menu') {
    sim.startMatch();
    hud.hideOverlay();
    hud.showBuy(true, sim.state.money, weapons.owned, weapons.state.grenades);
  } else if (phase === 'over') {
    sim.state.overLeft = 0.1;
    input.requestLock();
  } else if (phase === 'matchover') {
    sim.startMatch();
    hud.hideOverlay();
    hud.showBuy(true, sim.state.money, weapons.owned, weapons.state.grenades);
  } else {
    input.requestLock();
  }
});

hud.onBuy((choice) => {
  if (choice.weapon) buyWeapon(choice.weapon);
  else if (choice.grenade) buyGrenade(choice.grenade);
});

document.getElementById('buy-close').addEventListener('click', () => {
  hud.showBuy(false, 0, {}, { ember: 0, veil: 0 });
  input.requestLock();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function aimAtPoint(point) {
  const body = player.state;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  hud.showBuy(false, 0, {}, { ember: 0, veil: 0 });
  sim.startMatch();
  const body = player.state;
  if (name === 'start') {
    body.yaw = 0;
    body.pitch = 0;
    settle(20);
    aimAtPoint(new THREE.Vector3(0, 1.6, -12));
    hud.showOverlay('start');
  } else if (name === 'play') {
    sim.state.phase = 'live';
    sim.state.roundLeft = 92;
    player.teleport(4, 8, 0);
    settle(150);
    // The staged firefight is for the capture: restore the player to full health
    // after the settle so the shot shows a clean HUD.
    sim.state.playerHp = 100;
    sim.state.playerAlive = true;
    hud.setHealth(100);
    // Stage a firefight: aim at a defender holding the site front.
    const defenders = bots.bots.filter((b) => b.team === 'defend' && b.alive);
    const target = defenders[0];
    if (target) {
      const tp = target.mover.state.position;
      aimAtPoint(new THREE.Vector3(tp.x, tp.y + 1.2, tp.z));
      shoot();
      settle(8);
      aimAtPoint(new THREE.Vector3(tp.x, tp.y + 1.2, tp.z));
      shoot();
      // One defender goes down for the kill feed.
      if (defenders[1]) bots.damageBot(defenders[1], 200, 'player', true);
      settle(6);
    }
    syncHud();
  } else {
    // end: the round is won at the Kiln.
    sim.state.score.attack = 1;
    sim.state.phase = 'over';
    sim.state.overWinner = 'attack';
    sim.state.overReason = 'detonation';
    player.teleport(0, -9.5, 0);
    settle(20);
    aimAtPoint(new THREE.Vector3(0, 1.5, -12.4));
    hud.setScore(1, 0);
    hud.showOverlay('round', 'Embers win the round — detonation. Score 1–0.');
  }
  syncCamera();
  syncHud();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

syncCamera();
syncHud();
if (shot) runShot(shot);
else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
