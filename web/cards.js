// Shared card balance. Effects are deliberately small and deterministic.
// A card's level only scales its effect (duration / stamina), never its cost, and the spread between
// level 1 and the max level stays small (+5 % per level) so a high-level deck cannot buy a match.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TennisCards = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CARDS = [
    { id: 'return', name: 'Retour éclair', cost: 3, cooldown: 90, desc: 'Coups liftés plus rapides pendant 1,5 s' },
    { id: 'wall', name: 'Mur', cost: 4, cooldown: 150, desc: 'Retours appuyés pendant 2 s' },
    { id: 'infinite-sprint', name: 'Sprint infini', cost: 4, cooldown: 180, desc: 'Sprint sans fatigue pendant 3 s' },
    { id: 'wrong-foot', name: 'Contre-pied', cost: 5, cooldown: 180, desc: "Ralentit les appuis de l'adversaire" },
    { id: 'second-wind', name: 'Second souffle', cost: 3, cooldown: 120, desc: 'Rend 35 de stamina' },
    { id: 'heavy-ball', name: 'Balle lourde', cost: 5, cooldown: 180, desc: 'Prochain coup lifté et lourd' },
    { id: 'focus', name: 'Focus', cost: 2, cooldown: 90, desc: 'Petit regain de stamina' },
    { id: 'net-rush', name: 'Montée au filet', cost: 3, cooldown: 120, desc: 'Bond vers le filet' },
  ];
  const DECK_SIZE = 3, MAX_LEVEL = 10;
  const STARTER_DECK = ['return', 'second-wind', 'focus'];
  // Copies and coins to go from level L to L+1 (index L - 1).
  const UPGRADE = [
    { copies: 2, coins: 20 }, { copies: 4, coins: 50 }, { copies: 6, coins: 100 }, { copies: 10, coins: 200 },
    { copies: 15, coins: 400 }, { copies: 20, coins: 700 }, { copies: 30, coins: 1000 }, { copies: 40, coins: 1500 },
    { copies: 50, coins: 2500 },
  ];
  const find = (id) => CARDS.find((c) => c.id === id) || null;
  const clampLevel = (n) => Math.max(1, Math.min(MAX_LEVEL, Number.isInteger(n) ? n : 1));
  const scale = (level) => 1 + 0.05 * (clampLevel(level) - 1);
  // DECK_SIZE distinct known ids, otherwise the starter deck.
  function validDeck(deck) {
    return Array.isArray(deck) && deck.length === DECK_SIZE && new Set(deck).size === DECK_SIZE && deck.every(find)
      ? deck.slice() : STARTER_DECK.slice();
  }
  return { CARDS, DECK_SIZE, MAX_LEVEL, STARTER_DECK, UPGRADE, find, clampLevel, scale, validDeck };
});
