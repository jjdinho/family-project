// ============================================================
//  RAINBOW UNICORN — guide the unicorn across the rainbow to the princess
// ============================================================

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const W = canvas.width;   // 800 (viewport)
const H = canvas.height;  // 520

// World is much wider than the viewport — the camera scrolls with the unicorn.
const WORLD_W = 3200;

// Rainbow band geometry (horizontal bands forming a wide path across the screen)
const RAINBOW_COLORS = [
  "#ff4d4d", // red
  "#ff9e3d", // orange
  "#ffe14d", // yellow
  "#5fd96b", // green
  "#5ab7ff", // blue
  "#8e5fff", // indigo
  "#d760ff", // violet
];

const BAND_TOP = 90;
const BAND_BOTTOM = H - 60;
const BAND_HEIGHT = BAND_BOTTOM - BAND_TOP;
const BAND_W = BAND_HEIGHT / RAINBOW_COLORS.length;

// Play zone limits for the unicorn (world coordinates)
const START_X = 40;
const PRINCESS_X = WORLD_W - 90;
const GOAL_X = PRINCESS_X - 20;

// World landmarks (clouds placed along the journey, in world coords)
const WORLD_CLOUDS = [
  { x: 70,          y: BAND_TOP - 10, r: 70 },
  { x: 40,          y: BAND_BOTTOM + 8, r: 80 },
  { x: 520,         y: BAND_TOP - 14, r: 65 },
  { x: 760,         y: BAND_BOTTOM + 12, r: 72 },
  { x: 1100,        y: BAND_TOP - 8,  r: 75 },
  { x: 1380,        y: BAND_BOTTOM + 6, r: 70 },
  { x: 1700,        y: BAND_TOP - 16, r: 85 },
  { x: 1980,        y: BAND_BOTTOM + 10, r: 78 },
  { x: 2300,        y: BAND_TOP - 10, r: 70 },
  { x: 2580,        y: BAND_BOTTOM + 8, r: 82 },
  { x: WORLD_W - 80, y: BAND_TOP - 14, r: 80 },
  { x: WORLD_W - 50, y: BAND_BOTTOM + 10, r: 75 },
];

// Unicorn config
const UW = 52;
const UH = 42;
const U_SPEED = 3.5;

// Cat config (follows behind unicorn)
const CW = 44;
const CH = 34;
const CAT_OFFSET_X = -44; // cat trails behind and slightly below the unicorn
const CAT_OFFSET_Y = 8;

// Heart config
const HEART_SIZE = 28;

// ============================================================
//  STATE
// ============================================================
let unicorn, cat, hearts, particles, sparkles;
let lives, frameCount, spawnTimer, spawnInterval;
let state; // "playing" | "won" | "lost" | "hit"
let keys = {};
let hitFlash = 0;
let winTimer = 0;
let hearts_start_delay;
let camera = { x: 0 };

function reset() {
  unicorn = {
    x: START_X + 50, // leave room for the cat behind
    y: H / 2 - UH / 2,
    w: UW,
    h: UH,
    invince: 0,
    bob: 0,
    facing: 1, // 1 = right, -1 = left
  };
  cat = {
    x: unicorn.x + CAT_OFFSET_X,
    y: unicorn.y + CAT_OFFSET_Y,
    w: CW,
    h: CH,
    invince: 0,
    bob: 0,
    facing: 1,
  };
  hearts = [];
  particles = [];
  sparkles = [];
  lives = 3;
  frameCount = 0;
  spawnTimer = 0;
  spawnInterval = 40;
  state = "playing";
  hitFlash = 0;
  winTimer = 0;
  hearts_start_delay = 60;
  camera.x = 0;
}

// ============================================================
//  INPUT
// ============================================================
window.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;
  if (state === "won" || state === "lost") {
    if (e.key === " " || e.key === "Enter") {
      reset();
    }
  }
  if (["arrowup","arrowdown","arrowleft","arrowright"," "].includes(e.key.toLowerCase())) {
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
});

