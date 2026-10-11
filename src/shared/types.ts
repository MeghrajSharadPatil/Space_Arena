export type ShipType = 'vanguard' | 'phantom' | 'titan' | 'nova';

export type GameMode = 'COOP_SURVIVAL' | 'FREE_FOR_ALL' | 'DUEL_1V1' | 'TEAM_VS_TEAM';

export type TeamId = 'ALPHA' | 'OMEGA';

export type RoomStatus = 'LOBBY' | 'PLAYING' | 'VICTORY' | 'DEFEAT';

export type EnemyType = 'scout' | 'chaser' | 'heavy' | 'ranged' | 'exploder' | 'boss';

export type PowerUpType = 'hull_repair' | 'shield_boost' | 'rapid_fire' | 'boost_cell';

export interface ShipSpec {
  id: ShipType;
  name: string;
  role: string;
  description: string;
  maxHp: number;
  maxShield: number;
  shieldRegenRate: number; // per sec
  speed: number; // px per sec
  boostMultiplier: number;
  boostDrainRate: number; // per sec
  boostRegenRate: number; // per sec
  fireCooldownMs: number;
  damage: number;
  projectileSpeed: number;
  projectilePattern: 'twin' | 'rapid' | 'spread' | 'lance';
  radius: number;
  unlockLevel: number;
  defaultColor: string;
}

export const SHIP_SPECS: Record<ShipType, ShipSpec> = {
  vanguard: {
    id: 'vanguard',
    name: 'Vanguard MK-IV',
    role: 'Balanced Interceptor',
    description: 'Versatile frontline strike craft equipped with synchronized twin pulse cannons and balanced deflection shielding.',
    maxHp: 130,
    maxShield: 90,
    shieldRegenRate: 12,
    speed: 330,
    boostMultiplier: 1.65,
    boostDrainRate: 34,
    boostRegenRate: 20,
    fireCooldownMs: 210,
    damage: 24,
    projectileSpeed: 880,
    projectilePattern: 'twin',
    radius: 20,
    unlockLevel: 1,
    defaultColor: '#00F0FF',
  },
  phantom: {
    id: 'phantom',
    name: 'Phantom X-9',
    role: 'High-Velocity Recon',
    description: 'Ultra-lightweight vectorwing built for flanking maneuvers, rapid-fire needle blasters, and extended afterburner bursts.',
    maxHp: 90,
    maxShield: 65,
    shieldRegenRate: 15,
    speed: 440,
    boostMultiplier: 1.8,
    boostDrainRate: 24,
    boostRegenRate: 28,
    fireCooldownMs: 130,
    damage: 15,
    projectileSpeed: 1020,
    projectilePattern: 'rapid',
    radius: 17,
    unlockLevel: 1,
    defaultColor: '#3B82F6',
  },
  titan: {
    id: 'titan',
    name: 'Titan Bastion',
    role: 'Heavy Dreadnought',
    description: 'Heavily armored siege gunship featuring triple-arc plasma scatter cannons and reinforced reactive hull plating.',
    maxHp: 220,
    maxShield: 140,
    shieldRegenRate: 10,
    speed: 250,
    boostMultiplier: 1.55,
    boostDrainRate: 40,
    boostRegenRate: 16,
    fireCooldownMs: 380,
    damage: 22,
    projectileSpeed: 760,
    projectilePattern: 'spread',
    radius: 25,
    unlockLevel: 1,
    defaultColor: '#F43F5E',
  },
  nova: {
    id: 'nova',
    name: 'Nova Singularity',
    role: 'Energy Specialist',
    description: 'Experimental high-capacitor vessel firing hyper-velocity photon lances with rapid harmonic shield regeneration.',
    maxHp: 100,
    maxShield: 150,
    shieldRegenRate: 22,
    speed: 355,
    boostMultiplier: 1.68,
    boostDrainRate: 30,
    boostRegenRate: 24,
    fireCooldownMs: 270,
    damage: 42,
    projectileSpeed: 1180,
    projectilePattern: 'lance',
    radius: 19,
    unlockLevel: 1,
    defaultColor: '#8B5CF6',
  },
};

export const SHIP_COLORS = [
  { name: 'Neon Cyan', hex: '#00F0FF' },
  { name: 'Electric Blue', hex: '#3B82F6' },
  { name: 'Hyper Violet', hex: '#8B5CF6' },
  { name: 'Solar Crimson', hex: '#F43F5E' },
  { name: 'Ion Emerald', hex: '#10B981' },
  { name: 'Nova Amber', hex: '#F59E0B' },
];

