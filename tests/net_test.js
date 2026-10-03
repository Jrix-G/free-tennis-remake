// End-to-end 2-player test on localhost: starts tennis.py, connects a simulated host and client
// over real WebSockets, plays scripted points and checks both sides agree.
// Run: node --experimental-websocket tests/net_test.js   (Node >= 22: flag not needed)
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const L = require('../web/game.js');
const N = require('../web/net.js');

const PORT = 8799;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const py = process.platform === 'win32' ? 'python' : 'python3';

function bot(g, pn, t) {  // pad in the player's own screen frame
  const me = g.P[pn], B = g.B, k = {}, s = pn === 0 ? 1 : -1;
  const dx = (B.vx - me.vx) * s;
  if (dx > 15) k.r = true; else if (dx < -15) k.l = true;
  const near = Math.abs(B.vy - me.vy) < 90 && Math.abs(B.vx - me.vx) < 60;
  k.sp = t % 4 < 2 && (near || me.stat === L.C.PS_SERVE || (me.stat === L.C.PS_TOSS && me.cnt > 9) || g.space.on);
  return k;
}

function open(role) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(N.wsUrl('127.0.0.1:' + PORT, role));
    ws.onopen = () => res(ws);
    ws.onerror = rej;
  });
}

(async () => {
  const srv = spawn(py, [path.join(__dirname, '..', 'tennis.py'), '--port', String(PORT), '--no-browser'], { stdio: 'ignore' });
  try {
    await sleep(800);
    const hws = await open('host');
    const host = new N.HostSession(hws, { seed: 1234 });
    const cws = await open('client');
    const client = new N.ClientSession(cws);
    await sleep(200);
    assert.ok(host.peerOn && client.hostOn, 'peers see each other');

    let t = 0, clientMoved = false, p2Served = false;
    const startX = host.G.P[1].vx;
    // Accelerated real time (5 ms/tick) until one game is over and P2 (the client) has served points in the second game.
    while (!(host.G.server === 1 && host.G.point[0] + host.G.point[1] >= 2) && t < 40000) {
      const cg = client.latest || host.G;
      client.tick(bot(cg, 1, t));
      await sleep(5);
      host.tick(bot(host.G, 0, t));
      if (host.G.P[1].vx !== startX) clientMoved = true;
      if (host.G.server === 1 && host.G.P[1].stat === L.C.PS_TOSS) p2Served = true;
      t++;
    }
    await sleep(200);
    host.tick({});           // one more snapshot after the client caught up
    await sleep(200);
    const hg = host.G, cg = client.latest;
    console.log('ticks', t, 'points', hg.point, 'games', hg.gpoint, 'score', JSON.stringify(hg.score_txt), 'rtt', client.rtt && client.rtt.toFixed(1) + 'ms');
    assert.ok(t < 40000, 'points were played');
    assert.ok(p2Served, 'client served (its Space reaches the host)');
    assert.ok(clientMoved, 'client inputs reach the host simulation');
    assert.strictEqual(JSON.stringify(cg), JSON.stringify(hg), 'client state == host state');
    assert.ok(client.view(), 'client can build a render view');

    // Disconnect handling: host pauses when the client leaves.
    cws.close();
    await sleep(300);
    const tickBefore = host.G.tick;
    host.tick({});
    assert.ok(host.paused && host.G.tick === tickBefore, 'host pauses without peer');
    hws.close();
    console.log('net OK', p2Served ? '(P2 served)' : '');
  } finally {
    srv.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
