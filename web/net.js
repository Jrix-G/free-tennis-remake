// Online play. The server (server/server.js) runs the authoritative simulation and consumes each
// player's inputs in order, one per tick. The client keeps its unacknowledged inputs and replays
// them on top of every server state with the same deterministic TennisLogic: its own player, its
// strokes and the ball respond at once, the opponent is extrapolated from their last pad and
// corrected by the next snapshot (rollback prediction). Corrections are blended into what is drawn
// (`shown`) over a few ticks instead of teleporting the ball or the players.
// The tick rate follows the server's input queue: a deep queue is pure added lag, an empty one makes
// the server guess our input, so the client runs a few % slower or faster to keep about one queued.
// DOM-free so the automated test can drive it from Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./game.js'));
  else root.TennisNet = factory(root.TennisLogic);
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';

  const TICK_MS = 1000 / 30;
  const STALE_MS = 1500;       // no snapshot for that long -> connection considered lost
  const MAX_PENDING = 90;      // ~3 s of inputs; beyond that the link is dead anyway
  const Q_TARGET = 1;          // inputs waiting in the server queue after each tick
  const SMOOTH = 0.7;          // share of a correction still visible one tick later
  const SNAP_P = 120, SNAP_B = 120;  // bigger jumps (new point, serve) are shown at once
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // ws(s)://<page host>/ws, or an explicit "host:port" (tests).
  function wsUrl(hostPort) {
    if (hostPort) return 'ws://' + hostPort + '/ws';
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  }

  // One WebSocket for the whole online session: lobby messages, then the match.
  class OnlineSession {
    constructor(ws) {
      this.ws = ws; this.me = -1; this.code = null; this.token = null; this.isPublic = false;
      this.peerOn = false; this.started = false; this.closed = false; this.online = 0; this.err = null;
      this.seq = 0; this.pending = []; this.server = null; this.ack = 0; this.paused = true;
      this.lastSnap = 0; this.lastPing = 0; this.rtt = null; this.view = null; this.onEvents = null;
      this.shown = null; this.off = null; this.qAvg = Q_TARGET;  // view + blended correction; server queue depth
      this.players = [null, null]; this.onProfile = null; this.result = null;  // players: [{ name, look }] for each side
      this.played = [];  // [tick, event] already played, so prediction and server don't double sounds
      this.bind(ws);
    }
    bind(ws) {  // new socket after a reconnection; the caller then re-joins with code + token
      this.ws = ws; this.lastSnap = now();
      ws.onmessage = (e) => this.onMsg(JSON.parse(e.data));
    }
    send(o) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
    quick() { this.send({ t: 'quick' }); }
    create() { this.send({ t: 'create' }); }
    join(code, token) { this.err = null; this.send({ t: 'join', code, token }); }
    leave() { this.send({ t: 'leave' }); this.reset(); }
    reset() { this.result = null; this.players = [null, null]; this.me = -1; this.code = null; this.started = false; this.peerOn = false; this.server = null; this.view = null; this.shown = null; this.off = null; this.pending = []; this.closed = false; }
    onMsg(m) {
      if (m.t === 'hello') { this.online = m.online; this.send({ t: 'ping', c: now() }); }  // keepalive answer
      else if (m.t === 'pong') this.rtt = now() - m.c;
      else if (m.t === 'err') { this.err = m.msg; if (this.code) this.closed = true; }
      else if (m.t === 'room') {
        if (this.code !== m.code) { this.seq = 0; this.pending = []; this.ack = 0; this.server = null; }
        Object.assign(this, { me: m.me, code: m.code, token: m.token, isPublic: m.public, err: null });
      } else if (m.t === 'peer') { this.peerOn = m.on; this.started = m.started; if (m.players) this.players = m.players; }
      else if (m.t === 'profile') { if (this.onProfile) this.onProfile(m.profile); }
      else if (m.t === 'result') this.result = m;  // ranked outcome: { won, elo (delta), xp }
      else if (m.t === 'closed') { this.closed = true; this.peerOn = false; }
      else if (m.t === 'snap') {
        this.lastSnap = now(); this.paused = m.paused; this.started = true;
        this.server = m.g; this.ack = m.ack;
        if (!m.paused && typeof m.q === 'number') this.qAvg += (m.q - this.qAvg) * 0.05;
        this.pending = this.pending.filter((p) => p.s > m.ack);
        this.sound(m.ev, m.g.tick);
        if (!this.view) this.predict();
      }
    }
    get lost() { return this.ws.readyState !== 1 || (this.lastSnap && now() - this.lastSnap > STALE_MS); }
    // Multiplier of the tick period: > 1 drains the server queue, < 1 refills it.
    get tickScale() {
      if (!this.server || this.paused || this.lost) return 1;
      return Math.min(1.08, Math.max(0.95, 1 + 0.04 * (this.qAvg - Q_TARGET)));
    }
    // Called at 30 Hz once the match runs: send this tick's input, then rebuild the prediction.
    tick(localPad) {
      if (this.me < 0) return;
      const k = { l: !!localPad.l, r: !!localPad.r, u: !!localPad.u, d: !!localPad.d, sp: !!localPad.sp };
      if (this.server && !this.paused && !this.lost) {
        this.seq++;
        this.pending.push({ s: this.seq, k });
        if (this.pending.length > MAX_PENDING) this.pending.shift();
        this.send({ t: 'in', s: this.seq, k });
      } else if (this.ws.readyState === 1) {
        this.seq++; this.send({ t: 'in', s: this.seq, k });  // keeps the server's "alive" clock
      }
      if (now() - this.lastPing > 1000) { this.lastPing = now(); this.send({ t: 'ping', c: now() }); }
      const before = this.view;
      this.predict();
      this.blend(before, k);
    }
    // Server state + replay of our pending inputs; the opponent keeps holding their last direction.
    predict() {
      if (!this.server) return;
      const g = JSON.parse(JSON.stringify(this.server));
      if (!this.paused && !g.over) {
        const opp = 1 - this.me, oppPad = Object.assign({}, g.pad[opp], { sp: false });
        const inputs = [null, null];
        for (const p of this.pending) {
          inputs[this.me] = p.k; inputs[opp] = oppPad;
          L.step(g, inputs);
          if (g.events.length) this.sound(g.events, g.tick);
        }
      }
      this.view = g;
      this.show();
    }
    // What the previous prediction expected for this tick vs what we now predict: that gap is a
    // correction from the server (opponent's stroke, input the server had to guess). Keep it as a
    // display offset that fades out.
    blend(before, k) {
      const g = this.view;
      if (!before || !g) return;
      let exp = before;
      if (g.tick === before.tick + 1 && !before.over) {
        exp = JSON.parse(JSON.stringify(before));
        const inputs = [null, null];
        inputs[this.me] = k; inputs[1 - this.me] = Object.assign({}, before.pad[1 - this.me], { sp: false });
        L.step(exp, inputs);
      } else if (g.tick !== before.tick) { this.off = null; return this.show(); }
      const o = this.off || { P: [[0, 0], [0, 0]], B: [0, 0, 0] };
      const fade = (a, d, snap) => (!d || d.some((x) => Math.abs(x) > snap) ? a.map(() => 0) : a.map((x, i) => x * SMOOTH + d[i]));
      for (let i = 0; i < 2; i++) {
        o.P[i] = fade(o.P[i], [exp.P[i].vx - g.P[i].vx, exp.P[i].vy - g.P[i].vy], SNAP_P);
      }
      const ball = exp.B.visible === g.B.visible ? [exp.B.vx - g.B.vx, exp.B.vy - g.B.vy, exp.B.vh - g.B.vh] : null;
      o.B = fade(o.B, ball, SNAP_B);
      const tiny = (a) => a.every((x) => Math.abs(x) < 0.05);
      this.off = tiny(o.P[0]) && tiny(o.P[1]) && tiny(o.B) ? null : o;
      this.show();
    }
    show() {
      const g = this.view, o = this.off;
      if (!g || !o) { this.shown = g; return; }
      const P = g.P.map((p, i) => Object.assign({}, p, { vx: p.vx + o.P[i][0], vy: p.vy + o.P[i][1] }));
      const B = Object.assign({}, g.B, { vx: g.B.vx + o.B[0], vy: g.B.vy + o.B[1], vh: Math.max(0, g.B.vh + o.B[2]) });
      this.shown = Object.assign({}, g, { P, B });
    }
    sound(events, tick) {
      const fresh = [];
      for (const e of events) {
        if (this.played.some(([t, x]) => x === e && Math.abs(t - tick) <= 4)) continue;
        this.played.push([tick, e]); fresh.push(e);
      }
      if (this.played.length > 64) this.played.splice(0, this.played.length - 64);
      if (fresh.length && this.onEvents) this.onEvents(fresh);
    }
  }

  return { OnlineSession, wsUrl, TICK_MS };
});
