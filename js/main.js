/**
 * 余桩 / Leftover Stakes — static canvas prototype
 * Top-down grid survival + space management
 */

const COLS = 18;
const ROWS = 12;
const CELL = 40;
const PAD_X = 48;
const PAD_TOP = 56;
const CANVAS_W = 960;
const CANVAS_H = 540;

const REMOVE_VULN = 1.2; // seconds open after remove
const WAVE_DURATION = 70; // seconds
const START_STAKES = 4;
const STAKES_PER_WAVE = 2;
const PLAYER_SPEED = 4.2; // cells per second
const HIT_COOLDOWN = 0.65;

const COLORS = {
  bg: "#243044",
  grid: "#2e3c54",
  gridLine: "#354665",
  stake: "#c9a24a",
  stakeTop: "#f0c46a",
  stakeOpen: "#e87a5a",
  player: "#6ec8ff",
  playerFace: "#9edcff",
  enemy: "#e05a6a",
  enemyEye: "#1a1f2e",
  hud: "#e8ecf4",
  hudDim: "#8a9bb8",
  accent: "#f0c46a",
  danger: "#ff7a6e",
  ok: "#7dcea0",
  freeRemove: "#a8e6cf",
};

/** @typedef {{x:number,y:number}} Vec */

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("game"));
const ctx = canvas.getContext("2d");
const overlay = document.getElementById("overlay");
const titlePanel = document.getElementById("title-panel");
const deathPanel = document.getElementById("death-panel");
const deathStats = document.getElementById("death-stats");
const btnStart = document.getElementById("btn-start");
const btnRestart = document.getElementById("btn-restart");

/** @type {Set<string>} */
const keys = new Set();

let state = "title"; // title | playing | dead
let lastTs = 0;

const game = {
  wave: 1,
  hp: 3,
  maxHp: 3,
  stakeStock: START_STAKES,
  /** @type {Map<string, {x:number,y:number,openUntil:number}>} */
  stakes: new Map(),
  /** @type {{x:number,y:number,fx:number,fy:number,hitCd:number}} */
  player: { x: 9, y: 6, fx: 0, fy: -1, hitCd: 0 },
  /** @type {Array<{x:number,y:number,speed:number,path:Vec[],pathT:number,alive:boolean}>} */
  enemies: [],
  waveTime: WAVE_DURATION,
  killsThisWave: 0,
  killTarget: 12,
  spawnedThisWave: 0,
  spawnBudget: 16,
  spawnTimer: 0,
  freeRemove: 0,
  banner: "",
  bannerT: 0,
  totalKills: 0,
  removeBusy: 0,
  flash: 0,
  phase: "combat", // combat | intermission
  intermissionT: 0,
};

function keyCell(x, y) {
  return `${x},${y}`;
}

function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < COLS && y < ROWS;
}

function cellCenter(cx, cy) {
  return {
    px: PAD_X + cx * CELL + CELL / 2,
    py: PAD_TOP + cy * CELL + CELL / 2,
  };
}

function screenToCell(mx, my) {
  const x = Math.floor((mx - PAD_X) / CELL);
  const y = Math.floor((my - PAD_TOP) / CELL);
  return { x, y };
}

function isBlocked(x, y, ignoreOpen = false) {
  if (!inBounds(x, y)) return true;
  const s = game.stakes.get(keyCell(x, y));
  if (!s) return false;
  if (!ignoreOpen && performance.now() / 1000 < s.openUntil) return false;
  return true;
}

function resetRun() {
  game.wave = 1;
  game.hp = 3;
  game.maxHp = 3;
  game.stakeStock = START_STAKES;
  game.stakes.clear();
  game.player = { x: COLS / 2 - 0.5, y: ROWS / 2 - 0.5, fx: 0, fy: -1, hitCd: 0 };
  game.enemies = [];
  game.totalKills = 0;
  game.freeRemove = 0;
  game.removeBusy = 0;
  game.flash = 0;
  startWave(1);
}

