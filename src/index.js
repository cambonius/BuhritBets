import { config } from './lib/config.js';
import { ensureDataDir } from './lib/storage.js';
import { startServer } from './lib/server.js';
import { startEventSub } from './lib/eventsub.js';
import { getUserAccessToken, getAuthorizeUrl, getAppAccessToken } from './lib/twitchAuth.js';
import { helixGetStreams } from './lib/twitchHelix.js';

await ensureDataDir();

const serverState = {
  startedAt: new Date().toISOString(),
  eventSub: {
    connected: false,
    sessionId: null,
    subscriptions: []
  }
};

startServer(config, serverState);

// Try to load a saved user token; if none, prompt browser auth
let userToken = await getUserAccessToken(config);

if (!userToken) {
  const authUrl = getAuthorizeUrl(config);
  console.log();
  console.log('============================================================');
  console.log('  No user token found. Authorize GoLive in your browser:');
  console.log();
  console.log(`  ${authUrl}`);
  console.log();
  console.log('  Waiting for callback...');
  console.log('============================================================');
  console.log();

  // Try to open the browser automatically (best-effort)
  import('node:child_process').then(({ exec }) => {
    const cmd = process.platform === 'win32' ? `start "" "${authUrl}"`
      : process.platform === 'darwin' ? `open "${authUrl}"`
      : `xdg-open "${authUrl}"`;
    exec(cmd);
  }).catch(() => {});

  // Wait until the /auth/twitch/callback route resolves
  userToken = await serverState._waitForAuth();
}

console.log('[auth] user token ready');

// Check if Buhrito is already live before EventSub connects
try {
  const appToken = await getAppAccessToken(config);
  const logins = (config.broadcasters.logins || []);
  const ids = (config.broadcasters.ids || []);
  const streams = await helixGetStreams({ config, token: appToken, userLogins: logins, userIds: ids });
  if (streams.length > 0 && streams[0].type === 'live') {
    serverState.eventSub.isLive = true;
    serverState.eventSub.lastLiveAt = streams[0].started_at;
    console.log(`[startup] Buhrito is LIVE (started at ${streams[0].started_at})`);
  } else {
    serverState.eventSub.isLive = false;
    console.log('[startup] Buhrito is OFFLINE');
  }
} catch (e) {
  console.error('[startup] Could not check live status:', e?.message || e);
}

await startEventSub({
  config,
  userToken,
  onState: (patch) => {
    serverState.eventSub = { ...serverState.eventSub, ...patch };
  }
});
