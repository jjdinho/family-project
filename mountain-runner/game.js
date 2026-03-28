// ============================================================
//  MOUNTAIN RUNNER — top-down obstacle-dodge game
// ============================================================

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// ----- dimensions -----
const W = canvas.width;   // 500
const H = canvas.height;  // 700
const TRACK_L = 100;
const TRACK_R = 400;
const TRACK_W = TRACK_R - TRACK_L; // 300

// ----- colours -----
const COL = {
  // mountain terrain
  slope:      "#6B6358",
  slopeDark:  "#544D44",
  slopeLight: "#7E756A",
  rockFace:   "#8A8279",
  scree:      "#9E9487",
  snow:       "#E8E4DF",
  snowShadow: "#C5BFB7",
  // trail
  track:      "#8B7D6B",
  trackLine:  "#6E6355",
  trackEdge:  "#5A5045",
  gravel:     "#A09080",
  // obstacles
  rock:       "#7D7D7D",
  rockDark:   "#5A5A5A",
  lightning:  "#FFE740",
  lightBolt:  "#FFFFFF",
  wind:       "rgba(180,220,255,0.45)",
  windArrow:  "rgba(200,235,255,0.7)",
  trap:       "#1C1C1C",
  trapEdge:   "#3A2A1A",
  tennis:     "#C8E632",
  tennisDark: "#9AB21E",
  cannon:     "#555555",
  // HUD
  health:     "#44CC44",
  healthLow:  "#DD3333",
  hud:        "#FFFFFF",
  hudShadow:  "rgba(0,0,0,0.6)",
};

// ----- pre-generated mountain peaks for background -----
let peaks = [];
let snowPatches = [];
let edgeRocks = [];

// ----- player config -----
const PW = 26;
const PH = 34;
const P_SPEED = 5;

// ----- obstacle damage -----
const DMG = { rock: 20, lightning: 30, wind: 0, trapdoor: 0, tennis: 15, cliff: 25 };

// ============================================================
//  STATE
// ============================================================
let player, obstacles, particles;
let score, highScore, gameSpeed, baseSpeed;
let spawnTimer, spawnInterval;
let frameCount, running, gameOver, paused;
let trackOffset;
let keys = {};

// terrain pebbles (pre-generated for deterministic look)
let pebbles = [];

function init() {
  player = {
    x: (TRACK_L + TRACK_R) / 2 - PW / 2,
    y: H - 120,
    w: PW, h: PH,
    health: 100,
    maxHealth: 100,
    invince: 0,
    trapped: false,
    trapProgress: 0,
    trapRequired: 15,
    runFrame: 0,
    jumping: false,
    jumpTimer: 0,
    jumpDuration: 30,
    jumpCooldown: 0,
  };

  obstacles = [];
  particles = [];
  score = 0;
  baseSpeed = 3;
  gameSpeed = baseSpeed;
  spawnTimer = 0;
  spawnInterval = 110;
  frameCount = 0;
  running = false;
  gameOver = false;
  paused = false;
  trackOffset = 0;

  // generate trail gravel
  pebbles = [];
  for (let i = 0; i < 50; i++) {
    pebbles.push({
      x: TRACK_L + 10 + Math.random() * (TRACK_W - 20),
      y: Math.random() * H,
      r: 1 + Math.random() * 2.5,
    });
  }

  // generate mountain edge rocks
  edgeRocks = [];
  for (let i = 0; i < 30; i++) {
    const onLeft = i < 15;
    edgeRocks.push({
      x: onLeft ? Math.random() * (TRACK_L - 10) : TRACK_R + 5 + Math.random() * (W - TRACK_R - 15),
      y: Math.random() * (H + 80),
      w: 10 + Math.random() * 20,
      h: 8 + Math.random() * 14,
      shade: Math.random() * 0.15,
    });
  }

  // generate snow patches on slopes
  snowPatches = [];
  for (let i = 0; i < 12; i++) {
    const onLeft = i < 6;
    snowPatches.push({
      x: onLeft ? 5 + Math.random() * (TRACK_L - 25) : TRACK_R + 10 + Math.random() * (W - TRACK_R - 30),
      y: Math.random() * (H + 60),
      w: 15 + Math.random() * 25,
      h: 8 + Math.random() * 12,
    });
  }

  // generate distant mountain peaks (drawn at the very top as a horizon)
  peaks = [];
  for (let i = 0; i < 10; i++) {
    peaks.push({
      x: i * 60 - 30,
      height: 50 + Math.random() * 80,
      width: 50 + Math.random() * 40,
      snow: 0.3 + Math.random() * 0.25,
    });
  }

  draw();
  drawOverlay("MOUNTAIN RUNNER", "Press any arrow key to start", "#e94560");
}

