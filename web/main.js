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
  // Rounded button; style: { bg, hot, fg, size, off } (off = greyed out).
  function button(r, label, st) {
    st = st || {};
    const hot = !st.off && inRect(mx, my, r);
    ctx.fillStyle = st.off ? 'rgba(255,255,255,0.12)' : hot ? (st.hot || '#ffd23a') : (st.bg || '#f2f2f2');
    R.roundRect(ctx, r[0], r[1], r[2], r[3], 7); ctx.fill();
    const size = st.size || 13;
    R.text(ctx, label, r[0] + r[2] / 2, r[1] + r[3] / 2 + size * 0.36, size, { align: 'center', outline: false, color: st.off ? '#aaa' : (st.fg || '#1a1a1a') });
  }
  function fmtDur(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    if (h >= 48) return Math.floor(h / 24) + ' j ' + (h % 24) + ' h';
    return h ? h + ' h ' + String(m).padStart(2, '0') : m ? m + ' min ' + String(s % 60).padStart(2, '0') : s + ' s';
  }
  const MT = TennisMeta, CARDS = TennisCards;
  const cardName = (id) => (CARDS.find(id) || { name: id }).name;
  // The court skin to draw for a look: 'arena' means the arena of these trophies.
  const resolveCourt = (look, trophies) => look && Object.assign({}, look, { court: look.court === 'arena' ? MT.ARENAS[MT.arena(trophies || 0)].court : look.court });

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
  const MENU = [['PARTIE RAPIDE', 'Classé · trophées, coffres et pièces', 300], ['TOURNOI', '16 joueurs, élimination directe', 362],
    ['HÉBERGER / REJOINDRE', 'Joue avec un ami via un code', 424], ['CLASSEMENT', 'Trophées, semaine et clubs', 486]];
  const MENU_X = 140, MENU_W = 320, MENU_H = 52;
  const menuRect = (y) => [MENU_X, y, MENU_W, MENU_H];
  // Top navigation: shop and the meta-game hub tabs.
  const NAV = [['BOUTIQUE', 'shop'], ['COFFRES', 'chests'], ['QUÊTES', 'quests'], ['DECK', 'deck'], ['PASS', 'pass'], ['CLUB', 'club']]
    .map(([label, tab], i) => ({ label, tab, r: [27 + i * 92, 204, 86, 34] }));
  const EVENT_BTN = [140, 250, 320, 40];
  const TUTO_KEY = 'tennus.tutorial-done';
  const tutoDone = () => { try { return !!localStorage.getItem(TUTO_KEY); } catch (e) { return true; } };
  function badges() {  // tab -> something to claim
    const m = AC.metaState, b = {};
    if (!m) return b;
    b.chests = !m.login.claimed || m.chests.some((c) => c.ready || (!c.opensAt && !m.chests.some((x) => x.opensAt > m.now)));
    b.quests = m.quests.some((q) => q.progress >= q.goal && !q.claimed);
    const claimed = m.pass.claimed.free;
    for (let t = 1; t <= m.pass.tier; t++) if (!claimed.includes(t)) b.pass = true;
    return b;
  }
  const Title = {
    enter() {
      resetData(); A.playMusic('title');
      if (AC.profile) AC.meta().catch(() => {});
      const m = /^#([A-Za-z0-9]{4})$/.exec(location.hash);  // shared invite link
      if (m) return go(Lobby({ code: m[1] }));
      if (!tutoDone() && !Title.offered) { Title.offered = true; go(Tutorial()); }
    },
    tick() {},
    draw() {
      R.drawTitleScene(ctx, performance.now() / 1000);
      R.drawLogo(ctx, 'TENNUS', 300, 150);
      const b = badges();
      for (const n of NAV) {
        button(n.r, n.label, { size: 12, bg: n.tab === 'shop' ? 'rgba(255,210,58,0.9)' : 'rgba(255,255,255,0.88)' });
        if (b[n.tab]) { ctx.fillStyle = '#ff4b4b'; ctx.beginPath(); ctx.arc(n.r[0] + n.r[2] - 4, n.r[1] + 4, 5, 0, Math.PI * 2); ctx.fill(); }
      }
      const ev = AC.metaState && AC.metaState.event;
      if (ev) button(EVENT_BTN, '★ ÉVÉNEMENT : ' + ev.name.toUpperCase() + ' ★', { bg: '#ff7a3a', fg: '#fff', size: 14 });
      MENU.forEach(([s, sub, y], i) => R.menuCard(ctx, menuRect(y), s, sub, inRect(mx, my, menuRect(y)), i === 0));
      const p = AC.profile;
      R.text(ctx, p ? '🏆 ' + p.trophies + ' · ' + MT.ARENAS[p.arena].name + '   ·   Niv. ' + p.level + '   ·   ' + p.coins + ' pièces   ·   ' + p.gems + ' gemmes'
        + (p.points ? '   ·   ' + p.points + ' point(s) à placer !' : '')
        : 'Invité : connectez-vous pour gagner trophées, coffres et récompenses', 300, 566, 12,
        { align: 'center', outline: false, color: p && p.points ? '#d4ff3a' : 'rgba(220,235,255,0.85)' });
      R.text(ctx, 'Espace : frapper · Flèches : bouger · Shift sprint · Z/X/C effets · A spécial · K touches · T tutoriel', 300, 590, 10,
        { align: 'center', outline: false, weight: 'normal', color: 'rgba(220,235,255,0.7)' });
    },
    onClick(x, y) {
      const n = NAV.find((it) => inRect(x, y, it.r));
      if (n) { A.play('click'); return go(n.tab === 'shop' ? Shop() : Hub(n.tab)); }
      const ev = AC.metaState && AC.metaState.event;
      if (ev && inRect(x, y, EVENT_BTN)) { A.play('click'); A.stopMusic(); return go(Lobby({ quick: true, event: ev })); }
      const i = MENU.findIndex(([, , my2]) => inRect(x, y, menuRect(my2)));
      if (i < 0) return;
      A.play('click'); A.stopMusic();
      if (i === 0) go(Lobby({ quick: true }));
      else if (i === 1) startTournament();
      else if (i === 2) go(Lobby({}));
      else go(Leaderboard());
    },
    onKey(k) {
      if (k === 'k' || k === 'K') configureKeys();
      if (k === 't' || k === 'T') go(Tutorial());
    },
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
    const kinds = ['offers'].concat(CO.SHOP_KINDS);
    let kind = 'offers', status = '', busy = false;
    const BTN_BACK = [230, 556, 140, 30];
    const tw = 552 / kinds.length;
    const tabs = kinds.map((k, i) => [k, [24 + i * tw, 92, tw - 6, 30]]);
    const title = { offers: 'DU JOUR', racket: 'RAQUETTES', shirt: 'HAUTS', shorts: 'SHORTS', cap: 'CASQUETTES', court: 'TERRAINS' };
    const day = () => MT.dayKey(Date.now());
    function entries() {
      if (kind === 'offers') return CO.dailyOffers(day()).map(([k, id]) => ({ kind: k, item: CO.find(k, id) }));
      return CO.CATALOG[kind].map((item) => ({ kind, item }));
    }
    function layout(n) {
      const rowH = Math.min(65, Math.floor(400 / Math.ceil(n / 2)));
      return (i) => ({ x: 32 + (i % 2) * 270, y: 132 + Math.floor(i / 2) * rowH, h: rowH - 8 });
    }
    async function act(e, action) {
      if (!AC.profile) { status = 'Connectez-vous pour acheter et équiper.'; AC.open(); return; }
      if (busy) return;
      busy = true; status = action === 'buy' ? 'Achat en cours...' : 'Équipement en cours...';
      try { await AC.shop(action, e.kind, e.item.id); status = action === 'buy' ? 'Article acheté !' : 'Article équipé !'; }
      catch (err) { status = err.message; }
      busy = false;
    }
    function stateOf(e) {  // { have, current, label }
      const p = AC.profile, it = e.item;
      const have = !!(p && CO.owns(p.owned, e.kind, it.id, p.bestArena));
      const current = !!(p && p.look[e.kind] === it.id);
      let label = current ? 'ÉQUIPÉ' : have ? 'ÉQUIPER' : CO.priceOn(e.kind, it.id, day()) + ' ✦';
      if (!have && it.unlock === 'arena') label = 'ARÈNE ' + (MT.ARENAS.findIndex((a) => a.court === it.id) + 1);
      if (!have && it.unlock === 'pass') label = 'PASS';
      return { have, current, label };
    }
    const RARITY = { common: '#b8c2d4', rare: '#5fb0ff', epic: '#c08cff', legendary: '#ffd23a' };
    return {
      tick() {},
      draw() {
        R.drawScene(ctx); R.panel(ctx);
        const glow = ctx.createRadialGradient(300, 80, 20, 300, 260, 360);
        glow.addColorStop(0, 'rgba(255,190,55,0.12)'); glow.addColorStop(1, 'rgba(255,190,55,0)');
        ctx.fillStyle = glow; ctx.fillRect(20, 20, 560, 540);
        R.text(ctx, '✦  BOUTIQUE VIP  ✦', 300, 62, 30, { align: 'center', outline: false, color: '#ffd23a' });
        const p = AC.profile;
        R.text(ctx, p ? 'Solde : ' + p.coins + ' pièces · ' + p.gems + ' gemmes' + (kind === 'offers' ? ' · offres -20 % jusqu’à minuit' : '')
          : 'Connectez-vous pour dépenser vos pièces de victoire', 300, 82, 12, { align: 'center', outline: false, color: '#e5d6ad' });
        for (const [k, r] of tabs) {
          const hot = k === kind || inRect(mx, my, r);
          ctx.fillStyle = k === kind ? 'rgba(255,210,58,0.95)' : hot ? 'rgba(255,210,58,0.3)' : 'rgba(255,255,255,0.1)';
          R.roundRect(ctx, r[0], r[1], r[2], r[3], 8); ctx.fill();
          R.text(ctx, title[k], r[0] + r[2] / 2, r[1] + 20, 11, { align: 'center', outline: false, color: k === kind ? '#19130a' : '#fff' });
        }
        const list = entries(), pos = layout(list.length);
        list.forEach((e, i) => {
          const { x, y, h } = pos(i), it = e.item, st = stateOf(e);
          ctx.fillStyle = 'rgba(7,13,30,0.78)'; R.roundRect(ctx, x, y, 256, h, 9); ctx.fill();
          ctx.strokeStyle = RARITY[it.rarity] || 'rgba(255,255,255,0.16)'; ctx.lineWidth = it.rarity === 'common' ? 1 : 1.5; ctx.stroke();
          const sw = it.color || it.surface;
          if (sw) {
            ctx.fillStyle = sw; R.roundRect(ctx, x + 9, y + h / 2 - 14, 30, 28, 6); ctx.fill();
            if (it.surface) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(x + 14, y + h / 2 - 9, 20, 18); }
          }
          R.text(ctx, it.name, x + 48, y + h / 2 - 2, 13, { outline: false });
          R.text(ctx, (kind === 'offers' ? title[e.kind].toLowerCase() + ' · ' : '') + it.rarity, x + 48, y + h / 2 + 13, 9, { outline: false, weight: 'normal', color: RARITY[it.rarity] });
          const br = [x + 154, y + h / 2 - 10, 92, 20];
          ctx.fillStyle = st.current ? '#5cbd87' : inRect(mx, my, br) ? '#ffd23a' : '#e7bc45';
          R.roundRect(ctx, br[0], br[1], br[2], br[3], 6); ctx.fill();
          R.text(ctx, st.label, br[0] + br[2] / 2, br[1] + 14, 11, { align: 'center', outline: false, color: '#19130a' });
        });
        R.text(ctx, status, 300, 548, 13, { align: 'center', outline: false, color: '#9ad0ff' });
        button(BTN_BACK, 'RETOUR', { size: 14 });
      },
      onClick(x, y) {
        if (inRect(x, y, BTN_BACK)) { go(Title); return; }
        for (const [k, r] of tabs) if (inRect(x, y, r)) { kind = k; status = ''; return; }
        const list = entries(), pos = layout(list.length);
        for (let i = 0; i < list.length; i++) {
          const { x: x0, y: y0, h } = pos(i);
          if (!inRect(x, y, [x0 + 154, y0 + h / 2 - 10, 92, 20])) continue;
          const e = list[i], st = stateOf(e);
          if (st.current) return;
          if (!st.have && e.item.unlock === 'arena') { status = 'Se débloque en atteignant cette arène.'; return; }
          if (!st.have && e.item.unlock === 'pass') { status = 'Récompense du pass de saison premium.'; return; }
          act(e, st.have ? 'equip' : 'buy'); return;
        }
      },
      onKey(k) { if (k === 'Escape') go(Title); },
    };
  }

  // ---------- meta-game hub: chests, quests, deck, pass, club, character ----------
  const HUB_TABS = [['chests', 'COFFRES'], ['quests', 'QUÊTES'], ['deck', 'DECK'], ['pass', 'PASS'], ['club', 'CLUB'], ['char', 'PERSO']];
  function Hub(tab) {
    let status = '', busy = false, flash = '', page = 0, slot = 0, needLogin = !AC.profile;
    const BTN_BACK = [230, 556, 140, 30];
    const tabs = HUB_TABS.map(([id, label], i) => ({ id, label, r: [24 + i * 93, 64, 87, 28] }));
    let hits = [];  // clickable areas of the current frame: [rect, action]
    const area = (r, fn) => hits.push([r, fn]);
    if (!needLogin) AC.meta().catch((e) => { status = e.message; });
    async function act(action, extra, ok) {
      if (busy) return;
      busy = true; status = '';
      try { const j = await AC.act(action, extra); status = ok ? ok(j) : ''; } catch (e) { status = e.message; }
      busy = false;
    }
    const sub = (s, x, y, size, color, align) => R.text(ctx, s, x, y, size || 12, { align: align || 'left', outline: false, color: color || '#ccd8ea' });
    const box = (r, col, line) => {
      ctx.fillStyle = col || 'rgba(7,13,30,0.78)'; R.roundRect(ctx, r[0], r[1], r[2], r[3], 9); ctx.fill();
      if (line) { ctx.strokeStyle = line; ctx.lineWidth = 1.5; ctx.stroke(); }
    };
    const bar = (x, y, w, f, col) => {
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; R.roundRect(ctx, x, y, w, 8, 4); ctx.fill();
      ctx.fillStyle = col || '#72d89a'; R.roundRect(ctx, x, y, Math.max(8, w * Math.min(1, f)), 8, 4); ctx.fill();
    };
    function rewardText(r) {
      if (!r) return '';
      const parts = [];
      if (r.coins) parts.push('+' + r.coins + ' pièces');
      if (r.gems) parts.push((r.gems > 0 ? '+' : '') + r.gems + ' gemmes');
      if (r.chest) parts.push(MT.CHESTS[r.chest].name);
      if (r.cards) parts.push(Object.entries(r.cards).map(([id, n]) => n + '× ' + cardName(id)).join(', '));
      if (r.cosmetic) parts.push('NOUVEAU : ' + (CO.find(r.cosmetic[0], r.cosmetic[1]) || {}).name);
      return parts.join('  ·  ');
    }

    function drawChests(m) {
      const L0 = m.login;
      box([40, 104, 520, 56], 'rgba(255,210,58,0.12)', 'rgba(255,210,58,0.5)');
      sub('Récompense du jour · série ' + L0.streak + '/7', 56, 126, 14, '#ffd23a');
      sub(rewardText(L0.reward), 56, 146, 12);
      const lr = [430, 118, 116, 28];
      button(lr, L0.claimed ? 'RÉCLAMÉE' : 'RÉCLAMER', { off: L0.claimed, bg: '#7dff8a' });
      if (!L0.claimed) area(lr, () => act('login', {}, () => 'Récompense du jour réclamée !'));
      const unlocking = m.chests.some((c) => c.opensAt > Date.now());
      for (let i = 0; i < MT.CHEST_SLOTS; i++) {
        const x = 40 + i * 132, r = [x, 172, 124, 200], c = m.chests[i];
        box(r, 'rgba(7,13,30,0.78)', c ? (c.kind === 'gold' ? '#ffd23a' : c.kind === 'silver' ? '#cfd8e6' : '#b07a43') : 'rgba(255,255,255,0.12)');
        if (!c) { sub('Emplacement libre', x + 62, 270, 11, '#7f8aa0', 'center'); continue; }
        const col = c.kind === 'gold' ? '#ffd23a' : c.kind === 'silver' ? '#cfd8e6' : '#b07a43';
        ctx.fillStyle = col; R.roundRect(ctx, x + 32, 196, 60, 44, 8); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + 32, 214, 60, 5);
        sub(c.name, x + 62, 262, 12, '#fff', 'center');
        const left = c.opensAt - Date.now(), br = [x + 10, 330, 104, 28];
        if (c.opensAt && left <= 0) {
          sub('Prêt !', x + 62, 290, 14, '#7dff8a', 'center');
          button(br, 'OUVRIR', { bg: '#7dff8a' });
          area(br, () => act('chest-open', { id: c.id }, (j) => { flash = rewardText(j.reward); return 'Coffre ouvert !'; }));
        } else if (c.opensAt) {
          sub(fmtDur(left), x + 62, 290, 14, '#9ad0ff', 'center');
          const cost = MT.skipCost(left);
          button(br, cost + ' GEMMES', { bg: '#b98cff', size: 12 });
          area(br, () => act('chest-open', { id: c.id, gems: true }, (j) => { flash = rewardText(j.reward); return 'Coffre ouvert !'; }));
        } else {
          sub(fmtDur(c.secs * 1000), x + 62, 290, 13, '#ccd8ea', 'center');
          button(br, 'DÉVERROUILLER', { off: unlocking, size: 11 });
          if (!unlocking) area(br, () => act('chest-start', { id: c.id }, () => 'Ouverture lancée.'));
        }
      }
      sub('Un coffre par victoire classée (4 emplacements). Un seul s’ouvre à la fois.', 300, 396, 12, '#ccd8ea', 'center');
      const rates = Object.values(MT.CHESTS).map((c) => c.name.replace('Coffre ', '') + ' ' + c.weight + ' %').join(' · ');
      sub('Taux d’obtention : ' + rates, 300, 416, 11, '#9aa6bb', 'center');
      sub('Chance de cosmétique : argent ' + MT.CHESTS.silver.cosmetic + ' %, or ' + MT.CHESTS.gold.cosmetic + ' %', 300, 432, 11, '#9aa6bb', 'center');
      if (flash) { box([40, 450, 520, 60], 'rgba(125,255,138,0.12)', '#7dff8a'); wrap(flash, 300, 472, 500, 12, '#e8ffe9'); }
    }
    function wrap(text, x, y, w, size, color) {  // centred text over two lines at most
      ctx.font = 'bold ' + size + 'px ' + R.FONT;
      const words = text.split(' '), lines = [''];
      for (const wd of words) {
        const t = lines[lines.length - 1] ? lines[lines.length - 1] + ' ' + wd : wd;
        if (ctx.measureText(t).width > w && lines[lines.length - 1]) lines.push(wd); else lines[lines.length - 1] = t;
      }
      lines.slice(0, 3).forEach((l, i) => sub(l, x, y + i * (size + 5), size, color, 'center'));
    }

    function drawQuests(m) {
      sub('3 quêtes par jour, renouvelées à minuit (heure de Paris).', 300, 120, 13, '#ccd8ea', 'center');
      m.quests.forEach((q, i) => {
        const y = 140 + i * 92;
        box([40, y, 520, 80], 'rgba(7,13,30,0.78)', q.claimed ? 'rgba(125,255,138,0.4)' : 'rgba(255,255,255,0.15)');
        sub(q.text, 60, y + 28, 15, '#fff');
        sub('Récompense : ' + q.reward + ' pièces + ' + MT.QUEST_PASS_XP + ' XP de pass', 60, y + 48, 11);
        bar(60, y + 58, 300, q.progress / q.goal);
        sub(q.progress + ' / ' + q.goal, 370, y + 66, 11);
        const br = [430, y + 24, 112, 30], done = q.progress >= q.goal;
        button(br, q.claimed ? 'RÉCLAMÉE' : done ? 'RÉCLAMER' : 'EN COURS', { off: q.claimed || !done, bg: '#7dff8a' });
        if (done && !q.claimed) area(br, () => act('quest', { slot: q.slot }, () => '+' + q.reward + ' pièces !'));
      });
    }

    function drawDeck(m) {
      const deck = m.deck.slice();
      sub('Ton deck (3 coups spéciaux) · touche A pour jouer la carte active, Q/E pour changer', 300, 116, 12, '#ccd8ea', 'center');
      deck.forEach((id, i) => {
        const r = [90 + i * 145, 126, 130, 46], c = CARDS.find(id);
        box(r, i === slot ? 'rgba(255,210,58,0.25)' : 'rgba(7,13,30,0.85)', i === slot ? '#ffd23a' : 'rgba(255,255,255,0.25)');
        sub(c.name, r[0] + 65, r[1] + 21, 13, '#fff', 'center');
        sub(c.cost + ' énergie · niv. ' + m.cards[id].level, r[0] + 65, r[1] + 38, 11, '#9ad0ff', 'center');
        area(r, () => { slot = i; });
      });
      sub('Clique un emplacement, puis une carte pour l’y placer.', 300, 190, 11, '#9aa6bb', 'center');
      CARDS.CARDS.forEach((c, i) => {
        const x = 32 + (i % 4) * 136, y = 200 + Math.floor(i / 4) * 160, r = [x, y, 128, 150], own = m.cards[c.id];
        const inDeck = deck.includes(c.id);
        box(r, own ? 'rgba(7,13,30,0.85)' : 'rgba(7,13,30,0.45)', inDeck ? '#ffd23a' : 'rgba(255,255,255,0.15)');
        sub(c.name, x + 64, y + 20, 12, own ? '#fff' : '#777', 'center');
        sub(c.cost + ' énergie', x + 64, y + 37, 11, '#9ad0ff', 'center');
        wrapSmall(c.desc, x + 64, y + 56, 116, own ? '#ccd8ea' : '#666');
        if (!own) { sub('Dans les coffres', x + 64, y + 136, 10, '#777', 'center'); return; }
        const next = CARDS.UPGRADE[own.level - 1];
        sub('Niv. ' + own.level + (next ? ' · ' + own.copies + '/' + next.copies : ' · MAX'), x + 64, y + 100, 11, '#fff', 'center');
        if (next) bar(x + 14, y + 106, 100, own.copies / next.copies, '#b98cff');
        const can = next && own.copies >= next.copies;
        const br = [x + 10, y + 120, 108, 22];
        if (can) { button(br, 'AMÉLIORER ' + next.coins + ' ✦', { size: 10, bg: '#7dff8a' }); area(br, () => act('upgrade', { card: c.id }, () => c.name + ' niveau ' + (own.level + 1) + ' !')); }
        if (!inDeck) area(r, () => { const d = deck.slice(); d[slot] = c.id; act('deck', { deck: d }, () => 'Deck enregistré.'); });
      });
    }
    function wrapSmall(text, x, y, w, color) {
      ctx.font = 'normal 10px ' + R.FONT;
      const words = text.split(' '), lines = [''];
      for (const wd of words) {
        const t = lines[lines.length - 1] ? lines[lines.length - 1] + ' ' + wd : wd;
        if (ctx.measureText(t).width > w && lines[lines.length - 1]) lines.push(wd); else lines[lines.length - 1] = t;
      }
      lines.slice(0, 3).forEach((l, i) => R.text(ctx, l, x, y + i * 13, 10, { align: 'center', outline: false, weight: 'normal', color }));
    }

    function drawPass(m) {
      const P0 = m.pass;
      sub('Saison ' + (P0.season + 1) + ' · fin dans ' + fmtDur(P0.endsAt - Date.now()), 40, 120, 14, '#fff');
      sub('Palier ' + P0.tier + '/' + MT.PASS_TIERS + ' · ' + P0.xp % MT.PASS_TIER_XP + '/' + MT.PASS_TIER_XP + ' XP', 40, 140, 12);
      bar(40, 148, 300, P0.tier >= MT.PASS_TIERS ? 1 : (P0.xp % MT.PASS_TIER_XP) / MT.PASS_TIER_XP, '#ffd23a');
      sub(m.gems + ' gemmes', 560, 120, 13, '#b98cff', 'right');
      const br = [400, 128, 160, 26];
      if (P0.premium) sub('PREMIUM ACTIF', 480, 146, 13, '#ffd23a', 'center');
      else { button(br, 'PREMIUM ' + MT.PASS_PRICE + ' GEMMES', { bg: '#b98cff', size: 11 }); area(br, () => act('pass-buy', {}, () => 'Pass premium activé !')); }
      sub('GRATUIT', 160, 182, 12, '#9ad0ff', 'center'); sub('PREMIUM', 420, 182, 12, '#ffd23a', 'center');
      const per = 6, first = page * per + 1;
      for (let i = 0; i < per; i++) {
        const tier = first + i, y = 192 + i * 54;
        if (tier > MT.PASS_TIERS) break;
        const reached = tier <= P0.tier;
        sub(String(tier), 300, y + 30, 16, reached ? '#ffd23a' : '#777', 'center');
        for (const premium of [false, true]) {
          const x = premium ? 330 : 40, r = [x, y, 230, 46], rw = MT.passReward(tier, premium);
          const done = P0.claimed[premium ? 'premium' : 'free'].includes(tier);
          box(r, 'rgba(7,13,30,0.8)', done ? 'rgba(125,255,138,0.4)' : reached ? 'rgba(255,210,58,0.5)' : 'rgba(255,255,255,0.1)');
          const label = rw.cosmetic ? 'Court ' + (CO.find('court', rw.cosmetic[1]) || {}).name : rewardText(rw);
          sub(label, x + 12, y + 28, 12, premium && !P0.premium ? '#888' : '#fff');
          const cr = [x + 150, y + 10, 70, 26];
          const can = reached && !done && (!premium || P0.premium);
          button(cr, done ? 'OK' : 'PRENDRE', { off: !can, size: 11, bg: '#7dff8a' });
          if (can) area(cr, () => act('pass', { tier, premium }, () => 'Palier ' + tier + ' réclamé !'));
        }
      }
      const pages = Math.ceil(MT.PASS_TIERS / per);
      const pr = [40, 520, 80, 26], nx = [480, 520, 80, 26];
      button(pr, '◀', { off: page === 0 }); button(nx, '▶', { off: page >= pages - 1 });
      if (page > 0) area(pr, () => { page--; });
      if (page < pages - 1) area(nx, () => { page++; });
      sub('Gagne de l’XP de pass à chaque match et avec les quêtes.', 300, 538, 11, '#9aa6bb', 'center');
    }

    let clubList = null;
    function drawClub(m) {
      const c = m.club;
      if (!c) {
        if (!clubList) { clubList = []; fetch('/api/clubs').then((r) => r.json()).then((j) => { clubList = j.clubs; }).catch(() => {}); }
        sub('Rejoins un club pour discuter et échanger des cartes.', 300, 120, 13, '#ccd8ea', 'center');
        const cr = [200, 132, 200, 30];
        button(cr, 'CRÉER UN CLUB', { bg: '#7dff8a' });
        area(cr, () => { const n = prompt('Nom du club (3 à 20 caractères)'); if (n) act('club-create', { name: n }, () => 'Club créé !'); });
        clubList.slice(0, 9).forEach((cl, i) => {
          const y = 176 + i * 40;
          box([40, y, 520, 34]);
          sub(cl.name, 56, y + 22, 13, '#fff');
          sub(cl.members + '/' + MT.CLUB_MAX + ' membres · 🏆 ' + cl.trophies, 330, y + 22, 11, '#ccd8ea', 'right');
          const jr = [450, y + 4, 98, 26];
          button(jr, 'REJOINDRE', { off: cl.members >= MT.CLUB_MAX, size: 11 });
          if (cl.members < MT.CLUB_MAX) area(jr, () => act('club-join', { id: cl.id }, () => 'Bienvenue dans ' + cl.name + ' !'));
        });
        if (!clubList.length) sub('Aucun club pour le moment : crée le premier !', 300, 260, 13, '#ccd8ea', 'center');
        return;
      }
      sub(c.name, 40, 122, 18, '#ffd23a');
      sub(c.members.length + '/' + MT.CLUB_MAX + ' membres · 🏆 ' + c.trophies, 40, 142, 12);
      const lr = [470, 108, 90, 26];
      button(lr, 'QUITTER', { bg: '#ff8a80', size: 11 });
      area(lr, () => { if (confirm('Quitter le club ?')) { act('club-leave', {}, () => 'Tu as quitté le club.'); clubList = null; } });
      box([40, 156, 250, 384]);
      sub('MEMBRES', 56, 176, 12, '#9ad0ff');
      const myName = AC.profile && AC.profile.name;
      c.members.slice(0, 15).forEach((mb, i) => {
        const y = 196 + i * 22;
        sub((mb.owner ? '★ ' : '') + mb.name, 56, y, 11, mb.name === myName ? '#ffd23a' : '#fff');
        sub(String(mb.trophies), 230, y, 11, '#ccd8ea', 'right');
        if (mb.name !== myName) {
          const dr = [238, y - 12, 44, 16];
          button(dr, 'DON', { size: 9, bg: '#b98cff' });
          area(dr, () => {
            const own = Object.entries(m.cards).filter(([, v]) => v.copies > 0);
            if (!own.length) { status = 'Aucune carte en double à donner.'; return; }
            const list = own.map(([id, v], j) => (j + 1) + '. ' + cardName(id) + ' (' + v.copies + ')').join('\n');
            const k = Number(prompt('Donner une carte à ' + mb.name + ' (+' + MT.DONATE_COINS + ' pièces)\n' + list));
            if (own[k - 1]) act('club-donate', { to: mb.id, card: own[k - 1][0] }, () => 'Carte donnée à ' + mb.name + ' !');
          });
        }
      });
      box([300, 156, 260, 384]);
      sub('DISCUSSION', 316, 176, 12, '#9ad0ff');
      c.messages.slice(-12).forEach((msg, i) => {
        ctx.save(); ctx.beginPath(); ctx.rect(300, 180, 260, 320); ctx.clip();
        R.text(ctx, msg.name + ' : ' + msg.text, 316, 198 + i * 24, 11, { outline: false, weight: 'normal', color: '#e8eef8' });
        ctx.restore();
      });
      const wr = [316, 506, 228, 26];
      button(wr, 'ÉCRIRE UN MESSAGE', { size: 11 });
      area(wr, () => { const t = prompt('Message pour le club (140 caractères)'); if (t) act('club-say', { text: t }); });
    }

    function drawChar(m) {
      sub('Personnage : un petit bonus sur une capacité, débloqué par arène.', 300, 120, 13, '#ccd8ea', 'center');
      MT.CHARACTERS.forEach((c, i) => {
        const y = 136 + i * 52, unlocked = m.bestArena >= c.arena, cur = m.char === c.id, r = [40, y, 520, 44];
        box(r, cur ? 'rgba(255,210,58,0.2)' : 'rgba(7,13,30,0.8)', cur ? '#ffd23a' : 'rgba(255,255,255,0.12)');
        sub(c.name, 56, y + 20, 14, unlocked ? '#fff' : '#777');
        sub(c.desc, 56, y + 36, 11, unlocked ? '#ccd8ea' : '#666');
        const br = [430, y + 9, 116, 26];
        if (cur) sub('CHOISI', 488, y + 27, 12, '#ffd23a', 'center');
        else if (unlocked) { button(br, 'CHOISIR', { size: 12 }); area(br, () => act('char', { char: c.id }, () => c.name + ' choisi.')); }
        else sub('Arène ' + (c.arena + 1) + ' : ' + MT.ARENAS[c.arena].name, 488, y + 27, 11, '#777', 'center');
      });
      sub('ROUTE DES TROPHÉES', 40, 410, 13, '#9ad0ff');
      MT.ARENAS.forEach((a, i) => {
        const x = 40 + i * 106, r = [x, 420, 98, 92], here = m.arena === i;
        box(r, here ? 'rgba(255,210,58,0.2)' : 'rgba(7,13,30,0.8)', here ? '#ffd23a' : 'rgba(255,255,255,0.12)');
        ctx.fillStyle = CO.find('court', a.court).surface; R.roundRect(ctx, x + 12, 430, 74, 30, 5); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(x + 20, 434, 58, 22);
        sub(a.name, x + 49, 478, 11, m.bestArena >= i ? '#fff' : '#777', 'center');
        sub('🏆 ' + a.min, x + 49, 496, 11, '#ccd8ea', 'center');
      });
      sub('Trophées : ' + m.trophies + ' (record ' + m.best + ')', 300, 532, 12, '#ffd23a', 'center');
    }

    return {
      tick() {},
      draw() {
        hits = [];
        R.drawScene(ctx); R.panel(ctx);
        for (const t of tabs) {
          const on = t.id === tab;
          button(t.r, t.label, { size: 11, bg: on ? '#ffd23a' : 'rgba(255,255,255,0.14)', fg: on ? '#19130a' : '#fff' });
          if (!on) area(t.r, () => { tab = t.id; status = ''; flash = ''; page = 0; });
        }
        const m = AC.metaState;
        if (needLogin || !AC.profile) {
          sub('Connecte-toi pour gagner coffres, cartes, quêtes et récompenses de saison.', 300, 260, 14, '#fff', 'center');
          const lr = [220, 290, 160, 34];
          button(lr, 'SE CONNECTER', { bg: '#7dff8a' });
          area(lr, () => AC.open());
          if (AC.profile) { needLogin = false; AC.meta().catch(() => {}); }
        } else if (!m) sub('Chargement...', 300, 260, 16, '#fff', 'center');
        else ({ chests: drawChests, quests: drawQuests, deck: drawDeck, pass: drawPass, club: drawClub, char: drawChar })[tab](m);
        R.text(ctx, status, 300, 548, 13, { align: 'center', outline: false, color: '#9ad0ff' });
        button(BTN_BACK, 'RETOUR', { size: 14 });
        area(BTN_BACK, () => go(Title));
      },
      onClick(x, y) { for (let i = hits.length - 1; i >= 0; i--) if (inRect(x, y, hits[i][0])) { A.play('click'); return hits[i][1](); } },
      onKey(k) { if (k === 'Escape') go(Title); },
    };
  }

  // ---------- ranking: all-time trophies, this week, clubs ----------
  function Leaderboard() {
    const TABS = [['', 'TROPHÉES'], ['weekly', 'CETTE SEMAINE'], ['clubs', 'CLUBS']];
    let type = '', board = null, err = '';
    const tabs = TABS.map(([id, label], i) => ({ id, label, r: [90 + i * 142, 82, 136, 28] }));
    function load() {
      board = null; err = '';
      fetch('/api/leaderboard' + (type ? '?type=' + type : '')).then((r) => r.json()).then((j) => { board = j; }).catch(() => { err = 'Classement indisponible'; });
    }
    load();
    const BTN_BACK = [230, 540, 140, 30];
    const COLS = {
      '': [[80, '#', 'left', (r) => r.rank], [115, 'Pseudo', 'left', (r) => r.name], [365, 'Niv.', 'right', (r) => r.level],
        [440, 'V - D', 'right', (r) => r.wins + ' - ' + r.losses], [515, 'Trophées', 'right', (r) => r.trophies]],
      weekly: [[80, '#', 'left', (r) => r.rank], [115, 'Pseudo', 'left', (r) => r.name], [420, 'Victoires', 'right', (r) => r.wins],
        [515, 'Trophées +', 'right', (r) => r.trophies]],
      clubs: [[80, '#', 'left', (r) => r.rank], [115, 'Club', 'left', (r) => r.name], [420, 'Membres', 'right', (r) => r.members],
        [515, 'Trophées', 'right', (r) => r.trophies]],
    };
    return {
      tick() {},
      draw() {
        R.drawScene(ctx); R.panel(ctx);
        R.text(ctx, 'CLASSEMENT', 300, 64, 30, { align: 'center', outline: false });
        for (const t of tabs) button(t.r, t.label, { size: 11, bg: t.id === type ? '#ffd23a' : 'rgba(255,255,255,0.14)', fg: t.id === type ? '#19130a' : '#fff' });
        const cols = COLS[type];
        cols.forEach(([x, h, al]) => R.text(ctx, h, x, 132, 13, { align: al, outline: false, color: '#9ad0ff' }));
        if (!board) R.text(ctx, err || 'Chargement...', 300, 260, 18, { align: 'center', outline: false });
        else if (!board.top.length) R.text(ctx, 'Personne pour le moment : à vous de jouer !', 300, 260, 16, { align: 'center', outline: false });
        const me = AC.profile && AC.profile.name;
        const row = (r, y, hl) => cols.forEach(([x, , al, f]) => R.text(ctx, String(f(r)), x, y, 14, { align: al, outline: false, color: hl ? '#ffd23a' : '#fff' }));
        if (board) {
          board.top.forEach((r, i) => row(r, 152 + i * 17.5, r.name === me));
          if (board.me && board.me.rank > board.top.length) row(board.me, 152 + 20 * 17.5 + 6, true);
        }
        button(BTN_BACK, 'RETOUR', { size: 14 });
      },
      onClick(x, y) {
        if (inRect(x, y, BTN_BACK)) return go(Title);
        const t = tabs.find((it) => inRect(x, y, it.r));
        if (t && t.id !== type) { type = t.id; load(); }
      },
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
    drawDeckHud(g, meIdx);
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
  // Energy (10 pips) and the 3 specials of my deck: active one framed, unaffordable or cooling down dimmed.
  function drawDeckHud(g, meIdx) {
    const deck = g.deck && g.deck[meIdx];
    if (!deck || !deck.length) return;
    const me = g.P[meIdx];
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i < me.en ? '#c58cff' : 'rgba(0,0,0,0.45)';
      R.roundRect(ctx, 196 + i * 21, 540, 18, 7, 3); ctx.fill();
    }
    for (let i = 0; i < deck.length; i++) {
      const c = CARDS.find(deck[i]), x = 196 + i * 72, active = i === me.card;
      const ready = active ? !me.cd && me.en >= c.cost : me.en >= c.cost;
      ctx.fillStyle = active ? 'rgba(255,210,58,0.9)' : 'rgba(0,0,0,0.55)';
      R.roundRect(ctx, x, 551, 66, 26, 5); ctx.fill();
      ctx.globalAlpha = ready ? 1 : 0.45;
      R.text(ctx, c.name, x + 33, 563, 9, { align: 'center', outline: false, color: active ? '#19130a' : '#fff' });
      R.text(ctx, c.cost + ' ⚡' + (active ? '  [A]' : ''), x + 33, 574, 9, { align: 'center', outline: false, weight: 'normal', color: active ? '#19130a' : '#c9b6ff' });
      ctx.globalAlpha = 1;
      if (active && me.cd) {
        const f = me.cd / c.cooldown;
        ctx.fillStyle = 'rgba(0,0,0,0.45)'; R.roundRect(ctx, x, 551, 66 * f, 26, 5); ctx.fill();
      }
    }
  }

  // copy of the moving parts, for render interpolation between ticks
  function snapPos(g) {
    return { P: g.P.map((p) => ({ vx: p.vx, vy: p.vy })), B: { vx: g.B.vx, vy: g.B.vy, vh: g.B.vh, visible: g.B.visible } };
  }

  // ---------- solo match ----------
  function startSolo() {
    const m = AC.metaState;
    const G = L.createMatch({
      names: data.pname, data: data.player_data, ctrl: ['human', 'ai'], matchMode: data.match_mode,
      seed: (Math.random() * 2 ** 32) >>> 0,
      decks: [m ? m.deck : null, null], levels: [m ? m.deck.map((id) => m.cards[id].level) : null, null],
    });
    const looks = [resolveCourt(AC.look(), AC.profile && AC.profile.trophies), null];
    let prev = null, outTicks = 0;
    go({
      tick() {
        prev = snapPos(G);
        L.step(G, [readPad(), null]);
        for (const e of G.events) { A.play(e); if (e === 'out') outTicks = 30; }
        if (outTicks) outTicks--;
        if (G.over) afterMatch(G);
      },
      draw(alpha) { drawMatch(G, false, prev, alpha, 0, looks, outTicks); },
      onClick(x, y) { if (inRect(x, y, QUIT)) go(Title); },
      onKey(k) { if (k === 'Escape') go(Title); },
    });
  }

  // ---------- tutorial: a guided solo rally, one control at a time (about a minute) ----------
  function Tutorial() {
    const G = L.createMatch({ names: ['VOUS', 'COACH'], data: [[5, 5, 6, 6, 0, 0], [3, 3, 3, 3, 3, 0]], ctrl: ['human', 'ai'], seed: 7 });
    G.P[0].en = 6;  // enough energy to try a special right away
    const STEPS = [
      { text: 'Flèches : déplace-toi sur le court', done: (c) => c.moved > 25 },
      { text: 'Espace : sers, puis frappe quand la balle arrive', done: (c) => c.hits >= 2 },
      { text: 'Garde une flèche enfoncée en frappant pour viser', done: (c) => c.aimed >= 1 },
      { text: 'Shift : sprint (la jauge verte de stamina baisse)', done: (c) => c.sprint > 20 },
      { text: 'Z lift · X slice · C lob ou amorti, en frappant', done: (c) => c.effects >= 1 },
      { text: 'A : coup spécial (coûte de l’énergie, barre violette)', done: (c) => c.cards >= 1 },
    ];
    const c = { moved: 0, hits: 0, aimed: 0, sprint: 0, effects: 0, cards: 0 };
    let step = 0, doneT = 0, prev = null, outTicks = 0;
    const finish = () => { try { localStorage.setItem(TUTO_KEY, '1'); } catch (e) { /* storage unavailable */ } go(Title); };
    return {
      tick() {
        prev = snapPos(G);
        if (G.over) return finish();
        const pad = readPad(), rally = G.rally_cnt;
        L.step(G, [pad, null]);
        if (pad.l || pad.r || pad.u || pad.d) c.moved++;
        if (pad.sh && (pad.l || pad.r || pad.u || pad.d)) c.sprint++;
        if (G.rally_cnt > rally && G.B.side === 0) {
          c.hits++;
          if (pad.l || pad.r || pad.u || pad.d) c.aimed++;
          if (pad.tp || pad.sl || pad.lc) c.effects++;
        }
        for (const e of G.events) { A.play(e); if (e === 'out') outTicks = 30; if (e === 'card') c.cards++; }
        if (outTicks) outTicks--;
        if (G.P[0].en < 4) G.P[0].en = 4;  // never stuck on the last step
        if (step < STEPS.length && STEPS[step].done(c)) { step++; A.play('click'); }
        if (step >= STEPS.length && ++doneT > 90) finish();
      },
      draw(alpha) {
        drawMatch(G, false, prev, alpha, 0, [resolveCourt(AC.look(), AC.profile && AC.profile.trophies), null], outTicks);
        ctx.fillStyle = 'rgba(0,0,0,0.7)'; R.roundRect(ctx, 60, 40, 480, 64, 12); ctx.fill();
        R.text(ctx, step < STEPS.length ? 'ÉTAPE ' + (step + 1) + '/' + STEPS.length : 'BRAVO !', 300, 62, 13, { align: 'center', outline: false, color: '#ffd23a' });
        R.text(ctx, step < STEPS.length ? STEPS[step].text : 'Tu connais toutes les commandes. À toi de jouer !', 300, 88, 17, { align: 'center', outline: false });
        R.text(ctx, 'Échap : passer le tutoriel', 300, 122, 11, { align: 'center', outline: false, color: 'rgba(255,255,255,0.7)' });
      },
      onClick(x, y) { if (inRect(x, y, QUIT)) finish(); },
      onKey(k) { if (k === 'Escape') finish(); },
    };
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
    const quick = !!opts.quick, autoCode = opts.code, event = opts.event || null;
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
          const send = () => { if (scene !== self) return; if (sess.ws.readyState === 1) sess.quick(event && event.id); else setTimeout(send, 100); };
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
        R.text(ctx, event ? 'ÉVÉNEMENT : ' + event.name.toUpperCase() : quick ? 'PARTIE RAPIDE' : 'HÉBERGER / REJOINDRE', 300, 80, event ? 26 : 32, { align: 'center', outline: false });
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
          R.text(ctx, event ? event.desc + ' · +' + MT.EVENT_COINS + ' pièces par victoire, sans trophées'
            : p ? 'Partie classée : 🏆 ' + p.trophies + ' · +' + MT.TROPHY_WIN + ' / -' + MT.TROPHY_LOSS + ' trophées, coffre à la victoire'
              : "En invité, rien n'est enregistré : connectez-vous pour progresser.", 300, 330, 13, { align: 'center', outline: false, color: '#ccc' });
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
          ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(0, 196, 600, 128);
          R.text(ctx, 'Adversaire trouvé !', 300, 228, 20, { align: 'center', color: '#9ad0ff' });
          R.text(ctx, 'VS  ' + opp.name, 300, 266, 32, { align: 'center', color: '#ffd23a' });
          R.text(ctx, '🏆 ' + (opp.trophies || 0) + (opp.level ? '   ·   Niv. ' + opp.level : ''), 300, 288, 14, { align: 'center' });
          const od = sess.consts && sess.consts.deck[1 - sess.me];
          if (od && od.length) R.text(ctx, 'Deck : ' + od.map(cardName).join(' · '), 300, 310, 12, { align: 'center', color: '#c9b6ff' });
          else if (sess.consts && sess.consts.ev === 'classic') R.text(ctx, 'Mode classique : sans coups spéciaux', 300, 310, 12, { align: 'center', color: '#c9b6ff' });
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
          if (r) {
            const parts = [];
            if (r.trophies) parts.push((r.trophies > 0 ? '+' : '') + r.trophies + ' 🏆');
            if (r.xp) parts.push('+' + r.xp + ' XP');
            parts.push('+' + (r.coins || 0) + ' pièces');
            R.text(ctx, parts.join('   ·   '), 300, 420, 18, { align: 'center', color: r.won ? '#7dff8a' : '#ff8a80' });
            const extra = [r.chest && r.chest + ' obtenu !', r.arena && 'Nouvelle arène : ' + r.arena + ' !'].filter(Boolean).join('   ');
            if (extra) R.text(ctx, extra, 300, 476, 16, { align: 'center', color: '#ffd23a' });
          }
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
  AC.onChange((p) => { if (p && !AC.metaState) AC.meta().catch(() => {}); });  // badges as soon as we know the account
  AC.init();
  go(Title);
  requestAnimationFrame(frame);
})();
