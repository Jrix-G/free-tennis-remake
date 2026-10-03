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
    const saved = await post('/api/profile', { name: '  Ace   Lucas ', look: { cloth: 'red', hair: 'nope' } }, a.cookie);
    assert.strictEqual(saved.status, 200);
    assert.deepStrictEqual([saved.json.profile.name, saved.json.profile.look], ['Ace Lucas', { cloth: 'red', hair: 'brown' }], 'name trimmed, unknown item reset');
    const b = await login('google-sub-b');
    const dup = await post('/api/profile', { name: 'ace lucas' }, b.cookie);
    assert.ok(dup.status === 400 && /pris/.test(dup.json.error), 'pseudos are unique regardless of case');

    // the game uses the account: name and look reach the match
    const ws = new WebSocket(N.wsUrl('127.0.0.1:' + PORT), { headers: { Cookie: a.cookie } });
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    const s = new N.OnlineSession(ws);
    s.quick();
    for (let i = 0; i < 100 && !s.started; i++) await sleep(20);
    assert.ok(s.started, 'bot match started');
    assert.deepStrictEqual(s.players[0], { name: 'Ace Lucas', look: { cloth: 'red', hair: 'brown' } });
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
