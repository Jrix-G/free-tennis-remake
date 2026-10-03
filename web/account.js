// Account box: "Sign in with Google", then the profile editor (pseudo + look) and stats.
// The session lives in an HttpOnly cookie set by the server; this module only keeps the profile.
(function (root) {
  'use strict';
  const R = root.TennisRender, CO = root.TennisCosmetics;
  const $ = (id) => document.getElementById(id);
  let profile = null, clientId = null, gisLoaded = null, draft = null;
  const listeners = [];

  async function call(path, body) {
    const res = await fetch(path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'Erreur ' + res.status);
    return j;
  }
  function setProfile(p) {
    profile = p || null;
    $('acct-btn').textContent = profile ? profile.name : 'Se connecter';
    $('acct-btn').classList.toggle('in', !!profile);
    listeners.forEach((f) => f(profile));
  }

  async function init() {
    try {
      const [cfg, me] = await Promise.all([call('/api/config'), call('/api/me')]);
      clientId = cfg.googleClientId; setProfile(me.profile);
    } catch (e) { setProfile(null); }  // offline / no server: guest only
    $('acct-btn').onclick = open;
    $('acct-close').onclick = close;
    $('acct-modal').addEventListener('mousedown', (e) => { if (e.target === $('acct-modal')) close(); });
  }

  function loadGis() {
    if (!gisLoaded) {
      gisLoaded = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
        s.onload = resolve; s.onerror = () => { gisLoaded = null; reject(new Error('Google injoignable')); };
        document.head.appendChild(s);
      });
    }
    return gisLoaded;
  }

  function msg(text, ok) { const m = $('acct-msg'); m.textContent = text || ''; m.className = ok ? 'ok' : ''; }

  async function open() {
    $('acct-modal').style.display = 'flex';
    msg('');
    if (profile) return showProfile();
    $('acct-login').style.display = 'block'; $('acct-profile').style.display = 'none';
    $('acct-title').textContent = 'Connexion';
    const box = $('acct-google');
    box.innerHTML = '';
    if (!clientId) { msg("La connexion Google n'est pas encore activée sur ce serveur."); return; }
    try {
      await loadGis();
      google.accounts.id.initialize({ client_id: clientId, callback: onCredential, ux_mode: 'popup' });
      google.accounts.id.renderButton(box, { theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'pill', locale: 'fr' });
    } catch (e) { msg(e.message); }
  }
  function close() { $('acct-modal').style.display = 'none'; if (document.activeElement) document.activeElement.blur(); }
  const isOpen = () => $('acct-modal').style.display === 'flex';

  async function onCredential(resp) {
    msg('Connexion...', true);
    try { setProfile((await call('/api/login', { credential: resp.credential })).profile); showProfile(); msg('Connecté !', true); } catch (e) { msg(e.message); }
  }

  function swatches(kind) {
    const box = $('acct-' + kind);
    box.innerHTML = '';
    for (const it of CO.CATALOG[kind]) {
      const b = document.createElement('button');
      b.className = 'sw' + (draft.look[kind] === it.id ? ' on' : '');
      b.style.background = it.color; b.title = it.name; b.setAttribute('aria-label', it.name);
      b.onclick = () => { draft.look[kind] = it.id; swatches(kind); preview(); };
      box.appendChild(b);
    }
  }
  function preview() {
    const c = $('acct-preview'), g = c.getContext('2d'), dpr = window.devicePixelRatio || 1;
    c.width = 120 * dpr; c.height = 150 * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#6cac00'; g.fillRect(0, 0, 120, 150);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(60, 132, 26, 8, 0, 0, Math.PI * 2); g.fill();
    R.drawPlayer(g, 60, 132, 1.25, 'wait', 1, 'front', 0, draft.look);
  }
  function showProfile() {
    $('acct-login').style.display = 'none'; $('acct-profile').style.display = 'block';
    $('acct-title').textContent = 'Mon compte';
    draft = { name: profile.name, look: CO.sanitize(profile.look, 0) };
    $('acct-name').value = draft.name;
    $('acct-stats').textContent = 'Victoires : ' + profile.wins + '   ·   Défaites : ' + profile.losses;
    swatches('cloth'); swatches('hair'); preview();
    $('acct-save').onclick = async () => {
      try {
        setProfile((await call('/api/profile', { name: $('acct-name').value, look: draft.look })).profile);
        msg('Enregistré', true);
      } catch (e) { msg(e.message); }
    };
    $('acct-logout').onclick = async () => {
      try { await call('/api/logout', {}); } catch (e) { /* cookie cleared anyway on next try */ }
      if (root.google) google.accounts.id.disableAutoSelect();
      setProfile(null); open();
    };
  }

  root.TennisAccount = {
    init, open, close, isOpen,
    get profile() { return profile; },
    look() { return profile ? profile.look : null; },
    onChange(f) { listeners.push(f); },
    update(p) { setProfile(p); },  // pushed by the game server (stats after a match)
  };
})(typeof self !== 'undefined' ? self : this);
