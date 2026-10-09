import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  AsteroidState,
  EnemyState,
  EnemyType,
  ExplosionEvent,
  GameSnapshot,
  KillNotification,
  PlayerInput,
  PlayerState,
  PowerUpState,
  PowerUpType,
  ProjectileState,
  RoomStatus,
  SHIP_SPECS,
  ShipType,
} from '../shared/types.ts';

interface InternalEnemy extends EnemyState {
  fireCooldown: number;
  secondaryCooldown: number;
  aiTimer: number;
  strafeDir: number;
}

/**
 * Local Solo Development Engine (Single-Player Only - Zero Fake Remote Players).
 * Used strictly when running the frontend in development mode without a deployed
 * multiplayer backend so the developer can test ship controls, enemy waves,
 * multi-phase bosses, collisions, HUD, and audio locally.
 */
export class LocalDevArena {
  public status: RoomStatus = 'PLAYING';
  public wave = 1;
  public maxWaves = 10;
  public waveBannerTimer = 3.5;
  public waveTitle = 'WAVE 1 — SOLO DEV SIMULATION';
  public enemiesToSpawnQueue: EnemyType[] = [];
  public spawnIntervalTimer = 0.5;
  public matchTimer = 0;
  public teamScore = 0;

  public player: PlayerState;
  public input: PlayerInput = {
    up: false,
    down: false,
    left: false,
    right: false,
    shoot: false,
    boost: false,
    aimAngle: -Math.PI / 2,
    seq: 0,
  };

  private lastFireTime = 0;
  private lastDamageTime = 0;
  private entityCounter = 0;

  public enemies = new Map<string, InternalEnemy>();
  public projectiles = new Map<string, ProjectileState>();
  public asteroids = new Map<string, AsteroidState>();
  public powerUps = new Map<string, PowerUpState>();
  public pendingExplosions: ExplosionEvent[] = [];
  public killFeed: KillNotification[] = [];

  constructor(pilotId: string, username: string, shipType: ShipType, color: string, level = 1) {
    const spec = SHIP_SPECS[shipType] || SHIP_SPECS.vanguard;
    this.player = {
      id: pilotId,
      pilotId,
      username,
      shipType: spec.id,
      color,
      isReady: true,
      isHost: true,
      connected: true,
      level,
      x: ARENA_WIDTH / 2,
      y: ARENA_HEIGHT / 2,
      vx: 0,
      vy: 0,
      angle: -Math.PI / 2,
      hp: spec.maxHp,
      maxHp: spec.maxHp,
      shield: spec.maxShield,
      maxShield: spec.maxShield,
      boostEnergy: 100,
      isBoosting: false,
      lives: 3,
      maxLives: 3,
      respawnTimer: 0,
      invulnerableTimer: 2.5,
      rapidFireTimer: 0,
      score: 0,
      kills: 0,
      deaths: 0,
      bossDamageDealt: 0,
    };

    this.initAsteroids();
    this.prepareWave(1);
  }

  private nextId(prefix: string): string {
    this.entityCounter += 1;
    return `dev_${prefix}_${this.entityCounter}`;
  }

  private initAsteroids() {
    this.asteroids.clear();
    for (let i = 0; i < 20; i++) {
      const radius = 32 + Math.random() * 46;
      const vertices: number[] = [];
      for (let p = 0; p < 9; p++) {
        vertices.push(0.78 + Math.random() * 0.36);
      }
      const id = this.nextId('ast');
      let x = 220 + Math.random() * (ARENA_WIDTH - 440);
      let y = 220 + Math.random() * (ARENA_HEIGHT - 440);
      if (Math.hypot(x - ARENA_WIDTH / 2, y - ARENA_HEIGHT / 2) < 220) {
        x += 320;
      }
      this.asteroids.set(id, {
        id,
        x,
        y,
        vx: (Math.random() - 0.5) * 28,
        vy: (Math.random() - 0.5) * 28,
        radius,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.8,
        vertices,
        hp: Math.round(radius * 2.5),
        maxHp: Math.round(radius * 2.5),
      });
    }
  }

