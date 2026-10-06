// Pure game logic: faithful port of the original ActionScript (GAMEDESIGN "TENNIS GAME").
// No rendering, no network, no Math.random: deterministic given (seed, inputs).
// One step() == one original frame (30 Hz).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./cards.js'));
  else root.TennisLogic = factory(root.TennisCards);
})(typeof self !== 'undefined' ? self : this, function (Cards) {
  'use strict';

  const C = {
    COURT_W: 180, COURT_H: 360, SERVE_H: 200, SCREEN_OX: 300, SCREEN_OY: 300,
    NET_H: 40, TOSS_H: 50, GRAVITY: 0.8,
    PS_WAIT: 1, PS_MOVE: 2, PS_STROKE: 3, PS_SERVE: 4, PS_TOSS: 5, PS_FREEZE: 6, PS_AFTER: 7,
    ST_FORE: 1, ST_BACK: 2, ST_SMASH: 3,
    HIT_X1_FORE: -10, HIT_X2_FORE: 60, HIT_X1_BACK: -60, HIT_X2_BACK: 10,
    HIT_X1_SMASH: -30, HIT_X2_SMASH: 50, HIT_Y1: -120, HIT_Y2: 80, HIT_Z: 120,
    WM_WAIT: 1, WM_MOVE: 2,
    RESULT_FAULT: 1, RESULT_OUT: 2, RESULT_MISS: 3, RESULT_VOLLEY: 4,
    FX_NORMAL: 0, FX_TOPSPIN: 1, FX_SLICE: 2, FX_LOB: 3, FX_DROP: 4,
  };
  // Animation clip lengths (frames) from the SWF timelines.
  const ANIM_LEN = { right: 13, left: 13, fore: 21, back: 21, smash: 17, toss: 10 };

  // mulberry32, state kept in G.seed so the whole game state is plain JSON.
  function rnd(G) {
    let t = (G.seed = (G.seed + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const EVENTS = ['', 'fast', 'energy', 'classic'];
  function matchConstants(opts) {
    const ev = EVENTS.includes(opts.event) ? opts.event : '';
    const deck = [0, 1].map((i) => (ev === 'classic' ? [] : Cards.validDeck(opts.decks && opts.decks[i])));
    const lv = [0, 1].map((i) => deck[i].map((_, j) => Cards.clampLevel(opts.levels && opts.levels[i] && opts.levels[i][j])));
    return { deck, lv, ev };
  }
  // Fields that never change during a match: the server sends them once ('match' message) and leaves
  // them out of every snapshot; the client puts them back with applyConstants.
  const ABILITIES = ['forehand', 'backhand', 'serve', 'footwork', 'netplay', 'tech'];
  const MATCH_KEYS = ['deck', 'lv', 'ev', 'pname', 'ctrl', 'match_mode'].concat(ABILITIES);
  function constantsOf(G) {
    const c = { ab: G.P.map((p) => ABILITIES.map((k) => p[k])) };
    for (const k of MATCH_KEYS) if (k in G) c[k] = G[k];
    return c;
  }
  function applyConstants(g, c) {
    for (const k of MATCH_KEYS) if (k in c) g[k] = c[k];
    c.ab.forEach((a, i) => ABILITIES.forEach((k, j) => { g.P[i][k] = a[j]; }));
    return g;
  }

  function makePlayer(d) {
    return {
      vx: 0, vy: 0, stat: C.PS_WAIT, cnt: 0, wm: C.WM_WAIT, dest_x: 0, dest_y: 0, net_flg: 0,
      stroke_type: 0, hit_x1: 0, hit_x2: 0, hit_y1: 0, hit_y2: 0,
      forehand: 20 + 1 * d[0], backhand: 20 + 0.5 * d[1], serve: 30 + 3 * d[2],
      footwork: 6 + 0.3 * d[3], netplay: d[4] || 0, tech: d[5] || 0,
      anim: 'wait', af: 1,
      st: 100, sr: 0, fx: C.FX_NORMAL, en: 0, card: 0, cd: 0, bo: 0, kp: 0,
    };
  }

  // opts: { names:[2], data:[[6],[6]], ctrl:['human','ai'|'human'], matchMode:0|1, seed,
  //         decks:[[ids],[ids]], levels:[[n],[n]], event:'' | 'fast' | 'energy' | 'classic' }
  // deck, lv and ev are match constants: the server leaves them out of snapshots (MATCH_KEYS).
  function createMatch(opts) {
    const G = {
      seed: (opts.seed >>> 0) || 1, tick: 0,
      pname: opts.names.slice(), ctrl: opts.ctrl.slice(), match_mode: opts.matchMode || 0,
      P: [makePlayer(opts.data[0]), makePlayer(opts.data[1])],
      B: { vx: 0, vy: 0, vh: 0, ax: 0, ay: 0, up: 0, down: 0, side: 0, area: 0, moving: 0, bound: 0, dx: 0, dy: 0, fx: 0, fg: C.GRAVITY, visible: false },
      server: 0, receiver: 1, serve_pos: 1, play_winner: -1, fault_cnt: 0,
      point: [0, 0], gpoint: [0, 0], rally_cnt: 0, play_result: 0, score_txt: '',
      game_winner: -1, match_winner: -1,
      mes: { label: 'inplay', text: '', cnt: 0, f: 0 },
      space: { on: false, f: 1 },
      bound: { vx: 0, vy: 0, alpha: 0 },
      pad: [null, null], prevSp: [false, false], ...matchConstants(opts),
      over: false, events: [],
    };
    init_game(G);
    return G;
  }

  function setAnim(mc, label) { if (mc.anim !== label) { mc.anim = label; mc.af = 1; } }
  function emit(G, e) { G.events.push(e); }

  function init_game(G) {
    G.serve_pos = 1; G.play_winner = -1; G.fault_cnt = 0; G.point = [0, 0];
    G.score_txt = G.pname[G.server] + ' 0 - 0 ' + G.pname[G.receiver];
    init_play(G);
  }

  function init_play(G) {
    G.rally_cnt = 0; G.play_result = 0;
    setMes(G, 'inplay');
    for (let i = 0; i < 2; i++) {
      const mc = G.P[i];
      mc.vy = C.COURT_H + 20;
      if (i === 1) mc.vy *= -1;
      if (G.server === i) { mc.vx = G.serve_pos * 20; start_serve(G, i); }
      else { mc.vx = G.serve_pos * -C.COURT_W * 2 / 3; mc.stat = C.PS_WAIT; setAnim(mc, 'wait'); mc.wm = C.WM_WAIT; }
      if (G.server === 1) mc.vx *= -1;
      mc.net_flg = 0;
    }
    init_ball(G);
  }

  function setMes(G, label, text) {
    G.mes.label = label; G.mes.cnt = 0;
    if (text !== undefined) G.mes.text = text;
    if (label === 'game') G.space = { on: true, f: 1 };
    else if (label === 'win') G.space = { on: true, f: 1 };
    else if (label === 'lose') { G.mes.f = 30; G.space = { on: false, f: 1 }; }
    else G.space = { on: false, f: 1 };
  }

  // pad: {l,r,u,d,sp,sh,tp,sl,lc} in the player's own screen frame.
  function padOf(G, pn) {
    const k = G.pad[pn] || {};
    // check_pad(): later tests win (right over left, up over down).
    let hori = 0, vart = 0;
    if (k.d) vart = 1;
    if (k.u) vart = -1;
    if (k.l) hori = -1;
    if (k.r) hori = 1;
    return { hori, vart, trig: !!k.sp, sprint: !!k.sh, topspin: !!k.tp, slice: !!k.sl, lob: !!k.lc, card: !!k.a, next: !!k.n, prev: !!k.p };
  }

  // Deck keys are edge-triggered (kp: bit 1 = next held, bit 2 = prev held) so holding Q/E scrolls once.
  function useCard(G, pn, pad) {
    const mc = G.P[pn], deck = G.deck[pn];
    const kp = (pad.next ? 1 : 0) | (pad.prev ? 2 : 0), was = mc.kp || 0;
    mc.kp = kp;
    if (!deck.length) return;  // classic mode: no specials
    if ((kp & 1) && !(was & 1)) mc.card = (mc.card + 1) % deck.length;
    if ((kp & 2) && !(was & 2)) mc.card = (mc.card + deck.length - 1) % deck.length;
    if (!pad.card || mc.cd) return;
    const c = Cards.find(deck[mc.card]);
    if (!c || mc.en < c.cost) return;
    const k = Cards.scale(G.lv[pn][mc.card]);  // 1.00 at level 1, capped small at max level
    mc.en -= c.cost; mc.cd = c.cooldown; emit(G, 'card');
    if (c.id === 'second-wind') mc.st = Math.min(100, mc.st + Math.round(35 * k));
    else if (c.id === 'infinite-sprint') mc.bo = Math.round(90 * k);
    else if (c.id === 'wall') mc.bo = Math.round(60 * k);
    else if (c.id === 'focus') mc.st = Math.min(100, mc.st + Math.round(12 * k));
    else if (c.id === 'net-rush') mc.vy += pn === 0 ? -55 : 55;
    else if (c.id === 'return') mc.bo = Math.round(45 * k);
    else if (c.id === 'wrong-foot') G.P[1 - pn].bo = -Math.round(45 * k);
    else if (c.id === 'heavy-ball') mc.bo = Math.round(30 * k);
  }

  function recoverStamina(mc) {
    if (mc.st >= 100) { mc.sr = 0; return; }
    if (++mc.sr >= 6) { mc.st++; mc.sr = 0; }
  }
  function chosenEffect(G, pn, pad) {
    if (pad.topspin) return C.FX_TOPSPIN;
    if (pad.slice) return C.FX_SLICE;
    if (pad.lob) return Math.abs(G.P[1 - pn].vy) < 190 ? C.FX_LOB : C.FX_DROP;
    return C.FX_NORMAL;
  }
  function effectCost(fx) { return [0, 8, 6, 10, 8][fx] || 0; }

  // user_action(), generalised to either side. pn 0 is exactly the original code.
  function user_action(G, pn) {
    const mc = G.P[pn], s = pn === 0 ? 1 : -1;
    const pad = padOf(G, pn);
    useCard(G, pn, pad);
    switch (mc.stat) {
      case C.PS_SERVE:
        if (pad.trig) start_toss(G, pn);
        break;
      case C.PS_TOSS:
        mc.cnt++;
        if (mc.cnt > 8 && pad.trig) start_stroke(G, pn, chosenEffect(G, pn, pad));
        if (mc.cnt === 7) start_toss_ball(G, pn);
        break;
      case C.PS_STROKE:
        mc.cnt++;
        if (mc.cnt === 3 && check_hit(G, pn)) {
          set_ball_dest_user(G, pn, pad, mc.fx);
          const op = G.P[1 - pn];
          if (G.ctrl[1 - pn] === 'ai' && op.stat === C.PS_WAIT) {
            op.stat = C.PS_FREEZE; op.cnt = 0; setAnim(op, 'wait');
          }
        }
        break;
      case C.PS_WAIT:
        if (pad.vart === 0 && pad.hori === 0) {
          setAnim(mc, 'wait');
        } else {
          const sprint = (pad.sprint || mc.bo > 0) && mc.st > 0;
          const a = mc.footwork * (mc.st < 25 ? 0.85 : 1) * (sprint ? 1.4 : 1);
          mc.vx += s * pad.hori * a;
          mc.vy += s * pad.vart * a;
          if (sprint && mc.bo <= 0) { if (++mc.sr >= 2) { mc.st--; mc.sr = 0; } } else recoverStamina(mc);
          if (pn === 0 && !(mc.vy > 20)) mc.vy = 20;
          if (pn === 1 && !(mc.vy < -20)) mc.vy = -20;
          setAnim(mc, pad.hori < 0 ? 'left' : 'right');
        }
        if (pad.trig) start_stroke(G, pn, chosenEffect(G, pn, pad));
        if (pad.vart === 0 && pad.hori === 0) recoverStamina(mc);
        break;
    }
  }

  function start_serve(G, pn) { const mc = G.P[pn]; mc.stat = C.PS_SERVE; mc.cnt = 0; setAnim(mc, 'serve'); }
  function start_toss(G, pn) { const mc = G.P[pn]; mc.stat = C.PS_TOSS; setAnim(mc, 'toss'); mc.cnt = 0; }

  // start_stroke_user (pn 0) / start_stroke_com (pn 1): identical up to mirroring.
  function start_stroke(G, pn, fx) {
    const mc = G.P[pn], B = G.B;
    mc.stat = C.PS_STROKE; mc.cnt = 0;
    mc.fx = fx || C.FX_NORMAL;
    const nx = B.vx + B.ax * 2;
    if (pn === 0) {
      if (B.vh > 70 && nx > mc.vx + C.HIT_X1_SMASH && nx < mc.vx + C.HIT_X2_SMASH) {
        mc.stroke_type = C.ST_SMASH; mc.hit_x1 = C.HIT_X1_SMASH; mc.hit_x2 = C.HIT_X2_SMASH; setAnim(mc, 'smash');
      } else if (B.vx + B.ax * 3 < mc.vx) {
        mc.stroke_type = C.ST_BACK; mc.hit_x1 = C.HIT_X1_BACK; mc.hit_x2 = C.HIT_X2_BACK; setAnim(mc, 'back');
      } else {
        mc.stroke_type = C.ST_FORE; mc.hit_x1 = C.HIT_X1_FORE; mc.hit_x2 = C.HIT_X2_FORE; setAnim(mc, 'fore');
      }
      mc.hit_y1 = C.HIT_Y1; mc.hit_y2 = C.HIT_Y2;
    } else {
      if (B.vh > 70 && nx > mc.vx - C.HIT_X2_SMASH && nx < mc.vx - C.HIT_X1_SMASH) {
        mc.stroke_type = C.ST_SMASH; mc.hit_x1 = -C.HIT_X2_SMASH; mc.hit_x2 = -C.HIT_X1_SMASH; setAnim(mc, 'smash');
      } else if (B.vx + B.ax * 3 > mc.vx) {
        mc.stroke_type = C.ST_BACK; mc.hit_x1 = -C.HIT_X2_BACK; mc.hit_x2 = -C.HIT_X1_BACK; setAnim(mc, 'back');
      } else {
        mc.stroke_type = C.ST_FORE; mc.hit_x1 = -C.HIT_X2_FORE; mc.hit_x2 = -C.HIT_X1_FORE; setAnim(mc, 'fore');
      }
      mc.hit_y1 = -C.HIT_Y2; mc.hit_y2 = -C.HIT_Y1;
    }
  }

  function check_hit(G, pn) {
    const mc = G.P[pn], B = G.B;
    if (B.vx < mc.vx + mc.hit_x1) return 0;
    if (B.vx > mc.vx + mc.hit_x2) return 0;
    if (B.vy < mc.vy + mc.hit_y1) return 0;
    if (B.vy > mc.vy + mc.hit_y2) return 0;
    if (B.vh > C.HIT_Z) return 0;
    return 1;
  }

  function strokeSpeed(mc) {
    let s = mc.forehand;
    if (mc.stroke_type === C.ST_BACK) s = mc.backhand;
    if (mc.stroke_type === C.ST_SMASH) s = mc.serve;
    return s;
  }

  // set_ball_dest_user, mirrored for pn 1 the same way set_ball_dest_com is.
  function set_ball_dest_user(G, pn, pad, fx) {
    if (G.B.side === pn) return;
    const cost = effectCost(fx);
    if (cost && G.P[pn].st < cost) fx = C.FX_NORMAL;
    let cx = 1; if (pad.hori < 0) cx = 0; if (pad.hori > 0) cx = 2;
    let cy = 1; if (pad.vart < 0) cy = 0; if (pad.vart > 0) cy = 2;
    let x1, x2, y1, y2;
    if (G.rally_cnt === 0) {
      if (G.serve_pos > 0) { x1 = -C.COURT_W; x2 = 0; } else { x1 = 0; x2 = C.COURT_W; }
      y1 = -C.SERVE_H; y2 = -C.SERVE_H / 2;
    } else {
      x1 = -C.COURT_W; x2 = C.COURT_W; y1 = -C.COURT_H; y2 = -C.COURT_H / 3;
    }
    const w = (x2 - x1) / 3, h = (y2 - y1) / 3;
    let x = x1 + w * cx + rnd(G) * w;
    let y = y1 + h * cy + rnd(G) * h;
    if (fx === C.FX_LOB) y = -C.COURT_H + 18;
    if (fx === C.FX_DROP) y = -72;
    if (G.P[pn].st < 25) { x += (rnd(G) - 0.5) * 28; y += (rnd(G) - 0.5) * 20; }
    if (pn === 1) { x = -x; y = -y; }
    if (cost && G.P[pn].st >= cost) G.P[pn].st -= cost;
    if (G.P[pn].bo > 0 && fx === C.FX_NORMAL) fx = C.FX_TOPSPIN;
    start_move_ball(G, x, y, pn, strokeSpeed(G.P[pn]), fx);
  }

  function start_wait(G, pn) {
    const mc = G.P[pn], B = G.B;
    if (mc.stat === C.PS_STROKE && mc.stroke_type === C.ST_SMASH) {
      let ay = -20; if (pn === 1) ay *= -1;
      mc.vy += ay;
      if (pn === 0 && mc.vy < 0) mc.vy = 0;
      if (pn === 1 && mc.vy > 0) mc.vy = 0;
    }
    mc.stat = C.PS_WAIT; setAnim(mc, 'wait');
    if (pn === 1 && G.ctrl[1] === 'ai' && B.vy < mc.vy) { mc.stat = C.PS_AFTER; setAnim(mc, 'win'); }
    if (mc.net_flg === 0 && mc.netplay > rnd(G) * 20) mc.net_flg = 1;
    mc.wm = C.WM_MOVE; mc.dest_x = 0; mc.dest_y = -C.COURT_H;
    if (mc.net_flg) { mc.dest_x = B.dx / 3; mc.dest_y = -150; }
  }

  function move_enemy(G) {
    const mc = G.P[1], B = G.B;
    recoverStamina(mc);
    switch (mc.stat) {
      case C.PS_SERVE:
        mc.cnt++;
        if (mc.cnt > 10) start_toss(G, 1);
        break;
      case C.PS_TOSS:
        mc.cnt++;
        if (mc.cnt === 7) start_toss_ball(G, 1);
        if (mc.cnt > 22) start_stroke(G, 1);
        break;
      case C.PS_WAIT: {
        if (mc.wm === C.WM_MOVE) {
          const foot = mc.footwork;
          let f = 0, lr = 0;
          if (mc.vy < mc.dest_y - 10) mc.vy += foot;
          else if (mc.vy > mc.dest_y + 10) mc.vy -= foot;
          else f++;
          if (f === 0) lr = mc.vx > 0 ? 1 : -1;
          if (mc.vx < mc.dest_x - 10) { mc.vx += foot; setAnim(mc, 'left'); lr = -1; }
          else if (mc.vx > mc.dest_x + 10) { mc.vx -= foot; setAnim(mc, 'right'); lr = 1; }
          else f++;
          if (f === 2) { mc.wm = C.WM_WAIT; setAnim(mc, 'wait'); }
          else { if (lr < 0) setAnim(mc, 'left'); if (lr > 0) setAnim(mc, 'right'); }
        }
        if (B.vy + B.ay * 4 < mc.vy && Math.abs(B.vx + B.ax * 4 - mc.vx) < 60) start_stroke(G, 1);
        break;
      }
      case C.PS_STROKE:
        mc.cnt++;
        if (mc.cnt === 3 && check_hit(G, 1)) set_ball_dest_com(G);
        break;
      case C.PS_FREEZE:
        mc.cnt++;
        if (mc.cnt > 10) {
          if (mc.vy > B.dy) { mc.dest_x = B.ax / B.ay * (mc.vy - B.vy) + B.vx; mc.dest_y = mc.vy; }
          else { mc.dest_x = B.dx + B.ax * 5; mc.dest_y = B.dy + B.ay * 5; }
          mc.stat = C.PS_WAIT; mc.wm = C.WM_MOVE;
        }
        break;
    }
  }

  function set_ball_dest_com(G) {
    let cx = Math.floor(rnd(G) * 3);
    let cy = Math.floor(rnd(G) * 3);
    let x1, x2, y1, y2;
    if (G.rally_cnt === 0) {
      if (G.serve_pos > 0) { x1 = -C.COURT_W; x2 = 0; } else { x1 = 0; x2 = C.COURT_W; }
      y1 = -C.SERVE_H; y2 = -C.SERVE_H / 2;
    } else {
      if (G.P[1].tech > rnd(G) * 10) cx = G.P[0].vx < 0 ? 0 : 2;
      if (G.P[1].net_flg) cy = Math.floor(rnd(G) * 2);
      x1 = -C.COURT_W; x2 = C.COURT_W; y1 = -C.COURT_H; y2 = -C.COURT_H / 3;
    }
    const w = (x2 - x1) / 3, h = (y2 - y1) / 3;
    let x = x1 + w * cx + rnd(G) * w;
    let y = y1 + h * cy + rnd(G) * h;
    x *= -1; y *= -1;
    start_move_ball(G, x, y, 1, strokeSpeed(G.P[1]));
  }

  function init_ball(G) {
    const mc = G.P[G.server], B = G.B;
    B.ax = 0; B.ay = 0; B.vx = mc.vx; B.vy = mc.vy; B.vh = 0; B.up = 0; B.down = 0;
    B.side = G.server === 0 ? 1 : 0;
    B.area = G.server === 1 ? 1 : 0;
    B.moving = 0; B.fx = C.FX_NORMAL; B.fg = C.GRAVITY; B.visible = false;
  }

  function start_toss_ball(G, pn) {
    const mc = G.P[pn], B = G.B;
    B.ax = 0; B.ay = 0;
    let ax = 10; if (pn === 1) ax *= -1;
    B.vx = mc.vx + ax; B.vy = mc.vy; B.vh = C.TOSS_H; B.up = 10; B.down = 0;
    B.side = pn === 0 ? 1 : 0; B.fx = C.FX_NORMAL; B.fg = C.GRAVITY;
    B.bound = 0; B.moving = 1; B.visible = true;
  }

  function start_move_ball(G, dx, dy, side, max_speed, fx) {
    const B = G.B;
    if (G.rally_cnt === 1 && B.bound === 0) set_result(G, C.RESULT_VOLLEY);
    B.side = side; B.dx = dx; B.dy = dy;
    const sx = B.dx - B.vx, sy = B.dy - B.vy;
    const dist = Math.sqrt(sx * sx + sy * sy);
    let speed;
    for (let i = 0; i < 5; i++) {
      speed = max_speed - i * 4;
      if (check_hit_net(G, sx, sy, speed, dist) === 1) break;
    }
    fx = fx || C.FX_NORMAL;
    if (fx === C.FX_TOPSPIN) speed *= 1.05;
    if (fx === C.FX_SLICE || fx === C.FX_DROP) speed *= 0.84;
    if (G.ev === 'fast') speed *= 1.12;
    const n = dist / speed;
    const grav = fx === C.FX_LOB ? C.GRAVITY * 0.55 : fx === C.FX_SLICE || fx === C.FX_DROP ? C.GRAVITY * 1.18 : C.GRAVITY;
    const fall = n * (n - 1) * grav / 2;
    B.ax = sx / n; B.ay = sy / n;
    B.up = (fall - B.vh) / n;
    B.down = 0; B.bound = 0; B.fx = fx; B.fg = grav;
    G.rally_cnt++;
    G.P[side].en = Math.min(10, G.P[side].en + (G.ev === 'energy' ? 2 : 1));
    emit(G, 'hit');
  }

  function check_hit_net(G, sx, sy, speed, dist) {
    const B = G.B;
    const n = dist / speed;
    const fall = n * (n - 1) * C.GRAVITY / 2;
    const ay = sy / n, up = (fall - B.vh) / n;
    let down = 0, y = B.vy, h = B.vh;
    for (let guard = 0; guard < 10000; guard++) {
      h += up - down; down += C.GRAVITY; y += ay;
      if (h < 0) return 0;
      if (B.side === 0 && y < 0) return h > C.NET_H + 10 ? 1 : 0;
      if (B.side === 1 && y > 0) return h > C.NET_H + 10 ? 1 : 0;
    }
    return 0;
  }

  function move_ball(G) {
    const B = G.B;
    if (B.moving !== 1) return;
    B.vh += B.up - B.down;
    if (B.vh < 0) {
      B.up = (B.down - B.up) * (B.fx === C.FX_TOPSPIN ? 0.8 : B.fx === C.FX_SLICE || B.fx === C.FX_DROP ? 0.48 : 2 / 3);
      if (B.up < 1.3) { B.vh = 0; B.moving = 0; }
      B.down = 0; B.vh = 0;
      const slow = B.fx === C.FX_SLICE || B.fx === C.FX_DROP ? 0.48 : B.fx === C.FX_TOPSPIN ? 0.68 : 3 / 5;
      B.ax = B.ax * slow; B.ay = B.ay * slow;
      B.bound++;
      B.vx += B.ax; B.vy += B.ay;
      G.bound = { vx: B.vx, vy: B.vy, alpha: 100 };
      if (B.bound === 1) {
        if (!(G.rally_cnt > 1)) { if (check_out_serve(G)) set_result(G, C.RESULT_FAULT); }
        else if (check_out(G)) set_result(G, C.RESULT_OUT);
      } else if (B.bound === 2) {
        set_result(G, C.RESULT_MISS);
      }
      emit(G, 'bound');
    } else {
      B.down += B.fg || C.GRAVITY;
      B.vx += B.ax; B.vy += B.ay;
    }
  }

  function check_out_serve(G) {
    let x1, x2, y1, y2;
    if (G.server === 0) {
      if (G.serve_pos > 0) { x1 = -C.COURT_W; x2 = 0; } else { x1 = 0; x2 = C.COURT_W; }
      y1 = -C.SERVE_H; y2 = 0;
    } else {
      if (G.serve_pos > 0) { x1 = 0; x2 = C.COURT_W; } else { x1 = -C.COURT_W; x2 = 0; }
      y1 = 0; y2 = C.SERVE_H;
    }
    const B = G.B;
    return (B.vx < x1 || B.vx > x2 || B.vy < y1 || B.vy > y2) ? 1 : 0;
  }

  function check_out(G) {
    const B = G.B;
    const y1 = B.side === 0 ? -C.COURT_H : 0, y2 = B.side === 0 ? 0 : C.COURT_H;
    return (B.vx < -C.COURT_W || B.vx > C.COURT_W || B.vy < y1 || B.vy > y2) ? 1 : 0;
  }

  function set_result(G, res) {
    if (G.play_result > 0) return;
    G.play_result = res;
    switch (res) {
      case C.RESULT_FAULT:
        G.fault_cnt++;
        if (G.fault_cnt === 1) setMes(G, 'mes', 'FAULT');
        else { G.play_winner = G.server === 0 ? 1 : 0; setMes(G, 'mes', 'DOUBLE FAULT'); }
        break;
      case C.RESULT_OUT:
        G.play_winner = G.B.side === 0 ? 1 : 0;
        setMes(G, 'mes', 'OUT');
        emit(G, 'out');
        break;
      case C.RESULT_MISS:
        if (G.match_mode === 1) emit(G, 'app');
        G.play_winner = G.B.side;
        start_score(G);
        break;
      case C.RESULT_VOLLEY:
        G.play_winner = G.server;
        start_score(G);
        break;
    }
  }

  const PTS = [0, 15, 30, 40];
  function start_score(G) {
    const w = G.play_winner;
    if (w < 0) { init_play(G); return; }
    G.point[w]++;
    if (G.point[w] > 3) {
      if (G.point[0] === G.point[1]) {
        G.score_txt = 'DEUCE';
        setMes(G, 'score', G.score_txt);
      } else if (!(Math.abs(G.point[0] - G.point[1]) > 1)) {
        G.score_txt = 'Advantage ' + G.pname[w];
        setMes(G, 'score', G.score_txt);
      } else {
        G.game_winner = w;
        G.gpoint[w]++;
        setMes(G, 'game', 'Game won by ' + G.pname[w]);
        G.P[0].stat = C.PS_AFTER; setAnim(G.P[0], 'win');
        return;
      }
    } else {
      const a = PTS[G.point[G.server]], b = PTS[G.point[G.receiver]];
      G.score_txt = G.pname[G.server] + ' ' + a + ' - ' + b + ' ' + G.pname[G.receiver];
      setMes(G, 'score', a + ' - ' + b);
    }
    if (w === 1) { setAnim(G.P[1], 'win'); G.P[1].stat = C.PS_AFTER; }
    else { setAnim(G.P[1], 'lose'); G.P[1].stat = C.PS_AFTER; }
  }

  function after_score(G) {
    G.fault_cnt = 0; G.play_winner = -1;
    G.serve_pos = G.serve_pos === 1 ? -1 : 1;
    init_play(G);
  }

  function after_game_winner(G) {
    const gw = G.game_winner;
    if (!(G.gpoint[gw] < 3) && Math.abs(G.gpoint[0] - G.gpoint[1]) > 1) {
      if (G.match_mode === 1) emit(G, 'app2');
      G.score_txt = '';
      if (G.gpoint[0] > G.gpoint[1]) { G.match_winner = 0; setMes(G, 'win'); }
      else { G.match_winner = 1; setMes(G, 'lose'); }
    } else {
      setMes(G, 'inplay');
      G.server = G.server === 0 ? 1 : 0;
      G.receiver = G.server === 0 ? 1 : 0;
      init_game(G);
    }
  }

  // Timeline-driven parts: player animation clips, message clip, "Space bar" clip, bounce mark.
  function advanceAnims(G) {
    for (let pn = 0; pn < 2; pn++) {
      const mc = G.P[pn], len = ANIM_LEN[mc.anim];
      if (!len) continue;
      if (mc.anim === 'left' || mc.anim === 'right') mc.af = mc.af % len + 1;
      else if (mc.anim === 'toss') { if (mc.af < 8) mc.af++; }
      else if (mc.af < len) {
        mc.af++;
        if (mc.af === len) start_wait(G, pn); // frame script on the last frame of the stroke clip
      }
    }
    if (G.bound.alpha > 0) G.bound.alpha = Math.max(0, G.bound.alpha - 10);
  }

  function advanceMes(G, spacePressed) {
    const m = G.mes;
    if (m.label === 'mes') {
      if (++m.cnt >= 30) { m.label = 'inplay-wait'; start_score(G); }
    } else if (m.label === 'score') {
      if (++m.cnt >= 30) { setMes(G, 'inplay'); after_score(G); }
    } else if (m.label === 'lose' && !G.space.on) {
      if (++m.f >= 60) G.space = { on: true, f: 1 };
    }
    const sp = G.space;
    if (sp.on) {
      if (sp.f === 1) { if (spacePressed) { sp.f = 2; emit(G, 'space'); } }
      else if (++sp.f >= 13) {
        sp.on = false;
        if (m.label === 'game') after_game_winner(G);
        else if (m.label === 'win' || m.label === 'lose') { G.over = true; emit(G, 'over'); }
      }
    }
  }

  // inputs: [pad0, pad1], each {l,r,u,d,sp} (pad1 ignored when player 1 is the AI).
  function step(G, inputs) {
    G.events = [];
    if (G.over) return G;
    G.tick++;
    G.pad = [inputs[0] || {}, inputs[1] || {}];
    let spacePressed = false;
    for (let i = 0; i < 2; i++) {
      const sp = !!G.pad[i].sp;
      if (sp && !G.prevSp[i] && (i === 0 || G.ctrl[1] === 'human')) spacePressed = true;
      G.prevSp[i] = sp;
      if (G.P[i].cd) G.P[i].cd--;
      if (G.P[i].bo) G.P[i].bo += G.P[i].bo > 0 ? -1 : 1;
    }
    advanceAnims(G);
    user_action(G, 0);
    if (G.ctrl[1] === 'ai') move_enemy(G); else user_action(G, 1);
    move_ball(G);
    advanceMes(G, spacePressed);
    return G;
  }

  // Screen projection (used by renderer and kept here so it matches the logic constants).
  function project(vx, vy, vh) {
    const per = 1 + vy / C.COURT_H / 10;
    return { x: C.SCREEN_OX + vx * per, y: C.SCREEN_OY + vy / 2 - (vh || 0) * per, per };
  }

  // Original roster (tdat): 6 stat digits + name.
  const TDAT = ['787765SELES', '989520VENUS', '567420DOKICI', '687789CHRIS', '346430ANNA',
    '768524CLIJSTER', '979746GRAF', '887657SABATINI', '465999SANCHEZ', '364735DATEKIMI',
    '878620DAVENPO', '677999NAVRATIL', '786879HINGIS', '467338PIERCE', '567350SHARAPO', '466698NOVOTNA'];

  return { C, createMatch, step, project, rnd, TDAT, start_wait, PTS, MATCH_KEYS, EVENTS, constantsOf, applyConstants };
});