// ============================================================
//  INPUT
// ============================================================
document.addEventListener("keydown", (e) => {
  const k = e.key;

  // toggle pause with Escape or P
  if ((k === "Escape" || k === "p" || k === "P") && running && !gameOver) {
    e.preventDefault();
    paused = !paused;
    if (paused) keys = {}; // clear held keys on pause
    return;
  }

  if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(k)) {
    e.preventDefault();
    if (paused) return; // ignore game input while paused
    keys[k] = true;

    if (!running && !gameOver) { running = true; }
    if (gameOver) { init(); running = true; }
    if (k === " " && player.trapped) { player.trapProgress++; spawnParticles(player.x + PW/2, player.y + PH/2, 2, "#FFD700"); }
  }
});

document.addEventListener("keyup", (e) => { keys[e.key] = false; });

// mobile buttons
function bindBtn(id, key) {
  const el = document.getElementById(id);
  if (!el) return;
  const down = () => { keys[key] = true; el.classList.add("pressed"); if (!running && !gameOver) running = true; if (gameOver) { init(); running = true; } };
  const up = () => { keys[key] = false; el.classList.remove("pressed"); };
  el.addEventListener("touchstart", (e) => { e.preventDefault(); down(); });
  el.addEventListener("touchend", (e) => { e.preventDefault(); up(); });
}
bindBtn("btn-up", "ArrowUp");
bindBtn("btn-down", "ArrowDown");
bindBtn("btn-left", "ArrowLeft");
bindBtn("btn-right", "ArrowRight");

// mash button for mobile
const mashBtn = document.getElementById("btn-mash");
if (mashBtn) {
  mashBtn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    mashBtn.classList.add("pressed");
    if (player.trapped) { player.trapProgress++; spawnParticles(player.x + PW/2, player.y + PH/2, 2, "#FFD700"); }
    if (!running && !gameOver) running = true;
    if (gameOver) { init(); running = true; }
  });
  mashBtn.addEventListener("touchend", (e) => { e.preventDefault(); mashBtn.classList.remove("pressed"); });
}

// ============================================================
//  PARTICLES (simple juice)
// ============================================================
function spawnParticles(x, y, count, color) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 4,
      vy: (Math.random() - 0.5) * 4,
      life: 20 + Math.random() * 15,
      color,
      r: 2 + Math.random() * 2,
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, p.life / 10);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ============================================================
//  OBSTACLE SPAWNING
// ============================================================
function spawnObstacle() {
  const types = ["rock", "lightning", "wind", "trapdoor", "tennis", "cliff"];
  const type = types[Math.floor(Math.random() * types.length)];
  let obs = { type, hit: false };

  switch (type) {
    case "rock": {
      const w = 40 + Math.random() * 30;
      const h = 36 + Math.random() * 24;
      obs.x = TRACK_L + 10 + Math.random() * (TRACK_W - w - 20);
      obs.y = -h - 10;
      obs.w = w;
      obs.h = h;
      break;
    }
    case "lightning": {
      const r = 45;
      obs.cx = TRACK_L + r + Math.random() * (TRACK_W - r * 2);
      obs.cy = -r - 10;
      obs.radius = r;
      obs.warning = 100; // frames of warning before strike
      obs.striking = false;
      obs.strikeTimer = 0;
      obs.strikeDuration = 18;
      // bounding rect for scrolling
      obs.x = obs.cx - r;
      obs.y = obs.cy - r;
      obs.w = r * 2;
      obs.h = r * 2;
      break;
    }
    case "wind": {
      const dir = Math.random() < 0.5 ? -1 : 1; // push left or right
      obs.x = TRACK_L;
      obs.y = -90;
      obs.w = TRACK_W;
      obs.h = 80;
      obs.pushX = dir * 3.5;
      obs.pushY = 1.5;
      obs.dir = dir;
      break;
    }
    case "trapdoor": {
      const w = 55;
      const h = 45;
      obs.x = TRACK_L + 20 + Math.random() * (TRACK_W - w - 40);
      obs.y = -h - 10;
      obs.w = w;
      obs.h = h;
      break;
    }
    case "tennis": {
      const fromLeft = Math.random() < 0.5;
      obs.x = fromLeft ? TRACK_L - 20 : TRACK_R + 4;
      obs.y = -30;
      obs.w = 16;
      obs.h = 16;
      obs.vx = fromLeft ? 5.5 : -5.5;
      obs.fromLeft = fromLeft;
      // cannon position
      obs.cannonX = fromLeft ? TRACK_L - 10 : TRACK_R - 10;
      break;
    }
    case "cliff": {
      // chasm splits the trail — one side is void, the other is safe
      const safeSide = Math.random() < 0.5 ? "left" : "right";
      obs.x = TRACK_L;
      obs.y = -120;
      obs.w = TRACK_W;
      obs.h = 110;
      obs.safeSide = safeSide;
      obs.gapWidth = TRACK_W / 2 + 10; // the void takes slightly more than half
      break;
    }
  }

  obstacles.push(obs);
}

// ============================================================
//  COLLISION HELPER
// ============================================================
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

function circleRectOverlap(cx, cy, r, rect) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < r * r;
}