export const GAME_MODE_LABELS: Record<GameMode, { title: string; short: string; description: string }> = {
  DUEL_1V1: {
    title: '1 vs 1 Friend Duel',
    short: '1v1 Duel',
    description: 'Head-to-head starfighter duel for 2 players. First pilot to 5 eliminations (or 1,500 score) wins.',
  },
  TEAM_VS_TEAM: {
    title: 'Team Battle (2v2 / 3v3 / 4v4)',
    short: 'Team PvP',
    description: 'Alpha Squadron (Cyan) vs Omega Squadron (Crimson). Coordinate with friends to reach 10 team eliminations.',
  },
  FREE_FOR_ALL: {
    title: 'Free-For-All Arena (2–8 Players)',
    short: 'Free-For-All',
    description: 'Every pilot for themselves. Compete against up to 8 friends in all-out PvP combat.',
  },
  COOP_SURVIVAL: {
    title: 'Co-Op Wave Survival (1–8 Players)',
    short: 'Co-Op Survival',
    description: 'Team up with friends to survive 10 escalating enemy waves and multi-phase dreadnought bosses.',
  },
};

export const ARENA_WIDTH = 3000;
export const ARENA_HEIGHT = 3000;
export const MAX_PLAYERS_PER_ROOM = 8;

export interface PlayerInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  shoot: boolean;
  boost: boolean;
  aimAngle: number;
  seq: number;
}

export interface PlayerState {
  id: string;
  pilotId: string;
  username: string;
  shipType: ShipType;
  color: string;
  team?: TeamId;
  isReady: boolean;
  isHost: boolean;
  connected: boolean;
  level: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  boostEnergy: number;
  isBoosting: boolean;
  lives: number;
  maxLives: number;
  respawnTimer: number;
  invulnerableTimer: number;
  rapidFireTimer: number;
  score: number;
  kills: number;
  deaths: number;
  bossDamageDealt: number;
}

export interface ProjectileState {
  id: string;
  ownerId: string;
  isEnemy: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  damage: number;
  color: string;
  radius: number;
  ttl: number;
  piercing?: boolean;
}

export interface EnemyState {
  id: string;
  type: EnemyType;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  maxHp: number;
  radius: number;
  color: string;
  scoreValue: number;
  bossPhase?: 1 | 2 | 3;
  targetPlayerId?: string;
}

export interface AsteroidState {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  rotation: number;
  rotationSpeed: number;
  vertices: number[];
  hp: number;
  maxHp: number;
}

export interface PowerUpState {
  id: string;
  type: PowerUpType;
  x: number;
  y: number;
  ttl: number;
}

export interface ExplosionEvent {
  id: string;
  x: number;
  y: number;
  color: string;
  radius: number;
  intensity: 'small' | 'medium' | 'large' | 'boss';
}

export interface KillNotification {
  id: string;
  killerName: string;
  killerColor: string;
  victimName: string;
  victimType: 'player' | 'enemy' | 'boss';
  weaponOrRole: string;
  timestamp: number;
}

export interface GameSnapshot {
  roomCode: string;
  roomName: string;
  mode: GameMode;
  status: RoomStatus;
  isPublic: boolean;
  maxPlayers: number;
  wave: number;
  maxWaves: number;
  waveBannerTimer: number;
  waveTitle: string;
  enemiesRemainingInWave: number;
  matchTimer: number;
  teamScore: number;
  alphaScore?: number;
  omegaScore?: number;
  targetScoreFFA: number;
  winnerName?: string;
  players: PlayerState[];
  enemies: EnemyState[];
  projectiles: ProjectileState[];
  asteroids: AsteroidState[];
  powerUps: PowerUpState[];
  explosions: ExplosionEvent[];
  killFeed: KillNotification[];
  serverTime: number;
}

export interface RoomSummary {
  roomCode: string;
  roomName: string;
  mode: GameMode;
  status: RoomStatus;
  isPublic: boolean;
  playerCount: number;
  maxPlayers: number;
  wave: number;
  hostName: string;
}

export interface PilotProfile {
  pilotId: string;
  username: string;
  xp: number;
  level: number;
  selectedShip: ShipType;
  selectedColor: string;
  matchesPlayed: number;
  victories: number;
  totalKills: number;
  bossesDefeated: number;
  highestWave: number;
  highScoreCoop: number;
  highScoreFFA: number;
  updatedAt: number;
}

export interface LeaderboardEntry {
  pilotId: string;
  username: string;
  shipType: ShipType;
  color: string;
  mode: GameMode;
  score: number;
  kills: number;
  wave: number;
  level: number;
  timestamp: number;
}