// Mobile / touch d-pad
function bindBtn(id, keyName) {
  const btn = document.getElementById(id);
  if (!btn) return;
  const on  = (e) => { e.preventDefault(); keys[keyName] = true; btn.classList.add("pressed"); };
  const off = (e) => { e.preventDefault(); keys[keyName] = false; btn.classList.remove("pressed"); };
  btn.addEventListener("touchstart", on, { passive: false });
  btn.addEventListener("touchend", off);
  btn.addEventListener("touchcancel", off);
  btn.addEventListener("mousedown", on);
  btn.addEventListener("mouseup", off);
  btn.addEventListener("mouseleave", off);
}
bindBtn("btn-up", "arrowup");
bindBtn("btn-down", "arrowdown");
bindBtn("btn-left", "arrowleft");
bindBtn("btn-right", "arrowright");

// Tap canvas to restart after win/loss
canvas.addEventListener("touchstart", (e) => {
  if (state === "won" || state === "lost") {
    e.preventDefault();
    reset();
  }
}, { passive: false });
canvas.addEventListener("mousedown", () => {
  if (state === "won" || state === "lost") reset();
});

// ============================================================
//  SPAWNING
// ============================================================
function spawnHeart() {
  // Hearts enter from the right side, drift leftward with vertical wobble.
  // Some spawn from top/bottom and cross vertically.
  const mode = Math.random();
  if (mode < 0.65) {
    // horizontal drifter
    hearts.push({
      x: camera.x + W + 20,
      y: BAND_TOP + 10 + Math.random() * (BAND_HEIGHT - 20),
      vx: -(1.6 + Math.random() * 1.4),
      vy: 0,
      wobbleAmp: 10 + Math.random() * 25,
      wobbleFreq: 0.04 + Math.random() * 0.04,
      wobbleBase: 0,
      phase: Math.random() * Math.PI * 2,
      size: HEART_SIZE - 2 + Math.random() * 8,
      spin: (Math.random() - 0.5) * 0.05,
      rot: Math.random() * Math.PI * 2,
      mode: "drift",
    });
    const last = hearts[hearts.length - 1];
    last.wobbleBase = last.y;
  } else if (mode < 0.85) {
    // vertical crosser
    const fromTop = Math.random() < 0.5;
    hearts.push({
      x: camera.x + 180 + Math.random() * (W - 300),
      y: fromTop ? BAND_TOP - 30 : BAND_BOTTOM + 30,
      vx: (Math.random() - 0.5) * 1.2,
      vy: fromTop ? 1.4 + Math.random() : -(1.4 + Math.random()),
      wobbleAmp: 0,
      wobbleFreq: 0,
      wobbleBase: 0,
      phase: 0,
      size: HEART_SIZE + Math.random() * 6,
      spin: (Math.random() - 0.5) * 0.04,
      rot: Math.random() * Math.PI * 2,
      mode: "cross",
    });
  } else {
    // slow floaters (stay inside band for a while)
    hearts.push({
      x: camera.x + W + 20,
      y: BAND_TOP + 20 + Math.random() * (BAND_HEIGHT - 40),
      vx: -(0.8 + Math.random() * 0.6),
      vy: 0,
      wobbleAmp: 30 + Math.random() * 40,
      wobbleFreq: 0.02 + Math.random() * 0.02,
      wobbleBase: 0,
      phase: Math.random() * Math.PI * 2,
      size: HEART_SIZE + 4 + Math.random() * 6,
      spin: (Math.random() - 0.5) * 0.03,
      rot: 0,
      mode: "floater",
    });
    const last = hearts[hearts.length - 1];
    last.wobbleBase = last.y;
  }
}

// ============================================================
//  COLLISION
// ============================================================
function hitsCharacter(ch, heart) {
  const cx = ch.x + ch.w / 2;
  const cy = ch.y + ch.h / 2;
  const rx = ch.w * 0.38;
  const ry = ch.h * 0.42;
  const r = heart.size * 0.38;
  const dxh = cx - heart.x;
  const dyh = cy - heart.y;
  return (dxh * dxh) / ((rx + r) * (rx + r)) + (dyh * dyh) / ((ry + r) * (ry + r)) < 1;
}

