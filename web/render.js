// Canvas drawing: court, players, ball, menu scenery. All art is procedural (no original assets).
(function (root) {
  'use strict';
  const L = root.TennisLogic, C = L.C;
  const FONT = '"Arial Rounded MT Bold","Trebuchet MS","Segoe UI",Verdana,sans-serif';
  const GRASS = '#6cac00', GRASS_DARK = '#61990a';

  function P(vx, vy, vh) { return L.project(vx, vy, vh); }

  // ---------- text ----------
  function text(ctx, s, x, y, size, opts) {
    opts = opts || {};
    ctx.font = (opts.weight || 'bold') + ' ' + size + 'px ' + FONT;
    ctx.textAlign = opts.align || 'left';
    ctx.textBaseline = opts.base || 'alphabetic';
    if (opts.outline !== false) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = opts.outlineW || Math.max(3, size / 6);
      ctx.strokeStyle = opts.outline || '#000';
      ctx.strokeText(s, x, y);
    }
    ctx.fillStyle = opts.color || '#fff';
    ctx.fillText(s, x, y);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------- court (cached) ----------
  let courtCache = null;
  function courtCanvas() {
    if (courtCache) return courtCache;
    const c = document.createElement('canvas'); c.width = 600; c.height = 600;
    const g = c.getContext('2d');
    g.fillStyle = GRASS; g.fillRect(0, 0, 600, 600);
    // mown stripes converging towards a far vanishing point
    const vpx = 300, vpy = -2600;
    for (let i = -14; i <= 14; i += 2) {
      const x0 = 300 + i * 46, x1 = 300 + (i + 1) * 46;
      const grad = g.createLinearGradient(x0 - 40, 0, x1 + 40, 0);
      grad.addColorStop(0, 'rgba(80,130,0,0)'); grad.addColorStop(0.5, 'rgba(80,130,0,0.35)'); grad.addColorStop(1, 'rgba(80,130,0,0)');
      g.fillStyle = grad;
      g.beginPath(); g.moveTo(vpx + (x0 - vpx) * 0.1, vpy); g.lineTo(x0 - 30, 600); g.lineTo(x1 + 30, 600); g.lineTo(vpx + (x1 - vpx) * 0.1, vpy); g.fill();
    }
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.lineCap = 'square';
    const line = (x1, y1, x2, y2) => { const a = P(x1, y1), b = P(x2, y2); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); };
    const W = C.COURT_W, H = C.COURT_H, D = 230, S = C.SERVE_H;
    line(-D, -H, D, -H); line(-D, H, D, H);
    line(-D, -H, -D, H); line(D, -H, D, H);
    line(-W, -H, -W, H); line(W, -H, W, H);
    line(-W, -S, W, -S); line(-W, S, W, S);
    line(0, -S, 0, S);
    line(0, -H, 0, -H + 18); line(0, H, 0, H - 18);
    courtCache = c;
    return c;
  }

  function drawNet(ctx) {
    const y0 = C.SCREEN_OY, top = y0 - C.NET_H, xl = 103, xr = 497;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(xl, top + 3, xr - xl, C.NET_H - 3);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.5;   // sagging bottom cord
    ctx.beginPath(); ctx.moveTo(xl + 8, y0 - 2); ctx.quadraticCurveTo(300, y0 - 10, xr - 8, y0 - 2); ctx.stroke();
    ctx.fillStyle = '#7f7f7f'; ctx.fillRect(299, top + 3, 2, C.NET_H - 3);
    ctx.fillStyle = '#fff'; ctx.fillRect(xl, top, xr - xl, 4);
    ctx.fillStyle = '#ccc'; ctx.fillRect(xl, top + 4, xr - xl, 1);
    for (const x of [xl - 3, xr - 1]) {
      ctx.fillStyle = '#c6b706'; ctx.fillRect(x, top - 4, 4, C.NET_H + 4);
      ctx.fillStyle = '#344501'; ctx.fillRect(x, top - 4, 1, C.NET_H + 4);
    }
  }

  // ---------- players ----------
  // Pose for a right-handed player seen from behind; front view is the mirror image.
  function pose(anim, af) {
    const p = { lean: 0, footL: -7, footR: 7, step: 0, hand: [9, -50], rack: -95, off: [-9, -50], bob: 0, head: 0, crouch: 0 };
    const lerp = (a, b, t) => a + (b - a) * t;
    const swing = (keys, t) => {           // keys: [[t, angle, hx, hy], ...]
      for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) {
        const a = keys[i - 1], b = keys[i], u = (t - a[0]) / (b[0] - a[0]);
        p.rack = lerp(a[1], b[1], u); p.hand = [lerp(a[2], b[2], u), lerp(a[3], b[3], u)]; return;
      }
      const k = keys[keys.length - 1]; p.rack = k[1]; p.hand = [k[2], k[3]];
    };
    switch (anim) {
      case 'left': case 'right': {
        const ph = (af - 1) / 13 * Math.PI * 2, d = anim === 'left' ? -1 : 1;
        p.step = Math.sin(ph) * 7; p.bob = Math.abs(Math.sin(ph)) * 3; p.lean = d * 6; p.crouch = 3;
        p.hand = [10 + d * 2, -48]; p.rack = -70 + d * 15;
        break;
      }
      case 'fore':
        p.crouch = 4; p.footL = -10; p.footR = 10;
        swing([[0, 20, 16, -46], [0.15, 10, 18, -44], [0.3, -150, -10, -58], [0.55, -175, -14, -66], [1, -95, 9, -50]], (af - 1) / 20);
        p.lean = p.hand[0] * 0.25;
        break;
      case 'back':
        p.crouch = 4; p.footL = -10; p.footR = 10;
        swing([[0, 170, -16, -46], [0.15, 175, -18, -44], [0.3, -20, 12, -58], [0.55, -5, 14, -66], [1, -95, 9, -50]], (af - 1) / 20);
        p.off = [p.hand[0] - 4, p.hand[1] + 2]; p.lean = p.hand[0] * 0.25;
        break;
      case 'smash':
        swing([[0, -40, 12, -84], [0.2, 0, 10, -90], [0.4, 120, -6, -70], [0.7, 150, -10, -44], [1, 265, 9, -50]], (af - 1) / 16);
        p.off = [-8, -72];
        break;
      case 'serve':
        p.footL = -10; p.footR = 6; p.hand = [14, -42]; p.rack = 70; p.off = [-12, -46];
        break;
      case 'toss': {
        const t = Math.min(af, 8) / 8;
        p.footL = -10; p.footR = 6; p.off = [-8, lerp(-46, -92, t)];
        p.hand = [lerp(14, 12, t), lerp(-42, -78, t)]; p.rack = lerp(70, -30, t);
        break;
      }
      case 'win': p.hand = [12, -86]; p.rack = -80; p.off = [-12, -86]; break;
      case 'lose': p.hand = [10, -40]; p.rack = 95; p.off = [-10, -40]; p.head = 4; p.crouch = 3; break;
    }
    return p;
  }

  const SKIN = '#f3c9a0', HAIR = ['#6b3d17', '#c99a3a'], OUTLINE = 'rgba(60,60,80,0.6)';
  function limb(g, x1, y1, x2, y2, w, col) {
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  }

  // Drawn at native size (~98 px tall), origin at the feet. facing 'back' (near) or 'front' (far).
  function drawPlayer(ctx, x, y, scale, anim, af, facing, hairIdx) {
    const p = pose(anim, af);
    ctx.save();
    ctx.translate(x, y); ctx.scale(scale * (facing === 'front' ? -1 : 1), scale);
    const hipY = -40 + p.crouch - p.bob, sh = -64 + p.crouch - p.bob, lean = p.lean;
    const hx = lean * 0.4;
    // legs + shoes
    const fl = p.footL - p.step, fr = p.footR + p.step;
    limb(ctx, hx - 4, hipY, fl, -4, 6, SKIN); limb(ctx, hx + 4, hipY, fr, -4, 6, SKIN);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1;
    for (const f of [fl, fr]) { ctx.beginPath(); ctx.ellipse(f, -2, 5, 3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    const back = facing === 'back';
    const racket = () => {
      const hx2 = p.hand[0] + lean * 0.6, hy2 = p.hand[1] - p.bob;
      const a = p.rack * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      limb(ctx, hx2, hy2, hx2 + ca * 14, hy2 + sa * 14, 3, '#333');
      ctx.save(); ctx.translate(hx2 + ca * 26, hy2 + sa * 26); ctx.rotate(a);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.strokeStyle = '#2b3bd0'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(0, 0, 12, 8.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    };
    const arms = () => {
      const sx = lean * 0.7;
      limb(ctx, sx + 9, sh + 3, p.hand[0] + lean * 0.6, p.hand[1] - p.bob, 4.5, SKIN);
      limb(ctx, sx - 9, sh + 3, p.off[0] + lean * 0.6, p.off[1] - p.bob, 4.5, SKIN);
    };
    if (back) { racket(); arms(); }
    // skirt + shirt
    ctx.fillStyle = '#fff'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(hx - 8, hipY - 6); ctx.lineTo(hx + 8, hipY - 6); ctx.lineTo(hx + 13, hipY + 6); ctx.lineTo(hx - 13, hipY + 6); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lean * 0.7 - 10, sh); ctx.lineTo(lean * 0.7 + 10, sh); ctx.lineTo(hx + 8, hipY - 4); ctx.lineTo(hx - 8, hipY - 4); ctx.closePath(); ctx.fill(); ctx.stroke();
    // head
    const hdx = lean * 0.8, hdy = sh - 9 + p.head;
    ctx.fillStyle = SKIN; ctx.beginPath(); ctx.arc(hdx, hdy, 7.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = HAIR[hairIdx || 0];
    if (back) { ctx.beginPath(); ctx.arc(hdx, hdy - 0.5, 8, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(hdx, hdy + 6, 3.5, 0, Math.PI * 2); ctx.fill(); }
    else {
      ctx.beginPath(); ctx.arc(hdx, hdy - 2, 8, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#333'; ctx.fillRect(hdx - 3.5, hdy, 1.6, 1.6); ctx.fillRect(hdx + 2, hdy, 1.6, 1.6);
    }
    if (!back) { arms(); racket(); }
    ctx.restore();
  }

  function shadow(ctx, x, y, rx, ry) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  }

  // ---------- game frame ----------
  // g: game state; flip: draw from player 2's side (network guest).
  function drawGame(ctx, g, flip, prev, alpha) {
    const s = flip ? -1 : 1;
    const lerp = (a, b) => (prev && alpha < 1 ? b + (a - b) * (1 - alpha) : b);
    ctx.drawImage(courtCanvas(), 0, 0);
    const pl = [0, 1].map((i) => {
      const mc = g.P[i], pm = prev && prev.P[i];
      const vx = pm ? lerp(pm.vx, mc.vx) : mc.vx, vy = pm ? lerp(pm.vy, mc.vy) : mc.vy;
      return { mc, q: P(vx * s, vy * s) };
    });
    const near = flip ? 1 : 0, far = 1 - near;
    for (const i of [far, near]) shadow(ctx, pl[i].q.x, pl[i].q.y, 33 * 0.6 * pl[i].q.per, 10 * 0.6 * pl[i].q.per);
    const drawPl = (i, facing) => drawPlayer(ctx, pl[i].q.x, pl[i].q.y, 0.6 * pl[i].q.per, pl[i].mc.anim, pl[i].mc.af, facing, i);
    drawPl(far, 'front');
    drawNet(ctx);
    if (g.bound.alpha > 0) {
      const q = P(g.bound.vx * s, g.bound.vy * s);
      ctx.strokeStyle = 'rgba(255,255,255,' + g.bound.alpha / 100 * 0.8 + ')'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(q.x, q.y, 6 * q.per, 2.5 * q.per, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (g.B.visible) {
      const B = g.B, pb = prev && prev.B;
      const ok = pb && pb.visible && Math.abs(pb.vy - B.vy) < 80;
      const vx = ok ? lerp(pb.vx, B.vx) : B.vx, vy = ok ? lerp(pb.vy, B.vy) : B.vy, vh = ok ? lerp(pb.vh, B.vh) : B.vh;
      const qs = P(vx * s, vy * s), qb = P(vx * s, vy * s, vh);
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(qs.x, qs.y, 3.5 * qs.per, 2 * qs.per, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe600'; ctx.strokeStyle = '#8a7a00'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(qb.x, qb.y, 3.3 * qb.per, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    drawPl(near, 'back');
  }

  // ---------- menu scenery (title / stats / bracket backgrounds) ----------
  let sceneCache = null;
  function sceneCanvas() {
    if (sceneCache) return sceneCache;
    const c = document.createElement('canvas'); c.width = 600; c.height = 600;
    const g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 250, 420);
    sky.addColorStop(0, '#1ee8e0'); sky.addColorStop(0.45, '#2a8de0'); sky.addColorStop(1, '#2b3fd6');
    g.fillStyle = sky; g.fillRect(0, 0, 600, 420);
    g.fillStyle = '#fff';
    const cloud = (pts) => { g.beginPath(); for (const [x, y, r] of pts) { g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); } g.fill(); };
    cloud([[-10, 120, 40], [20, 170, 50], [60, 220, 50], [10, 240, 50], [110, 260, 40], [150, 300, 40]]);
    cloud([[610, 80, 30], [590, 150, 55], [560, 210, 50], [600, 250, 60], [480, 280, 45], [420, 310, 35], [530, 300, 40]]);
    // stadium walls
    g.fillStyle = '#0b0b0b';
    g.beginPath(); g.moveTo(0, 230); g.lineTo(160, 325); g.lineTo(440, 325); g.lineTo(600, 230); g.lineTo(600, 420); g.lineTo(0, 420); g.fill();
    g.fillStyle = '#123f3a'; g.fillRect(0, 410, 600, 30);
    // grass in perspective
    const gr = g.createLinearGradient(0, 425, 0, 600);
    gr.addColorStop(0, '#5e9a10'); gr.addColorStop(1, '#a8e010');
    g.fillStyle = gr; g.fillRect(0, 425, 600, 175);
    for (let i = -10; i <= 10; i += 2) {
      g.fillStyle = 'rgba(190,240,40,0.35)';
      g.beginPath(); g.moveTo(300 + i * 30, 425); g.lineTo(300 + (i + 1) * 30, 425); g.lineTo(300 + (i + 1) * 130, 600); g.lineTo(300 + i * 130, 600); g.fill();
    }
    g.strokeStyle = '#fff'; g.lineWidth = 2;
    const ln = (a, b, c2, d) => { g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d); g.stroke(); };
    ln(170, 432, 600, 432 + 0); ln(150, 445, 450, 445); ln(-40, 520, 640, 520);
    ln(300, 445, 300, 600); ln(150, 445, -60, 600); ln(450, 445, 660, 600);
    // net
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(15, 455, 570, 45);
    g.fillStyle = '#ddd'; g.fillRect(15, 453, 570, 5);
    g.fillStyle = '#c6b706'; g.fillRect(12, 448, 7, 55); g.fillRect(578, 448, 7, 55);
    sceneCache = c;
    return c;
  }

  function drawScene(ctx) { ctx.drawImage(sceneCanvas(), 0, 0); }

  function panel(ctx) {
    ctx.fillStyle = 'rgba(8,22,48,0.72)';
    roundRect(ctx, 20, 20, 560, 560, 12); ctx.fill();
  }

  // Stat bar (sprite "mcNum"): value 0..9 shown as value+1, 200 px wide.
  function bar(ctx, x, y, num) {
    ctx.fillStyle = '#1a1030'; ctx.fillRect(x, y, 206, 22);
    ctx.strokeStyle = '#4b5a12'; ctx.lineWidth = 2; ctx.strokeRect(x, y, 206, 22);
    const gr = ctx.createLinearGradient(0, y + 3, 0, y + 19);
    gr.addColorStop(0, '#ffe23a'); gr.addColorStop(1, '#ff8a00');
    ctx.fillStyle = gr; ctx.fillRect(x + 3, y + 3, (num + 1) * 20, 16);
    text(ctx, String(num + 1), x + 214, y + 17, 16, { outline: false });
  }

  function spaceButton(ctx, x, y, f) {
    const lit = f >= 2 && f < 7;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; roundRect(ctx, x - 66, y - 12, 140, 30, 8); ctx.fill();
    ctx.fillStyle = lit ? '#ffd23a' : '#f2f2f2'; roundRect(ctx, x - 70, y - 16, 140, 30, 8); ctx.fill();
    text(ctx, 'Space bar', x, y + 5, 16, { outline: false, color: '#333', align: 'center' });
  }

  root.TennisRender = { drawGame, drawScene, drawPlayer, panel, bar, text, roundRect, spaceButton, FONT };
})(typeof self !== 'undefined' ? self : this);
