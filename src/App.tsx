import React, { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Copy,
  Check,
  Volume2,
  VolumeX,
  Maximize2,
  Play,
  LogOut,
  RefreshCw,
  Pause,
  Server,
} from 'lucide-react';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  GameMode,
  GameSnapshot,
  LeaderboardEntry,
  PilotProfile,
  PlayerInput,
  RoomSummary,
  SHIP_COLORS,
  SHIP_SPECS,
  ShipType,
} from './shared/types.ts';
import { soundEngine } from './client/audio.ts';
import { ArenaRenderer, renderMinimap } from './client/renderer.ts';
import { LocalDevArena } from './client/localDevEngine.ts';

type NavTab = 'MENU' | 'ROOMS' | 'HANGAR' | 'LEADERBOARD' | 'HOW_TO_PLAY';

interface ShipPreviewProps {
  shipType: ShipType;
  color: string;
  size?: number;
}

const ShipPreviewCanvas: React.FC<ShipPreviewProps> = ({ shipType, color, size = 140 }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    let angle = -Math.PI / 4;

    const renderLoop = () => {
      angle += 0.012;
      ctx.clearRect(0, 0, size, size);

      ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.36, 0, Math.PI * 2);
      ctx.stroke();

      ctx.save();
      ctx.translate(size / 2, size / 2);
      ctx.scale(1.45, 1.45);
      ctx.rotate(angle);
      ArenaRenderer.drawShipHullGeometry(ctx, shipType, color, true, false);
      ctx.restore();

      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animId);
  }, [shipType, color, size]);

  return <canvas ref={canvasRef} width={size} height={size} className="mx-auto block" />;
};

function getOrCreatePilotId(): string {
  const key = 'space_arena_tab_pilot_id';
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = 'plt_' + Math.random().toString(36).substring(2, 10);
    sessionStorage.setItem(key, id);
  }
  return id;
}

