import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  EnemyState,
  ExplosionEvent,
  GameSnapshot,
  PlayerState,
  SHIP_SPECS,
  ShipType,
} from '../shared/types.ts';

interface Star {
  x: number;
  y: number;
  size: number;
  alpha: number;
  layer: number; // parallax factor
  color: string;
}

interface Nebula {
  x: number;
  y: number;
  radius: number;
  color: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  alpha: number;
  decay: number;
}

interface InterpolatedEntity {
  x: number;
  y: number;
  angle: number;
}

export class ArenaRenderer {
  private stars: Star[] = [];
  private nebulae: Nebula[] = [];
  private particles: Particle[] = [];
  private interpPlayers = new Map<string, InterpolatedEntity>();
  private interpEnemies = new Map<string, InterpolatedEntity>();
  private processedExplosions = new Set<string>();
  private cameraX = ARENA_WIDTH / 2;
  private cameraY = ARENA_HEIGHT / 2;
  private screenShake = 0;

  constructor() {
    this.initSpaceEnvironment();
  }

  private initSpaceEnvironment() {
    const colors = ['#E2E8F0', '#93C5FD', '#67E8F9', '#C4B5FD'];
    for (let i = 0; i < 260; i++) {
      this.stars.push({
        x: Math.random() * ARENA_WIDTH,
        y: Math.random() * ARENA_HEIGHT,
        size: 0.8 + Math.random() * 2.0,
        alpha: 0.25 + Math.random() * 0.75,
        layer: 0.2 + Math.random() * 0.65,
        color: colors[i % colors.length],
      });
    }

    this.nebulae = [
      { x: 750, y: 820, radius: 560, color: 'rgba(14, 165, 233, 0.08)' },
      { x: 2250, y: 740, radius: 640, color: 'rgba(139, 92, 246, 0.08)' },
      { x: 1500, y: 1650, radius: 720, color: 'rgba(59, 130, 246, 0.07)' },
      { x: 860, y: 2350, radius: 540, color: 'rgba(244, 63, 94, 0.06)' },
      { x: 2320, y: 2220, radius: 600, color: 'rgba(6, 182, 212, 0.08)' },
    ];
  }

