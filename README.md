# BuhritBets

A lightweight Node.js + Express web app that lets viewers **bet points on when a Twitch streamer goes live**. It tracks a broadcaster’s live/offline events via Twitch EventSub (WebSocket), and settles bets automatically when the stream goes online.

> Tech stack: Node.js (ESM), Express, SQLite (better-sqlite3), vanilla JS SPA + CSS.

---

## What the project does

BuhritBets provides:

- A **single-page web UI** (served from `public/`) for logging in, creating/matching bets, viewing results, and checking streamer status.
- A backend server (`src/index.js` + `src/lib/server.js`) that:
  - Handles **Twitch OAuth login** for users (session-based auth).
  - Stores users, bets, and point transactions in a local **SQLite** DB.
  - Connects to **Twitch EventSub WebSocket** to receive `stream.online` / `stream.offline` events.
  - **Settles matched bets** as soon as the streamer goes live.

---

## Why the project is useful

If you want a fun, self-hosted “channel game” for a Twitch community, BuhritBets gives you:

- **Automatic settlement** on real Twitch live events (no manual admin).
- **Head-to-head betting** (creator vs. opponent) with a clear ruleset:
  - Bet conditions: `BEFORE`, `AT (±5 min)`, `AFTER`
  - Minimum stake: **50 points**
- **Points ledger** (transactions table) so you can show history and build trust.
- **Simple deployment**: one Node process, static frontend, local SQLite file.

---

## Getting started

### Prerequisites

- **Node.js >= 18** (see `package.json` `engines.node`)
- A **Twitch Developer application** (Client ID + Client Secret)

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment

Copy the example env file:

```bash
cp .env.example .env
```

Set required values:

- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`

Optional / recommended:

- `PORT` (defaults to `3000`)
- `BASE_URL` (defaults to `http://localhost:<PORT>`)
- `BROADCASTER_IDS` or `BROADCASTER_LOGINS` (comma-separated)

The app uses `BROADCASTER_IDS` / `BROADCASTER_LOGINS` to decide which streamer(s) to track for online/offline events.

### 3) Run the app

**Dev mode (auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

Then open:

- `http://localhost:3000` (or your configured port)

### 4) Authorize EventSub tracking (first run)

On startup, if no user token is stored yet, the server prints an authorization URL and also tries to open it in your browser. Complete the Twitch authorization flow once so the app can create EventSub subscriptions.

Token storage is persisted to a local data directory (`data/token.json` by default, configurable via `DATA_DIR`).

---

## Usage overview

### Web UI (SPA)

The frontend is a vanilla JS single-page app in:

- `public/index.html`
- `public/app.js`
- `public/styles.css`

Key routes include:

- `/#/` landing page
- `/#/dashboard` main logged-in view
- `/#/bets/create` create a bet
- `/#/leaderboard` points leaderboard
- `/#/status` live/offline + connection info
- `/#/profile` user profile & avatar upload

### Backend endpoints (high level)

The server mounts:

- **Auth**
  - `GET /api/auth/twitch` – start Twitch OAuth
  - `GET /api/auth/twitch/callback` – OAuth callback (logs user in)
  - `POST /api/auth/logout` – end session
  - `GET /api/auth/me` – current logged-in user
  - `POST /api/auth/avatar` – upload avatar image (multipart form)

- **Bets**
  - `POST /api/bets` – create bet (requires session)
  - `POST /api/bets/:id/match` – match a bet (requires session)
  - `POST /api/bets/:id/cancel` – cancel your open bet (requires session)
  - `GET /api/bets` – list bets
  - `GET /api/bets/:id` – get bet detail
  - `GET /api/activity` – recent transactions/activity
  - `GET /api/leaderboard` – top users by points
  - `GET /api/me/transactions` – current user transaction history

- **Operational**
  - `GET /health` – basic process state (startup time, EventSub state)
  - `GET /events` – tail recent EventSub notifications from `events.jsonl`
  - `GET /api/streamer-status` – compact status for the UI
  - `GET /api/emotes` – fetches channel emotes from Twitch + BTTV + 7TV (cached)

---

## Useful scripts

From `package.json`:

- `npm start` – run the server (`node src/index.js`)
- `npm run dev` – run with Node’s watch mode (`node --watch src/index.js`)
- `npm run resolve -- <twitch_login>` – helper to resolve a Twitch login to a user ID using Helix

Example:

```bash
npm run resolve -- buhrito
```

---

## Data & storage

By default the app creates a `data/` directory (configurable via `DATA_DIR`) and stores:

- `data/buhritbets.db` – SQLite database (users, bets, transactions)
- `data/events.jsonl` – EventSub notifications (append-only JSON Lines)
- `data/token.json` – stored user token for EventSub WebSocket subscriptions
- `data/uploads/` – uploaded avatars

---

## Where to get help

- Check `.env.example` for expected environment variables and setup hints.
- If Twitch auth is failing, confirm:
  - `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` are correct
  - `BASE_URL` matches your actual local/public URL
  - Your Twitch app’s OAuth redirect URL(s) include the callback paths used by this app

If you’re stuck, open an issue in the repository with:

- what you were trying to do,
- your OS + Node version,
- relevant logs (redact secrets),
- and your `.env` keys (values removed).

---

## Maintainers & contributing

- Maintainer: **@cambonius**

Contributions are welcome. If the repo includes contribution docs, follow them:

- `CONTRIBUTING.md` (if present)

General guidelines:
- Keep changes small and focused.
- Prefer simple, dependency-light solutions (the project is intentionally lightweight).
- When adding endpoints/UI flows, include a short note in the README or relevant docs about how to use them.

---

## License

See `LICENSE` (if present) for details.