// ============================================================
//  UPDATE
// ============================================================
function update() {
  frameCount++;

  if (state === "playing") {
    // --- unicorn movement ---
    let dx = 0, dy = 0;
    if (keys["arrowleft"] || keys["a"])  dx -= 1;
    if (keys["arrowright"] || keys["d"]) dx += 1;
    if (keys["arrowup"] || keys["w"])    dy -= 1;
    if (keys["arrowdown"] || keys["s"])  dy += 1;

    if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }

    if (dx < 0) unicorn.facing = -1;
    else if (dx > 0) unicorn.facing = 1;

    unicorn.x += dx * U_SPEED;
    unicorn.y += dy * U_SPEED;

    // clamp to play area (world bounds) — leave space on the left for the cat
    if (unicorn.x < 4 - CAT_OFFSET_X) unicorn.x = 4 - CAT_OFFSET_X;
    if (unicorn.x > WORLD_W - UW - 4) unicorn.x = WORLD_W - UW - 4;
    if (unicorn.y < BAND_TOP - 10) unicorn.y = BAND_TOP - 10;
    if (unicorn.y > BAND_BOTTOM - UH + 10) unicorn.y = BAND_BOTTOM - UH + 10;

    // cat follows the unicorn in formation
    cat.x = unicorn.x + CAT_OFFSET_X;
    cat.y = unicorn.y + CAT_OFFSET_Y;
    cat.facing = unicorn.facing;

    // camera follows the unicorn with a leading offset
    const camTarget = unicorn.x + unicorn.w / 2 - W * 0.35;
    camera.x += (camTarget - camera.x) * 0.12;
    if (camera.x < 0) camera.x = 0;
    if (camera.x > WORLD_W - W) camera.x = WORLD_W - W;

    unicorn.bob = Math.sin(frameCount * 0.2) * 2;
    cat.bob = Math.sin(frameCount * 0.25 + 1.2) * 2;

    if (unicorn.invince > 0) unicorn.invince--;
    if (cat.invince > 0) cat.invince--;

    // sparkle trail
    if (frameCount % 4 === 0) {
      sparkles.push({
        x: unicorn.x + (unicorn.facing > 0 ? 4 : UW - 4),
        y: unicorn.y + UH - 6 + (Math.random() - 0.5) * 6,
        life: 30,
        maxLife: 30,
        hue: (frameCount * 8) % 360,
        size: 2 + Math.random() * 2,
      });
    }

    // --- spawn hearts ---
    if (hearts_start_delay > 0) {
      hearts_start_delay--;
    } else {
      spawnTimer++;
      if (spawnTimer >= spawnInterval) {
        spawnTimer = 0;
        spawnHeart();
        // gently ramp difficulty
        spawnInterval = Math.max(22, spawnInterval - 0.4);
      }
    }

    // --- update hearts ---
    for (let i = hearts.length - 1; i >= 0; i--) {
      const h = hearts[i];
      h.x += h.vx;
      if (h.mode === "drift" || h.mode === "floater") {
        h.y = h.wobbleBase + Math.sin(frameCount * h.wobbleFreq + h.phase) * h.wobbleAmp;
      } else {
        h.y += h.vy;
      }
      h.rot += h.spin;

      // remove offscreen (camera-relative for horizontal, canvas for vertical)
      if (h.x < camera.x - 80 || h.x > camera.x + W + 100 || h.y < -60 || h.y > H + 60) {
        hearts.splice(i, 1);
        continue;
      }

      // collision — heart hits if it overlaps EITHER character (whichever is not invincible)
      const hitUnicorn = unicorn.invince <= 0 && hitsCharacter(unicorn, h);
      const hitCat     = !hitUnicorn && cat.invince <= 0 && hitsCharacter(cat, h);

      if (hitUnicorn || hitCat) {
        lives--;
        // brief invincibility for both so a single heart can't double-tap them
        unicorn.invince = 90;
        cat.invince = 90;
        hitFlash = 18;
        // knockback the pair
        unicorn.x -= 30;
        if (unicorn.x < 4 - CAT_OFFSET_X) unicorn.x = 4 - CAT_OFFSET_X;
        // explode heart into particles
        for (let p = 0; p < 14; p++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 1 + Math.random() * 2.5;
          particles.push({
            x: h.x, y: h.y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: 24 + Math.random() * 10,
            maxLife: 30,
            color: "#ff6fa8",
            size: 2 + Math.random() * 2,
          });
        }
        hearts.splice(i, 1);
        if (lives <= 0) {
          state = "lost";
        }
      }
    }

    // --- win check ---
    if (unicorn.x + unicorn.w >= GOAL_X) {
      state = "won";
      winTimer = 0;
      // burst of sparkles at princess
      for (let i = 0; i < 60; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 1 + Math.random() * 4;
        particles.push({
          x: PRINCESS_X, y: H / 2,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 1,
          life: 60 + Math.random() * 30,
          maxLife: 90,
          color: `hsl(${(i * 20) % 360}, 90%, 65%)`,
          size: 2 + Math.random() * 3,
        });
      }
    }
  }

  if (state === "won") winTimer++;

  // --- update particles / sparkles ---
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.06;
    p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (let i = sparkles.length - 1; i >= 0; i--) {
    const s = sparkles[i];
    s.life--;
    s.y -= 0.3;
    if (s.life <= 0) sparkles.splice(i, 1);
  }

  if (hitFlash > 0) hitFlash--;
}

