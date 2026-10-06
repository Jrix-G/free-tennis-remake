// Shared card balance. Effects are deliberately small and deterministic.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TennisCards = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CARDS = [
    { id: 'return', name: 'Retour éclair', cost: 3, cooldown: 90, maxLevel: 5 },
    { id: 'wall', name: 'Mur', cost: 4, cooldown: 150, maxLevel: 5 },
    { id: 'infinite-sprint', name: 'Sprint infini', cost: 4, cooldown: 180, maxLevel: 5 },
    { id: 'wrong-foot', name: 'Contre-pied', cost: 5, cooldown: 180, maxLevel: 5 },
    { id: 'second-wind', name: 'Second souffle', cost: 3, cooldown: 120, maxLevel: 5 },
    { id: 'heavy-ball', name: 'Balle lourde', cost: 5, cooldown: 180, maxLevel: 5 },
    { id: 'focus', name: 'Focus', cost: 2, cooldown: 90, maxLevel: 5 },
    { id: 'net-rush', name: 'Montée au filet', cost: 3, cooldown: 120, maxLevel: 5 },
  ];
  const find = (id) => CARDS.find((c) => c.id === id) || null;
  return { CARDS, find, STARTER_DECK: ['return', 'second-wind', 'focus'] };
});
