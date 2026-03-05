import WebSocket from 'ws';
import { appendEvent } from './storage.js';
import { getAppAccessToken, getUserAccessToken, refreshUserToken } from './twitchAuth.js';
import { helixCreateEventSubSubscription, helixGetUsers } from './twitchHelix.js';
import { settleBets } from './db.js';

function nowIso() {
  return new Date().toISOString();
}

function toBroadcasterList(config) {
  const ids = (config.broadcasters.ids || []).map(String);
  const logins = (config.broadcasters.logins || []).map((x) => x.toLowerCase());
  return { ids, logins };
}

async function resolveBroadcasterIds({ config, token }) {
  const { ids, logins } = toBroadcasterList(config);
  if (ids.length > 0) return { ids, resolvedFrom: 'BROADCASTER_IDS' };
  if (logins.length === 0) {
    throw new Error('Set BROADCASTER_IDS or BROADCASTER_LOGINS in .env');
  }

  const users = await helixGetUsers({ config, token, logins });
  const resolved = users.map((u) => u.id);
  if (resolved.length === 0) {
    throw new Error('Could not resolve any broadcaster IDs from BROADCASTER_LOGINS');
  }
  return { ids: resolved, resolvedFrom: 'BROADCASTER_LOGINS' };
}

async function createSubscriptions({ config, token, sessionId, broadcasterIds }) {
  const types = ['stream.online', 'stream.offline'];
  const created = [];

  for (const broadcaster_user_id of broadcasterIds) {
    for (const type of types) {
      const body = {
        type,
        version: '1',
        condition: { broadcaster_user_id },
        transport: {
          method: 'websocket',
          session_id: sessionId
        }
      };

      const json = await helixCreateEventSubSubscription({ config, token, body });
      if (json?.data?.[0]) created.push(json.data[0]);
    }
  }
  return created;
}

export async function startEventSub({ config, userToken, onState }) {
  // Use app token just for resolving broadcaster IDs (it works for that).
  const appToken = await getAppAccessToken(config);
  const { ids: broadcasterIds } = await resolveBroadcasterIds({ config, token: appToken });

  console.log(`[eventsub] tracking broadcasters: ${broadcasterIds.join(', ')}`);

  // For EventSub WebSocket subscriptions we MUST use the user access token.
  let token = userToken;

  let wsUrl = 'wss://eventsub.wss.twitch.tv/ws';

  while (true) {
    const ws = new WebSocket(wsUrl);

    const connected = await new Promise((resolve, reject) => {
      ws.once('open', () => resolve(true));
      ws.once('error', (e) => reject(e));
    });
    if (!connected) throw new Error('WebSocket failed to connect');

    onState?.({ connected: true });
    console.log('[eventsub] websocket connected');

    const run = await new Promise((resolve) => {
      ws.on('message', async (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString('utf8'));
        } catch {
          return;
        }

        const metadata = msg?.metadata;
        const payload = msg?.payload;

        if (metadata?.message_type === 'session_welcome') {
          const session = payload?.session;
          const sessionId = session?.id;
          if (!sessionId) return;

          onState?.({ sessionId });
          console.log(`[eventsub] session_welcome: ${sessionId}`);

          try {
            const subs = await createSubscriptions({
              config,
              token,
              sessionId,
              broadcasterIds
            });
            onState?.({ subscriptions: subs.map((s) => ({ id: s.id, type: s.type, status: s.status })) });
            console.log(`[eventsub] created ${subs.length} subscriptions`);
          } catch (e) {
            console.error('[eventsub] failed creating subscriptions:', e?.message || e);
          }
          return;
        }

        if (metadata?.message_type === 'session_reconnect') {
          const reconnectUrl = payload?.session?.reconnect_url;
          if (reconnectUrl) {
            console.log('[eventsub] session_reconnect received; reconnecting');
            wsUrl = reconnectUrl;
            ws.close(1000, 'reconnect');
            return;
          }
        }

        if (metadata?.message_type === 'notification') {
          const subscriptionType = payload?.subscription?.type;
          const event = payload?.event;

          const record = {
            received_at: nowIso(),
            subscription_type: subscriptionType,
            event
          };
          await appendEvent(record);
          console.log(`[eventsub] ${subscriptionType} -> saved`);

          // Settle bets when Buhrito goes live
          if (subscriptionType === 'stream.online') {
            const liveTime = event?.started_at || nowIso();
            try {
              const settled = settleBets(liveTime);
              if (settled > 0) console.log(`[eventsub] settled ${settled} bets`);
            } catch (e) {
              console.error('[eventsub] bet settlement error:', e?.message || e);
            }
            onState?.({ lastLiveAt: liveTime, isLive: true });
          }

          if (subscriptionType === 'stream.offline') {
            onState?.({ isLive: false, lastOfflineAt: nowIso() });
          }

          return;
        }
      });

      ws.once('close', (code, reason) => {
        onState?.({ connected: false, sessionId: null, subscriptions: [] });
        console.log(`[eventsub] websocket closed (${code}) ${reason?.toString?.() || ''}`);
        resolve({ code });
      });
    });

    // Small backoff before reconnect loops.
    await new Promise((r) => setTimeout(r, Math.min(5000, run?.code === 1000 ? 200 : 1500)));
  }
}
