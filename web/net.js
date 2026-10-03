// Two-machine play. The host's browser runs the authoritative simulation (same TennisLogic as solo);
// the client only sends inputs and renders interpolated snapshots (+ prediction of its own movement).
// DOM-free so the automated test can drive it from Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./game.js'));
  else root.TennisNet = factory(root.TennisLogic);
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';

  const TICK_MS = 1000 / 30;
  const STALE_MS = 1500;       // no input for that long -> host pauses
  const INTERP_MS = 70;        // client renders other objects this far in the past
  const BALANCED = [5, 5, 5, 5, 0, 0];
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function wsUrl(hostPort, role) {
    return 'ws://' + hostPort + '/ws?role=' + role;
  }

  class HostSession {
    constructor(ws, opts) {
      this.ws = ws; this.opts = opts || {};
      this.peerOn = false; this.lastInput = 0; this.remote = {}; this.remoteSp = false;
      this.ack = 0; this.rtt = null; this.G = null; this.prevOverSp = [true, true];
      this.newMatch();
      ws.onmessage = (e) => this.onMsg(JSON.parse(e.data));
    }
    newMatch() {
      this.G = L.createMatch({
        names: ['P1', 'P2'], data: [BALANCED, BALANCED], ctrl: ['human', 'human'], matchMode: 0,
        seed: this.opts.seed !== undefined ? this.opts.seed : (Math.random() * 2 ** 32) >>> 0,
      });
    }
    onMsg(m) {
      if (m.t === 'peer') { this.peerOn = m.on; if (m.on) this.lastInput = now(); }
      else if (m.t === 'in') {
        if (m.s > this.ack) { this.ack = m.s; this.remote = m.k; }
        if (m.k.sp) this.remoteSp = true;   // latch taps shorter than a tick
        this.lastInput = now();
      } else if (m.t === 'ping') { this.rtt = m.rtt; this.send({ t: 'pong', c: m.c }); }
    }
    send(o) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
    get paused() { return !this.peerOn || now() - this.lastInput > STALE_MS; }
    // Called at 30 Hz by the host page (or the test). Returns the events of this tick.
    tick(localPad) {
      if (this.paused) { this.send({ t: 'snap', paused: true, ack: this.ack, g: this.G, ev: [] }); return []; }
      const remote = Object.assign({}, this.remote, { sp: !!(this.remote.sp || this.remoteSp) });
      this.remoteSp = false;
      if (this.G.over) {  // rematch when either player presses Space
        const sp = [!!localPad.sp, remote.sp];
        if ((sp[0] && !this.prevOverSp[0]) || (sp[1] && !this.prevOverSp[1])) this.newMatch();
        this.prevOverSp = sp;
      } else this.prevOverSp = [true, true];
      L.step(this.G, [localPad, remote]);
      const ev = this.G.events.slice();
      this.send({ t: 'snap', paused: false, ack: this.ack, g: this.G, ev });
      return ev;
    }
  }

  class ClientSession {
    constructor(ws) {
      this.ws = ws; this.seq = 0; this.pending = []; this.snaps = []; this.rtt = null;
      this.hostOn = false; this.lastSnap = 0; this.lastPing = 0; this.onEvents = null;
      ws.onmessage = (e) => this.onMsg(JSON.parse(e.data));
    }
    send(o) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
    onMsg(m) {
      if (m.t === 'peer') this.hostOn = m.on;
      else if (m.t === 'pong') this.rtt = now() - m.c;
      else if (m.t === 'snap') {
        this.hostOn = true; this.lastSnap = now(); this.paused = m.paused;
        this.snaps.push({ t: this.lastSnap, g: m.g });
        if (this.snaps.length > 8) this.snaps.shift();
        this.pending = this.pending.filter((p) => p.s > m.ack);
        if (m.ev.length && this.onEvents) this.onEvents(m.ev);
      }
    }
    get latest() { return this.snaps.length ? this.snaps[this.snaps.length - 1].g : null; }
    get lost() { return !this.hostOn || (this.lastSnap && now() - this.lastSnap > STALE_MS); }
    tick(localPad) {
      const k = { l: !!localPad.l, r: !!localPad.r, u: !!localPad.u, d: !!localPad.d, sp: !!localPad.sp };
      this.seq++;
      this.pending.push({ s: this.seq, k });
      if (this.pending.length > 60) this.pending.shift();
      this.send({ t: 'in', s: this.seq, k });
      if (now() - this.lastPing > 1000) { this.lastPing = now(); this.send({ t: 'ping', c: now(), rtt: this.rtt }); }
    }
    // State to draw: other objects interpolated INTERP_MS in the past, own player (P2) predicted.
    view() {
      const n = this.snaps.length;
      if (!n) return null;
      const g = JSON.parse(JSON.stringify(this.snaps[n - 1].g));
      const rt = now() - INTERP_MS;
      for (let i = n - 1; i > 0; i--) {
        const a = this.snaps[i - 1], b = this.snaps[i];
        if (a.t <= rt && rt <= b.t) {
          const u = (rt - a.t) / Math.max(1, b.t - a.t);
          const lerp = (x, y) => x + (y - x) * u;
          const jump = (x, y) => Math.abs(y - x) > 60;  // teleport (new point): no smoothing
          for (const k of ['vx', 'vy', 'vh']) if (!jump(a.g.B[k], b.g.B[k])) g.B[k] = lerp(a.g.B[k], b.g.B[k]);
          for (const k of ['vx', 'vy']) if (!jump(a.g.P[0][k], b.g.P[0][k])) g.P[0][k] = lerp(a.g.P[0][k], b.g.P[0][k]);
          break;
        }
      }
      const me = g.P[1];
      if (me.stat === L.C.PS_WAIT && !this.paused) {
        for (const p of this.pending) {
          const h = p.k.r ? 1 : p.k.l ? -1 : 0, v = p.k.u ? -1 : p.k.d ? 1 : 0;
          if (!h && !v) continue;
          me.vx -= h * me.footwork; me.vy -= v * me.footwork;
          if (!(me.vy < -20)) me.vy = -20;
        }
      }
      return g;
    }
  }

  return { HostSession, ClientSession, wsUrl, TICK_MS };
});
