// Meta-game rules and economy: every reward is server-side, atomic and claimable once.
// Also guards the performance budgets (tick cost, snapshot size) and determinism with decks/events.
const assert = require('assert');
const { open } = require('../server/db.js');
const L = require('../web/game.js');
const M = require('../web/meta.js');
const CO = require('../web/cosmetics.js');
const Cards = require('../web/cards.js');
const PG = require('../web/progression.js');

let clock = Date.UTC(2026, 9, 7, 10);  // a Wednesday, season 0
const db = open(':memory:', () => clock), mt = db.meta;
const H = 3600e3, DAY = 864e5;
const coins = (id) => db.user(id).coins;

const a = db.loginGoogle('sub-a', 'a@x').id, b = db.loginGoogle('sub-b', 'b@x').id, c = db.loginGoogle('sub-c', 'c@x').id;

// ---------- first match: guaranteed chest, quests progress ----------
let r = db.recordMatch(a, { won: false, newElo: 990, games: 1, cards: 2 });
assert.strictEqual(r.chest, 'Coffre en bois', 'first match gives a chest even on a loss');
assert.strictEqual(r.trophies, 0, 'trophies never go below 0');
assert.strictEqual(db.recordMatch(a, { won: false, newElo: 980 }).chest, null, 'no chest for a later loss');

// ---------- chests: one unlocking at a time, timer, gem skip, single claim ----------
let v = mt.view(a);
const ch = v.chests[0];
assert.ok(mt.openChest(a, ch.id).error, 'locked chest cannot open');
assert.strictEqual(mt.startChest(a, ch.id), null);
assert.ok(mt.startChest(a, ch.id), 'cannot start twice');
assert.ok(mt.openChest(a, ch.id).error, 'not ready before its timer');
clock += M.CHESTS.wood.secs * 1000;
const before = coins(a), opened = mt.openChest(a, ch.id);
assert.ok(opened.reward && opened.reward.coins >= 20, 'ready chest opens');
assert.strictEqual(coins(a), before + opened.reward.coins, 'coins credited once');
assert.ok(mt.openChest(a, ch.id).error, 'a chest opens only once');
const copies = Object.values(opened.reward.cards).reduce((x, y) => x + y, 0);
assert.strictEqual(copies, M.CHESTS.wood.cards, 'card copies granted');
assert.strictEqual(JSON.stringify(M.chestContents('gold', 1234)), JSON.stringify(M.chestContents('gold', 1234)), 'contents follow the seed');

// four slots at most
for (let i = 0; i < 6; i++) mt.giveChest(b, 'wood');
assert.strictEqual(mt.view(b).chests.length, M.CHEST_SLOTS, 'chest slots capped');
// gem skip: no gems -> refused, with gems -> opens and charges
const cb = mt.view(b).chests[0];
assert.strictEqual(mt.openChest(b, cb.id, true).error, 'Pas assez de gemmes');
assert.ok(mt.creditGems('order-1', b, 30));
assert.ok(!mt.creditGems('order-1', b, 30), 'a purchase ref is credited once');
const sk = mt.openChest(b, cb.id, true);
assert.ok(sk.reward && sk.reward.gems < 0, 'skip charges gems');
assert.strictEqual(db.user(b).gems, 30 + sk.reward.gems);

// ---------- trophies, arenas, weekly ----------
for (let i = 0; i < 11; i++) db.recordMatch(c, { won: true, newElo: 1000 + i });
let uc = db.user(c);
assert.strictEqual(uc.trophies, 330);
assert.strictEqual(M.arena(uc.trophies), 1, 'reached arena 2');
assert.ok(uc.coins >= 11 * CO.COINS_WIN + M.ARENAS[1].reward, 'win coins + arena reward');
assert.strictEqual(mt.weeklyTop(5)[0].trophies, 330, 'weekly ranking');
assert.strictEqual(db.recordMatch(c, { won: false, newElo: 990 }).trophies, -M.TROPHY_LOSS);
const ev = db.recordMatch(c, { won: true, newElo: 1, event: 'fast' });
assert.strictEqual(ev.trophies, 0, 'event matches never move trophies');
assert.strictEqual(db.user(c).elo, 990, 'nor Elo');

// ---------- characters and court skins unlock by arena ----------
assert.ok(mt.setChar(a, 'hitter'), 'locked character refused');
assert.strictEqual(mt.setChar(c, 'hitter'), null);
assert.ok(db.shop(a, 'equip', 'court', 'grass'), 'arena court locked below its arena');
assert.strictEqual(db.shop(c, 'equip', 'court', 'grass'), null);
assert.strictEqual(db.shop(c, 'buy', 'court', 'aurora'), 'Article du pass de saison', 'pass items are not for sale');
assert.ok(db.shop(c, 'equip', 'court', 'aurora'), 'nor equippable before the pass grants them');