// ============================================================
//  UPDATE
// ============================================================
function update() {
  if (gameOver || !running || paused) return;

  if (player.trapped) { updateTrapped(); return; }

  frameCount++;

  // difficulty ramp
  if (frameCount % 350 === 0) {
    baseSpeed += 0.2;
    if (spawnInterval > 45) spawnInterval -= 4;
  }
  gameSpeed = baseSpeed;

  // score
  score = Math.floor(frameCount / 5);

  // player movement — left/right to dodge, down to run forward
  if (keys["ArrowLeft"])  player.x -= P_SPEED;
  if (keys["ArrowRight"]) player.x += P_SPEED;
  if (keys["ArrowDown"])  player.y -= P_SPEED; // run forward (up on screen)

  // jump
  if (keys["ArrowUp"] && !player.jumping && player.jumpCooldown <= 0) {
    player.jumping = true;
    player.jumpTimer = player.jumpDuration;
  }
  if (player.jumping) {
    player.jumpTimer--;
    if (player.jumpTimer <= 0) {
      player.jumping = false;
      player.jumpCooldown = 12;
    }
  }
  if (player.jumpCooldown > 0) player.jumpCooldown--;

  // clamp to track
  player.x = Math.max(TRACK_L + 4, Math.min(TRACK_R - PW - 4, player.x));
  player.y = Math.max(60, Math.min(H - PH - 10, player.y));

  // invincibility
  if (player.invince > 0) player.invince--;

  // animation
  player.runFrame += 0.18;

  // scroll track
  trackOffset = (trackOffset + gameSpeed) % 40;

  // scroll pebbles
  for (const p of pebbles) {
    p.y += gameSpeed;
    if (p.y > H + 5) p.y -= H + 10;
  }

  // dust particles while running
  if (frameCount % 4 === 0) {
    spawnParticles(player.x + PW / 2, player.y + PH, 1, "#B89A70");
  }

  // spawn obstacles
  spawnTimer++;
  if (spawnTimer >= spawnInterval) {
    spawnObstacle();
    spawnTimer = 0;
  }

  // update obstacles
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const obs = obstacles[i];

    // scroll down
    obs.y += gameSpeed;
    if (obs.type === "lightning") obs.cy += gameSpeed;

    // tennis ball horizontal movement
    if (obs.type === "tennis") {
      obs.x += obs.vx;
    }

    // lightning phases
    if (obs.type === "lightning") {
      if (obs.warning > 0) {
        obs.warning--;
        if (obs.warning <= 0) obs.striking = true;
      }
      if (obs.striking) {
        obs.strikeTimer++;
        if (obs.strikeTimer >= obs.strikeDuration) {
          obs.hit = true; // mark done
        }
      }
    }

    // remove off-screen
    if (obs.y > H + 60 || obs.x > W + 60 || obs.x + (obs.w || 0) < -60) {
      obstacles.splice(i, 1);
      continue;
    }

    // collision
    if (obs.hit || player.invince > 0) continue;

    const pRect = { x: player.x, y: player.y, w: PW, h: PH };

    switch (obs.type) {
      case "rock":
        if (!player.jumping && rectsOverlap(pRect, obs)) {
          takeDamage(DMG.rock);
          obs.hit = true;
          spawnParticles(player.x + PW/2, player.y + PH/2, 6, COL.rock);
        }
        break;

      case "lightning":
        if (obs.striking && obs.strikeTimer < obs.strikeDuration) {
          if (circleRectOverlap(obs.cx, obs.cy, obs.radius * 0.7, pRect)) {
            takeDamage(DMG.lightning);
            obs.hit = true;
            spawnParticles(player.x + PW/2, player.y + PH/2, 8, COL.lightning);
          }
        }
        break;

      case "wind":
        if (rectsOverlap(pRect, obs)) {
          // push player
          if (!keys[obs.dir > 0 ? "ArrowLeft" : "ArrowRight"]) {
            player.x += obs.pushX * 0.7;
          } else {
            player.x += obs.pushX * 0.2; // partial resist
          }
          if (!keys["ArrowUp"]) {
            player.y += obs.pushY;
          }
          // clamp
          player.x = Math.max(TRACK_L + 4, Math.min(TRACK_R - PW - 4, player.x));
          player.y = Math.min(H - PH - 10, player.y);
          // blown off track edge = damage
          if (player.x <= TRACK_L + 5 || player.x >= TRACK_R - PW - 5) {
            if (frameCount % 15 === 0) {
              takeDamage(8);
              spawnParticles(player.x + PW/2, player.y + PH/2, 3, "#AAE");
            }
          }
        }
        break;

      case "trapdoor":
        if (!player.jumping && rectsOverlap(pRect, obs)) {
          player.trapped = true;
          player.trapProgress = 0;
          obs.hit = true;
        }
        break;

      case "cliff": {
        // only check if player is vertically inside the chasm zone
        const inZone = pRect.y + pRect.h > obs.y && pRect.y < obs.y + obs.h;
        if (inZone) {
          const playerCx = pRect.x + pRect.w / 2;
          const trackMid = (TRACK_L + TRACK_R) / 2;
          const onLeft = playerCx < trackMid;
          if ((obs.safeSide === "left" && !onLeft) || (obs.safeSide === "right" && onLeft)) {
            // player is on the void side
            takeDamage(DMG.cliff);
            obs.hit = true;
            spawnParticles(player.x + PW/2, player.y + PH/2, 10, "#4A4040");
          }
        }
        break;
      }

      case "tennis":
        if (rectsOverlap(pRect, obs)) {
          takeDamage(DMG.tennis);
          obs.hit = true;
          spawnParticles(player.x + PW/2, player.y + PH/2, 5, COL.tennis);
        }
        break;
    }
  }

  updateParticles();
}

