/*
  Minimal battle engine inspired by a tough blue-soul fight.
  - Canvas-based renderer
  - Red/Blue soul physics
  - White/Blue bones (contact vs. move-damage)
  - KR (karma) damage-over-time on hit
  - Simple Gaster Blaster beams
  - Scripted early patterns + final stall
*/

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const dialogueEl = document.getElementById('dialogue');
const lvEl = document.getElementById('lv');
const hpEl = document.getElementById('hp');
const krEl = document.getElementById('kr');
const musicEl = document.getElementById('music');

const UI_ACTIONS = ['FIGHT', 'ACT', 'ITEM', 'MERCY'];
const BUTTONS = Array.from(document.querySelectorAll('.menu-btn'));

// Game state
const game = {
  width: canvas.width,
  height: canvas.height,
  frame: 0,
  running: true,
  phaseIndex: 0,
  subphaseTime: 0,
  gravity: 0.7,
  soulColor: 'blue', // 'red' or 'blue'
  inMenu: false,
  specialStall: false,
  finished: false,
  introActive: false,
};

const player = {
  x: 320,
  y: 360,
  vx: 0,
  vy: 0,
  width: 12,
  height: 12,
  speed: 3.0,
  jump: 9.0,
  onGround: false,
  moveThisFrame: false,
  hp: 92,
  hpMax: 92,
  kr: 0,
};

const keys = new Set();

// Intro dialogue
const intro = {
  lines: [
    'hey.',
    'you look tired. me too.',
    'still moving forward, huh.',
    'welp. guess we do this the hard way.',
    'just a heads-up... blue means don\'t move.',
    'try to keep up.',
    'ready?'
  ],
  idx: 0,
  timer: null,
  perLineMs: 1400,
};

// Entities
const bones = []; // {x,y,w,h,color: 'white'|'blue', vx, vy}
const blasters = []; // {x,y,angle,charge,fire,life}

function setDialogue(text) {
  dialogueEl.textContent = text;
}

function updateUI() {
  hpEl.textContent = `HP: ${Math.max(0, Math.floor(player.hp))} / ${player.hpMax}`;
  krEl.textContent = `KR: ${Math.floor(player.kr)}`;
}

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function spawnBone(x, y, w, h, color = 'white', vx = 0, vy = 0) {
  bones.push({ x, y, w, h, color, vx, vy });
}

function spawnBlaster(x, y, angle) {
  blasters.push({ x, y, angle, charge: 30, fire: 20, life: 70 });
}

function resetForMenu() {
  game.inMenu = true;
}

function leaveMenu() {
  game.inMenu = false;
}

function applyKR(delta) {
  if (player.kr <= 0) return;
  // KR drains HP over time; KR decays slowly
  const drain = Math.min(player.kr, 0.08 * delta);
  player.hp -= drain;
  player.kr = Math.max(0, player.kr - 0.02 * delta);
}

function hurt(amount, addKR = 6) {
  player.hp -= amount;
  player.kr = Math.min(60, player.kr + addKR);
  if (player.hp <= 0) {
    game.running = false;
    setDialogue('you died. refresh to retry.');
  }
}

function advanceIntro() {
  if (!game.introActive) return;
  clearTimeout(intro.timer);
  intro.idx += 1;
  if (intro.idx < intro.lines.length) {
    setDialogue(intro.lines[intro.idx]);
    intro.timer = setTimeout(advanceIntro, intro.perLineMs);
  } else {
    // finish intro and start fight
    game.introActive = false;
    setDialogue('...');
    startColdOpen();
  }
}

function startIntro() {
  game.introActive = true;
  intro.idx = 0;
  setDialogue(intro.lines[0]);
  intro.timer = setTimeout(advanceIntro, intro.perLineMs);
}

function handleKeysDown(e) {
  if (e.repeat) return;
  // Skip/advance intro with Z or Enter
  if (game.introActive && (e.key === 'z' || e.key === 'Z' || e.key === 'Enter')) {
    advanceIntro();
    return;
  }
  keys.add(e.key.toLowerCase());
  if (e.key === 'm' || e.key === 'M') {
    if (musicEl.paused) musicEl.play().catch(()=>{}); else musicEl.pause();
  }
  if (e.key === 'c' || e.key === 'C') {
    game.soulColor = game.soulColor === 'blue' ? 'red' : 'blue';
  }
}

function handleKeysUp(e) {
  keys.delete(e.key.toLowerCase());
}

window.addEventListener('keydown', handleKeysDown);
window.addEventListener('keyup', handleKeysUp);