// ============================================================
//  DRAWING
// ============================================================
function drawBackground() {
  // starfield-ish night sky
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#1a0830");
  g.addColorStop(0.5, "#2a1250");
  g.addColorStop(1, "#401a70");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // twinkle stars (deterministic-ish)
  for (let i = 0; i < 60; i++) {
    const sx = (i * 97) % W;
    const sy = (i * 53) % (BAND_TOP - 10);
    const tw = 0.5 + 0.5 * Math.sin(frameCount * 0.05 + i);
    ctx.fillStyle = `rgba(255,255,255,${0.4 + tw * 0.5})`;
    ctx.fillRect(sx, sy + 4, 2, 2);
  }

}

function drawWorldClouds() {
  // only render clouds within the visible window (camera-relative cull)
  const left = camera.x - 100;
  const right = camera.x + W + 100;
  for (const c of WORLD_CLOUDS) {
    if (c.x + c.r < left || c.x - c.r > right) continue;
    drawCloud(c.x, c.y, c.r);
  }
}

function drawCloud(cx, cy, r) {
  ctx.fillStyle = "rgba(255, 230, 255, 0.85)";
  ctx.beginPath();
  ctx.arc(cx - r * 0.4, cy, r * 0.35, 0, Math.PI * 2);
  ctx.arc(cx,           cy - r * 0.1, r * 0.42, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.4, cy, r * 0.38, 0, Math.PI * 2);
  ctx.arc(cx - r * 0.15, cy + r * 0.15, r * 0.32, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.2,  cy + r * 0.18, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
}

function drawRainbow() {
  // horizontal rainbow bands spanning the full world
  for (let i = 0; i < RAINBOW_COLORS.length; i++) {
    ctx.fillStyle = RAINBOW_COLORS[i];
    ctx.fillRect(0, BAND_TOP + i * BAND_W, WORLD_W, BAND_W + 1);
  }
  // soft edges
  const topFade = ctx.createLinearGradient(0, BAND_TOP - 10, 0, BAND_TOP + 8);
  topFade.addColorStop(0, "rgba(0,0,0,0)");
  topFade.addColorStop(1, "rgba(255,255,255,0.25)");
  ctx.fillStyle = topFade;
  ctx.fillRect(0, BAND_TOP - 10, WORLD_W, 18);

  const botFade = ctx.createLinearGradient(0, BAND_BOTTOM - 8, 0, BAND_BOTTOM + 10);
  botFade.addColorStop(0, "rgba(255,255,255,0.2)");
  botFade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = botFade;
  ctx.fillRect(0, BAND_BOTTOM - 8, WORLD_W, 18);

  // subtle shimmer lines
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < RAINBOW_COLORS.length; i++) {
    ctx.fillRect(0, BAND_TOP + i * BAND_W + 1, WORLD_W, 2);
  }
  ctx.globalAlpha = 1;
}

