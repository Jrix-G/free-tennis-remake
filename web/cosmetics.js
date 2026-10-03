// Cosmetics catalog, shared by the renderer and the server (which validates what a profile picks).
// A look is { cloth, hair } of item ids. Every item is free for now; later items can carry a price
// or an unlock condition and the server will check ownership before accepting them.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TennisCosmetics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATALOG = {
    cloth: [
      { id: 'white', name: 'Blanc', color: '#f7f7ef', shade: '#c3c4d4' },
      { id: 'red', name: 'Rouge', color: '#e8423a', shade: '#a82a25' },
      { id: 'blue', name: 'Bleu', color: '#3a7be8', shade: '#2552a8' },
      { id: 'navy', name: 'Marine', color: '#2b3a6b', shade: '#1a2445' },
      { id: 'green', name: 'Vert', color: '#2fae5a', shade: '#1f7a3e' },
      { id: 'yellow', name: 'Jaune', color: '#f5d33a', shade: '#c09f1f' },
      { id: 'pink', name: 'Rose', color: '#f27bb4', shade: '#c0518a' },
      { id: 'purple', name: 'Violet', color: '#8a55d6', shade: '#5f369e' },
      { id: 'orange', name: 'Orange', color: '#f58a2e', shade: '#bf6417' },
      { id: 'black', name: 'Noir', color: '#33333a', shade: '#1c1c20' },
    ],
    hair: [
      { id: 'brown', name: 'Châtain', color: '#9a6a24' },
      { id: 'blond', name: 'Blond', color: '#c8963a' },
      { id: 'black', name: 'Noir', color: '#2a2018' },
      { id: 'red', name: 'Roux', color: '#b8481e' },
      { id: 'platinum', name: 'Platine', color: '#e6dcb8' },
      { id: 'blue', name: 'Bleu', color: '#3a6fd8' },
    ],
  };
  const DEFAULT = [{ cloth: 'white', hair: 'brown' }, { cloth: 'white', hair: 'blond' }];  // original look per side

  const find = (kind, id) => CATALOG[kind].find((it) => it.id === id) || null;
  // Keep only known items; fall back to the side's original look.
  function sanitize(look, side) {
    const d = DEFAULT[side || 0], l = look || {};
    return { cloth: find('cloth', l.cloth) ? l.cloth : d.cloth, hair: find('hair', l.hair) ? l.hair : d.hair };
  }
  function random(rnd) {
    const pick = (a) => a[Math.floor((rnd || Math.random)() * a.length)].id;
    return { cloth: pick(CATALOG.cloth), hair: pick(CATALOG.hair) };
  }

  return { CATALOG, DEFAULT, find, sanitize, random };
});