BUTTONS.forEach(btn => {
  btn.addEventListener('click', () => onMenuAction(btn.dataset.action));
});

function onMenuAction(action) {
  if (!game.inMenu) return;
  // special stall finish: only possible if napMode and long idle
  if (game.specialStall && napMode && stallTimer > 8000 && action === 'FIGHT' && !game.finished) {
    leaveMenu();
    setDialogue('you swing while he sleeps. it\'s over.');
    game.finished = true;
    game.running = false;
    updateUI();
    return;
  }
  switch (action) {
    case 'FIGHT':
      // Always dodged; proceed to attack
      leaveMenu();
      nextAttack();
      break;
    case 'ACT':
      setDialogue('he doesn\'t seem interested.');
      leaveMenu();
      nextAttack();
      break;
    case 'ITEM':
      // small heal, reduced by KR drain
      const heal = 18;
      player.hp = Math.min(player.hpMax, player.hp + heal);
      setDialogue('you use a healing item.');
      leaveMenu();
      nextAttack();
      break;
    case 'MERCY':
      setDialogue('not an option.');
      leaveMenu();
      nextAttack();
      break;
  }
}

function startColdOpen() {
  // cold open: surprise bones from below
  for (let i = 0; i < 8; i++) {
    spawnBone(40 + i * 70, 420, 50, 10, 'white', 0, -2.5);
  }
  game.phaseIndex = 0;
  game.subphaseTime = 0;
  game.inMenu = false; // attacked during intro
  // enter first menu shortly after
  setTimeout(() => resetForMenu(), 1400);
}

function startBattle() {
  // show intro, then begin
  startIntro();
}

function nextAttack() {
  // clear previous entities
  bones.length = 0;
  blasters.length = 0;
  player.vx = 0; player.vy = 0; player.moveThisFrame = false;
  game.subphaseTime = 0;

  const p = game.phaseIndex++;

  if (game.specialStall) {
    // special stall continues until player waits long enough
    specialAttackStallSetup();
    return;
  }

  // Define several early phase patterns
  switch (p) {
    case 0: patternSweepAndBlaster(); break;
    case 1: patternStairsAndSwipe(); break;
    case 2: patternBlueWhiteColumns(); break;
    case 3: patternPendulum(); break;
    case 4: patternTelekinesisDrops(); break;
    case 5: patternMazeRun(); break;
    case 6: patternSawtoothFlip(); break;
    case 7: patternGauntlet(); break;
    default:
      // enter special attack stall
      game.specialStall = true;
      specialAttackStallSetup();
      break;
  }
}

// Patterns
function patternSweepAndBlaster() {
  setDialogue('keep your feet still when they\'re blue.');
  // horizontal white sweeps + a blue line
  for (let y = 360; y >= 240; y -= 30) {
    const color = y === 300 ? 'blue' : 'white';
    spawnBone(-100, y, 200, 8, color, 4, 0);
    spawnBone(640, y + 15, 200, 8, 'white', -4, 0);
  }
  // one blaster sweeps later
  setTimeout(() => spawnBlaster(560, 80, Math.PI * 0.75), 600);
}

function patternStairsAndSwipe() {
  setDialogue('jump. then wait. then jump.');
  // stair platforms as bones (white)
  for (let i = 0; i < 6; i++) {
    spawnBone(120 + i * 60, 420 - i * 40, 60, 10, 'white');
  }
  // fast horizontal swipe low
  for (let i = 0; i < 6; i++) {
    setTimeout(() => spawnBone(-120, 430, 240, 8, 'white', 9, 0), 200 + 120 * i);
  }
  // double blaster stutter
  setTimeout(() => spawnBlaster(80, 80, Math.PI / 4), 700);
  setTimeout(() => spawnBlaster(560, 140, Math.PI * 0.7), 900);
}

function patternBlueWhiteColumns() {
  setDialogue('move a little. then don\'t.');
  for (let i = 0; i < 10; i++) {
    const color = i % 2 === 0 ? 'white' : 'blue';
    spawnBone(120 + i * 36, 210, 20, 180, color);
  }
  // triple blaster snap
  setTimeout(() => spawnBlaster(40, 240, 0), 500);
  setTimeout(() => spawnBlaster(600, 240, Math.PI), 680);
  setTimeout(() => spawnBlaster(320, -20, Math.PI / 2), 860);
}

function patternPendulum() {
  setDialogue('watch the swing.');
  // pendulum arcs simulated via moving bones
  for (let i = 0; i < 5; i++) {
    const y = 240 + Math.sin(i) * 120;
    spawnBone(320 - 6, y, 12, 12, 'white');
  }
}

