// Cosmetics catalog, shared by the renderer and the server (which validates what a profile picks).
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
    racket: [
      { id: 'classic', name: 'Classique', color: '#5a66dc', shade: '#232867', grip: '#141414', price: 0 },
      { id: 'crimson', name: 'Crimson', color: '#f04452', shade: '#8a1829', grip: '#421020', price: 100 },
      { id: 'emerald', name: 'Émeraude', color: '#42e0a0', shade: '#116447', grip: '#123b32', price: 140 },
      { id: 'gold', name: 'Or 24K', color: '#ffd23a', shade: '#a45d19', grip: '#643b18', price: 220 },
      { id: 'neon', name: 'Néon', color: '#d4ff3a', shade: '#5d861a', grip: '#344512', price: 180 },
    ],
    cap: [
      { id: 'none', name: 'Sans casquette', color: null, shade: null, price: 0 },
      { id: 'ruby', name: 'Visière rubis', color: '#e8423a', shade: '#a82a25', price: 70 },
      { id: 'ocean', name: 'Visière océan', color: '#3a7be8', shade: '#2552a8', price: 90 },
      { id: 'jade', name: 'Casquette jade', color: '#2fae5a', shade: '#1f7a3e', price: 120 },
      { id: 'gold', name: 'Visière VIP', color: '#ffd23a', shade: '#a45d19', price: 180 },
    ],
    // Half-court skins: each player's side of the court. Surfaces stay dark enough for the white lines
    // and the yellow ball to read (checked in tests/meta_test.js); lines are never recoloured.
    // 'arena' follows the player's current arena.
    court: [
      { id: 'arena', name: "Couleur d'arène", surface: null, price: 0 },
      { id: 'clay', name: 'Terre battue', surface: '#b0522a', price: 0, unlock: 'arena' },
      { id: 'grass', name: 'Gazon', surface: '#5f9a00', price: 0, unlock: 'arena' },
      { id: 'hard', name: 'Dur bleu', surface: '#2f6db0', price: 0, unlock: 'arena' },
      { id: 'indoor', name: 'Indoor', surface: '#3b4f8a', price: 0, unlock: 'arena' },
      { id: 'central', name: 'Central', surface: '#1f6b4a', price: 0, unlock: 'arena' },
      { id: 'emerald', name: 'Émeraude', surface: '#1d7a55', price: 200 },
      { id: 'royal', name: 'Royal', surface: '#24418f', price: 250 },
      { id: 'night', name: 'Nuit', surface: '#2a2350', price: 300 },
      { id: 'rose', name: 'Rose', surface: '#a8466e', price: 300 },
      { id: 'aurora', name: 'Aurore', surface: '#245e6b', price: 0, unlock: 'pass' },
      { id: 'sunset', name: 'Couchant', surface: '#9a4a2c', price: 0, unlock: 'pass' },
      { id: 'gold', name: 'Court doré', surface: '#7a5a12', price: 0, unlock: 'pass' },
    ],
  };
  for (const kind of ['shirt', 'shorts']) {
    CATALOG[kind] = CATALOG.cloth.map((item) => ({
      id: item.id, name: item.name, color: item.color, shade: item.shade, price: 0,
    }));
  }
  CATALOG.shirt.push({ id: 'starlight', name: 'Starlight', color: '#b9a0ff', shade: '#59448a', price: 180 },
    { id: 'neon-pink', name: 'Néon rose', color: '#ff52c8', shade: '#a32978', price: 200 });
  CATALOG.shorts.push({ id: 'starlight', name: 'Starlight', color: '#b9a0ff', shade: '#59448a', price: 160 },
    { id: 'neon-pink', name: 'Néon rose', color: '#ff52c8', shade: '#a32978', price: 180 });
  // Economy metadata is explicit on every cosmetic so later shops never infer a price client-side.
  for (const kind of Object.keys(CATALOG)) for (const item of CATALOG[kind]) {
    item.price = item.price || 0;
    item.currency = 'coins';
    item.rarity = item.unlock === 'pass' ? 'legendary' : item.price >= 180 ? 'epic' : item.price >= 100 ? 'rare' : 'common';
    item.unlock = item.unlock || (item.price ? 'shop' : 'starter');
  }
  const DEFAULT = [{ cloth: 'white', hair: 'brown', racket: 'classic', shirt: 'white', shorts: 'white', cap: 'none', court: 'arena' },
    { cloth: 'white', hair: 'blond', racket: 'classic', shirt: 'white', shorts: 'white', cap: 'none', court: 'arena' }];
  const STARTER_OWNED = { racket: ['classic'], shirt: ['white'], shorts: ['white'], cap: ['none'], court: ['arena'] };
  const SHOP_KINDS = ['racket', 'shirt', 'shorts', 'cap', 'court'];
  const COINS_WIN = 100;

  const find = (kind, id) => CATALOG[kind] && CATALOG[kind].find((it) => it.id === id) || null;
  function sanitize(look, side) {
    const d = DEFAULT[side || 0], l = look || {};
    const cloth = find('cloth', l.cloth) ? l.cloth : d.cloth;
    return {
      cloth, hair: find('hair', l.hair) ? l.hair : d.hair,
      racket: find('racket', l.racket) ? l.racket : d.racket,
      shirt: find('shirt', l.shirt) ? l.shirt : find('shirt', cloth) ? cloth : d.shirt,
      shorts: find('shorts', l.shorts) ? l.shorts : find('shorts', cloth) ? cloth : d.shorts,
      cap: find('cap', l.cap) ? l.cap : d.cap,
      court: find('court', l.court) ? l.court : d.court,
    };
  }
  function inventory(owned) {
    const out = {};
    for (const kind of SHOP_KINDS) out[kind] = Array.from(new Set([...(STARTER_OWNED[kind] || []), ...((owned && owned[kind]) || [])]));
    return out;
  }
  // arenaIdx: highest arena reached (arena courts unlock with it).
  function owns(owned, kind, id, arenaIdx) {
    if (kind === 'cloth' || kind === 'hair') return !!find(kind, id);
    const item = find(kind, id);
    if (!item) return false;
    if (item.unlock === 'starter') return true;
    if (item.unlock === 'arena') return CATALOG.court.filter((c) => c.unlock === 'arena').indexOf(item) <= (arenaIdx || 0);
    return !!inventory(owned)[kind]?.includes(id);
  }
  // The surface colour to draw for a look; arenaCourt is the id of the player's current arena court.
  function courtSurface(look, arenaCourt) {
    const id = look && look.court && look.court !== 'arena' ? look.court : arenaCourt || 'grass';
    return (find('court', id) || find('court', 'grass')).surface;
  }
  function random(rnd) {
    const pick = (a) => a[Math.floor((rnd || Math.random)() * a.length)].id;
    return { cloth: pick(CATALOG.cloth), hair: pick(CATALOG.hair), racket: 'classic', shirt: 'white', shorts: 'white', cap: 'none', court: 'arena' };
  }

  return { CATALOG, DEFAULT, STARTER_OWNED, SHOP_KINDS, COINS_WIN, find, sanitize, inventory, owns, courtSurface, random };
});