// ----- trapped state -----
function updateTrapped() {
  frameCount++;

  // health drain
  if (frameCount % 12 === 0) {
    player.health -= 1;
    if (player.health <= 0) { player.health = 0; endGame(); return; }
  }

  // escape check
  if (player.trapProgress >= player.trapRequired) {
    player.trapped = false;
    player.invince = 90;
    spawnParticles(player.x + PW/2, player.y + PH/2, 12, "#FFD700");
  }

  // obstacles still scroll (slower)
  for (let i = obstacles.length - 1; i >= 0; i--) {
    obstacles[i].y += gameSpeed * 0.25;
    if (obstacles[i].y > H + 60) obstacles.splice(i, 1);
  }

  // scroll track slowly
  trackOffset = (trackOffset + gameSpeed * 0.25) % 40;

  updateParticles();
}

function takeDamage(amount) {
  player.health = Math.max(0, player.health - amount);
  player.invince = 45;
  if (player.health <= 0) endGame();
}

function endGame() {
  gameOver = true;
  running = false;
  if (score > highScore) {
    highScore = score;
    localStorage.setItem("mountain_runner_hs", highScore);
  }
}

// ============================================================
//  DRAW
// ============================================================
function draw() {
  // sky gradient — high altitude mountain sky
  const skyGrad = ctx.createLinearGradient(0, 0, 0, 140);
  skyGrad.addColorStop(0, "#3A5B8C");
  skyGrad.addColorStop(0.6, "#6A9BC5");
  skyGrad.addColorStop(1, "#9AB8D4");
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, 140);

  // fill rest with slope color
  ctx.fillStyle = COL.slope;
  ctx.fillRect(0, 140, W, H - 140);

  drawMountainPeaks();
  drawTerrain();
  drawTrack();
  drawObstacles();
  if (!player.trapped) drawPlayer();
  drawParticles();
  drawHUD();

  if (player.trapped) drawTrappedOverlay();
  if (paused) drawOverlay("PAUSED", "Press Escape or P to resume", "#FFD700");
  if (gameOver) drawOverlay("GAME OVER", `Score: ${score}  |  High: ${highScore}\nPress any arrow key to restart`, "#e94560");
}

// ----- distant mountain peaks (horizon) -----
function drawMountainPeaks() {
  const baseY = 140;
  const scrollX = (trackOffset * 0.3) % 60;

  for (const pk of peaks) {
    const px = pk.x - scrollX;
    // dark mountain silhouette
    ctx.fillStyle = "#4A5568";
    ctx.beginPath();
    ctx.moveTo(px, baseY);
    ctx.lineTo(px + pk.width / 2, baseY - pk.height);
    ctx.lineTo(px + pk.width, baseY);
    ctx.closePath();
    ctx.fill();

    // snow cap
    ctx.fillStyle = COL.snow;
    ctx.beginPath();
    const snowY = baseY - pk.height;
    const snowH = pk.height * pk.snow;
    ctx.moveTo(px + pk.width * 0.3, snowY + snowH);
    ctx.lineTo(px + pk.width / 2, snowY);
    ctx.lineTo(px + pk.width * 0.7, snowY + snowH);
    ctx.closePath();
    ctx.fill();
  }
}