// ---------- cards: deck validation and upgrades ----------
assert.ok(mt.setDeck(a, ['return', 'return', 'focus']), 'duplicates refused');
assert.ok(mt.setDeck(a, ['return', 'focus']), 'wrong size refused');
const ownedCards = Object.keys(mt.view(c).cards);
const deck = ownedCards.slice(0, 3);
assert.strictEqual(mt.setDeck(c, deck), null);
assert.deepStrictEqual(mt.view(c).deck, deck);
const notOwned = Cards.CARDS.map((x) => x.id).find((id) => !mt.view(a).cards[id]);
if (notOwned) assert.strictEqual(mt.setDeck(a, ['return', 'focus', notOwned]), 'Carte non possédée');
mt.creditGems('x', c, 1);
const card = Object.entries(mt.view(c).cards).find(([, s]) => s.copies >= Cards.UPGRADE[0].copies);
if (card) {
  const lv = card[1].level, cBefore = coins(c);
  assert.strictEqual(mt.upgradeCard(c, card[0]), null);
  assert.strictEqual(mt.view(c).cards[card[0]].level, lv + 1);
  assert.strictEqual(coins(c), cBefore - Cards.UPGRADE[lv - 1].coins);
}
assert.strictEqual(mt.upgradeCard(a, 'focus'), 'Pas assez de cartes');

// ---------- daily quests ----------
const qs = mt.quests(a);
assert.strictEqual(qs.length, 3);
assert.ok(mt.claimQuest(a, 0), 'unfinished quest refused');
for (let i = 0; i < 6; i++) db.recordMatch(a, { won: true, newElo: 1000, games: 3, cards: 3 });
const done = mt.quests(a).filter((x) => x.progress >= x.goal);
assert.ok(done.length, 'quests progress with matches');
const cq = coins(a);
assert.strictEqual(mt.claimQuest(a, done[0].slot), null);
assert.strictEqual(coins(a), cq + done[0].reward);
assert.ok(mt.claimQuest(a, done[0].slot), 'a quest is claimed once');
assert.deepStrictEqual(M.dailyQuests(5, '2026-10-07'), M.dailyQuests(5, '2026-10-07'), 'same quests all day');

// ---------- daily login streak (Paris days) ----------
assert.strictEqual(mt.claimLogin(b), null);
assert.ok(mt.claimLogin(b), 'once per day');
clock += DAY; assert.strictEqual(mt.view(b).login.streak, 2, 'streak continues the next day');
mt.claimLogin(b);
clock += 2 * DAY; assert.strictEqual(mt.view(b).login.streak, 1, 'a missed day resets the streak');

// ---------- season pass ----------
const p0 = mt.view(c).pass;
assert.ok(p0.xp > 0, 'matches give pass XP');
assert.ok(mt.claimPass(c, M.PASS_TIERS, false), 'tier not reached');
assert.strictEqual(mt.claimPass(c, 1, false), p0.tier >= 1 ? null : 'Palier pas encore atteint');
if (p0.tier >= 1) assert.ok(mt.claimPass(c, 1, false), 'tier claimed once');
assert.strictEqual(mt.claimPass(c, 1, true), 'Pass premium requis');
assert.strictEqual(mt.buyPass(c), 'Pas assez de gemmes');
mt.creditGems('order-2', c, M.PASS_PRICE);
assert.strictEqual(mt.buyPass(c), null);
assert.ok(mt.buyPass(c), 'premium bought once');
if (p0.tier >= 1) assert.strictEqual(mt.claimPass(c, 1, true), null);
// premium tier 10 grants the aurora court, then it can be equipped
db.recordMatch(c, { won: true, newElo: 1000 });
const xpNeeded = 10 * M.PASS_TIER_XP;
while (mt.view(c).pass.xp < xpNeeded) db.recordMatch(c, { won: true, newElo: 1000, event: 'fast' });
assert.strictEqual(mt.claimPass(c, 10, true), null);
assert.strictEqual(db.shop(c, 'equip', 'court', 'aurora'), null, 'pass cosmetic equippable once granted');

// season rollover: trophies above 1000 are halved, pass restarts
const tBefore = db.user(c).trophies;
clock = M.seasonEnd(clock) + H;
const uc2 = db.user(c);
assert.strictEqual(uc2.trophies, M.seasonReset(tBefore));
assert.strictEqual(uc2.pass_xp, 0); assert.strictEqual(uc2.pass_premium, 0);
assert.strictEqual(M.seasonReset(1600), 1300);

