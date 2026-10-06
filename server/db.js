// Accounts and sessions in SQLite (node:sqlite, built into Node >= 22.13: no dependency).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const CO = require('../web/cosmetics.js');
const PG = require('../web/progression.js');
const M = require('../web/meta.js');
const meta = require('./meta.js');

const SESSION_DAYS = 365;
const NAME_RE = /^[A-Za-z0-9À-ÿ_.\- ]{3,16}$/;

function open(file, now) {  // now: clock override for tests
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      google_sub TEXT UNIQUE NOT NULL,
      email TEXT,
      name TEXT NOT NULL,
      name_key TEXT UNIQUE NOT NULL,   -- lower-cased name: pseudos are unique regardless of case
      look TEXT NOT NULL DEFAULT '{}',
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      item_id TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, kind, item_id)
    );
    CREATE TABLE IF NOT EXISTS user_cards (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 1, copies INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, card_id)
    );
    CREATE TABLE IF NOT EXISTS chests (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, seed INTEGER NOT NULL, opens_at INTEGER NOT NULL, claimed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS daily_quests (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day_key TEXT NOT NULL,
      slot INTEGER NOT NULL, kind TEXT NOT NULL, goal INTEGER NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
      claimed_at INTEGER, PRIMARY KEY (user_id, day_key, slot)
    );
    CREATE TABLE IF NOT EXISTS daily_claims (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day_key TEXT NOT NULL,
      streak INTEGER NOT NULL DEFAULT 0, claimed_at INTEGER NOT NULL, PRIMARY KEY (user_id, day_key)
    );
  `);
  // columns added after the first release
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('elo')) db.exec('ALTER TABLE users ADD COLUMN elo INTEGER NOT NULL DEFAULT ' + PG.START_ELO);
  if (!cols.includes('xp')) db.exec('ALTER TABLE users ADD COLUMN xp INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('stats')) db.exec("ALTER TABLE users ADD COLUMN stats TEXT NOT NULL DEFAULT '" + JSON.stringify(PG.START_STATS) + "'");
  if (!cols.includes('coins')) db.exec('ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('owned')) db.exec("ALTER TABLE users ADD COLUMN owned TEXT NOT NULL DEFAULT '{}'");
  const q = {
    bySub: db.prepare('SELECT * FROM users WHERE google_sub = ?'),
    byId: db.prepare('SELECT * FROM users WHERE id = ?'),
    nameTaken: db.prepare('SELECT id FROM users WHERE name_key = ?'),
    insert: db.prepare('INSERT INTO users (google_sub, email, name, name_key, look, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    setEmail: db.prepare('UPDATE users SET email = ? WHERE id = ?'),
    setProfile: db.prepare('UPDATE users SET name = ?, name_key = ?, look = ? WHERE id = ?'),
    setStats: db.prepare('UPDATE users SET stats = ? WHERE id = ?'),
    setOwned: db.prepare('UPDATE users SET owned = ? WHERE id = ?'),
    addInventory: db.prepare('INSERT OR IGNORE INTO inventory (user_id, kind, item_id, acquired_at) VALUES (?, ?, ?, ?)'),
    takeCoins: db.prepare('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?'),
    setLook: db.prepare('UPDATE users SET look = ? WHERE id = ?'),
    newSession: db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'),
    session: db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?'),
    dropSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
    purge: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  };
  // Additive backfill for accounts created before the normalized inventory table.
  for (const u of db.prepare('SELECT id, owned, created_at FROM users').all()) {
    const owned = JSON.parse(u.owned || '{}');
    for (const [kind, ids] of Object.entries(owned)) for (const itemId of ids || []) q.addInventory.run(u.id, kind, itemId, u.created_at);
  }
  q.purge.run(Date.now());
  const mt = meta.install(db, now);
  const arenaOf = (u) => M.arena(u.best_trophies || 0);

  function freeName(base) {  // "Joueur4821"-style default pseudo, never the real Google name
    for (;;) {
      const n = base + crypto.randomInt(1000, 10000);
      if (!q.nameTaken.get(n.toLowerCase())) return n;
    }
  }

  return {
    // Google account -> user row (created on first login).
    loginGoogle(sub, email) {
      let u = q.bySub.get(sub);
      if (!u) {
        const name = freeName('Joueur');
        q.insert.run(sub, email || null, name, name.toLowerCase(), JSON.stringify(CO.sanitize({}, 0)), Date.now());
        u = q.bySub.get(sub);
      } else if (email && u.email !== email) q.setEmail.run(email, u.id);
      return u;
    },
    createSession(userId) {
      const token = crypto.randomBytes(24).toString('base64url');
      q.newSession.run(token, userId, Date.now() + SESSION_DAYS * 864e5);
      return token;
    },
    userBySession(token) { return token ? mt.fresh(q.session.get(token, Date.now())) : null; },
    dropSession(token) { if (token) q.dropSession.run(token); },
    user(id) { return mt.fresh(q.byId.get(id)); },
    // Returns an error message, or null when saved.
    updateProfile(id, name, look) {
      name = String(name || '').trim().replace(/\s+/g, ' ');
      if (!NAME_RE.test(name)) return 'Pseudo : 3 à 16 caractères (lettres, chiffres, espace, _ . -)';
      const taken = q.nameTaken.get(name.toLowerCase());
      if (taken && taken.id !== id) return 'Ce pseudo est déjà pris';
      const u = q.byId.get(id), owned = u ? JSON.parse(u.owned || '{}') : {};
      const current = u ? CO.sanitize(JSON.parse(u.look), 0) : CO.sanitize({}, 0);
      const raw = Object.assign({}, current, look || {});
      if (look && look.cloth && !look.shirt && !look.shorts) raw.shirt = raw.shorts = look.cloth;  // legacy profile editor
      for (const kind of CO.SHOP_KINDS) {
        const itemId = raw[kind] || raw.cloth && CO.find(kind, raw.cloth) && raw.cloth;
        if (itemId && !CO.owns(owned, kind, itemId, u && arenaOf(u))) return 'Article non débloqué : ' + kind;
      }
      const nextLook = CO.sanitize(raw, 0);
      q.setProfile.run(name, name.toLowerCase(), JSON.stringify(nextLook), id);
      return null;
    },
    // Ranked or event result; see meta.recordMatch.
    recordMatch: mt.recordMatch,
    owned(id) { const u = q.byId.get(id); return u ? JSON.parse(u.owned || '{}') : {}; },
    shop(id, action, kind, itemId) {
      if (!CO.SHOP_KINDS.includes(kind)) return 'Catégorie invalide';
      const item = CO.find(kind, itemId);
      if (!item) return 'Article inconnu';
      const u = q.byId.get(id);
      if (!u) return 'Compte introuvable';
      const owned = JSON.parse(u.owned || '{}');
      if (action === 'buy') {
        if (CO.owns(owned, kind, itemId)) return 'Article déjà possédé';
        if (item.unlock !== 'shop') return item.unlock === 'pass' ? 'Article du pass de saison' : 'Article gratuit';
        const price = CO.priceOn(kind, itemId, M.dayKey(now ? now() : Date.now()));
        db.exec('BEGIN IMMEDIATE');
        try {
          if (!q.takeCoins.run(price, id, price).changes) { db.exec('ROLLBACK'); return 'Pas assez de pièces'; }
          owned[kind] = Array.from(new Set([...(owned[kind] || []), itemId]));
          q.setOwned.run(JSON.stringify(owned), id);
          q.addInventory.run(id, kind, itemId, Date.now());
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        return null;
      }
      if (action === 'equip') {
        if (!CO.owns(owned, kind, itemId, arenaOf(u))) return 'Article non débloqué';
        const look = CO.sanitize(JSON.parse(u.look), 0);
        look[kind] = itemId;
        q.setLook.run(JSON.stringify(look), id);
        return null;
      }
      return 'Action invalide';
    },
    // Returns an error message, or null when saved.
    setStats(id, stats) {
      const u = q.byId.get(id);
      if (!u || !PG.validStats(stats, u.xp)) return 'Répartition de capacités invalide';
      q.setStats.run(JSON.stringify(stats), id);
      return null;
    },
    leaderboard: mt.top,
    rank: mt.rank,
    meta: mt,
    close() { db.close(); },
  };
}

// What the client is allowed to see of a user row.
function publicProfile(u) {
  const lv = PG.level(u.xp), stats = JSON.parse(u.stats);
  return {
    name: u.name, look: CO.sanitize(JSON.parse(u.look), 0), wins: u.wins, losses: u.losses, elo: u.elo, xp: u.xp,
    level: lv.level, into: lv.into, need: lv.need, stats, points: PG.points(u.xp) - PG.spent(stats),
    coins: u.coins || 0, owned: CO.inventory(JSON.parse(u.owned || '{}')),
    trophies: u.trophies || 0, best: u.best_trophies || 0, arena: M.arena(u.trophies || 0), bestArena: M.arena(u.best_trophies || 0),
    gems: u.gems || 0, char: u.char || 'allround', played: u.played || 0,
  };
}

module.exports = { open, publicProfile, NAME_RE };
