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
  // Low-poly, cel-shaded figure modelled on the original sprites (drawn by hand, not copied).
  // Native size ~98 px, origin at the feet. Poses are for a right-handed player; the far
  // player (facing 'front') is drawn mirrored.
  const COL = {
    skin: '#e9b45a', skinD: '#c08a34', skinL: '#f8dc98',
    cloth: '#f7f7ef', clothD: '#c3c4d4', hair: ['#9a6a24', '#c8963a'], hairD: '#4a2c0c', hairL: '#efcf7c',
    frame: '#5a66dc', frameD: '#232867', grip: '#141414', shoeD: '#8c90a8', visor: '#ffffff', lens: '#1c1c2a',
  };
  const lerp = (a, b, t) => a + (b - a) * t;

  // key: [t, hx, hy, rack, face, len, ox, oy]; returns pose fields interpolated at t.
  function keyed(p, keys, t) {
    let a = keys[0], b = keys[0], u = 0;
    for (let i = 1; i < keys.length; i++) { if (t <= keys[i][0]) { a = keys[i - 1]; b = keys[i]; u = (t - a[0]) / (b[0] - a[0]); break; } a = b = keys[i]; }
    p.hand = [lerp(a[1], b[1], u), lerp(a[2], b[2], u)]; p.rack = lerp(a[3], b[3], u);
    p.face = lerp(a[4], b[4], u); p.len = lerp(a[5], b[5], u);
    if (a.length > 6) p.off = [lerp(a[6], b[6], u), lerp(a[7], b[7], u)];
  }

  function pose(anim, af, facing) {
    const front = facing === 'front';
    const p = { crouch: 0, lean: 0, feet: [[-2, 0], [3, -4.5]], hand: [1, -58], off: [0, -56], rack: -89, face: 0.16, len: 0.66, over: false, head: 0, step: 0, hideArms: !front };
    if (front) Object.assign(p, { crouch: 12, feet: [[-6, 0], [6, 0]], hand: [2, -34], off: [-3, -40], rack: 92, face: 0.38, len: 0.72 });
    const t = (n) => (af - 1) / n;
    switch (anim) {
      case 'left': case 'right': {
        const ph = (af - 1) / 13 * Math.PI * 2, d = anim === 'left' ? -1 : 1;
        p.step = Math.sin(ph); p.crouch += 1 + Math.abs(Math.sin(ph)) * 1.5; p.lean = d * 2;
        break;
      }
      case 'fore':
        p.crouch = 4; p.feet = [[-5, 0], [5, -1]];
        keyed(p, [[0, 17, -50, 15, 0.95, 1, -8, -52], [0.15, 13, -53, -25, 1, 1, -9, -54], [0.3, -9, -64, 182, 0.14, 1, -12, -60],
          [0.6, -11, -65, 186, 0.14, 1, -12, -60], [1, p.hand[0], p.hand[1], p.rack + 360, p.face, p.len, p.off[0], p.off[1]]], t(20));
        p.over = t(20) > 0.22 && t(20) < 0.8; p.lean = p.hand[0] * 0.2;
        break;
      case 'back':
        p.crouch = 4; p.feet = [[-5, 0], [5, -1]];
        keyed(p, [[0, -17, -50, 165, 0.95, 1, -13, -50], [0.15, -13, -53, 205, 1, 1, -10, -53], [0.3, 9, -64, -2, 0.14, 1, 5, -62],
          [0.6, 11, -65, -6, 0.14, 1, 6, -62], [1, p.hand[0], p.hand[1], p.rack, p.face, p.len, p.off[0], p.off[1]]], t(20));
        p.over = t(20) > 0.22 && t(20) < 0.8; p.lean = p.hand[0] * 0.2;
        break;
      case 'smash':
        keyed(p, [[0, 9, -86, -60, 0.6, 1, -9, -84], [0.2, 10, -92, -20, 0.9, 1, -8, -80], [0.45, -6, -66, 140, 0.5, 1, -10, -58],
          [0.7, -10, -48, 160, 0.3, 1, -10, -50], [1, p.hand[0], p.hand[1], p.rack + 360, p.face, p.len, p.off[0], p.off[1]]], t(16));
        p.over = t(16) > 0.35 && t(16) < 0.85;
        break;
      case 'serve':
        Object.assign(p, { crouch: 11, lean: 6, feet: [[-4, 0], [4, -3]], hand: [17, -38], off: [12, -41], rack: 8, face: 0.95, len: 1, over: true });
        break;
      case 'toss': {
        const u = Math.min(af, 8) / 8;
        Object.assign(p, { crouch: lerp(6, 1, u), feet: [[-4, 0], [4, -3]], hand: [lerp(13, 11, u), lerp(-46, -44, u)], off: [lerp(8, -3, u), lerp(-49, -102, u)],
          rack: lerp(12, 38, u), face: 0.9, len: 1, over: true });
        break;
      }
      case 'win': Object.assign(p, { crouch: 0, feet: [[-3.5, 0], [3.5, 0]], hand: [11, -90], off: [-11, -88], rack: -80, face: 0.45, len: 1, over: false }); break;
      case 'lose': Object.assign(p, { crouch: 3, feet: [[-3, 0], [3.5, 0]], hand: [9, -40], off: [-8, -42], rack: 96, face: 0.35, len: 0.9, head: 4, over: true }); break;
    }
    if (anim !== 'wait' && anim !== 'left' && anim !== 'right') p.hideArms = false;
    if (front) p.over = !p.over;
    return p;
  }

  function poly(g, pts, col) { g.fillStyle = col; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); }

  // Tapered limb, shaded on its +x side (light from the upper left).
  function seg(g, x1, y1, x2, y2, w1, w2, base, dark) {
    const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
    const sgn = nx >= 0 ? 1 : -1;
    const P1 = [x1 + nx * w1 / 2, y1 + ny * w1 / 2], P2 = [x2 + nx * w2 / 2, y2 + ny * w2 / 2];
    const M1 = [x1 - nx * w1 / 2, y1 - ny * w1 / 2], M2 = [x2 - nx * w2 / 2, y2 - ny * w2 / 2];
    poly(g, [P1, P2, M2, M1], base);
    const S1 = sgn > 0 ? P1 : M1, S2 = sgn > 0 ? P2 : M2;
    poly(g, [S1, S2, [lerp(S2[0], x2, 0.3), lerp(S2[1], y2, 0.3)], [lerp(S1[0], x1, 0.3), lerp(S1[1], y1, 0.3)]], dark);
    g.beginPath(); g.arc(x2, y2, w2 / 2, 0, Math.PI * 2); g.fillStyle = base; g.fill();
  }

  // Two-bone IK: joint between a and c. pick(j1, j2) chooses between the two solutions.
  function joint(ax, ay, cx, cy, l1, l2, pick) {
    const dx = cx - ax, dy = cy - ay, D = Math.hypot(dx, dy) || 0.01, d = Math.min(D, l1 + l2 - 0.01);
    const k = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - k * k));
    const ux = dx / D, uy = dy / D;
    return pick([ax + ux * k - uy * h, ay + uy * k + ux * h], [ax + ux * k + uy * h, ay + uy * k - ux * h]);
  }
  const lower = (a, b) => (a[1] > b[1] ? a : b);

  function racket(g, hx, hy, angDeg, face, len) {
    const a = angDeg * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
    const L = len, A = 20 * L, B = 14.5 * Math.max(0.1, face);
    const sx = hx + ux * 15 * L, sy = hy + uy * 15 * L;          // end of the shaft
    const cx = hx + ux * (15 * L + A * 0.55 + 6 * L), cy = hy + uy * (15 * L + A * 0.55 + 6 * L);
    g.lineCap = 'round';
    g.strokeStyle = COL.grip; g.lineWidth = 3.4;
    g.beginPath(); g.moveTo(hx - ux * 3, hy - uy * 3); g.lineTo(hx + ux * 8 * L, hy + uy * 8 * L); g.stroke();
    // throat (open V)
    const tx = cx - ux * A * 0.86, ty = cy - uy * A * 0.86;
    for (const sd of [1, -1]) {
      g.strokeStyle = COL.frameD; g.lineWidth = 3;
      g.beginPath(); g.moveTo(hx + ux * 8 * L, hy + uy * 8 * L); g.lineTo(sx, sy); g.lineTo(tx + vx * B * 0.5 * sd, ty + vy * B * 0.5 * sd); g.stroke();
      g.strokeStyle = COL.frame; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(tx + vx * B * 0.5 * sd, ty + vy * B * 0.5 * sd); g.stroke();
    }
    // hollow head: dark rim then lighter rim nudged to the upper left
    g.save(); g.translate(cx, cy); g.rotate(a);
    g.strokeStyle = COL.frameD; g.lineWidth = 5.6;
    g.beginPath(); g.ellipse(0, 0, A, B, 0, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = COL.frame; g.lineWidth = 3;
    g.beginPath(); g.ellipse(-0.6, -0.6, A - 0.6, Math.max(0.6, B - 0.6), 0, 0, Math.PI * 2); g.stroke();
    g.restore();
  }

  // look: { cloth, hair } cosmetic ids (cosmetics.js); defaults to the original colors of side hairIdx.
  function drawPlayer(ctx, x, y, scale, anim, af, facing, hairIdx, look) {
    const p = pose(anim, af, facing), back = facing === 'back';
    const CO = root.TennisCosmetics, lk = CO.sanitize(look, hairIdx || 0);
    const clothIt = CO.find('cloth', lk.cloth), cloth = clothIt.color, clothD = clothIt.shade;
    const g = ctx;
    g.save();
    g.translate(x, y); g.scale(1.2 * scale * (back ? 1 : -1), 1.2 * scale);
    const c = p.crouch, hipY = -38 + c, waistY = hipY - 9, sh = -63 + c * 1.1, hx = p.lean * 0.4, sx = p.lean;
    const hdx = sx * 1.1, hdy = sh - 10 + p.head;

    const drawRacketArm = () => {
      const S = [sx + 8.5, sh + 2], H = p.hand, E = joint(S[0], S[1], H[0], H[1], 13, 13, lower);
      racket(g, H[0], H[1], p.rack, p.face, p.len);
      if (p.hideArms) return;  // held in front of the chest, hidden by the body (back view)
      seg(g, S[0], S[1], E[0], E[1], 6, 5, COL.skin, COL.skinD);
      seg(g, E[0], E[1], H[0], H[1], 5, 4.2, COL.skin, COL.skinD);
      seg(g, S[0], S[1], lerp(S[0], E[0], 0.3), lerp(S[1], E[1], 0.3), 6.5, 6, cloth, clothD);
    };
    const drawOffArm = () => {
      if (p.hideArms) return;
      const S = [sx - 8.5, sh + 2], H = p.off, E = joint(S[0], S[1], H[0], H[1], 13, 13, lower);
      seg(g, S[0], S[1], E[0], E[1], 6, 5, COL.skin, COL.skinD);
      seg(g, E[0], E[1], H[0], H[1], 5, 4.2, COL.skin, COL.skinD);
      seg(g, S[0], S[1], lerp(S[0], E[0], 0.3), lerp(S[1], E[1], 0.3), 6.5, 6, cloth, clothD);
    };

    // legs: knees bend towards the camera, so a crouch mostly shortens the projected leg
    p.feet.forEach(([fx, fy], i) => {
      const sd = i ? 1 : -1, lift = Math.max(0, (i ? -1 : 1) * p.step) * 6;
      const f = [fx + p.step * sd * 1.5, fy - lift];
      const Hp = [hx + sd * 3.5, hipY];
      const K = [lerp(Hp[0], f[0], 0.5) + sd * (0.5 + c * 0.35), lerp(Hp[1], f[1] - 3, 0.5) - lift * 0.3];
      seg(g, Hp[0], Hp[1], K[0], K[1], 8, 6.2, COL.skin, COL.skinD);
      seg(g, K[0], K[1], f[0], f[1] - 3, 6.2, 4.4, COL.skin, COL.skinD);
      poly(g, [[f[0] - 3.8, f[1] - 4], [f[0] + 3.8, f[1] - 4.5], [f[0] + 4.2, f[1] + 0.5], [f[0] - 3.5, f[1] + 1]], cloth);
      poly(g, [[f[0] - 3.5, f[1] - 0.6], [f[0] + 4.2, f[1] - 0.8], [f[0] + 4.2, f[1] + 0.5], [f[0] - 3.5, f[1] + 1]], COL.shoeD);
    });

    if (!p.over) drawRacketArm();
    if (back) drawOffArm();
    // dress: bodice + flared skirt, shaded on the right and along the hem
    poly(g, [[sx - 8.5, sh], [sx + 8.5, sh], [hx + 6.5, waistY], [hx - 6.5, waistY]], cloth);
    poly(g, [[sx + 3, sh], [sx + 8.5, sh], [hx + 6.5, waistY], [hx + 2.5, waistY]], clothD);
    poly(g, [[hx - 7.5, waistY - 1], [hx + 7.5, waistY - 1], [hx + 11.5, hipY + 6], [hx - 11.5, hipY + 6]], cloth);
    poly(g, [[hx + 3, waistY - 1], [hx + 7.5, waistY - 1], [hx + 11.5, hipY + 6], [hx + 5.5, hipY + 6]], clothD);
    poly(g, [[hx - 11, hipY + 4], [hx + 11, hipY + 4], [hx + 11.5, hipY + 6], [hx - 11.5, hipY + 6]], clothD);
    if (!back) drawOffArm();

    // neck + head (octagon), hair; front view adds the white visor and dark glasses
    seg(g, hdx * 0.9, sh + 1, hdx, hdy + 5, 4.5, 4.5, COL.skin, COL.skinD);
    const oct = (r, ox, oy) => Array.from({ length: 8 }, (_, i) => [hdx + ox + r * Math.cos((i + 0.5) * Math.PI / 4), hdy + oy + r * Math.sin((i + 0.5) * Math.PI / 4)]);
    poly(g, oct(7.6, 0, 0), COL.skin);
    const hair = CO.find('hair', lk.hair).color;
    if (back) {
      poly(g, oct(8, 0, -0.5), hair);
      poly(g, [[hdx - 6, hdy - 5], [hdx - 1, hdy - 8], [hdx + 1, hdy - 3], [hdx - 4, hdy]], COL.hairL);
      poly(g, [[hdx - 7, hdy + 2], [hdx + 7, hdy + 2], [hdx + 4, hdy + 7.5], [hdx - 4, hdy + 7.5]], COL.hairD);
      poly(g, oct(3, 2.5, 6.5), hair);
    } else {
      poly(g, [[hdx + 3, hdy - 3], [hdx + 7.5, hdy - 2], [hdx + 7, hdy + 4], [hdx + 3, hdy + 6]], COL.skinD);
      poly(g, [[hdx - 8, hdy - 1], [hdx - 6, hdy - 7.5], [hdx, hdy - 9], [hdx + 6, hdy - 7.5], [hdx + 8, hdy - 1], [hdx + 4, hdy - 5], [hdx - 4, hdy - 5]], hair);
      poly(g, [[hdx - 7.8, hdy - 4.2], [hdx + 7.8, hdy - 4.2], [hdx + 7.6, hdy - 1.6], [hdx - 7.6, hdy - 1.6]], COL.visor);
      poly(g, [[hdx - 6.5, hdy - 1.2], [hdx + 6.5, hdy - 1.2], [hdx + 5.5, hdy + 2], [hdx - 5.5, hdy + 2]], COL.lens);
    }
    if (p.over) drawRacketArm();
    g.restore();
  }

  function shadow(ctx, x, y, rx, ry) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  }

  // ---------- game frame ----------
  // g: game state; flip: draw from player 2's side (network guest); looks: [look0, look1] (optional).
  function drawGame(ctx, g, flip, prev, alpha, looks) {
    const s = flip ? -1 : 1;
    const lerp = (a, b) => (prev && alpha < 1 ? b + (a - b) * (1 - alpha) : b);
    ctx.drawImage(courtCanvas(), 0, 0);
    const pl = [0, 1].map((i) => {
      const mc = g.P[i], pm = prev && prev.P[i];
      const vx = pm ? lerp(pm.vx, mc.vx) : mc.vx, vy = pm ? lerp(pm.vy, mc.vy) : mc.vy;
      return { mc, q: P(vx * s, vy * s) };
    });
    const near = flip ? 1 : 0, far = 1 - near;
    for (const i of [far, near]) shadow(ctx, pl[i].q.x, pl[i].q.y, 34 * 0.6 * pl[i].q.per, 14 * 0.6 * pl[i].q.per);
    const drawPl = (i, facing) => drawPlayer(ctx, pl[i].q.x, pl[i].q.y, 0.6 * pl[i].q.per, pl[i].mc.anim, pl[i].mc.af, facing, i, looks && looks[i]);
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
      // shadow: fixed size (the original never scales mcBallShadow)
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(qs.x, qs.y, 4.9, 3, 0, 0, Math.PI * 2); ctx.fill();
      // ball: flat cel-shaded disc (measured on the original), radius 4 * per, no outline
      const r = 4 * qb.per, disc = (dx, dy, rr, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(qb.x + dx, qb.y + dy, rr, 0, Math.PI * 2); ctx.fill(); };
      ctx.save(); ctx.beginPath(); ctx.arc(qb.x, qb.y, r, 0, Math.PI * 2); ctx.clip();
      disc(0, 0, r, '#958e01'); disc(0, -0.15 * r, r, '#c2bd01'); disc(-0.11 * r, -0.2 * r, 0.77 * r, '#ffff00');
      ctx.restore();
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


  // ---------- title screen (modern night-court look, animated) ----------
  let titleCache = null;
  function titleCanvas() {
    if (titleCache) return titleCache;
    const c = document.createElement('canvas'); c.width = 600; c.height = 600;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, 600);
    bg.addColorStop(0, '#070b1f'); bg.addColorStop(0.55, '#101a45'); bg.addColorStop(1, '#0a2a2a');
    g.fillStyle = bg; g.fillRect(0, 0, 600, 600);
    const glow = g.createRadialGradient(300, 150, 10, 300, 150, 320);
    glow.addColorStop(0, 'rgba(120,90,255,0.35)'); glow.addColorStop(1, 'rgba(120,90,255,0)');
    g.fillStyle = glow; g.fillRect(0, 0, 600, 600);
    // court in perspective, neon lines
    const hy = 250, by = 640, cx = 300;
    const px = (u, y) => cx + u * (60 + (y - hy) / (by - hy) * 420);  // u in [-1, 1] across the court
    g.fillStyle = 'rgba(30,140,120,0.18)';
    g.beginPath(); g.moveTo(px(-1, hy), hy); g.lineTo(px(1, hy), hy); g.lineTo(px(1, by), by); g.lineTo(px(-1, by), by); g.fill();
    g.strokeStyle = 'rgba(90,255,220,0.55)'; g.lineWidth = 2; g.shadowColor = '#5affdc'; g.shadowBlur = 10;
    const vl = (u) => { g.beginPath(); g.moveTo(px(u, hy), hy); g.lineTo(px(u, by), by); g.stroke(); };
    const hl = (y, u0, u1) => { g.beginPath(); g.moveTo(px(u0, y), y); g.lineTo(px(u1, y), y); g.stroke(); };
    vl(-1); vl(1); vl(-0.78); vl(0.78);
    hl(hy, -1, 1); hl(330, -0.78, 0.78); hl(470, -0.78, 0.78);
    g.beginPath(); g.moveTo(cx, 330); g.lineTo(cx, 470); g.stroke();
    // net
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(px(-1.08, 395), 372, px(1.08, 395) - px(-1.08, 395), 24);
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.shadowColor = '#fff'; g.shadowBlur = 8; hl(372, -1.08, 1.08);
    g.shadowBlur = 0;
    // vignette
    const v = g.createRadialGradient(300, 300, 200, 300, 300, 440);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = v; g.fillRect(0, 0, 600, 600);
    titleCache = c;
    return c;
  }

  function drawTitleScene(ctx, t) {
    ctx.drawImage(titleCanvas(), 0, 0);
    // drifting light particles
    for (let i = 0; i < 28; i++) {
      const x = (i * 97 + t * (8 + i % 5 * 4)) % 620 - 10, y = (i * 53) % 260 + Math.sin(t + i) * 6;
      ctx.fillStyle = 'rgba(200,220,255,' + (0.15 + (i % 4) * 0.08) + ')';
      ctx.fillRect(x, y, 2, 2);
    }
    // ball bouncing across the court
    const ph = (t * 0.45) % 2, k = ph < 1 ? ph : 2 - ph;
    const bx = 120 + k * 360, ground = 520 - k * 60, hop = Math.abs(Math.sin(t * 3.2)) * 70, r = 9 - k * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(bx, ground + r, r * 1.2, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.shadowColor = '#d4ff3a'; ctx.shadowBlur = 18;
    ctx.fillStyle = '#d4ff3a'; ctx.beginPath(); ctx.arc(bx, ground - hop, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawLogo(ctx, s, x, y) {
    ctx.save();
    ctx.font = '900 italic 96px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const gr = ctx.createLinearGradient(0, y - 80, 0, y);
    gr.addColorStop(0, '#f4ffb0'); gr.addColorStop(0.5, '#d4ff3a'); gr.addColorStop(1, '#5affdc');
    ctx.shadowColor = 'rgba(212,255,58,0.7)'; ctx.shadowBlur = 30;
    ctx.fillStyle = gr; ctx.fillText(s, x, y);
    ctx.shadowBlur = 0; ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.strokeText(s, x, y);
    ctx.fillStyle = 'rgba(212,255,58,0.9)'; ctx.fillRect(x - 70, y + 14, 140, 3);
    ctx.restore();
  }

  function menuCard(ctx, r, label, sub, hot, primary) {
    const [x, y, w, h] = r;
    ctx.save();
    if (hot) { ctx.shadowColor = '#d4ff3a'; ctx.shadowBlur = 20; }
    if (primary || hot) {
      const gr = ctx.createLinearGradient(x, 0, x + w, 0);
      gr.addColorStop(0, hot ? '#d4ff3a' : 'rgba(212,255,58,0.9)'); gr.addColorStop(1, hot ? '#5affdc' : 'rgba(90,255,220,0.8)');
      ctx.fillStyle = gr;
    } else ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, x, y, w, h, 14); ctx.fill();
    ctx.shadowBlur = 0;
    if (!primary && !hot) { ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.5; ctx.stroke(); }
    ctx.restore();
    const dark = primary || hot, col = dark ? '#0b1030' : '#fff';
    text(ctx, label, x + 22, y + 24, 18, { outline: false, color: col });
    text(ctx, sub, x + 22, y + 42, 11, { outline: false, weight: 'normal', color: dark ? 'rgba(11,16,48,0.75)' : 'rgba(220,235,255,0.65)' });
    text(ctx, '›', x + w - 22, y + 34, 26, { outline: false, color: col, align: 'right' });
  }

  root.TennisRender = { drawGame, drawScene, drawTitleScene, drawLogo, menuCard, drawPlayer, panel, bar, text, roundRect, spaceButton, FONT };
})(typeof self !== 'undefined' ? self : this);
