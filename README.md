# SPACE ARENA — Real-Time Multiplayer Space Shooter

SPACE ARENA is a real-time multiplayer 2D space combat game built with **React**, **TypeScript**, **HTML5 Canvas**, **Node.js**, **Express**, and **Socket.IO**. It supports 2–8 concurrent browser players per room with a server-authoritative 30Hz physics, collision, wave spawning, and enemy AI simulation.

---

## Features

1. **Real-Time Socket.IO Multiplayer Architecture**:
   - Server-authoritative simulation (`src/server/gameEngine.ts` + `server.ts`) validating movement, boost energy, weapon cooldowns, projectile collisions, and scoring.
   - Isolated room state supporting Public and Private rooms with unique 6-character codes.
   - Automatic reconnection support, host migration on disconnect, and client-side entity interpolation for smooth 60 FPS rendering.
2. **Two Game Modes**:
   - **Co-Op Survival**: Players team up across 10 escalating enemy waves and multi-phase boss fights (`Aegis Cruiser`, `Overlord MK-IX`, `Void Leviathan`).
   - **Free-For-All**: Competitive player-versus-player arena combat with server-validated PvP damage and neutral bounty targets.
3. **Four Playable Starfighter Classes**:
   - **Vanguard MK-IV**: Balanced interceptor with twin pulse cannons.
   - **Phantom X-9**: High-velocity recon fighter with rapid needle blasters.
   - **Titan Bastion**: Heavy dreadnought with triple-arc plasma scatter cannons.
   - **Nova Singularity**: Energy specialist firing piercing photon lances with rapid harmonic shield regeneration.
4. **Server-Controlled Enemy AI**:
   - **Dart Scout** (weaving flanker), **Viper Stalker** (player chaser), **Pulse Marksman** (standoff ranged sniper), **Goliath Enforcer** (heavy dual-cannon armor), **Volatile Drone** (exploding kamikaze), and **Multi-Phase Bosses**.

---

## Development & Installation

```bash
# 1. Install dependencies
npm install

# 2. Start the full-stack server (Express + Socket.IO + Vite on port 3000)
npm run dev
```

---

## How to Test Multiplayer with Two Browser Windows

1. Open the running application URL in **Window A** and **Window B** (two side-by-side browser windows or tabs).
2. In **Window A**, click **Create Room** (or **Play Co-Op Survival**). Copy the 6-character **Room Code** displayed in the top-right of the lobby.
3. In **Window B**, enter the 6-character **Room Code** on the Command Center and click **Join Room by Code** (or click **Join** in the live **Multiplayer Rooms** list).
4. Verify that both pilots appear in the lobby table and can customize their ship class and neon color in real time.
5. In **Window A** (Host), click **Launch Match Now**. Both browser windows enter the synchronized battlefield simultaneously.

---

## Production Build & Deployment

```bash
# Build frontend assets into dist/
npm run build

# Start the production Node.js + Socket.IO server on port 3000
npm start
```

### Connecting to a Separate External Backend (Optional)

By default, the frontend connects to the same origin (`window.location.origin`) where `server.ts` hosts both HTTP and WebSocket traffic. If you deploy the backend separately, set `VITE_BACKEND_URL` in your `.env` file:

```env
VITE_BACKEND_URL="https://your-multiplayer-backend.example.com"
```
