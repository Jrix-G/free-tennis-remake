// Lag benchmark (not part of the suite): real 30 Hz server, clients behind a simulated link
// (one-way delay + jitter, in order like TCP) ticking from a 60 fps frame loop like the browser.
// Prints input -> ack latency and how far the drawn ball / opponent jump from one tick to the next.
// A 150 ms hiccup (Wi-Fi, TCP retransmission) hits each direction every few seconds.
// Run: node tests/lag_bench.js [oneWayMs=25] [jitterMs=30] [seconds=40]
const { spawn } = require('child_process');
const path = require('path');
const L = require('../web/game.js');
const N = require('../web/net.js');

const [DELAY, JITTER, SECS] = [25, 30, 40].map((d, i) => Number(process.argv[2 + i] || d));
const PORT = 8798, TICK = 1000 / 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function link(ws) {  // delays both directions, keeping the order (TCP)
  let upT = 0, downT = 0;
  const lag = (t) => Math.max(t, performance.now() + DELAY + Math.random() * JITTER + (Math.random() < 1 / 120 ? 150 : 0));
  const send = ws.send.bind(ws);
  ws.send = (d) => { upT = lag(upT); setTimeout(() => send(d), upT - performance.now()); };
  const fake = { readyState: 1, send: (d) => ws.send(d), close: () => ws.close() };
  ws.onmessage = (e) => { downT = lag(downT); setTimeout(() => fake.onmessage && fake.onmessage(e), downT - performance.now()); };
  return fake;
}
function open() {
  return new Promise((res) => { const ws = new WebSocket(N.wsUrl('127.0.0.1:' + PORT)); ws.onopen = () => res(link(ws)); });
}
function pad(g, pn, t) {
  const me = g.P[pn], B = g.B, k = {}, s = pn === 0 ? 1 : -1;
  const dx = (B.vx - me.vx) * s;
  if (dx > 15) k.r = true; else if (dx < -15) k.l = true;
  k.sp = t % 4 < 2 && (Math.abs(B.vy - me.vy) < 90 && Math.abs(B.vx - me.vx) < 60 || me.stat === L.C.PS_SERVE || (me.stat === L.C.PS_TOSS && me.cnt > 9) || g.space.on);
  return k;
}
const q = (a, p) => { a = a.slice().sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(1) : '-'; };

async function run(label, sessions) {
  const sent = new Map(), lat = [], ballJump = [], oppJump = [], depth = [];
  for (const s of sessions) {
    const send = s.send.bind(s);
    s.send = (o) => { if (o.t === 'in') sent.set(s.me + ':' + o.s, performance.now()); send(o); };
    const onMsg = s.onMsg.bind(s);
    s.onMsg = (m) => { if (m.t === 'snap' && !m.paused) { const t0 = sent.get(s.me + ':' + m.ack); if (t0) lat.push(performance.now() - t0); if (m.q != null) depth.push(m.q); } onMsg(m); };
  }
  const watch = sessions[0];
  let t = 0, last = performance.now(), acc = 0, prev = null;
  const end = performance.now() + SECS * 1000;
  while (performance.now() < end) {
    await sleep(16);
    const now = performance.now(); acc += now - last; last = now;
    const tick = TICK * (watch.tickScale || 1);
    while (acc >= tick) {
      acc -= tick; t++;
      for (const s of sessions) s.tick(s.view ? pad(s.view, s.me, t) : {});
      const g = watch.shown || watch.view;
      if (g && prev && !g.over && g.B.visible && prev.B.visible && prev.B.vy * g.B.vy >= 0 === prev.B.vy * g.B.vy >= 0) {
        const d = Math.hypot(g.B.vx - prev.B.vx, g.B.vy - prev.B.vy, g.B.vh - prev.B.vh);
        if (d < 150) ballJump.push(d);  // bigger: new point, not a correction
        const o = 1 - watch.me; oppJump.push(Math.hypot(g.P[o].vx - prev.P[o].vx, g.P[o].vy - prev.P[o].vy));
      }
      prev = g && JSON.parse(JSON.stringify({ B: g.B, P: g.P }));
    }
  }
  console.log(label.padEnd(16), 'input->ack ms p50', q(lat, 0.5), 'p90', q(lat, 0.9), '| ball step p50', q(ballJump, 0.5),
    'p99', q(ballJump, 0.99), 'max', q(ballJump, 1), '| opp step p99', q(oppJump, 0.99), 'max', q(oppJump, 1),
    '| rtt', watch.rtt && watch.rtt.toFixed(0), depth.length ? '| server queue avg ' + (depth.reduce((x, y) => x + y, 0) / depth.length).toFixed(2) : '');
  for (const s of sessions) s.leave();
}

(async () => {
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server', 'server.js'),
    '--port', String(PORT), '--host', '127.0.0.1', '--bot-wait-ms', '300', '--db', ':memory:'], { stdio: 'ignore' });
  try {
    await sleep(500);
    console.log('link: ' + DELAY + ' ms one way + 0-' + JITTER + ' ms jitter, ' + SECS + ' s per run');
    const a = new N.OnlineSession(await open());
    a.quick();
    while (!a.view) await sleep(20);
    await run('vs bot', [a]);
    const b = new N.OnlineSession(await open()), c = new N.OnlineSession(await open());
    b.create();
    while (!b.code) await sleep(20);
    c.join(b.code);
    while (!(b.view && c.view)) await sleep(20);
    await run('vs human', [b, c]);
  } finally { srv.kill(); process.exit(0); }
})();
