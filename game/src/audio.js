// Sound: tiny WebAudio synth effects, no audio files. The context is created on the
// first user gesture; every call is a no-op before that or without a browser audio
// device, so the simulation never depends on sound.
export function createAudio() {
  let context = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (context) return true;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return false;
      context = new AudioContextClass();
      master = context.createGain();
      master.gain.value = 0.22;
      master.connect(context.destination);
      const length = context.sampleRate * 0.5;
      noiseBuffer = context.createBuffer(1, length, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  function unlock() {
    if (ensure() && context.state === 'suspended') context.resume().catch(() => {});
  }

  function noise(duration, filterFreq, gainValue, type = 'lowpass') {
    if (!ensure()) return;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start();
    source.stop(context.currentTime + duration);
  }

  function tone(freq, duration, gainValue, type = 'square', slideTo = null) {
    if (!ensure()) return;
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, context.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, context.currentTime + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    osc.connect(gain).connect(master);
    osc.start();
    osc.stop(context.currentTime + duration);
  }

  return {
    unlock,
    shot(kind) {
      if (kind === 'longshot') { noise(0.28, 900, 0.9); tone(160, 0.2, 0.5, 'sawtooth', 60); }
      else if (kind === 'hornet') { noise(0.09, 2400, 0.55); tone(320, 0.06, 0.3, 'square', 180); }
      else if (kind === 'picket') { noise(0.11, 1800, 0.6); tone(240, 0.08, 0.35, 'square', 120); }
      else { noise(0.14, 1600, 0.7); tone(200, 0.1, 0.4, 'sawtooth', 90); }
    },
    dryFire() { tone(1400, 0.04, 0.25, 'square'); },
    reload() { tone(700, 0.05, 0.25, 'square'); setTimeout(() => tone(500, 0.05, 0.25, 'square'), 140); },
    hit() { tone(1200, 0.05, 0.4, 'sine'); },
    kill() { tone(880, 0.08, 0.4, 'sine'); setTimeout(() => tone(1320, 0.1, 0.4, 'sine'), 70); },
    hurt() { tone(110, 0.18, 0.5, 'sawtooth', 70); },
    plantBeep(final) { tone(final ? 1500 : 1000, 0.07, 0.35, 'sine'); },
    explosion() {
      noise(0.9, 400, 1.0);
      tone(90, 0.8, 0.8, 'sine', 30);
    },
    roundWin() {
      tone(523, 0.12, 0.35, 'sine');
      setTimeout(() => tone(659, 0.12, 0.35, 'sine'), 120);
      setTimeout(() => tone(784, 0.22, 0.4, 'sine'), 240);
    },
    roundLose() {
      tone(392, 0.16, 0.35, 'sine');
      setTimeout(() => tone(311, 0.26, 0.35, 'sine'), 160);
    },
    buy() { tone(980, 0.06, 0.3, 'sine'); setTimeout(() => tone(1240, 0.08, 0.3, 'sine'), 60); },
    denied() { tone(220, 0.12, 0.35, 'square'); },
    click() { tone(800, 0.04, 0.25, 'sine'); },
  };
}
