import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import { readLastEvents } from './storage.js';
import { exchangeCode, getAppAccessToken } from './twitchAuth.js';
import { helixGetUsers } from './twitchHelix.js';
import authRoutes from './authRoutes.js';
import betsRoutes from './betsRoutes.js';
import { getDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../../public');

export function startServer(config, state) {
  const app = express();

  // Initialize database
  getDb();

  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  // Sessions
  app.use(session({
    secret: config.twitch.clientSecret, // reuse for simplicity
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 }
  }));

  // API routes
  app.use(authRoutes);
  app.use(betsRoutes);

  // Serve the dashboard HTML
  app.use(express.static(publicDir));

  // Serve uploaded avatars
  const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
  const uploadsDir = path.join(dataDir, 'uploads');
  app.use('/uploads', express.static(uploadsDir));

  // Resolve function set by index.js once auth completes
  let authResolve = null;
  state._waitForAuth = () => new Promise((resolve) => { authResolve = resolve; });

  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      startedAt: state.startedAt,
      eventSub: state.eventSub
    });
  });

  app.get('/events', async (req, res) => {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 50)));
    const events = await readLastEvents(limit);
    res.json({ limit, count: events.length, events });
  });

  // ── Emotes endpoint (cached) ──────────────────────────
  let emoteCache = null;
  let emoteCacheTime = 0;
  const EMOTE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

  app.get('/api/emotes', async (req, res) => {
    try {
      if (emoteCache && Date.now() - emoteCacheTime < EMOTE_CACHE_TTL) {
        return res.json(emoteCache);
      }
      const token = await getAppAccessToken(config);
      // Resolve broadcaster ID
      const logins = config.broadcasters.logins || [];
      const ids = config.broadcasters.ids || [];
      let broadcasterId = ids[0];
      if (!broadcasterId && logins.length) {
        const users = await helixGetUsers({ config, token, logins });
        if (users.length) broadcasterId = users[0].id;
      }
      if (!broadcasterId) return res.json({ emotes: [] });

      // Fetch all emote sources in parallel
      const [twitchEmotes, bttvEmotes, sevenTvEmotes] = await Promise.all([
        // ── Twitch channel emotes ──
        (async () => {
          try {
            const r = await fetch(`https://api.twitch.tv/helix/chat/emotes?broadcaster_id=${broadcasterId}`, {
              headers: { 'Client-Id': config.twitch.clientId, Authorization: `Bearer ${token}` }
            });
            const d = await r.json();
            return (d.data || []).map(e => ({
              name: e.name, id: e.id, source: 'twitch',
              url_1x: `https://static-cdn.jtvnw.net/emoticons/v2/${e.id}/default/dark/1.0`,
              url_2x: `https://static-cdn.jtvnw.net/emoticons/v2/${e.id}/default/dark/2.0`,
              url_4x: `https://static-cdn.jtvnw.net/emoticons/v2/${e.id}/default/dark/3.0`
            }));
          } catch (err) { console.error('[emotes:twitch]', err?.message); return []; }
        })(),
        // ── BTTV channel + shared emotes ──
        (async () => {
          try {
            const r = await fetch(`https://api.betterttv.net/3/cached/users/twitch/${broadcasterId}`);
            if (!r.ok) return [];
            const d = await r.json();
            const all = [...(d.channelEmotes || []), ...(d.sharedEmotes || [])];
            return all.map(e => ({
              name: e.code, id: e.id, source: 'bttv',
              url_1x: `https://cdn.betterttv.net/emote/${e.id}/1x`,
              url_2x: `https://cdn.betterttv.net/emote/${e.id}/2x`,
              url_4x: `https://cdn.betterttv.net/emote/${e.id}/3x`
            }));
          } catch (err) { console.error('[emotes:bttv]', err?.message); return []; }
        })(),
        // ── 7TV channel emotes ──
        (async () => {
          try {
            const r = await fetch(`https://7tv.io/v3/users/twitch/${broadcasterId}`);
            if (!r.ok) return [];
            const d = await r.json();
            const emoteSet = d.emote_set?.emotes || [];
            return emoteSet.map(e => {
              const host = e.data?.host;
              const baseUrl = host ? `https:${host.url}` : `https://cdn.7tv.app/emote/${e.id}`;
              // Pick the best available file (prefer WEBP)
              const files = host?.files || [];
              const pick = (w) => files.find(f => f.name === `${w}.webp`) || files.find(f => f.name === `${w}.png`);
              const f1 = pick('1x'), f2 = pick('2x'), f4 = pick('4x') || pick('3x');
              return {
                name: e.name, id: e.id, source: '7tv',
                url_1x: f1 ? `${baseUrl}/${f1.name}` : `${baseUrl}/1x.webp`,
                url_2x: f2 ? `${baseUrl}/${f2.name}` : `${baseUrl}/2x.webp`,
                url_4x: f4 ? `${baseUrl}/${f4.name}` : `${baseUrl}/4x.webp`
              };
            });
          } catch (err) { console.error('[emotes:7tv]', err?.message); return []; }
        })()
      ]);

      // Merge all (Twitch first, then 7TV, then BTTV — first one wins on name collision)
      const seen = new Set();
      const emotes = [];
      for (const e of [...twitchEmotes, ...sevenTvEmotes, ...bttvEmotes]) {
        if (!seen.has(e.name)) { seen.add(e.name); emotes.push(e); }
      }

      console.log(`[emotes] loaded ${twitchEmotes.length} twitch, ${sevenTvEmotes.length} 7tv, ${bttvEmotes.length} bttv (${emotes.length} total)`);

      emoteCache = { emotes };
      emoteCacheTime = Date.now();
      res.json(emoteCache);
    } catch (e) {
      console.error('[emotes]', e?.message || e);
      res.json({ emotes: [] });
    }
  });

  // Streamer status for the UI
  app.get('/api/streamer-status', (req, res) => {
    res.json({
      isLive: state.eventSub.isLive || false,
      lastLiveAt: state.eventSub.lastLiveAt || null,
      lastOfflineAt: state.eventSub.lastOfflineAt || null,
      connected: state.eventSub.connected || false
    });
  });

  // OAuth callback from Twitch
  app.get('/auth/twitch/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) {
      return res.status(400).send('Missing ?code from Twitch');
    }
    try {
      const tokenData = await exchangeCode(config, code);
      res.send('<h2>Authorized!</h2><p>You can close this tab. GoLive is now tracking.</p>');
      console.log('[auth] user token saved');
      if (authResolve) authResolve(tokenData.access_token);
    } catch (e) {
      console.error('[auth] code exchange failed:', e?.message || e);
      res.status(500).send('Token exchange failed: ' + (e?.message || e));
    }
  });

  // SPA fallback — serve index.html for all non-API/non-file routes
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) return res.status(404).json({ error: 'Not found' });
    // Don't serve index.html for requests with a file extension (e.g. .png, .js, .css)
    if (path.extname(req.path)) return res.status(404).end();
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.listen(config.http.port, () => {
    console.log(`[http] listening on :${config.http.port}`);
  });
}
