// End-to-end online test: starts server/server.js with a fast clock, connects two real WebSocket
// clients, plays scripted points and checks matchmaking, prediction, rooms and reconnection.
// Run: node tests/net_test.js   (Node >= 22, or Node 20 with --experimental-websocket)
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const L = require('../web/game.js');
const N = require('../web/net.js');

const PORT = 8799, TICK = 5;  // server and clients tick every 5 ms (x6.7 real time)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bot(g, pn, t) {  // pad in the player's own screen frame
  const me = g.P[pn], B = g.B, k = {}, s = pn === 0 ? 1 : -1;
  const dx = (B.vx - me.vx) * s;
  if (dx > 15) k.r = true; else if (dx < -15) k.l = true;
  const near = Math.abs(B.vy - me.vy) < 90 && Math.abs(B.vx - me.vx) < 60;
  k.sp = t % 4 < 2 && (near || me.stat === L.C.PS_SERVE || (me.stat === L.C.PS_TOSS && me.cnt > 9) || g.space.on);
  return k;
}

function open() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(N.wsUrl('127.0.0.1:' + PORT));
    ws.onopen = () => res(ws);
    ws.onerror = rej;
  });
}
const waitFor = async (pred, ms, what) => {
  for (let t = 0; t < ms; t += 20) { if (pred()) return; await sleep(20); }
  throw new Error('timeout: ' + what);
};

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js'), '--port', String(PORT), '--host', '127.0.0.1', '--tick-ms', String(TICK)], { stdio: 'inherit' });
  try {
    await sleep(500);
    // --- quick match ---
    const a = new N.OnlineSession(await open()), b = new N.OnlineSession(await open());
    a.quick();
    await waitFor(() => a.code, 2000, 'room for a');
    assert.ok(!a.started, 'alone in the quick room');
    b.quick();
    await waitFor(() => a.started && b.started && a.view && b.view, 2000, 'match start');
    assert.strictEqual(a.code, b.code, 'paired in the same room');
    assert.deepStrictEqual([a.me, b.me], [0, 1]);

    // --- play: both clients predict; check their own predicted position against the server ---
    const predicted = [new Map(), new Map()];
    let hits = 0, checks = 0, t = 0, p2Moved = false, p2Served = false;
    const sessions = [a, b];
    b.onEvents = () => {};
    const startX = b.view.P[1].vx;
    while (t < 30000) {
      for (const s of sessions) {
        s.tick(bot(s.view, s.me, t));
        predicted[s.me].set(s.view.tick, s.view.P[s.me].vx + ',' + s.view.P[s.me].vy);
        const srvG = s.server, guess = predicted[s.me].get(srvG.tick);
        if (guess !== undefined && !s.paused) { checks++; if (guess === srvG.P[s.me].vx + ',' + srvG.P[s.me].vy) hits++; }
      }
      const G = a.server;
      if (G.P[1].vx !== startX) p2Moved = true;
      if (G.server === 1 && G.P[1].stat === L.C.PS_TOSS) p2Served = true;
      if (G.server === 1 && G.point[0] + G.point[1] >= 2) break;
      await sleep(TICK);
      t++;
    }
    const G = a.server;
    console.log('ticks', t, 'games', G.gpoint, 'score', JSON.stringify(G.score_txt), 'own-position prediction',
      (100 * hits / checks).toFixed(1) + '% of', checks, 'rtt', a.rtt && a.rtt.toFixed(1) + 'ms');
    assert.ok(t < 30000, 'points were played');
    assert.ok(p2Moved && p2Served, 'second player inputs reach the server simulation');
    assert.ok(hits / checks > 0.8, 'client prediction matches the server most of the time');
    assert.strictEqual(JSON.stringify(a.server), JSON.stringify(b.server), 'both clients got the same state');

    // --- reconnection: b drops, the match pauses, b comes back with its token ---
    const code = b.code, token = b.token;
    b.ws.close();
    await sleep(100);
    for (let i = 0; i < 20; i++) { a.tick({}); await sleep(TICK); }
    assert.ok(a.paused && !a.peerOn, 'match paused while the opponent is away');
    b.bind(await open());
    b.join(code, token);
    await waitFor(() => b.me === 1 && a.peerOn, 2000, 'rejoin');
    for (let i = 0; i < 40; i++) { a.tick({}); b.tick({}); await sleep(TICK); }
    assert.ok(!a.paused && !b.paused, 'match resumes after reconnection');

    // --- private room, wrong code, explicit leave ---
    const c = new N.OnlineSession(await open()), d = new N.OnlineSession(await open());
    d.join('ZZZZ');
    await waitFor(() => d.err, 2000, 'unknown code error');
    d.err = null;
    d.join(code);
    await waitFor(() => d.err, 2000, 'full room refused');
    c.create();
    await waitFor(() => c.code, 2000, 'private room');
    d.join(c.code);
    await waitFor(() => c.started && d.started && d.me === 1, 2000, 'private match start');
    c.leave();
    await waitFor(() => d.closed, 2000, 'opponent told about the leave');

    for (const s of [a, b, c, d]) s.ws.close();
    console.log('net OK');
  } finally {
    srv.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