export default function App() {
  const configuredEnvBackendUrl = (import.meta.env.VITE_BACKEND_URL || '').trim();

  const [pilotId] = useState<string>(() => getOrCreatePilotId());
  const [username, setUsername] = useState<string>(
    () =>
      sessionStorage.getItem('space_arena_username') ||
      `PILOT_${pilotId.slice(4, 8).toUpperCase()}`
  );
  const [selectedShip, setSelectedShip] = useState<ShipType>(
    () => (localStorage.getItem('space_arena_ship') as ShipType) || 'vanguard'
  );
  const [selectedColor, setSelectedColor] = useState<string>(
    () => localStorage.getItem('space_arena_color') || '#00F0FF'
  );

  const [navTab, setNavTab] = useState<NavTab>('MENU');
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Room Creation Form State
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomMode, setNewRoomMode] = useState<GameMode>('COOP_SURVIVAL');
  const [newRoomPublic, setNewRoomPublic] = useState(true);
  const [newRoomMaxPlayers, setNewRoomMaxPlayers] = useState(6);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Multiplayer & Server State
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [pingMs, setPingMs] = useState<number>(12);
  const [publicRooms, setPublicRooms] = useState<RoomSummary[]>([]);
  const [roomSnapshot, setRoomSnapshot] = useState<GameSnapshot | null>(null);
  const roomSnapshotRef = useRef<GameSnapshot | null>(null);
  const [isLocalDevSession, setIsLocalDevSession] = useState(false);
  const localDevArenaRef = useRef<LocalDevArena | null>(null);

  const [profile, setProfile] = useState<PilotProfile | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardFilter, setLeaderboardFilter] = useState<'ALL' | GameMode>('ALL');

  // Audio & Visual Settings
  const [muted, setMuted] = useState(false);
  const [masterVolume, setMasterVolume] = useState(0.75);
  const [sfxVolume, setSfxVolume] = useState(0.85);
  const [reducedEffects, setReducedEffects] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  // Canvas & Input Refs
  const arenaCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<ArenaRenderer | null>(null);
  const inputStateRef = useRef<PlayerInput>({
    up: false,
    down: false,
    left: false,
    right: false,
    shoot: false,
    boost: false,
    aimAngle: -Math.PI / 2,
    seq: 0,
  });
  const mouseAngleRef = useRef<number | null>(null);
  const prevWaveRef = useRef<number>(0);
  const prevStatusRef = useRef<string>('LOBBY');

  // Sync Audio Settings
  useEffect(() => {
    soundEngine.updateSettings({ muted, masterVolume, sfxVolume });
  }, [muted, masterVolume, sfxVolume]);

  // Persist pilot customization locally
  useEffect(() => {
    sessionStorage.setItem('space_arena_username', username);
    localStorage.setItem('space_arena_ship', selectedShip);
    localStorage.setItem('space_arena_color', selectedColor);
  }, [username, selectedShip, selectedColor]);

  // Connect Socket.IO (Uses VITE_BACKEND_URL if configured, or same-origin in local full-stack dev)
  useEffect(() => {
    const targetUrl = configuredEnvBackendUrl || undefined;
    const socket = io(targetUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 1500,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit(
        'profile:sync',
        { pilotId, username, shipType: selectedShip, color: selectedColor },
        (res: { profile?: PilotProfile; leaderboard?: LeaderboardEntry[] }) => {
          if (res?.profile) setProfile(res.profile);
          if (res?.leaderboard) setLeaderboard(res.leaderboard);
        }
      );
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('connect_error', () => {
      setConnected(false);
    });

    socket.on('rooms:list', (rooms: RoomSummary[]) => {
      setPublicRooms(rooms || []);
    });

    socket.on('room:state', (snapshot: GameSnapshot) => {
      if (localDevArenaRef.current) return; // Ignore if in solo local dev mode

      if (rendererRef.current && snapshot.explosions?.length) {
        for (const exp of snapshot.explosions) {
          rendererRef.current.spawnExplosionParticles(exp, reducedEffects);
          soundEngine.playExplosion(exp.intensity);
        }
      }

      if (snapshot.status === 'PLAYING' && snapshot.wave !== prevWaveRef.current) {
        prevWaveRef.current = snapshot.wave;
        const hasBoss = snapshot.wave % 5 === 0 || snapshot.wave === 3;
        soundEngine.playWaveAlert(hasBoss);
      }

      if (
        (snapshot.status === 'VICTORY' || snapshot.status === 'DEFEAT') &&
        prevStatusRef.current === 'PLAYING'
      ) {
        soundEngine.playMatchEnd(snapshot.status === 'VICTORY');
        socket.emit(
          'profile:sync',
          { pilotId },
          (res: { profile?: PilotProfile; leaderboard?: LeaderboardEntry[] }) => {
            if (res?.profile) setProfile(res.profile);
            if (res?.leaderboard) setLeaderboard(res.leaderboard);
          }
        );
      }
      prevStatusRef.current = snapshot.status;

      roomSnapshotRef.current = snapshot;
      setRoomSnapshot(snapshot);
    });

    const pingTimer = setInterval(() => {
      if (socket.connected) {
        const start = performance.now();
        socket.emit('ping:check', start, () => {
          setPingMs(Math.max(1, Math.round(performance.now() - start)));
        });
      }
    }, 3000);

    return () => {
      clearInterval(pingTimer);
      socket.disconnect();
    };
  }, [pilotId, configuredEnvBackendUrl]);

  // Keyboard & Mouse Controls during Active Gameplay (Both Multiplayer & Solo Dev Mode)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const snap = roomSnapshotRef.current;
      if (!snap || snap.status !== 'PLAYING') return;

      if (e.code === 'Escape') {
        setIsPaused((prev) => !prev);
        return;
      }

      const inp = inputStateRef.current;
      if (e.code === 'KeyW' || e.code === 'ArrowUp') inp.up = true;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') inp.down = true;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') inp.left = true;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') inp.right = true;
      if (e.code === 'Space') {
        e.preventDefault();
        inp.shoot = true;
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        inp.boost = true;
        soundEngine.playBoost();
      }

      if (mouseAngleRef.current === null) {
        const dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
        const dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
        if (dx !== 0 || dy !== 0) {
          inp.aimAngle = Math.atan2(dy, dx);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const inp = inputStateRef.current;
      if (e.code === 'KeyW' || e.code === 'ArrowUp') inp.up = false;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') inp.down = false;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') inp.left = false;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') inp.right = false;
      if (e.code === 'Space') inp.shoot = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') inp.boost = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const inputInterval = setInterval(() => {
      const snap = roomSnapshotRef.current;
      if (!snap || snap.status !== 'PLAYING') return;

      const inp = inputStateRef.current;
      inp.seq += 1;

      if (localDevArenaRef.current) {
        localDevArenaRef.current.input = { ...inp };
      } else if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('player:input', inp);
      }

      if (inp.shoot) {
        const me = snap.players.find((p) => p.pilotId === pilotId);
        if (me && me.respawnTimer === 0) {
          soundEngine.playLaser(me.shipType);
        }
      }
    }, 1000 / 30);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      clearInterval(inputInterval);
    };
  }, [pilotId]);

  // Local Solo Development Mode 30Hz Simulation Loop (When running without a backend)
  useEffect(() => {
    if (!isLocalDevSession || !localDevArenaRef.current) return;

    let lastTick = performance.now();
    const simTimer = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTick) / 1000);
      lastTick = now;

      const arena = localDevArenaRef.current;
      if (!arena) return;

      if (!isPaused && arena.status === 'PLAYING') {
        arena.update(dt);
      }
      const snapshot = arena.consumeSnapshot();

      if (rendererRef.current && snapshot.explosions?.length) {
        for (const exp of snapshot.explosions) {
          rendererRef.current.spawnExplosionParticles(exp, reducedEffects);
          soundEngine.playExplosion(exp.intensity);
        }
      }

      if (snapshot.status === 'PLAYING' && snapshot.wave !== prevWaveRef.current) {
        prevWaveRef.current = snapshot.wave;
        soundEngine.playWaveAlert(snapshot.wave % 5 === 0 || snapshot.wave === 3);
      }

      roomSnapshotRef.current = snapshot;
      setRoomSnapshot(snapshot);
    }, 1000 / 30);

    return () => clearInterval(simTimer);
  }, [isLocalDevSession, isPaused, reducedEffects]);

  // 60 FPS Canvas Render Loop when in Game Arena
  useEffect(() => {
    if (!roomSnapshot || roomSnapshot.status === 'LOBBY') return;

    if (!rendererRef.current) {
      rendererRef.current = new ArenaRenderer();
    }

    let animFrameId = 0;
    let lastTime = performance.now();

    const renderFrame = (now: number) => {
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      const canvas = arenaCanvasRef.current;
      const snap = roomSnapshotRef.current;
      if (canvas && snap && rendererRef.current) {
        if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
          canvas.width = window.innerWidth;
          canvas.height = window.innerHeight;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          rendererRef.current.render(
            ctx,
            canvas.width,
            canvas.height,
            snap,
            pilotId,
            mouseAngleRef.current,
            reducedEffects,
            dt
          );
        }
      }

      const mini = minimapCanvasRef.current;
      if (mini && snap) {
        const mCtx = mini.getContext('2d');
        if (mCtx) {
          renderMinimap(mCtx, mini.width, mini.height, snap, pilotId);
        }
      }

      animFrameId = requestAnimationFrame(renderFrame);
    };

    animFrameId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(animFrameId);
  }, [roomSnapshot?.status, pilotId, reducedEffects]);

  // Actions
  const handleStartSoloDevMode = () => {
    setErrorBanner(null);
    const devArena = new LocalDevArena(
      pilotId,
      username,
      selectedShip,
      selectedColor,
      profile?.level || 1
    );
    localDevArenaRef.current = devArena;
    setIsLocalDevSession(true);
    setIsPaused(false);
    const snap = devArena.consumeSnapshot();
    roomSnapshotRef.current = snap;
    setRoomSnapshot(snap);
  };

  const handleQuickPlay = (mode: GameMode = 'COOP_SURVIVAL') => {
    const socket = socketRef.current;
    if (!socket || !connected) {
      setErrorBanner(
        'Multiplayer backend is not connected yet. Deploy the /backend server and set VITE_BACKEND_URL, or click "Solo Dev Mode (No Backend)" to test gameplay locally.'
      );
      return;
    }
    setErrorBanner(null);
    socket.emit(
      'room:quickplay',
      {
        pilotId,
        username,
        shipType: selectedShip,
        color: selectedColor,
        preferredMode: mode,
      },
      (res: { ok: boolean; roomCode?: string; error?: string }) => {
        if (!res.ok) {
          setErrorBanner(res.error || 'Could not join quick match.');
        }
      }
    );
  };

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const socket = socketRef.current;
    if (!socket || !connected) {
      setShowCreateModal(false);
      setErrorBanner(
        'Cannot create a multiplayer room while the Socket.IO backend is offline. Configure VITE_BACKEND_URL or use Solo Dev Mode.'
      );
      return;
    }
    setErrorBanner(null);
    socket.emit(
      'room:create',
      {
        pilotId,
        username,
        shipType: selectedShip,
        color: selectedColor,
        roomName: newRoomName.trim() || `${username}'s Sector`,
        mode: newRoomMode,
        isPublic: newRoomPublic,
        maxPlayers: newRoomMaxPlayers,
      },
      (res: { ok: boolean; roomCode?: string; error?: string }) => {
        if (res.ok) {
          setShowCreateModal(false);
        } else {
          setErrorBanner(res.error || 'Failed to create room.');
        }
      }
    );
  };

  const handleJoinRoomByCode = (codeToJoin: string) => {
    const socket = socketRef.current;
    if (!socket || !connected) {
      setErrorBanner(
        'Multiplayer backend is offline. Deploy /backend and configure VITE_BACKEND_URL to join multiplayer rooms.'
      );
      return;
    }
    const clean = codeToJoin.trim().toUpperCase();
    if (!clean) {
      setErrorBanner('Enter a valid 6-character room code.');
      return;
    }
    setErrorBanner(null);
    socket.emit(
      'room:join',
      {
        roomCode: clean,
        pilotId,
        username,
        shipType: selectedShip,
        color: selectedColor,
      },
      (res: { ok: boolean; roomCode?: string; error?: string }) => {
        if (!res.ok) {
          setErrorBanner(res.error || 'Unable to join room.');
        }
      }
    );
  };

  const handleLeaveRoom = () => {
    if (localDevArenaRef.current) {
      localDevArenaRef.current = null;
      setIsLocalDevSession(false);
    } else if (socketRef.current) {
      socketRef.current.emit('room:leave');
    }
    setRoomSnapshot(null);
    roomSnapshotRef.current = null;
    setIsPaused(false);
  };

  const handleStartMatch = () => {
    if (localDevArenaRef.current) {
      localDevArenaRef.current.restart();
      setIsPaused(false);
      return;
    }
    const socket = socketRef.current;
    if (socket) {
      socket.emit('game:start');
      setIsPaused(false);
    }
  };

  const handleLobbyCustomize = (
    shipType?: ShipType,
    color?: string,
    newUsername?: string,
    isReady?: boolean
  ) => {
    if (shipType) setSelectedShip(shipType);
    if (color) setSelectedColor(color);
    if (newUsername !== undefined) setUsername(newUsername);
    const socket = socketRef.current;
    if (socket && connected) {
      socket.emit('player:customize', {
        shipType: shipType || selectedShip,
        color: color || selectedColor,
        username: newUsername !== undefined ? newUsername : username,
        isReady,
      });
    }
  };

  const handleCopyRoomCode = (code: string) => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // ============================================================================
  // RENDER 1: ACTIVE GAME ARENA VIEW (PLAYING / VICTORY / DEFEAT)
  // ============================================================================
  if (roomSnapshot && roomSnapshot.status !== 'LOBBY') {
    const localPlayer =
      roomSnapshot.players.find((p) => p.pilotId === pilotId) || roomSnapshot.players[0];
    const activeBoss = roomSnapshot.enemies.find((e) => e.type === 'boss');
    const sortedPlayers = [...roomSnapshot.players]
      .filter((p) => p.connected)
      .sort((a, b) => b.score - a.score);

    return (
      <div
        className="relative w-screen h-screen overflow-hidden bg-[#040711] select-none cursor-crosshair"
        onMouseMove={(e) => {
          const cx = window.innerWidth / 2;
          const cy = window.innerHeight / 2;
          const angle = Math.atan2(e.clientY - cy, e.clientX - cx);
          mouseAngleRef.current = angle;
          inputStateRef.current.aimAngle = angle;
        }}
        onMouseDown={(e) => {
          if (e.button === 0 && !isPaused && roomSnapshot.status === 'PLAYING') {
            inputStateRef.current.shoot = true;
          }
        }}
        onMouseUp={(e) => {
          if (e.button === 0) {
            inputStateRef.current.shoot = false;
          }
        }}
      >
        <canvas ref={arenaCanvasRef} className="block w-full h-full" />

        {/* TOP-LEFT HUD: Ship Telemetry */}
        {localPlayer && (
          <div className="pointer-events-none absolute top-4 left-4 w-72 bg-slate-950/85 border border-slate-800/90 rounded-xl p-4 backdrop-blur-md">
            <div className="flex items-center justify-between mb-2">
              <span className="font-display font-bold text-sm text-white truncate">
                {localPlayer.username}
              </span>
              <span className="text-xs text-slate-400 font-mono tabular-nums">
                {SHIP_SPECS[localPlayer.shipType].name} · LVL {localPlayer.level}
              </span>
            </div>

            <div className="mb-2.5">
              <div className="flex justify-between text-xs font-mono tabular-nums mb-1">
                <span className="text-slate-300">HULL INTEGRITY</span>
                <span className="text-emerald-400">
                  {localPlayer.hp} / {localPlayer.maxHp}
                </span>
              </div>
              <div className="w-full h-2 bg-slate-900 rounded-sm overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-transform duration-100 origin-left"
                  style={{
                    transform: `scaleX(${Math.max(0, Math.min(1, localPlayer.hp / localPlayer.maxHp))})`,
                  }}
                />
              </div>
            </div>

            <div className="mb-2.5">
              <div className="flex justify-between text-xs font-mono tabular-nums mb-1">
                <span className="text-slate-300">HARMONIC SHIELD</span>
                <span className="text-cyan-400">
                  {localPlayer.shield} / {localPlayer.maxShield}
                </span>
              </div>
              <div className="w-full h-2 bg-slate-900 rounded-sm overflow-hidden">
                <div
                  className="h-full bg-cyan-400 transition-transform duration-100 origin-left"
                  style={{
                    transform: `scaleX(${Math.max(0, Math.min(1, localPlayer.shield / localPlayer.maxShield))})`,
                  }}
                />
              </div>
            </div>

            <div className="mb-3">
              <div className="flex justify-between text-xs font-mono tabular-nums mb-1">
                <span className="text-slate-300">AFTERBURNER BOOST</span>
                <span className="text-amber-400">{localPlayer.boostEnergy}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-900 rounded-sm overflow-hidden">
                <div
                  className="h-full bg-amber-400 transition-transform duration-75 origin-left"
                  style={{
                    transform: `scaleX(${Math.max(0, Math.min(1, localPlayer.boostEnergy / 100))})`,
                  }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs font-mono tabular-nums text-slate-300">
              <span>
                {roomSnapshot.mode === 'COOP_SURVIVAL'
                  ? `LIVES: ${localPlayer.lives} / ${localPlayer.maxLives}`
                  : `ELIMS: ${localPlayer.kills} · DEATHS: ${localPlayer.deaths}`}
              </span>
              <span className="text-cyan-300 font-semibold">
                SCORE {localPlayer.score.toLocaleString()}
              </span>
            </div>

            {localPlayer.rapidFireTimer > 0 && (
              <div className="mt-2 text-xs font-mono text-rose-400 tabular-nums">
                WEAPON OVERDRIVE ACTIVE · {localPlayer.rapidFireTimer}s
              </div>
            )}
          </div>
        )}

        {/* TOP-CENTER HUD: Wave, Timer, Team Score & Boss Health Bar */}
        <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 w-full max-w-lg px-4">
          <div className="bg-slate-950/85 border border-slate-800/90 rounded-xl px-6 py-2.5 backdrop-blur-md flex items-center gap-6 text-xs font-mono tabular-nums">
            <div>
              <span className="text-slate-400 block text-[10px]">SECTOR MODE</span>
              <span className="text-white font-semibold">
                {isLocalDevSession
                  ? `SOLO DEV · WAVE ${roomSnapshot.wave}`
                  : roomSnapshot.mode === 'COOP_SURVIVAL'
                    ? `WAVE ${roomSnapshot.wave} / ${roomSnapshot.maxWaves}`
                    : 'FREE-FOR-ALL'}
              </span>
            </div>
            <span className="text-slate-700">·</span>
            <div>
              <span className="text-slate-400 block text-[10px]">MATCH TIMER</span>
              <span className="text-cyan-300 font-semibold">
                {formatTimer(roomSnapshot.matchTimer)}
              </span>
            </div>
            <span className="text-slate-700">·</span>
            <div>
              <span className="text-slate-400 block text-[10px]">
                {roomSnapshot.mode === 'COOP_SURVIVAL' ? 'HOSTILES LEFT' : 'TARGET SCORE'}
              </span>
              <span className="text-amber-300 font-semibold">
                {roomSnapshot.mode === 'COOP_SURVIVAL'
                  ? roomSnapshot.enemiesRemainingInWave
                  : roomSnapshot.targetScoreFFA.toLocaleString()}
              </span>
            </div>
            <span className="text-slate-700">·</span>
            <div>
              <span className="text-slate-400 block text-[10px]">TOTAL SCORE</span>
              <span className="text-emerald-400 font-semibold">
                {roomSnapshot.teamScore.toLocaleString()}
              </span>
            </div>
          </div>

          {activeBoss && (
            <div className="w-full bg-slate-950/90 border border-rose-500/60 rounded-xl p-3 backdrop-blur-md">
              <div className="flex items-center justify-between text-xs font-mono tabular-nums mb-1.5">
                <span className="text-rose-400 font-bold tracking-wide">
                  {activeBoss.name} · PHASE {activeBoss.bossPhase || 1}
                </span>
                <span className="text-slate-200">
                  {activeBoss.hp.toLocaleString()} / {activeBoss.maxHp.toLocaleString()} HP
                </span>
              </div>
              <div className="w-full h-3 bg-slate-900 rounded-sm overflow-hidden">
                <div
                  className="h-full bg-rose-500 transition-transform duration-100 origin-left"
                  style={{
                    transform: `scaleX(${Math.max(0, Math.min(1, activeBoss.hp / activeBoss.maxHp))})`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* TOP-RIGHT HUD: Live Room Leaderboard & Kill Feed */}
        <div className="pointer-events-none absolute top-4 right-4 w-72 flex flex-col gap-3">
          <div className="bg-slate-950/85 border border-slate-800/90 rounded-xl p-3.5 backdrop-blur-md">
            <div className="flex items-center justify-between text-xs text-slate-400 font-mono tabular-nums mb-2 pb-1.5 border-b border-slate-800">
              <span>{isLocalDevSession ? 'LOCAL DEV ENGINE' : `ROOM ${roomSnapshot.roomCode}`}</span>
              <span>
                {isLocalDevSession
                  ? '1 PILOT (OFFLINE)'
                  : `${connected ? 'ONLINE' : 'RECONNECTING'} · ${pingMs}ms`}
              </span>
            </div>
            <div className="space-y-1.5">
              {sortedPlayers.map((p, idx) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between text-xs font-mono tabular-nums"
                >
                  <div className="flex items-center gap-2 truncate pr-2">
                    <span className="text-slate-500">{idx + 1}.</span>
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: p.color }}
                    />
                    <span
                      className={
                        p.pilotId === pilotId
                          ? 'text-cyan-300 font-semibold truncate'
                          : 'text-slate-200 truncate'
                      }
                    >
                      {p.username}
                    </span>
                  </div>
                  <div className="text-right shrink-0 text-slate-300">
                    <span>{p.score.toLocaleString()}</span>
                    <span className="text-slate-600 mx-1">·</span>
                    <span className="text-slate-400">{p.kills}K</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {roomSnapshot.killFeed.length > 0 && (
            <div className="space-y-1">
              {roomSnapshot.killFeed.slice(0, 4).map((kf) => (
                <div
                  key={kf.id}
                  className="bg-slate-950/75 border border-slate-800/70 rounded-lg px-3 py-1.5 text-[11px] font-mono flex items-center justify-between gap-2"
                >
                  <span className="truncate" style={{ color: kf.killerColor }}>
                    {kf.killerName}
                  </span>
                  <span className="text-slate-500 shrink-0">eliminated</span>
                  <span className="text-rose-300 truncate">{kf.victimName}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* BOTTOM-LEFT HUD: Controls Quick Bar & Pause Trigger */}
        <div className="absolute bottom-4 left-4 flex items-center gap-3">
          <button
            onClick={() => setIsPaused(true)}
            className="px-3.5 py-2 bg-slate-950/85 hover:bg-slate-900 border border-slate-800 rounded-lg text-xs font-medium text-slate-200 flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Pause className="w-3.5 h-3.5" />
            Pause (ESC)
          </button>
          <div className="hidden md:flex items-center gap-2 bg-slate-950/75 border border-slate-800/80 rounded-lg px-3.5 py-2 text-xs text-slate-400 font-mono">
            <span>WASD / Arrows: Move</span>
            <span>·</span>
            <span>Mouse / Space: Fire</span>
            <span>·</span>
            <span>Shift: Boost</span>
          </div>
        </div>

        {/* BOTTOM-RIGHT HUD: Radar Minimap */}
        <div className="pointer-events-none absolute bottom-4 right-4 bg-slate-950/85 border border-slate-800/90 rounded-xl p-2 backdrop-blur-md">
          <div className="text-[10px] font-mono text-slate-400 mb-1 flex justify-between">
            <span>SECTOR RADAR</span>
            <span>
              {ARENA_WIDTH}x{ARENA_HEIGHT}
            </span>
          </div>
          <canvas
            ref={minimapCanvasRef}
            width={156}
            height={156}
            className="block rounded border border-slate-800"
          />
        </div>

        {/* Respawn Countdown Banner */}
        {localPlayer && localPlayer.respawnTimer > 0 && roomSnapshot.status === 'PLAYING' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/45 backdrop-blur-xs">
            <div className="bg-slate-950/90 border border-rose-500/50 rounded-2xl px-8 py-6 text-center max-w-md">
              <h2 className="font-display text-2xl font-bold text-rose-400 mb-2">
                {localPlayer.lives > 0 ? 'SHIP DESTROYED' : 'OUT OF LIVES'}
              </h2>
              <p className="text-sm text-slate-300 font-mono tabular-nums">
                {localPlayer.lives > 0
                  ? `Reconstructing hull in ${localPlayer.respawnTimer}s (${localPlayer.lives} lives left)`
                  : 'Spectating allied squadron — survive the wave!'}
              </p>
            </div>
          </div>
        )}

        {/* Wave Transition Cinematic Banner */}
        {roomSnapshot.waveBannerTimer > 0 && roomSnapshot.status === 'PLAYING' && (
          <div className="pointer-events-none absolute top-32 left-1/2 -translate-x-1/2 text-center">
            <div className="bg-slate-950/90 border border-cyan-500/40 rounded-xl px-8 py-3 backdrop-blur-md">
              <div className="text-xs font-mono text-cyan-400 tracking-widest mb-0.5">
                TACTICAL ALERT
              </div>
              <div className="font-display text-2xl font-bold text-white">
                {roomSnapshot.waveTitle}
              </div>
            </div>
          </div>
        )}

        {/* Pause Menu Overlay */}
        {isPaused && roomSnapshot.status === 'PLAYING' && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-30 cursor-default">
            <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <h2 className="font-display text-2xl font-bold text-white mb-1">
                Tactical Systems Paused
              </h2>
              <p className="text-xs text-slate-400 mb-6 font-mono">
                {isLocalDevSession
                  ? 'Solo Development Mode (Local Engine)'
                  : `Room Code: ${roomSnapshot.roomCode} · Live Multiplayer Session`}
              </p>

              <div className="space-y-4 mb-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-300">Mute Audio</span>
                  <button
                    onClick={() => setMuted(!muted)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-medium text-white transition-colors cursor-pointer"
                  >
                    {muted ? 'Unmute' : 'Mute'}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-300">Reduced Visual Effects</span>
                  <button
                    onClick={() => setReducedEffects(!reducedEffects)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-medium text-white transition-colors cursor-pointer"
                  >
                    {reducedEffects ? 'Enabled' : 'Standard'}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-300">Fullscreen Display</span>
                  <button
                    onClick={toggleFullscreen}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-medium text-white transition-colors cursor-pointer"
                  >
                    Toggle Fullscreen
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setIsPaused(false)}
                  className="flex-1 py-2.5 px-4 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm rounded-lg transition-colors cursor-pointer"
                >
                  Resume Combat
                </button>
                <button
                  onClick={handleLeaveRoom}
                  className="py-2.5 px-4 bg-slate-800 hover:bg-rose-950/80 hover:text-rose-300 text-slate-300 font-medium text-sm rounded-lg transition-colors cursor-pointer"
                >
                  Leave Arena
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Victory / Defeat Post-Match Screen */}
        {(roomSnapshot.status === 'VICTORY' || roomSnapshot.status === 'DEFEAT') && (
          <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 z-40 cursor-default">
            <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl p-8">
              <div className="text-center mb-6">
                <div className="text-xs font-mono text-slate-400 mb-1">
                  {roomSnapshot.mode === 'COOP_SURVIVAL'
                    ? `SECTOR WAVE ${roomSnapshot.wave}`
                    : 'FREE-FOR-ALL CHAMPIONSHIP'}
                </div>
                <h2
                  className={`font-display text-4xl font-bold mb-2 ${
                    roomSnapshot.status === 'VICTORY' ? 'text-cyan-400' : 'text-rose-500'
                  }`}
                >
                  {roomSnapshot.status === 'VICTORY' ? 'MISSION VICTORY' : 'SQUADRON DEFEATED'}
                </h2>
                {roomSnapshot.winnerName && (
                  <p className="text-sm text-slate-300">
                    Top Commander:{' '}
                    <span className="text-white font-semibold">{roomSnapshot.winnerName}</span>
                  </p>
                )}
              </div>

              <div className="border border-slate-800 rounded-xl overflow-hidden mb-6">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/60 text-xs font-mono text-slate-400">
                      <th className="py-2.5 px-4">PILOT</th>
                      <th className="py-2.5 px-4">SHIP</th>
                      <th className="py-2.5 px-4 text-right">ELIMS</th>
                      <th className="py-2.5 px-4 text-right">DEATHS</th>
                      <th className="py-2.5 px-4 text-right">SCORE</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                    {sortedPlayers.map((p) => (
                      <tr key={p.id} className="bg-slate-900/40">
                        <td className="py-2.5 px-4 font-sans font-medium text-white">
                          {p.username}
                        </td>
                        <td className="py-2.5 px-4 text-xs text-slate-300">
                          {SHIP_SPECS[p.shipType].name}
                        </td>
                        <td className="py-2.5 px-4 text-right text-emerald-400">{p.kills}</td>
                        <td className="py-2.5 px-4 text-right text-slate-400">{p.deaths}</td>
                        <td className="py-2.5 px-4 text-right text-cyan-300 font-semibold">
                          {p.score.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={handleLeaveRoom}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg transition-colors cursor-pointer"
                >
                  Return to Main Menu
                </button>
                <button
                  onClick={handleStartMatch}
                  className="px-6 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-sm font-semibold rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                  Play Again
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // RENDER 2: TOP BAR & MENU / LOBBY / HANGAR / LEADERBOARD / HOW TO PLAY
  // ============================================================================
  return (
    <div className="min-h-screen bg-[#050814] text-slate-100 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-800/80 bg-[#050814]/90 backdrop-blur-md sticky top-0 z-20">
        {/* Zone 1: Brand Wordmark */}
        <button
          onClick={() => {
            if (roomSnapshot) handleLeaveRoom();
            setNavTab('MENU');
          }}
          className="font-display text-xl font-bold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer"
        >
          SPACE ARENA
        </button>

        {/* Zone 2: 5 Single-Line Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            onClick={() => {
              if (roomSnapshot) handleLeaveRoom();
              setNavTab('MENU');
            }}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              navTab === 'MENU' && !roomSnapshot ? 'text-cyan-400 underline underline-offset-8' : ''
            }`}
          >
            Command Center
          </button>
          <button
            onClick={() => {
              if (roomSnapshot) handleLeaveRoom();
              setNavTab('ROOMS');
            }}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              navTab === 'ROOMS' && !roomSnapshot
                ? 'text-cyan-400 underline underline-offset-8'
                : ''
            }`}
          >
            Multiplayer Rooms
          </button>
          <button
            onClick={() => {
              if (roomSnapshot) handleLeaveRoom();
              setNavTab('HANGAR');
            }}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              navTab === 'HANGAR' && !roomSnapshot
                ? 'text-cyan-400 underline underline-offset-8'
                : ''
            }`}
          >
            Ship Hangar
          </button>
          <button
            onClick={() => {
              if (roomSnapshot) handleLeaveRoom();
              setNavTab('LEADERBOARD');
            }}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              navTab === 'LEADERBOARD' && !roomSnapshot
                ? 'text-cyan-400 underline underline-offset-8'
                : ''
            }`}
          >
            Leaderboard
          </button>
          <button
            onClick={() => {
              if (roomSnapshot) handleLeaveRoom();
              setNavTab('HOW_TO_PLAY');
            }}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              navTab === 'HOW_TO_PLAY' && !roomSnapshot
                ? 'text-cyan-400 underline underline-offset-8'
                : ''
            }`}
          >
            Deploy & Guide
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setShowSettings(true)}
            className="px-4 py-2 text-xs font-semibold text-slate-200 bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Settings
          </button>
        </div>
      </header>

      {/* Mobile Navigation Strip */}
      <div className="flex md:hidden items-center justify-around border-b border-slate-800/80 px-4 py-2 text-xs font-medium text-slate-400 bg-slate-950">
        <button onClick={() => setNavTab('MENU')} className="py-1 whitespace-nowrap">
          Command
        </button>
        <button onClick={() => setNavTab('ROOMS')} className="py-1 whitespace-nowrap">
          Rooms
        </button>
        <button onClick={() => setNavTab('HANGAR')} className="py-1 whitespace-nowrap">
          Hangar
        </button>
        <button onClick={() => setNavTab('LEADERBOARD')} className="py-1 whitespace-nowrap">
          Ranks
        </button>
        <button onClick={() => setNavTab('HOW_TO_PLAY')} className="py-1 whitespace-nowrap">
          Deploy
        </button>
      </div>

      {/* Error Alert Banner */}
      {errorBanner && (
        <div className="max-w-6xl mx-auto w-full px-6 pt-4">
          <div className="bg-rose-950/70 border border-rose-500/50 rounded-xl px-4 py-3 text-sm text-rose-200 flex items-center justify-between gap-4">
            <span>{errorBanner}</span>
            <button
              onClick={() => setErrorBanner(null)}
              className="text-xs font-mono text-rose-300 hover:text-white shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MULTIPLAYER LOBBY SCREEN (When inside a room in LOBBY state)         */}
      {/* ==================================================================== */}
      {roomSnapshot && roomSnapshot.status === 'LOBBY' ? (
        <main className="max-w-6xl mx-auto w-full px-6 py-10 flex-1">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-8 border-b border-slate-800">
            <div>
              <div className="text-xs font-mono text-slate-400 mb-1">
                MULTIPLAYER SECTOR LOBBY · {roomSnapshot.isPublic ? 'PUBLIC ROOM' : 'PRIVATE ROOM'}{' '}
                · {roomSnapshot.mode === 'COOP_SURVIVAL' ? 'CO-OP SURVIVAL' : 'FREE-FOR-ALL'}
              </div>
              <h1 className="font-display text-3xl font-bold text-white">
                {roomSnapshot.roomName}
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 flex items-center gap-3">
                <div>
                  <span className="text-[10px] font-mono text-slate-400 block">ROOM CODE</span>
                  <span className="font-mono text-lg font-bold text-cyan-400 tracking-wider">
                    {roomSnapshot.roomCode}
                  </span>
                </div>
                <button
                  onClick={() => handleCopyRoomCode(roomSnapshot.roomCode)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-medium text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {copiedCode ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copiedCode ? 'Copied' : 'Copy Code'}
                </button>
              </div>

              <button
                onClick={handleLeaveRoom}
                className="px-4 py-3 bg-slate-900 hover:bg-rose-950/60 border border-slate-800 rounded-xl text-xs font-medium text-slate-300 hover:text-rose-200 flex items-center gap-2 transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                Leave Lobby
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-8">
            <div className="lg:col-span-7 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-bold text-white">
                  Connected Pilots ({roomSnapshot.players.filter((p) => p.connected).length} /{' '}
                  {roomSnapshot.maxPlayers})
                </h2>
                <span className="text-xs font-mono text-slate-400">
                  Share code {roomSnapshot.roomCode} with another browser window to play together
                </span>
              </div>

              <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-900/40">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/60 text-xs font-mono text-slate-400">
                      <th className="py-3 px-4">CALLSIGN</th>
                      <th className="py-3 px-4">STARFIGHTER</th>
                      <th className="py-3 px-4">LEVEL</th>
                      <th className="py-3 px-4 text-right">STATUS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {roomSnapshot.players
                      .filter((p) => p.connected)
                      .map((p) => (
                        <tr key={p.id}>
                          <td className="py-3.5 px-4 font-medium text-white flex items-center gap-2.5">
                            <span
                              className="w-3 h-3 rounded-sm shrink-0"
                              style={{ backgroundColor: p.color }}
                            />
                            <span>{p.username}</span>
                            {p.pilotId === pilotId && (
                              <span className="text-xs font-mono text-cyan-400">(You)</span>
                            )}
                            {p.isHost && (
                              <span className="text-xs font-mono text-amber-400">· HOST</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-slate-300 font-mono text-xs">
                            {SHIP_SPECS[p.shipType].name}
                          </td>
                          <td className="py-3.5 px-4 font-mono tabular-nums text-xs text-slate-400">
                            LVL {p.level}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono text-xs">
                            {p.isReady || p.isHost ? (
                              <span className="text-emerald-400 font-semibold">READY</span>
                            ) : (
                              <span className="text-amber-400">STANDBY</span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <h3 className="font-display font-semibold text-white text-base">
                    {roomSnapshot.mode === 'COOP_SURVIVAL'
                      ? 'Co-Op Wave Survival & Boss Raid'
                      : 'Free-For-All Arena Combat'}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {roomSnapshot.mode === 'COOP_SURVIVAL'
                      ? 'Battle 10 escalating waves of server-controlled enemy squadrons and multi-phase bosses.'
                      : 'Server-validated player-vs-player combat. First pilot to 2,000 points wins.'}
                  </p>
                </div>

                {(() => {
                  const me = roomSnapshot.players.find((p) => p.pilotId === pilotId);
                  if (me?.isHost) {
                    return (
                      <button
                        onClick={handleStartMatch}
                        className="px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm rounded-xl transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        Launch Match Now
                      </button>
                    );
                  }
                  return (
                    <button
                      onClick={() =>
                        handleLobbyCustomize(undefined, undefined, undefined, !me?.isReady)
                      }
                      className={`px-6 py-3 font-semibold text-sm rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        me?.isReady
                          ? 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                          : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                      }`}
                    >
                      {me?.isReady ? 'Cancel Ready' : 'Mark Ready'}
                    </button>
                  );
                })()}
              </div>
            </div>

            <div className="lg:col-span-5 bg-slate-900/50 border border-slate-800 rounded-2xl p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-bold text-white">Your Ship Loadout</h2>
                <span className="text-xs font-mono text-cyan-400">
                  {SHIP_SPECS[selectedShip].role}
                </span>
              </div>

              <ShipPreviewCanvas shipType={selectedShip} color={selectedColor} size={130} />

              <div>
                <label className="block text-xs font-mono text-slate-400 mb-2">
                  SELECT STARFIGHTER CLASS
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(SHIP_SPECS) as ShipType[]).map((type) => {
                    const spec = SHIP_SPECS[type];
                    const active = selectedShip === type;
                    return (
                      <button
                        key={type}
                        onClick={() => handleLobbyCustomize(type, undefined)}
                        className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                          active
                            ? 'bg-slate-800 border-cyan-500 text-white'
                            : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <div className="font-display font-semibold text-sm">{spec.name}</div>
                        <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                          HP {spec.maxHp} · SHD {spec.maxShield}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-400 mb-2">
                  HULL NEON ACCENT
                </label>
                <div className="flex items-center gap-2.5">
                  {SHIP_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      onClick={() => handleLobbyCustomize(undefined, c.hex)}
                      title={c.name}
                      className={`w-8 h-8 rounded-lg border-2 transition-transform cursor-pointer ${
                        selectedColor === c.hex
                          ? 'border-white scale-110'
                          : 'border-transparent opacity-75 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </main>
      ) : (
        /* ================================================================== */
        /* STANDARD NAVIGATION TABS (MAIN MENU, ROOMS, HANGAR, LEADERBOARD)   */
        /* ================================================================== */
        <main className="max-w-6xl mx-auto w-full px-6 py-10 flex-1">
          {navTab === 'MENU' && (
            <div className="space-y-12">
              {/* Hero Split */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
                <div className="lg:col-span-7 flex flex-col justify-between bg-slate-900/40 border border-slate-800/90 rounded-2xl p-8">
                  <div>
                    <div className="text-xs font-mono text-cyan-400 mb-3">
                      {connected
                        ? `MULTIPLAYER BACKEND ONLINE (${pingMs}ms) · ${
                            configuredEnvBackendUrl || 'SAME-ORIGIN DEV SERVER'
                          }`
                        : 'MULTIPLAYER BACKEND OFFLINE · SOLO DEV MODE READY'}
                    </div>
                    <h1 className="font-display text-4xl sm:text-5xl font-bold text-white tracking-tight mb-4">
                      Command the Sector. Survive the Swarm.
                    </h1>
                    <p className="text-slate-300 text-base leading-relaxed max-w-xl mb-8">
                      Pilot high-velocity starfighters with 2–8 real players in synchronized WebSocket arenas. Coordinate against escalating AI waves and multi-phase dreadnought bosses, or test your ship locally in Solo Dev Mode when running without a backend.
                    </p>
                  </div>

                  {/* Primary Action Controls */}
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={() => handleQuickPlay('COOP_SURVIVAL')}
                        className="px-5 py-3.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm rounded-xl transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        Play Online (Co-Op)
                      </button>
                      <button
                        onClick={() => handleQuickPlay('FREE_FOR_ALL')}
                        className="px-4 py-3.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-sm rounded-xl border border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Play Free-For-All
                      </button>
                      <button
                        onClick={() => setShowCreateModal(true)}
                        className="px-4 py-3.5 bg-slate-900 hover:bg-slate-800 text-slate-200 font-medium text-sm rounded-xl border border-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Create Room
                      </button>
                      <button
                        onClick={handleStartSoloDevMode}
                        className="px-4 py-3.5 bg-slate-950 hover:bg-slate-900 text-amber-300 font-medium text-sm rounded-xl border border-amber-500/40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Solo Dev Mode (No Backend)
                      </button>
                    </div>

                    {/* Direct Room Code Join Bar */}
                    <div className="pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                      <input
                        type="text"
                        value={joinCodeInput}
                        onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                        placeholder="Enter 6-character Room Code"
                        maxLength={8}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm font-mono text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 sm:w-64"
                      />
                      <button
                        onClick={() => handleJoinRoomByCode(joinCodeInput)}
                        className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm font-medium rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Join Room by Code
                      </button>
                      <button
                        onClick={() => setNavTab('HOW_TO_PLAY')}
                        className="text-xs font-mono text-slate-400 hover:text-cyan-400 transition-colors sm:ml-auto whitespace-nowrap cursor-pointer"
                      >
                        Deploying on Vercel? Read Setup Guide →
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right Column: Active Pilot & Ship Showcase Card */}
                <div className="lg:col-span-5 bg-slate-900/40 border border-slate-800/90 rounded-2xl p-8 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <span className="text-xs font-mono text-slate-400 block">ACTIVE PILOT</span>
                        <span className="font-display text-xl font-bold text-white">
                          {username}
                        </span>
                      </div>
                      <div className="text-right font-mono tabular-nums">
                        <span className="text-xs text-cyan-400 block">
                          LEVEL {profile?.level || 1}
                        </span>
                        <span className="text-xs text-slate-400">{profile?.xp || 0} XP</span>
                      </div>
                    </div>

                    <div className="mb-5">
                      <label className="block text-[11px] font-mono text-slate-400 mb-1">
                        PILOT CALLSIGN
                      </label>
                      <input
                        type="text"
                        value={username}
                        maxLength={18}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-sm font-mono text-white focus:outline-none focus:border-cyan-500"
                      />
                    </div>

                    <ShipPreviewCanvas shipType={selectedShip} color={selectedColor} size={150} />

                    <div className="text-center mt-2">
                      <div className="font-display text-lg font-bold text-white">
                        {SHIP_SPECS[selectedShip].name}
                      </div>
                      <div className="text-xs font-mono text-slate-400">
                        {SHIP_SPECS[selectedShip].role} · HP {SHIP_SPECS[selectedShip].maxHp} · SHD{' '}
                        {SHIP_SPECS[selectedShip].maxShield}
                      </div>
                    </div>
                  </div>

                  <div className="pt-5 mt-5 border-t border-slate-800 flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-400 tabular-nums">
                      Kills: {profile?.totalKills || 0} · Best Wave: {profile?.highestWave || 1}
                    </span>
                    <button
                      onClick={() => setNavTab('HANGAR')}
                      className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer"
                    >
                      Customize in Hangar →
                    </button>
                  </div>
                </div>
              </div>

              {/* Active Public Multiplayer Rooms Strip */}
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-display text-xl font-bold text-white">
                      Live Multiplayer Sectors
                    </h2>
                    <p className="text-xs text-slate-400">
                      {connected
                        ? 'Real-time rooms hosted on the connected Socket.IO game server'
                        : 'Multiplayer server not connected — configure VITE_BACKEND_URL or use Solo Dev Mode'}
                    </p>
                  </div>
                  <button
                    onClick={() => socketRef.current?.emit('rooms:fetch')}
                    className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-xs font-medium text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Refresh List
                  </button>
                </div>

                {publicRooms.length === 0 ? (
                  <div className="bg-slate-900/30 border border-slate-800/80 rounded-2xl p-8 text-center">
                    <p className="text-sm text-slate-300 mb-1">
                      {connected
                        ? 'No public sectors currently active.'
                        : 'Socket.IO Multiplayer Backend is not connected yet.'}
                    </p>
                    <p className="text-xs text-slate-400 mb-4">
                      {connected
                        ? 'Create a room or click Play Online to launch a new multiplayer sector.'
                        : 'You can play Solo Dev Mode right now without a backend, or deploy /backend and set VITE_BACKEND_URL.'}
                    </p>
                    <div className="flex items-center justify-center gap-3">
                      {connected ? (
                        <button
                          onClick={() => setShowCreateModal(true)}
                          className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors cursor-pointer"
                        >
                          Create First Public Room
                        </button>
                      ) : (
                        <button
                          onClick={handleStartSoloDevMode}
                          className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold text-xs rounded-lg transition-colors cursor-pointer"
                        >
                          Launch Solo Dev Mode (Single-Player)
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {publicRooms.map((rm) => (
                      <div
                        key={rm.roomCode}
                        className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between gap-4"
                      >
                        <div>
                          <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-1">
                            <span>CODE: {rm.roomCode}</span>
                            <span>
                              {rm.mode === 'COOP_SURVIVAL'
                                ? `CO-OP · WAVE ${rm.wave}`
                                : 'FREE-FOR-ALL'}
                            </span>
                          </div>
                          <h3 className="font-display text-lg font-bold text-white truncate">
                            {rm.roomName}
                          </h3>
                          <p className="text-xs text-slate-400 mt-1">
                            Commander: {rm.hostName} · Status: {rm.status}
                          </p>
                        </div>

                        <div className="flex items-center justify-between pt-3 border-t border-slate-800/80">
                          <span className="text-xs font-mono tabular-nums text-slate-300">
                            {rm.playerCount} / {rm.maxPlayers} Pilots
                          </span>
                          <button
                            onClick={() => handleJoinRoomByCode(rm.roomCode)}
                            disabled={rm.playerCount >= rm.maxPlayers}
                            className="px-4 py-1.5 bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold text-xs rounded-lg transition-colors cursor-pointer"
                          >
                            {rm.playerCount >= rm.maxPlayers ? 'Full' : 'Join Sector'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* ================================================================ */}
          {/* MULTIPLAYER ROOMS BROWSER TAB                                    */}
          {/* ================================================================ */}
          {navTab === 'ROOMS' && (
            <div className="space-y-8">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
                <div>
                  <h1 className="font-display text-3xl font-bold text-white">
                    Multiplayer Sector Directory
                  </h1>
                  <p className="text-sm text-slate-400 mt-1">
                    Join a public room, enter a private room code, or host a custom sector for 2–8 players.
                  </p>
                </div>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Create New Room
                </button>
              </div>

              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-base font-bold text-white">
                    Have a Private or Public Room Code?
                  </h2>
                  <p className="text-xs text-slate-400">
                    Enter the 6-character code shared by the room host to connect directly.
                  </p>
                </div>
                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <input
                    type="text"
                    value={joinCodeInput}
                    onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                    placeholder="ROOM CODE"
                    maxLength={8}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm font-mono text-white focus:outline-none focus:border-cyan-500 w-full sm:w-48"
                  />
                  <button
                    onClick={() => handleJoinRoomByCode(joinCodeInput)}
                    className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Connect
                  </button>
                </div>
              </div>

              <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-900/30">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/60 text-xs font-mono text-slate-400">
                      <th className="py-3.5 px-4">CODE</th>
                      <th className="py-3.5 px-4">SECTOR NAME</th>
                      <th className="py-3.5 px-4">GAME MODE</th>
                      <th className="py-3.5 px-4">HOST</th>
                      <th className="py-3.5 px-4">PILOTS</th>
                      <th className="py-3.5 px-4 text-right">ACTION</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {publicRooms.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-slate-400">
                          {connected
                            ? 'No public rooms active right now. Click "Create New Room" above to host one!'
                            : 'Multiplayer Backend Offline. Deploy /backend and set VITE_BACKEND_URL to enable live rooms.'}
                        </td>
                      </tr>
                    ) : (
                      publicRooms.map((rm) => (
                        <tr key={rm.roomCode}>
                          <td className="py-3.5 px-4 font-mono font-bold text-cyan-400">
                            {rm.roomCode}
                          </td>
                          <td className="py-3.5 px-4 font-medium text-white">{rm.roomName}</td>
                          <td className="py-3.5 px-4 font-mono text-xs text-slate-300">
                            {rm.mode === 'COOP_SURVIVAL'
                              ? `Co-Op Survival (Wave ${rm.wave})`
                              : 'Free-For-All'}
                          </td>
                          <td className="py-3.5 px-4 text-slate-400">{rm.hostName}</td>
                          <td className="py-3.5 px-4 font-mono tabular-nums text-slate-300">
                            {rm.playerCount} / {rm.maxPlayers}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              onClick={() => handleJoinRoomByCode(rm.roomCode)}
                              disabled={rm.playerCount >= rm.maxPlayers}
                              className="px-4 py-1.5 bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold text-xs rounded-lg transition-colors cursor-pointer"
                            >
                              Join
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ================================================================ */}
          {/* SHIP HANGAR & PILOT PROGRESSION TAB                              */}
          {/* ================================================================ */}
          {navTab === 'HANGAR' && (
            <div className="space-y-8">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
                <div>
                  <h1 className="font-display text-3xl font-bold text-white">
                    Orbital Ship Hangar & Progression
                  </h1>
                  <p className="text-sm text-slate-400 mt-1">
                    Select your starfighter chassis, calibrate hull neon accents, and inspect career combat telemetry.
                  </p>
                </div>
                <div className="font-mono text-xs text-slate-300 tabular-nums bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5">
                  PILOT LEVEL {profile?.level || 1} · {profile?.xp || 0} TOTAL XP
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {(Object.keys(SHIP_SPECS) as ShipType[]).map((type) => {
                    const spec = SHIP_SPECS[type];
                    const isSelected = selectedShip === type;
                    return (
                      <div
                        key={type}
                        onClick={() => setSelectedShip(type)}
                        className={`rounded-2xl border p-5 transition-colors cursor-pointer flex flex-col justify-between ${
                          isSelected
                            ? 'bg-slate-900/90 border-cyan-500'
                            : 'bg-slate-900/35 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-1">
                            <span>{spec.role}</span>
                            {isSelected && (
                              <span className="text-cyan-400 font-semibold">EQUIPPED</span>
                            )}
                          </div>
                          <h3 className="font-display text-xl font-bold text-white mb-2">
                            {spec.name}
                          </h3>
                          <ShipPreviewCanvas
                            shipType={type}
                            color={isSelected ? selectedColor : spec.defaultColor}
                            size={115}
                          />
                          <p className="text-xs text-slate-400 leading-relaxed mt-2 mb-4">
                            {spec.description}
                          </p>
                        </div>

                        <div className="space-y-2 pt-3 border-t border-slate-800/80 text-xs font-mono tabular-nums">
                          <div className="flex justify-between">
                            <span className="text-slate-400">HULL / SHIELD</span>
                            <span className="text-white">
                              {spec.maxHp} / {spec.maxShield}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">TOP SPEED</span>
                            <span className="text-cyan-300">{spec.speed} u/s</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">WEAPON SYSTEM</span>
                            <span className="text-amber-300 uppercase">
                              {spec.projectilePattern}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="lg:col-span-5 space-y-6">
                  <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 space-y-5">
                    <h2 className="font-display text-xl font-bold text-white">
                      Pilot Configuration
                    </h2>

                    <div>
                      <label className="block text-xs font-mono text-slate-400 mb-1.5">
                        CALLSIGN IDENTIFIER
                      </label>
                      <input
                        type="text"
                        value={username}
                        maxLength={18}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm font-mono text-white focus:outline-none focus:border-cyan-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-mono text-slate-400 mb-2">
                        SHIP NEON SIGNATURE
                      </label>
                      <div className="grid grid-cols-3 gap-2.5">
                        {SHIP_COLORS.map((c) => (
                          <button
                            key={c.hex}
                            onClick={() => setSelectedColor(c.hex)}
                            className={`px-3 py-2 rounded-xl border text-xs font-mono flex items-center gap-2 transition-colors cursor-pointer ${
                              selectedColor === c.hex
                                ? 'bg-slate-800 border-white text-white'
                                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <span
                              className="w-3 h-3 rounded-full shrink-0"
                              style={{ backgroundColor: c.hex }}
                            />
                            <span className="truncate">{c.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 space-y-4">
                    <h2 className="font-display text-xl font-bold text-white">
                      Career Service Record
                    </h2>
                    <div className="grid grid-cols-2 gap-4 font-mono tabular-nums">
                      <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5">
                        <span className="text-[11px] text-slate-400 block">MATCHES PLAYED</span>
                        <span className="text-xl font-bold text-white">
                          {profile?.matchesPlayed || 0}
                        </span>
                      </div>
                      <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5">
                        <span className="text-[11px] text-slate-400 block">VICTORIES</span>
                        <span className="text-xl font-bold text-emerald-400">
                          {profile?.victories || 0}
                        </span>
                      </div>
                      <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5">
                        <span className="text-[11px] text-slate-400 block">TOTAL ELIMINATIONS</span>
                        <span className="text-xl font-bold text-cyan-400">
                          {profile?.totalKills || 0}
                        </span>
                      </div>
                      <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5">
                        <span className="text-[11px] text-slate-400 block">BOSSES DEFEATED</span>
                        <span className="text-xl font-bold text-rose-400">
                          {profile?.bossesDefeated || 0}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================ */}
          {/* GLOBAL LEADERBOARD TAB                                           */}
          {/* ================================================================ */}
          {navTab === 'LEADERBOARD' && (
            <div className="space-y-8">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
                <div>
                  <h1 className="font-display text-3xl font-bold text-white">
                    Sector Command Leaderboard
                  </h1>
                  <p className="text-sm text-slate-400 mt-1">
                    Verified server-side combat records across Co-Op Survival and Free-For-All matches.
                  </p>
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl">
                  <button
                    onClick={() => setLeaderboardFilter('ALL')}
                    className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      leaderboardFilter === 'ALL'
                        ? 'bg-cyan-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    All Modes
                  </button>
                  <button
                    onClick={() => setLeaderboardFilter('COOP_SURVIVAL')}
                    className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      leaderboardFilter === 'COOP_SURVIVAL'
                        ? 'bg-cyan-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Co-Op Survival
                  </button>
                  <button
                    onClick={() => setLeaderboardFilter('FREE_FOR_ALL')}
                    className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      leaderboardFilter === 'FREE_FOR_ALL'
                        ? 'bg-cyan-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Free-For-All
                  </button>
                </div>
              </div>

              <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-900/30">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/60 text-xs font-mono text-slate-400">
                      <th className="py-3.5 px-4">RANK</th>
                      <th className="py-3.5 px-4">PILOT CALLSIGN</th>
                      <th className="py-3.5 px-4">STARFIGHTER</th>
                      <th className="py-3.5 px-4">MODE</th>
                      <th className="py-3.5 px-4 text-right">ELIMS</th>
                      <th className="py-3.5 px-4 text-right">WAVE</th>
                      <th className="py-3.5 px-4 text-right">SCORE</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                    {leaderboard
                      .filter((entry) =>
                        leaderboardFilter === 'ALL' ? true : entry.mode === leaderboardFilter
                      )
                      .map((entry, idx) => (
                        <tr key={`${entry.pilotId}_${entry.timestamp}_${idx}`}>
                          <td className="py-3.5 px-4 text-slate-400">#{idx + 1}</td>
                          <td className="py-3.5 px-4 font-sans font-semibold text-white">
                            {entry.username} ·{' '}
                            <span className="text-xs font-mono text-slate-400">
                              LVL {entry.level}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-xs text-slate-300">
                            {SHIP_SPECS[entry.shipType]?.name || entry.shipType}
                          </td>
                          <td className="py-3.5 px-4 text-xs text-slate-400">
                            {entry.mode === 'COOP_SURVIVAL' ? 'Co-Op Survival' : 'Free-For-All'}
                          </td>
                          <td className="py-3.5 px-4 text-right text-emerald-400">{entry.kills}</td>
                          <td className="py-3.5 px-4 text-right text-slate-300">{entry.wave}</td>
                          <td className="py-3.5 px-4 text-right text-cyan-300 font-bold">
                            {entry.score.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ================================================================ */}
          {/* DEPLOYMENT (VERCEL + BACKEND) & HOW TO PLAY GUIDE                */}
          {/* ================================================================ */}
          {navTab === 'HOW_TO_PLAY' && (
            <div className="space-y-8">
              <div className="pb-6 border-b border-slate-800">
                <h1 className="font-display text-3xl font-bold text-white">
                  Vercel Deployment, Backend Setup & Operations Manual
                </h1>
                <p className="text-sm text-slate-400 mt-1">
                  How to deploy the frontend to Vercel, deploy the standalone Node.js + Socket.IO `/backend` server, and configure `VITE_BACKEND_URL`.
                </p>
              </div>

              {/* Vercel + Standalone Backend Architecture Guide */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-xl font-bold text-white flex items-center gap-2">
                    <Server className="w-5 h-5 text-cyan-400" />
                    Deploying Frontend on Vercel + Multiplayer Backend
                  </h2>
                  <span className="text-xs font-mono text-cyan-400">
                    VITE_BACKEND_URL: {configuredEnvBackendUrl || '(Not Set — Dev Mode)'}
                  </span>
                </div>
                <p className="text-sm text-slate-300 leading-relaxed">
                  Because Vercel hosts static frontends and stateless serverless functions (which do not keep persistent WebSocket game rooms alive in memory), <strong>SPACE ARENA</strong> separates the project into two clean parts:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-2">
                    <h3 className="font-display font-bold text-white text-sm">
                      Step 1: Deploy Frontend on Vercel (Works Immediately)
                    </h3>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      Import the repository root into <strong>Vercel</strong>. The included <code>vercel.json</code> automatically builds the Vite React SPA (<code>npm run build</code> → <code>dist</code>). Even before setting <code>VITE_BACKEND_URL</code>, you can play <strong>Solo Dev Mode (No Backend)</strong> on your Vercel URL.
                    </p>
                  </div>
                  <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-2">
                    <h3 className="font-display font-bold text-white text-sm">
                      Step 2: Deploy the `/backend` Folder & Set `VITE_BACKEND_URL`
                    </h3>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      Deploy the standalone <code>/backend</code> folder to <strong>Render</strong>, <strong>Railway</strong>, <strong>Fly.io</strong>, or <strong>Google Cloud Run</strong> (Root Directory: <code>backend</code>, Build: <code>npm install && npm run build</code>, Start: <code>npm start</code>). Then add <code>VITE_BACKEND_URL=https://your-backend-url.com</code> in <strong>Vercel → Project Settings → Environment Variables</strong> and redeploy.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 space-y-4">
                  <h2 className="font-display text-xl font-bold text-white">
                    01. Flight & Weapon Controls
                  </h2>
                  <ul className="space-y-2.5 text-sm text-slate-300">
                    <li>
                      <strong className="text-white font-mono">WASD / Arrow Keys:</strong> Omnidirectional vector thrusters.
                    </li>
                    <li>
                      <strong className="text-white font-mono">Mouse Cursor:</strong> 360-degree turret and nose orientation.
                    </li>
                    <li>
                      <strong className="text-white font-mono">Spacebar or Left Click:</strong> Fire primary weapon array.
                    </li>
                    <li>
                      <strong className="text-white font-mono">Shift:</strong> Engage Afterburner Boost (drains Boost energy, auto-recharges).
                    </li>
                    <li>
                      <strong className="text-white font-mono">Escape:</strong> Open tactical pause & settings overlay.
                    </li>
                  </ul>
                </div>

                <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 space-y-4">
                  <h2 className="font-display text-xl font-bold text-white">
                    02. Testing Real Two-Player Multiplayer
                  </h2>
                  <ol className="space-y-2.5 text-sm text-slate-300 list-decimal list-inside">
                    <li>
                      Open the application URL in <strong>two separate browser windows or tabs</strong> side-by-side.
                    </li>
                    <li>
                      In Window 1, click <strong>Create Room</strong> (or <strong>Play Online</strong>) and copy the 6-character Room Code shown in the lobby.
                    </li>
                    <li>
                      In Window 2, paste the Room Code on the Command Center or select the room in <strong>Multiplayer Rooms</strong>.
                    </li>
                    <li>
                      Both pilots appear live in the lobby. Click <strong>Launch Match Now</strong> on the host window to fight side-by-side or head-to-head!
                    </li>
                  </ol>
                </div>
              </div>
            </div>
          )}
        </main>
      )}

      {/* ==================================================================== */}
      {/* CREATE ROOM MODAL                                                    */}
      {/* ==================================================================== */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <form
            onSubmit={handleCreateRoom}
            className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl font-bold text-white">Create Sector Room</h2>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-xs font-mono text-slate-400 hover:text-white cursor-pointer"
              >
                Close
              </button>
            </div>

            <div>
              <label className="block text-xs font-mono text-slate-400 mb-1.5">SECTOR NAME</label>
              <input
                type="text"
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                placeholder={`${username}'s Sector`}
                maxLength={24}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-slate-400 mb-1.5">GAME MODE</label>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setNewRoomMode('COOP_SURVIVAL')}
                  className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                    newRoomMode === 'COOP_SURVIVAL'
                      ? 'bg-slate-800 border-cyan-500 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="font-display font-semibold text-sm">Co-Op Survival</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">Survive waves & bosses</div>
                </button>
                <button
                  type="button"
                  onClick={() => setNewRoomMode('FREE_FOR_ALL')}
                  className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                    newRoomMode === 'FREE_FOR_ALL'
                      ? 'bg-slate-800 border-cyan-500 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="font-display font-semibold text-sm">Free-For-All</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">PvP arena combat</div>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1.5">VISIBILITY</label>
                <select
                  value={newRoomPublic ? 'public' : 'private'}
                  onChange={(e) => setNewRoomPublic(e.target.value === 'public')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="public">Public Directory</option>
                  <option value="private">Private (Code Only)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1.5">MAX PILOTS</label>
                <select
                  value={newRoomMaxPlayers}
                  onChange={(e) => setNewRoomMaxPlayers(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500"
                >
                  {[2, 4, 6, 8].map((n) => (
                    <option key={n} value={n}>
                      {n} Players
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-6 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-sm font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Launch Lobby
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================================================================== */}
      {/* SETTINGS MODAL                                                       */}
      {/* ==================================================================== */}
      {showSettings && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl font-bold text-white">System Settings</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="text-xs font-mono text-slate-400 hover:text-white cursor-pointer"
              >
                Close
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs font-mono text-slate-300 mb-1.5">
                  <span>MASTER VOLUME</span>
                  <span>{Math.round(masterVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={masterVolume}
                  onChange={(e) => setMasterVolume(Number(e.target.value))}
                  className="w-full accent-cyan-400"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-mono text-slate-300 mb-1.5">
                  <span>SFX SYNTHESIS VOLUME</span>
                  <span>{Math.round(sfxVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={sfxVolume}
                  onChange={(e) => {
                    setSfxVolume(Number(e.target.value));
                    soundEngine.playLaser(selectedShip);
                  }}
                  className="w-full accent-cyan-400"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-sm text-slate-300">Mute All Audio</span>
                <button
                  onClick={() => setMuted(!muted)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-medium text-white flex items-center gap-2 cursor-pointer"
                >
                  {muted ? (
                    <VolumeX className="w-4 h-4 text-rose-400" />
                  ) : (
                    <Volume2 className="w-4 h-4 text-cyan-400" />
                  )}
                  {muted ? 'Audio Muted' : 'Audio Active'}
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">Reduced Visual Effects</span>
                <button
                  onClick={() => setReducedEffects(!reducedEffects)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-medium text-white cursor-pointer"
                >
                  {reducedEffects ? 'Reduced Mode On' : 'High Fidelity'}
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">Fullscreen Mode</span>
                <button
                  onClick={toggleFullscreen}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-medium text-white flex items-center gap-2 cursor-pointer"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  Toggle Fullscreen
                </button>
              </div>

              <div className="pt-3 border-t border-slate-800 text-xs font-mono text-slate-400 space-y-1">
                <div>
                  VITE_BACKEND_URL: {configuredEnvBackendUrl || '(Not set — uses same-origin / dev)'}
                </div>
                <div>
                  SOCKET STATUS: {connected ? `Connected (${pingMs}ms)` : 'Offline (Solo Dev Mode Ready)'}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setShowSettings(false)}
                className="px-6 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm rounded-xl transition-colors cursor-pointer"
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
