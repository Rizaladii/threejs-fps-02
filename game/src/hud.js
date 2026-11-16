// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score, alive
// counts, kill feed, bomb status, channel bar, damage flash and the buy menu. It
// never touches the simulation; main.js pushes numbers in and reads callbacks out.
import { WEAPONS, GRENADES } from './weapons.js';

const OVERLAY_COPY = {
  start: {
    title: 'FOUNDRY',
    copy: 'Five attackers, five defenders, one charge. Plant it at the Kiln or wipe the defenders out. First to 5 rounds takes the match.',
    action: 'Click to play',
  },
  paused: {
    title: 'FOUNDRY',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  round: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
  match: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const healthFill = $('health-fill');
  const healthValue = $('health-value');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const scoreAttack = $('score-attack');
  const scoreDefend = $('score-defend');
  const aliveAttack = $('alive-attack');
  const aliveDefend = $('alive-defend');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const bombStatus = $('bomb-status');
  const channel = $('channel');
  const channelFill = $('channel-fill');
  const channelLabel = $('channel-label');
  const grenadeCounts = $('grenade-counts');
  const hitmarker = $('hitmarker');
  const damageFlash = $('damage-flash');
  const crosshair = $('crosshair');
  const buyMenu = $('buy-menu');
  const buyItems = $('buy-items');
  const buyMoney = $('buy-money');
  const ammo = $('ammo');

  let hitTimer = 0;
  let bannerTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastWeapon = '';
  let lastHp = -1;
  let lastMoney = -1;
  let lastTimer = '';
  let lastScore = '';
  let lastAlive = '';
  let lastGrenades = '';
  let lastBomb = '';

  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    setAmmo(mag, reserve, weapon) {
      if (mag === lastMag && reserve === lastReserve && weapon === lastWeapon) return;
      lastMag = mag;
      lastReserve = reserve;
      lastWeapon = weapon;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      weaponName.textContent = weapon;
      ammo.classList.toggle('empty', mag === 0);
    },
    setHealth(hp) {
      const value = Math.max(0, Math.round(hp));
      if (value === lastHp) return;
      lastHp = value;
      healthValue.textContent = String(value);
      healthFill.style.width = `${value}%`;
      healthFill.classList.toggle('low', value <= 30);
    },
    setMoney(money) {
      if (money === lastMoney) return;
      lastMoney = money;
      moneyValue.textContent = `$${money}`;
      buyMoney.textContent = `$${money}`;
    },
    setTimer(seconds, phase) {
      const text = phase === 'buy' ? `BUY ${formatTime(seconds)}` : formatTime(seconds);
      if (text === lastTimer) return;
      lastTimer = text;
      timerValue.textContent = text;
      timerValue.classList.toggle('urgent', phase === 'live' && seconds <= 15);
    },
    setScore(attack, defend) {
      const text = `${attack}-${defend}`;
      if (text === lastScore) return;
      lastScore = text;
      scoreAttack.textContent = String(attack);
      scoreDefend.textContent = String(defend);
    },
    setAlive(attack, defend) {
      const text = `${attack}/${defend}`;
      if (text === lastAlive) return;
      lastAlive = text;
      aliveAttack.textContent = String(attack);
      aliveDefend.textContent = String(defend);
    },
    setGrenades(ember, veil) {
      const text = `${ember}/${veil}`;
      if (text === lastGrenades) return;
      lastGrenades = text;
      grenadeCounts.textContent = `HE ${ember}  ·  SMOKE ${veil}`;
    },
    setBomb(text, danger) {
      if (text === lastBomb) return;
      lastBomb = text;
      bombStatus.textContent = text;
      bombStatus.classList.toggle('danger', !!danger);
      bombStatus.hidden = text === '';
    },
    setChannel(progress, label) {
      if (progress <= 0) {
        channel.hidden = true;
        return;
      }
      channel.hidden = false;
      channelFill.style.width = `${Math.round(progress * 100)}%`;
      channelLabel.textContent = label;
    },
    setKillfeed(entries) {
      killfeed.innerHTML = entries.map((entry) => {
        const head = entry.headshot ? ' <span class="headshot">HEADSHOT</span>' : '';
        return `<div><b>${entry.killer}</b> ▸ ${entry.victim}${head}</div>`;
      }).join('');
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.25)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    damageFlash() {
      damageFlash.classList.add('on');
      setTimeout(() => damageFlash.classList.remove('on'), 140);
    },
    setCrosshairGap(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    showBanner(titleText, subText, ms = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { banner.hidden = true; }, ms);
    },
    hideBanner() {
      banner.hidden = true;
    },
    showOverlay(mode, detail) {
      const text = OVERLAY_COPY[mode];
      title.textContent = text.title;
      copy.textContent = detail ?? text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    showBuy(show, money, owned, grenades) {
      buyMenu.hidden = !show;
      if (!show) return;
      buyMoney.textContent = `$${money}`;
      const items = [];
      for (const def of Object.values(WEAPONS)) {
        if (def.id === 'picket') continue;
        const has = !!owned[def.id];
        items.push(`<button class="buy-item" data-buy="${def.id}" ${has ? 'disabled' : ''}>
          <span class="buy-key">${def.id === 'rook' ? '1' : def.id === 'hornet' ? '2' : '3'}</span>
          <span class="buy-name">${def.name}</span>
          <span class="buy-stat">${def.damage} dmg · ${def.mag} mag</span>
          <span class="buy-price">${has ? 'OWNED' : '$' + def.price}</span>
        </button>`);
      }
      for (const def of Object.values(GRENADES)) {
        items.push(`<button class="buy-item" data-buy-grenade="${def.id}">
          <span class="buy-key">${def.id === 'ember' ? '5' : '6'}</span>
          <span class="buy-name">${def.name}</span>
          <span class="buy-stat">${def.kind === 'he' ? 'blast ' + def.radius + 'm' : 'smoke ' + def.duration + 's'}</span>
          <span class="buy-price">$${def.price} · x${grenades[def.id]}</span>
        </button>`);
      }
      buyItems.innerHTML = items.join('');
    },
    onBuy(handler) {
      buyItems.addEventListener('click', (event) => {
        const button = event.target.closest('[data-buy], [data-buy-grenade]');
        if (!button) return;
        if (button.dataset.buy) handler({ weapon: button.dataset.buy });
        else handler({ grenade: button.dataset.buyGrenade });
      });
    },
  };
}