  public restart() {
    const spec = SHIP_SPECS[this.player.shipType];
    this.status = 'PLAYING';
    this.wave = 1;
    this.matchTimer = 0;
    this.teamScore = 0;
    this.enemies.clear();
    this.projectiles.clear();
    this.powerUps.clear();
    this.killFeed = [];
    this.player.x = ARENA_WIDTH / 2;
    this.player.y = ARENA_HEIGHT / 2;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.hp = spec.maxHp;
    this.player.shield = spec.maxShield;
    this.player.boostEnergy = 100;
    this.player.lives = 3;
    this.player.respawnTimer = 0;
    this.player.invulnerableTimer = 2.5;
    this.player.score = 0;
    this.player.kills = 0;
    this.player.deaths = 0;
    this.initAsteroids();
    this.prepareWave(1);
  }

  private prepareWave(waveNum: number) {
    this.wave = waveNum;
    this.waveBannerTimer = 3.2;
    this.enemiesToSpawnQueue = [];

    if (waveNum % 5 === 0 || waveNum === 3) {
      this.waveTitle =
        waveNum === 3
          ? `WAVE ${waveNum} — VANGUARD COMMANDER`
          : waveNum === 5
            ? `WAVE ${waveNum} — DREADNOUGHT OVERLORD`
            : `WAVE ${waveNum} — VOID LEVIATHAN`;
      this.enemiesToSpawnQueue.push('boss', 'scout', 'ranged', 'scout');
    } else {
      this.waveTitle = `WAVE ${waveNum} — HOSTILE SQUADRON`;
      const total = 5 + waveNum * 3;
      for (let i = 0; i < total; i++) {
        const roll = Math.random();
        if (waveNum === 1) {
          this.enemiesToSpawnQueue.push(roll < 0.6 ? 'scout' : 'chaser');
        } else if (roll < 0.25) {
          this.enemiesToSpawnQueue.push('scout');
        } else if (roll < 0.5) {
          this.enemiesToSpawnQueue.push('chaser');
        } else if (roll < 0.72) {
          this.enemiesToSpawnQueue.push('ranged');
        } else if (roll < 0.88) {
          this.enemiesToSpawnQueue.push('heavy');
        } else {
          this.enemiesToSpawnQueue.push('exploder');
        }
      }
    }
    this.spawnIntervalTimer = 0.5;
  }

  private spawnEnemy(type: EnemyType) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 700 + Math.random() * 350;
    const x = Math.max(120, Math.min(ARENA_WIDTH - 120, this.player.x + Math.cos(angle) * dist));
    const y = Math.max(120, Math.min(ARENA_HEIGHT - 120, this.player.y + Math.sin(angle) * dist));
    const id = this.nextId('enm');
    const waveMult = 1 + (this.wave - 1) * 0.14;

    if (type === 'boss') {
      const bossHp = this.wave === 3 ? 1000 : 2000 + this.wave * 200;
      this.enemies.set(id, {
        id,
        type: 'boss',
        name:
          this.wave === 3
            ? 'AEGIS CRUISER'
            : this.wave === 5
              ? 'OVERLORD MK-IX'
              : 'VOID LEVIATHAN',
        x,
        y,
        vx: 0,
        vy: 0,
        angle: 0,
        hp: bossHp,
        maxHp: bossHp,
        radius: 58,
        color: '#F43F5E',
        scoreValue: 1200,
        bossPhase: 1,
        fireCooldown: 1.2,
        secondaryCooldown: 5.0,
        aiTimer: 0,
        strafeDir: 1,
      });
      return;
    }

    const configs: Record<
      Exclude<EnemyType, 'boss'>,
      { name: string; hp: number; radius: number; color: string; score: number }
    > = {
      scout: { name: 'Dart Scout', hp: 45, radius: 15, color: '#38BDF8', score: 100 },
      chaser: { name: 'Viper Stalker', hp: 70, radius: 18, color: '#F59E0B', score: 140 },
      ranged: { name: 'Pulse Marksman', hp: 80, radius: 19, color: '#A855F7', score: 175 },
      heavy: { name: 'Goliath Enforcer', hp: 210, radius: 28, color: '#EF4444', score: 280 },
      exploder: { name: 'Volatile Drone', hp: 55, radius: 16, color: '#FB7185', score: 160 },
    };

