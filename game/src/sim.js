// The simulation: one state object for the whole match. Phases run buy (15 s) ->
// live (100 s) -> over (4 s) -> next round; first to 5 round wins takes the match
// (at most 9 rounds). The bomb is carried by the player, planted at the Kiln in
// ~3 s, and detonates 35 s after planting unless a defender defuses it in ~5 s.
// Money pays for weapons and grenades between rounds; kills and round wins pay.
// This module never touches the DOM: main.js wires its events to the HUD and audio.
import * as THREE from 'three';

export const BUY_SECONDS = 15;
export const ROUND_SECONDS = 100;
export const PLANT_SECONDS = 3;
export const DEFUSE_SECONDS = 5;
export const DETONATE_SECONDS = 35;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;
export const START_MONEY = 800;
export const WIN_MONEY = 325;
export const LOSS_MONEY = 190;
export const KILL_MONEY = 300;
export const PLANT_MONEY = 300;

export function createSim(map, bots, events) {
  const state = {
    phase: 'menu',
    round: 0,
    score: { attack: 0, defend: 0 },
    money: START_MONEY,
    buyLeft: BUY_SECONDS,
    roundLeft: ROUND_SECONDS,
    overLeft: 0,
    overReason: '',
    overWinner: null,
    matchWinner: null,
    bomb: { state: 'gone', carrier: null, pos: null, timer: DETONATE_SECONDS },
    playerHp: 100,
    playerAlive: true,
    playerKills: 0,
    killfeed: [],
    time: 0,
  };

  function feed(killer, victim, headshot) {
    state.killfeed.unshift({ killer, victim, headshot, at: state.time });
    if (state.killfeed.length > 5) state.killfeed.pop();
    events.onKillfeed(state.killfeed);
  }

  function startMatch() {
    state.score = { attack: 0, defend: 0 };
    state.money = START_MONEY;
    state.round = 0;
    state.matchWinner = null;
    state.playerKills = 0;
    state.killfeed = [];
    startRound();
  }

  function startRound() {
    state.round += 1;
    state.phase = 'buy';
    state.buyLeft = BUY_SECONDS;
    state.roundLeft = ROUND_SECONDS;
    state.overLeft = 0;
    state.overReason = '';
    state.overWinner = null;
    state.bomb = { state: 'carried', carrier: 'player', pos: null, timer: DETONATE_SECONDS };
    state.playerHp = 100;
    state.playerAlive = true;
    bots.spawnRound(state.round, 'attack');
    bots.setCarrier(null);
    events.onRoundStart(state.round, state.score);
  }

  function endRound(winner, reason) {
    if (state.phase !== 'live' && state.phase !== 'buy') return;
    state.phase = 'over';
    state.overLeft = 4;
    state.overReason = reason;
    state.overWinner = winner;
    state.score[winner] += 1;
    state.money += winner === 'attack' ? WIN_MONEY : LOSS_MONEY;
    events.onRoundEnd(winner, reason, state.score, state.money);
    if (state.score[winner] >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
      state.matchWinner = winner;
    }
  }

  function step(dt) {
    state.time += dt;
    if (state.phase === 'buy') {
      state.buyLeft -= dt;
      if (state.buyLeft <= 0) {
        state.phase = 'live';
        state.roundLeft = ROUND_SECONDS;
        events.onPhase('live');
      }
      return;
    }
    if (state.phase === 'live') {
      if (state.bomb.state === 'planted') {
        state.bomb.timer -= dt;
        if (state.bomb.timer <= 0) {
          state.bomb.state = 'detonated';
          events.onBombDetonated(state.bomb.pos);
          endRound('attack', 'detonation');
          return;
        }
      } else {
        state.roundLeft -= dt;
        if (state.roundLeft <= 0) {
          endRound('defend', 'timeout');
          return;
        }
      }
      const attackAlive = (state.playerAlive ? 1 : 0) + bots.aliveCount('attack');
      const defendAlive = bots.aliveCount('defend');
      if (attackAlive === 0) {
        endRound('defend', 'elimination');
        return;
      }
      if (defendAlive === 0) {
        endRound('attack', 'elimination');
        return;
      }
      return;
    }
    if (state.phase === 'over') {
      state.overLeft -= dt;
      if (state.overLeft <= 0) {
        if (state.matchWinner) {
          state.phase = 'matchover';
          events.onMatchEnd(state.matchWinner, state.score);
        } else {
          startRound();
        }
      }
    }
  }

  function damagePlayer(amount, from, headshot) {
    if (!state.playerAlive || state.phase !== 'live') return;
    state.playerHp = Math.max(0, state.playerHp - amount);
    events.onPlayerHurt(state.playerHp);
    if (state.playerHp <= 0) {
      state.playerAlive = false;
      const killerName = from === 'player' ? 'YOU' : (from && from.name) || 'Unknown';
      feed(killerName, 'YOU', headshot);
      events.onPlayerDeath(from);
      if (state.bomb.state === 'carried' && state.bomb.carrier === 'player') {
        // The charge drops to the nearest living attacker bot.
        const carrier = bots.carrier();
        const alive = bots.bots.filter((b) => b.team === 'attack' && b.alive);
        if (alive.length > 0) {
          const p = { x: 0, z: 13 };
          alive.sort((a, b) => {
            const da = Math.hypot(a.mover.state.position.x - p.x, a.mover.state.position.z - p.z);
            const db = Math.hypot(b.mover.state.position.x - p.x, b.mover.state.position.z - p.z);
            return da - db;
          });
          bots.setCarrier(alive[0]);
          state.bomb.carrier = alive[0];
        } else {
          state.bomb.state = 'gone';
          state.bomb.carrier = null;
        }
      }
    }
  }

  function onBotKilled(killer, victim, headshot) {
    feed(killer === 'player' ? 'YOU' : killer.name, victim.name, headshot);
    if (killer === 'player') {
      state.playerKills += 1;
      state.money += KILL_MONEY;
      events.onMoney(state.money);
    }
    if (victim.isCarrier) {
      const alive = bots.bots.filter((b) => b.team === 'attack' && b.alive);
      if (alive.length > 0) {
        bots.setCarrier(alive[0]);
        state.bomb.carrier = alive[0];
      } else {
        state.bomb.state = 'gone';
        state.bomb.carrier = null;
      }
    }
  }

  function plantBomb(byPlayer) {
    if (state.bomb.state !== 'carried') return false;
    state.bomb.state = 'planted';
    state.bomb.timer = DETONATE_SECONDS;
    const carrier = state.bomb.carrier;
    state.bomb.pos = carrier === 'player'
      ? { x: 0, z: -11.5 }
      : { x: carrier.mover.state.position.x, z: carrier.mover.state.position.z };
    if (byPlayer) {
      state.money += PLANT_MONEY;
      events.onMoney(state.money);
    }
    events.onBombPlanted(state.bomb.pos);
    return true;
  }

  function defuseBomb() {
    if (state.bomb.state !== 'planted') return false;
    state.bomb.state = 'defused';
    events.onBombDefused();
    endRound('defend', 'defuse');
    return true;
  }

  function playerInSite(position) {
    return map.site.containsPoint(new THREE.Vector3(position.x, 1, position.z));
  }

  function buyWeapon(id, price) {
    if (state.money < price) return false;
    state.money -= price;
    events.onMoney(state.money);
    return true;
  }

  function buyGrenade(id, price) {
    if (state.money < price) return false;
    state.money -= price;
    events.onMoney(state.money);
    return true;
  }

  return {
    state,
    startMatch,
    startRound,
    endRound,
    step,
    damagePlayer,
    onBotKilled,
    plantBomb,
    defuseBomb,
    playerInSite,
    buyWeapon,
    buyGrenade,
  };
}
