// Progression rules, shared by the server (which enforces them) and the client (which displays them).
// Abilities = [forehand, backhand, serve, footwork] on the original 0..9 scale. Everyone starts at 3;
// ranked quick matches give XP, each level gives one point to spend. Elo starts at 1000.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TennisProgression = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NAMES = ['Coup droit', 'Revers', 'Service', 'Déplacement'];
  const BASE = 3, MAX = 9;
  const START_STATS = [BASE, BASE, BASE, BASE];
  const XP_WIN = 100, XP_LOSS = 40;
  const START_ELO = 1000, K = 32;

  // XP needed to go from level L to L+1: 80, 100, 120... (first level after one or two matches)
  const need = (L) => 60 + 20 * L;
  function level(xp) {
    let L = 1, x = xp;
    while (x >= need(L)) { x -= need(L); L++; }
    return { level: L, into: x, need: need(L) };
  }
  const points = (xp) => level(xp).level - 1;          // points earned so far
  const spent = (stats) => stats.reduce((a, v) => a + v - BASE, 0);

  // Valid when every ability is in BASE..MAX and no more points are spent than earned (respec allowed).
  function validStats(stats, xp) {
    return Array.isArray(stats) && stats.length === 4 &&
      stats.every((v) => Number.isInteger(v) && v >= BASE && v <= MAX) && spent(stats) <= points(xp);
  }
  // The 6-value array TennisLogic expects ([..., netplay, tech] are AI-only), plus an optional
  // character bonus (one point on one ability, see TennisMeta.CHARACTERS).
  const matchData = (stats, bonus) => (stats || START_STATS).map((v, i) => v + ((bonus && bonus[i]) || 0)).concat([0, 0]);

  // New ratings after a match; score 1 = a won, 0 = a lost.
  function elo(ra, rb, score) {
    const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
    const d = Math.round(K * (score - ea));
    return [ra + d, rb - d];
  }

  return { NAMES, BASE, MAX, START_STATS, XP_WIN, XP_LOSS, START_ELO, level, points, spent, validStats, matchData, elo };
});
