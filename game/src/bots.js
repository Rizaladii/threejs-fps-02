// Bots: 5v5 single-player. Four attacker teammates and five defenders run a small
// state machine over the map's waypoint graph: route to an objective, hold an angle,
// engage on line-of-sight, take cover when hurt, plant the charge when they carry it,
// defuse when it is planted. They hear gunfire and investigate. They shoot in bursts
// with a reaction delay and a hit chance that falls with distance and target motion,
// so standing still and holding an angle beats running at them.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS } from './weapons.js';
import { createMover } from './player.js';

const BOT_SPEED = 4.0;
const EYE_HEIGHT = 1.5;
const THINK_EVERY = 0.12;
const COVER_HP = 35;
const HEADSHOT_CHANCE = 0.08;

const ATTACK_NAMES = ['Ash', 'Cinder', 'Flint', 'Soot'];
const DEFEND_NAMES = ['Warden', 'Frost', 'Gale', 'Rook', 'Vane'];
const ATTACK_HOLD = [17, 18, 16, 14, 15];
const DEFEND_HOLD = [17, 18, 16, 5, 9, 12, 13];
const COVER_NODES = [2, 3, 5, 6, 8, 9, 12, 13, 14, 15];

function buildFigure(team) {
  const group = new THREE.Group();
  const bodyColor = team === 'attack' ? PALETTE.ember : PALETTE.teal;
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(bodyColor), roughness: 0.65, metalness: 0.05 });
  const headMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.18), darkMat);
  legL.position.set(-0.11, 0.25, 0);
  const legR = legL.clone();
  legR.position.x = 0.11;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.3), bodyMat);
  torso.position.y = 1.0;
  torso.userData.part = 'torso';
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 14, 10), headMat);
  head.position.y = 1.53;
  head.userData.part = 'head';
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.05), darkMat);
  visor.position.set(0, 1.55, -0.14);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.55), darkMat);
  gun.position.set(0.2, 1.15, -0.3);
  group.add(legL, legR, torso, head, visor, gun);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return { group, torso, head };
}

