// Server side of the meta-game (rules in web/meta.js): trophies, chests, cards, daily quests and login,
// season pass, characters, clubs, weekly ranking and the gem ledger. The server is the only authority:
// every reward is granted here, inside a transaction, and every claim is idempotent.
'use strict';
const crypto = require('crypto');
const CO = require('../web/cosmetics.js');
const PG = require('../web/progression.js');
const Cards = require('../web/cards.js');
const M = require('../web/meta.js');

function install(db, now = Date.now) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS weekly (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, week_key TEXT NOT NULL,
      trophies INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, week_key)
    );
    CREATE TABLE IF NOT EXISTS clubs (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_key TEXT UNIQUE NOT NULL, owner INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS club_members (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE, joined_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS club_messages (
      id INTEGER PRIMARY KEY, club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS donations (
      user_id INTEGER NOT NULL, day_key TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day_key)
    );
    CREATE TABLE IF NOT EXISTS purchases (
      ref TEXT PRIMARY KEY, user_id INTEGER NOT NULL, gems INTEGER NOT NULL, at INTEGER NOT NULL
    );
  `);
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  const add = (name, def) => { if (!cols.includes(name)) db.exec('ALTER TABLE users ADD COLUMN ' + name + ' ' + def); };
  add('trophies', 'INTEGER NOT NULL DEFAULT 0');
  add('best_trophies', 'INTEGER NOT NULL DEFAULT 0');
  add('gems', 'INTEGER NOT NULL DEFAULT 0');
  add('played', 'INTEGER NOT NULL DEFAULT 0');
  add('deck', "TEXT NOT NULL DEFAULT '[]'");
  add('char', "TEXT NOT NULL DEFAULT 'allround'");
  add('season', 'INTEGER NOT NULL DEFAULT -1');
  add('pass_xp', 'INTEGER NOT NULL DEFAULT 0');
  add('pass_premium', 'INTEGER NOT NULL DEFAULT 0');
  add('pass_claimed', "TEXT NOT NULL DEFAULT '{}'");
  // Accounts from before trophies: start everyone with trophies matching their record so far.
  if (!cols.includes('trophies')) db.exec('UPDATE users SET played = wins + losses, trophies = MAX(0, wins * 30 - losses * 20), best_trophies = MAX(0, wins * 30 - losses * 20)');

  const q = {
    user: db.prepare('SELECT * FROM users WHERE id = ?'),
    coins: db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?'),
    takeCoins: db.prepare('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?'),
    gems: db.prepare('UPDATE users SET gems = gems + ? WHERE id = ?'),
    takeGems: db.prepare('UPDATE users SET gems = gems - ? WHERE id = ? AND gems >= ?'),
    season: db.prepare("UPDATE users SET season = ?, trophies = ?, pass_xp = 0, pass_premium = 0, pass_claimed = '{}' WHERE id = ?"),
    ranked: db.prepare(`UPDATE users SET wins = wins + ?, losses = losses + ?, xp = xp + ?, elo = ?, coins = coins + ?,
      trophies = ?, best_trophies = MAX(best_trophies, ?), played = played + 1, pass_xp = pass_xp + ? WHERE id = ?`),
    casual: db.prepare('UPDATE users SET coins = coins + ?, played = played + 1, pass_xp = pass_xp + ? WHERE id = ?'),
    passXp: db.prepare('UPDATE users SET pass_xp = pass_xp + ? WHERE id = ?'),
    weekly: db.prepare(`INSERT INTO weekly (user_id, week_key, trophies, wins) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, week_key) DO UPDATE SET trophies = trophies + excluded.trophies, wins = wins + excluded.wins`),
    chests: db.prepare('SELECT * FROM chests WHERE user_id = ? AND claimed_at IS NULL ORDER BY id'),
    chest: db.prepare('SELECT * FROM chests WHERE id = ? AND user_id = ? AND claimed_at IS NULL'),
    addChest: db.prepare('INSERT INTO chests (user_id, kind, seed, opens_at) VALUES (?, ?, ?, 0)'),
    startChest: db.prepare('UPDATE chests SET opens_at = ? WHERE id = ? AND opens_at = 0 AND claimed_at IS NULL'),
    claimChest: db.prepare('UPDATE chests SET claimed_at = ? WHERE id = ? AND claimed_at IS NULL'),
    cards: db.prepare('SELECT card_id, level, copies FROM user_cards WHERE user_id = ?'),
    addCopies: db.prepare(`INSERT INTO user_cards (user_id, card_id, level, copies) VALUES (?, ?, 1, ?)
      ON CONFLICT (user_id, card_id) DO UPDATE SET copies = copies + excluded.copies`),
    takeCopy: db.prepare('UPDATE user_cards SET copies = copies - ? WHERE user_id = ? AND card_id = ? AND copies >= ?'),
    levelUp: db.prepare('UPDATE user_cards SET level = level + 1, copies = copies - ? WHERE user_id = ? AND card_id = ? AND level = ? AND copies >= ?'),
    setDeck: db.prepare('UPDATE users SET deck = ? WHERE id = ?'),
    setChar: db.prepare('UPDATE users SET char = ? WHERE id = ?'),
    quests: db.prepare('SELECT * FROM daily_quests WHERE user_id = ? AND day_key = ? ORDER BY slot'),
    addQuest: db.prepare('INSERT OR IGNORE INTO daily_quests (user_id, day_key, slot, kind, goal) VALUES (?, ?, ?, ?, ?)'),
    progress: db.prepare('UPDATE daily_quests SET progress = MIN(goal, progress + ?) WHERE user_id = ? AND day_key = ? AND kind = ? AND claimed_at IS NULL'),
    claimQuest: db.prepare('UPDATE daily_quests SET claimed_at = ? WHERE user_id = ? AND day_key = ? AND slot = ? AND claimed_at IS NULL AND progress >= goal'),
    login: db.prepare('SELECT * FROM daily_claims WHERE user_id = ? AND day_key = ?'),
    addLogin: db.prepare('INSERT OR IGNORE INTO daily_claims (user_id, day_key, streak, claimed_at) VALUES (?, ?, ?, ?)'),
    setPremium: db.prepare('UPDATE users SET pass_premium = 1 WHERE id = ? AND pass_premium = 0'),
    setClaimed: db.prepare('UPDATE users SET pass_claimed = ? WHERE id = ? AND pass_claimed = ?'),
    member: db.prepare('SELECT * FROM club_members WHERE user_id = ?'),
    clubById: db.prepare('SELECT * FROM clubs WHERE id = ?'),
    clubName: db.prepare('SELECT id FROM clubs WHERE name_key = ?'),
    addClub: db.prepare('INSERT INTO clubs (name, name_key, owner, created_at) VALUES (?, ?, ?, ?)'),
    join: db.prepare('INSERT INTO club_members (user_id, club_id, joined_at) VALUES (?, ?, ?)'),
    leave: db.prepare('DELETE FROM club_members WHERE user_id = ?'),
    dropClub: db.prepare('DELETE FROM clubs WHERE id = ?'),
    setOwner: db.prepare('UPDATE clubs SET owner = ? WHERE id = ?'),
    members: db.prepare(`SELECT u.id, u.name, u.trophies, u.look, m.joined_at FROM club_members m JOIN users u ON u.id = m.user_id
      WHERE m.club_id = ? ORDER BY u.trophies DESC, m.joined_at`),
    memberCount: db.prepare('SELECT COUNT(*) AS n FROM club_members WHERE club_id = ?'),
    messages: db.prepare(`SELECT m.text, m.at, u.name FROM club_messages m JOIN users u ON u.id = m.user_id
      WHERE m.club_id = ? ORDER BY m.id DESC LIMIT 30`),
    addMessage: db.prepare('INSERT INTO club_messages (club_id, user_id, text, at) VALUES (?, ?, ?, ?)'),
    pruneMessages: db.prepare('DELETE FROM club_messages WHERE club_id = ? AND id <= (SELECT id FROM club_messages WHERE club_id = ? ORDER BY id DESC LIMIT 1 OFFSET 200)'),
    clubList: db.prepare(`SELECT c.id, c.name, COUNT(m.user_id) AS members, COALESCE(SUM(u.trophies), 0) AS trophies
      FROM clubs c LEFT JOIN club_members m ON m.club_id = c.id LEFT JOIN users u ON u.id = m.user_id
      WHERE c.name_key LIKE ? GROUP BY c.id ORDER BY trophies DESC, c.id LIMIT 20`),
    donated: db.prepare('SELECT count FROM donations WHERE user_id = ? AND day_key = ?'),
    donate: db.prepare(`INSERT INTO donations (user_id, day_key, count) VALUES (?, ?, 1)
      ON CONFLICT (user_id, day_key) DO UPDATE SET count = count + 1`),
    topTrophies: db.prepare('SELECT * FROM users WHERE played > 0 ORDER BY trophies DESC, wins DESC, id LIMIT ?'),
    rankTrophies: db.prepare('SELECT COUNT(*) + 1 AS r FROM users WHERE played > 0 AND (trophies > ? OR (trophies = ? AND (wins > ? OR (wins = ? AND id < ?))))'),
    topWeekly: db.prepare(`SELECT u.name, u.look, w.trophies, w.wins FROM weekly w JOIN users u ON u.id = w.user_id
      WHERE w.week_key = ? ORDER BY w.trophies DESC, w.wins DESC, u.id LIMIT ?`),
    purchase: db.prepare('INSERT OR IGNORE INTO purchases (ref, user_id, gems, at) VALUES (?, ?, ?, ?)'),
  };

  // BEGIN IMMEDIATE ... COMMIT around fn; nested calls join the outer transaction.
  // A Fail thrown inside rolls back and comes out as its message (the API's error string).
  let depth = 0;
  function tx(fn) {
    if (depth) return fn();
    db.exec('BEGIN IMMEDIATE'); depth++;
    try { const r = fn(); depth--; db.exec('COMMIT'); return r; } catch (e) {
      depth--; db.exec('ROLLBACK');
      if (e instanceof Fail) return e.message;
      throw e;
    }
  }

  // A user row brought into the current season (trophy reset and fresh pass on the first visit of a season).
  function fresh(u) {
    if (!u) return null;
    const s = M.season(now());
    if (u.season === s) return u;
    q.season.run(s, u.season < 0 ? u.trophies : M.seasonReset(u.trophies), u.id);
    return q.user.get(u.id);
  }
  const user = (id) => fresh(q.user.get(id));

  // ---------- cards ----------
  function cards(id) {  // { id: { level, copies } } for owned cards; starter cards are always owned
    const out = {};
    for (const c of Cards.STARTER_DECK) out[c] = { level: 1, copies: 0 };
    for (const r of q.cards.all(id)) out[r.card_id] = { level: r.level, copies: r.copies };
    return out;
  }
  function deckOf(u) {  // the saved deck when still fully owned, otherwise the starter deck
    const own = cards(u.id), d = Cards.validDeck(JSON.parse(u.deck || '[]'));
    return d.every((c) => own[c]) ? d : Cards.STARTER_DECK.slice();
  }
  function matchLoadout(u) {  // what the room needs from an account for a match
    const deck = deckOf(u), own = cards(u.id);
    return { deck, levels: deck.map((c) => own[c].level), char: u.char, trophies: u.trophies, played: u.played };
  }
  function upgradeCard(id, cardId) {
    const own = cards(id)[cardId];
    if (!own) return 'Carte non possédée';
    if (own.level >= Cards.MAX_LEVEL) return 'Niveau maximum atteint';
    const need = Cards.UPGRADE[own.level - 1];
    if (own.copies < need.copies) return 'Pas assez de cartes';
    return tx(() => {
      if (!q.takeCoins.run(need.coins, id, need.coins).changes) throw new Fail('Pas assez de pièces');
      q.addCopies.run(id, cardId, 0);  // starter cards get their row on the first upgrade
      if (!q.levelUp.run(need.copies, id, cardId, own.level, need.copies).changes) throw new Fail('Amélioration impossible');
      return null;
    });
  }
  function setDeck(id, deck) {
    const own = cards(id);
    if (!Array.isArray(deck) || Cards.validDeck(deck).join() !== deck.join()) return 'Deck invalide : 3 cartes différentes';
    if (!deck.every((c) => own[c])) return 'Carte non possédée';
    q.setDeck.run(JSON.stringify(deck), id);
    return null;
  }
  function setChar(id, charId) {
    const u = user(id), c = M.CHARACTERS.find((x) => x.id === charId);
    if (!c) return 'Personnage inconnu';
    if (M.arena(u.best_trophies) < c.arena) return 'Personnage débloqué en arène ' + (c.arena + 1);
    q.setChar.run(c.id, id);
    return null;
  }

  // ---------- chests ----------
  function giveChest(id, kind) {  // false when the 4 slots are full
    if (q.chests.all(id).length >= M.CHEST_SLOTS) return false;
    q.addChest.run(id, kind, crypto.randomInt(1, 2 ** 31));
    return true;
  }
  function chestView(c, t) {
    const def = M.CHESTS[c.kind];
    return { id: c.id, kind: c.kind, name: def.name, secs: def.secs, opensAt: c.opens_at, ready: c.opens_at > 0 && c.opens_at <= t };
  }
  function startChest(id, chestId) {
    const t = now(), all = q.chests.all(id), c = all.find((x) => x.id === chestId);
    if (!c) return 'Coffre introuvable';
    if (c.opens_at) return 'Coffre déjà en cours';
    if (all.some((x) => x.opens_at > t)) return 'Un autre coffre est déjà en cours d’ouverture';
    q.startChest.run(t + M.CHESTS[c.kind].secs * 1000, chestId);
    return null;
  }
  // Opens a ready chest, or pays gems to skip the wait. Returns { error } or { reward }.
  function openChest(id, chestId, useGems) {
    const t = now(), c = q.chest.get(chestId, id);
    if (!c) return { error: 'Coffre introuvable' };
    const ready = c.opens_at > 0 && c.opens_at <= t;
    const cost = ready ? 0 : M.skipCost((c.opens_at || t + M.CHESTS[c.kind].secs * 1000) - t);
    if (!ready && !useGems) return { error: 'Coffre pas encore prêt' };
    const res = tx(() => {
      if (cost && !q.takeGems.run(cost, id, cost).changes) throw new Fail('Pas assez de gemmes');
      if (!q.claimChest.run(t, chestId).changes) throw new Fail('Coffre déjà ouvert');
      const r = M.chestContents(c.kind, c.seed), reward = { coins: r.coins, cards: r.cards, gems: -cost };
      q.coins.run(r.coins, id);
      for (const [card, n] of Object.entries(r.cards)) q.addCopies.run(id, card, n);
      if (r.cosmetic) {
        const item = pickMissingCosmetic(id, r.pick);
        if (item) { grantCosmetic(id, item[0], item[1]); reward.cosmetic = item; } else { q.coins.run(50, id); reward.coins += 50; }
      }
      return { reward };
    });
    return typeof res === 'string' ? { error: res } : res;
  }
  function pickMissingCosmetic(id, x) {
    const owned = JSON.parse(q.user.get(id).owned || '{}'), pool = [];
    for (const kind of CO.SHOP_KINDS) for (const it of CO.CATALOG[kind]) if (it.unlock === 'shop' && !CO.owns(owned, kind, it.id)) pool.push([kind, it.id]);
    return pool.length ? pool[Math.floor(x * pool.length)] : null;
  }
  const grantOwned = db.prepare('UPDATE users SET owned = ? WHERE id = ?');
  const addInventory = db.prepare('INSERT OR IGNORE INTO inventory (user_id, kind, item_id, acquired_at) VALUES (?, ?, ?, ?)');
  function grantCosmetic(id, kind, itemId) {
    const owned = JSON.parse(q.user.get(id).owned || '{}');
    owned[kind] = Array.from(new Set([...(owned[kind] || []), itemId]));
    grantOwned.run(JSON.stringify(owned), id);
    addInventory.run(id, kind, itemId, now());
  }

  // ---------- daily quests ----------
  function ensureQuests(id, day) {
    M.dailyQuests(id, day).forEach((qi, slot) => q.addQuest.run(id, day, slot, M.QUESTS[qi].kind, M.QUESTS[qi].goal));
    return q.quests.all(id, day);
  }
  function quests(id) {
    const day = M.dayKey(now()), picks = M.dailyQuests(id, day);
    return ensureQuests(id, day).map((r) => {
      const def = M.QUESTS[picks[r.slot]];
      return { slot: r.slot, text: def.text, goal: r.goal, progress: r.progress, reward: def.reward, claimed: !!r.claimed_at };
    });
  }
  function claimQuest(id, slot) {
    const day = M.dayKey(now()), picks = M.dailyQuests(id, day);
    ensureQuests(id, day);
    const def = M.QUESTS[picks[slot]];
    if (!def) return 'Quête inconnue';
    return tx(() => {
      if (!q.claimQuest.run(now(), id, day, slot).changes) throw new Fail('Quête pas terminée ou déjà réclamée');
      q.coins.run(def.reward, id); q.passXp.run(M.QUEST_PASS_XP, id);
      return null;
    });
  }

  // ---------- daily login ----------
  function loginStatus(id) {
    const t = now(), today = q.login.get(id, M.dayKey(t)), y = q.login.get(id, M.prevDayKey(t));
    const streak = today ? today.streak : y ? (y.streak % M.LOGIN.length) + 1 : 1;
    return { claimed: !!today, streak, reward: M.LOGIN[streak - 1] };
  }
  function claimLogin(id) {
    const s = loginStatus(id);
    if (s.claimed) return 'Récompense du jour déjà réclamée';
    return tx(() => {
      if (!q.addLogin.run(id, M.dayKey(now()), s.streak, now()).changes) throw new Fail('Récompense du jour déjà réclamée');
      const r = s.reward;
      q.coins.run(r.coins || 0, id);
      if (r.gems) q.gems.run(r.gems, id);
      if (r.chest && !giveChest(id, r.chest)) q.coins.run(100, id);  // full slots: coins instead
      return null;
    });
  }

  // ---------- season pass ----------
  function passView(u) {
    const claimed = JSON.parse(u.pass_claimed || '{}');
    return {
      season: u.season, endsAt: M.seasonEnd(now()), xp: u.pass_xp, tier: M.passTier(u.pass_xp), premium: !!u.pass_premium,
      claimed: { free: claimed.free || [], premium: claimed.premium || [] },
    };
  }
  function grant(id, r) {
    if (r.coins) q.coins.run(r.coins, id);
    if (r.gems) q.gems.run(r.gems, id);
    if (r.chest && !giveChest(id, r.chest)) q.coins.run(100, id);
    if (r.cosmetic) grantCosmetic(id, r.cosmetic[0], r.cosmetic[1]);
  }
  function claimPass(id, tier, premium) {
    const u = user(id), v = passView(u);
    if (!Number.isInteger(tier) || tier < 1 || tier > M.PASS_TIERS) return 'Palier invalide';
    if (tier > v.tier) return 'Palier pas encore atteint';
    if (premium && !v.premium) return 'Pass premium requis';
    const track = premium ? 'premium' : 'free';
    if (v.claimed[track].includes(tier)) return 'Déjà réclamé';
    return tx(() => {
      const next = { free: v.claimed.free, premium: v.claimed.premium };
      next[track] = next[track].concat(tier);
      if (!q.setClaimed.run(JSON.stringify(next), id, u.pass_claimed).changes) throw new Fail('Déjà réclamé');
      grant(id, M.passReward(tier, premium));
      return null;
    });
  }
  function buyPass(id) {
    if (user(id).pass_premium) return 'Pass premium déjà actif';
    return tx(() => {
      if (!q.takeGems.run(M.PASS_PRICE, id, M.PASS_PRICE).changes) throw new Fail('Pas assez de gemmes');
      if (!q.setPremium.run(id).changes) throw new Fail('Pass premium déjà actif');
      return null;
    });
  }

  // ---------- match results ----------
  // r: { won, completed, newElo, games, cards, event }. Returns the summary sent to the player.
  function recordMatch(id, r) {
    return tx(() => {
      const u = user(id), t = now(), out = { coins: 0, trophies: 0, chest: null, arena: null };
      const passXp = r.won ? M.PASS_XP_WIN : M.PASS_XP_LOSS;
      if (r.event) {
        out.coins = r.won && r.completed !== false ? M.EVENT_COINS : 0;
        q.casual.run(out.coins, passXp, id);
      } else {
        const trophies = M.trophiesAfter(u.trophies, r.won);
        out.trophies = trophies - u.trophies;
        out.coins = r.won && r.completed !== false ? CO.COINS_WIN : 0;
        const before = M.arena(u.best_trophies);
        q.ranked.run(r.won ? 1 : 0, r.won ? 0 : 1, r.won ? PG.XP_WIN : PG.XP_LOSS, r.newElo, out.coins, trophies, trophies, passXp, id);
        q.weekly.run(id, M.weekKey(t), Math.max(0, out.trophies), r.won ? 1 : 0);
        const after = M.arena(Math.max(u.best_trophies, trophies));
        if (after > before) {
          let bonus = 0;
          for (let i = before + 1; i <= after; i++) bonus += M.ARENAS[i].reward;
          q.coins.run(bonus, id);
          out.arena = M.ARENAS[after].name; out.coins += bonus;
        }
      }
      // A chest per win (rolled kind), and one guaranteed on the very first match.
      if ((r.won && r.completed !== false) || u.played === 0) {
        const kind = u.played === 0 ? 'wood' : M.rollChestKind(() => crypto.randomInt(1e9) / 1e9);
        if (giveChest(id, kind)) out.chest = M.CHESTS[kind].name;
      }
      const day = M.dayKey(t);
      ensureQuests(id, day);
      const prog = { play: 1, win: r.won ? 1 : 0, games: r.games || 0, cards: r.cards || 0 };
      for (const [kind, n] of Object.entries(prog)) if (n) q.progress.run(n, id, day, kind);
      return out;
    });
  }

  // ---------- clubs ----------
  function clubOf(id) { const m = q.member.get(id); return m ? q.clubById.get(m.club_id) : null; }
  function clubView(id) {
    const c = clubOf(id);
    if (!c) return null;
    const members = q.members.all(c.id).map((m) => ({ id: m.id, name: m.name, trophies: m.trophies, owner: m.id === c.owner }));
    return {
      id: c.id, name: c.name, members, trophies: members.reduce((a, m) => a + m.trophies, 0),
      messages: q.messages.all(c.id).reverse().map((m) => ({ name: m.name, text: m.text, at: m.at })),
    };
  }
  function createClub(id, name) {
    name = String(name || '').trim().replace(/\s+/g, ' ');
    if (!M.CLUB_NAME_RE.test(name)) return 'Nom de club : 3 à 20 caractères';
    if (clubOf(id)) return 'Quitte d’abord ton club';
    if (q.clubName.get(name.toLowerCase())) return 'Ce nom de club est déjà pris';
    return tx(() => {
      const c = q.addClub.run(name, name.toLowerCase(), id, now());
      q.join.run(id, Number(c.lastInsertRowid), now());
      return null;
    });
  }
  function joinClub(id, clubId) {
    if (clubOf(id)) return 'Quitte d’abord ton club';
    if (!q.clubById.get(clubId)) return 'Club introuvable';
    return tx(() => {
      if (q.memberCount.get(clubId).n >= M.CLUB_MAX) throw new Fail('Club complet');
      q.join.run(id, clubId, now());
      return null;
    });
  }
  function leaveClub(id) {
    const c = clubOf(id);
    if (!c) return 'Pas de club';
    return tx(() => {
      q.leave.run(id);
      const rest = q.members.all(c.id);
      if (!rest.length) q.dropClub.run(c.id);
      else if (c.owner === id) q.setOwner.run(rest[0].id, c.id);
      return null;
    });
  }
  function postMessage(id, text) {
    const c = clubOf(id);
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 140);
    if (!c) return 'Pas de club';
    if (!text) return 'Message vide';
    q.addMessage.run(c.id, id, text, now());
    q.pruneMessages.run(c.id, c.id);
    return null;
  }
  function donate(id, toId, cardId) {
    const c = clubOf(id), d = clubOf(toId);
    if (!c || !d || c.id !== d.id || id === toId) return 'Ce joueur n’est pas dans ton club';
    if (!Cards.find(cardId)) return 'Carte inconnue';
    const day = M.dayKey(now()), done = q.donated.get(id, day);
    if (done && done.count >= M.DONATE_PER_DAY) return 'Limite de dons atteinte aujourd’hui';
    return tx(() => {
      if (!q.takeCopy.run(1, id, cardId, 1).changes) throw new Fail('Pas d’exemplaire de cette carte à donner');
      q.addCopies.run(toId, cardId, 1);
      q.coins.run(M.DONATE_COINS, id);
      q.donate.run(id, day);
      return null;
    });
  }
  const clubs = (search) => q.clubList.all('%' + String(search || '').toLowerCase().replace(/[%_]/g, '') + '%');

  // ---------- rankings ----------
  const top = (limit) => q.topTrophies.all(limit);
  const rank = (u) => (u.played > 0 ? q.rankTrophies.get(u.trophies, u.trophies, u.wins, u.wins, u.id).r : null);
  const weeklyTop = (limit) => q.topWeekly.all(M.weekKey(now()), limit);

  // ---------- gems ledger (the future payment provider calls this; ref makes it idempotent) ----------
  function creditGems(ref, id, gems) {
    if (!ref || !Number.isInteger(gems) || gems <= 0) return false;
    return tx(() => {
      if (!q.purchase.run(String(ref), id, gems, now()).changes) return false;
      q.gems.run(gems, id);
      return true;
    });
  }

  // Everything the hub screen shows, in one request.
  function view(id) {
    const u = user(id), t = now();
    return {
      trophies: u.trophies, best: u.best_trophies, arena: M.arena(u.trophies), bestArena: M.arena(u.best_trophies),
      gems: u.gems, coins: u.coins, played: u.played, deck: deckOf(u), cards: cards(id), char: u.char,
      chests: q.chests.all(id).map((c) => chestView(c, t)), quests: quests(id), login: loginStatus(id),
      pass: passView(u), club: clubView(id), event: M.currentEvent(t), now: t,
    };
  }

  return {
    fresh, user, matchLoadout, upgradeCard, setDeck, setChar, startChest, openChest, quests, claimQuest,
    claimLogin, claimPass, buyPass, recordMatch, clubView, createClub, joinClub, leaveClub, postMessage, donate, clubs,
    top, rank, weeklyTop, creditGems, view, giveChest,
  };
}

class Fail extends Error {}

module.exports = { install };