// ---------- clubs ----------
assert.ok(mt.createClub(a, 'x'), 'short club name refused');
assert.strictEqual(mt.createClub(a, 'Les Aces'), null);
assert.ok(mt.createClub(b, 'les aces'), 'club names are unique');
const club = mt.clubView(a);
assert.strictEqual(mt.joinClub(b, club.id), null);
assert.ok(mt.joinClub(b, club.id), 'already in a club');
assert.strictEqual(mt.postMessage(b, '  salut   tout le monde '), null);
assert.strictEqual(mt.clubView(a).messages[0].text, 'salut tout le monde');
assert.ok(mt.donate(a, c, 'focus'), 'cannot donate outside the club');
const giveCard = Object.entries(mt.view(a).cards).find(([, s]) => s.copies > 0);
if (giveCard) {
  const had = (mt.view(b).cards[giveCard[0]] || { copies: 0 }).copies;
  assert.strictEqual(mt.donate(a, b, giveCard[0]), null);
  assert.strictEqual(mt.view(b).cards[giveCard[0]].copies, had + 1);
}
assert.strictEqual(mt.leaveClub(a), null);
assert.strictEqual(mt.clubView(b).members[0].owner, true, 'ownership passes on');
assert.strictEqual(mt.leaveClub(b), null);
assert.strictEqual(mt.clubs('aces').length, 0, 'an empty club is removed');

// ---------- court skins keep the white lines and the yellow ball readable ----------
const lum = (hex) => {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const ratio = (x, y) => (Math.max(lum(x), lum(y)) + 0.05) / (Math.min(lum(x), lum(y)) + 0.05);
for (const it of CO.CATALOG.court.filter((x) => x.surface)) {
  assert.ok(ratio(it.surface, '#ffffff') >= 2.5, it.id + ' vs white lines: ' + ratio(it.surface, '#ffffff').toFixed(2));
  assert.ok(ratio(it.surface, '#ffff00') >= 2.2, it.id + ' vs yellow ball: ' + ratio(it.surface, '#ffff00').toFixed(2));
}

// ---------- determinism with decks, levels and events; budgets ----------
function bot(G, pn, t) {
  const me = G.P[pn], B = G.B, k = {}, s = pn === 0 ? 1 : -1, dx = (B.vx - me.vx) * s;
  if (dx > 15) k.r = true; else if (dx < -15) k.l = true;
  const near = Math.abs(B.vy - me.vy) < 90 && Math.abs(B.vx - me.vx) < 60;
  k.sp = t % 3 === 0 && (near || me.stat === L.C.PS_SERVE || (me.stat === L.C.PS_TOSS && me.cnt > 9) || G.space.on);
  k.sh = t % 50 < 10; k.tp = t % 7 === 0; k.sl = t % 11 === 0; k.a = t % 40 === 0; k.n = t % 97 < 3;
  return k;
}
function play(event, seed) {
  const G = L.createMatch({
    names: ['A', 'B'], data: [PG.matchData([5, 5, 5, 5]), PG.matchData([5, 5, 5, 5], [0, 0, 1, 0])], ctrl: ['human', 'human'], seed,
    decks: [['wall', 'focus', 'net-rush'], ['heavy-ball', 'wrong-foot', 'second-wind']], levels: [[1, 5, 10], [3, 3, 3]], event,
  });
  let maxSnap = 0, cardsUsed = 0;
  const times = [];
  for (let t = 0; t < 120000 && !G.over; t++) {
    const t0 = process.hrtime.bigint();
    L.step(G, [bot(G, 0, t), bot(G, 1, t + 5)]);
    const snap = JSON.stringify(G, (key, val) => (L.MATCH_KEYS.includes(key) ? undefined : val));
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    maxSnap = Math.max(maxSnap, snap.length);
    if (G.events.includes('card')) cardsUsed++;
  }
  times.sort((x, y) => x - y);
  return { G, maxSnap, cardsUsed, p99: times[Math.floor(times.length * 0.99)] };
}
for (const event of ['', 'fast', 'energy', 'classic']) {
  const x = play(event, 99), y = play(event, 99);
  assert.strictEqual(JSON.stringify(x.G), JSON.stringify(y.G), 'determinism ' + (event || 'ranked'));
  assert.ok(x.G.over, 'match ends ' + (event || 'ranked'));
  assert.ok(x.maxSnap + 80 <= 1500, 'snapshot under 1.5 KB with envelope: ' + x.maxSnap);
  assert.ok(x.p99 < 0.1, 'tick p99 under 0.1 ms: ' + x.p99.toFixed(3));
  if (event === 'classic') assert.strictEqual(x.cardsUsed, 0, 'no specials in classic');
  else assert.ok(x.cardsUsed > 0, 'specials get used');
  console.log((event || 'ranked').padEnd(8), 'snapshot max', x.maxSnap, 'B · tick p99', x.p99.toFixed(3), 'ms · specials', x.cardsUsed);
}
// holding the deck key scrolls exactly once
const G = L.createMatch({ names: ['A', 'B'], data: [PG.matchData(), PG.matchData()], ctrl: ['human', 'human'], seed: 3 });
for (let t = 0; t < 10; t++) L.step(G, [{ n: true }, {}]);
assert.strictEqual(G.P[0].card, 1, 'edge-triggered deck scroll');
assert.deepStrictEqual(G.deck[0], Cards.STARTER_DECK, 'default deck');

db.close();
console.log('meta OK');
