#!/usr/bin/env node
// Free Tennis online server: serves web/ and runs every 2-player match authoritatively.
// Both browsers send one input per 30 Hz tick; the server consumes them in order (one per tick and
// per player), steps the shared TennisLogic and broadcasts the state. Clients replay their own
// unacknowledged inputs on top of it (net.js), so their own player and the ball react instantly.
// Quick matches fall back to a bot after 5 s; accounts use "Sign in with Google" + SQLite.
// Node >= 22.13, no dependency. Usage: node server/server.js [--port 8780] [--host 0.0.0.0]
//   [--google-client-id ID] [--db data/tennis.db] [--tick-ms 33.3] [--bot-wait-ms 5000]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('../web/game.js');
const CO = require('../web/cosmetics.js');
const PG = require('../web/progression.js');
const bots = require('./bots.js');
const { verifyGoogleToken } = require('./auth.js');
const { open: openDb, publicProfile } = require('./db.js');

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const PORT = Number(arg('port', process.env.PORT || 8780));
const HOST = arg('host', process.env.HOST || '0.0.0.0');
const WEB_DIR = path.join(__dirname, '..', 'web');
const TICK_MS = Number(arg('tick-ms', 1000 / 30));  // tests run the clock faster
const MAX_QUEUE = 4;          // inputs buffered per player; older ones are dropped beyond that
const STALE_MS = 1500;        // no input for that long (hidden tab...) -> pause
const RECONNECT_MS = 60000;   // a dropped player keeps their slot that long
const BOT_WAIT_MS = Number(arg('bot-wait-ms', 5000));  // quick match: search time before a bot steps in
// Google OAuth client id (public, not a secret). Without it, accounts are disabled and everyone plays as a guest.
const GOOGLE_CLIENT_ID = arg('google-client-id', process.env.GOOGLE_CLIENT_ID || '');
const db = openDb(arg('db', process.env.TENNIS_DB || path.join(__dirname, '..', 'data', 'tennis.db')));
// Tests sign their own tokens: TENNIS_TEST_JWKS points to a JSON file of public keys.
const keyProvider = process.env.TENNIS_TEST_JWKS ? async () => JSON.parse(fs.readFileSync(process.env.TENNIS_TEST_JWKS, 'utf8')).keys : undefined;

// ---------- minimal RFC 6455 server side ----------
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function frame(op, payload) {
  const n = payload.length;
  let head;
  if (n < 126) head = Buffer.from([0x80 | op, n]);
  else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, payload]);
}

class WS {
  constructor(sock) {
    this.sock = sock; this.buf = Buffer.alloc(0); this.frag = []; this.open = true;
    this.onmessage = null; this.onclose = null; this.alive = true;
    sock.setNoDelay(true);
    sock.on('data', (d) => this.data(d));
    sock.on('close', () => this.closed());
    sock.on('error', () => this.closed());
  }
  send(obj) {
    if (this.open) this.sock.write(frame(0x1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj))));
  }
  close() { if (this.open) { this.sock.end(frame(0x8, Buffer.alloc(0))); this.closed(); } }
  closed() {
    if (!this.open) return;
    this.open = false; this.sock.destroy();
    if (this.onclose) this.onclose();
  }
  data(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      let n = b[1] & 0x7f, off = 2;
      if (n === 126) { if (b.length < 4) return; n = b.readUInt16BE(2); off = 4; }
      else if (n === 127) { if (b.length < 10) return; n = Number(b.readBigUInt64BE(2)); off = 10; }
      if (n > 1 << 16) return this.closed();       // our messages are tiny
      const masked = b[1] & 0x80;
      if (b.length < off + (masked ? 4 : 0) + n) return;
      let payload = b.subarray(off + (masked ? 4 : 0), off + (masked ? 4 : 0) + n);
      if (masked) {
        const mask = b.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buf = b.subarray(off + (masked ? 4 : 0) + n);
      const op = b[0] & 0x0f, fin = b[0] & 0x80;
      this.alive = true;
      if (op === 0x8) return this.close();
      if (op === 0x9) { this.sock.write(frame(0xA, payload)); continue; }
      if (op === 0xA) continue;
      this.frag.push(payload);
      if (fin) {
        const text = Buffer.concat(this.frag).toString('utf8');
        this.frag = [];
        let m = null;
        try { m = JSON.parse(text); } catch (e) { /* ignore garbage */ }
        if (m && this.onmessage) this.onmessage(m);
      }
    }
  }
}

// ---------- rooms ----------
const rooms = new Map();      // code -> Room
const clients = new Set();    // every open WS
let quickRoom = null;         // public room waiting for its second player
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

