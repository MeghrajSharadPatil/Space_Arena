import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import { GameRoom, StorageManager } from './src/server/gameEngine.ts';
import { GameMode, PlayerInput, ShipType } from './src/shared/types.ts';

const PORT = 3000;

async function startServer() {
  const app = express();
  app.use(express.json());

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  const storage = new StorageManager();
  const rooms = new Map<string, GameRoom>();
  const socketRoomMap = new Map<string, string>(); // socketId -> roomCode

  function generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 20; attempt++) {
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
      if (!rooms.has(code)) return code;
    }
    return `SA${Math.floor(1000 + Math.random() * 9000)}`;
  }

  function getPublicRoomSummaries() {
    return Array.from(rooms.values())
      .filter((r) => r.isPublic)
      .map((r) => r.getSummary());
  }

  // REST API Endpoints
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      activeRooms: rooms.size,
      connectedClients: io.engine.clientsCount,
    });
  });

  app.get('/api/rooms', (_req, res) => {
    res.json({ rooms: getPublicRoomSummaries() });
  });

  app.get('/api/leaderboard', (_req, res) => {
    res.json({ leaderboard: storage.getLeaderboard() });
  });

  app.post('/api/profile', (req, res) => {
    const { pilotId, username, shipType, color } = req.body || {};
    if (!pilotId || typeof pilotId !== 'string') {
      res.status(400).json({ error: 'pilotId is required' });
      return;
    }
    const profile = storage.getOrCreateProfile(pilotId, username, shipType, color);
    res.json({ profile });
  });

  // Socket.IO Real-Time Multiplayer Networking
  io.on('connection', (socket) => {
    socket.emit('rooms:list', getPublicRoomSummaries());

    socket.on('profile:sync', (payload: { pilotId: string; username?: string; shipType?: ShipType; color?: string }, cb?: (res: unknown) => void) => {
      if (!payload?.pilotId) return;
      const profile = storage.getOrCreateProfile(
        payload.pilotId,
        payload.username,
        payload.shipType,
        payload.color
      );
      if (cb) cb({ profile, leaderboard: storage.getLeaderboard() });
    });

    socket.on('rooms:fetch', (cb?: (res: unknown) => void) => {
      const list = getPublicRoomSummaries();
      if (cb) cb({ rooms: list });
      else socket.emit('rooms:list', list);
    });

    socket.on(
      'room:create',
      (
        payload: {
          pilotId: string;
          username: string;
          shipType: ShipType;
          color: string;
          roomName?: string;
          mode?: GameMode;
          isPublic?: boolean;
          maxPlayers?: number;
        },
        cb?: (res: { ok: boolean; roomCode?: string; error?: string }) => void
      ) => {
        leaveCurrentRoom(socket.id);
        const roomCode = generateRoomCode();
        const mode: GameMode = payload.mode === 'FREE_FOR_ALL' ? 'FREE_FOR_ALL' : 'COOP_SURVIVAL';
        const roomName = (payload.roomName || `${payload.username}'s Sector`).slice(0, 26);
        const isPublic = payload.isPublic !== false;
        const maxPlayers = payload.maxPlayers || 6;

        const room = new GameRoom(roomCode, roomName, mode, isPublic, maxPlayers, storage);
        const joinRes = room.addOrReconnectPlayer(
          socket.id,
          payload.pilotId,
          payload.username,
          payload.shipType,
          payload.color
        );

        if (!joinRes.ok) {
          if (cb) cb({ ok: false, error: joinRes.reason });
          return;
        }

        rooms.set(roomCode, room);
        socketRoomMap.set(socket.id, roomCode);
        socket.join(roomCode);

        io.to(roomCode).emit('room:state', room.consumeSnapshot());
        io.emit('rooms:list', getPublicRoomSummaries());
        if (cb) cb({ ok: true, roomCode });
      }
    );

    socket.on(
      'room:join',
      (
        payload: {
          roomCode: string;
          pilotId: string;
          username: string;
          shipType: ShipType;
          color: string;
        },
        cb?: (res: { ok: boolean; roomCode?: string; error?: string }) => void
      ) => {
        const cleanCode = (payload.roomCode || '').trim().toUpperCase();
        const room = rooms.get(cleanCode);
        if (!room) {
          if (cb) cb({ ok: false, error: `Room "${cleanCode}" not found.` });
          return;
        }

        leaveCurrentRoom(socket.id);
        const joinRes = room.addOrReconnectPlayer(
          socket.id,
          payload.pilotId,
          payload.username,
          payload.shipType,
          payload.color
        );

        if (!joinRes.ok) {
          if (cb) cb({ ok: false, error: joinRes.reason });
          return;
        }

        socketRoomMap.set(socket.id, cleanCode);
        socket.join(cleanCode);

        io.to(cleanCode).emit('room:state', room.consumeSnapshot());
        io.emit('rooms:list', getPublicRoomSummaries());
        if (cb) cb({ ok: true, roomCode: cleanCode });
      }
    );

    socket.on(
      'room:quickplay',
      (
        payload: {
          pilotId: string;
          username: string;
          shipType: ShipType;
          color: string;
          preferredMode?: GameMode;
        },
        cb?: (res: { ok: boolean; roomCode?: string; error?: string }) => void
      ) => {
        leaveCurrentRoom(socket.id);

        // Find an open public room with space
        let targetRoom = Array.from(rooms.values()).find((r) => {
          const summary = r.getSummary();
          const modeMatches = !payload.preferredMode || r.mode === payload.preferredMode;
          return r.isPublic && modeMatches && summary.playerCount < summary.maxPlayers;
        });

        if (!targetRoom) {
          const code = generateRoomCode();
          const mode: GameMode = payload.preferredMode || 'COOP_SURVIVAL';
          targetRoom = new GameRoom(
            code,
            `Sector ${code.slice(0, 4)}`,
            mode,
            true,
            8,
            storage
          );
          rooms.set(code, targetRoom);
        }

        const joinRes = targetRoom.addOrReconnectPlayer(
          socket.id,
          payload.pilotId,
          payload.username,
          payload.shipType,
          payload.color
        );

        if (!joinRes.ok) {
          if (cb) cb({ ok: false, error: joinRes.reason });
          return;
        }

        socketRoomMap.set(socket.id, targetRoom.roomCode);
        socket.join(targetRoom.roomCode);

        io.to(targetRoom.roomCode).emit('room:state', targetRoom.consumeSnapshot());
        io.emit('rooms:list', getPublicRoomSummaries());
        if (cb) cb({ ok: true, roomCode: targetRoom.roomCode });
      }
    );

    socket.on(
      'player:customize',
      (payload: { shipType?: ShipType; color?: string; username?: string; isReady?: boolean }) => {
        const roomCode = socketRoomMap.get(socket.id);
        if (!roomCode) return;
        const room = rooms.get(roomCode);
        if (!room) return;
        room.updatePlayerCustomization(
          socket.id,
          payload.shipType,
          payload.color,
          payload.username,
          payload.isReady
        );
        io.to(roomCode).emit('room:state', room.consumeSnapshot());
      }
    );

    socket.on('game:start', () => {
      const roomCode = socketRoomMap.get(socket.id);
      if (!roomCode) return;
      const room = rooms.get(roomCode);
      if (!room) return;
      room.startMatch(socket.id);
      io.to(roomCode).emit('room:state', room.consumeSnapshot());
      io.emit('rooms:list', getPublicRoomSummaries());
    });

    socket.on('player:input', (input: PlayerInput) => {
      const roomCode = socketRoomMap.get(socket.id);
      if (!roomCode) return;
      const room = rooms.get(roomCode);
      if (!room) return;
      room.handlePlayerInput(socket.id, input);
    });

    socket.on('room:leave', () => {
      leaveCurrentRoom(socket.id, true);
    });

    socket.on('ping:check', (clientTime: number, cb?: (serverTime: number) => void) => {
      if (cb) cb(clientTime);
    });

    socket.on('disconnect', () => {
      leaveCurrentRoom(socket.id, false);
    });
  });

  function leaveCurrentRoom(socketId: string, explicit = false) {
    const roomCode = socketRoomMap.get(socketId);
    if (!roomCode) return;
    socketRoomMap.delete(socketId);

    const room = rooms.get(roomCode);
    if (!room) return;

    if (explicit) {
      room.leaveExplicitly(socketId);
    } else {
      room.removeSocket(socketId);
    }

    const connectedCount = Array.from(room.players.values()).filter((p) => p.connected).length;
    if (connectedCount === 0 && room.status === 'LOBBY') {
      rooms.delete(roomCode);
    } else {
      io.to(roomCode).emit('room:state', room.consumeSnapshot());
    }
    io.emit('rooms:list', getPublicRoomSummaries());
  }

  // Server-Authoritative Simulation Loop (30 Hz tick rate)
  let lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.1, (now - lastTick) / 1000);
    lastTick = now;

    for (const [code, room] of rooms.entries()) {
      const connectedCount = Array.from(room.players.values()).filter((p) => p.connected).length;
      if (connectedCount === 0 && now - room.lastActiveTime > 60_000) {
        rooms.delete(code);
        continue;
      }

      if (room.status === 'PLAYING') {
        room.update(dt);
        io.to(code).emit('room:state', room.consumeSnapshot());
      }
    }
  }, 1000 / 30);

  // Vite Middleware (Development) or Static Dist (Production)
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`SPACE ARENA Multiplayer Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
