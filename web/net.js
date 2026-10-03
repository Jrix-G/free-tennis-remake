// Online play. The server (server/server.js) runs the authoritative simulation and consumes each
// player's inputs in order, one per tick. The client keeps its unacknowledged inputs and replays
// them on top of every server state with the same deterministic TennisLogic: its own player, its
// strokes and the ball respond at once, the opponent is extrapolated from their last pad and
// corrected by the next snapshot (rollback prediction).
// DOM-free so the automated test can drive it from Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./game.js'));
  else root.TennisNet = factory(root.TennisLogic);
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';

  const TICK_MS = 1000 / 30;
  const STALE_MS = 1500;       // no snapshot for that long -> connection considered lost
  const MAX_PENDING = 90;      // ~3 s of inputs; beyond that the link is dead anyway
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
    reset() { this.me = -1; this.code = null; this.started = false; this.peerOn = false; this.server = null; this.view = null; this.pending = []; this.closed = false; }
    onMsg(m) {
      if (m.t === 'hello') { this.online = m.online; this.send({ t: 'ping', c: now() }); }  // keepalive answer
      else if (m.t === 'pong') this.rtt = now() - m.c;
      else if (m.t === 'err') { this.err = m.msg; if (this.code) this.closed = true; }
      else if (m.t === 'room') {
        if (this.code !== m.code) { this.seq = 0; this.pending = []; this.ack = 0; this.server = null; }
        Object.assign(this, { me: m.me, code: m.code, token: m.token, isPublic: m.public, err: null });
      } else if (m.t === 'peer') { this.peerOn = m.on; this.started = m.started; }
      else if (m.t === 'closed') { this.closed = true; this.peerOn = false; }
      else if (m.t === 'snap') {
        this.lastSnap = now(); this.paused = m.paused; this.started = true;
        this.server = m.g; this.ack = m.ack;
        this.pending = this.pending.filter((p) => p.s > m.ack);
        this.sound(m.ev, m.g.tick);
        if (!this.view) this.predict();
      }
    }
    get lost() { return this.ws.readyState !== 1 || (this.lastSnap && now() - this.lastSnap > STALE_MS); }
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
      this.predict();
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