class Room {
  constructor(isPublic) {
    this.code = newCode(); this.isPublic = isPublic;
    // slot: { token, ws, queue, last, ack, lastInput, goneAt, name, look, userId } or a bot { bot, name, look, stats }
    this.slots = [null, null];
    this.G = null; this.prevOverSp = [true, true]; this.started = false; this.wasOver = false;
    this.botAt = isPublic ? Date.now() + BOT_WAIT_MS : 0;  // quick match: a bot steps in after that
    rooms.set(this.code, this);
  }
  newMatch() {
    const [a, b] = this.slots;  // everyone plays with their own unlocked abilities
    this.G = L.createMatch({
      names: [a.name, b.name], data: [PG.matchData(a.stats), PG.matchData(b.stats)], ctrl: ['human', b.bot ? 'ai' : 'human'],
      matchMode: 0, seed: crypto.randomInt(2 ** 32 - 1) + 1,
    });
    this.prevOverSp = [true, true]; this.wasOver = false; this.recorded = false;
  }
  attach(ws, idx, token) {
    let s = this.slots[idx];
    if (!s) s = this.slots[idx] = { token: token || crypto.randomBytes(9).toString('base64url'), queue: [], last: {}, ack: 0 };
    if (s.ws && s.ws !== ws) { s.ws.room = null; s.ws.close(); }  // a newer tab takes the slot
    Object.assign(s, { ws, goneAt: 0, lastInput: Date.now(), queue: [], name: ws.name, look: ws.look, userId: ws.userId,
      stats: ws.stats, elo: ws.elo, level: ws.level });
    ws.room = this; ws.idx = idx;
    ws.send({ t: 'room', code: this.code, me: idx, token: s.token, public: this.isPublic });
    if (this.slots[0] && this.slots[1] && !this.started) this.start();
    this.notify();
  }
  start() {  // the waiting player sent no input while searching: restart their clock, no false pause
    this.started = true; this.newMatch();
    for (const s of this.slots) if (!s.bot) s.lastInput = Date.now();
  }
  addBot() {
    const h = this.slots[0];
    this.slots[1] = Object.assign({ bot: true, name: bots.botName(), look: bots.botLook(), queue: [], last: {}, ack: 0 },
      bots.botFor(h.stats, h.elo, h.level));
    if (quickRoom === this) quickRoom = null;
    this.start(); this.notify();
  }
  notify() {
    const players = this.slots.map((s) => (s ? { name: s.name, look: s.look, elo: s.elo, level: s.level } : null));
    for (let i = 0; i < 2; i++) {
      const s = this.slots[i], o = this.slots[1 - i];
      if (s && s.ws) s.ws.send({ t: 'peer', on: !!(o && (o.ws || o.bot)), started: this.started, players });
    }
  }
  detach(ws) {
    const s = this.slots[ws.idx];
    if (!s || s.ws !== ws) return;
    s.ws = null; s.goneAt = Date.now();
    if (!this.started) return this.close();
    this.notify();
  }
  leave(ws) {  // explicit quit: the opponent is told and the room ends; quitting a ranked match loses it
    if (this.started && !this.G.over) this.record(1 - ws.idx);
    const o = this.slots[1 - ws.idx];
    ws.room = null;
    if (o && o.ws) { o.ws.send({ t: 'closed' }); o.ws.room = null; }
    this.close();
  }
  close() {
    rooms.delete(this.code);
    if (quickRoom === this) quickRoom = null;
    for (const s of this.slots) if (s && s.ws) s.ws.room = null;
  }
  input(ws, m) {
    const s = this.slots[ws.idx];
    if (!s || s.ws !== ws || typeof m.s !== 'number' || !m.k) return;
    const k = { l: !!m.k.l, r: !!m.k.r, u: !!m.k.u, d: !!m.k.d, sp: !!m.k.sp };
    s.queue.push({ s: m.s, k });
    s.lastInput = Date.now();
    while (s.queue.length > MAX_QUEUE) {  // too far behind: drop the oldest, keep its Space press
      const old = s.queue.shift();
      if (old.k.sp) s.queue[0].k.sp = true;
    }
  }
  get paused() {
    const now = Date.now();
    return this.slots.some((s) => !s || (!s.bot && (!s.ws || now - s.lastInput > STALE_MS)));
  }
  tick() {
    const now = Date.now();
    if (!this.started) {
      if (this.botAt && now >= this.botAt && this.slots[0] && this.slots[0].ws && !this.slots[1]) this.addBot();
      else return;
    }
    const gone = this.slots.findIndex((s) => s && !s.bot && !s.ws && now - s.goneAt > RECONNECT_MS);
    if (gone >= 0) {
      if (!this.G.over) this.record(1 - gone);  // never came back: forfeit
      for (const s of this.slots) if (s && s.ws) s.ws.send({ t: 'closed' });
      return this.close();
    }
    const G = this.G;
    let ev = [];
    const paused = this.paused;
    if (paused) {  // inputs received meanwhile are acknowledged but not simulated
      for (const s of this.slots) if (s && s.queue.length) { s.ack = s.queue[s.queue.length - 1].s; s.queue = []; }
    } else {
      const pads = this.slots.map((s) => {
        if (s.bot) return {};  // the logic's own AI plays that side
        const q = s.queue.shift();
        if (q) { s.ack = q.s; s.last = q.k; return q.k; }
        return Object.assign({}, s.last, { sp: false });  // late input: hold the direction
      });
      if (G.over) {  // rematch when either player presses Space
        const sp = [pads[0].sp, pads[1].sp];
        if ((sp[0] && !this.prevOverSp[0]) || (sp[1] && !this.prevOverSp[1])) this.newMatch();
        else this.prevOverSp = sp;
      } else this.prevOverSp = [true, true];
      L.step(this.G, pads);
      ev = this.G.events;
      if (this.G.over && !this.wasOver) this.record(this.G.match_winner);
      this.wasOver = this.G.over;
    }
    const g = JSON.stringify(this.G);
    for (let i = 0; i < 2; i++) {
      const s = this.slots[i];
      if (s && s.ws) s.ws.send('{"t":"snap","paused":' + paused + ',"ack":' + s.ack + ',"ev":' + JSON.stringify(ev) + ',"g":' + g + '}');
    }
  }
  // Ranked (quick match) result for logged-in players: W/L, XP, Elo. Guests count as 1000.
  record(winner) {
    if (!this.isPublic || this.recorded) return;
    this.recorded = true;
    const ratings = this.slots.map((s) => (s.elo == null ? PG.START_ELO : s.elo));
    const next = PG.elo(ratings[0], ratings[1], winner === 0 ? 1 : 0);
    this.slots.forEach((s, i) => {
      if (s.bot || !s.userId) return;
      db.recordResult(s.userId, winner === i, next[i]);
      const u = db.user(s.userId);
      s.elo = u.elo; s.level = PG.level(u.xp).level;
      if (s.ws) {
        s.ws.send({ t: 'result', won: winner === i, elo: next[i] - ratings[i], xp: winner === i ? PG.XP_WIN : PG.XP_LOSS });
        s.ws.send({ t: 'profile', profile: profileOf(u) });
      }
    });
    const b = this.slots.find((s) => s.bot);
    if (b) b.elo = next[this.slots.indexOf(b)];
  }
}