function startWave(n) {
  game.wave = n;
  game.phase = "combat";
  game.intermissionT = 0;
  game.waveTime = WAVE_DURATION;
  game.killsThisWave = 0;
  game.spawnedThisWave = 0;
  game.enemies = [];
  // denser / faster each wave
  game.killTarget = 8 + n * 4;
  game.spawnBudget = 12 + n * 5;
  game.spawnTimer = 0.9;
  if (n > 1) {
    game.stakeStock += STAKES_PER_WAVE;
  }
  game.banner = `第 ${n} 波`;
  game.bannerT = 2.2;
}

function endWave() {
  if (game.phase !== "combat") return;
  game.phase = "intermission";
  game.enemies = [];
  game.freeRemove = 1;
  game.intermissionT = 2.0;
  game.banner = "波次结束 · 获得 1 次免费拔桩";
  game.bannerT = 2.5;
}

function spawnEnemy() {
  if (game.spawnedThisWave >= game.spawnBudget) return;
  const edges = [];
  for (let x = 0; x < COLS; x++) {
    edges.push({ x, y: 0 });
    edges.push({ x, y: ROWS - 1 });
  }
  for (let y = 1; y < ROWS - 1; y++) {
    edges.push({ x: 0, y });
    edges.push({ x: COLS - 1, y });
  }
  // prefer edges away from player
  const px = Math.floor(game.player.x);
  const py = Math.floor(game.player.y);
  edges.sort((a, b) => {
    const da = Math.abs(a.x - px) + Math.abs(a.y - py);
    const db = Math.abs(b.x - px) + Math.abs(b.y - py);
    return db - da;
  });
  let picked = null;
  for (const e of edges) {
    if (!isBlocked(e.x, e.y) && !enemyAt(e.x, e.y)) {
      // slight randomness among far edges
      if (Math.random() < 0.35 || !picked) picked = e;
      if (Math.random() < 0.15) break;
    }
  }
  if (!picked) return;
  const base = 1.35 + game.wave * 0.22;
  const speed = base + Math.random() * 0.35;
  game.enemies.push({
    x: picked.x + 0.5,
    y: picked.y + 0.5,
    speed,
    path: [],
    pathT: 0,
    alive: true,
    repath: 0,
  });
  game.spawnedThisWave++;
}

function enemyAt(cx, cy) {
  return game.enemies.some(
    (e) => e.alive && Math.floor(e.x) === cx && Math.floor(e.y) === cy
  );
}

/** BFS pathfinding on grid around stakes */
function bfsPath(sx, sy, gx, gy) {
  const start = { x: Math.floor(sx), y: Math.floor(sy) };
  const goal = { x: Math.floor(gx), y: Math.floor(gy) };
  if (start.x === goal.x && start.y === goal.y) return [];
  if (isBlocked(goal.x, goal.y)) {
    // aim for nearest open cell to player
    let best = null;
    let bestD = 99;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = goal.x + dx;
        const ny = goal.y + dy;
        if (inBounds(nx, ny) && !isBlocked(nx, ny)) {
          const d = Math.abs(dx) + Math.abs(dy);
          if (d < bestD) {
            bestD = d;
            best = { x: nx, y: ny };
          }
        }
      }
    }
    if (!best) return [];
    goal.x = best.x;
    goal.y = best.y;
  }

  const q = [start];
  /** @type {Map<string, Vec|null>} */
  const came = new Map();
  came.set(keyCell(start.x, start.y), null);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let found = null;
  while (q.length) {
    const cur = q.shift();
    if (cur.x === goal.x && cur.y === goal.y) {
      found = cur;
      break;
    }
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const k = keyCell(nx, ny);
      if (!inBounds(nx, ny) || came.has(k) || isBlocked(nx, ny)) continue;
      came.set(k, cur);
      q.push({ x: nx, y: ny });
    }
  }
  if (!found) return [];
  const path = [];
  let c = found;
  while (c) {
    path.push(c);
    c = came.get(keyCell(c.x, c.y));
  }
  path.reverse();
  // drop start cell
  if (path.length && path[0].x === start.x && path[0].y === start.y) path.shift();
  return path;
}

