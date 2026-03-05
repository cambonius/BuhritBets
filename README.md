# GoLive (Twitch EventSub tracker)

Minimal service that subscribes to Twitch EventSub `stream.online` + `stream.offline` via **EventSub WebSocket** and records timestamps locally.

## Setup

1) Install deps:

```bash
npm install
```

2) Create `.env` from `.env.example` and fill:

- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`
- `BROADCASTER_IDS` (preferred) or `BROADCASTER_LOGINS`

Tip: If you only know a login, resolve it to an ID:

```bash
npm run resolve -- shroud
```

3) Run:

```bash
npm start
```

## What it does

- Connects to `wss://eventsub.wss.twitch.tv/ws`
- Creates EventSub subscriptions for each broadcaster
- Appends each received event as JSON to `data/events.jsonl`

## Endpoints

- `GET /health` -> basic status
- `GET /events?limit=50` -> last N events
