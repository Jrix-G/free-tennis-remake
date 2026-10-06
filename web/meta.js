// Meta-game rules shared by the server (which enforces them) and the client (which displays them):
// trophies and arenas, chests, daily quests, daily login, season pass, characters and weekend events.
// Everything here is pure: rewards derive from a stored seed, days from an explicit timestamp.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./cards.js'));
  else root.TennisMeta = factory(root.TennisCards);
})(typeof self !== 'undefined' ? self : this, function (Cards) {
  'use strict';

  // ---------- trophies and arenas ----------
  const TROPHY_WIN = 30, TROPHY_LOSS = 20;
  const ARENAS = [
    { min: 0, name: 'Terre battue', court: 'clay', reward: 0 },
    { min: 300, name: 'Gazon', court: 'grass', reward: 150 },
    { min: 700, name: 'Dur', court: 'hard', reward: 250 },
    { min: 1200, name: 'Indoor', court: 'indoor', reward: 400 },
    { min: 2000, name: 'Central', court: 'central', reward: 600 },
  ];
  function arena(trophies) {
    let i = 0;
    while (i + 1 < ARENAS.length && trophies >= ARENAS[i + 1].min) i++;
    return i;
  }
  const trophiesAfter = (t, won) => Math.max(0, t + (won ? TROPHY_WIN : -TROPHY_LOSS));
  // End of season: half of what is above 1000 is kept.
  const seasonReset = (t) => (t > 1000 ? 1000 + Math.floor((t - 1000) / 2) : t);

  // ---------- small seeded RNG (mulberry32) ----------
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  // ---------- chests ----------
  // weight = drop rate (%) of the chest kind after a win; shown as is in the game.
  const CHESTS = {
    wood: { name: 'Coffre en bois', secs: 15 * 60, coins: [20, 40], cards: 3, cosmetic: 0, weight: 60 },
    silver: { name: "Coffre d'argent", secs: 3 * 3600, coins: [50, 90], cards: 8, cosmetic: 5, weight: 30 },
    gold: { name: "Coffre d'or", secs: 8 * 3600, coins: [120, 200], cards: 20, cosmetic: 20, weight: 10 },
  };
  const CHEST_SLOTS = 4;
  function rollChestKind(r) {
    let x = r() * 100;
    for (const [kind, c] of Object.entries(CHESTS)) { if ((x -= c.weight) < 0) return kind; }
    return 'wood';
  }
  // Contents of a chest from its seed: coins, card copies by id, and maybe one cosmetic picked by the
  // server among the shop items the player lacks (cosmetic = chance in %).
  function chestContents(kind, seed) {
    const c = CHESTS[kind] || CHESTS.wood, r = rng(seed);
    const coins = c.coins[0] + Math.floor(r() * (c.coins[1] - c.coins[0] + 1));
    const cards = {};
    for (let i = 0; i < c.cards; i++) {
      const id = Cards.CARDS[Math.floor(r() * Cards.CARDS.length)].id;
      cards[id] = (cards[id] || 0) + 1;
    }
    return { coins, cards, cosmetic: r() * 100 < c.cosmetic, pick: r() };
  }
  // Gems to open a chest right away: 1 per started 10 minutes left.
  const skipCost = (msLeft) => Math.max(1, Math.ceil(msLeft / 600000));

  // ---------- days (Europe/Paris) ----------
  const parisFmt = typeof Intl !== 'undefined'
    ? new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
    : null;
  function parisParts(t) {
    const p = {};
    for (const x of parisFmt.formatToParts(new Date(t))) p[x.type] = x.value;
    return p;
  }
  const dayKey = (t) => { const p = parisParts(t); return p.year + '-' + p.month + '-' + p.day; };
  const prevDayKey = (t) => dayKey(t - 864e5);  // DST shifts never span a full day
  function isWeekend(t) {
    const d = new Date(parisParts(t).year + '-' + parisParts(t).month + '-' + parisParts(t).day + 'T12:00:00Z').getUTCDay();
    return d === 0 || d === 6;
  }
  const weekKey = (t) => 'W' + Math.floor((t + 3 * 864e5) / (7 * 864e5));  // Monday-based UTC weeks

  // ---------- daily quests ----------
  const QUESTS = [
    { kind: 'play', goal: 3, reward: 40, text: 'Joue 3 matchs classés' },
    { kind: 'play', goal: 5, reward: 70, text: 'Joue 5 matchs classés' },
    { kind: 'win', goal: 2, reward: 60, text: 'Gagne 2 matchs classés' },
    { kind: 'win', goal: 3, reward: 90, text: 'Gagne 3 matchs classés' },
    { kind: 'games', goal: 6, reward: 50, text: 'Gagne 6 jeux' },
    { kind: 'cards', goal: 8, reward: 40, text: 'Utilise 8 coups spéciaux' },
  ];
  const QUEST_PASS_XP = 20;
  // The 3 quests of a day for a user: same answer on every call, distinct kinds when possible.
  function dailyQuests(userId, day) {
    const r = rng(hash(userId + '|' + day)), out = [], kinds = new Set();
    const pool = QUESTS.map((q, i) => i);
    while (out.length < 3 && pool.length) {
      const i = pool.splice(Math.floor(r() * pool.length), 1)[0];
      if (kinds.has(QUESTS[i].kind) && pool.some((j) => !kinds.has(QUESTS[j].kind))) continue;
      kinds.add(QUESTS[i].kind); out.push(i);
    }
    return out;
  }

  // ---------- daily login (7-day streak, then it loops) ----------
  const LOGIN = [
    { coins: 20 }, { coins: 30 }, { coins: 40 }, { coins: 50 }, { coins: 60 }, { coins: 80 }, { coins: 100, gems: 10, chest: 'silver' },
  ];

  // ---------- season pass ----------
  const SEASON_EPOCH = Date.UTC(2026, 9, 1), SEASON_MS = 30 * 864e5;
  const season = (t) => Math.floor((t - SEASON_EPOCH) / SEASON_MS);
  const seasonEnd = (t) => SEASON_EPOCH + (season(t) + 1) * SEASON_MS;
  const PASS_TIERS = 30, PASS_TIER_XP = 100, PASS_PRICE = 500;  // gems
  const PASS_XP_WIN = 30, PASS_XP_LOSS = 15;
  function passReward(tier, premium) {  // tier 1..PASS_TIERS
    if (premium) {
      if (tier % 10 === 0) return { cosmetic: ['court', ['aurora', 'sunset', 'gold'][tier / 10 - 1]] };
      return tier % 5 === 0 ? { chest: 'gold' } : { coins: 60 };
    }
    if (tier % 10 === 0) return { gems: 50 };
    return tier % 5 === 0 ? { chest: 'silver' } : { coins: 30 };
  }
  const passTier = (xp) => Math.min(PASS_TIERS, Math.floor(xp / PASS_TIER_XP));

  // ---------- characters (small passive bonus on one ability, unlocked by arena) ----------
  const CHARACTERS = [
    { id: 'allround', name: 'Polyvalent', desc: 'Aucun bonus, aucun défaut', bonus: [0, 0, 0, 0], arena: 0 },
    { id: 'hitter', name: 'Frappeur', desc: 'Coup droit +1', bonus: [1, 0, 0, 0], arena: 1 },
    { id: 'tech', name: 'Technicien', desc: 'Revers +1', bonus: [0, 1, 0, 0], arena: 1 },
    { id: 'server', name: 'Serveur-volleyeur', desc: 'Service +1', bonus: [0, 0, 1, 0], arena: 2 },
    { id: 'defender', name: 'Défenseur', desc: 'Déplacement +1', bonus: [0, 0, 0, 1], arena: 3 },
  ];
  const character = (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];

  // ---------- weekend events (rotation by week) ----------
  const EVENTS = [
    { id: 'fast', name: 'Balle rapide', desc: 'La balle va 12 % plus vite' },
    { id: 'energy', name: 'Énergie double', desc: 'Chaque frappe donne 2 énergie' },
    { id: 'classic', name: 'Classique', desc: 'Sans coups spéciaux, comme à l’origine' },
  ];
  const EVENT_COINS = 60;
  function currentEvent(t) {
    if (!isWeekend(t)) return null;
    return EVENTS[Math.floor((t + 3 * 864e5) / (7 * 864e5)) % EVENTS.length];
  }

  // ---------- clubs ----------
  const CLUB_MAX = 30, CLUB_NAME_RE = /^[A-Za-z0-9À-ÿ_.\- ]{3,20}$/, DONATE_COINS = 5, DONATE_PER_DAY = 10;

  return {
    TROPHY_WIN, TROPHY_LOSS, ARENAS, arena, trophiesAfter, seasonReset,
    rng, hash, CHESTS, CHEST_SLOTS, rollChestKind, chestContents, skipCost,
    dayKey, prevDayKey, weekKey, isWeekend, QUESTS, QUEST_PASS_XP, dailyQuests, LOGIN,
    season, seasonEnd, PASS_TIERS, PASS_TIER_XP, PASS_PRICE, PASS_XP_WIN, PASS_XP_LOSS, passReward, passTier,
    CHARACTERS, character, EVENTS, EVENT_COINS, currentEvent,
    CLUB_MAX, CLUB_NAME_RE, DONATE_COINS, DONATE_PER_DAY,
  };
});