  public spawnExplosionParticles(exp: ExplosionEvent, reducedEffects: boolean) {
    if (this.processedExplosions.has(exp.id)) return;
    this.processedExplosions.add(exp.id);
    if (this.processedExplosions.size > 200) {
      const first = this.processedExplosions.values().next().value;
      if (first) this.processedExplosions.delete(first);
    }

    const baseCount =
      exp.intensity === 'boss'
        ? 65
        : exp.intensity === 'large'
          ? 36
          : exp.intensity === 'medium'
            ? 20
            : 8;
    const count = reducedEffects ? Math.max(4, Math.floor(baseCount * 0.35)) : baseCount;

    if (!reducedEffects) {
      if (exp.intensity === 'boss') this.screenShake = 18;
      else if (exp.intensity === 'large') this.screenShake = 10;
      else if (exp.intensity === 'medium') this.screenShake = 4;
    }

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * (exp.intensity === 'boss' ? 420 : 240);
      this.particles.push({
        x: exp.x,
        y: exp.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 2 + Math.random() * (exp.intensity === 'small' ? 2.5 : 5),
        color: i % 3 === 0 ? '#FFFFFF' : exp.color,
        alpha: 1,
        decay: 0.9 + Math.random() * 1.4,
      });
    }
  }

  public render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    snapshot: GameSnapshot,
    localPilotId: string,
    mouseWorldAngle: number | null,
    reducedEffects: boolean,
    dt: number
  ) {
    // Find local player to center camera smoothly
    const localPlayer =
      snapshot.players.find((p) => p.pilotId === localPilotId) || snapshot.players[0];

    if (localPlayer) {
      const lerpCam = Math.min(1, dt * 8);
      this.cameraX += (localPlayer.x - this.cameraX) * lerpCam;
      this.cameraY += (localPlayer.y - this.cameraY) * lerpCam;
    }

    let shakeX = 0;
    let shakeY = 0;
    if (this.screenShake > 0.2 && !reducedEffects) {
      shakeX = (Math.random() - 0.5) * this.screenShake;
      shakeY = (Math.random() - 0.5) * this.screenShake;
      this.screenShake *= Math.pow(0.05, dt);
    } else {
      this.screenShake = 0;
    }

    // 1. Deep Space Background
    const bgGrad = ctx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      80,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.85
    );
    bgGrad.addColorStop(0, '#091026');
    bgGrad.addColorStop(1, '#040711');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    const viewLeft = this.cameraX - width / 2 + shakeX;
    const viewTop = this.cameraY - height / 2 + shakeY;

    // 2. Parallax Starfield
    for (const star of this.stars) {
      const sx = ((star.x - viewLeft * star.layer) % width + width) % width;
      const sy = ((star.y - viewTop * star.layer) % height + height) % height;
      ctx.fillStyle = star.color;
      ctx.globalAlpha = star.alpha;
      ctx.beginPath();
      ctx.arc(sx, sy, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Transform into Arena World Coordinates
    ctx.translate(-viewLeft, -viewTop);

    // 3. Nebulae & Distant Celestial Body
    if (!reducedEffects) {
      for (const neb of this.nebulae) {
        const grad = ctx.createRadialGradient(neb.x, neb.y, 20, neb.x, neb.y, neb.radius);
        grad.addColorStop(0, neb.color);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(neb.x, neb.y, neb.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Distant Ringed Planet in Center-Upper Sector
    ctx.save();
    ctx.translate(1500, 1100);
    const planetGrad = ctx.createLinearGradient(-110, -110, 110, 110);
    planetGrad.addColorStop(0, 'rgba(30, 58, 138, 0.25)');
    planetGrad.addColorStop(1, 'rgba(4, 7, 17, 0.85)');
    ctx.fillStyle = planetGrad;
    ctx.beginPath();
    ctx.arc(0, 0, 115, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(0, 0, 195, 42, -0.28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 4. Tactical Sector Grid & Forcefield Boundary
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.45)';
    ctx.lineWidth = 1;
    const gridStep = 250;
    const startX = Math.max(0, Math.floor(viewLeft / gridStep) * gridStep);
    const endX = Math.min(ARENA_WIDTH, viewLeft + width + gridStep);
    const startY = Math.max(0, Math.floor(viewTop / gridStep) * gridStep);
    const endY = Math.min(ARENA_HEIGHT, viewTop + height + gridStep);

    ctx.beginPath();
    for (let x = startX; x <= endX; x += gridStep) {
      ctx.moveTo(x, Math.max(0, viewTop));
      ctx.lineTo(x, Math.min(ARENA_HEIGHT, viewTop + height));
    }
    for (let y = startY; y <= endY; y += gridStep) {
      ctx.moveTo(Math.max(0, viewLeft), y);
      ctx.lineTo(Math.min(ARENA_WIDTH, viewLeft + width), y);
    }
    ctx.stroke();

    // Arena Outer Energy Barrier
    ctx.strokeStyle = '#00F0FF';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

    // 5. Render PowerUps
    const nowSec = performance.now() / 1000;
    for (const pwr of snapshot.powerUps) {
      ctx.save();
      ctx.translate(pwr.x, pwr.y);
      const pulse = 1 + Math.sin(nowSec * 5) * 0.12;
      const color =
        pwr.type === 'hull_repair'
          ? '#10B981'
          : pwr.type === 'shield_boost'
            ? '#38BDF8'
            : pwr.type === 'rapid_fire'
              ? '#F43F5E'
              : '#F59E0B';
      const label =
        pwr.type === 'hull_repair'
          ? '+HULL'
          : pwr.type === 'shield_boost'
            ? '+SHLD'
            : pwr.type === 'rapid_fire'
              ? 'OVERDRIVE'
              : '+BOOST';

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 16 * pulse, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, 0, -22);
      ctx.restore();
    }

    // 6. Render Asteroids
    for (const ast of snapshot.asteroids) {
      if (
        ast.x + ast.radius < viewLeft ||
        ast.x - ast.radius > viewLeft + width ||
        ast.y + ast.radius < viewTop ||
        ast.y - ast.radius > viewTop + height
      ) {
        continue;
      }
      ctx.save();
      ctx.translate(ast.x, ast.y);
      ctx.rotate(ast.rotation);

      ctx.fillStyle = '#0F172A';
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const count = ast.vertices.length;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const r = ast.radius * ast.vertices[i];
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 7. Render Projectiles
    for (const prj of snapshot.projectiles) {
      ctx.save();
      ctx.translate(prj.x, prj.y);
      ctx.rotate(prj.angle);

      ctx.fillStyle = prj.color;
      if (!reducedEffects) {
        ctx.shadowColor = prj.color;
        ctx.shadowBlur = 10;
      }

      if (prj.isEnemy) {
        ctx.beginPath();
        ctx.arc(0, 0, prj.radius, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const length = prj.piercing ? 26 : 16;
        ctx.beginPath();
        ctx.roundRect(-length / 2, -prj.radius * 0.65, length, prj.radius * 1.3, 3);
        ctx.fill();
      }
      ctx.restore();
    }

    // 8. Render Enemies (with Client Interpolation)
    for (const enemy of snapshot.enemies) {
      let interp = this.interpEnemies.get(enemy.id);
      if (!interp) {
        interp = { x: enemy.x, y: enemy.y, angle: enemy.angle };
        this.interpEnemies.set(enemy.id, interp);
      } else {
        const factor = Math.min(1, dt * 16);
        interp.x += (enemy.x - interp.x) * factor;
        interp.y += (enemy.y - interp.y) * factor;
        interp.angle = enemy.angle;
      }

      this.drawEnemy(ctx, enemy, interp.x, interp.y, interp.angle, reducedEffects);
    }

    // 9. Render Players (with Client Interpolation & Thruster Particles)
    for (const player of snapshot.players) {
      if (!player.connected || player.respawnTimer > 0) continue;

      let interp = this.interpPlayers.get(player.id);
      if (!interp) {
        interp = { x: player.x, y: player.y, angle: player.angle };
        this.interpPlayers.set(player.id, interp);
      } else {
        const factor = player.pilotId === localPilotId ? Math.min(1, dt * 22) : Math.min(1, dt * 15);
        interp.x += (player.x - interp.x) * factor;
        interp.y += (player.y - interp.y) * factor;
        interp.angle =
          player.pilotId === localPilotId && mouseWorldAngle !== null
            ? mouseWorldAngle
            : player.angle;
      }

      // Emit thruster trail particles when moving
      const speedSq = player.vx * player.vx + player.vy * player.vy;
      if (speedSq > 400 && (!reducedEffects || player.isBoosting)) {
        const backAngle = interp.angle + Math.PI + (Math.random() - 0.5) * 0.35;
        this.particles.push({
          x: interp.x + Math.cos(interp.angle + Math.PI) * 18,
          y: interp.y + Math.sin(interp.angle + Math.PI) * 18,
          vx: Math.cos(backAngle) * (player.isBoosting ? 180 : 90),
          vy: Math.sin(backAngle) * (player.isBoosting ? 180 : 90),
          radius: player.isBoosting ? 4.5 : 2.8,
          color: player.isBoosting ? '#38BDF8' : player.color,
          alpha: 0.85,
          decay: 3.2,
        });
      }

      this.drawPlayerShip(
        ctx,
        player,
        interp.x,
        interp.y,
        interp.angle,
        player.pilotId === localPilotId,
        reducedEffects
      );
    }

    // 10. Update & Render Particle Effects
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alpha -= p.decay * dt;
      if (p.alpha <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  private drawPlayerShip(
    ctx: CanvasRenderingContext2D,
    player: PlayerState,
    x: number,
    y: number,
    angle: number,
    isLocal: boolean,
    reducedEffects: boolean
  ) {
    ctx.save();
    ctx.translate(x, y);

    // Invulnerability or Active Shield Aura
    if (player.invulnerableTimer > 0) {
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, 32, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (player.shield > 0) {
      ctx.strokeStyle = player.color;
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 27, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.rotate(angle);
    ArenaRenderer.drawShipHullGeometry(
      ctx,
      player.shipType,
      player.color,
      player.isBoosting,
      reducedEffects
    );
    ctx.restore();

    // Overhead Pilot Callsign & Micro Health Bar
    ctx.save();
    ctx.translate(x, y);
    ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = isLocal ? '#38BDF8' : '#E2E8F0';
    ctx.fillText(player.username, 0, -36);

    const barW = 42;
    const barH = 4;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(-barW / 2, -30, barW, barH);

    const hpPct = Math.max(0, Math.min(1, player.hp / player.maxHp));
    ctx.fillStyle = hpPct > 0.5 ? '#10B981' : hpPct > 0.25 ? '#F59E0B' : '#F43F5E';
    ctx.fillRect(-barW / 2, -30, barW * hpPct, barH);

    if (player.shield > 0) {
      const shPct = Math.max(0, Math.min(1, player.shield / player.maxShield));
      ctx.fillStyle = '#38BDF8';
      ctx.fillRect(-barW / 2, -25, barW * shPct, 2);
    }
    ctx.restore();
  }

  public static drawShipHullGeometry(
    ctx: CanvasRenderingContext2D,
    shipType: ShipType,
    color: string,
    isBoosting: boolean,
    reducedEffects = false
  ) {
    if (!reducedEffects) {
      ctx.shadowColor = color;
      ctx.shadowBlur = isBoosting ? 18 : 10;
    }

    // Engine Flame
    const flameLen = isBoosting ? 24 + Math.random() * 10 : 12 + Math.random() * 5;
    ctx.fillStyle = isBoosting ? '#38BDF8' : color;
    ctx.beginPath();
    ctx.moveTo(-14, -5);
    ctx.lineTo(-14 - flameLen, 0);
    ctx.lineTo(-14, 5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#0B132B';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;

    if (shipType === 'vanguard') {
      // Balanced delta interceptor with twin forward wing cannons
      ctx.beginPath();
      ctx.moveTo(22, 0);
      ctx.lineTo(-12, 17);
      ctx.lineTo(-8, 6);
      ctx.lineTo(-16, 4);
      ctx.lineTo(-16, -4);
      ctx.lineTo(-8, -6);
      ctx.lineTo(-12, -17);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Cockpit canopy
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-4, 4);
      ctx.lineTo(-4, -4);
      ctx.closePath();
      ctx.fill();
    } else if (shipType === 'phantom') {
      // Swept-forward stealth needle fighter
      ctx.beginPath();
      ctx.moveTo(25, 0);
      ctx.lineTo(2, 6);
      ctx.lineTo(-10, 18);
      ctx.lineTo(-16, 12);
      ctx.lineTo(-11, 0);
      ctx.lineTo(-16, -12);
      ctx.lineTo(-10, -18);
      ctx.lineTo(2, -6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.fillRect(-5, -2, 16, 4);
    } else if (shipType === 'titan') {
      // Heavy wide-shouldered dreadnought gunship
      ctx.beginPath();
      ctx.moveTo(20, -7);
      ctx.lineTo(24, 0);
      ctx.lineTo(20, 7);
      ctx.lineTo(4, 22);
      ctx.lineTo(-16, 19);
      ctx.lineTo(-19, 8);
      ctx.lineTo(-19, -8);
      ctx.lineTo(-16, -19);
      ctx.lineTo(4, -22);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Core armor plates
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Nova: Energy diamond cruiser with glowing singularity core
      ctx.beginPath();
      ctx.moveTo(24, 0);
      ctx.lineTo(2, 19);
      ctx.lineTo(-17, 10);
      ctx.lineTo(-12, 0);
      ctx.lineTo(-17, -10);
      ctx.lineTo(2, -19);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(2, 0, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.shadowBlur = 0;
  }

  private drawEnemy(
    ctx: CanvasRenderingContext2D,
    enemy: EnemyState,
    x: number,
    y: number,
    angle: number,
    reducedEffects: boolean
  ) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    if (!reducedEffects) {
      ctx.shadowColor = enemy.color;
      ctx.shadowBlur = enemy.type === 'boss' ? 22 : 8;
    }

    ctx.fillStyle = '#111827';
    ctx.strokeStyle = enemy.color;
    ctx.lineWidth = enemy.type === 'boss' ? 3.5 : 2;

    if (enemy.type === 'boss') {
      // Multi-phase dreadnought boss
      const r = enemy.radius;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const rad = i % 2 === 0 ? r : r * 0.72;
        const px = Math.cos(a) * rad;
        const py = Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Boss phase inner core
      ctx.fillStyle =
        enemy.bossPhase === 3 ? '#F43F5E' : enemy.bossPhase === 2 ? '#EC4899' : '#38BDF8';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.34, 0, Math.PI * 2);
      ctx.fill();
    } else if (enemy.type === 'heavy') {
      const r = enemy.radius;
      ctx.beginPath();
      ctx.moveTo(r, -r * 0.4);
      ctx.lineTo(r, r * 0.4);
      ctx.lineTo(-r * 0.5, r);
      ctx.lineTo(-r, r * 0.5);
      ctx.lineTo(-r, -r * 0.5);
      ctx.lineTo(-r * 0.5, -r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (enemy.type === 'exploder') {
      const pulse = 1 + Math.sin(performance.now() * 0.015) * 0.16;
      const r = enemy.radius * pulse;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      // Scout, Chaser, Ranged angular fighters
      const r = enemy.radius;
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(-r * 0.8, r * 0.85);
      ctx.lineTo(-r * 0.4, 0);
      ctx.lineTo(-r * 0.8, -r * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
    ctx.restore();

    // Enemy health bar (for non-boss enemies that took damage)
    if (enemy.type !== 'boss' && enemy.hp < enemy.maxHp) {
      const bw = 32;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(x - bw / 2, y - enemy.radius - 12, bw, 3.5);
      ctx.fillStyle = enemy.color;
      ctx.fillRect(
        x - bw / 2,
        y - enemy.radius - 12,
        bw * Math.max(0, enemy.hp / enemy.maxHp),
        3.5
      );
    }
  }
}

export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: GameSnapshot,
  localPilotId: string
) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(5, 8, 20, 0.85)';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  const scaleX = width / ARENA_WIDTH;
  const scaleY = height / ARENA_HEIGHT;

  // Powerups
  for (const pwr of snapshot.powerUps) {
    ctx.fillStyle = '#10B981';
    ctx.fillRect(pwr.x * scaleX - 1.5, pwr.y * scaleY - 1.5, 3, 3);
  }

  // Enemies
  for (const enemy of snapshot.enemies) {
    ctx.fillStyle = enemy.type === 'boss' ? '#F43F5E' : '#FB7185';
    const r = enemy.type === 'boss' ? 4.5 : 2;
    ctx.beginPath();
    ctx.arc(enemy.x * scaleX, enemy.y * scaleY, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Players
  for (const player of snapshot.players) {
    if (!player.connected || player.respawnTimer > 0) continue;
    const isLocal = player.pilotId === localPilotId;
    ctx.fillStyle = isLocal ? '#00F0FF' : player.color;
    ctx.beginPath();
    ctx.arc(player.x * scaleX, player.y * scaleY, isLocal ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