    const cfg = configs[type];
    const scaledHp = Math.round(cfg.hp * waveMult);
    this.enemies.set(id, {
      id,
      type,
      name: cfg.name,
      x,
      y,
      vx: 0,
      vy: 0,
      angle: 0,
      hp: scaledHp,
      maxHp: scaledHp,
      radius: cfg.radius,
      color: cfg.color,
      scoreValue: cfg.score,
      fireCooldown: 1.2,
      secondaryCooldown: 0,
      aiTimer: Math.random() * 4,
      strafeDir: Math.random() < 0.5 ? 1 : -1,
    });
  }

  public update(dt: number) {
    if (this.status !== 'PLAYING') return;

    if (this.waveBannerTimer > 0) {
      this.waveBannerTimer = Math.max(0, this.waveBannerTimer - dt);
    }
    this.matchTimer += dt;

    if (this.enemiesToSpawnQueue.length > 0) {
      this.spawnIntervalTimer -= dt;
      if (this.spawnIntervalTimer <= 0 && this.enemies.size < 22) {
        const nextType = this.enemiesToSpawnQueue.shift()!;
        this.spawnEnemy(nextType);
        this.spawnIntervalTimer = nextType === 'boss' ? 1.8 : 0.75;
      }
    }

    const nowMs = Date.now();
    const p = this.player;
    const spec = SHIP_SPECS[p.shipType];

    if (p.respawnTimer > 0) {
      p.respawnTimer = Math.max(0, p.respawnTimer - dt);
      if (p.respawnTimer === 0 && p.lives > 0) {
        p.hp = spec.maxHp;
        p.shield = spec.maxShield;
        p.boostEnergy = 100;
        p.invulnerableTimer = 2.8;
      }
    } else {
      if (p.invulnerableTimer > 0) p.invulnerableTimer = Math.max(0, p.invulnerableTimer - dt);
      if (p.rapidFireTimer > 0) p.rapidFireTimer = Math.max(0, p.rapidFireTimer - dt);

      if (nowMs - this.lastDamageTime > 3500 && p.shield < p.maxShield) {
        p.shield = Math.min(p.maxShield, p.shield + spec.shieldRegenRate * dt);
      }

      const wantsBoost =
        this.input.boost &&
        (this.input.up || this.input.down || this.input.left || this.input.right);
      if (wantsBoost && p.boostEnergy > 5) {
        p.isBoosting = true;
        p.boostEnergy = Math.max(0, p.boostEnergy - spec.boostDrainRate * dt);
      } else {
        p.isBoosting = false;
        p.boostEnergy = Math.min(100, p.boostEnergy + spec.boostRegenRate * dt);
      }

      let mx = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
      let my = (this.input.down ? 1 : 0) - (this.input.up ? 1 : 0);
      const len = Math.hypot(mx, my);
      if (len > 0) {
        mx /= len;
        my /= len;
      }

      const targetSpeed = spec.speed * (p.isBoosting ? spec.boostMultiplier : 1);
      p.vx += (mx * targetSpeed - p.vx) * Math.min(1, 9.5 * dt);
      p.vy += (my * targetSpeed - p.vy) * Math.min(1, 9.5 * dt);
      p.x = Math.max(30, Math.min(ARENA_WIDTH - 30, p.x + p.vx * dt));
      p.y = Math.max(30, Math.min(ARENA_HEIGHT - 30, p.y + p.vy * dt));
      p.angle = this.input.aimAngle;

      const cd = p.rapidFireTimer > 0 ? spec.fireCooldownMs * 0.58 : spec.fireCooldownMs;
      if (this.input.shoot && nowMs - this.lastFireTime >= cd) {
        this.lastFireTime = nowMs;
        this.firePlayerWeapon();
      }
    }

    // Update Asteroids
    for (const ast of this.asteroids.values()) {
      ast.x += ast.vx * dt;
      ast.y += ast.vy * dt;
      ast.rotation += ast.rotationSpeed * dt;
      if (ast.x < ast.radius + 40 || ast.x > ARENA_WIDTH - ast.radius - 40) ast.vx *= -1;
      if (ast.y < ast.radius + 40 || ast.y > ARENA_HEIGHT - ast.radius - 40) ast.vy *= -1;
    }

    // Update Enemies
    for (const [id, enemy] of this.enemies.entries()) {
      enemy.aiTimer += dt;
      enemy.fireCooldown -= dt;
      enemy.secondaryCooldown -= dt;

      if (p.respawnTimer > 0) continue;

      const dx = p.x - enemy.x;
      const dy = p.y - enemy.y;
      const dist = Math.hypot(dx, dy) || 1;
      const dirX = dx / dist;
      const dirY = dy / dist;
      enemy.angle = Math.atan2(dy, dx);

      if (enemy.type === 'scout') {
        const moveAngle = enemy.angle + Math.sin(enemy.aiTimer * 4.5) * 0.65;
        enemy.vx = Math.cos(moveAngle) * 290;
        enemy.vy = Math.sin(moveAngle) * 290;
        if (enemy.fireCooldown <= 0 && dist < 680) {
          enemy.fireCooldown = 1.6;
          this.spawnEnemyBolt(enemy, enemy.angle, 560, 12, '#38BDF8', 4);
        }
      } else if (enemy.type === 'chaser') {
        enemy.vx = dirX * 255;
        enemy.vy = dirY * 255;
        if (enemy.fireCooldown <= 0 && dist < 520) {
          enemy.fireCooldown = 1.45;
          this.spawnEnemyBolt(enemy, enemy.angle, 600, 14, '#F59E0B', 4.5);
        }
      } else if (enemy.type === 'ranged') {
        const perpX = -dirY * enemy.strafeDir;
        const perpY = dirX * enemy.strafeDir;
        enemy.vx = (dist > 540 ? dirX : dist < 360 ? -dirX : 0) * 180 + perpX * 150;
        enemy.vy = (dist > 540 ? dirY : dist < 360 ? -dirY : 0) * 180 + perpY * 150;
        if (enemy.fireCooldown <= 0 && dist < 850) {
          enemy.fireCooldown = 1.75;
          this.spawnEnemyBolt(enemy, enemy.angle, 740, 20, '#A855F7', 5);
        }
      } else if (enemy.type === 'heavy') {
        enemy.vx = dirX * 135;
        enemy.vy = dirY * 135;
        if (enemy.fireCooldown <= 0 && dist < 750) {
          enemy.fireCooldown = 2.1;
          this.spawnEnemyBolt(enemy, enemy.angle - 0.1, 520, 20, '#EF4444', 6);
          this.spawnEnemyBolt(enemy, enemy.angle + 0.1, 520, 20, '#EF4444', 6);
        }
      } else if (enemy.type === 'exploder') {
        enemy.vx = dirX * 345;
        enemy.vy = dirY * 345;
        if (dist <= enemy.radius + 36) {
          this.pendingExplosions.push({
            id: this.nextId('exp'),
            x: enemy.x,
            y: enemy.y,
            color: '#FB7185',
            radius: 95,
            intensity: 'large',
          });
          this.damagePlayer(42, enemy.name);
          this.enemies.delete(id);
          continue;
        }
      } else if (enemy.type === 'boss') {
        const hpRatio = enemy.hp / enemy.maxHp;
        enemy.bossPhase = hpRatio > 0.65 ? 1 : hpRatio > 0.3 ? 2 : 3;
        const spd = enemy.bossPhase === 1 ? 115 : enemy.bossPhase === 2 ? 150 : 195;
        enemy.vx = (dist > 480 ? dirX : -dirY * enemy.strafeDir) * spd;
        enemy.vy = (dist > 480 ? dirY : dirX * enemy.strafeDir) * spd;

        if (enemy.fireCooldown <= 0) {
          enemy.fireCooldown = enemy.bossPhase === 3 ? 0.75 : 1.15;
          const count = enemy.bossPhase === 3 ? 10 : 5;
          for (let i = 0; i < count; i++) {
            const offset =
              enemy.bossPhase === 3
                ? (i * Math.PI * 2) / count + enemy.aiTimer
                : enemy.angle + (i - 2) * 0.15;
            this.spawnEnemyBolt(enemy, offset, 600, 20, '#F43F5E', 6.5);
          }
        }
      }

      enemy.x = Math.max(40, Math.min(ARENA_WIDTH - 40, enemy.x + enemy.vx * dt));
      enemy.y = Math.max(40, Math.min(ARENA_HEIGHT - 40, enemy.y + enemy.vy * dt));
    }

    // Update Projectiles
    for (const [id, prj] of this.projectiles.entries()) {
      prj.x += prj.vx * dt;
      prj.y += prj.vy * dt;
      prj.ttl -= dt;
      if (prj.ttl <= 0 || prj.x < 0 || prj.x > ARENA_WIDTH || prj.y < 0 || prj.y > ARENA_HEIGHT) {
        this.projectiles.delete(id);
        continue;
      }

      if (prj.isEnemy) {
        if (
          p.respawnTimer === 0 &&
          Math.hypot(prj.x - p.x, prj.y - p.y) <= spec.radius + prj.radius
        ) {
          this.pendingExplosions.push({
            id: this.nextId('exp'),
            x: prj.x,
            y: prj.y,
            color: prj.color,
            radius: 20,
            intensity: 'small',
          });
          this.damagePlayer(prj.damage, 'Hostile Fire');
          this.projectiles.delete(id);
        }
      } else {
        for (const [eId, enemy] of this.enemies.entries()) {
          if (Math.hypot(prj.x - enemy.x, prj.y - enemy.y) <= enemy.radius + prj.radius) {
            enemy.hp -= prj.damage;
            this.pendingExplosions.push({
              id: this.nextId('exp'),
              x: prj.x,
              y: prj.y,
              color: prj.color,
              radius: 20,
              intensity: 'small',
            });
            if (enemy.hp <= 0) {
              this.enemies.delete(eId);
              this.pendingExplosions.push({
                id: this.nextId('exp'),
                x: enemy.x,
                y: enemy.y,
                color: enemy.color,
                radius: enemy.type === 'boss' ? 140 : 48,
                intensity: enemy.type === 'boss' ? 'boss' : 'medium',
              });
              p.score += enemy.scoreValue;
              p.kills += 1;
              this.teamScore += enemy.scoreValue;
              this.killFeed.unshift({
                id: this.nextId('kf'),
                killerName: p.username,
                killerColor: p.color,
                victimName: enemy.name,
                victimType: enemy.type === 'boss' ? 'boss' : 'enemy',
                weaponOrRole: spec.name,
                timestamp: Date.now(),
              });
              if (this.killFeed.length > 6) this.killFeed.length = 6;
              if (enemy.type === 'boss' || Math.random() < 0.28) {
                const types: PowerUpType[] = [
                  'hull_repair',
                  'shield_boost',
                  'rapid_fire',
                  'boost_cell',
                ];
                const pId = this.nextId('pwr');
                this.powerUps.set(pId, {
                  id: pId,
                  type: types[Math.floor(Math.random() * types.length)],
                  x: enemy.x,
                  y: enemy.y,
                  ttl: 18,
                });
              }
            }
            if (!prj.piercing) {
              this.projectiles.delete(id);
              break;
            }
          }
        }
      }
    }

    // Powerups
    for (const [id, pwr] of this.powerUps.entries()) {
      pwr.ttl -= dt;
      if (pwr.ttl <= 0) {
        this.powerUps.delete(id);
        continue;
      }
      if (p.respawnTimer === 0 && Math.hypot(p.x - pwr.x, p.y - pwr.y) <= 38) {
        if (pwr.type === 'hull_repair') p.hp = Math.min(p.maxHp, p.hp + 55);
        else if (pwr.type === 'shield_boost') p.shield = p.maxShield;
        else if (pwr.type === 'rapid_fire') p.rapidFireTimer = 8.0;
        else p.boostEnergy = 100;
        p.score += 50;
        this.teamScore += 50;
        this.powerUps.delete(id);
      }
    }

    if (p.lives <= 0) {
      this.status = 'DEFEAT';
    } else if (this.enemies.size === 0 && this.enemiesToSpawnQueue.length === 0) {
      if (this.wave >= this.maxWaves) {
        this.status = 'VICTORY';
      } else {
        this.prepareWave(this.wave + 1);
      }
    }
  }

  private firePlayerWeapon() {
    const p = this.player;
    const spec = SHIP_SPECS[p.shipType];
    const cos = Math.cos(p.angle);
    const sin = Math.sin(p.angle);
    const perpX = -sin;
    const perpY = cos;

    const addBolt = (
      fwd: number,
      side: number,
      aOff: number,
      dmg: number,
      rad: number,
      pierce = false
    ) => {
      const id = this.nextId('prj');
      const a = p.angle + aOff;
      this.projectiles.set(id, {
        id,
        ownerId: p.id,
        isEnemy: false,
        x: p.x + cos * fwd + perpX * side,
        y: p.y + sin * fwd + perpY * side,
        vx: Math.cos(a) * spec.projectileSpeed,
        vy: Math.sin(a) * spec.projectileSpeed,
        angle: a,
        damage: dmg,
        color: p.color,
        radius: rad,
        ttl: 1.35,
        piercing: pierce,
      });
    };

    if (spec.projectilePattern === 'twin') {
      addBolt(20, -9, 0, spec.damage / 2, 4);
      addBolt(20, 9, 0, spec.damage / 2, 4);
    } else if (spec.projectilePattern === 'rapid') {
      addBolt(20, 0, (Math.random() - 0.5) * 0.06, spec.damage, 3.5);
    } else if (spec.projectilePattern === 'spread') {
      addBolt(24, -6, -0.14, spec.damage, 5);
      addBolt(26, 0, 0, spec.damage, 5.5);
      addBolt(24, 6, 0.14, spec.damage, 5);
    } else {
      addBolt(24, 0, 0, spec.damage, 5.5, true);
    }
  }

  private spawnEnemyBolt(
    enemy: InternalEnemy,
    angle: number,
    speed: number,
    damage: number,
    color: string,
    radius: number
  ) {
    const id = this.nextId('eprj');
    this.projectiles.set(id, {
      id,
      ownerId: enemy.id,
      isEnemy: true,
      x: enemy.x + Math.cos(angle) * (enemy.radius + 8),
      y: enemy.y + Math.sin(angle) * (enemy.radius + 8),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      angle,
      damage,
      color,
      radius,
      ttl: 2.4,
    });
  }

  private damagePlayer(amount: number, sourceName: string) {
    const p = this.player;
    if (p.invulnerableTimer > 0 || p.respawnTimer > 0) return;
    this.lastDamageTime = Date.now();
    let rem = amount;
    if (p.shield > 0) {
      const abs = Math.min(p.shield, rem);
      p.shield -= abs;
      rem -= abs;
    }
    if (rem > 0) p.hp = Math.max(0, p.hp - rem);
    if (p.hp <= 0) {
      p.deaths += 1;
      p.lives = Math.max(0, p.lives - 1);
      p.respawnTimer = p.lives > 0 ? 3.5 : 999;
      this.pendingExplosions.push({
        id: this.nextId('exp'),
        x: p.x,
        y: p.y,
        color: p.color,
        radius: 75,
        intensity: 'large',
      });
      this.killFeed.unshift({
        id: this.nextId('kf'),
        killerName: sourceName,
        killerColor: '#F43F5E',
        victimName: p.username,
        victimType: 'player',
        weaponOrRole: 'Plasma Impact',
        timestamp: Date.now(),
      });
    }
  }

  public consumeSnapshot(): GameSnapshot {
    const explosions = [...this.pendingExplosions];
    this.pendingExplosions = [];
    return {
      roomCode: 'SOLO-DEV',
      roomName: 'Local Solo Dev Simulation (No Backend)',
      mode: 'COOP_SURVIVAL',
      status: this.status,
      isPublic: false,
      maxPlayers: 1,
      wave: this.wave,
      maxWaves: this.maxWaves,
      waveBannerTimer: Number(this.waveBannerTimer.toFixed(2)),
      waveTitle: this.waveTitle,
      enemiesRemainingInWave: this.enemies.size + this.enemiesToSpawnQueue.length,
      matchTimer: Math.round(this.matchTimer),
      teamScore: this.teamScore,
      targetScoreFFA: 2000,
      winnerName: this.player.username,
      players: [{ ...this.player, hp: Math.round(this.player.hp), shield: Math.round(this.player.shield), boostEnergy: Math.round(this.player.boostEnergy), respawnTimer: Number(this.player.respawnTimer.toFixed(1)), invulnerableTimer: Number(this.player.invulnerableTimer.toFixed(1)), rapidFireTimer: Number(this.player.rapidFireTimer.toFixed(1)) }],
      enemies: Array.from(this.enemies.values()).map((e) => ({ ...e, hp: Math.round(e.hp) })),
      projectiles: Array.from(this.projectiles.values()),
      asteroids: Array.from(this.asteroids.values()),
      powerUps: Array.from(this.powerUps.values()),
      explosions,
      killFeed: this.killFeed,
      serverTime: Date.now(),
    };
  }
}