// ----- terrain (rocky mountain slopes) -----
function drawTerrain() {
  // left slope
  ctx.fillStyle = COL.slopeDark;
  ctx.fillRect(0, 140, TRACK_L, H - 140);
  // right slope
  ctx.fillRect(TRACK_R, 140, W - TRACK_R, H - 140);

  // lighter scree patches (scrolling)
  ctx.fillStyle = COL.slopeLight;
  for (let y = 0; y < H; y += 55) {
    const yy = (y + trackOffset * 1.0) % (H + 40) - 20;
    ctx.fillRect(8, yy, 22, 10);
    ctx.fillRect(50, yy + 25, 18, 8);
    ctx.fillRect(TRACK_R + 12, yy + 12, 20, 9);
    ctx.fillRect(TRACK_R + 58, yy + 35, 16, 8);
  }

  // edge rocks (boulders on slopes)
  for (const r of edgeRocks) {
    const yy = (r.y + trackOffset * 0.9) % (H + 80) - 40;
    ctx.fillStyle = `rgba(100,95,88,${0.6 + r.shade})`;
    ctx.beginPath();
    ctx.ellipse(r.x + r.w / 2, yy + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    // rock highlight
    ctx.fillStyle = "rgba(180,175,165,0.25)";
    ctx.beginPath();
    ctx.ellipse(r.x + r.w * 0.35, yy + r.h * 0.35, r.w / 4, r.h / 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // snow patches on slopes
  for (const s of snowPatches) {
    const yy = (s.y + trackOffset * 0.7) % (H + 60) - 30;
    ctx.fillStyle = COL.snow;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.ellipse(s.x + s.w / 2, yy + s.h / 2, s.w / 2, s.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // cliff edge along track — rough rocky border
  ctx.strokeStyle = COL.trackEdge;
  ctx.lineWidth = 3;
  // left edge
  ctx.beginPath();
  for (let y = 0; y < H; y += 6) {
    const jitter = Math.sin(y * 0.3 + trackOffset * 0.5) * 3;
    if (y === 0) ctx.moveTo(TRACK_L + jitter, y);
    else ctx.lineTo(TRACK_L + jitter, y);
  }
  ctx.stroke();
  // right edge
  ctx.beginPath();
  for (let y = 0; y < H; y += 6) {
    const jitter = Math.sin(y * 0.25 + trackOffset * 0.4 + 2) * 3;
    if (y === 0) ctx.moveTo(TRACK_R + jitter, y);
    else ctx.lineTo(TRACK_R + jitter, y);
  }
  ctx.stroke();
}

// ----- mountain trail -----
function drawTrack() {
  // trail surface — worn rocky path
  const trailGrad = ctx.createLinearGradient(TRACK_L, 0, TRACK_R, 0);
  trailGrad.addColorStop(0, "#7A6E5E");
  trailGrad.addColorStop(0.3, COL.track);
  trailGrad.addColorStop(0.7, COL.track);
  trailGrad.addColorStop(1, "#7A6E5E");
  ctx.fillStyle = trailGrad;
  ctx.fillRect(TRACK_L, 0, TRACK_W, H);

  // worn center line (faded foot path)
  ctx.setLineDash([30, 25]);
  ctx.lineDashOffset = -trackOffset * 2;
  ctx.strokeStyle = "rgba(110,99,85,0.4)";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo((TRACK_L + TRACK_R) / 2, 0);
  ctx.lineTo((TRACK_L + TRACK_R) / 2, H);
  ctx.stroke();
  ctx.setLineDash([]);

  // gravel and small stones
  for (const p of pebbles) {
    ctx.fillStyle = COL.gravel;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.r, p.r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    // tiny shadow
    ctx.fillStyle = "rgba(0,0,0,0.1)";
    ctx.beginPath();
    ctx.ellipse(p.x + 1, p.y + 1, p.r, p.r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // elevation lines (contour marks scrolling with the trail)
  ctx.strokeStyle = "rgba(90,80,69,0.2)";
  ctx.lineWidth = 1;
  for (let y = 0; y < H; y += 80) {
    const yy = (y + trackOffset * 2) % (H + 40) - 20;
    ctx.beginPath();
    ctx.moveTo(TRACK_L + 10, yy);
    ctx.lineTo(TRACK_R - 10, yy);
    ctx.stroke();
  }
}

// ----- player -----
function drawPlayer() {
  if (player.invince > 0 && Math.floor(player.invince / 3) % 2 === 0) return; // blink

  const cx = player.x + PW / 2;

  // jump arc: parabolic lift
  let jumpHeight = 0;
  if (player.jumping) {
    const progress = 1 - player.jumpTimer / player.jumpDuration;
    jumpHeight = Math.sin(progress * Math.PI) * 24;
  }

  const by = player.y - jumpHeight; // top of player (lifted when jumping)

  // shadow on the ground (stays at ground level, shrinks when airborne)
  const shadowScale = player.jumping ? 0.6 : 1;
  ctx.fillStyle = player.jumping ? "rgba(0,0,0,0.12)" : "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(cx, player.y + PH + 2, (PW / 2 + 2) * shadowScale, 5 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();

  const legPhase = Math.sin(player.runFrame * 4);

  // legs
  ctx.strokeStyle = "#16213E";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  // left leg
  ctx.beginPath();
  ctx.moveTo(cx - 5, by + 22);
  ctx.lineTo(cx - 5 + legPhase * 4, by + PH - 2);
  ctx.stroke();
  // right leg
  ctx.beginPath();
  ctx.moveTo(cx + 5, by + 22);
  ctx.lineTo(cx + 5 - legPhase * 4, by + PH - 2);
  ctx.stroke();

  // body / shirt
  ctx.fillStyle = "#E94560";
  ctx.fillRect(cx - 8, by + 10, 16, 15);

  // arms
  ctx.strokeStyle = "#FFD1A4";
  ctx.lineWidth = 3;
  // left arm
  ctx.beginPath();
  ctx.moveTo(cx - 8, by + 13);
  ctx.lineTo(cx - 13, by + 13 + legPhase * 5);
  ctx.stroke();
  // right arm
  ctx.beginPath();
  ctx.moveTo(cx + 8, by + 13);
  ctx.lineTo(cx + 13, by + 13 - legPhase * 5);
  ctx.stroke();

  // head
  ctx.fillStyle = "#FFD1A4";
  ctx.beginPath();
  ctx.arc(cx, by + 7, 7, 0, Math.PI * 2);
  ctx.fill();
  // hair
  ctx.fillStyle = "#5C3A1E";
  ctx.beginPath();
  ctx.arc(cx, by + 5, 7, Math.PI, Math.PI * 2);
  ctx.fill();
}

// ----- obstacles -----
function drawObstacles() {
  for (const obs of obstacles) {
    if (obs.hit && obs.type !== "lightning") continue;

    switch (obs.type) {
      case "rock": drawRock(obs); break;
      case "lightning": drawLightning(obs); break;
      case "wind": drawWind(obs); break;
      case "trapdoor": drawTrapdoor(obs); break;
      case "tennis": drawTennis(obs); break;
      case "cliff": drawCliff(obs); break;
    }
  }
}

function drawRock(obs) {
  // boulder shadow
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  ctx.beginPath();
  ctx.ellipse(obs.x + obs.w / 2, obs.y + obs.h + 3, obs.w / 2, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // main boulder
  ctx.fillStyle = COL.rock;
  ctx.beginPath();
  ctx.ellipse(obs.x + obs.w / 2, obs.y + obs.h / 2, obs.w / 2, obs.h / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // shading
  ctx.fillStyle = COL.rockDark;
  ctx.beginPath();
  ctx.ellipse(obs.x + obs.w / 2 + 4, obs.y + obs.h / 2 + 3, obs.w / 3, obs.h / 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // highlight
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.beginPath();
  ctx.ellipse(obs.x + obs.w / 3, obs.y + obs.h / 3, obs.w / 6, obs.h / 6, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawLightning(obs) {
  // warning circle
  if (obs.warning > 0) {
    const pulse = 0.5 + 0.5 * Math.sin(frameCount * 0.3);
    ctx.strokeStyle = `rgba(255,231,64,${0.3 + pulse * 0.5})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(obs.cx, obs.cy, obs.radius, 0, Math.PI * 2);
    ctx.stroke();

    // inner warning
    ctx.fillStyle = `rgba(255,231,64,${0.05 + pulse * 0.1})`;
    ctx.beginPath();
    ctx.arc(obs.cx, obs.cy, obs.radius, 0, Math.PI * 2);
    ctx.fill();

    // warning icon
    ctx.fillStyle = `rgba(255,200,0,${0.5 + pulse * 0.4})`;
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("⚡", obs.cx, obs.cy + 7);
  }

  // strike
  if (obs.striking && obs.strikeTimer < obs.strikeDuration) {
    // flash
    const intensity = 1 - obs.strikeTimer / obs.strikeDuration;
    ctx.fillStyle = `rgba(255,255,200,${intensity * 0.3})`;
    ctx.beginPath();
    ctx.arc(obs.cx, obs.cy, obs.radius * 1.2, 0, Math.PI * 2);
    ctx.fill();

    // bolt
    ctx.strokeStyle = COL.lightBolt;
    ctx.lineWidth = 4;
    ctx.shadowColor = COL.lightning;
    ctx.shadowBlur = 15;
    drawBolt(obs.cx, obs.cy - obs.radius, obs.cx, obs.cy + obs.radius);
    ctx.shadowBlur = 0;

    // core
    ctx.strokeStyle = COL.lightning;
    ctx.lineWidth = 2;
    drawBolt(obs.cx, obs.cy - obs.radius, obs.cx, obs.cy + obs.radius);
  }
}

function drawBolt(x1, y1, x2, y2) {
  const segments = 5;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const mx = x1 + (x2 - x1) * t + (Math.random() - 0.5) * 20;
    const my = y1 + (y2 - y1) * t;
    ctx.lineTo(mx, my);
  }
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawWind(obs) {
  // wind zone background
  ctx.fillStyle = COL.wind;
  ctx.fillRect(obs.x, obs.y, obs.w, obs.h);

  // arrow streaks
  ctx.strokeStyle = COL.windArrow;
  ctx.lineWidth = 2;
  const arrowDir = obs.dir;
  for (let row = 0; row < 3; row++) {
    const yy = obs.y + 15 + row * 25;
    const phase = (frameCount * 3 + row * 40) % (TRACK_W + 40) - 20;
    const sx = arrowDir > 0 ? TRACK_L + phase : TRACK_R - phase;

    ctx.beginPath();
    ctx.moveTo(sx, yy);
    ctx.lineTo(sx + arrowDir * 30, yy);
    ctx.stroke();
    // arrowhead
    ctx.beginPath();
    ctx.moveTo(sx + arrowDir * 30, yy);
    ctx.lineTo(sx + arrowDir * 22, yy - 5);
    ctx.moveTo(sx + arrowDir * 30, yy);
    ctx.lineTo(sx + arrowDir * 22, yy + 5);
    ctx.stroke();
  }

  // label
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "bold 14px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("WIND", (TRACK_L + TRACK_R) / 2, obs.y + obs.h / 2 + 5);
}

function drawTrapdoor(obs) {
  // dark hole
  ctx.fillStyle = COL.trap;
  ctx.fillRect(obs.x, obs.y, obs.w, obs.h);

  // edge
  ctx.strokeStyle = COL.trapEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(obs.x, obs.y, obs.w, obs.h);

  // bars hint (jail below)
  ctx.strokeStyle = "#555";
  ctx.lineWidth = 2;
  for (let bx = obs.x + 8; bx < obs.x + obs.w; bx += 10) {
    ctx.beginPath();
    ctx.moveTo(bx, obs.y);
    ctx.lineTo(bx, obs.y + obs.h);
    ctx.stroke();
  }

  // warning text
  ctx.fillStyle = "#C44";
  ctx.font = "bold 10px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("TRAP", obs.x + obs.w / 2, obs.y + obs.h / 2 + 4);
}

function drawTennis(obs) {
  if (obs.hit) return;

  // cannon on edge (if visible)
  const canY = obs.y;
  if (canY > -20 && canY < H) {
    ctx.fillStyle = COL.cannon;
    const canX = obs.fromLeft ? TRACK_L - 14 : TRACK_R + 2;
    ctx.fillRect(canX, canY - 6, 16, 20);
    ctx.fillStyle = "#444";
    ctx.beginPath();
    ctx.arc(canX + 8, canY + 4, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // tennis ball
  ctx.fillStyle = COL.tennis;
  ctx.beginPath();
  ctx.arc(obs.x + obs.w / 2, obs.y + obs.h / 2, obs.w / 2, 0, Math.PI * 2);
  ctx.fill();

  // seam line
  ctx.strokeStyle = COL.tennisDark;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(obs.x + obs.w / 2, obs.y + obs.h / 2, obs.w / 2 - 2, -0.5, 1.5);
  ctx.stroke();

  // motion trail
  ctx.fillStyle = "rgba(200,230,50,0.25)";
  for (let t = 1; t <= 3; t++) {
    ctx.beginPath();
    ctx.arc(obs.x + obs.w / 2 - obs.vx * t * 2, obs.y + obs.h / 2, obs.w / 2 - t, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCliff(obs) {
  if (obs.hit) return;

  const trackMid = (TRACK_L + TRACK_R) / 2;
  const safeLeft = obs.safeSide === "left";

  // --- void side (chasm) ---
  const voidX = safeLeft ? trackMid - 15 : TRACK_L;
  const voidW = safeLeft ? TRACK_R - trackMid + 15 : trackMid - TRACK_L + 15;

  // deep chasm darkness
  ctx.fillStyle = "#1A1210";
  ctx.fillRect(voidX, obs.y, voidW, obs.h);

  // depth layers for 3D feel
  ctx.fillStyle = "#2A2220";
  ctx.fillRect(voidX + 6, obs.y + 6, voidW - 12, obs.h - 12);
  ctx.fillStyle = "#0E0A08";
  ctx.fillRect(voidX + 14, obs.y + 14, voidW - 28, obs.h - 28);

  // jagged edges along the crack
  ctx.fillStyle = COL.slopeDark;
  for (let yy = obs.y; yy < obs.y + obs.h; yy += 8) {
    const jag = Math.sin(yy * 0.7) * 6 + 3;
    // inner edge of void
    if (safeLeft) {
      ctx.fillRect(voidX - jag, yy, jag + 2, 8);
    } else {
      ctx.fillRect(voidX + voidW - 2, yy, jag + 2, 8);
    }
  }

  // --- safe side (solid cliff) ---
  const safeX = safeLeft ? TRACK_L : trackMid - 15;
  const safeW = safeLeft ? trackMid - TRACK_L + 15 : TRACK_R - trackMid + 15;

  // solid ground with slightly different shade to show it's the landing zone
  ctx.fillStyle = "#7A6E5E";
  ctx.fillRect(safeX, obs.y, safeW, obs.h);

  // rock texture on safe side
  ctx.fillStyle = "#8A7E6E";
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 2; col++) {
      const rx = safeX + 8 + col * (safeW / 2 - 10);
      const ry = obs.y + 10 + row * 35;
      ctx.fillRect(rx, ry, safeW / 2 - 16, 12);
    }
  }

  // arrow indicator — shows which side to jump to
  const arrowX = safeX + safeW / 2;
  const arrowY = obs.y + obs.h / 2;
  const pulse = 0.6 + 0.4 * Math.sin(frameCount * 0.15);

  ctx.fillStyle = `rgba(80,255,80,${pulse})`;
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(safeLeft ? "◄" : "►", arrowX, arrowY + 10);

  // "JUMP!" label
  ctx.fillStyle = `rgba(255,255,255,${pulse})`;
  ctx.font = "bold 12px sans-serif";
  ctx.fillText("JUMP!", arrowX, arrowY - 14);

  // crack line down the middle
  ctx.strokeStyle = "#0E0A08";
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let yy = obs.y; yy < obs.y + obs.h; yy += 5) {
    const jx = trackMid + Math.sin(yy * 0.5) * 8;
    if (yy === obs.y) ctx.moveTo(jx, yy);
    else ctx.lineTo(jx, yy);
  }
  ctx.stroke();
}

// ----- HUD -----
function drawHUD() {
  const barW = 160;
  const barH = 16;
  const barX = 20;
  const barY = 14;

  // health bar background
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);

  // health bar fill
  const pct = player.health / player.maxHealth;
  const hpCol = pct > 0.5 ? COL.health : pct > 0.25 ? "#CCAA22" : COL.healthLow;
  ctx.fillStyle = hpCol;
  ctx.fillRect(barX, barY, barW * pct, barH);

  // health text
  ctx.fillStyle = COL.hud;
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`HP ${player.health}`, barX + 4, barY + 12);

  // low health pulse
  if (pct <= 0.25 && Math.sin(frameCount * 0.2) > 0) {
    ctx.strokeStyle = "#FF0000";
    ctx.lineWidth = 2;
    ctx.strokeRect(barX - 1, barY - 1, barW + 2, barH + 2);
  }

  // score
  ctx.fillStyle = COL.hud;
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "right";
  ctx.shadowColor = COL.hudShadow;
  ctx.shadowBlur = 3;
  ctx.fillText(`${score}m`, W - 20, 28);
  ctx.font = "12px sans-serif";
  ctx.fillText(`Best: ${highScore}m`, W - 20, 46);
  ctx.shadowBlur = 0;

  // speed indicator
  ctx.font = "11px sans-serif";
  ctx.fillStyle = "#CCC";
  ctx.textAlign = "left";
  ctx.fillText(`Speed: ${gameSpeed.toFixed(1)}`, 20, 50);
}

// ----- trapped overlay -----
function drawTrappedOverlay() {
  // dim background
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, W, H);

  // jail cell
  const jx = W / 2 - 80;
  const jy = H / 2 - 90;
  const jw = 160;
  const jh = 160;

  // cell background
  ctx.fillStyle = "#1A1A1A";
  ctx.fillRect(jx, jy, jw, jh);

  // stone wall texture
  ctx.fillStyle = "#2A2A2A";
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      const bx = jx + 5 + col * 52 + (row % 2) * 20;
      const by = jy + 5 + row * 40;
      ctx.fillRect(bx, by, 46, 34);
    }
  }

  // player behind bars (simplified)
  const pcx = W / 2;
  const pcy = H / 2 + 5;
  ctx.fillStyle = "#E94560";
  ctx.fillRect(pcx - 8, pcy - 10, 16, 20);
  ctx.fillStyle = "#FFD1A4";
  ctx.beginPath();
  ctx.arc(pcx, pcy - 16, 7, 0, Math.PI * 2);
  ctx.fill();

  // bars
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 5;
  for (let bx = jx + 12; bx < jx + jw; bx += 20) {
    ctx.beginPath();
    ctx.moveTo(bx, jy);
    ctx.lineTo(bx, jy + jh);
    ctx.stroke();
  }
  // horizontal bars
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(jx, jy + jh * 0.33);
  ctx.lineTo(jx + jw, jy + jh * 0.33);
  ctx.moveTo(jx, jy + jh * 0.66);
  ctx.lineTo(jx + jw, jy + jh * 0.66);
  ctx.stroke();

  // escape prompt
  ctx.fillStyle = "#FFD700";
  ctx.font = "bold 22px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("MASH SPACE TO ESCAPE!", W / 2, jy - 20);

  // progress bar
  const pbx = W / 2 - 70;
  const pby = jy + jh + 20;
  const pbw = 140;
  const pbh = 20;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(pbx, pby, pbw, pbh);
  const progress = Math.min(1, player.trapProgress / player.trapRequired);
  ctx.fillStyle = progress >= 1 ? "#44FF44" : "#FFD700";
  ctx.fillRect(pbx, pby, pbw * progress, pbh);
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 2;
  ctx.strokeRect(pbx, pby, pbw, pbh);

  // progress text
  ctx.fillStyle = "#FFF";
  ctx.font = "bold 12px sans-serif";
  ctx.fillText(`${player.trapProgress} / ${player.trapRequired}`, W / 2, pby + 15);

  // health drain warning
  ctx.fillStyle = "#FF4444";
  ctx.font = "13px sans-serif";
  ctx.fillText("Health draining...", W / 2, pby + 45);
}

// ----- generic overlay (start / game over) -----
function drawOverlay(title, subtitle, color) {
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = color;
  ctx.font = "bold 36px sans-serif";
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 6;
  ctx.fillText(title, W / 2, H / 2 - 30);

  ctx.fillStyle = "#DDD";
  ctx.font = "16px sans-serif";
  ctx.shadowBlur = 3;
  const lines = subtitle.split("\n");
  lines.forEach((line, i) => {
    ctx.fillText(line, W / 2, H / 2 + 10 + i * 24);
  });

  ctx.shadowBlur = 0;
}

// ============================================================
//  GAME LOOP
// ============================================================
function gameLoop() {
  update();
  draw();
  requestAnimationFrame(gameLoop);
}

// ============================================================
//  BOOT
// ============================================================
highScore = parseInt(localStorage.getItem("mountain_runner_hs") || "0", 10);
init();
requestAnimationFrame(gameLoop);
