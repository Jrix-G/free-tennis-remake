// Synthesised sounds (WebAudio): hit, bounce, applause, button chime, two small music loops.
(function (root) {
  'use strict';
  let ac = null, master = null, music = null, musicName = null, muted = false;

  function ctx() {
    if (!ac) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ac = new AC(); master = ac.createGain(); master.gain.value = 0.6; master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function noiseBuf(sec) {
    const b = ac.createBuffer(1, ac.sampleRate * sec, ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function tone(freq, t, dur, type, vol, dest, slide) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || master); o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(t, dur, freq, q, vol) {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf(dur + 0.05); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.05);
  }

  function applause(sec) {
    const t0 = ac.currentTime;
    for (let i = 0; i < sec * 70; i++) {
      const t = t0 + Math.random() * sec, fade = 1 - (t - t0) / sec;
      noise(t, 0.03, 1200 + Math.random() * 1800, 1.5, 0.25 * fade + 0.02);
    }
  }

  const SFX = {
    hit() { const t = ac.currentTime; noise(t, 0.05, 2400, 1, 0.9); tone(900, t, 0.06, 'triangle', 0.5, null, 300); },
    bound() { const t = ac.currentTime; tone(220, t, 0.07, 'sine', 0.6, null, 90); noise(t, 0.03, 800, 1, 0.3); },
    app() { applause(1.6); },
    app2() { applause(3.5); },
    space() { const t = ac.currentTime; tone(1320, t, 0.12, 'square', 0.12); tone(1760, t + 0.07, 0.18, 'square', 0.12); },
    click() { tone(880, ac.currentTime, 0.06, 'square', 0.1); },
    out() { const t = ac.currentTime; tone(150, t, 0.12, 'square', 0.12, null, 90); },
  };

  // Music: [melody notes (semitones from A4, null = rest)], step seconds.
  const SONGS = {
    title: { step: 0.13, mel: [0, 7, 12, 7, 4, 7, 14, 12, 2, 9, 14, 9, 5, 9, 16, 14, 4, 11, 16, 11, 7, 11, 19, 16, 5, 12, 17, 12, 9, 12, 19, 17], bass: [-24, -24, -17, -17, -22, -22, -15, -15], wave: 'triangle', lead: 'square' },
    start: { step: 0.13, mel: [12, null, 12, 14, 16, null, 12, null, 17, 16, 14, 12, 14, null, 7, null], bass: [-12, -5, -10, -5] },
  };

  function playMusic(name) {
    if (musicName === name) return;
    stopMusic();
    musicName = name;
    if (!ctx() || !SONGS[name]) return;
    const song = SONGS[name], bus = ac.createGain();
    bus.gain.value = muted ? 0 : 0.18; bus.connect(master);
    let next = ac.currentTime + 0.05, i = 0;
    const hz = (n) => 440 * Math.pow(2, n / 12);
    const timer = setInterval(() => {
      while (next < ac.currentTime + 0.3) {
        const n = song.mel[i % song.mel.length];
        if (n !== null) {
          tone(hz(n), next, song.step * 0.82, song.lead || 'square', 0.22, bus);
          if (name === 'title' && i % 2 === 0) tone(hz(n + 7), next, song.step * 1.5, 'sine', 0.09, bus);
        }
        if (i % 4 === 0) tone(hz(song.bass[(i / 4) % song.bass.length]), next, song.step * 3.5, 'triangle', 0.42, bus);
        next += song.step; i++;
      }
    }, 60);
    music = { bus, timer };
  }

  function stopMusic() {
    if (music) { clearInterval(music.timer); music.bus.gain.value = 0; setTimeout(((b) => () => b.disconnect())(music.bus), 400); }
    music = null; musicName = null;
  }

  function play(name) { if (!muted && ctx() && SFX[name]) SFX[name](); }
  function toggleMute() { muted = !muted; if (music) music.bus.gain.value = muted ? 0 : 0.18; return muted; }

  root.TennisAudio = { play, playMusic, stopMusic, toggleMute, unlock: ctx };
})(typeof self !== 'undefined' ? self : this);
