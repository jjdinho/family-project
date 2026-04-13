(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const MAP = [
    '################',
    '#1............3#',
    '#..##.....##...#',
    '#..............#',
    '#.....####.....#',
    '#....#....#....#',
    '#....#....#....#',
    '#..............#',
    '#..............#',
    '#....#....#....#',
    '#....#....#....#',
    '#.....####.....#',
    '#..............#',
    '#..##......##..#',
    '#......2.......#',
    '################'
  ];
  const MAP_W = 16, MAP_H = 16;

  const isWall = (x, y) => {
    const gx = Math.floor(x), gy = Math.floor(y);
    if (gx < 0 || gx >= MAP_W || gy < 0 || gy >= MAP_H) return true;
    return MAP[gy][gx] === '#';
  };

  const bases = {};
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const c = MAP[y][x];
      if (c === '1' || c === '2' || c === '3') bases[c] = { x: x + 0.5, y: y + 0.5 };
    }
  }

  const SHIELD_SPOTS = [
    { x: 8, y: 3 }, { x: 3, y: 8 }, { x: 13, y: 8 }, { x: 8, y: 13 }, { x: 8, y: 8 },
    { x: 5, y: 5 }, { x: 11, y: 5 }, { x: 5, y: 11 }, { x: 11, y: 11 }
  ];
  const shields = SHIELD_SPOTS.map(p => ({ x: p.x, y: p.y, active: true, respawn: 0 }));

  const FOV = Math.PI / 3;
  const NUM_RAYS = 240;
  const HIT_RADIUS = 0.38;
  const MATCH_DURATION = 120_000;

  const colors = { 1: '#4fc3f7', 2: '#ef5350', 3: '#ffee58' };
  const names  = { 1: 'You',     2: 'Red Bot', 3: 'Yellow Bot' };

  const makePlayer = (id, angle, isAI) => ({
    id, x: bases[id].x, y: bases[id].y, angle,
    health: 100, shield: 0, score: 0, isAI,
    fireCooldown: 0, respawnTimer: 0, hitFlash: 0, tagFlash: 0, hitMarker: 0,
    color: colors[id], aiWanderAngle: 0, aiThinkTimer: 0, aiStrafe: 1
  });

  const player = makePlayer(1, Math.PI / 4, false);
  const bot2 = makePlayer(2, -Math.PI / 2, true);
  const bot3 = makePlayer(3, Math.PI, true);
  const players = [player, bot2, bot3];

  const keys = {};
  const input = { mouseDX: 0, fire: false };
  let gameState = 'menu';
  let startTime = 0;
  let paused = false;
  let lastT = performance.now();
  const beams = [];

  addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'Space') { input.fire = true; e.preventDefault(); }
    if (e.code === 'Escape' && gameState === 'playing') paused = !paused;
  });
  addEventListener('keyup', e => { keys[e.code] = false; });

  canvas.addEventListener('click', () => {
    if (gameState === 'menu') { gameState = 'playing'; startTime = performance.now(); canvas.requestPointerLock?.(); return; }
    if (gameState === 'gameover') { resetGame(); canvas.requestPointerLock?.(); return; }
    if (gameState === 'playing') { canvas.requestPointerLock?.(); input.fire = true; }
  });

  addEventListener('mousemove', e => {
    if (document.pointerLockElement === canvas) input.mouseDX += e.movementX;
  });

  const normAng = a => {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };
  const stepAngle = (cur, target, maxStep) => {
    const d = normAng(target - cur);
    return cur + Math.sign(d) * Math.min(Math.abs(d), maxStep);
  };

  const tryMove = (p, dx, dy) => {
    const r = 0.22;
    if (!isWall(p.x + dx + Math.sign(dx) * r, p.y)) p.x += dx;
    if (!isWall(p.x, p.y + dy + Math.sign(dy) * r)) p.y += dy;
  };

  const castRayDDA = (ox, oy, angle) => {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let mapX = Math.floor(ox), mapY = Math.floor(oy);
    const dxInv = Math.abs(1 / dx), dyInv = Math.abs(1 / dy);
    let stepX, stepY, sideDistX, sideDistY;
    if (dx < 0) { stepX = -1; sideDistX = (ox - mapX) * dxInv; }
    else { stepX = 1; sideDistX = (mapX + 1 - ox) * dxInv; }
    if (dy < 0) { stepY = -1; sideDistY = (oy - mapY) * dyInv; }
    else { stepY = 1; sideDistY = (mapY + 1 - oy) * dyInv; }
    let side = 0;
    for (let i = 0; i < 64; i++) {
      if (sideDistX < sideDistY) { sideDistX += dxInv; mapX += stepX; side = 0; }
      else { sideDistY += dyInv; mapY += stepY; side = 1; }
      if (mapX < 0 || mapX >= MAP_W || mapY < 0 || mapY >= MAP_H) break;
      if (MAP[mapY][mapX] === '#') break;
    }
    const perpDist = side === 0 ? (sideDistX - dxInv) : (sideDistY - dyInv);
    return { dist: Math.max(0.01, perpDist), side };
  };

  const hasLOS = (ax, ay, bx, by) => {
    const d = Math.hypot(bx - ax, by - ay);
    const ang = Math.atan2(by - ay, bx - ax);
    const r = castRayDDA(ax, ay, ang);
    return r.dist >= d - 0.05;
  };

  const fireLaser = shooter => {
    if (shooter.fireCooldown > 0 || shooter.respawnTimer > 0) return;
    shooter.fireCooldown = shooter.isAI ? 0.65 : 0.28;
    const angle = shooter.angle;
    const ox = shooter.x, oy = shooter.y;
    const fx = Math.cos(angle), fy = Math.sin(angle);
    const wall = castRayDDA(ox, oy, angle);
    let closestDist = wall.dist;
    let target = null;
    for (const t of players) {
      if (t === shooter || t.respawnTimer > 0) continue;
      const dx = t.x - ox, dy = t.y - oy;
      const parallel = dx * fx + dy * fy;
      if (parallel <= 0.1 || parallel >= closestDist) continue;
      const perp = Math.abs(dx * -fy + dy * fx);
      if (perp < HIT_RADIUS) { closestDist = parallel; target = t; }
    }
    beams.push({
      x1: ox, y1: oy,
      x2: ox + fx * closestDist, y2: oy + fy * closestDist,
      color: shooter.color, life: 0.4, maxLife: 0.4,
      fromPlayer: shooter === player
    });
    if (target) tagHit(shooter, target);
  };

  const tagHit = (shooter, target) => {
    const dmg = 35;
    target.hitFlash = 0.35;
    let remaining = dmg;
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, remaining);
      target.shield -= absorbed;
      remaining -= absorbed;
    }
    target.health -= remaining;
    if (target.health <= 0) {
      target.health = 0;
      target.respawnTimer = 2.2;
      shooter.score += 1;
      shooter.tagFlash = 0.9;
      if (shooter === player) player.hitMarker = 0.6;
    }
  };

  const respawn = p => {
    const b = bases[p.id];
    p.x = b.x; p.y = b.y;
    p.health = 100;
    p.shield = 0;
    p.angle = Math.random() * Math.PI * 2;
  };

  const onBase = p => {
    const b = bases[p.id];
    return Math.hypot(p.x - b.x, p.y - b.y) < 1.3;
  };

  const updatePlayer = dt => {
    if (player.respawnTimer > 0) return;
    const speed = 2.9 * dt;
    const turn = 2.4 * dt;
    const fx = Math.cos(player.angle), fy = Math.sin(player.angle);
    const rx = -fy, ry = fx;
    let mx = 0, my = 0;
    if (keys['KeyW'] || keys['ArrowUp'])   { mx += fx * speed; my += fy * speed; }
    if (keys['KeyS'] || keys['ArrowDown']) { mx -= fx * speed; my -= fy * speed; }
    if (keys['KeyA']) { mx -= rx * speed; my -= ry * speed; }
    if (keys['KeyD']) { mx += rx * speed; my += ry * speed; }
    if (keys['ArrowLeft'])  player.angle -= turn;
    if (keys['ArrowRight']) player.angle += turn;
    player.angle += input.mouseDX * 0.003;
    input.mouseDX = 0;
    tryMove(player, mx, my);
    if (input.fire || keys['Space']) fireLaser(player);
    input.fire = false;
  };

  const updateAI = (bot, dt) => {
    if (bot.respawnTimer > 0) return;
    // Flee to base when hurt — flee earlier and more slowly
    if (bot.health < 55) {
      const b = bases[bot.id];
      const ang = Math.atan2(b.y - bot.y, b.x - bot.x);
      bot.angle = stepAngle(bot.angle, ang, 1.4 * dt);
      const fx = Math.cos(bot.angle), fy = Math.sin(bot.angle);
      tryMove(bot, fx * 1.4 * dt, fy * 1.4 * dt);
      return;
    }
    let best = null, bestScore = Infinity;
    for (const e of players) {
      if (e === bot || e.respawnTimer > 0) continue;
      if (!hasLOS(bot.x, bot.y, e.x, e.y)) continue;
      const d = Math.hypot(e.x - bot.x, e.y - bot.y);
      const s = d + (e.isAI ? 2 : 0);
      if (s < bestScore) { bestScore = s; best = e; }
    }
    if (best) {
      const ang = Math.atan2(best.y - bot.y, best.x - bot.x);
      const prevAngle = bot.angle;
      // Slower turning — bots take longer to aim
      bot.angle = stepAngle(bot.angle, ang, 1.1 * dt);
      const dist = Math.hypot(best.x - bot.x, best.y - bot.y);
      bot.aiThinkTimer -= dt;
      if (bot.aiThinkTimer <= 0) { bot.aiStrafe *= -1; bot.aiThinkTimer = 1.2 + Math.random() * 1.8; }
      const fx = Math.cos(bot.angle), fy = Math.sin(bot.angle);
      const rx = -fy, ry = fx;
      let mv = 0;
      if (dist > 5.5) mv = 1;
      else if (dist < 2.8) mv = -0.5;
      // Slower movement
      const s = 1.3 * dt;
      tryMove(bot, (fx * mv + rx * bot.aiStrafe * 0.5) * s,
                   (fy * mv + ry * bot.aiStrafe * 0.5) * s);
      // Must be more precisely aimed AND shorter range before firing
      const aimed = Math.abs(normAng(prevAngle - ang)) < 0.12;
      if (aimed && dist < 8) fireLaser(bot);
    } else {
      bot.aiThinkTimer -= dt;
      const ahead = isWall(bot.x + Math.cos(bot.angle) * 0.5, bot.y + Math.sin(bot.angle) * 0.5);
      if (bot.aiThinkTimer <= 0 || ahead) {
        bot.aiWanderAngle = Math.random() * Math.PI * 2;
        bot.aiThinkTimer = 1.8 + Math.random() * 2.5;
      }
      bot.angle = stepAngle(bot.angle, bot.aiWanderAngle, 1.2 * dt);
      const fx = Math.cos(bot.angle), fy = Math.sin(bot.angle);
      tryMove(bot, fx * 1.2 * dt, fy * 1.2 * dt);
    }
  };

  const updateState = dt => {
    for (const p of players) {
      if (p.respawnTimer > 0) {
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) respawn(p);
      }
      p.fireCooldown = Math.max(0, p.fireCooldown - dt);
      p.hitFlash = Math.max(0, p.hitFlash - dt);
      p.tagFlash = Math.max(0, p.tagFlash - dt);
      p.hitMarker = Math.max(0, p.hitMarker - dt);
      if (onBase(p) && p.respawnTimer <= 0) {
        p.health = Math.min(100, p.health + 28 * dt);
        p.shield = Math.min(50, p.shield + 18 * dt);
      }
    }
    for (const s of shields) {
      if (!s.active) {
        s.respawn -= dt;
        if (s.respawn <= 0) s.active = true;
        continue;
      }
      for (const p of players) {
        if (p.respawnTimer > 0) continue;
        if (Math.hypot(p.x - s.x, p.y - s.y) < 0.55) {
          p.shield = Math.min(100, p.shield + 50);
          s.active = false;
          s.respawn = 5;
          break;
        }
      }
    }
    for (let i = beams.length - 1; i >= 0; i--) {
      beams[i].life -= dt;
      if (beams[i].life <= 0) beams.splice(i, 1);
    }
    updatePlayer(dt);
    updateAI(bot2, dt);
    updateAI(bot3, dt);
  };

  // --- Rendering ---

  const zBuf = new Float32Array(NUM_RAYS);
  const colW = W / NUM_RAYS;

  const renderWalls = () => {
    // Ceiling — lighter blue-purple
    const grad = ctx.createLinearGradient(0, 0, 0, H / 2);
    grad.addColorStop(0, '#1a2a5a');
    grad.addColorStop(1, '#2a4080');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H / 2);
    // Floor — medium neutral gray
    const grad2 = ctx.createLinearGradient(0, H / 2, 0, H);
    grad2.addColorStop(0, '#3a3a4a');
    grad2.addColorStop(1, '#505060');
    ctx.fillStyle = grad2;
    ctx.fillRect(0, H / 2, W, H / 2);

    for (let i = 0; i < NUM_RAYS; i++) {
      const rayAngle = player.angle - FOV / 2 + (i / NUM_RAYS) * FOV;
      const r = castRayDDA(player.x, player.y, rayAngle);
      const corrected = r.dist * Math.cos(rayAngle - player.angle);
      zBuf[i] = corrected;
      const h = Math.min(H * 3, H / corrected);
      const top = (H - h) / 2;
      // Fog floor of 0.4 so distant walls never go black
      const fog = Math.max(0.4, 1 - corrected / 14);
      const base = r.side === 1 ? 110 : 170;
      const cc = Math.floor(base * fog);
      // Lighter, less blue-dominant color: closer to gray-blue
      ctx.fillStyle = `rgb(${Math.floor(cc * 0.65)}, ${Math.floor(cc * 0.75)}, ${cc})`;
      ctx.fillRect(i * colW, top, colW + 1, h);
    }
  };

  const drawSpriteLayered = (cx, sw, sh, dist, layers, yOffset = 0) => {
    const left = cx - sw / 2;
    const topBase = H / 2 - sh * 0.5 + yOffset;
    const startX = Math.max(0, Math.floor(left));
    const endX = Math.min(W, Math.ceil(left + sw));
    for (let x = startX; x < endX; x++) {
      const col = Math.floor(x / colW);
      if (col < 0 || col >= NUM_RAYS) continue;
      if (zBuf[col] < dist) continue;
      const frac = (x - left) / sw;
      for (const L of layers) {
        if (frac < L.x0 || frac > L.x1) continue;
        const y0 = topBase + sh * L.y0;
        const y1 = topBase + sh * L.y1;
        ctx.fillStyle = L.color;
        ctx.fillRect(x, y0, 1, y1 - y0);
      }
    }
  };

  const drawBot = (cx, sw, sh, dist, bot) => {
    const bodyColor = bot.hitFlash > 0 ? '#ffffff' : bot.color;
    const darkColor = bot.hitFlash > 0 ? '#ffeeee' : '#1a1a1a';
    const gunGlow = bot.fireCooldown > 0.3 ? '#ffffff' : bot.color;
    const flashing = bot.fireCooldown > 0.3;
    const layers = [
      { x0: 0.30, x1: 0.70, y0: 0.00, y1: 0.22, color: darkColor },        // head
      { x0: 0.35, x1: 0.45, y0: 0.08, y1: 0.14, color: bot.color },        // visor L
      { x0: 0.55, x1: 0.65, y0: 0.08, y1: 0.14, color: bot.color },        // visor R
      { x0: 0.25, x1: 0.75, y0: 0.22, y1: 0.62, color: bodyColor },        // torso
      { x0: 0.42, x1: 0.58, y0: 0.30, y1: 0.48, color: darkColor },        // chest panel
      { x0: 0.20, x1: 0.35, y0: 0.30, y1: 0.60, color: bodyColor },        // left arm
      { x0: 0.65, x1: 0.80, y0: 0.30, y1: 0.55, color: bodyColor },        // right arm
      { x0: 0.78, x1: 0.95, y0: 0.42, y1: 0.52, color: darkColor },        // gun body
      { x0: 0.88, x1: 1.00, y0: 0.44, y1: 0.50, color: gunGlow },          // gun barrel
      { x0: 0.28, x1: 0.48, y0: 0.62, y1: 0.95, color: darkColor },        // left leg
      { x0: 0.52, x1: 0.72, y0: 0.62, y1: 0.95, color: darkColor }         // right leg
    ];
    drawSpriteLayered(cx, sw, sh, dist, layers);
    if (flashing) {
      const left = cx - sw / 2;
      const cc = Math.floor((left + sw * 0.95) / colW);
      if (cc >= 0 && cc < NUM_RAYS && zBuf[cc] >= dist) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(left + sw * 0.95, H / 2 - sh * 0.5 + sh * 0.47, sw * 0.08, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  };

  const drawShield = (cx, sw, sh, dist) => {
    const size = Math.min(sw, sh) * 0.5;
    const t = performance.now() / 280;
    const hover = Math.sin(t) * size * 0.2;
    const cc = Math.floor(cx / colW);
    if (cc < 0 || cc >= NUM_RAYS || zBuf[cc] < dist) return;
    const y = H / 2 + hover;
    ctx.globalAlpha = 0.9;
    const grd = ctx.createRadialGradient(cx, y, 2, cx, y, size * 0.55);
    grd.addColorStop(0, '#b3e5fc');
    grd.addColorStop(0.6, '#29b6f6');
    grd.addColorStop(1, 'rgba(41, 182, 246, 0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(cx, y, size * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(10, Math.floor(size * 0.55))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('S', cx, y);
    ctx.globalAlpha = 1;
  };

  const drawBase = (cx, sw, sh, dist, color) => {
    const cc = Math.floor(cx / colW);
    if (cc < 0 || cc >= NUM_RAYS || zBuf[cc] < dist) return;
    const t = performance.now() / 400;
    const pulse = 0.75 + 0.25 * Math.sin(t * 3);

    // Bright vertical beam / pillar from floor to ceiling
    const beamW = Math.max(6, sw * 0.18);
    const beamH = H * 1.4;
    const beamTop = H / 2 - beamH * 0.55;
    ctx.globalAlpha = 0.55 * pulse;
    const pillar = ctx.createLinearGradient(cx - beamW, 0, cx + beamW, 0);
    pillar.addColorStop(0,   'rgba(0,0,0,0)');
    pillar.addColorStop(0.3, color);
    pillar.addColorStop(0.5, '#ffffff');
    pillar.addColorStop(0.7, color);
    pillar.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = pillar;
    ctx.fillRect(cx - beamW, beamTop, beamW * 2, beamH);

    // Bright floor ring at base
    const ringW = Math.max(12, sw * 0.55);
    const ringH = Math.max(4, sh * 0.08);
    const ringY = H / 2 + ringH;
    ctx.globalAlpha = 0.9 * pulse;
    const ringGrd = ctx.createRadialGradient(cx, ringY, 2, cx, ringY, ringW * 0.6);
    ringGrd.addColorStop(0, '#ffffff');
    ringGrd.addColorStop(0.35, color);
    ringGrd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ringGrd;
    ctx.beginPath();
    ctx.ellipse(cx, ringY, ringW * 0.6, ringH * 1.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // "BASE" label floating above ring
    const labelSize = Math.max(9, Math.min(18, sw * 0.22));
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${labelSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('BASE', cx, H / 2 - sh * 0.08);

    ctx.globalAlpha = 1;
  };

  const projectPoint = (wx, wy) => {
    const dx = wx - player.x, dy = wy - player.y;
    const dist = Math.hypot(dx, dy);
    const angleTo = Math.atan2(dy, dx);
    const diff = normAng(angleTo - player.angle);
    if (Math.abs(diff) > Math.PI / 2 - 0.05) return null;
    const corrected = dist * Math.cos(diff);
    if (corrected < 0.05) return null;
    const screenX = W / 2 + Math.tan(diff) * (W / 2) / Math.tan(FOV / 2);
    return { x: screenX, y: H / 2, dist: corrected };
  };

  const renderSprites = () => {
    const list = [];
    for (const e of players) {
      if (e === player || e.respawnTimer > 0) continue;
      list.push({ kind: 'bot', x: e.x, y: e.y, data: e });
    }
    for (const s of shields) if (s.active) list.push({ kind: 'shield', x: s.x, y: s.y });
    for (const id of [1, 2, 3]) {
      const b = bases[id];
      list.push({ kind: 'base', x: b.x, y: b.y, color: colors[id] });
    }
    for (const s of list) {
      const dx = s.x - player.x, dy = s.y - player.y;
      s.dist = Math.hypot(dx, dy);
      const angleTo = Math.atan2(dy, dx);
      s.diff = normAng(angleTo - player.angle);
    }
    list.sort((a, b) => b.dist - a.dist);
    for (const s of list) {
      if (Math.abs(s.diff) > FOV) continue;
      const corrected = s.dist * Math.cos(s.diff);
      if (corrected < 0.2) continue;
      const screenX = W / 2 + Math.tan(s.diff) * (W / 2) / Math.tan(FOV / 2);
      const size = H / corrected;
      if (s.kind === 'bot')         drawBot(screenX, size * 0.6, size * 0.95, corrected, s.data);
      else if (s.kind === 'shield') drawShield(screenX, size * 0.5, size * 0.5, corrected);
      else if (s.kind === 'base')   drawBase(screenX, size * 0.9, size * 0.5, corrected, s.color);
    }
  };

  const renderBeams = () => {
    for (const b of beams) {
      const alpha = b.life / b.maxLife;
      if (b.fromPlayer) {
        // 2D screen-space laser: gun barrel tip → past crosshair
        const barrelX = W / 2;
        const barrelY = H - 172;        // just above the gun tip
        const endY = H / 2 - 80;       // slightly above crosshair
        // Outer glow
        ctx.globalAlpha = alpha * 0.35;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 22;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(barrelX, barrelY); ctx.lineTo(barrelX, endY); ctx.stroke();
        // Mid glow
        ctx.globalAlpha = alpha * 0.65;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 8;
        ctx.beginPath(); ctx.moveTo(barrelX, barrelY); ctx.lineTo(barrelX, endY); ctx.stroke();
        // Bright core
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(barrelX, barrelY); ctx.lineTo(barrelX, endY); ctx.stroke();
        // Muzzle burst
        const burstAlpha = alpha * 0.9;
        ctx.globalAlpha = burstAlpha;
        const grd = ctx.createRadialGradient(barrelX, barrelY, 0, barrelX, barrelY, 38);
        grd.addColorStop(0, '#ffffff');
        grd.addColorStop(0.35, b.color);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(barrelX, barrelY, 38, 0, Math.PI * 2); ctx.fill();
        ctx.lineCap = 'butt';
        ctx.globalAlpha = 1;
      } else {
        // 3D projection for enemy beams
        const p1 = projectPoint(b.x1, b.y1);
        const p2 = projectPoint(b.x2, b.y2);
        if (!p1 || !p2) continue;
        ctx.globalAlpha = alpha * 0.55;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 10;
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        ctx.globalAlpha = alpha * 0.9;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        ctx.lineWidth = 1;
        ctx.globalAlpha = 1;
      }
    }
  };

  const drawGun = () => {
    const recoil = player.fireCooldown > 0.14 ? 14 : 0;
    const gx = W / 2, gy = H + recoil;
    ctx.fillStyle = '#1a1a22';
    ctx.beginPath();
    ctx.moveTo(gx - 80, gy); ctx.lineTo(gx - 50, gy - 90);
    ctx.lineTo(gx + 50, gy - 90); ctx.lineTo(gx + 80, gy);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2a2a35';
    ctx.fillRect(gx - 40, gy - 130, 80, 50);
    ctx.fillStyle = player.color;
    ctx.fillRect(gx - 28, gy - 128, 56, 6);
    ctx.fillStyle = '#333';
    ctx.fillRect(gx - 10, gy - 180, 20, 50);
    const justFired = player.fireCooldown > 0.14;
    ctx.fillStyle = justFired ? '#ffffff' : '#555';
    ctx.beginPath(); ctx.arc(gx, gy - 180, 9, 0, Math.PI * 2); ctx.fill();
    if (justFired) {
      // Bright muzzle corona
      ctx.globalAlpha = (player.fireCooldown / 0.28) * 0.85;
      const mgrd = ctx.createRadialGradient(gx, gy - 180, 0, gx, gy - 180, 40);
      mgrd.addColorStop(0, '#ffffff');
      mgrd.addColorStop(0.4, player.color);
      mgrd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = mgrd;
      ctx.beginPath(); ctx.arc(gx, gy - 180, 40, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // Crosshair — glows cyan right after firing
    const shotGlow = player.fireCooldown / 0.28;
    const chColor = shotGlow > 0
      ? `rgba(0,230,255,${0.7 + shotGlow * 0.3})`
      : 'rgba(255,255,255,0.7)';
    ctx.strokeStyle = chColor;
    ctx.lineWidth = shotGlow > 0 ? 2.5 : 2;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 10, H / 2); ctx.lineTo(W / 2 - 4, H / 2);
    ctx.moveTo(W / 2 + 4, H / 2); ctx.lineTo(W / 2 + 10, H / 2);
    ctx.moveTo(W / 2, H / 2 - 10); ctx.lineTo(W / 2, H / 2 - 4);
    ctx.moveTo(W / 2, H / 2 + 4); ctx.lineTo(W / 2, H / 2 + 10);
    ctx.stroke();
    ctx.lineWidth = 1;
  };

  const drawHUD = () => {
    if (player.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,30,30,${player.hitFlash * 0.45})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(10, 10, 180, 82);
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const sorted = [...players].sort((a, b) => b.score - a.score);
    ctx.fillStyle = '#ccc';
    ctx.fillText('SCORE', 20, 16);
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      ctx.fillStyle = p.color;
      ctx.fillText(`${names[p.id]}`, 20, 34 + i * 16);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'right';
      ctx.fillText(`${p.score}`, 180, 34 + i * 16);
      ctx.textAlign = 'left';
    }

    const barW = 220, barH = 14;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(20, H - 52, barW, barH);
    ctx.fillStyle = '#e53935';
    ctx.fillRect(20, H - 52, barW * (player.health / 100), barH);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('HP ' + Math.ceil(player.health), 26, H - 50);

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(20, H - 34, barW, barH);
    ctx.fillStyle = '#29b6f6';
    ctx.fillRect(20, H - 34, barW * (player.shield / 100), barH);
    ctx.fillStyle = '#fff';
    ctx.fillText('SHIELD ' + Math.ceil(player.shield), 26, H - 32);

    const remain = Math.max(0, MATCH_DURATION - (performance.now() - startTime));
    const mm = Math.floor(remain / 60000);
    const ss = Math.floor((remain % 60000) / 1000);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(W - 100, 10, 90, 36);
    ctx.fillStyle = remain < 15000 ? '#ff5252' : '#fff';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`${mm}:${ss.toString().padStart(2, '0')}`, W - 55, 28);

    if (player.respawnTimer > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ff5252';
      ctx.font = 'bold 32px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('TAGGED!', W / 2, H / 2 - 20);
      ctx.fillStyle = '#fff';
      ctx.font = '16px sans-serif';
      ctx.fillText(`Respawning in ${player.respawnTimer.toFixed(1)}s`, W / 2, H / 2 + 18);
    }

    if (player.tagFlash > 0) {
      ctx.globalAlpha = player.tagFlash;
      ctx.fillStyle = '#ffee58';
      ctx.font = 'bold 40px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('TAG!', W / 2, 90);
      ctx.globalAlpha = 1;
    }

    // Hit marker — red X at crosshair when a shot connects
    if (player.hitMarker > 0) {
      const a = player.hitMarker / 0.6;
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#ff1744';
      ctx.lineWidth = 3;
      const cx2 = W / 2, cy2 = H / 2, r = 11;
      ctx.beginPath();
      ctx.moveTo(cx2 - r, cy2 - r); ctx.lineTo(cx2 + r, cy2 + r);
      ctx.moveTo(cx2 + r, cy2 - r); ctx.lineTo(cx2 - r, cy2 + r);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.globalAlpha = 1;
    }

    if (onBase(player) && player.respawnTimer <= 0) {
      ctx.fillStyle = 'rgba(79, 195, 247, 0.15)';
      ctx.fillRect(0, H - 80, W, 80);
      ctx.fillStyle = '#4fc3f7';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillText('◉ AT BASE — healing', W - 20, H - 70);
    }
  };

  const drawMinimap = () => {
    const s = 7;
    const mw = MAP_W * s, mh = MAP_H * s;
    const ox = W - mw - 10, oy = H - mh - 60;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(ox - 4, oy - 4, mw + 8, mh + 8);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const c = MAP[y][x];
        if (c === '#') { ctx.fillStyle = '#334'; ctx.fillRect(ox + x * s, oy + y * s, s, s); }
        else if (c === '1' || c === '2' || c === '3') {
          ctx.fillStyle = colors[c] + '55';
          ctx.fillRect(ox + x * s, oy + y * s, s, s);
        }
      }
    }
    for (const sh of shields) if (sh.active) {
      ctx.fillStyle = '#29b6f6';
      ctx.fillRect(ox + sh.x * s - 1.5, oy + sh.y * s - 1.5, 3, 3);
    }
    for (const p of players) {
      if (p.respawnTimer > 0) continue;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(ox + p.x * s, oy + p.y * s, 2.5, 0, Math.PI * 2);
      ctx.fill();
      if (p === player) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ox + p.x * s, oy + p.y * s);
        ctx.lineTo(ox + (p.x + Math.cos(p.angle) * 1.5) * s, oy + (p.y + Math.sin(p.angle) * 1.5) * s);
        ctx.stroke();
      }
    }
  };

  const drawMenu = () => {
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const grad = ctx.createLinearGradient(W/2 - 200, 0, W/2 + 200, 0);
    grad.addColorStop(0, '#00e5ff'); grad.addColorStop(1, '#ff1744');
    ctx.fillStyle = grad;
    ctx.font = 'bold 56px sans-serif';
    ctx.fillText('LASER TAG', W / 2, H / 2 - 100);
    ctx.fillStyle = '#cfd8dc';
    ctx.font = '15px sans-serif';
    ctx.fillText('WASD to move · Mouse / arrows to look · Space or click to fire', W / 2, H / 2 - 30);
    ctx.fillText('Stand on your blue base to heal · Grab S shields for armor', W / 2, H / 2 - 8);
    ctx.fillText('Most tags in 2 minutes wins', W / 2, H / 2 + 14);
    ctx.fillStyle = '#ffee58';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('▶ CLICK TO START', W / 2, H / 2 + 70);
  };

  const drawGameOver = () => {
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, W, H);
    const sorted = [...players].sort((a, b) => b.score - a.score);
    const winner = sorted[0];
    const tied = sorted[1] && sorted[1].score === winner.score;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 40px sans-serif';
    ctx.fillText('MATCH OVER', W / 2, 100);
    ctx.fillStyle = tied ? '#fff' : winner.color;
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(tied ? 'IT\u0027S A TIE' : `${names[winner.id].toUpperCase()} WINS!`, W / 2, 150);
    ctx.font = '20px sans-serif';
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      ctx.fillStyle = p.color;
      ctx.fillText(`${names[p.id]}  —  ${p.score} tag${p.score === 1 ? '' : 's'}`, W / 2, 210 + i * 32);
    }
    ctx.fillStyle = '#ffee58';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('▶ CLICK TO PLAY AGAIN', W / 2, H - 60);
  };

  const drawPaused = () => {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText('PAUSED', W / 2, H / 2 - 10);
    ctx.font = '14px sans-serif';
    ctx.fillText('Press Esc to resume', W / 2, H / 2 + 26);
  };

  const resetGame = () => {
    for (const p of players) {
      p.score = 0; p.health = 100; p.shield = 0; p.respawnTimer = 0;
      p.fireCooldown = 0; p.hitFlash = 0; p.tagFlash = 0;
      const b = bases[p.id]; p.x = b.x; p.y = b.y;
      p.angle = Math.random() * Math.PI * 2;
    }
    for (const s of shields) { s.active = true; s.respawn = 0; }
    beams.length = 0;
    gameState = 'playing';
    startTime = performance.now();
    paused = false;
  };

  // Mobile controls
  const bindBtn = (id, down, up) => {
    const el = document.getElementById(id);
    if (!el) return;
    const d = e => { e.preventDefault(); down(); };
    const u = e => { e.preventDefault(); up && up(); };
    el.addEventListener('touchstart', d, { passive: false });
    el.addEventListener('touchend', u);
    el.addEventListener('touchcancel', u);
    el.addEventListener('mousedown', d);
    el.addEventListener('mouseup', u);
    el.addEventListener('mouseleave', u);
  };
  bindBtn('btn-up',    () => keys['KeyW'] = true,       () => keys['KeyW'] = false);
  bindBtn('btn-down',  () => keys['KeyS'] = true,       () => keys['KeyS'] = false);
  bindBtn('btn-left',  () => keys['ArrowLeft'] = true,  () => keys['ArrowLeft'] = false);
  bindBtn('btn-right', () => keys['ArrowRight'] = true, () => keys['ArrowRight'] = false);
  bindBtn('btn-fire',  () => {
    if (gameState === 'menu') { gameState = 'playing'; startTime = performance.now(); return; }
    if (gameState === 'gameover') { resetGame(); return; }
    input.fire = true;
  });

  const loop = t => {
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    if (gameState === 'playing' && !paused) {
      updateState(dt);
      if (t - startTime >= MATCH_DURATION) gameState = 'gameover';
    }
    renderWalls();
    renderSprites();
    renderBeams();
    drawGun();
    drawHUD();
    drawMinimap();
    if (gameState === 'menu') drawMenu();
    if (gameState === 'gameover') drawGameOver();
    if (paused) drawPaused();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();
