// Screens, input, fixed 30 Hz loop, solo + network flows.
(function () {
  'use strict';
  const L = TennisLogic, R = TennisRender, A = TennisAudio, N = TennisNet, C = L.C;
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
  const KEYS = { ArrowLeft: 'l', ArrowRight: 'r', ArrowUp: 'u', ArrowDown: 'd', ' ': 'sp', Spacebar: 'sp' };
  const keys = {}; let spLatch = false;
  addEventListener('keydown', (e) => {
    A.unlock();
    if (document.activeElement === addr) { if (e.key === 'Enter') scene.onKey && scene.onKey('Enter'); return; }
    const k = KEYS[e.key];
    if (k) { e.preventDefault(); if (!keys[k] && k === 'sp') spLatch = true; keys[k] = true; }
    if (!e.repeat && scene.onKey) scene.onKey(e.key);
    if (e.key === 'm' || e.key === 'M') A.toggleMute();
  });
  addEventListener('keyup', (e) => { const k = KEYS[e.key]; if (k) keys[k] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  function readPad() {  // sampled once per tick, like the original keydata[]
    const p = { l: !!keys.l, r: !!keys.r, u: !!keys.u, d: !!keys.d, sp: !!keys.sp || spLatch };
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
  function go(s) { scene = s; spLatch = false; addr.style.display = 'none'; if (s.enter) s.enter(); }

  // "Space bar" button clip: 12 animation ticks after the key press, then the action.
  function spaceClip(action) {
    return {
      f: 1,
      key(k) { if (k === ' ' && this.f === 1) { this.f = 2; A.play('space'); } },
      tick() { if (this.f > 1 && ++this.f >= 13) { this.f = 1; action(); } },
    };
  }

  // ---------- title ----------
  const MENU = [['EXHIBITION', 346], ['TOURNAMENT', 376], ['2 PLAYERS', 406]];
  const Title = {
    enter() { resetData(); A.playMusic('title'); },
    tick() {},
    draw() {
      R.drawScene(ctx);
      R.text(ctx, 'TENNIS GAME', 300, 112, 64, { align: 'center', outline: false });
      const help = ['Key Operation:', 'Space key to hit the ball.', 'Arrow key to move or  to aim the ball direction',
        'at the moment of stroke.', 'Getting 3 games first  to win.'];
      help.forEach((s, i) => R.text(ctx, s, 145, 140 + i * 22, 15, { outline: false }));
      ctx.fillStyle = 'rgba(0,0,0,0.85)'; R.roundRect(ctx, 170, 316, 250, 118, 8); ctx.fill();
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2; ctx.stroke();
      MENU.forEach(([s, y]) => {
        const hot = inRect(mx, my, [170, y - 22, 250, 30]);
        R.text(ctx, s, 218, y + 8, 21, { outline: false, color: hot ? '#ffd23a' : '#fff' });
      });
      R.text(ctx, 'remake', 580, 590, 12, { align: 'right', outline: false, color: 'rgba(255,255,255,0.7)' });
    },
    onClick(x, y) {
      const i = MENU.findIndex(([, my2]) => inRect(x, y, [170, my2 - 22, 250, 30]));
      if (i < 0) return;
      A.play('click'); A.stopMusic();
      if (i === 0) go(Edit());
      else if (i === 1) { data.kaisen = 0; data.match_mode = 1; data.result_txt = []; go(Select()); }
      else go(Lobby());
    },
  };

  // ---------- exhibition stats ----------
  const STATS = ['Forehand', 'Backhand', 'Serve', 'Footwork'];
  function Edit() {
    // COM (player 1) bars at the top, YOU (player 0) below; random stats as in the original.
    const rows = [];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) {
      data.player_data[i][j] = Math.floor((Math.random() * 10 + Math.random() * 10 + Math.random() * 10) / 3);
      rows.push({ i, j, x: i === 1 ? 183 : 283, y: (i === 1 ? 85 : 265) + j * 30 });
    }
    const sp = spaceClip(() => { A.stopMusic(); data.match_mode = 0; startSolo(); });
    return {
      enter() { A.playMusic('start'); },
      tick() { sp.tick(); },
      onKey(k) { sp.key(k); },
      onClick(x, y) {
        for (const r of rows) if (inRect(x, y, [r.x, r.y, 206, 22])) {
          data.player_data[r.i][r.j] = Math.max(0, Math.min(9, Math.floor((x - r.x) / 20)));
        }
      },
      draw() {
        R.drawScene(ctx); R.panel(ctx);
        for (const r of rows) {
          R.text(ctx, STATS[r.j], r.x - 101, r.y + 18, 18, { outline: false });
          R.bar(ctx, r.x, r.y, data.player_data[r.i][r.j]);
        }
        R.drawPlayer(ctx, 470, 160, 1.1, 'fore', 9, 'front', 1);
        R.text(ctx, 'COM', 472, 203, 26, { align: 'center', outline: false });
        R.drawPlayer(ctx, 115, 400, 1.1, 'smash', 4, 'back', 0);
        R.text(ctx, 'YOU', 112, 288, 26, { align: 'center', outline: false });
        R.spaceButton(ctx, 290, 494, sp.f);
      },
    };
  }

  // ---------- tournament: player select ----------
  function Select() {
    let over = -1;
    const pos = (n) => [n < 8 ? 122 : 352, 115 + (n % 8) * 30];
    return {
      tick() {
        over = -1;
        for (let n = 0; n < 16; n++) { const [x, y] = pos(n); if (inRect(mx, my, [x - 4, y - 20, 140, 26])) over = n; }
      },
      onClick() {
        if (over < 0) return;
        A.play('click');
        // tdat_shuffle: chosen player to slot 0, others shuffled.
        const t = data.tdat;
        if (over > 0) { const tmp = t[over]; t[over] = t[0]; t[0] = tmp; }
        for (let i = 1; i < 16; i++) { const r = 1 + Math.floor(Math.random() * 15); const tmp = t[i]; t[i] = t[r]; t[r] = tmp; }
        go(Bracket());
      },
      draw() {
        R.drawScene(ctx); R.panel(ctx);
        R.text(ctx, 'Select your player', 300, 70, 30, { align: 'center', outline: false });
        for (let n = 0; n < 16; n++) {
          const [x, y] = pos(n);
          R.text(ctx, tname(data.tdat[n]), x, y, 19, { outline: false, color: n === over ? '#ffd23a' : '#fff' });
        }
        if (over >= 0) {
          const d = digits(data.tdat[over]);
          for (let j = 0; j < 4; j++) { R.text(ctx, STATS[j], 132, 422 + j * 30, 18, { outline: false }); R.bar(ctx, 233, 405 + j * 30, d[j]); }
        }
      },
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
  function drawMatch(g, flip, prev, alpha, meIdx) {
    R.drawGame(ctx, g, flip, prev, alpha);
    R.text(ctx, g.score_txt, 8, 590, 18);
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
    let prev = null;
    go({
      tick() {
        prev = snapPos(G);
        L.step(G, [readPad(), null]);
        for (const e of G.events) A.play(e);
        if (G.over) afterMatch(G);
      },
      draw(alpha) { drawMatch(G, false, prev, alpha, 0); },
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

  // ---------- network lobby ----------
  function Lobby() {
    let mode = null, info = null, status = '', ws = null;
    const BTN_HOST = [170, 150, 250, 40], BTN_JOIN = [170, 240, 250, 40], BTN_GO = [230, 375, 130, 36], BTN_BACK = [230, 520, 130, 32];
    fetch('/info').then((r) => r.json()).then((j) => { info = j; }).catch(() => {});
    try { addr.value = localStorage.getItem('tennis.addr') || ''; } catch (e) { /* storage unavailable */ }
    function cleanup() { if (ws) { ws.onclose = null; ws.close(); ws = null; } }
    function host() {
      mode = 'host'; status = 'Connexion au serveur local...'; addr.style.display = 'none';
      ws = new WebSocket(N.wsUrl(location.host, 'host'));
      const h = new N.HostSession(ws);
      ws.onopen = () => { status = "En attente de l'adversaire..."; };
      ws.onclose = () => { status = 'Serveur local injoignable.'; };
      const check = setInterval(() => {
        if (scene !== self) return clearInterval(check);
        if (h.peerOn) { clearInterval(check); startNet(h, ws, true); }
      }, 100);
    }
    function join() {
      let a = addr.value.trim().replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!a) { status = "Entrez l'adresse IP de l'hôte."; return; }
      if (!/:\d+$/.test(a)) a += ':8000';
      try { localStorage.setItem('tennis.addr', addr.value.trim()); } catch (e) { /* ignore */ }
      cleanup();
      status = 'Connexion à ' + a + '...';
      ws = new WebSocket(N.wsUrl(a, 'client'));
      const c = new N.ClientSession(ws);
      ws.onerror = () => { status = 'Impossible de joindre ' + a + ' (IP, port, pare-feu ?)'; };
      const check = setInterval(() => {
        if (scene !== self || !ws) return clearInterval(check);
        if (ws.readyState === 1 && !c.hostOn) status = "Connecté au serveur, en attente de l'hôte...";
        if (c.latest) { clearInterval(check); addr.style.display = 'none'; startNet(c, ws, false); }
      }, 100);
    }
    const self = {
      draw() {
        R.drawScene(ctx); R.panel(ctx);
        R.text(ctx, '2 PLAYERS', 300, 80, 34, { align: 'center', outline: false });
        const btn = (r, s) => {
          const hot = inRect(mx, my, r);
          ctx.fillStyle = hot ? '#ffd23a' : '#f2f2f2'; R.roundRect(ctx, r[0], r[1], r[2], r[3], 8); ctx.fill();
          R.text(ctx, s, r[0] + r[2] / 2, r[1] + r[3] / 2 + 7, 20, { align: 'center', outline: false, color: '#222' });
        };
        btn(BTN_HOST, 'HÉBERGER'); btn(BTN_JOIN, 'REJOINDRE');
        if (mode === 'host') {
          R.text(ctx, "Donnez à l'autre joueur :", 300, 325, 17, { align: 'center', outline: false });
          const ips = info ? info.ips.map((ip) => ip + ':' + info.port) : ['...'];
          ips.slice(0, 3).forEach((s, i) => R.text(ctx, s, 300, 360 + i * 30, 24, { align: 'center', outline: false, color: '#ffd23a' }));
        }
        if (mode === 'join') {
          R.text(ctx, "Adresse de l'hôte (IP:port) :", 300, 318, 16, { align: 'center', outline: false });
          btn(BTN_GO, 'OK');
        }
        R.text(ctx, status, 300, 470, 16, { align: 'center', outline: false, color: '#9ad0ff' });
        R.text(ctx, 'Hôte = joueur du bas (P1), invité = joueur du haut (P2)', 300, 125, 14, { align: 'center', outline: false, color: '#ccc' });
        btn(BTN_BACK, 'RETOUR');
      },
      tick() {},
      onClick(x, y) {
        if (inRect(x, y, BTN_BACK)) { cleanup(); return go(Title); }
        if (inRect(x, y, BTN_HOST) && mode !== 'host') { cleanup(); host(); }
        if (inRect(x, y, BTN_JOIN)) { cleanup(); mode = 'join'; status = ''; addr.style.display = 'block'; positionAddr(); addr.focus(); }
        if (mode === 'join' && inRect(x, y, BTN_GO)) join();
      },
      onKey(k) { if (k === 'Enter' && mode === 'join') join(); if (k === 'Escape') { cleanup(); go(Title); } },
    };
    return self;
  }

  // ---------- network match ----------
  function startNet(sess, ws, isHost) {
    let prev = null, closed = false;
    ws.onclose = () => { closed = true; };
    if (!isHost) sess.onEvents = (ev) => ev.forEach((e) => A.play(e));
    const leave = () => { ws.onclose = null; ws.close(); go(Title); };
    go({
      tick() {
        if (isHost) {
          prev = sess.paused ? prev : snapPos(sess.G);
          const ev = sess.tick(readPad());
          ev.forEach((e) => A.play(e));
        } else sess.tick(readPad());
      },
      draw(alpha) {
        const g = isHost ? sess.G : sess.view();
        if (!g) return;
        drawMatch(g, !isHost, isHost ? prev : null, alpha, isHost ? 0 : 1);
        const rtt = sess.rtt;
        R.text(ctx, (isHost ? 'HÔTE (P1)' : 'INVITÉ (P2)') + (rtt != null ? '  ping ' + Math.round(rtt) + ' ms' : ''), 8, 20, 14);
        let msg = null;
        if (closed) msg = isHost ? 'Serveur local arrêté' : "Connexion à l'hôte perdue";
        else if (isHost && sess.paused) msg = 'Adversaire déconnecté - pause';
        else if (!isHost && (sess.lost || sess.paused)) msg = sess.paused ? 'Pause - en attente...' : 'Hôte injoignable - pause';
        if (msg) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 270, 600, 70);
          R.text(ctx, msg, 300, 302, 24, { align: 'center' });
          R.text(ctx, 'Échap : menu', 300, 328, 15, { align: 'center' });
        }
        if (g.over) R.text(ctx, 'Espace : revanche   -   Échap : menu', 300, 380, 18, { align: 'center' });
      },
      onClick(x, y) { if (inRect(x, y, QUIT)) leave(); },
      onKey(k) { if (k === 'Escape') leave(); },
    });
  }

  // ---------- fixed-step loop, decoupled render ----------
  let last = performance.now(), acc = 0;
  function frame(t) {
    acc += Math.min(250, t - last); last = t;
    while (acc >= TICK) { scene.tick(); acc -= TICK; }
    ctx.clearRect(0, 0, 600, 600);
    scene.draw(acc / TICK);
    requestAnimationFrame(frame);
  }
  resize();
  go(Title);
  requestAnimationFrame(frame);
})();