export function createBots(scene, map, rng, events) {
  const bots = [];
  const hitMeshes = [];
  let time = 0;

  function addBot(team, name, spawn, weapon) {
    const figure = buildFigure(team);
    scene.add(figure.group);
    const mover = createMover(map.colliders, spawn, 0.34);
    const bot = {
      id: `${team}-${name}`, name, team, alive: true, hp: 100, weapon,
      mover, group: figure.group, torso: figure.torso, head: figure.head,
      state: 'route', path: [], pathIndex: 0, holdNode: -1,
      target: null, lastSeen: null, lastSeenAt: -99, reaction: 0,
      burstLeft: 0, burstPause: 0, fireTimer: 0, thinkTimer: rng() * THINK_EVERY,
      channel: 0, channelKind: null, alertPos: null, alertAt: -99,
      fall: 0, isCarrier: false, keys: new Set(),
    };
    figure.torso.userData.bot = bot;
    figure.head.userData.bot = bot;
    hitMeshes.push(figure.torso, figure.head);
    bots.push(bot);
    return bot;
  }

  function spawnRound(round, playerTeam) {
    // Clear old figures.
    for (const bot of bots) scene.remove(bot.group);
    bots.length = 0;
    hitMeshes.length = 0;
    const rifleHeavy = round >= 2;
    const attackWeapons = rifleHeavy ? ['rook', 'rook', 'hornet', 'longshot'] : ['picket', 'hornet', 'hornet', 'picket'];
    const defendWeapons = rifleHeavy ? ['rook', 'rook', 'rook', 'hornet', 'longshot'] : ['hornet', 'picket', 'hornet', 'picket', 'hornet'];
    for (let i = 0; i < 4; i += 1) {
      const bot = addBot('attack', ATTACK_NAMES[i], map.spawns.attack[i + 1], attackWeapons[i]);
      bot.holdNode = ATTACK_HOLD[i % ATTACK_HOLD.length];
    }
    for (let i = 0; i < 5; i += 1) {
      const bot = addBot('defend', DEFEND_NAMES[i], map.spawns.defend[i], defendWeapons[i]);
      bot.holdNode = DEFEND_HOLD[i % DEFEND_HOLD.length];
    }
    return bots;
  }

  function eyeOf(bot) {
    const p = bot.mover.state.position;
    return { x: p.x, y: p.y + EYE_HEIGHT, z: p.z };
  }

  function canSee(bot, enemy, ctx) {
    const a = eyeOf(bot);
    const ep = enemy.mover ? enemy.mover.state.position : enemy.position;
    const b = { x: ep.x, y: ep.y + 1.1, z: ep.z };
    if (Math.hypot(b.x - a.x, b.z - a.z) > 46) return false;
    return map.lineOfSight(a, b, ctx.smokes);
  }

  function nearestVisibleEnemy(bot, ctx) {
    let best = null;
    let bestDist = Infinity;
    const candidates = [];
    if (bot.team === 'attack') {
      for (const other of bots) if (other.team === 'defend' && other.alive) candidates.push(other);
    } else {
      for (const other of bots) if (other.team === 'attack' && other.alive) candidates.push(other);
      if (ctx.player.alive) candidates.push(ctx.player);
    }
    for (const enemy of candidates) {
      const ep = enemy.mover ? enemy.mover.state.position : enemy.position;
      const bp = bot.mover.state.position;
      const dist = Math.hypot(ep.x - bp.x, ep.z - bp.z);
      if (dist < bestDist && canSee(bot, enemy, ctx)) {
        best = enemy;
        bestDist = dist;
      }
    }
    return best ? { enemy: best, dist: bestDist } : null;
  }

  function routeTo(bot, node) {
    const from = map.nearestWaypoint(bot.mover.state.position.x, bot.mover.state.position.z);
    bot.path = map.findPath(from, node);
    bot.pathIndex = 0;
    bot.state = 'route';
  }

  function driveToward(bot, x, z, dt) {
    const p = bot.mover.state.position;
    const dx = x - p.x;
    const dz = z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.4) return true;
    bot.mover.state.yaw = Math.atan2(-dx, -dz);
    bot.keys.clear();
    bot.keys.add('KeyW');
    bot.mover.step(dt, bot.keys, BOT_SPEED);
    return false;
  }

  function aimAt(bot, x, z, y = 1.2) {
    const p = bot.mover.state.position;
    const dx = x - p.x;
    const dz = z - p.z;
    bot.mover.state.yaw = Math.atan2(-dx, -dz);
    const dy = y - (p.y + EYE_HEIGHT);
    const dist = Math.hypot(dx, dy, dz) || 1;
    bot.mover.state.pitch = Math.asin(Math.max(-1, Math.min(1, dy / dist)));
  }

  function hitChance(bot, enemy, dist, ctx) {
    let chance = 0.52 - dist * 0.013;
    if (enemy === ctx.player) {
      if (ctx.player.speed > 2) chance *= 0.7;
      if (ctx.player.crouched) chance *= 0.85;
    } else if (enemy.mover && enemy.mover.groundSpeed() > 2) {
      chance *= 0.7;
    }
    if (bot.mover.groundSpeed() > 1) chance *= 0.8;
    return Math.max(0.05, Math.min(0.6, chance));
  }

  function fireAt(bot, enemy, ctx) {
    const def = WEAPONS[bot.weapon];
    const ep = enemy.mover ? enemy.mover.state.position : enemy.position;
    const bp = bot.mover.state.position;
    const dist = Math.hypot(ep.x - bp.x, ep.z - bp.z);
    aimAt(bot, ep.x, ep.z, ep.y + 1.1);
    events.onBotShot(bot, { x: bp.x, y: bp.y + 1.4, z: bp.z });
    if (rng() >= hitChance(bot, enemy, dist, ctx)) return;
    const headshot = rng() < HEADSHOT_CHANCE;
    const damage = Math.round(def.damage * (headshot ? def.headMult : 1));
    if (enemy === ctx.player) {
      events.onDamagePlayer(damage, bot, headshot);
    } else {
      damageBot(enemy, damage, bot, headshot);
    }
  }

  function damageBot(bot, amount, attacker, headshot) {
    if (!bot.alive) return;
    bot.hp -= amount;
    bot.channel = 0;
    bot.channelKind = null;
    if (bot.hp <= 0) {
      bot.hp = 0;
      bot.alive = false;
      bot.state = 'dead';
      bot.fall = 0;
      events.onKill(attacker, bot, headshot);
    } else if (bot.hp < COVER_HP && bot.state !== 'cover') {
      bot.state = 'cover';
      const node = COVER_NODES[Math.floor(rng() * COVER_NODES.length)];
      routeTo(bot, node);
      bot.state = 'cover';
    }
  }

  function die(bot) {
    bot.alive = false;
    bot.state = 'dead';
  }

  function stepBot(bot, dt, ctx) {
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      bot.group.rotation.x = -bot.fall * 1.45;
      return;
    }
    bot.thinkTimer -= dt;
    if (bot.thinkTimer <= 0) {
      bot.thinkTimer = THINK_EVERY;
      const seen = nearestVisibleEnemy(bot, ctx);
      if (seen) {
        if (bot.target !== seen.enemy) bot.reaction = 0.35 + rng() * 0.45;
        bot.target = seen.enemy;
        const ep = seen.enemy.mover ? seen.enemy.mover.state.position : seen.enemy.position;
        bot.lastSeen = { x: ep.x, z: ep.z };
        bot.lastSeenAt = time;
        bot.state = 'engage';
      } else if (bot.target) {
        // Lost sight: keep the last seen spot for a few seconds, then move on.
        if (time - bot.lastSeenAt > 2.5) {
          bot.target = null;
          if (bot.state === 'engage') {
            if (bot.team === 'defend' && ctx.bomb.state === 'planted') routeTo(bot, 19);
            else if (bot.team === 'attack' && bot.isCarrier) routeTo(bot, 19);
            else routeTo(bot, bot.holdNode);
          }
        }
      }
    }

    // Hearing: a recent enemy gunshot nearby pulls the bot to investigate.
    if (bot.alertPos && time - bot.alertAt < 6 && !bot.target && bot.state !== 'plant' && bot.state !== 'defuse') {
      const node = map.nearestWaypoint(bot.alertPos.x, bot.alertPos.z);
      if (bot.state !== 'route' || bot.path[bot.path.length - 1] !== node) routeTo(bot, node);
    }

    if (bot.state === 'engage' && bot.target) {
      const target = bot.target;
      const alive = target === ctx.player ? ctx.player.alive : target.alive;
      if (!alive) {
        bot.target = null;
        bot.state = 'route';
        return;
      }
      const ep = target.mover ? target.mover.state.position : target.position;
      const bp = bot.mover.state.position;
      const dist = Math.hypot(ep.x - bp.x, ep.z - bp.z);
      aimAt(bot, ep.x, ep.z, ep.y + 1.1);
      bot.keys.clear();
      bot.mover.step(dt, bot.keys, BOT_SPEED);
      bot.reaction -= dt;
      if (bot.reaction > 0) return;
      if (dist > 34) {
        // Too far to hit: close the distance instead of wasting ammo.
        bot.state = 'route';
        routeTo(bot, map.nearestWaypoint(ep.x, ep.z));
        return;
      }
      bot.fireTimer -= dt;
      if (bot.burstLeft > 0) {
        if (bot.fireTimer <= 0) {
          fireAt(bot, target, ctx);
          bot.burstLeft -= 1;
          bot.fireTimer = WEAPONS[bot.weapon].gap * 1.2;
          if (bot.burstLeft === 0) bot.burstPause = 0.5 + rng() * 0.6;
        }
      } else {
        bot.burstPause -= dt;
        if (bot.burstPause <= 0) bot.burstLeft = 3 + Math.floor(rng() * 3);
      }
      return;
    }

    if (bot.state === 'plant') {
      const p = bot.mover.state.position;
      if (ctx.bomb.state === 'carried' && map.site.containsPoint(new THREE.Vector3(p.x, 1, p.z))) {
        bot.channel += dt;
        events.onChannel(bot, bot.channel / 3, 'plant');
        if (bot.channel >= 3) {
          bot.channel = 0;
          bot.channelKind = null;
          events.onPlantComplete(bot);
        }
      } else {
        bot.channel = 0;
        routeTo(bot, 19);
      }
      return;
    }

    if (bot.state === 'defuse') {
      const p = bot.mover.state.position;
      const bp = ctx.bomb.pos;
      const dist = bp ? Math.hypot(p.x - bp.x, p.z - bp.z) : 99;
      if (ctx.bomb.state === 'planted' && dist < 2.2) {
        bot.channel += dt;
        events.onChannel(bot, bot.channel / 5, 'defuse');
        if (bot.channel >= 5) {
          bot.channel = 0;
          bot.channelKind = null;
          events.onDefuseComplete(bot);
        }
      } else if (ctx.bomb.state === 'planted' && bp) {
        routeTo(bot, map.nearestWaypoint(bp.x, bp.z));
        bot.state = 'route';
      } else {
        bot.state = 'route';
        routeTo(bot, bot.holdNode);
      }
      return;
    }

    // Route / cover / hold: walk the waypoint path.
    if (bot.state === 'route' || bot.state === 'cover' || bot.state === 'hold') {
      if (bot.pathIndex >= bot.path.length) {
        if (bot.state === 'route') {
          // Arrived: decide what to do at the objective.
          if (bot.team === 'attack' && bot.isCarrier && ctx.bomb.state === 'carried') {
            const p = bot.mover.state.position;
            if (map.site.containsPoint(new THREE.Vector3(p.x, 1, p.z))) {
              bot.state = 'plant';
              bot.channel = 0;
              return;
            }
            routeTo(bot, 19);
            return;
          }
          if (bot.team === 'defend' && ctx.bomb.state === 'planted') {
            bot.state = 'defuse';
            return;
          }
          bot.state = 'hold';
          bot.holdTimer = 2 + rng() * 3;
          return;
        }
        if (bot.state === 'cover') {
          bot.state = 'hold';
          bot.holdTimer = 3;
          return;
        }
        bot.holdTimer = (bot.holdTimer ?? 0) - dt;
        if (bot.holdTimer <= 0) {
          // Hold expired: pick a fresh nearby post.
          const options = bot.team === 'attack' ? ATTACK_HOLD : DEFEND_HOLD;
          routeTo(bot, options[Math.floor(rng() * options.length)]);
        }
        return;
      }
      const node = map.waypoints[bot.path[bot.pathIndex]];
      if (driveToward(bot, node.x, node.z, dt)) bot.pathIndex += 1;
      return;
    }
  }

  function step(dt, ctx) {
    time = ctx.time;
    for (const bot of bots) stepBot(bot, dt, ctx);
  }

  function hearShot(pos, shooterTeam) {
    for (const bot of bots) {
      if (!bot.alive || bot.team === shooterTeam) continue;
      const p = bot.mover.state.position;
      const dist = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (dist < 20) {
        bot.alertPos = { x: pos.x, z: pos.z };
        bot.alertAt = time;
      }
    }
  }

  function aliveCount(team) {
    return bots.filter((b) => b.team === team && b.alive).length;
  }

  function resetFigures() {
    for (const bot of bots) {
      bot.group.rotation.set(0, 0, 0);
      bot.group.position.copy(bot.mover.state.position);
    }
  }

  function syncFigures() {
    for (const bot of bots) {
      const p = bot.mover.state.position;
      bot.group.position.set(p.x, p.y, p.z);
      bot.group.rotation.y = bot.mover.state.yaw;
      if (!bot.alive) bot.group.rotation.x = -bot.fall * 1.45;
    }
  }

  return {
    bots,
    hitMeshes,
    spawnRound,
    step,
    hearShot,
    aliveCount,
    damageBot,
    die,
    syncFigures,
    resetFigures,
    carrier() {
      return bots.find((b) => b.isCarrier && b.alive) ?? null;
    },
    setCarrier(bot) {
      for (const b of bots) b.isCarrier = false;
      if (bot) bot.isCarrier = true;
    },
  };
}