function plantStake() {
  if (game.stakeStock <= 0) {
    pulseBanner("没有桩了", 1.0);
    return;
  }
  const px = Math.floor(game.player.x);
  const py = Math.floor(game.player.y);
  const tx = px + game.player.fx;
  const ty = py + game.player.fy;
  if (!inBounds(tx, ty)) {
    pulseBanner("出界", 0.8);
    return;
  }
  const k = keyCell(tx, ty);
  if (game.stakes.has(k)) {
    pulseBanner("已有桩", 0.8);
    return;
  }
  // don't plant on enemy
  if (enemyAt(tx, ty)) {
    pulseBanner("有怪", 0.8);
    return;
  }
  game.stakes.set(k, { x: tx, y: ty, openUntil: 0 });
  game.stakeStock--;
}

function removeNearestStake() {
  if (game.removeBusy > 0) return;
  const px = game.player.x;
  const py = game.player.y;
  let best = null;
  let bestD = Infinity;
  for (const s of game.stakes.values()) {
    const d = Math.hypot(s.x + 0.5 - px, s.y + 0.5 - py);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  if (!best || bestD > 2.8) {
    pulseBanner("附近没有桩", 0.9);
    return;
  }
  const k = keyCell(best.x, best.y);
  const now = performance.now() / 1000;
  // open window then remove — actually: remove immediately but leave "open" gap?
  // Design: remove nearest stake with ~1.2s vulnerable/open window
  // Interpretation: when you press R, the stake becomes passable for 1.2s then disappears
  // OR: stake is removed and that cell is "open" marking vulnerability for player action time
  // Clearest fun read: stake opens (passable for both) for 1.2s, then is gone. Player is "vulnerable"
  // because the gap lets enemies through during the action.
  if (game.freeRemove > 0) {
    game.stakes.delete(k);
    game.freeRemove--;
    pulseBanner("免费拔桩", 1.0);
    game.removeBusy = 0.25;
    return;
  }
  best.openUntil = now + REMOVE_VULN;
  game.removeBusy = REMOVE_VULN;
  // schedule actual delete
  const stakeRef = best;
  setTimeout(() => {
    const cur = game.stakes.get(k);
    if (cur === stakeRef) game.stakes.delete(k);
  }, REMOVE_VULN * 1000);
}

function pulseBanner(msg, t) {
  game.banner = msg;
  game.bannerT = t;
}

function tryMovePlayer(dt) {
  let dx = 0;
  let dy = 0;
  if (keys.has("KeyW") || keys.has("ArrowUp")) dy -= 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) dy += 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) dx -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) dx += 1;
  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // facing from last non-zero move (prefer cardinal for planting)
    if (Math.abs(dx) >= Math.abs(dy)) {
      game.player.fx = dx > 0 ? 1 : -1;
      game.player.fy = 0;
    } else {
      game.player.fx = 0;
      game.player.fy = dy > 0 ? 1 : -1;
    }
    const speed = PLAYER_SPEED * dt;
    const nx = game.player.x + dx * speed;
    const ny = game.player.y + dy * speed;
    // axis-separated collision with stakes / bounds
    const r = 0.32;
    if (!collidesPlayer(nx, game.player.y, r)) game.player.x = nx;
    if (!collidesPlayer(game.player.x, ny, r)) game.player.y = ny;
    game.player.x = clamp(game.player.x, r, COLS - r);
    game.player.y = clamp(game.player.y, r, ROWS - r);
  }
}