function patternTelekinesisDrops() {
  setDialogue('buffer your landings.');
  // simulate grabs by nudging player
  player.vx = 6; player.vy = -8;
  setTimeout(() => { player.vx = -8; player.vy = -4; }, 300);
  setTimeout(() => { player.vx = 0; player.vy = 12; }, 650);
  for (let i = 0; i < 5; i++) {
    spawnBone(200 + i * 40, 440, 24, 8, 'white');
  }
  setTimeout(() => {
    spawnBlaster(220, 420, -Math.PI / 2);
    spawnBlaster(420, 420, -Math.PI / 2);
  }, 700);
}

function patternMazeRun() {
  setDialogue('small hops. no panic.');
  for (let i = 0; i < 8; i++) {
    spawnBone(80 + i * 64, 440, 40, 8, 'white');
    spawnBone(80 + i * 64, 220, 40, 8, 'blue');
  }
  setTimeout(() => spawnBlaster(-20, 280, 0), 500);
}

function patternSawtoothFlip() {
  setDialogue('up is down.');
  // invert gravity mid-pattern
  for (let i = 0; i < 6; i++) {
    spawnBone(60 + i * 90, 400 - (i % 2) * 120, 80, 10, i % 2 ? 'blue' : 'white');
  }
  setTimeout(() => { game.gravity = -game.gravity; }, 600);
  setTimeout(() => { game.gravity = -game.gravity; }, 1200);
  setTimeout(() => spawnBlaster(320, 480, -Math.PI / 2), 900);
}

function patternGauntlet() {
  setDialogue('route early.');
  for (let i = 0; i < 10; i++) {
    setTimeout(() => spawnBone(-120, 260 + (i % 2 ? 30 : -30), 200, 8, 'white', 6, 0), i * 120);
    setTimeout(() => spawnBone(640, 260 + (i % 2 ? -60 : 60), 200, 8, 'white', -6, 0), i * 120 + 60);
  }
  setTimeout(() => {
    spawnBlaster(320, 0, Math.PI / 2);
    setTimeout(() => spawnBlaster(320, 480, -Math.PI / 2), 200);
    setTimeout(() => spawnBlaster(320, 0, Math.PI / 2), 400);
    setTimeout(() => { spawnBlaster(160, 0, Math.PI / 2); spawnBlaster(480, 480, -Math.PI / 2); }, 600);
  }, 300);
}

function specialAttackStallSetup() {
  setDialogue('my special attack.');
  // create a simple cage
  spawnBone(220, 220, 200, 10, 'white');
  spawnBone(220, 350, 200, 10, 'white');
  spawnBone(220, 220, 10, 140, 'white');
  spawnBone(410, 220, 10, 140, 'white');
  // no attacks. wait. if idle long enough, allow exit.
}

let stallTimer = 0;
let napMode = false;

function tryAllowStallEscape(delta) {
  if (!game.specialStall) return;
  // detect idling: no movement keys for a while
  const moving = keys.has('arrowleft') || keys.has('arrowright') || keys.has('arrowup') || keys.has('arrowdown') ||
                 keys.has('a') || keys.has('d') || keys.has('w') || keys.has('s');
  if (!moving) stallTimer += delta; else stallTimer = 0;

  if (!napMode && stallTimer > 3000) {
    napMode = true;
    setDialogue('... zzz');
  }
  if (napMode && stallTimer > 6000) {
    // let the player drift out
    spawnBone(220, 220, 200, 10, 'blue'); // convert cage top to blue so you can stand still through it
    setDialogue('you feel the guard drop.');
  }
}

