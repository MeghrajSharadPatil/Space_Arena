# SPACE ARENA — Real-Time Multiplayer Space Shooter

SPACE ARENA is a real-time multiplayer 2D space shooter built with **React**, **TypeScript**, **HTML5 Canvas**, **Node.js**, **Express**, and **Socket.IO**.

The project is structured so you can:
1. **Run the Frontend on Vercel** (with `vercel.json` included) and play **Solo Dev Mode** even before deploying a multiplayer backend.
2. **Deploy the Standalone Node.js + Socket.IO Backend** (`/backend` folder) to any persistent WebSocket host (Render, Railway, Fly.io, or Google Cloud Run) and connect it to your Vercel frontend via the `VITE_BACKEND_URL` environment variable.
3. **Run Both Together Locally** on port `3000` using `npm run dev`.

---

## Project Structure

- `/` (Root): React + TypeScript + Vite Frontend application (`src/`), `vercel.json` for Vercel deployment, and local full-stack dev server (`server.ts`).
- `/backend`: Standalone, deployable Node.js + TypeScript + Socket.IO multiplayer backend (`backend/package.json`, `backend/tsconfig.json`, `backend/Dockerfile`, `backend/src/server.ts`, `backend/src/gameEngine.ts`).

---

## How to Deploy Using Vercel + Standalone Multiplayer Backend

> **Why a separate backend for Vercel?**  
> Vercel is designed for static frontends and stateless serverless functions, which terminate after each request and do not maintain persistent in-memory WebSocket connections or 30Hz game loops. Therefore, the **Frontend** deploys to **Vercel**, and the **`/backend`** folder deploys to a persistent Node.js host.

### Step 1: Deploy the Frontend to Vercel (Works Immediately without Backend)

1. Push this project to a GitHub/GitLab/Bitbucket repository.
2. In **Vercel**, click **Add New → Project** and import your repository.
3. Vercel automatically detects **Vite** and uses the included `vercel.json` (`npm run build`, output directory `dist`).
4. Click **Deploy**.
5. Before you configure `VITE_BACKEND_URL`, you can click **"Solo Dev Mode (No Backend)"** on the Command Center to test all 4 ships, enemy waves, multi-phase bosses, HUD, and audio directly on your Vercel URL (with zero fake remote players).

### Step 2: Deploy the Standalone `/backend` Folder

Deploy the `/backend` folder to **Render**, **Railway**, **Fly.io**, or **Google Cloud Run**:

#### Option A: Render or Railway
1. Create a new **Web Service** connected to your repository.
2. Set **Root Directory** to `backend`.
3. Set **Build Command** to:
   ```bash
   npm install && npm run build
   ```
4. Set **Start Command** to:
   ```bash
   npm start
   ```
5. Optionally set environment variable `CORS_ORIGIN=https://your-vercel-app.vercel.app` (or `*`).
6. Copy your deployed backend URL (e.g., `https://space-arena-backend.onrender.com`).

#### Option B: Google Cloud Run (uses `/backend/Dockerfile`)
```bash
cd backend
gcloud run deploy space-arena-backend --source . --allow-unauthenticated --region us-central1
```

### Step 3: Connect Vercel to Your Deployed Backend (`VITE_BACKEND_URL`)

1. Open your **Vercel Dashboard → Project Settings → Environment Variables**.
2. Add:
   - **Key**: `VITE_BACKEND_URL`
   - **Value**: `https://your-deployed-backend-url.example.com` (no trailing slash)
3. Trigger a **Redeploy** in Vercel so Vite injects `VITE_BACKEND_URL` at build time.
4. Open your Vercel URL in **two browser windows**, create a room, share the 6-character Room Code, and play real synchronized multiplayer!

---

## Running in Local Development

### 1. Full-Stack Local Dev (Frontend + Socket.IO on Port 3000)
```bash
npm install
npm run dev
```

### 2. Frontend-Only Dev Mode (Without a Backend)
```bash
npx vite --port 3000
```
When running Vite without the backend, click **Solo Dev Mode (No Backend)** on the Command Center to test gameplay locally.
