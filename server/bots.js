// Stand-in opponents for quick matches when nobody else is searching: a pseudo that reads like a
// real player's, a random outfit and stats around the balanced profile.
'use strict';
const crypto = require('crypto');
const CO = require('../web/cosmetics.js');
const Cards = require('../web/cards.js');

const FIRST = ['Lucas', 'Hugo', 'Theo', 'Nathan', 'Louis', 'Enzo', 'Mathis', 'Tom', 'Jules', 'Leo', 'Noah', 'Adam',
  'Maxime', 'Antoine', 'Clement', 'Romain', 'Kevin', 'Yanis', 'Sami', 'Ines', 'Lea', 'Chloe', 'Emma', 'Manon',
  'Camille', 'Sarah', 'Jade', 'Lina', 'Zoe', 'Julie', 'Pauline', 'Mael', 'Axel', 'Victor', 'Baptiste', 'Quentin'];
const WORDS = ['ace', 'smash', 'volley', 'lob', 'tennis', 'break', 'drop', 'slice', 'match', 'set', 'pro', 'gg'];
const rnd = (n) => crypto.randomInt(n);
const pick = (a) => a[rnd(a.length)];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

function botName() {
  const f = pick(FIRST), w = pick(WORDS), n = rnd(100), y = 85 + rnd(25);
  const styles = [
    () => f + '_' + String(y % 100).padStart(2, '0'),
    () => f.toLowerCase() + n,
    () => f + cap(w),
    () => w + '.' + f.toLowerCase(),
    () => f[0] + f.slice(1).toLowerCase() + 'TV',
    () => 'xX' + f + 'Xx',
    () => f.toLowerCase() + '.' + w,
    () => cap(w) + 'Master' + n,
    () => f,
  ];
  return pick(styles)().slice(0, 16);
}

// A credible opponent for this player: abilities within one point of theirs, a rating close to theirs.
// A newcomer's first matches (played < 3) face a softer bot so the first wins come quickly.
function botFor(h) {
  const soft = (h.played || 0) < 3 ? 1 : 0;
  const near = (v) => Math.max(1, Math.min(9, v + rnd(3) - 1 - soft));
  const ids = Cards.CARDS.map((c) => c.id);
  const deck = [];
  while (deck.length < Cards.DECK_SIZE) { const id = pick(ids); if (!deck.includes(id)) deck.push(id); }
  const avg = h.levels && h.levels.length ? Math.round(h.levels.reduce((a, b) => a + b, 0) / h.levels.length) : 1;
  return {
    stats: h.stats.map(near),
    elo: Math.max(100, (h.elo || 1000) + rnd(121) - 60),
    level: Math.max(1, (h.level || 1) + rnd(5) - 2),
    trophies: Math.max(0, (h.trophies || 0) + rnd(81) - 40),
    deck, levels: deck.map(() => Cards.clampLevel(avg + rnd(3) - 1)),
  };
}

const botLook = () => CO.random(() => rnd(1e6) / 1e6);

module.exports = { botName, botFor, botLook };