function update(deltaMs) {
  if (!game.running) return;
  game.frame += 1;
  game.subphaseTime += deltaMs;

  // During intro, only UI and skip logic run
  if (game.introActive) {
    updateUI();
    return;
  }

  // Menu timing
  if (!game.inMenu && game.subphaseTime > 1800 && !game.specialStall) {
    // after ~1.8s per pattern, go to menu
    resetForMenu();
  }

  // Player input and physics
  const left = keys.has('arrowleft') || keys.has('a');
  const right = keys.has('arrowright') || keys.has('d');
  const up = keys.has('arrowup') || keys.has('w') || keys.has(' ');

  player.moveThisFrame = false;

  if (game.soulColor === 'red') {
    // free movement
    if (left) { player.x -= player.speed; player.moveThisFrame = true; }
    if (right) { player.x += player.speed; player.moveThisFrame = true; }
    if (up) { player.y -= player.speed; player.moveThisFrame = true; }
    if (keys.has('arrowdown') || keys.has('s')) { player.y += player.speed; player.moveThisFrame = true; }
  } else {
    // blue: platforming with gravity
    if (left) { player.vx = -player.speed; player.moveThisFrame = true; }
    else if (right) { player.vx = player.speed; player.moveThisFrame = true; }
    else player.vx = 0;

    if (up && player.onGround) {
      player.vy = -player.jump * Math.sign(game.gravity);
      player.onGround = false;
      player.moveThisFrame = true;
    }

    player.vy += game.gravity * 0.4;
    player.x += player.vx;
    player.y += player.vy;

    // ground / ceiling
    const floorY = game.gravity > 0 ? 460 : 20;
    if ((game.gravity > 0 && player.y + player.height >= floorY) || (game.gravity < 0 && player.y <= floorY)) {
      player.y = game.gravity > 0 ? floorY - player.height : floorY;
      player.vy = 0;
      player.onGround = true;
    } else {
      player.onGround = false;
    }
  }

  // clamp to stage
  player.x = Math.max(20, Math.min(game.width - 20 - player.width, player.x));
  player.y = Math.max(20, Math.min(game.height - 20 - player.height, player.y));

  // Update bones
  for (const b of bones) {
    b.x += b.vx || 0; b.y += b.vy || 0;
  }
  // Cull off-screen bones
  for (let i = bones.length - 1; i >= 0; i--) {
    const b = bones[i];
    if (b.x + b.w < -200 || b.x > game.width + 200 || b.y > game.height + 200 || b.y + b.h < -200) {
      bones.splice(i, 1);
    }
  }

  // Update blasters
  for (const g of blasters) {
    g.life -= 1;
  }
  for (let i = blasters.length - 1; i >= 0; i--) {
    if (blasters[i].life <= 0) blasters.splice(i, 1);
  }

  // Collisions: bones
  for (const b of bones) {
    if (rectsOverlap(player.x, player.y, player.width, player.height, b.x, b.y, b.w, b.h)) {
      if (b.color === 'white') {
        hurt(1.2, 5);
      } else if (b.color === 'blue') {
        if (player.moveThisFrame) hurt(1.2, 5);
      }
    }
  }

  // Collisions: blaster beams
  for (const g of blasters) {
    const beamActive = g.life < 40; // last 40 frames are beam
    if (!beamActive) continue;
    // approximate beam as a thick rectangle
    const beamLength = 800;
    const beamWidth = 22;
    // project player center to blaster ray
    const px = player.x + player.width / 2;
    const py = player.y + player.height / 2;
    const dx = Math.cos(g.angle), dy = Math.sin(g.angle);
    const ox = px - g.x, oy = py - g.y;
    const proj = ox * dx + oy * dy;
    const perp = Math.abs(-oy * dx + ox * dy);
    if (proj > 0 && proj < beamLength && perp < beamWidth) {
      hurt(0.9, 6);
    }
  }

  // KR damage over time
  applyKR(deltaMs);

  // Special stall idle detection
  tryAllowStallEscape(deltaMs);

  // If special stall and nap progressed long enough, allow finishing strike via FIGHT
  if (game.specialStall && napMode && stallTimer > 8000 && !game.inMenu && !game.finished) {
    resetForMenu();
    setDialogue('... now\'s your chance.');
  }

  updateUI();
}

function draw() {
  // clear
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, game.width, game.height);

  // border
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, game.width - 40, game.height - 40);

  // bones
  for (const b of bones) {
    ctx.fillStyle = b.color === 'white' ? '#eee' : '#4aa3ff';
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }

  // blasters (draw head + beam)
  for (const g of blasters) {
    // head
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.angle);
    ctx.fillStyle = '#ddd';
    ctx.fillRect(-10, -10, 20, 20);
    // beam
    if (g.life < 40) {
      ctx.fillStyle = '#8cf';
      ctx.fillRect(0, -10, 800, 20);
    } else {
      ctx.strokeStyle = '#8cf';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(40, 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  // player soul
  ctx.fillStyle = game.soulColor === 'blue' ? '#4aa3ff' : '#ff4a4a';
  ctx.fillRect(player.x, player.y, player.width, player.height);
}

let last = performance.now();
function loop(now) {
  const delta = Math.min(32, now - last);
  last = now;
  update(delta);
  draw();
  if (game.running) requestAnimationFrame(loop);
}

function boot() {
  updateUI();
  startBattle();
  requestAnimationFrame(loop);
}

boot();