function collidesPlayer(x, y, r) {
  const cells = [
    [Math.floor(x - r), Math.floor(y - r)],
    [Math.floor(x + r), Math.floor(y - r)],
    [Math.floor(x - r), Math.floor(y + r)],
    [Math.floor(x + r), Math.floor(y + r)],
  ];
  for (const [cx, cy] of cells) {
    if (!inBounds(cx, cy)) return true;
    if (isBlocked(cx, cy)) return true;
  }
  return false;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function updateEnemies(dt) {
  for (const e of game.enemies) {
    if (!e.alive) continue;
    e.repath -= dt;
    if (e.repath <= 0 || e.path.length === 0) {
      e.path = bfsPath(e.x, e.y, game.player.x, game.player.y);
      e.repath = 0.35 + Math.random() * 0.25;
    }
    if (e.path.length) {
      const t = e.path[0];
      const tx = t.x + 0.5;
      const ty = t.y + 0.5;
      // if next cell opened/blocked mid-path, repath
      if (isBlocked(t.x, t.y)) {
        e.path = [];
        e.repath = 0;
        continue;
      }
      const dx = tx - e.x;
      const dy = ty - e.y;
      const dist = Math.hypot(dx, dy);
      const step = e.speed * dt;
      if (dist <= step) {
        e.x = tx;
        e.y = ty;
        e.path.shift();
      } else {
        e.x += (dx / dist) * step;
        e.y += (dy / dist) * step;
      }
    } else {
      // stuck — shuffle randomly along open neighbor
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      const shuffled = dirs.sort(() => Math.random() - 0.5);
      for (const [dx, dy] of shuffled) {
        const nx = Math.floor(e.x) + dx;
        const ny = Math.floor(e.y) + dy;
        if (inBounds(nx, ny) && !isBlocked(nx, ny)) {
          e.path = [{ x: nx, y: ny }];
          break;
        }
      }
    }

    // contact damage
    const d = Math.hypot(e.x - game.player.x, e.y - game.player.y);
    if (d < 0.55 && game.player.hitCd <= 0) {
      game.hp -= 1;
      game.player.hitCd = HIT_COOLDOWN;
      game.flash = 0.25;
      e.alive = false; // kamikaze contact — clearer feedback
      game.killsThisWave++;
      game.totalKills++;
      if (game.hp <= 0) {
        die();
        return;
      }
    }
  }
  game.enemies = game.enemies.filter((e) => e.alive);
}

function die() {
  state = "dead";
  overlay.classList.remove("hidden");
  titlePanel.classList.add("hidden");
  deathPanel.classList.remove("hidden");
  deathStats.textContent = `撑到第 ${game.wave} 波 · 击退 ${game.totalKills} 只 · 场上余桩 ${game.stakes.size}`;
}

function update(dt) {
  if (state !== "playing") return;
  if (game.bannerT > 0) game.bannerT -= dt;
  if (game.flash > 0) game.flash -= dt;
  if (game.player.hitCd > 0) game.player.hitCd -= dt;
  if (game.removeBusy > 0) game.removeBusy -= dt;

  tryMovePlayer(dt);

  if (game.phase === "intermission") {
    game.intermissionT -= dt;
    if (game.intermissionT <= 0) startWave(game.wave + 1);
    return;
  }

  updateEnemies(dt);

  // spawn — denser early so overplanting bites within ~60s
  game.spawnTimer -= dt;
  const spawnInterval = Math.max(0.45, 1.85 - game.wave * 0.22);
  if (game.spawnTimer <= 0 && game.spawnedThisWave < game.spawnBudget) {
    spawnEnemy();
    if (game.wave >= 2 && Math.random() < 0.3) spawnEnemy();
    if (game.wave >= 4 && Math.random() < 0.25) spawnEnemy();
    game.spawnTimer = spawnInterval;
  }

  game.waveTime -= dt;
  const cleared =
    game.killsThisWave >= game.killTarget ||
    (game.spawnedThisWave >= game.spawnBudget && game.enemies.length === 0);
  if (game.waveTime <= 0 || cleared) endWave();
}

function draw() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // playfield
  ctx.fillStyle = COLORS.grid;
  ctx.fillRect(PAD_X, PAD_TOP, COLS * CELL, ROWS * CELL);

  // grid lines
  ctx.strokeStyle = COLORS.gridLine;
  ctx.lineWidth = 1;
  for (let x = 0; x <= COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(PAD_X + x * CELL, PAD_TOP);
    ctx.lineTo(PAD_X + x * CELL, PAD_TOP + ROWS * CELL);
    ctx.stroke();
  }
  for (let y = 0; y <= ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(PAD_X, PAD_TOP + y * CELL);
    ctx.lineTo(PAD_X + COLS * CELL, PAD_TOP + y * CELL);
    ctx.stroke();
  }

  const now = performance.now() / 1000;

  // stakes
  for (const s of game.stakes.values()) {
    const open = now < s.openUntil;
    const { px, py } = cellCenter(s.x, s.y);
    ctx.fillStyle = open ? COLORS.stakeOpen : COLORS.stake;
    roundRect(px - 12, py - 14, 24, 28, 4);
    ctx.fill();
    if (!open) {
      ctx.fillStyle = COLORS.stakeTop;
      ctx.beginPath();
      ctx.moveTo(px, py - 18);
      ctx.lineTo(px - 8, py - 8);
      ctx.lineTo(px + 8, py - 8);
      ctx.closePath();
      ctx.fill();
    } else {
      // open pulse
      ctx.strokeStyle = COLORS.danger;
      ctx.lineWidth = 2;
      ctx.strokeRect(px - 16, py - 16, 32, 32);
    }
  }

  // enemies
  for (const e of game.enemies) {
    if (!e.alive) continue;
    const { px, py } = {
      px: PAD_X + e.x * CELL,
      py: PAD_TOP + e.y * CELL,
    };
    ctx.fillStyle = COLORS.enemy;
    ctx.beginPath();
    ctx.arc(px, py, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.enemyEye;
    ctx.beginPath();
    ctx.arc(px - 4, py - 2, 2.5, 0, Math.PI * 2);
    ctx.arc(px + 4, py - 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // player
  {
    const px = PAD_X + game.player.x * CELL;
    const py = PAD_TOP + game.player.y * CELL;
    const blink = game.player.hitCd > 0 && Math.floor(now * 12) % 2 === 0;
    if (!blink) {
      ctx.fillStyle = COLORS.player;
      ctx.beginPath();
      ctx.arc(px, py, 14, 0, Math.PI * 2);
      ctx.fill();
      // facing indicator
      ctx.fillStyle = COLORS.playerFace;
      ctx.beginPath();
      ctx.arc(
        px + game.player.fx * 10,
        py + game.player.fy * 10,
        5,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }

  // plant preview ghost
  if (state === "playing") {
    const tx = Math.floor(game.player.x) + game.player.fx;
    const ty = Math.floor(game.player.y) + game.player.fy;
    if (inBounds(tx, ty) && !game.stakes.has(keyCell(tx, ty))) {
      const { px, py } = cellCenter(tx, ty);
      ctx.strokeStyle = game.stakeStock > 0 ? "rgba(240,196,106,0.55)" : "rgba(232,122,90,0.4)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(px - 14, py - 14, 28, 28);
      ctx.setLineDash([]);
    }
  }

  drawHud();

  if (game.bannerT > 0 && game.banner) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, game.bannerT);
    ctx.fillStyle = "rgba(18,22,34,0.72)";
    const tw = ctx.measureText(game.banner).width + 48;
    // measure with proper font
    ctx.font = "bold 22px system-ui, sans-serif";
    const w = Math.max(200, ctx.measureText(game.banner).width + 48);
    ctx.fillRect(CANVAS_W / 2 - w / 2, 120, w, 44);
    ctx.fillStyle = COLORS.accent;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(game.banner, CANVAS_W / 2, 142);
    ctx.restore();
  }

  if (game.flash > 0) {
    ctx.fillStyle = `rgba(224,90,106,${game.flash * 1.2})`;
    ctx.fillRect(PAD_X, PAD_TOP, COLS * CELL, ROWS * CELL);
  }
}

function drawHud() {
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = "bold 22px system-ui, 'Noto Sans SC', sans-serif";
  ctx.fillStyle = COLORS.accent;
  ctx.fillText("余桩", 16, 14);

  ctx.font = "15px system-ui, 'Noto Sans SC', sans-serif";
  ctx.fillStyle = COLORS.hud;
  const hpStr = "♥".repeat(Math.max(0, game.hp)) + "♡".repeat(Math.max(0, game.maxHp - game.hp));
  ctx.fillText(`生命 ${hpStr}`, 100, 18);

  ctx.fillText(`桩库存 ${game.stakeStock}`, 250, 18);
  ctx.fillText(`波次 ${game.wave}`, 380, 18);

  const tLeft = Math.max(0, Math.ceil(game.waveTime));
  ctx.fillStyle = tLeft <= 10 ? COLORS.danger : COLORS.hudDim;
  ctx.fillText(`剩余 ${tLeft}s`, 470, 18);

  ctx.fillStyle = COLORS.hudDim;
  ctx.fillText(`击退 ${game.killsThisWave}/${game.killTarget}`, 580, 18);

  if (game.freeRemove > 0) {
    ctx.fillStyle = COLORS.freeRemove;
    ctx.fillText(`免费拔桩 ×${game.freeRemove}`, 720, 18);
  }

  // bottom hints
  ctx.font = "13px system-ui, 'Noto Sans SC', sans-serif";
  ctx.fillStyle = COLORS.hudDim;
  ctx.textAlign = "center";
  let tip = "WASD 移动 · 空格/点击 插桩 · R 拔最近桩（敞口 1.2s）· 桩挡你也挡怪";
  if (game.removeBusy > 0) tip = `拔桩敞口中… ${game.removeBusy.toFixed(1)}s — 缺口会放怪进来`;
  ctx.fillText(tip, CANVAS_W / 2, CANVAS_H - 22);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loop(ts) {
  const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0);
  lastTs = ts;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

function startGame() {
  resetRun();
  state = "playing";
  overlay.classList.add("hidden");
  titlePanel.classList.add("hidden");
  deathPanel.classList.add("hidden");
}

btnStart.addEventListener("click", startGame);
btnRestart.addEventListener("click", startGame);

window.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (state === "title" && (e.code === "Enter" || e.code === "Space")) {
    e.preventDefault();
    startGame();
    return;
  }
  if (state === "dead" && (e.code === "Enter" || e.code === "Space")) {
    e.preventDefault();
    startGame();
    return;
  }
  if (state !== "playing") return;
  if (e.code === "Space") {
    e.preventDefault();
    plantStake();
  }
  if (e.code === "KeyR") {
    e.preventDefault();
    removeNearestStake();
  }
});

window.addEventListener("keyup", (e) => {
  keys.delete(e.code);
});

canvas.addEventListener("click", (e) => {
  if (state !== "playing") return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const mx = (e.clientX - rect.left) * scaleX;
  const my = (e.clientY - rect.top) * scaleY;
  const cell = screenToCell(mx, my);
  // face toward clicked cell then plant
  const px = Math.floor(game.player.x);
  const py = Math.floor(game.player.y);
  const dx = cell.x - px;
  const dy = cell.y - py;
  if (dx === 0 && dy === 0) return;
  if (Math.abs(dx) >= Math.abs(dy)) {
    game.player.fx = dx > 0 ? 1 : -1;
    game.player.fy = 0;
  } else {
    game.player.fx = 0;
    game.player.fy = dy > 0 ? 1 : -1;
  }
  plantStake();
});

// prevent scrolling with arrows/space
window.addEventListener(
  "keydown",
  (e) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
      e.preventDefault();
    }
  },
  { passive: false }
);

requestAnimationFrame(loop);
