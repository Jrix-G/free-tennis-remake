#!/usr/bin/env node
// Free Tennis online server: serves web/ and runs every 2-player match authoritatively.
// Both browsers send one input per 30 Hz tick; the server consumes them in order (one per tick and
// per player), steps the shared TennisLogic and broadcasts the state. Clients replay their own
// unacknowledged inputs on top of it (net.js), so their own player and the ball react instantly.
// Node >= 18, no dependency. Usage: node server/server.js [--port 8780] [--host 0.0.0.0] [--tick-ms 33.3]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('../web/game.js');

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const PORT = Number(arg('port', process.env.PORT || 8780));
const HOST = arg('host', process.env.HOST || '0.0.0.0');
const WEB_DIR = path.join(__dirname, '..', 'web');
const TICK_MS = Number(arg('tick-ms', 1000 / 30));  // tests run the clock faster
const MAX_QUEUE = 4;          // inputs buffered per player; older ones are dropped beyond that
const STALE_MS = 1500;        // no input for that long (hidden tab...) -> pause
const RECONNECT_MS = 60000;   // a dropped player keeps their slot that long
const BALANCED = [5, 5, 5, 5, 0, 0];

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
    this.slots = [null, null];  // { token, ws, queue, last, ack, lastInput, goneAt }
    this.G = null; this.prevOverSp = [true, true]; this.started = false;
    rooms.set(this.code, this);
  }
  newMatch() {
    this.G = L.createMatch({
      names: ['P1', 'P2'], data: [BALANCED, BALANCED], ctrl: ['human', 'human'], matchMode: 0,
      seed: crypto.randomInt(2 ** 32 - 1) + 1,
    });
    this.prevOverSp = [true, true];
  }
  attach(ws, idx, token) {
    let s = this.slots[idx];
    if (!s) s = this.slots[idx] = { token: token || crypto.randomBytes(9).toString('base64url'), queue: [], last: {}, ack: 0 };
    if (s.ws && s.ws !== ws) { s.ws.room = null; s.ws.close(); }  // a newer tab takes the slot
    Object.assign(s, { ws, goneAt: 0, lastInput: Date.now(), queue: [] });
    ws.room = this; ws.idx = idx;
    ws.send({ t: 'room', code: this.code, me: idx, token: s.token, public: this.isPublic });
    if (this.slots[0] && this.slots[1] && !this.started) { this.started = true; this.newMatch(); }
    this.notify();
  }
  notify() {
    for (let i = 0; i < 2; i++) {
      const s = this.slots[i], o = this.slots[1 - i];
      if (s && s.ws) s.ws.send({ t: 'peer', on: !!(o && o.ws), started: this.started });
    }
  }
  detach(ws) {
    const s = this.slots[ws.idx];
    if (!s || s.ws !== ws) return;
    s.ws = null; s.goneAt = Date.now();
    if (!this.started) return this.close();
    this.notify();
  }
  leave(ws) {  // explicit quit: the opponent is told and the room ends
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
    return this.slots.some((s) => !s || !s.ws || now - s.lastInput > STALE_MS);
  }
  tick() {
    if (!this.started) return;
    const now = Date.now();
    if (this.slots.some((s) => s && !s.ws && now - s.goneAt > RECONNECT_MS)) {
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
    }
    const g = JSON.stringify(this.G);
    for (let i = 0; i < 2; i++) {
      const s = this.slots[i];
      if (s && s.ws) s.ws.send('{"t":"snap","paused":' + paused + ',"ack":' + s.ack + ',"ev":' + JSON.stringify(ev) + ',"g":' + g + '}');
    }
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
    const mine = r.slots.findIndex((s) => s && m.token && s.token === m.token);  // reconnection
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

// ---------- HTTP ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size, online: clients.size }));
  }
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.join(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
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
  clients.add(ws);
  ws.onmessage = (m) => onMessage(ws, m);
  ws.onclose = () => { clients.delete(ws); if (ws.room) ws.room.detach(ws); };
  ws.send({ t: 'hello', online: clients.size });
});

server.listen(PORT, HOST, () => console.log('Free Tennis : http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT + '/'));
