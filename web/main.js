// Screens, input, fixed 30 Hz loop, solo + network flows.
(function () {
  'use strict';
  const L = TennisLogic, R = TennisRender, A = TennisAudio, N = TennisNet, AC = TennisAccount, PG = TennisProgression, CO = TennisCosmetics, C = L.C;
  const TICK = 1000 / 30;
  const canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
  const stage = document.getElementById('stage'), addr = document.getElementById('addr');

  // ---------- layout ----------
  let scale = 1;
  function resize() {
    const size = Math.max(200, Math.min(innerWidth, innerHeight));
    const dpr = window.devicePixelRatio || 1;
    stage.style.width = stage.style.height = size + 'px';
    canvas.width = canvas.height = Math.round(size * dpr);
    scale = size / 600;
    ctx.setTransform(canvas.width / 600, 0, 0, canvas.height / 600, 0, 0);
    positionAddr();
  }
  function positionAddr() {
    addr.style.left = 175 * scale + 'px'; addr.style.top = 330 * scale + 'px';
    addr.style.width = 234 * scale + 'px'; addr.style.fontSize = Math.max(11, 18 * scale) + 'px';
  }
  addEventListener('resize', resize);

  // ---------- input ----------
  const KEY_STORAGE = 'tennus.advanced-keys';
  const defaultAdvanced = { sh: 'Shift', tp: 'z', sl: 'x', lc: 'c' };
  let advanced;
  try { advanced = Object.assign({}, defaultAdvanced, JSON.parse(localStorage.getItem(KEY_STORAGE) || '{}')); } catch (e) { advanced = Object.assign({}, defaultAdvanced); }
  function keyMap() {
    const out = { ArrowLeft: 'l', ArrowRight: 'r', ArrowUp: 'u', ArrowDown: 'd', ' ': 'sp', Spacebar: 'sp', a: 'a', A: 'a', q: 'p', Q: 'p', e: 'n', E: 'n' };
    for (const [action, key] of Object.entries(advanced)) { out[key] = action; out[key.toUpperCase()] = action; }
    return out;
  }
  let KEYS = keyMap();
  function configureKeys() {
    const raw = prompt('Touches avancées : Sprint, Lift, Slice, Lob/Amorti', [advanced.sh, advanced.tp, advanced.sl, advanced.lc].join(', '));
    if (raw == null) return;
    const v = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (v.length !== 4 || new Set(v.map((s) => s.toLowerCase())).size !== 4) return alert('Entrez quatre touches différentes, séparées par des virgules.');
    advanced = { sh: v[0], tp: v[1], sl: v[2], lc: v[3] }; KEYS = keyMap(); localStorage.setItem(KEY_STORAGE, JSON.stringify(advanced));
  }
  const keys = {}; let spLatch = false;
  addEventListener('keydown', (e) => {
    A.unlock();
    if (AC.isOpen()) { if (e.key === 'Escape') AC.close(); return; }  // typing in the account box
    if (document.activeElement === addr) { if (e.key === 'Enter') scene.onKey && scene.onKey('Enter'); return; }
    const k = KEYS[e.key];
    if (k) { e.preventDefault(); if (!keys[k] && k === 'sp') spLatch = true; keys[k] = true; }
    if (!e.repeat && scene.onKey) scene.onKey(e.key);
    if (e.key === 'm' || e.key === 'M') A.toggleMute();
  });
  addEventListener('keyup', (e) => { const k = KEYS[e.key]; if (k) keys[k] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  function readPad() {  // sampled once per tick, like the original keydata[]
    const p = { l: !!keys.l, r: !!keys.r, u: !!keys.u, d: !!keys.d, sp: !!keys.sp || spLatch,
      sh: !!keys.sh, tp: !!keys.tp, sl: !!keys.sl, lc: !!keys.lc, a: !!keys.a, n: !!keys.n, p: !!keys.p };
    spLatch = false;
    return p;
  }
  function mouse(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * 600, y: (e.clientY - r.top) / r.height * 600 };
  }
  let mx = -1, my = -1;
  canvas.addEventListener('mousemove', (e) => { const m = mouse(e); mx = m.x; my = m.y; });
  canvas.addEventListener('mousedown', (e) => { e.preventDefault(); A.unlock(); const m = mouse(e); if (scene.onClick) scene.onClick(m.x, m.y); });
  const inRect = (x, y, r) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3];

  // ---------- persistent data (re-initialised on the title screen, as in the original) ----------
  let data;
  function resetData() {
    data = { pname: ['YOU', 'COM'], player_data: [[5, 3, 6, 4, 0, 0], [4, 5, 4, 5, 5, 0]], tdat: L.TDAT.slice(), kaisen: 0, result_txt: [], match_mode: 0, oppo: 1 };
  }
  const tname = (s) => s.substring(6);
  const digits = (s) => [0, 1, 2, 3, 4, 5].map((i) => Number(s.charAt(i)));

  let scene = null;
  const acctBtn = document.getElementById('acct-btn');
  function go(s) {
    scene = s; spLatch = false; addr.style.display = 'none';
    acctBtn.style.display = s === Title ? 'block' : 'none';  // account box only from the title screen
    if (s !== Title) AC.close();
    if (s.enter) s.enter();
  }

  // "Space bar" button clip: 12 animation ticks after the key press, then the action.
  function spaceClip(action) {
    return {
      f: 1,
      key(k) { if (k === ' ' && this.f === 1) { this.f = 2; A.play('space'); } },
      tick() { if (this.f > 1 && ++this.f >= 13) { this.f = 1; action(); } },
    };
  }

  // ---------- title ----------
  const MENU = [['PARTIE RAPIDE', 'Classé · Elo, XP et pièces', 300], ['TOURNOI', '16 joueurs, élimination directe', 362],
    ['HÉBERGER / REJOINDRE', 'Joue avec un ami via un code', 424], ['CLASSEMENT', 'Les meilleurs joueurs', 486]];
  const MENU_X = 140, MENU_W = 320, MENU_H = 52;
  const SHOP_ENTRY = [18, 18, 120, 36];
  const menuRect = (y) => [MENU_X, y, MENU_W, MENU_H];
  const Title = {
    enter() {
      resetData(); A.playMusic('title');
      const m = /^#([A-Za-z0-9]{4})$/.exec(location.hash);  // shared invite link
      if (m) go(Lobby({ code: m[1] }));
    },
    tick() {},
    draw() {
      R.drawTitleScene(ctx, performance.now() / 1000);
      R.drawLogo(ctx, 'TENNUS', 300, 150);
      ctx.fillStyle = 'rgba(255,210,58,0.16)'; R.roundRect(ctx, SHOP_ENTRY[0], SHOP_ENTRY[1], SHOP_ENTRY[2], SHOP_ENTRY[3], 12); ctx.fill();
      ctx.strokeStyle = 'rgba(255,210,58,0.65)'; ctx.stroke();
      R.text(ctx, '✦ BOUTIQUE', 78, 42, 14, { align: 'center', outline: false, color: '#ffd23a' });
      R.text(ctx, 'Espace : frapper · Flèches : bouger et viser · K : configurer les touches', 300, 196, 12,
        { align: 'center', outline: false, weight: 'normal', color: 'rgba(220,235,255,0.75)' });
      MENU.forEach(([s, sub, y], i) => R.menuCard(ctx, menuRect(y), s, sub, inRect(mx, my, menuRect(y)), i === 0));
      const p = AC.profile;
      R.text(ctx, p ? 'Niv. ' + p.level + '   ·   Elo ' + p.elo + '   ·   ' + p.coins + ' pièces' + (p.points ? '   ·   ' + p.points + ' point(s) à placer !' : '')
        : 'Invité : connectez-vous pour progresser', 300, 566, 13,
        { align: 'center', outline: false, color: p && p.points ? '#d4ff3a' : 'rgba(220,235,255,0.8)' });
    },
    onClick(x, y) {
      if (inRect(x, y, SHOP_ENTRY)) { go(Shop()); return; }
      const i = MENU.findIndex(([, , my2]) => inRect(x, y, menuRect(my2)));
      if (i < 0) return;
      A.play('click'); A.stopMusic();
      if (i === 0) go(Lobby({ quick: true }));
      else if (i === 1) startTournament();
      else if (i === 2) go(Lobby({}));
      else go(Leaderboard());
    },
    onKey(k) { if (k === 'k' || k === 'K') configureKeys(); },
  };

  // ---------- tournament: you (your unlocked abilities) against 15 players of the original roster ----------
  function startTournament() {
    const p = AC.profile, stats = p ? p.stats : PG.START_STATS;
    const me = stats.join('') + '00' + (p ? p.name : 'YOU');
    const roster = L.TDAT.slice();
    for (let i = roster.length - 1; i > 0; i--) { const r = Math.floor(Math.random() * (i + 1)); [roster[i], roster[r]] = [roster[r], roster[i]]; }
    Object.assign(data, { tdat: [me].concat(roster.slice(0, 15)), kaisen: 0, match_mode: 1, result_txt: [] });
    go(Bracket());
  }

  // ---------- cosmetic shop ----------
  function Shop() {
    const kinds = CO.SHOP_KINDS;
    let kind = 'racket', status = '', busy = false;
    const BTN_BACK = [230, 548, 140, 32];
    const tabs = kinds.map((k, i) => [k, [24 + i * 138, 92, 132, 30]]);
    const title = { racket: 'RAQUETTES', shirt: 'HAUTS', shorts: 'SHORTS', cap: 'CASQUETTES' };
    async function act(item, action) {
      if (!AC.profile) { status = 'Connectez-vous pour acheter et équiper.'; AC.open(); return; }
      if (busy) return;
      busy = true; status = action === 'buy' ? 'Achat en cours...' : 'Équipement en cours...';
      try { await AC.shop(action, kind, item.id); status = action === 'buy' ? 'Article acheté !' : 'Article équipé !'; }
      catch (e) { status = e.message; }
      busy = false;
    }
    return {
      tick() {},
      draw() {
        R.drawScene(ctx); R.panel(ctx);
        const glow = ctx.createRadialGradient(300, 80, 20, 300, 260, 360);
        glow.addColorStop(0, 'rgba(255,190,55,0.12)'); glow.addColorStop(1, 'rgba(255,190,55,0)');
        ctx.fillStyle = glow; ctx.fillRect(20, 20, 560, 540);
        R.text(ctx, '✦  BOUTIQUE VIP  ✦', 300, 62, 30, { align: 'center', outline: false, color: '#ffd23a' });
        const p = AC.profile;
        R.text(ctx, p ? 'Solde : ' + p.coins + ' pièces  ·  +100 à chaque victoire classée' : 'Connectez-vous pour dépenser vos pièces de victoire',
          300, 82, 12, { align: 'center', outline: false, color: '#e5d6ad' });
        for (const [k, r] of tabs) {
          const hot = k === kind || inRect(mx, my, r);
          ctx.fillStyle = k === kind ? 'rgba(255,210,58,0.95)' : hot ? 'rgba(255,210,58,0.3)' : 'rgba(255,255,255,0.1)';
          R.roundRect(ctx, r[0], r[1], r[2], r[3], 8); ctx.fill();
          R.text(ctx, title[k], r[0] + r[2] / 2, r[1] + 20, 13, { align: 'center', outline: false, color: k === kind ? '#19130a' : '#fff' });
        }
        const items = CO.CATALOG[kind];
        items.forEach((item, i) => {
          const col = i % 2, row = Math.floor(i / 2), x = 32 + col * 270, y = 132 + row * 65;
          ctx.fillStyle = 'rgba(7,13,30,0.78)'; R.roundRect(ctx, x, y, 256, 57, 9); ctx.fill();
          ctx.strokeStyle = item.id === 'gold' ? 'rgba(255,210,58,0.7)' : 'rgba(255,255,255,0.16)'; ctx.stroke();
          if (item.color) { ctx.fillStyle = item.color; R.roundRect(ctx, x + 9, y + 13, 30, 30, 7); ctx.fill(); }
          R.text(ctx, item.name, x + 48, y + 23, 13, { outline: false });
          const have = !!(p && CO.owns(p.owned, kind, item.id));
          const current = p && p.look[kind] === item.id;
          const label = current ? 'ÉQUIPÉ' : have ? 'ÉQUIPER' : item.price + ' ✦';
          const br = [x + 154, y + 31, 92, 20];
          ctx.fillStyle = current ? '#5cbd87' : inRect(mx, my, br) ? '#ffd23a' : '#e7bc45';
          R.roundRect(ctx, br[0], br[1], br[2], br[3], 6); ctx.fill();
          R.text(ctx, label, br[0] + br[2] / 2, br[1] + 14, 11, { align: 'center', outline: false, color: '#19130a' });
          if (!have && item.price === 0) R.text(ctx, 'Inclus', x + 50, y + 43, 10, { outline: false, color: '#9ad0ff' });
        });
        R.text(ctx, status, 300, 535, 13, { align: 'center', outline: false, color: '#9ad0ff' });
        const hot = inRect(mx, my, BTN_BACK); ctx.fillStyle = hot ? '#ffd23a' : '#f2f2f2';
        R.roundRect(ctx, BTN_BACK[0], BTN_BACK[1], BTN_BACK[2], BTN_BACK[3], 8); ctx.fill();
        R.text(ctx, 'RETOUR', 300, 570, 16, { align: 'center', outline: false, color: '#222' });
      },
      onClick(x, y) {
        if (inRect(x, y, BTN_BACK)) { go(Title); return; }
        for (const [k, r] of tabs) if (inRect(x, y, r)) { kind = k; status = ''; return; }
        const p = AC.profile, items = CO.CATALOG[kind];
        for (let i = 0; i < items.length; i++) {
          const item = items[i], col = i % 2, row = Math.floor(i / 2), x0 = 32 + col * 270, y0 = 132 + row * 65;
          if (!inRect(x, y, [x0 + 154, y0 + 31, 92, 20])) continue;
          if (p && p.look[kind] === item.id) return;
          const have = !!(p && CO.owns(p.owned, kind, item.id));
          if (!have && item.price === 0) { status = 'Article déjà inclus.'; return; }
          act(item, have ? 'equip' : 'buy'); return;
        }
      },
      onKey(k) { if (k === 'Escape') go(Title); },
    };
  }

  // ---------- ranking ----------
  function Leaderboard() {
    let board = null, err = '';
    fetch('/api/leaderboard').then((r) => r.json()).then((j) => { board = j; }).catch(() => { err = 'Classement indisponible'; });
    const BTN_BACK = [230, 530, 130, 32];
    return {
      tick() {},
      draw() {
        R.drawScene(ctx); R.panel(ctx);
        R.text(ctx, 'CLASSEMENT', 300, 66, 32, { align: 'center', outline: false });
        R.text(ctx, 'Elo gagné en partie rapide', 300, 90, 14, { align: 'center', outline: false, color: '#ccc' });
        const cols = [[80, '#', 'left'], [115, 'Pseudo', 'left'], [355, 'Niv.', 'right'], [425, 'V - D', 'right'], [505, 'Elo', 'right']];
        cols.forEach(([x, h, al]) => R.text(ctx, h, x, 122, 14, { align: al, outline: false, color: '#9ad0ff' }));
        if (!board) R.text(ctx, err || 'Chargement...', 300, 250, 18, { align: 'center', outline: false });
        else if (!board.top.length) R.text(ctx, 'Personne pour le moment : à vous de jouer !', 300, 250, 17, { align: 'center', outline: false });
        const me = AC.profile && AC.profile.name;
        const row = (r, y, hl) => {
          const c = hl ? '#ffd23a' : '#fff';
          R.text(ctx, String(r.rank), 80, y, 15, { outline: false, color: c });
          R.text(ctx, r.name, 115, y, 15, { outline: false, color: c });
          R.text(ctx, String(r.level), 355, y, 15, { align: 'right', outline: false, color: c });
          R.text(ctx, r.wins + ' - ' + r.losses, 425, y, 15, { align: 'right', outline: false, color: c });
          R.text(ctx, String(r.elo), 505, y, 15, { align: 'right', outline: false, color: c });
        };
        if (board) {
          board.top.forEach((r, i) => row(r, 140 + i * 17.5, r.name === me));
          if (board.me && board.me.rank > board.top.length) row(board.me, 140 + 20 * 17.5 + 8, true);
        }
        const hot = inRect(mx, my, BTN_BACK);
        ctx.fillStyle = hot ? '#ffd23a' : '#f2f2f2'; R.roundRect(ctx, BTN_BACK[0], BTN_BACK[1], BTN_BACK[2], BTN_BACK[3], 8); ctx.fill();
        R.text(ctx, 'RETOUR', 295, 553, 20, { align: 'center', outline: false, color: '#222' });
      },
      onClick(x, y) { if (inRect(x, y, BTN_BACK)) go(Title); },
      onKey(k) { if (k === 'Escape') go(Title); },
    };
  }

  // ---------- tournament: bracket ----------
  const MATCH_NAME = ['1st MATCH', '2nd MATCH', 'SEMI FINAL', 'FINAL MATCH'];
  function bracketPath(pn, kaisen) {  // make_line()
    let x = pn < 8 ? 160 : 440, y = 150 + (pn % 8) * 40;
    const dx = pn < 8 ? 40 : -40, pts = [[x, y]];
    x += dx; pts.push([x, y]);
    const steps = [[0, 20, 2, 1], [1, 40, 2, 2], [2, 80, 2, 4]];
    for (const [k, h, , div] of steps) {
      if (!(kaisen > k)) break;
      y += Math.floor(pn / div) % 2 === 0 ? h : -h; pts.push([x, y]);
      x += k === 2 ? dx / 4 : dx; pts.push([x, y]);
    }
    return pts;
  }
  function Bracket() {
    const k = data.kaisen, a = 1 << k;
    let max = -1;
    for (let i = 0; i < a; i++) {
      const n = a + i, d = digits(data.tdat[n]);
      let v = 0;
      for (let j = 0; j < 6; j++) if (j !== 4) v += d[j];
      v += Math.random() * 20;
      if (v > max) { max = v; data.oppo = n; }
    }
    const sp = spaceClip(() => {
      A.stopMusic();
      data.pname = [tname(data.tdat[0]), tname(data.tdat[data.oppo])];
      data.player_data = [digits(data.tdat[0]), digits(data.tdat[data.oppo])];
      startSolo();
    });
    const path = (pts, w, col) => {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineJoin = 'miter';
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    };
    return {
      enter() { A.playMusic('start'); },
      tick() { sp.tick(); },
      onKey(key) { sp.key(key); },
      draw() {
        R.drawScene(ctx); R.panel(ctx);
        R.text(ctx, MATCH_NAME[k], 300, 68, 30, { align: 'center', outline: false });
        R.text(ctx, tname(data.tdat[0]) + ' vs ' + tname(data.tdat[data.oppo]), 300, 100, 21, { align: 'center', outline: false, color: '#ff9900' });
        for (let n = 0; n < 16; n++) path(bracketPath(n, 3), 2, '#fff');
        path([[280, 290], [320, 290]], 2, '#fff'); path([[300, 150], [300, 290]], 2, '#fff');
        path(bracketPath(0, k), 6, '#ff9900'); path(bracketPath(data.oppo, k), 6, '#ff9900');
        for (let n = 0; n < 16; n++) {
          R.text(ctx, tname(data.tdat[n]), n < 8 ? 150 : 450, 157 + (n % 8) * 40, 16, { align: n < 8 ? 'right' : 'left', outline: false });
        }
        R.spaceButton(ctx, 300, 498, sp.f);
      },
    };
  }

  // ---------- tournament: ending ----------
  function Ending() {
    let t = 0;
    const lines = [['1st MATCH', data.result_txt[0]], ['2nd MATCH', data.result_txt[1]], ['SEMI FINAL', data.result_txt[2]],
      ['FINAL MATCH', data.result_txt[3]], ['Thank you', 'for playing!'], ['Original game by', 'GAMEDESIGN']];
    const sp = spaceClip(() => go(Title));
    return {
      enter() { A.play('app2'); },
      tick() { t++; if (t > 30 + 100 + 6 * 240) sp.tick(); },
      onKey(k) { if (t > 30 + 100 + 6 * 240) sp.key(k); },
      draw() {
        R.drawScene(ctx);
        if (t < 330) {
          const al = t < 30 ? 1 : Math.max(0.15, 1 - (t - 230) / 100);
          ctx.globalAlpha = Math.min(1, al);
          R.text(ctx, 'CONGRATULATIONS!', 300, 280, 44, { align: 'center' });
          R.text(ctx, tname(data.tdat[0]) + ' wins the tournament', 300, 330, 22, { align: 'center' });
          ctx.globalAlpha = 1;
          return;
        }
        R.panel(ctx);
        const u = t - 330, lap = Math.min(5, Math.floor(u / 240)), y = 380 - (u - lap * 240);
        const yy = lap === 5 ? Math.max(260, y) : y;
        R.text(ctx, lines[lap][0], 300, yy, 28, { align: 'center', outline: false });
        R.text(ctx, lines[lap][1] || '', 300, yy + 40, 22, { align: 'center', outline: false, color: '#ff9900' });
        if (t > 30 + 100 + 6 * 240) R.spaceButton(ctx, 300, 498, sp.f);
      },
    };
  }

  // ---------- match drawing shared by solo and network ----------
  function drawMatch(g, flip, prev, alpha, meIdx, looks, outTicks) {
    R.drawGame(ctx, g, flip, prev, alpha, looks, outTicks);
    R.text(ctx, g.score_txt, 8, 590, 18);
    const me = g.P[meIdx], card = TennisCards.CARDS.find((c) => c.id === g.deck[me.card]);
    R.text(ctx, 'ÉNERGIE ' + me.en + '/10  ·  A ' + (card ? card.name : ''), 300, 584, 11, { align: 'center', outline: false, color: '#9ad0ff' });
    // quit button
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; R.roundRect(ctx, 576, 6, 19, 19, 3); ctx.fill();
    ctx.fillStyle = '#5a6a3f'; ctx.beginPath(); ctx.moveTo(581, 15.5); ctx.lineTo(590, 10); ctx.lineTo(590, 21); ctx.fill();
    const m = g.mes;
    if (m.label === 'mes' || m.label === 'score' || m.label === 'inplay-wait') R.text(ctx, m.text, 300, 238, 34, { align: 'center' });
    if (m.label === 'game') {
      R.text(ctx, m.text, 300, 220, 32, { align: 'center' });
      R.text(ctx, g.pname[0] + ' ' + g.gpoint[0] + ' - ' + g.gpoint[1] + ' ' + g.pname[1], 300, 262, 24, { align: 'center', color: '#ffd23a' });
    }
    if (m.label === 'win' || m.label === 'lose') {
      const won = g.match_winner === meIdx;
      const a = m.label === 'lose' && !g.space.on ? Math.min(1, (m.f - 30) / 15) : 1;
      ctx.globalAlpha = a;
      R.text(ctx, won ? 'YOU WIN!' : 'YOU LOSE...', 300, 225, 50, { align: 'center', color: won ? '#ffd23a' : '#9ad0ff' });
      R.text(ctx, g.pname[0] + ' ' + g.gpoint[0] + ' - ' + g.gpoint[1] + ' ' + g.pname[1], 300, 268, 24, { align: 'center' });
      ctx.globalAlpha = 1;
    }
    if (g.space.on) R.spaceButton(ctx, 300, 330, g.space.f);
  }
  const QUIT = [572, 2, 28, 28];

  // copy of the moving parts, for render interpolation between ticks
  function snapPos(g) {
    return { P: g.P.map((p) => ({ vx: p.vx, vy: p.vy })), B: { vx: g.B.vx, vy: g.B.vy, vh: g.B.vh, visible: g.B.visible } };
  }

  // ---------- solo match ----------
  function startSolo() {
    const G = L.createMatch({
      names: data.pname, data: data.player_data, ctrl: ['human', 'ai'], matchMode: data.match_mode,
      seed: (Math.random() * 2 ** 32) >>> 0,
    });
    let prev = null, outTicks = 0;
    go({
      tick() {
        prev = snapPos(G);
        L.step(G, [readPad(), null]);
        for (const e of G.events) { A.play(e); if (e === 'out') outTicks = 30; }
        if (outTicks) outTicks--;
        if (G.over) afterMatch(G);
      },
      draw(alpha) { drawMatch(G, false, prev, alpha, 0, [AC.look(), null], outTicks); },
      onClick(x, y) { if (inRect(x, y, QUIT)) go(Title); },
      onKey(k) { if (k === 'Escape') go(Title); },
    });
  }

  function afterMatch(G) {  // after_match() of the play clip and of the main timeline
    if (data.match_mode === 0) return go(Title);
    if (G.match_winner === 0) {
      data.result_txt[data.kaisen] = G.pname[0] + ' ' + G.gpoint[0] + ' - ' + G.gpoint[1] + ' ' + G.pname[1];
      data.kaisen++;
      go(data.kaisen > 3 ? Ending() : Bracket());
    } else go(Title);
  }

  // ---------- online: one WebSocket to the game server, re-opened after a drop ----------
  let sess = null, netWanted = false, retry = null;
  function connect() {
    if (retry) { clearTimeout(retry); retry = null; }
    const ws = new WebSocket(N.wsUrl());
    if (!sess) sess = new N.OnlineSession(ws); else sess.bind(ws);
    ws.onopen = () => { if (sess.code && sess.token && !sess.closed) sess.join(sess.code, sess.token); };
    ws.onclose = () => { if (netWanted && sess.ws === ws) retry = setTimeout(connect, 1000); };
  }
  function netOn() { netWanted = true; if (!sess || sess.ws.readyState > 1) connect(); }
  function netOff() {
    netWanted = false;
    if (sess) { sess.leave(); sess.ws.onclose = null; sess.ws.close(); sess = null; }
    if (retry) { clearTimeout(retry); retry = null; }
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* file:// */ }
  }
  const shareLink = (code) => location.origin + location.pathname + '#' + code;

  // ---------- online lobby ----------
  // opts.quick: ranked matchmaking right away; otherwise host / join a private room (opts.code: invite link).
  function Lobby(opts) {
    const quick = !!opts.quick, autoCode = opts.code;
    // mode: null | 'quick' (matchmaking) | 'private' (room created, waiting) | 'code' (typing a code)
    let mode = null, status = '', copied = 0, searchT0 = 0;
    const BTN_CREATE = [150, 150, 300, 40], BTN_JOIN = [150, 205, 300, 40];
    const BTN_GO = [235, 395, 130, 36], BTN_COPY = [205, 420, 190, 30], BTN_BACK = [230, 520, 130, 32];
    netOn();
    addr.value = '';
    function joinCode(raw) {
      const code = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      if (code.length !== 4) { status = 'Le code fait 4 caractères.'; return; }
      mode = 'joining'; status = 'Connexion à la partie ' + code + '...';
      addr.style.display = 'none';
      let token = null;  // set when this tab already played in that room (page reload)
      try { token = sessionStorage.getItem('tennis.tok.' + code); } catch (e) { /* storage unavailable */ }
      const send = () => { if (scene !== self) return; if (sess.ws.readyState === 1) sess.join(code, token); else setTimeout(send, 100); };
      send();
    }
    const self = {
      enter() {
        if (autoCode) joinCode(autoCode);
        if (quick) {
          mode = 'quick'; searchT0 = performance.now();
          const send = () => { if (scene !== self) return; if (sess.ws.readyState === 1) sess.quick(); else setTimeout(send, 100); };
          send();
        }
      },
      tick() {
        if (!sess) return;
        if (copied) copied--;
        if (sess.err) { status = sess.err; sess.err = null; if (mode === 'joining') mode = null; }
        if (sess.code && sess.started) {
          try { history.replaceState(null, '', '#' + sess.code); sessionStorage.setItem('tennis.tok.' + sess.code, sess.token); } catch (e) { /* file:// */ }
          return startNet();
        }
        if (sess.ws.readyState !== 1) status = 'Connexion au serveur...';
        else if (status === 'Connexion au serveur...') status = '';
        if (sess.code && (mode === 'private' || mode === 'joining')) { mode = 'private'; status = "En attente de l'adversaire..."; }
      },
      draw() {
        R.drawScene(ctx); R.panel(ctx);
        R.text(ctx, quick ? 'PARTIE RAPIDE' : 'HÉBERGER / REJOINDRE', 300, 80, 32, { align: 'center', outline: false });
        const btn = (r, s, size) => {
          const hot = inRect(mx, my, r);
          ctx.fillStyle = hot ? '#ffd23a' : '#f2f2f2'; R.roundRect(ctx, r[0], r[1], r[2], r[3], 8); ctx.fill();
          R.text(ctx, s, r[0] + r[2] / 2, r[1] + r[3] / 2 + (size || 20) * 0.35, size || 20, { align: 'center', outline: false, color: '#222' });
        };
        if (!quick) {
          btn(BTN_CREATE, 'CRÉER UNE PARTIE PRIVÉE', 18); btn(BTN_JOIN, 'REJOINDRE AVEC UN CODE', 18);
          R.text(ctx, 'Partie amicale : chacun joue avec ses capacités, sans Elo ni XP.', 300, 276, 13, { align: 'center', outline: false, color: '#ccc' });
        } else {
          const p = AC.profile;
          R.text(ctx, "Recherche d'un adversaire...", 300, 230, 24, { align: 'center', outline: false });
          R.text(ctx, Math.floor((performance.now() - searchT0) / 1000) + ' s', 300, 275, 30, { align: 'center', outline: false, color: '#ffd23a' });
          R.text(ctx, p ? 'Partie classée : Elo ' + p.elo + ', +' + PG.XP_WIN + ' XP en cas de victoire'
            : "En invité, rien n'est enregistré : connectez-vous pour progresser.", 300, 330, 14, { align: 'center', outline: false, color: '#ccc' });
        }
        if (mode === 'private' && sess && sess.code) {
          R.text(ctx, 'Code de la partie :', 300, 318, 17, { align: 'center', outline: false });
          R.text(ctx, sess.code, 300, 366, 46, { align: 'center', outline: false, color: '#ffd23a' });
          R.text(ctx, shareLink(sess.code).replace(/^https?:\/\//, ''), 300, 400, 14, { align: 'center', outline: false, color: '#ccc' });
          btn(BTN_COPY, copied ? 'LIEN COPIÉ !' : 'COPIER LE LIEN', 15);
        }
        if (mode === 'code') R.text(ctx, 'Code donné par votre adversaire :', 300, 318, 16, { align: 'center', outline: false });
        if (mode === 'code') btn(BTN_GO, 'OK');
        R.text(ctx, status, 300, 482, 16, { align: 'center', outline: false, color: '#9ad0ff' });
        const who = AC.profile ? 'Connecté : ' + AC.profile.name : "Invité (connexion depuis l'accueil)";
        R.text(ctx, who, 300, 112, 14, { align: 'center', outline: false, color: '#ccc' });
        if (sess && sess.online) R.text(ctx, sess.online + (sess.online > 1 ? ' joueurs en ligne' : ' joueur en ligne'), 300, 508, 13, { align: 'center', outline: false, color: '#ccc' });
        btn(BTN_BACK, 'RETOUR');
      },
      onClick(x, y) {
        if (inRect(x, y, BTN_BACK)) { netOff(); return go(Title); }
        if (!sess) return;
        if (quick) return;
        if (inRect(x, y, BTN_CREATE)) { A.play('click'); addr.style.display = 'none'; mode = 'private'; status = ''; sess.create(); return; }
        if (inRect(x, y, BTN_JOIN)) {
          A.play('click'); if (sess.code) sess.leave();
          mode = 'code'; status = ''; addr.style.display = 'block'; positionAddr(); addr.focus(); return;
        }
        if (mode === 'code' && inRect(x, y, BTN_GO)) joinCode(addr.value);
        if (mode === 'private' && sess.code && inRect(x, y, BTN_COPY)) {
          const link = shareLink(sess.code);
          if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => { copied = 60; }, () => { status = link; });
          else status = link;
        }
      },
      onKey(k) {
        if (k === 'Enter' && mode === 'code') joinCode(addr.value);
        if (k === 'Escape') { netOff(); go(Title); }
      },
    };
    return self;
  }

  // ---------- online match ----------
  function startNet() {
    let prev = null, intro = 75, wasOver = false, levelUp = 0, outTicks = 0;  // "VS" banner for the first 2.5 s
    sess.onEvents = (ev) => ev.forEach((e) => { A.play(e); if (e === 'out') outTicks = 30; });
    sess.onProfile = (p) => { const old = AC.profile; if (old && p.level > old.level) levelUp = p.level; AC.update(p); };
    let confirmQuit = 0;  // confirm ranked departure; server cancels if no movement or hit occurred
    const leave = () => {
      const g = sess.view;
      if (sess.isPublic && g && !g.over && !sess.closed && !confirmQuit) { confirmQuit = 90; return; }
      sess.onEvents = null; netOff(); go(Title);
    };
    go({
      tick() {
        prev = sess.shown ? snapPos(sess.shown) : null;
        sess.tick(readPad());
        if (intro > 0 && sess.view) intro--;
        const over = !!(sess.view && sess.view.over);
        if (wasOver && !over) { sess.result = null; levelUp = 0; }  // rematch started
        wasOver = over;
        if (confirmQuit) confirmQuit--;
        if (outTicks) outTicks--;
      },
      tickScale: () => sess.tickScale,
      draw(alpha) {
        const g = sess.shown;
        if (!g) return;
        drawMatch(g, sess.me === 1, prev, alpha, sess.me, sess.players.map((p) => p && p.look), outTicks);
        const opp = sess.players[1 - sess.me];
        if (intro > 0 && opp) {
          ctx.globalAlpha = Math.min(1, intro / 15);
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 200, 600, 100);
          R.text(ctx, 'Adversaire trouvé !', 300, 236, 22, { align: 'center', color: '#9ad0ff' });
          R.text(ctx, 'VS  ' + opp.name, 300, 276, 34, { align: 'center', color: '#ffd23a' });
          if (opp.elo != null) R.text(ctx, 'Elo ' + opp.elo + '   ·   Niv. ' + opp.level, 300, 296, 14, { align: 'center' });
          ctx.globalAlpha = 1;
        }
        const rtt = sess.rtt;
        R.text(ctx, 'VOUS : P' + (sess.me + 1) + (rtt != null ? '  ping ' + Math.round(rtt) + ' ms' : ''), 8, 20, 14);
        let msg = null;
        if (sess.closed) msg = sess.cancelled ? 'Partie annulée — aucun Elo, XP ni pièces.' : "L'adversaire a quitté la partie" + (sess.result ? ' : victoire !' : '');
        else if (sess.lost) msg = 'Connexion perdue - reconnexion...';
        else if (sess.paused) msg = sess.peerOn ? 'Pause - en attente...' : 'Adversaire déconnecté - pause';
        if (msg) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 270, 600, 70);
          R.text(ctx, msg, 300, 302, 24, { align: 'center' });
          R.text(ctx, 'Échap : menu', 300, 328, 15, { align: 'center' });
        }
        if (confirmQuit) {
          ctx.fillStyle = 'rgba(160,0,0,0.75)'; ctx.fillRect(0, 350, 600, 60);
          R.text(ctx, 'Sans mouvement ni frappe : annulée. Sinon : défaite.', 300, 376, 18, { align: 'center' });
          R.text(ctx, 'Échap à nouveau pour confirmer', 300, 400, 15, { align: 'center' });
        }
        if (g.over) {
          R.text(ctx, 'Espace : revanche   -   Échap : menu', 300, 380, 18, { align: 'center' });
          const r = sess.result;
          if (r) R.text(ctx, (r.elo >= 0 ? '+' : '') + r.elo + ' Elo   ·   +' + r.xp + ' XP   ·   +' + (r.coins || 0) + ' pièces', 300, 420, 18, { align: 'center', color: r.elo >= 0 ? '#7dff8a' : '#ff8a80' });
          if (levelUp) R.text(ctx, 'NIVEAU ' + levelUp + ' ! Un point de capacité à placer (compte)', 300, 452, 16, { align: 'center', color: '#ffd23a' });
        }
      },
      onClick(x, y) { if (inRect(x, y, QUIT)) leave(); },
      onKey(k) { if (k === 'Escape') leave(); },
    });
  }

  // ---------- fixed-step loop, decoupled render ----------
  let last = performance.now(), acc = 0;
  function frame(t) {
    acc += Math.min(250, t - last); last = t;
    const tick = TICK * (scene.tickScale ? scene.tickScale() : 1);  // online: paced by the server queue
    while (acc >= tick) { scene.tick(); acc -= tick; }
    ctx.clearRect(0, 0, 600, 600);
    scene.draw(acc / tick);
    requestAnimationFrame(frame);
  }
  resize();
  AC.init();
  go(Title);
  requestAnimationFrame(frame);
})();
