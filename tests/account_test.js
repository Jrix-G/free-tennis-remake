// Accounts end to end: the server trusts a test key set instead of Google's, so this test signs its
// own ID tokens and checks login, sessions, profile rules, and that the game uses the profile.
// Run: node tests/account_test.js   (Node >= 22.13)
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const N = require('../web/net.js');
const L = require('../web/game.js');
const DB = require('../server/db.js');
const CO = require('../web/cosmetics.js');

const PORT = 8797, BASE = 'http://127.0.0.1:' + PORT, CLIENT_ID = 'test-client.apps.googleusercontent.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwksFile = path.join(os.tmpdir(), 'tennis-test-jwks-' + process.pid + '.json');
fs.writeFileSync(jwksFile, JSON.stringify({ keys: [Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'RS256', use: 'sig' })] }));

function idToken(claims, key = privateKey, kid = 'k1') {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = enc({ alg: 'RS256', kid, typ: 'JWT' }) + '.' +
    enc(Object.assign({ iss: 'https://accounts.google.com', aud: CLIENT_ID, iat: now, exp: now + 3600 }, claims));
  return body + '.' + crypto.sign('RSA-SHA256', Buffer.from(body), key).toString('base64url');
}

async function post(p, body, cookie, type = 'application/json') {
  const res = await fetch(BASE + p, { method: 'POST', headers: Object.assign({ 'Content-Type': type }, cookie ? { Cookie: cookie } : {}), body: JSON.stringify(body) });
  return { status: res.status, json: await res.json(), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
const get = async (p, cookie) => (await fetch(BASE + p, { headers: cookie ? { Cookie: cookie } : {} })).json();
const login = async (sub) => post('/api/login', { credential: idToken({ sub, email: sub + '@example.com' }) });

(async () => {
  // Currency and cosmetic ownership are enforced and saved by the same DB layer the API uses.
  const shopDb = DB.open(':memory:');
  try {
    const u = shopDb.loginGoogle('shop-test', 'shop@example.com');
    assert.strictEqual(DB.publicProfile(u).coins, 0, 'new account starts with no coins');
    assert.strictEqual(shopDb.shop(u.id, 'buy', 'racket', 'gold'), 'Pas assez de pièces');
    for (let i = 0; i < 5; i++) shopDb.recordMatch(u.id, { won: true, newElo: 1000 + (i + 1) * 10 });
    assert.strictEqual(DB.publicProfile(shopDb.user(u.id)).coins, 500, 'completed wins grant persisted coins');
    assert.strictEqual(shopDb.shop(u.id, 'buy', 'racket', 'gold'), null);
    assert.strictEqual(shopDb.shop(u.id, 'equip', 'racket', 'gold'), null);
    assert.strictEqual(shopDb.shop(u.id, 'buy', 'shirt', 'starlight'), null);
    assert.strictEqual(shopDb.shop(u.id, 'equip', 'shirt', 'starlight'), null);
    assert.strictEqual(shopDb.shop(u.id, 'buy', 'shorts', 'neon-pink'), 'Pas assez de pièces', 'cannot overspend');
    const profile = DB.publicProfile(shopDb.user(u.id));
    assert.strictEqual(profile.coins, 100);
    assert.strictEqual(profile.look.racket, 'gold');
    assert.strictEqual(profile.look.shirt, 'starlight');
    assert.ok(profile.owned.racket.includes('gold') && profile.owned.shirt.includes('starlight'));
    assert.strictEqual(shopDb.updateProfile(u.id, profile.name, { racket: 'neon' }), 'Article non débloqué : racket', 'profile API cannot equip an unowned cosmetic');
  } finally { shopDb.close(); }

  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server', 'server.js'),
    '--port', String(PORT), '--host', '127.0.0.1', '--db', ':memory:', '--google-client-id', CLIENT_ID, '--bot-wait-ms', '300'],
  { stdio: 'inherit', env: Object.assign({}, process.env, { TENNIS_TEST_JWKS: jwksFile }) });
  try {
    await sleep(500);
    assert.strictEqual((await get('/api/config')).googleClientId, CLIENT_ID);
    assert.strictEqual((await get('/api/me')).profile, null, 'guest by default');

    // rejected tokens
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    for (const [what, tok] of [['forged signature', idToken({ sub: 'x' }, other)], ['wrong audience', idToken({ sub: 'x', aud: 'evil' })],
      ['expired', idToken({ sub: 'x', exp: 1000 })], ['wrong issuer', idToken({ sub: 'x', iss: 'https://evil.example' })], ['garbage', 'abc']]) {
      assert.strictEqual((await post('/api/login', { credential: tok })).status, 401, what + ' is refused');
    }
    assert.strictEqual((await post('/api/login', {}, null, 'text/plain')).status, 400, 'non-JSON POST refused (CSRF)');

    // login creates the account with a neutral pseudo and a session cookie
    const a = await login('google-sub-a');
    assert.strictEqual(a.status, 200);
    assert.ok(/^Joueur\d{4}$/.test(a.json.profile.name), 'default pseudo never exposes the Google name');
    assert.ok(/^tsess=/.test(a.cookie), 'session cookie set');
    assert.strictEqual((await get('/api/me', a.cookie)).profile.name, a.json.profile.name);
    assert.strictEqual((await login('google-sub-a')).json.profile.name, a.json.profile.name, 'same Google account, same user');

    // profile rules
    assert.strictEqual((await post('/api/profile', { name: 'x' }, a.cookie)).status, 400, 'too short');
    assert.strictEqual((await post('/api/profile', { name: '<script>' }, a.cookie)).status, 400, 'bad characters');
    assert.strictEqual((await post('/api/profile', { name: 'Ace Lucas' }, null)).status, 401, 'needs a session');
    assert.strictEqual((await post('/api/shop', { action: 'buy', kind: 'racket', id: 'gold' }, null)).status, 401, 'shop needs a session');
    const saved = await post('/api/profile', { name: '  Ace   Lucas ', look: { cloth: 'red', hair: 'nope' } }, a.cookie);
    assert.strictEqual(saved.status, 200);
    assert.deepStrictEqual([saved.json.profile.name, saved.json.profile.look], ['Ace Lucas', {
      cloth: 'red', hair: 'brown', racket: 'classic', shirt: 'red', shorts: 'red', cap: 'none', court: 'arena',
    }], 'name trimmed, unknown item reset and legacy outfit colors preserved');
    const b = await login('google-sub-b');
    const dup = await post('/api/profile', { name: 'ace lucas' }, b.cookie);
    assert.ok(dup.status === 400 && /pris/.test(dup.json.error), 'pseudos are unique regardless of case');

    // the game uses the account: name and look reach the match
    const ws = new WebSocket(N.wsUrl('127.0.0.1:' + PORT), { headers: { Cookie: a.cookie } });
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    const s = new N.OnlineSession(ws);
    const ws2 = new WebSocket(N.wsUrl('127.0.0.1:' + PORT), { headers: { Cookie: b.cookie } });
    await new Promise((r, j) => { ws2.onopen = r; ws2.onerror = j; });
    const s2 = new N.OnlineSession(ws2);
    s.quick(); s2.quick();
    for (let i = 0; i < 100 && (!s.started || !s2.started); i++) await sleep(20);
    assert.ok(s.started && s2.started, 'two authenticated players paired');
    assert.deepStrictEqual(s.players[0], {
      name: 'Ace Lucas', look: { cloth: 'red', hair: 'brown', racket: 'classic', shirt: 'red', shorts: 'red', cap: 'none', court: 'clay' }, elo: 1000, level: 1, trophies: 0,
    });
    const bot = s.players[1];
    assert.ok(Math.abs(bot.elo - 1000) <= 60 && bot.level >= 1, 'bot rating close to the player');
    await sleep(100);
    assert.deepStrictEqual(s.server.P[0].forehand, 20 + 3, 'starting abilities are 3 everywhere');

    // Before any movement/hit, quitting cancels the ranked match with no penalty for either player.
    s.leave();
    await sleep(200);
    let me = (await get('/api/me', a.cookie)).profile;
    assert.ok(me.losses === 0 && me.wins === 0 && me.elo === 1000 && me.xp === 0 && me.coins === 0, 'untouched match cancelled: ' + JSON.stringify(me));
    const peer = (await get('/api/me', b.cookie)).profile;
    assert.ok(peer.losses === 0 && peer.wins === 0 && peer.elo === 1000 && peer.xp === 0 && peer.coins === 0,
      'opponent is not penalized when the quitter never acts: ' + JSON.stringify(peer));
    ws2.close();

    async function serveAndTouch() {
      const tick = async (pad) => { s.tick(pad || {}); await sleep(45); };
      for (let i = 0; i < 120 && (!s.server || s.server.P[0].stat !== L.C.PS_SERVE); i++) await sleep(20);
      assert.strictEqual(s.server.P[0].stat, L.C.PS_SERVE, 'account serves first');
      await tick({ sp: true }); await tick({});
      for (let i = 0; i < 100 && (s.server.P[0].stat !== L.C.PS_TOSS || s.server.P[0].cnt <= 9); i++) await tick({});
      assert.ok(s.server.P[0].stat === L.C.PS_TOSS && s.server.P[0].cnt > 9, 'serve toss reaches contact window');
      await tick({ sp: true }); await tick({});
      for (let i = 0; i < 30 && s.server.rally_cnt === 0; i++) await tick({});
      assert.ok(s.server.rally_cnt > 0, 'first serve reached the ball');
    }

    // After the player genuinely hits the serve, leaving is a loss: Elo down, +40 XP, no win coins.
    s.quick();
    for (let i = 0; i < 100 && !s.started; i++) await sleep(20);
    assert.ok(s.started, 'second bot match started');
    await serveAndTouch();
    s.leave();
    await sleep(200);
    me = (await get('/api/me', a.cookie)).profile;
    assert.ok(me.losses === 1 && me.elo < 1000 && me.xp === 40 && me.level === 1 && me.points === 0 && me.coins === 0, 'active forfeit recorded without win coins: ' + JSON.stringify(me));
    assert.strictEqual((await post('/api/stats', { stats: [4, 3, 3, 3] }, a.cookie)).status, 400, 'no point to spend yet');

    // second touched forfeit: 80 XP -> level 2 -> one point
    s.quick();
    for (let i = 0; i < 100 && !s.started; i++) await sleep(20);
    assert.ok(s.started, 'third bot match started');
    await serveAndTouch();
    s.leave();
    await sleep(200);
    me = (await get('/api/me', a.cookie)).profile;
    assert.ok(me.level === 2 && me.points === 1, 'level 2 gives a point: ' + JSON.stringify(me));
    assert.strictEqual((await post('/api/stats', { stats: [5, 3, 3, 3] }, a.cookie)).status, 400, 'cannot spend two points');
    assert.strictEqual((await post('/api/stats', { stats: [2, 3, 3, 4] }, a.cookie)).status, 400, 'cannot go below 3');
    const st = await post('/api/stats', { stats: [3, 3, 3, 4] }, a.cookie);
    assert.ok(st.status === 200 && st.json.profile.points === 0 && st.json.profile.stats[3] === 4, 'point spent on footwork');
    assert.ok((await post('/api/stats', { stats: [4, 3, 3, 3] }, a.cookie)).status === 200, 'free respec');

    // the new abilities are used in the next match; the leaderboard lists the player
    s.quick();
    for (let i = 0; i < 100 && !s.started; i++) await sleep(20);
    await sleep(100);
    assert.strictEqual(s.server.P[0].forehand, 20 + 4, 'unlocked forehand used in game');
    const lb = await get('/api/leaderboard', a.cookie);
    assert.ok(lb.top.some((r) => r.name === 'Ace Lucas') && lb.me.rank >= 1, 'listed in the ranking');
    s.leave();
    ws.close();

    // logout ends the session
    await post('/api/logout', {}, a.cookie);
    assert.strictEqual((await get('/api/me', a.cookie)).profile, null, 'session revoked');
    console.log('account OK');
  } finally {
    srv.kill();
    fs.unlinkSync(jwksFile);
  }
})().catch((e) => { console.error(e); process.exit(1); });