function drawHeart(x, y, size, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const s = size / 32;
  ctx.scale(s, s);

  // shadow
  ctx.fillStyle = "rgba(80, 0, 40, 0.25)";
  ctx.beginPath();
  ctx.moveTo(0, 12);
  ctx.bezierCurveTo(-18, -2, -18, -20, 0, -8);
  ctx.bezierCurveTo(18, -20, 18, -2, 0, 12);
  ctx.fill();

  // main heart
  ctx.fillStyle = "#ff3d7d";
  ctx.beginPath();
  ctx.moveTo(0, 10);
  ctx.bezierCurveTo(-16, -4, -16, -20, 0, -10);
  ctx.bezierCurveTo(16, -20, 16, -4, 0, 10);
  ctx.fill();

  // highlight
  ctx.fillStyle = "rgba(255, 220, 240, 0.7)";
  ctx.beginPath();
  ctx.ellipse(-5, -8, 3.5, 5, -0.4, 0, Math.PI * 2);
  ctx.fill();

  // outline
  ctx.strokeStyle = "#8a0033";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 10);
  ctx.bezierCurveTo(-16, -4, -16, -20, 0, -10);
  ctx.bezierCurveTo(16, -20, 16, -4, 0, 10);
  ctx.stroke();

  ctx.restore();
}