function onMessage(ws, m) {
  if (m.t === 'ping') return ws.send({ t: 'pong', c: m.c });
  if (m.t === 'in') { if (ws.room) ws.room.input(ws, m); return; }
  if (m.t === 'leave') { if (ws.room) ws.room.leave(ws); return; }
  if (ws.room) ws.room.leave(ws);  // any lobby action leaves the current room
  if (m.t === 'quick') {
    if (quickRoom && quickRoom.slots[0] && quickRoom.slots[0].ws) {
      const r = quickRoom; quickRoom = null; r.attach(ws, 1);
    } else { quickRoom = new Room(true); quickRoom.attach(ws, 0); }
  } else if (m.t === 'create') {
    new Room(false).attach(ws, 0);
  } else if (m.t === 'join') {
    const r = rooms.get(String(m.code || '').toUpperCase().trim());
    if (!r) return ws.send({ t: 'err', msg: 'Partie introuvable' });
    const mine = r.slots.findIndex((s) => s && !s.bot && m.token && s.token === m.token);  // reconnection
    if (mine >= 0) return r.attach(ws, mine, m.token);
    if (r.slots[1]) return ws.send({ t: 'err', msg: 'Partie déjà complète' });
    if (quickRoom === r) quickRoom = null;
    r.attach(ws, 1);
  }
}

// ---------- fixed-rate loop shared by all rooms ----------
let next = performance.now();
function loop() {
  const now = performance.now();
  while (next <= now) {
    for (const r of rooms.values()) r.tick();
    next += TICK_MS;
    if (now - next > 250) next = now;  // after a stall, skip instead of fast-forwarding
  }
  setTimeout(loop, Math.max(0, next - performance.now()));
}
loop();

// lobby keepalive (proxies drop idle WebSockets) + player count
setInterval(() => {
  for (const ws of clients) {
    if (!ws.alive) { ws.closed(); continue; }
    ws.alive = false;
    ws.send({ t: 'hello', online: clients.size });
  }
}, 10000);

// ---------- identity: session cookie -> account, otherwise a guest pseudo ----------
const COOKIE = 'tsess';
function cookieToken(req) {
  const m = /(?:^|;\s*)tsess=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}
