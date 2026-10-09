import fs from 'fs';
import path from 'path';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  AsteroidState,
  EnemyState,
  EnemyType,
  ExplosionEvent,
  GameMode,
  GameSnapshot,
  KillNotification,
  LeaderboardEntry,
  MAX_PLAYERS_PER_ROOM,
  PilotProfile,
  PlayerInput,
  PlayerState,
  PowerUpState,
  PowerUpType,
  ProjectileState,
  RoomStatus,
  RoomSummary,
  SHIP_SPECS,
  ShipType,
} from '../shared/types.ts';

interface PersistentData {
  profiles: Record<string, PilotProfile>;
  leaderboard: LeaderboardEntry[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'storage.json');

export class StorageManager {
  private data: PersistentData = {
    profiles: {},
    leaderboard: [],
  };

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this.data = {
          profiles: parsed.profiles || {},
          leaderboard: parsed.leaderboard || [],
        };
      } else {
        this.seedInitialLeaderboard();
        this.save();
      }
    } catch (err) {
      console.error('Failed to load persistent storage, using in-memory store:', err);
    }
  }

  private seedInitialLeaderboard() {
    const now = Date.now();
    this.data.leaderboard = [
      {
        pilotId: 'seed-1',
        username: 'CMDR_VALKYRIE',
        shipType: 'nova',
        color: '#00F0FF',
        mode: 'COOP_SURVIVAL',
        score: 14850,
        kills: 94,
        wave: 10,
        level: 8,
        timestamp: now - 3600_000 * 5,
      },
      {
        pilotId: 'seed-2',
        username: 'KESTREL_ZERO',
        shipType: 'phantom',
        color: '#3B82F6',
        mode: 'COOP_SURVIVAL',
        score: 11200,
        kills: 76,
        wave: 8,
        level: 6,
        timestamp: now - 3600_000 * 12,
      },
      {
        pilotId: 'seed-3',
        username: 'IRON_BASTION',
        shipType: 'titan',
        color: '#F43F5E',
        mode: 'FREE_FOR_ALL',
        score: 3450,
        kills: 18,
        wave: 1,
        level: 5,
        timestamp: now - 3600_000 * 3,
      },
      {
        pilotId: 'seed-4',
        username: 'SOLARIS_VII',
        shipType: 'vanguard',
        color: '#8B5CF6',
        mode: 'FREE_FOR_ALL',
        score: 2800,
        kills: 14,
        wave: 1,
        level: 4,
        timestamp: now - 3600_000 * 8,
      },
    ];
  }

  public save() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to write storage.json:', err);
    }
  }

  public getOrCreateProfile(
    pilotId: string,
    username?: string,
    shipType?: ShipType,
    color?: string
  ): PilotProfile {
    const existing = this.data.profiles[pilotId];
    if (existing) {
      if (username && username.trim()) existing.username = username.trim().slice(0, 18);
      if (shipType && SHIP_SPECS[shipType]) existing.selectedShip = shipType;
      if (color) existing.selectedColor = color;
      existing.updatedAt = Date.now();
      this.save();
      return existing;
    }

    const profile: PilotProfile = {
      pilotId,
      username: (username || `PILOT_${pilotId.slice(0, 4).toUpperCase()}`).slice(0, 18),
      xp: 0,
      level: 1,
      selectedShip: shipType || 'vanguard',
      selectedColor: color || '#00F0FF',
      matchesPlayed: 0,
      victories: 0,
      totalKills: 0,
      bossesDefeated: 0,
      highestWave: 1,
      highScoreCoop: 0,
      highScoreFFA: 0,
      updatedAt: Date.now(),
    };
    this.data.profiles[pilotId] = profile;
    this.save();
    return profile;
  }

  public recordMatchResult(
    pilotId: string,
    username: string,
    shipType: ShipType,
    color: string,
    mode: GameMode,
    score: number,
    kills: number,
    wave: number,
    bossKills: number,
    won: boolean
  ): PilotProfile {
    const profile = this.getOrCreateProfile(pilotId, username, shipType, color);
    const xpGained = Math.max(50, Math.floor(score * 0.25) + kills * 25 + (won ? 350 : 100));
    profile.xp += xpGained;
    profile.level = Math.max(1, Math.floor(1 + Math.sqrt(profile.xp / 250)));
    profile.matchesPlayed += 1;
    if (won) profile.victories += 1;
    profile.totalKills += kills;
    profile.bossesDefeated += bossKills;
    if (mode === 'COOP_SURVIVAL') {
      profile.highestWave = Math.max(profile.highestWave, wave);
      profile.highScoreCoop = Math.max(profile.highScoreCoop, score);
    } else {
      profile.highScoreFFA = Math.max(profile.highScoreFFA, score);
    }
    profile.updatedAt = Date.now();

    if (score > 0) {
      this.data.leaderboard.push({
        pilotId,
        username: profile.username,
        shipType,
        color,
        mode,
        score,
        kills,
        wave,
        level: profile.level,
        timestamp: Date.now(),
      });
      this.data.leaderboard.sort((a, b) => b.score - a.score);
      this.data.leaderboard = this.data.leaderboard.slice(0, 50);
    }

    this.save();
    return profile;
  }

  public getLeaderboard(): LeaderboardEntry[] {
    return this.data.leaderboard.slice(0, 30);
  }
}

interface InternalPlayer extends PlayerState {
  socketId: string;
  input: PlayerInput;
  lastFireTime: number;
  lastDamageTime: number;
  bossKillsThisMatch: number;
}

interface InternalEnemy extends EnemyState {
  fireCooldown: number;
  secondaryCooldown: number;
  aiTimer: number;
  strafeDir: number;
}

export class GameRoom {
  public roomCode: string;
  public roomName: string;
  public mode: GameMode;
  public status: RoomStatus = 'LOBBY';
  public isPublic: boolean;
  public maxPlayers: number;

  public wave = 1;
  public maxWaves = 10;
  public waveBannerTimer = 0;
  public waveTitle = 'WAVE 1 — RECON PATROL';
  public enemiesToSpawnQueue: EnemyType[] = [];
  public spawnIntervalTimer = 0;

  public matchTimer = 0; // elapsed in COOP, remaining in FFA
  public teamScore = 0;
  public targetScoreFFA = 2000;
  public winnerName?: string;