function drawUnicorn(x, y, facing) {
  ctx.save();
  ctx.translate(x + UW / 2, y + UH / 2);
  if (facing < 0) ctx.scale(-1, 1);
  ctx.translate(-UW / 2, -UH / 2);

  // blink when invincible
  if (unicorn.invince > 0 && Math.floor(frameCount / 4) % 2 === 0) {
    ctx.globalAlpha = 0.4;
  }

  // body
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#9a7ac0";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(26, 26, 18, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // legs
  ctx.fillStyle = "#ffffff";
  const legBob = Math.sin(frameCount * 0.4) * 2;
  ctx.fillRect(14, 32, 4, 10 + legBob);
  ctx.fillRect(22, 34, 4, 10 - legBob);
  ctx.fillRect(30, 34, 4, 10 + legBob);
  ctx.fillRect(38, 32, 4, 10 - legBob);
  ctx.strokeRect(14, 32, 4, 10 + legBob);
  ctx.strokeRect(22, 34, 4, 10 - legBob);
  ctx.strokeRect(30, 34, 4, 10 + legBob);
  ctx.strokeRect(38, 32, 4, 10 - legBob);

  // head
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(43, 18, 9, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // snout
  ctx.beginPath();
  ctx.ellipse(49, 22, 5, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // ear
  ctx.beginPath();
  ctx.moveTo(40, 10);
  ctx.lineTo(44, 4);
  ctx.lineTo(46, 12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // horn
  ctx.fillStyle = "#ffe75a";
  ctx.strokeStyle = "#b08820";
  ctx.beginPath();
  ctx.moveTo(46, 10);
  ctx.lineTo(50, -2);
  ctx.lineTo(52, 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // horn stripes
  ctx.strokeStyle = "#b08820";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(47.5, 6); ctx.lineTo(51, 5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(48.5, 2); ctx.lineTo(51, 1); ctx.stroke();

  // eye
  ctx.fillStyle = "#1a0830";
  ctx.beginPath();
  ctx.arc(45, 17, 1.5, 0, Math.PI * 2);
  ctx.fill();

  // rainbow mane
  const maneColors = ["#ff4d4d", "#ff9e3d", "#ffe14d", "#5fd96b", "#5ab7ff", "#b06bff"];
  for (let i = 0; i < maneColors.length; i++) {
    ctx.fillStyle = maneColors[i];
    ctx.beginPath();
    ctx.ellipse(36 - i * 1.2, 14 + i * 2.2, 5, 3, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // rainbow tail
  for (let i = 0; i < maneColors.length; i++) {
    ctx.fillStyle = maneColors[i];
    const sway = Math.sin(frameCount * 0.1 + i * 0.4) * 1.5;
    ctx.beginPath();
    ctx.ellipse(8 - i * 1.5, 24 + i * 1.8 + sway, 4, 2.5, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawCat(x, y, facing) {
  ctx.save();
  ctx.translate(x + CW / 2, y + CH / 2);
  if (facing < 0) ctx.scale(-1, 1);
  ctx.translate(-CW / 2, -CH / 2);

  if (cat.invince > 0 && Math.floor(frameCount / 4) % 2 === 0) {
    ctx.globalAlpha = 0.4;
  }

  const bodyFill   = "#f5a65a"; // orange tabby
  const bodyStroke = "#8a4a1a";
  const stripe     = "#c87030";
  const bellyFill  = "#ffe1bc";

  // tail (curled up behind)
  ctx.strokeStyle = bodyStroke;
  ctx.lineWidth = 1.5;
  ctx.fillStyle = bodyFill;
  ctx.beginPath();
  const tSway = Math.sin(frameCount * 0.15) * 2;
  ctx.moveTo(4, 20);
  ctx.quadraticCurveTo(-6 + tSway, 12, -2 + tSway, 2);
  ctx.quadraticCurveTo(2 + tSway, -4, 6 + tSway, 0);
  ctx.quadraticCurveTo(2 + tSway, 6, 8, 18);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // body (ellipse)
  ctx.fillStyle = bodyFill;
  ctx.beginPath();
  ctx.ellipse(22, 22, 15, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // belly
  ctx.fillStyle = bellyFill;
  ctx.beginPath();
  ctx.ellipse(22, 26, 10, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // body stripes
  ctx.strokeStyle = stripe;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(16, 16); ctx.lineTo(18, 22);
  ctx.moveTo(22, 14); ctx.lineTo(22, 22);
  ctx.moveTo(28, 16); ctx.lineTo(26, 22);
  ctx.stroke();

  // legs
  ctx.fillStyle = bodyFill;
  ctx.strokeStyle = bodyStroke;
  ctx.lineWidth = 1.2;
  const legBob = Math.sin(frameCount * 0.4) * 2;
  ctx.fillRect(14, 28, 4, 6 + legBob);
  ctx.fillRect(20, 30, 4, 4 - legBob);
  ctx.fillRect(26, 30, 4, 4 + legBob);
  ctx.fillRect(32, 28, 4, 6 - legBob);
  ctx.strokeRect(14, 28, 4, 6 + legBob);
  ctx.strokeRect(20, 30, 4, 4 - legBob);
  ctx.strokeRect(26, 30, 4, 4 + legBob);
  ctx.strokeRect(32, 28, 4, 6 - legBob);

  // head
  ctx.fillStyle = bodyFill;
  ctx.beginPath();
  ctx.arc(36, 16, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // ears (triangular)
  ctx.fillStyle = bodyFill;
  ctx.beginPath();
  ctx.moveTo(30, 10); ctx.lineTo(32, 3); ctx.lineTo(35, 10);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(38, 10); ctx.lineTo(41, 3); ctx.lineTo(43, 10);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // inner ears
  ctx.fillStyle = "#ff9fb5";
  ctx.beginPath();
  ctx.moveTo(31.5, 9); ctx.lineTo(32.5, 6); ctx.lineTo(34, 9);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(39, 9); ctx.lineTo(40.5, 6); ctx.lineTo(42, 9);
  ctx.closePath(); ctx.fill();

  // eyes
  ctx.fillStyle = "#1a0830";
  ctx.beginPath(); ctx.arc(33, 15, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(39, 15, 1.5, 0, Math.PI * 2); ctx.fill();
  // eye sparkle
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.arc(33.5, 14.5, 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(39.5, 14.5, 0.5, 0, Math.PI * 2); ctx.fill();

  // nose
  ctx.fillStyle = "#e04870";
  ctx.beginPath();
  ctx.moveTo(36, 18); ctx.lineTo(34.5, 17); ctx.lineTo(37.5, 17);
  ctx.closePath();
  ctx.fill();

  // mouth
  ctx.strokeStyle = "#8a4a1a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(36, 18.5); ctx.lineTo(36, 20);
  ctx.moveTo(36, 20); ctx.quadraticCurveTo(34, 21.5, 33, 20);
  ctx.moveTo(36, 20); ctx.quadraticCurveTo(38, 21.5, 39, 20);
  ctx.stroke();

  // whiskers
  ctx.strokeStyle = "rgba(80, 40, 10, 0.6)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(32, 18); ctx.lineTo(27, 17);
  ctx.moveTo(32, 19); ctx.lineTo(27, 20);
  ctx.moveTo(40, 18); ctx.lineTo(45, 17);
  ctx.moveTo(40, 19); ctx.lineTo(45, 20);
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawPrincess(x, y) {
  ctx.save();
  ctx.translate(x, y);

  // glow
  const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 60);
  glow.addColorStop(0, "rgba(255, 220, 255, 0.55)");
  glow.addColorStop(1, "rgba(255, 220, 255, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, 60, 0, Math.PI * 2);
  ctx.fill();

  // dress (triangle)
  ctx.fillStyle = "#ff6fd6";
  ctx.strokeStyle = "#8a0068";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-22, 40);
  ctx.lineTo(22, 40);
  ctx.lineTo(8, -4);
  ctx.lineTo(-8, -4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // dress trim
  ctx.fillStyle = "#ffc0e8";
  ctx.fillRect(-22, 36, 44, 4);

  // arms
  ctx.fillStyle = "#ffd8b8";
  ctx.fillRect(-14, 0, 4, 18);
  ctx.fillRect(10, 0, 4, 18);

  // head
  ctx.fillStyle = "#ffd8b8";
  ctx.strokeStyle = "#a06848";
  ctx.beginPath();
  ctx.arc(0, -14, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // hair
  ctx.fillStyle = "#8a4020";
  ctx.beginPath();
  ctx.arc(0, -16, 11, Math.PI * 1.1, Math.PI * 1.9);
  ctx.fill();
  // hair sides
  ctx.fillRect(-11, -16, 4, 14);
  ctx.fillRect(7, -16, 4, 14);

  // crown
  ctx.fillStyle = "#ffe75a";
  ctx.strokeStyle = "#a07820";
  ctx.beginPath();
  ctx.moveTo(-8, -22);
  ctx.lineTo(-6, -28);
  ctx.lineTo(-3, -24);
  ctx.lineTo(0, -30);
  ctx.lineTo(3, -24);
  ctx.lineTo(6, -28);
  ctx.lineTo(8, -22);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // jewels
  ctx.fillStyle = "#ff4d8d";
  ctx.beginPath(); ctx.arc(0, -25, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#5ab7ff";
  ctx.beginPath(); ctx.arc(-5, -24, 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(5, -24, 1.2, 0, Math.PI * 2); ctx.fill();

  // eyes
  ctx.fillStyle = "#1a0830";
  ctx.beginPath(); ctx.arc(-3.5, -14, 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(3.5, -14, 1.2, 0, Math.PI * 2); ctx.fill();

  // smile
  ctx.strokeStyle = "#a04060";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, -11, 2.5, 0.2, Math.PI - 0.2);
  ctx.stroke();

  ctx.restore();
}

function drawParticles() {
  for (const p of particles) {
    const alpha = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const s of sparkles) {
    const alpha = Math.max(0, s.life / s.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = `hsl(${s.hue}, 90%, 70%)`;
    // sparkle = small 4-point star
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `hsla(${s.hue}, 90%, 80%, ${alpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s.x - s.size * 2, s.y); ctx.lineTo(s.x + s.size * 2, s.y);
    ctx.moveTo(s.x, s.y - s.size * 2); ctx.lineTo(s.x, s.y + s.size * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawHUD() {
  // lives (hearts in upper left)
  ctx.font = "bold 16px 'Segoe UI', sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.fillText("Lives:", 12, 26);

  for (let i = 0; i < 3; i++) {
    const x = 66 + i * 28;
    const y = 20;
    ctx.save();
    ctx.translate(x, y);
    const s = 0.7;
    ctx.scale(s, s);
    ctx.fillStyle = i < lives ? "#ff3d7d" : "rgba(255,255,255,0.15)";
    ctx.strokeStyle = i < lives ? "#8a0033" : "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.bezierCurveTo(-16, -4, -16, -20, 0, -10);
    ctx.bezierCurveTo(16, -20, 16, -4, 0, 10);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // progress to princess
  const progress = Math.min(1, Math.max(0, (unicorn.x - START_X) / (GOAL_X - START_X)));
  const barX = W - 220;
  const barY = 16;
  const barW = 200;
  const barH = 14;
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.fillRect(barX, barY, barW, barH);
  const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  grad.addColorStop(0,   "#ff4d4d");
  grad.addColorStop(0.25,"#ffe14d");
  grad.addColorStop(0.5, "#5fd96b");
  grad.addColorStop(0.75,"#5ab7ff");
  grad.addColorStop(1,   "#d760ff");
  ctx.fillStyle = grad;
  ctx.fillRect(barX, barY, barW * progress, barH);
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barW, barH);
}

function drawHitFlash() {
  if (hitFlash > 0) {
    ctx.fillStyle = `rgba(255, 80, 120, ${hitFlash / 18 * 0.35})`;
    ctx.fillRect(0, 0, W, H);
  }
}

function drawOverlay(title, subtitle, titleColor) {
  ctx.fillStyle = "rgba(10, 0, 25, 0.6)";
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";
  ctx.font = "bold 56px 'Segoe UI', sans-serif";
  ctx.fillStyle = titleColor;
  ctx.fillText(title, W / 2, H / 2 - 20);

  ctx.font = "18px 'Segoe UI', sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(subtitle, W / 2, H / 2 + 20);

  ctx.font = "14px 'Segoe UI', sans-serif";
  ctx.fillStyle = "#d0b0e8";
  ctx.fillText("Press Space / Enter or tap to play again", W / 2, H / 2 + 50);
}

function draw() {
  // screen-fixed background (stars stay put)
  drawBackground();

  // ----- world-space render: translate by -camera.x -----
  ctx.save();
  ctx.translate(-Math.round(camera.x), 0);

  drawRainbow();
  drawWorldClouds();

  // princess glow/beckon
  drawPrincess(PRINCESS_X, H / 2);

  // start marker (little cloud platform where unicorn begins)
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath();
  ctx.ellipse(START_X + 14, H / 2 + UH / 2 + 6, 28, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // hearts
  for (const h of hearts) {
    drawHeart(h.x, h.y, h.size, h.rot);
  }

  // sparkles behind unicorn
  drawParticles();

  // cat (drawn behind the unicorn visually — lower z)
  drawCat(cat.x, cat.y + cat.bob, cat.facing);

  // unicorn
  drawUnicorn(unicorn.x, unicorn.y + unicorn.bob, unicorn.facing);

  ctx.restore();
  // ----- end world-space -----

  drawHitFlash();
  drawHUD();

  if (state === "won") {
    // extra sparkle burst
    drawOverlay("YOU WIN!", "The princess is so happy to see you!", "#ffe75a");
  } else if (state === "lost") {
    drawOverlay("GAME OVER", "The hearts were too much! Try again?", "#ff6fa8");
  }
}

// ============================================================
//  MAIN LOOP
// ============================================================
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

reset();
loop();
