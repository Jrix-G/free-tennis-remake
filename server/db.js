// Accounts and sessions in SQLite (node:sqlite, built into Node >= 22.13: no dependency).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const CO = require('../web/cosmetics.js');

const SESSION_DAYS = 365;
const NAME_RE = /^[A-Za-z0-9À-ÿ_.\- ]{3,16}$/;

function open(file) {
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
  `);
  const q = {
    bySub: db.prepare('SELECT * FROM users WHERE google_sub = ?'),
    byId: db.prepare('SELECT * FROM users WHERE id = ?'),
    nameTaken: db.prepare('SELECT id FROM users WHERE name_key = ?'),
    insert: db.prepare('INSERT INTO users (google_sub, email, name, name_key, look, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    setEmail: db.prepare('UPDATE users SET email = ? WHERE id = ?'),
    setProfile: db.prepare('UPDATE users SET name = ?, name_key = ?, look = ? WHERE id = ?'),
    win: db.prepare('UPDATE users SET wins = wins + 1 WHERE id = ?'),
    loss: db.prepare('UPDATE users SET losses = losses + 1 WHERE id = ?'),
    newSession: db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'),
    session: db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?'),
    dropSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
    purge: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  };
  q.purge.run(Date.now());

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
    userBySession(token) { return token ? q.session.get(token, Date.now()) || null : null; },
    dropSession(token) { if (token) q.dropSession.run(token); },
    user(id) { return q.byId.get(id) || null; },
    // Returns an error message, or null when saved.
    updateProfile(id, name, look) {
      name = String(name || '').trim().replace(/\s+/g, ' ');
      if (!NAME_RE.test(name)) return 'Pseudo : 3 à 16 caractères (lettres, chiffres, espace, _ . -)';
      const taken = q.nameTaken.get(name.toLowerCase());
      if (taken && taken.id !== id) return 'Ce pseudo est déjà pris';
      q.setProfile.run(name, name.toLowerCase(), JSON.stringify(CO.sanitize(look, 0)), id);
      return null;
    },
    recordResult(id, won) { (won ? q.win : q.loss).run(id); },
    close() { db.close(); },
  };
}

// What the client is allowed to see of a user row.
function publicProfile(u) {
  return { name: u.name, look: JSON.parse(u.look), wins: u.wins, losses: u.losses };
}

module.exports = { open, publicProfile, NAME_RE };