function identify(ws, user) {
  ws.userId = user ? user.id : 0;
  ws.name = user ? user.name : ws.name || 'Invité' + crypto.randomInt(1000, 10000);
  ws.look = user ? JSON.parse(user.look) : CO.sanitize({}, 0);
  ws.stats = user ? JSON.parse(user.stats) : PG.START_STATS.slice();  // guests keep the starting abilities
  ws.elo = user ? user.elo : null;
  ws.level = user ? PG.level(user.xp).level : null;
}
const profileOf = (u) => Object.assign(publicProfile(u), { rank: db.rank(u) });
function refreshUser(id) {  // profile edited or logged in elsewhere: update open sockets
  const u = db.user(id);
  for (const ws of clients) if (ws.userId === id) { identify(ws, u); ws.send({ t: 'profile', profile: profileOf(u) }); }
}

// ---------- HTTP ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function json(res, code, obj, headers) {
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, headers));
  res.end(JSON.stringify(obj));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    // JSON only: a cross-site form cannot send that content type without a CORS preflight we never grant.
    if (!/^application\/json/.test(req.headers['content-type'] || '')) return reject(new Error('json expected'));
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 16384) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); } });
  });
}
function sessionCookie(req, token, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + secure;
}

async function api(req, res, pathname) {
  const user = db.userBySession(cookieToken(req));
  if (pathname === '/api/config' && req.method === 'GET') return json(res, 200, { googleClientId: GOOGLE_CLIENT_ID || null });
  if (pathname === '/api/me' && req.method === 'GET') return json(res, 200, { profile: user ? profileOf(user) : null });
  if (pathname === '/api/leaderboard' && req.method === 'GET') {
    const row = (u, rank) => ({ rank, name: u.name, elo: u.elo, wins: u.wins, losses: u.losses, level: PG.level(u.xp).level, look: JSON.parse(u.look) });
    return json(res, 200, { top: db.leaderboard(20).map((u, i) => row(u, i + 1)), me: user && db.rank(user) ? row(user, db.rank(user)) : null });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  let body;
  try { body = await readJson(req); } catch (e) { return json(res, 400, { error: 'Requête invalide' }); }
  if (pathname === '/api/login') {
    if (!GOOGLE_CLIENT_ID) return json(res, 503, { error: 'Connexion Google non configurée' });
    let claims;
    try { claims = await verifyGoogleToken(body.credential, GOOGLE_CLIENT_ID, keyProvider); } catch (e) {
      return json(res, 401, { error: 'Connexion Google refusée' });
    }
    const u = db.loginGoogle(claims.sub, claims.email);
    const token = db.createSession(u.id);
    return json(res, 200, { profile: profileOf(u) }, { 'Set-Cookie': sessionCookie(req, token, 365 * 86400) });
  }
  if (pathname === '/api/logout') {
    db.dropSession(cookieToken(req));
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }
  if (pathname === '/api/profile') {
    if (!user) return json(res, 401, { error: 'Non connecté' });
    const err = db.updateProfile(user.id, body.name, body.look);
    if (err) return json(res, 400, { error: err });
    refreshUser(user.id);
    return json(res, 200, { profile: profileOf(db.user(user.id)) });
  }
  if (pathname === '/api/stats') {
    if (!user) return json(res, 401, { error: 'Non connecté' });
    const err = db.setStats(user.id, body.stats);
    if (err) return json(res, 400, { error: err });
    refreshUser(user.id);
    return json(res, 200, { profile: profileOf(db.user(user.id)) });
  }
  return json(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    return api(req, res, url.pathname).catch((e) => { console.error(e); json(res, 500, { error: 'Erreur serveur' }); });
  }
  if (url.pathname === '/health') return json(res, 200, { ok: true, rooms: rooms.size, online: clients.size });
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.join(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR + path.sep)) { res.writeHead(403, { 'Cache-Control': 'no-store' }); return res.end(); }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404, { 'Cache-Control': 'no-store' }); return res.end('Not found'); }  // never cached by the CDN
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  });
});

server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (new URL(req.url, 'http://x').pathname !== '/ws' || !key) return sock.destroy();
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const ws = new WS(sock);
  identify(ws, db.userBySession(cookieToken(req)));
  clients.add(ws);
  ws.onmessage = (m) => onMessage(ws, m);
  ws.onclose = () => { clients.delete(ws); if (ws.room) ws.room.detach(ws); };
  ws.send({ t: 'hello', online: clients.size });
});

server.listen(PORT, HOST, () => console.log('Free Tennis : http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT + '/' +
  (GOOGLE_CLIENT_ID ? '' : '  (connexion Google désactivée : GOOGLE_CLIENT_ID absent)')));
