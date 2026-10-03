// Verifies the ID token that "Sign in with Google" hands to the browser (a JWT signed RS256 with
// one of Google's rotating keys). Standard library only.
'use strict';
const crypto = require('crypto');

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

let cache = { keys: null, until: 0 };
async function googleKeys() {
  if (cache.keys && Date.now() < cache.until) return cache.keys;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error('Google certs HTTP ' + res.status);
  const maxAge = Number((/max-age=(\d+)/.exec(res.headers.get('cache-control') || '') || [])[1] || 3600);
  cache = { keys: (await res.json()).keys, until: Date.now() + maxAge * 1000 };
  return cache.keys;
}

const b64json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

// Resolves to the token's claims ({ sub, email, ... }) or rejects. getKeys is injectable for tests.
async function verifyGoogleToken(token, clientId, getKeys = googleKeys) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const header = b64json(parts[0]), claims = b64json(parts[1]);
  if (header.alg !== 'RS256') throw new Error('unexpected alg');
  const jwk = (await getKeys()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown key');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('bad signature');
  const now = Date.now() / 1000;
  if (!ISSUERS.includes(claims.iss)) throw new Error('bad issuer');
  if (claims.aud !== clientId) throw new Error('bad audience');
  if (!(claims.exp > now - 60)) throw new Error('expired');
  if (!claims.sub) throw new Error('no subject');
  return claims;
}

module.exports = { verifyGoogleToken };
