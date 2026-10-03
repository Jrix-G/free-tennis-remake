// Logic sanity + determinism: a scripted bot plays vs the AI.
const L = require('../web/game.js');
const assert = require('assert');

function bot(G, pn) {
  // Chase the ball laterally, swing when it is close; press space to serve/confirm.
  const me = G.P[pn], B = G.B, k = {};
  const s = pn === 0 ? 1 : -1;
  const dx = (B.vx - me.vx) * s;
  if (dx > 15) k.r = true; else if (dx < -15) k.l = true;
  const near = Math.abs(B.vy - me.vy) < 90 && Math.abs(B.vx - me.vx) < 60;
  k.sp = (G.tick % 3 === 0) && (near || me.stat === L.C.PS_SERVE || (me.stat === L.C.PS_TOSS && me.cnt > 9) || G.space.on);
  return k;
}

function play(seed, ticks, ctrl1) {
  const G = L.createMatch({ names: ['YOU', 'COM'], data: [[5, 3, 6, 4, 0, 0], [4, 5, 4, 5, 5, 0]], ctrl: ['human', ctrl1], matchMode: 0, seed });
  const ev = {};
  let i = 0;
  for (; i < ticks && !G.over; i++) {
    L.step(G, [bot(G, 0), ctrl1 === 'human' ? bot(G, 1) : {}]);
    for (const e of G.events) ev[e] = (ev[e] || 0) + 1;
  }
  return { G, ev, i };
}

const a = play(42, 60000, 'ai'), b = play(42, 60000, 'ai');
assert.deepStrictEqual(JSON.stringify(a.G), JSON.stringify(b.G), 'determinism');
console.log('vs AI: ticks', a.i, 'games', a.G.gpoint, 'over', a.G.over, 'winner', a.G.match_winner, 'events', a.ev);
assert.ok(a.G.over, 'match should finish');
assert.ok(a.ev.hit > 20 && a.ev.bound > 20, 'rallies happen');

const h = play(7, 60000, 'human');
console.log('2 humans: ticks', h.i, 'games', h.G.gpoint, 'over', h.G.over, 'events', h.ev);
assert.ok(h.G.over, 'human-vs-human match should finish');
console.log('logic OK');