  public players = new Map<string, InternalPlayer>(); // keyed by pilotId
  public socketToPilot = new Map<string, string>();
  public enemies = new Map<string, InternalEnemy>();
  public projectiles = new Map<string, ProjectileState>();
  public asteroids = new Map<string, AsteroidState>();
  public powerUps = new Map<string, PowerUpState>();
  public pendingExplosions: ExplosionEvent[] = [];
  public killFeed: KillNotification[] = [];

  private entityCounter = 0;
  private storage: StorageManager;
  private statsRecordedForMatch = false;
  public lastActiveTime = Date.now();

  constructor(
    roomCode: string,
    roomName: string,
    mode: GameMode,
    isPublic: boolean,
    maxPlayers: number,
    storage: StorageManager
  ) {
    this.roomCode = roomCode;
    this.roomName = roomName;
    this.mode = mode;
    this.isPublic = isPublic;
    this.maxPlayers = Math.min(Math.max(2, maxPlayers), MAX_PLAYERS_PER_ROOM);
    this.storage = storage;
    this.initAsteroids();
  }

  private nextId(prefix: string): string {
    this.entityCounter += 1;
    return `${prefix}_${this.entityCounter}`;
  }

  private initAsteroids() {
    this.asteroids.clear();
    const count = 22;
    for (let i = 0; i < count; i++) {
      const radius = 32 + Math.random() * 48;
      const vertices: number[] = [];
      const points = 9;
      for (let p = 0; p < points; p++) {
        vertices.push(0.78 + Math.random() * 0.36);
      }
      const id = this.nextId('ast');
      this.asteroids.set(id, {
        id,
        x: 220 + Math.random() * (ARENA_WIDTH - 440),
        y: 220 + Math.random() * (ARENA_HEIGHT - 440),
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

  private findSafeSpawnPosition(): { x: number; y: number } {
    for (let attempt = 0; attempt < 20; attempt++) {
      const x = 450 + Math.random() * (ARENA_WIDTH - 900);
      const y = 450 + Math.random() * (ARENA_HEIGHT - 900);
      let safe = true;
      for (const ast of this.asteroids.values()) {
        if (Math.hypot(x - ast.x, y - ast.y) < ast.radius + 90) {
          safe = false;
          break;
        }
      }
      if (safe) return { x, y };
    }
    return { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 };
  }

  public addOrReconnectPlayer(
    socketId: string,
    pilotId: string,
    username: string,
    shipType: ShipType,
    color: string
  ): { ok: boolean; reason?: string; player?: InternalPlayer } {
    this.lastActiveTime = Date.now();
    const existing = this.players.get(pilotId);
    const profile = this.storage.getOrCreateProfile(pilotId, username, shipType, color);

    if (existing) {
      // Reconnect existing player in this room
      this.socketToPilot.delete(existing.socketId);
      existing.socketId = socketId;
      existing.connected = true;
      existing.username = profile.username;
      if (this.status === 'LOBBY') {
        existing.shipType = profile.selectedShip;
        existing.color = profile.selectedColor;
        this.applyShipStats(existing, true);
      }
      this.socketToPilot.set(socketId, pilotId);
      return { ok: true, player: existing };
    }

    const connectedCount = Array.from(this.players.values()).filter((p) => p.connected).length;
    if (connectedCount >= this.maxPlayers) {
      return { ok: false, reason: 'Room is at maximum capacity.' };
    }

    const spec = SHIP_SPECS[profile.selectedShip] || SHIP_SPECS.vanguard;
    const pos = this.findSafeSpawnPosition();
    const isFirst = this.players.size === 0 || !Array.from(this.players.values()).some((p) => p.isHost && p.connected);

    const player: InternalPlayer = {
      id: pilotId,
      pilotId,
      socketId,
      username: profile.username,
      shipType: spec.id,
      color: profile.selectedColor,
      isReady: isFirst,
      isHost: isFirst,
      connected: true,
      level: profile.level,
      x: pos.x,
      y: pos.y,
      vx: 0,
      vy: 0,
      angle: -Math.PI / 2,
      hp: spec.maxHp,
      maxHp: spec.maxHp,
      shield: spec.maxShield,
      maxShield: spec.maxShield,
      boostEnergy: 100,
      isBoosting: false,
      lives: this.mode === 'COOP_SURVIVAL' ? 3 : 99,
      maxLives: this.mode === 'COOP_SURVIVAL' ? 3 : 99,
      respawnTimer: 0,
      invulnerableTimer: 2.5,
      rapidFireTimer: 0,
      score: 0,
      kills: 0,
      deaths: 0,
      bossDamageDealt: 0,
      bossKillsThisMatch: 0,
      lastFireTime: 0,
      lastDamageTime: 0,
      input: {
        up: false,
        down: false,
        left: false,
        right: false,
        shoot: false,
        boost: false,
        aimAngle: -Math.PI / 2,
        seq: 0,
      },
    };

    this.players.set(pilotId, player);
    this.socketToPilot.set(socketId, pilotId);
    return { ok: true, player };
  }

  private applyShipStats(player: InternalPlayer, fullRestore: boolean) {
    const spec = SHIP_SPECS[player.shipType] || SHIP_SPECS.vanguard;
    player.maxHp = spec.maxHp;
    player.maxShield = spec.maxShield;
    if (fullRestore) {
      player.hp = spec.maxHp;
      player.shield = spec.maxShield;
      player.boostEnergy = 100;
    }
  }

  public removeSocket(socketId: string): boolean {
    const pilotId = this.socketToPilot.get(socketId);
    if (!pilotId) return false;
    this.socketToPilot.delete(socketId);
    const player = this.players.get(pilotId);
    if (!player) return false;

    if (this.status === 'LOBBY') {
      this.players.delete(pilotId);
    } else {
      player.connected = false;
      player.input.up = false;
      player.input.down = false;
      player.input.left = false;
      player.input.right = false;
      player.input.shoot = false;
      player.input.boost = false;
    }

    // Reassign host if needed
    const anyHost = Array.from(this.players.values()).some((p) => p.isHost && p.connected);
    if (!anyHost) {
      const nextHost = Array.from(this.players.values()).find((p) => p.connected);
      if (nextHost) {
        nextHost.isHost = true;
        nextHost.isReady = true;
      }
    }
    return true;
  }

  public leaveExplicitly(socketId: string) {
    const pilotId = this.socketToPilot.get(socketId);
    if (!pilotId) return;
    this.socketToPilot.delete(socketId);
    this.players.delete(pilotId);
    const anyHost = Array.from(this.players.values()).some((p) => p.isHost && p.connected);
    if (!anyHost) {
      const nextHost = Array.from(this.players.values()).find((p) => p.connected);
      if (nextHost) {
        nextHost.isHost = true;
        nextHost.isReady = true;
      }
    }
  }

  public updatePlayerCustomization(
    socketId: string,
    shipType?: ShipType,
    color?: string,
    username?: string,
    isReady?: boolean
  ) {
    const pilotId = this.socketToPilot.get(socketId);
    if (!pilotId) return;
    const player = this.players.get(pilotId);
    if (!player) return;

    if (shipType && SHIP_SPECS[shipType]) {
      player.shipType = shipType;
      this.applyShipStats(player, this.status === 'LOBBY');
    }
    if (color) player.color = color;
    if (username && username.trim()) player.username = username.trim().slice(0, 18);
    if (typeof isReady === 'boolean') player.isReady = isReady;

    this.storage.getOrCreateProfile(pilotId, player.username, player.shipType, player.color);
  }

  public handlePlayerInput(socketId: string, input: PlayerInput) {
    const pilotId = this.socketToPilot.get(socketId);
    if (!pilotId) return;
    const player = this.players.get(pilotId);
    if (!player || !player.connected) return;

    player.input = {
      up: Boolean(input.up),
      down: Boolean(input.down),
      left: Boolean(input.left),
      right: Boolean(input.right),
      shoot: Boolean(input.shoot),
      boost: Boolean(input.boost),
      aimAngle: Number.isFinite(input.aimAngle) ? input.aimAngle : player.angle,
      seq: Number(input.seq) || 0,
    };
  }

  public startMatch(requestSocketId?: string) {
    if (requestSocketId) {
      const pilotId = this.socketToPilot.get(requestSocketId);
      const requester = pilotId ? this.players.get(pilotId) : undefined;
      if (requester && !requester.isHost && this.status === 'LOBBY') {
        return;
      }
    }

    // Remove disconnected players from previous match
    for (const [id, p] of this.players.entries()) {
      if (!p.connected) this.players.delete(id);
    }

    this.status = 'PLAYING';
    this.statsRecordedForMatch = false;
    this.wave = 1;
    this.teamScore = 0;
    this.winnerName = undefined;
    this.enemies.clear();
    this.projectiles.clear();
    this.powerUps.clear();
    this.killFeed = [];
    this.initAsteroids();

    if (this.mode === 'COOP_SURVIVAL') {
      this.matchTimer = 0;
    } else {
      this.matchTimer = 240; // 4 minutes intense FFA match
    }

    for (const player of this.players.values()) {
      const pos = this.findSafeSpawnPosition();
      this.applyShipStats(player, true);
      player.x = pos.x;
      player.y = pos.y;
      player.vx = 0;
      player.vy = 0;
      player.score = 0;
      player.kills = 0;
      player.deaths = 0;
      player.bossDamageDealt = 0;
      player.bossKillsThisMatch = 0;
      player.lives = this.mode === 'COOP_SURVIVAL' ? 3 : 99;
      player.maxLives = this.mode === 'COOP_SURVIVAL' ? 3 : 99;
      player.respawnTimer = 0;
      player.invulnerableTimer = 3.0;
      player.rapidFireTimer = 0;
    }

    if (this.mode === 'COOP_SURVIVAL') {
      this.prepareWave(1);
    } else {
      this.waveTitle = 'FREE-FOR-ALL ARENA COMBAT';
      this.waveBannerTimer = 3.5;
      // Spawn neutral bounty patrol drones in FFA to keep combat dynamic
      this.enemiesToSpawnQueue = ['scout', 'scout', 'ranged', 'heavy'];
    }
  }

  private prepareWave(waveNum: number) {
    this.wave = waveNum;
    this.waveBannerTimer = 3.5;
    this.enemiesToSpawnQueue = [];
    const activePlayerCount = Math.max(
      1,
      Array.from(this.players.values()).filter((p) => p.connected).length
    );
    const scale = 1 + (activePlayerCount - 1) * 0.35;

    if (waveNum % 5 === 0 || waveNum === 3) {
      // Boss or Mini-Boss Wave
      this.waveTitle =
        waveNum === 3
          ? `WAVE ${waveNum} — VANGUARD COMMANDER`
          : waveNum === 5
            ? `WAVE ${waveNum} — DREADNOUGHT OVERLORD`
            : `WAVE ${waveNum} — VOID LEVIATHAN`;
      this.enemiesToSpawnQueue.push('boss');
      const escortCount = Math.round((3 + waveNum) * scale);
      for (let i = 0; i < escortCount; i++) {
        this.enemiesToSpawnQueue.push(i % 2 === 0 ? 'scout' : 'ranged');
      }
    } else {
      const titles = [
        'RECON VANGUARD',
        'SWARM INTERCEPTION',
        'SECTOR BLOCKADE',
        'HEAVY ARMOR DIVISION',
        'VOLATILE STRIKE FORCE',
        'CRIMSON ARMADA',
        'OMEGA ONSLAUGHT',
      ];
      this.waveTitle = `WAVE ${waveNum} — ${titles[(waveNum - 1) % titles.length]}`;
      const totalEnemies = Math.round((6 + waveNum * 3) * scale);

      for (let i = 0; i < totalEnemies; i++) {
        const roll = Math.random();
        if (waveNum === 1) {
          this.enemiesToSpawnQueue.push(roll < 0.6 ? 'scout' : 'chaser');
        } else if (waveNum === 2) {
          if (roll < 0.35) this.enemiesToSpawnQueue.push('scout');
          else if (roll < 0.7) this.enemiesToSpawnQueue.push('chaser');
          else this.enemiesToSpawnQueue.push('ranged');
        } else {
          if (roll < 0.22) this.enemiesToSpawnQueue.push('scout');
          else if (roll < 0.45) this.enemiesToSpawnQueue.push('chaser');
          else if (roll < 0.68) this.enemiesToSpawnQueue.push('ranged');
          else if (roll < 0.85) this.enemiesToSpawnQueue.push('heavy');
          else this.enemiesToSpawnQueue.push('exploder');
        }
      }
    }
    this.spawnIntervalTimer = 0.5;
  }

  private spawnEnemy(type: EnemyType) {
    // Spawn near edges of the arena or outside immediate player clusters
    const edge = Math.floor(Math.random() * 4);
    const margin = 120;
    let x = margin;
    let y = margin;
    if (edge === 0) {
      x = margin + Math.random() * (ARENA_WIDTH - margin * 2);
      y = margin;
    } else if (edge === 1) {
      x = ARENA_WIDTH - margin;
      y = margin + Math.random() * (ARENA_HEIGHT - margin * 2);
    } else if (edge === 2) {
      x = margin + Math.random() * (ARENA_WIDTH - margin * 2);
      y = ARENA_HEIGHT - margin;
    } else {
      x = margin;
      y = margin + Math.random() * (ARENA_HEIGHT - margin * 2);
    }

    const waveMultiplier = 1 + (this.wave - 1) * 0.14;
    const id = this.nextId('enm');

    if (type === 'boss') {
      const bossHp = Math.round((this.wave === 3 ? 1100 : 2200 + this.wave * 250) * Math.max(1, this.players.size * 0.75));
      this.enemies.set(id, {
        id,
        type: 'boss',
        name: this.wave === 3 ? 'AEGIS CRUISER' : this.wave === 5 ? 'OVERLORD MK-IX' : 'VOID LEVIATHAN',
        x: ARENA_WIDTH / 2,
        y: 260,
        vx: 0,
        vy: 0,
        angle: Math.PI / 2,
        hp: bossHp,
        maxHp: bossHp,
        radius: 58,
        color: '#F43F5E',
        scoreValue: 1200,
        bossPhase: 1,
        fireCooldown: 1.2,
        secondaryCooldown: 4.0,
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
    const scaledHp = Math.round(cfg.hp * waveMultiplier);

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
      fireCooldown: 1 + Math.random() * 1.2,
      secondaryCooldown: 0,
      aiTimer: Math.random() * 5,
      strafeDir: Math.random() < 0.5 ? 1 : -1,
    });
  }

  public update(dt: number) {
    if (this.status !== 'PLAYING') return;

    this.lastActiveTime = Date.now();

    if (this.waveBannerTimer > 0) {
      this.waveBannerTimer = Math.max(0, this.waveBannerTimer - dt);
    }

    // Match timer update
    if (this.mode === 'COOP_SURVIVAL') {
      this.matchTimer += dt;
    } else {
      this.matchTimer = Math.max(0, this.matchTimer - dt);
      if (this.matchTimer <= 0) {
        this.concludeFFAMatch();
        return;
      }
    }

    // Spawn queued enemies gradually
    if (this.enemiesToSpawnQueue.length > 0) {
      this.spawnIntervalTimer -= dt;
      if (this.spawnIntervalTimer <= 0 && this.enemies.size < 26) {
        const nextType = this.enemiesToSpawnQueue.shift()!;
        this.spawnEnemy(nextType);
        this.spawnIntervalTimer = nextType === 'boss' ? 2.0 : 0.75;
      }
    } else if (this.mode === 'FREE_FOR_ALL' && this.enemies.size < 4) {
      // Keep a few neutral sector drones roaming in FFA
      const pool: EnemyType[] = ['scout', 'chaser', 'ranged', 'exploder'];
      this.spawnEnemy(pool[Math.floor(Math.random() * pool.length)]);
    }

    const nowMs = Date.now();

    // Update Players
    for (const player of this.players.values()) {
      if (!player.connected) continue;

      if (player.respawnTimer > 0) {
        player.respawnTimer = Math.max(0, player.respawnTimer - dt);
        if (player.respawnTimer === 0 && player.lives > 0) {
          const spawnPos = this.findSafeSpawnPosition();
          this.applyShipStats(player, true);
          player.x = spawnPos.x;
          player.y = spawnPos.y;
          player.vx = 0;
          player.vy = 0;
          player.invulnerableTimer = 2.8;
        }
        continue;
      }

      if (player.invulnerableTimer > 0) {
        player.invulnerableTimer = Math.max(0, player.invulnerableTimer - dt);
      }
      if (player.rapidFireTimer > 0) {
        player.rapidFireTimer = Math.max(0, player.rapidFireTimer - dt);
      }

      const spec = SHIP_SPECS[player.shipType] || SHIP_SPECS.vanguard;

      // Shield regeneration after 3.5s without damage
      if (nowMs - player.lastDamageTime > 3500 && player.shield < player.maxShield) {
        player.shield = Math.min(player.maxShield, player.shield + spec.shieldRegenRate * dt);
      }

      // Boost handling
      const wantsBoost =
        player.input.boost &&
        (player.input.up || player.input.down || player.input.left || player.input.right);
      if (wantsBoost && player.boostEnergy > 5) {
        player.isBoosting = true;
        player.boostEnergy = Math.max(0, player.boostEnergy - spec.boostDrainRate * dt);
      } else {
        player.isBoosting = false;
        player.boostEnergy = Math.min(100, player.boostEnergy + spec.boostRegenRate * dt);
      }

      // Movement physics with smooth acceleration & damping
      let moveX = (player.input.right ? 1 : 0) - (player.input.left ? 1 : 0);
      let moveY = (player.input.down ? 1 : 0) - (player.input.up ? 1 : 0);
      const len = Math.hypot(moveX, moveY);
      if (len > 0) {
        moveX /= len;
        moveY /= len;
      }

      const targetSpeed = spec.speed * (player.isBoosting ? spec.boostMultiplier : 1);
      const accel = 9.5;
      player.vx += (moveX * targetSpeed - player.vx) * Math.min(1, accel * dt);
      player.vy += (moveY * targetSpeed - player.vy) * Math.min(1, accel * dt);

      player.x += player.vx * dt;
      player.y += player.vy * dt;

      // Clamp to Arena boundaries
      const pad = spec.radius + 10;
      if (player.x < pad) {
        player.x = pad;
        player.vx = 0;
      } else if (player.x > ARENA_WIDTH - pad) {
        player.x = ARENA_WIDTH - pad;
        player.vx = 0;
      }
      if (player.y < pad) {
        player.y = pad;
        player.vy = 0;
      } else if (player.y > ARENA_HEIGHT - pad) {
        player.y = ARENA_HEIGHT - pad;
        player.vy = 0;
      }

      player.angle = player.input.aimAngle;

      // Weapon firing
      const effectiveCooldown =
        player.rapidFireTimer > 0 ? spec.fireCooldownMs * 0.58 : spec.fireCooldownMs;
      if (player.input.shoot && nowMs - player.lastFireTime >= effectiveCooldown) {
        player.lastFireTime = nowMs;
        this.firePlayerWeapon(player, spec);
      }
    }

    // Update Asteroids
    for (const ast of this.asteroids.values()) {
      ast.x += ast.vx * dt;
      ast.y += ast.vy * dt;
      ast.rotation += ast.rotationSpeed * dt;

      if (ast.x < ast.radius + 40 || ast.x > ARENA_WIDTH - ast.radius - 40) ast.vx *= -1;
      if (ast.y < ast.radius + 40 || ast.y > ARENA_HEIGHT - ast.radius - 40) ast.vy *= -1;

      // Player-Asteroid collision pushback
      for (const player of this.players.values()) {
        if (!player.connected || player.respawnTimer > 0) continue;
        const spec = SHIP_SPECS[player.shipType];
        const dx = player.x - ast.x;
        const dy = player.y - ast.y;
        const dist = Math.hypot(dx, dy);
        const minDist = spec.radius + ast.radius;
        if (dist < minDist && dist > 0.001) {
          const overlap = minDist - dist;
          const nx = dx / dist;
          const ny = dy / dist;
          player.x += nx * overlap;
          player.y += ny * overlap;
          player.vx = nx * 140;
          player.vy = ny * 140;
        }
      }
    }

    // Update Enemies (Server-Authoritative AI)
    this.updateEnemies(dt);

    // Update Projectiles & Collisions
    this.updateProjectiles(dt);

    // Update PowerUps
    this.updatePowerUps(dt);

    // Check Wave & Match Progression
    this.checkMatchConditions();
  }

  private firePlayerWeapon(player: InternalPlayer, spec: typeof SHIP_SPECS['vanguard']) {
    const cos = Math.cos(player.angle);
    const sin = Math.sin(player.angle);
    const perpX = -sin;
    const perpY = cos;

    const spawnBolt = (
      offsetForward: number,
      offsetSide: number,
      angleOffset: number,
      damage: number,
      radius: number,
      ttl: number,
      piercing = false
    ) => {
      const id = this.nextId('prj');
      const boltAngle = player.angle + angleOffset;
      this.projectiles.set(id, {
        id,
        ownerId: player.id,
        isEnemy: false,
        x: player.x + cos * offsetForward + perpX * offsetSide,
        y: player.y + sin * offsetForward + perpY * offsetSide,
        vx: Math.cos(boltAngle) * spec.projectileSpeed + player.vx * 0.15,
        vy: Math.sin(boltAngle) * spec.projectileSpeed + player.vy * 0.15,
        angle: boltAngle,
        damage,
        color: player.color,
        radius,
        ttl,
        piercing,
      });
    };

    if (spec.projectilePattern === 'twin') {
      spawnBolt(20, -9, 0, spec.damage / 2, 4, 1.35);
      spawnBolt(20, 9, 0, spec.damage / 2, 4, 1.35);
    } else if (spec.projectilePattern === 'rapid') {
      const spread = (Math.random() - 0.5) * 0.06;
      spawnBolt(20, 0, spread, spec.damage, 3.5, 1.15);
    } else if (spec.projectilePattern === 'spread') {
      spawnBolt(24, -6, -0.14, spec.damage, 5, 1.2);
      spawnBolt(26, 0, 0, spec.damage, 5.5, 1.2);
      spawnBolt(24, 6, 0.14, spec.damage, 5, 1.2);
    } else if (spec.projectilePattern === 'lance') {
      spawnBolt(24, 0, 0, spec.damage, 5.5, 1.5, true);
    }
  }

  private findNearestAlivePlayer(x: number, y: number): InternalPlayer | undefined {
    let best: InternalPlayer | undefined;
    let bestDist = Infinity;
    for (const p of this.players.values()) {
      if (!p.connected || p.respawnTimer > 0) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }

  private updateEnemies(dt: number) {
    for (const [id, enemy] of this.enemies.entries()) {
      enemy.aiTimer += dt;
      enemy.fireCooldown -= dt;
      enemy.secondaryCooldown -= dt;

      const target = this.findNearestAlivePlayer(enemy.x, enemy.y);
      if (!target) continue;

      const dx = target.x - enemy.x;
      const dy = target.y - enemy.y;
      const dist = Math.hypot(dx, dy) || 1;
      const dirX = dx / dist;
      const dirY = dy / dist;
      enemy.angle = Math.atan2(dy, dx);
      enemy.targetPlayerId = target.id;

      if (enemy.type === 'scout') {
        // Fast weaving flanker
        const speed = 290;
        const weave = Math.sin(enemy.aiTimer * 4.5) * 0.65;
        const moveAngle = enemy.angle + weave;
        enemy.vx = Math.cos(moveAngle) * speed;
        enemy.vy = Math.sin(moveAngle) * speed;
        if (enemy.fireCooldown <= 0 && dist < 680) {
          enemy.fireCooldown = 1.6;
          this.spawnEnemyProjectile(enemy, enemy.angle, 560, 12, '#38BDF8', 4);
        }
      } else if (enemy.type === 'chaser') {
        // Direct aggressive hunter
        const speed = 255;
        enemy.vx = dirX * speed;
        enemy.vy = dirY * speed;
        if (enemy.fireCooldown <= 0 && dist < 520) {
          enemy.fireCooldown = 1.45;
          this.spawnEnemyProjectile(enemy, enemy.angle, 600, 14, '#F59E0B', 4.5);
        }
      } else if (enemy.type === 'ranged') {
        // Standoff sniper that maintains 420-580px range and strafes
        const speed = 210;
        const perpX = -dirY * enemy.strafeDir;
        const perpY = dirX * enemy.strafeDir;
        if (dist > 580) {
          enemy.vx = dirX * speed + perpX * 80;
          enemy.vy = dirY * speed + perpY * 80;
        } else if (dist < 380) {
          enemy.vx = -dirX * speed + perpX * 110;
          enemy.vy = -dirY * speed + perpY * 110;
        } else {
          enemy.vx = perpX * speed;
          enemy.vy = perpY * speed;
        }
        if (enemy.fireCooldown <= 0 && dist < 850) {
          enemy.fireCooldown = 1.75;
          this.spawnEnemyProjectile(enemy, enemy.angle, 740, 20, '#A855F7', 5);
        }
      } else if (enemy.type === 'heavy') {
        // Slow armored juggernaut with dual plasma cannons
        const speed = 135;
        enemy.vx = dirX * speed;
        enemy.vy = dirY * speed;
        if (enemy.fireCooldown <= 0 && dist < 750) {
          enemy.fireCooldown = 2.1;
          this.spawnEnemyProjectile(enemy, enemy.angle - 0.1, 520, 22, '#EF4444', 6);
          this.spawnEnemyProjectile(enemy, enemy.angle + 0.1, 520, 22, '#EF4444', 6);
        }
      } else if (enemy.type === 'exploder') {
        // High-speed kamikaze drone
        const speed = 345;
        enemy.vx = dirX * speed;
        enemy.vy = dirY * speed;
        if (dist <= enemy.radius + 36) {
          // Detonate!
          this.triggerExplosion(enemy.x, enemy.y, '#FB7185', 95, 'large');
          this.damagePlayer(target, 42, enemy.name, 'enemy');
          this.enemies.delete(id);
          continue;
        }
      } else if (enemy.type === 'boss') {
        // Multi-Phase Boss AI
        const hpRatio = enemy.hp / enemy.maxHp;
        enemy.bossPhase = hpRatio > 0.65 ? 1 : hpRatio > 0.3 ? 2 : 3;

        const speed = enemy.bossPhase === 1 ? 115 : enemy.bossPhase === 2 ? 150 : 195;
        const perpX = -dirY * enemy.strafeDir;
        const perpY = dirX * enemy.strafeDir;

        if (dist > 520) {
          enemy.vx = dirX * speed + perpX * 80;
          enemy.vy = dirY * speed + perpY * 80;
        } else {
          enemy.vx = perpX * speed;
          enemy.vy = perpY * speed;
        }

        // Primary Boss Attack
        if (enemy.fireCooldown <= 0) {
          if (enemy.bossPhase === 1) {
            enemy.fireCooldown = 1.3;
            for (let i = -2; i <= 2; i++) {
              this.spawnEnemyProjectile(enemy, enemy.angle + i * 0.16, 620, 20, '#F43F5E', 6.5);
            }
          } else if (enemy.bossPhase === 2) {
            enemy.fireCooldown = 0.95;
            for (let i = -3; i <= 3; i++) {
              this.spawnEnemyProjectile(enemy, enemy.angle + i * 0.14, 680, 22, '#EC4899', 6.5);
            }
          } else {
            enemy.fireCooldown = 0.7;
            const ringCount = 12;
            for (let i = 0; i < ringCount; i++) {
              const a = enemy.aiTimer * 1.5 + (i * Math.PI * 2) / ringCount;
              this.spawnEnemyProjectile(enemy, a, 580, 24, '#F43F5E', 7);
            }
          }
        }

        // Secondary Boss Ability (Spawns reinforcement drones in Phase 2 & 3)
        if (enemy.secondaryCooldown <= 0 && enemy.bossPhase >= 2) {
          enemy.secondaryCooldown = 7.5;
          if (this.enemies.size < 18) {
            this.spawnEnemy('scout');
            this.spawnEnemy('exploder');
          }
        }
      }

      enemy.x += enemy.vx * dt;
      enemy.y += enemy.vy * dt;

      // Keep inside arena
      const pad = enemy.radius + 20;
      enemy.x = Math.max(pad, Math.min(ARENA_WIDTH - pad, enemy.x));
      enemy.y = Math.max(pad, Math.min(ARENA_HEIGHT - pad, enemy.y));

      // Body collision with players
      for (const player of this.players.values()) {
        if (!player.connected || player.respawnTimer > 0) continue;
        const pRadius = SHIP_SPECS[player.shipType].radius;
        const cDist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
        if (cDist < pRadius + enemy.radius) {
          const pushX = (player.x - enemy.x) / (cDist || 1);
          const pushY = (player.y - enemy.y) / (cDist || 1);
          player.x += pushX * 24;
          player.y += pushY * 24;
          player.vx = pushX * 260;
          player.vy = pushY * 260;
          this.damagePlayer(player, enemy.type === 'boss' ? 28 : 16, enemy.name, enemy.type === 'boss' ? 'boss' : 'enemy');
        }
      }
    }
  }

  private spawnEnemyProjectile(
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

  private updateProjectiles(dt: number) {
    for (const [id, proj] of this.projectiles.entries()) {
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;
      proj.ttl -= dt;

      if (
        proj.ttl <= 0 ||
        proj.x < 0 ||
        proj.x > ARENA_WIDTH ||
        proj.y < 0 ||
        proj.y > ARENA_HEIGHT
      ) {
        this.projectiles.delete(id);
        continue;
      }

      // Check Asteroid collision
      let hitObstacle = false;
      for (const [astId, ast] of this.asteroids.entries()) {
        if (Math.hypot(proj.x - ast.x, proj.y - ast.y) <= ast.radius + proj.radius) {
          this.triggerExplosion(proj.x, proj.y, proj.color, 18, 'small');
          ast.hp -= proj.damage;
          if (ast.hp <= 0) {
            this.triggerExplosion(ast.x, ast.y, '#94A3B8', ast.radius, 'medium');
            this.asteroids.delete(astId);
            if (Math.random() < 0.35) {
              this.spawnPowerUp(ast.x, ast.y);
            }
          }
          hitObstacle = true;
          break;
        }
      }
      if (hitObstacle) {
        this.projectiles.delete(id);
        continue;
      }

      if (proj.isEnemy) {
        // Check collision against alive players
        for (const player of this.players.values()) {
          if (!player.connected || player.respawnTimer > 0) continue;
          const pRadius = SHIP_SPECS[player.shipType].radius;
          if (Math.hypot(proj.x - player.x, proj.y - player.y) <= pRadius + proj.radius) {
            const ownerEnemy = this.enemies.get(proj.ownerId);
            this.triggerExplosion(proj.x, proj.y, proj.color, 22, 'small');
            this.damagePlayer(
              player,
              proj.damage,
              ownerEnemy ? ownerEnemy.name : 'Hostile Fire',
              ownerEnemy?.type === 'boss' ? 'boss' : 'enemy'
            );
            this.projectiles.delete(id);
            break;
          }
        }
      } else {
        // Player projectile: check collision against Enemies
        const shooter = this.players.get(proj.ownerId);
        let consumed = false;

        for (const [enemyId, enemy] of this.enemies.entries()) {
          if (Math.hypot(proj.x - enemy.x, proj.y - enemy.y) <= enemy.radius + proj.radius) {
            enemy.hp -= proj.damage;
            this.triggerExplosion(proj.x, proj.y, proj.color, 20, 'small');
            if (shooter && enemy.type === 'boss') {
              shooter.bossDamageDealt += proj.damage;
            }

            if (enemy.hp <= 0) {
              this.enemies.delete(enemyId);
              this.triggerExplosion(
                enemy.x,
                enemy.y,
                enemy.color,
                enemy.type === 'boss' ? 140 : enemy.radius * 2.2,
                enemy.type === 'boss' ? 'boss' : 'medium'
              );

              if (shooter) {
                shooter.score += enemy.scoreValue;
                shooter.kills += 1;
                if (enemy.type === 'boss') {
                  shooter.bossKillsThisMatch += 1;
                }
                this.teamScore += enemy.scoreValue;
                this.addKillFeed(
                  shooter.username,
                  shooter.color,
                  enemy.name,
                  enemy.type === 'boss' ? 'boss' : 'enemy',
                  SHIP_SPECS[shooter.shipType].name
                );
              }

              // Drop powerup chance
              if (enemy.type === 'boss' || Math.random() < 0.25) {
                this.spawnPowerUp(enemy.x, enemy.y);
              }
            }

            if (!proj.piercing) {
              consumed = true;
              break;
            }
          }
        }

        if (consumed) {
          this.projectiles.delete(id);
          continue;
        }

        // In FREE_FOR_ALL mode, check PvP collision against other players!
        if (this.mode === 'FREE_FOR_ALL') {
          for (const targetPlayer of this.players.values()) {
            if (
              !targetPlayer.connected ||
              targetPlayer.id === proj.ownerId ||
              targetPlayer.respawnTimer > 0
            ) {
              continue;
            }
            const pRadius = SHIP_SPECS[targetPlayer.shipType].radius;
            if (Math.hypot(proj.x - targetPlayer.x, proj.y - targetPlayer.y) <= pRadius + proj.radius) {
              this.triggerExplosion(proj.x, proj.y, proj.color, 24, 'small');
              this.damagePlayer(
                targetPlayer,
                proj.damage,
                shooter ? shooter.username : 'Rival Pilot',
                'player',
                shooter
              );
              this.projectiles.delete(id);
              break;
            }
          }
        }
      }
    }
  }

  private damagePlayer(
    victim: InternalPlayer,
    amount: number,
    attackerName: string,
    attackerType: 'player' | 'enemy' | 'boss',
    attackerPlayer?: InternalPlayer
  ) {
    if (victim.invulnerableTimer > 0 || victim.respawnTimer > 0) return;

    victim.lastDamageTime = Date.now();

    let remaining = amount;
    if (victim.shield > 0) {
      const absorbed = Math.min(victim.shield, remaining);
      victim.shield -= absorbed;
      remaining -= absorbed;
    }

    if (remaining > 0) {
      victim.hp = Math.max(0, victim.hp - remaining);
    }

    if (victim.hp <= 0) {
      victim.deaths += 1;
      if (this.mode === 'COOP_SURVIVAL') {
        victim.lives = Math.max(0, victim.lives - 1);
      }
      victim.respawnTimer = victim.lives > 0 ? 3.5 : 999;

      this.triggerExplosion(victim.x, victim.y, victim.color, 75, 'large');

      if (attackerPlayer && attackerPlayer.id !== victim.id) {
        attackerPlayer.kills += 1;
        attackerPlayer.score += 300;
        this.addKillFeed(
          attackerPlayer.username,
          attackerPlayer.color,
          victim.username,
          'player',
          SHIP_SPECS[attackerPlayer.shipType].name
        );
      } else {
        this.addKillFeed(attackerName, '#F43F5E', victim.username, 'player', 'Plasma Impact');
      }
    }
  }

  private spawnPowerUp(x: number, y: number) {
    const types: PowerUpType[] = ['hull_repair', 'shield_boost', 'rapid_fire', 'boost_cell'];
    const type = types[Math.floor(Math.random() * types.length)];
    const id = this.nextId('pwr');
    this.powerUps.set(id, {
      id,
      type,
      x,
      y,
      ttl: 18,
    });
  }

  private updatePowerUps(dt: number) {
    for (const [id, pwr] of this.powerUps.entries()) {
      pwr.ttl -= dt;
      if (pwr.ttl <= 0) {
        this.powerUps.delete(id);
        continue;
      }

      for (const player of this.players.values()) {
        if (!player.connected || player.respawnTimer > 0) continue;
        if (Math.hypot(player.x - pwr.x, player.y - pwr.y) <= 38) {
          if (pwr.type === 'hull_repair') {
            player.hp = Math.min(player.maxHp, player.hp + 55);
          } else if (pwr.type === 'shield_boost') {
            player.shield = player.maxShield;
          } else if (pwr.type === 'rapid_fire') {
            player.rapidFireTimer = 8.0;
          } else if (pwr.type === 'boost_cell') {
            player.boostEnergy = 100;
          }
          player.score += 50;
          this.teamScore += 50;
          this.powerUps.delete(id);
          break;
        }
      }
    }
  }

  private checkMatchConditions() {
    const connectedPlayers = Array.from(this.players.values()).filter((p) => p.connected);
    if (connectedPlayers.length === 0) return;

    if (this.mode === 'COOP_SURVIVAL') {
      // Check Squad Defeat (all connected players out of lives)
      const anyAliveOrRespawning = connectedPlayers.some((p) => p.lives > 0);
      if (!anyAliveOrRespawning) {
        this.status = 'DEFEAT';
        this.recordAllPlayerStats(false);
        return;
      }

      // Check Wave Clear
      if (this.enemies.size === 0 && this.enemiesToSpawnQueue.length === 0) {
        if (this.wave >= this.maxWaves) {
          this.status = 'VICTORY';
          const mvp = [...connectedPlayers].sort((a, b) => b.score - a.score)[0];
          this.winnerName = mvp ? mvp.username : 'SQUAD VICTORY';
          this.recordAllPlayerStats(true);
        } else {
          // Restore 25% hull between waves for surviving players
          for (const p of connectedPlayers) {
            if (p.respawnTimer === 0) {
              p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.25));
            }
          }
          this.prepareWave(this.wave + 1);
        }
      }
    } else {
      // FREE_FOR_ALL victory check
      const leader = [...connectedPlayers].sort((a, b) => b.score - a.score)[0];
      if (leader && leader.score >= this.targetScoreFFA) {
        this.concludeFFAMatch();
      }
    }
  }

  private concludeFFAMatch() {
    this.status = 'VICTORY';
    const connectedPlayers = Array.from(this.players.values()).filter((p) => p.connected);
    const sorted = [...connectedPlayers].sort((a, b) => b.score - a.score);
    const winner = sorted[0];
    this.winnerName = winner ? winner.username : 'ARENA CHAMPION';
    this.recordAllPlayerStats(true, winner?.id);
  }

  private recordAllPlayerStats(coopWon: boolean, ffaWinnerId?: string) {
    if (this.statsRecordedForMatch) return;
    this.statsRecordedForMatch = true;

    for (const p of this.players.values()) {
      const won =
        this.mode === 'COOP_SURVIVAL' ? coopWon : p.id === ffaWinnerId;
      const updated = this.storage.recordMatchResult(
        p.pilotId,
        p.username,
        p.shipType,
        p.color,
        this.mode,
        p.score,
        p.kills,
        this.wave,
        p.bossKillsThisMatch,
        won
      );
      p.level = updated.level;
    }
  }

  private triggerExplosion(
    x: number,
    y: number,
    color: string,
    radius: number,
    intensity: 'small' | 'medium' | 'large' | 'boss'
  ) {
    this.pendingExplosions.push({
      id: this.nextId('exp'),
      x,
      y,
      color,
      radius,
      intensity,
    });
  }

  private addKillFeed(
    killerName: string,
    killerColor: string,
    victimName: string,
    victimType: 'player' | 'enemy' | 'boss',
    weaponOrRole: string
  ) {
    this.killFeed.unshift({
      id: this.nextId('kf'),
      killerName,
      killerColor,
      victimName,
      victimType,
      weaponOrRole,
      timestamp: Date.now(),
    });
    if (this.killFeed.length > 6) {
      this.killFeed.length = 6;
    }
  }

  public getSummary(): RoomSummary {
    const connectedPlayers = Array.from(this.players.values()).filter((p) => p.connected);
    const host = connectedPlayers.find((p) => p.isHost) || connectedPlayers[0];
    return {
      roomCode: this.roomCode,
      roomName: this.roomName,
      mode: this.mode,
      status: this.status,
      isPublic: this.isPublic,
      playerCount: connectedPlayers.length,
      maxPlayers: this.maxPlayers,
      wave: this.wave,
      hostName: host ? host.username : 'Unknown',
    };
  }

  public consumeSnapshot(): GameSnapshot {
    const explosions = [...this.pendingExplosions];
    this.pendingExplosions = [];

    return {
      roomCode: this.roomCode,
      roomName: this.roomName,
      mode: this.mode,
      status: this.status,
      isPublic: this.isPublic,
      maxPlayers: this.maxPlayers,
      wave: this.wave,
      maxWaves: this.maxWaves,
      waveBannerTimer: Number(this.waveBannerTimer.toFixed(2)),
      waveTitle: this.waveTitle,
      enemiesRemainingInWave: this.enemies.size + this.enemiesToSpawnQueue.length,
      matchTimer: Math.round(this.matchTimer),
      teamScore: this.teamScore,
      targetScoreFFA: this.targetScoreFFA,
      winnerName: this.winnerName,
      players: Array.from(this.players.values()).map((p) => ({
        id: p.id,
        pilotId: p.pilotId,
        username: p.username,
        shipType: p.shipType,
        color: p.color,
        isReady: p.isReady,
        isHost: p.isHost,
        connected: p.connected,
        level: p.level,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        vx: Math.round(p.vx),
        vy: Math.round(p.vy),
        angle: Number(p.angle.toFixed(3)),
        hp: Math.round(p.hp),
        maxHp: p.maxHp,
        shield: Math.round(p.shield),
        maxShield: p.maxShield,
        boostEnergy: Math.round(p.boostEnergy),
        isBoosting: p.isBoosting,
        lives: p.lives,
        maxLives: p.maxLives,
        respawnTimer: Number(p.respawnTimer.toFixed(1)),
        invulnerableTimer: Number(p.invulnerableTimer.toFixed(1)),
        rapidFireTimer: Number(p.rapidFireTimer.toFixed(1)),
        score: p.score,
        kills: p.kills,
        deaths: p.deaths,
        bossDamageDealt: Math.round(p.bossDamageDealt),
      })),
      enemies: Array.from(this.enemies.values()).map((e) => ({
        id: e.id,
        type: e.type,
        name: e.name,
        x: Math.round(e.x * 10) / 10,
        y: Math.round(e.y * 10) / 10,
        vx: Math.round(e.vx),
        vy: Math.round(e.vy),
        angle: Number(e.angle.toFixed(3)),
        hp: Math.round(e.hp),
        maxHp: e.maxHp,
        radius: e.radius,
        color: e.color,
        scoreValue: e.scoreValue,
        bossPhase: e.bossPhase,
        targetPlayerId: e.targetPlayerId,
      })),
      projectiles: Array.from(this.projectiles.values()).map((prj) => ({
        ...prj,
        x: Math.round(prj.x),
        y: Math.round(prj.y),
      })),
      asteroids: Array.from(this.asteroids.values()).map((ast) => ({
        ...ast,
        x: Math.round(ast.x),
        y: Math.round(ast.y),
        rotation: Number(ast.rotation.toFixed(2)),
      })),
      powerUps: Array.from(this.powerUps.values()),
      explosions,
      killFeed: this.killFeed,
      serverTime: Date.now(),
    };
  }
}
