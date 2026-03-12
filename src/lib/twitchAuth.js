import { saveToken, loadToken } from './storage.js';

// --- App Access Token (used only for resolving usernames) ---
export async function getAppAccessToken(config) {
  const url = new URL('https://id.twitch.tv/oauth2/token');
  url.searchParams.set('client_id', config.twitch.clientId);
  url.searchParams.set('client_secret', config.twitch.clientSecret);
  url.searchParams.set('grant_type', 'client_credentials');

  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get app access token (${res.status}): ${text}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error('Token response missing access_token');
  return json.access_token;
}

// --- User Access Token (required for EventSub WebSocket) ---

function getRedirectUri(config) {
  return `${config.http.baseUrl}/auth/twitch/callback`;
}

export function getAuthorizeUrl(config) {
  const url = new URL('https://id.twitch.tv/oauth2/authorize');
  url.searchParams.set('client_id', config.twitch.clientId);
  url.searchParams.set('redirect_uri', getRedirectUri(config));
  url.searchParams.set('response_type', 'code');
  // Scopes needed for EventSub + mod/VIP list access
  url.searchParams.set('scope', 'moderation:read channel:read:vips');
  return url.toString();
}

export async function exchangeCode(config, code) {
  const url = new URL('https://id.twitch.tv/oauth2/token');
  url.searchParams.set('client_id', config.twitch.clientId);
  url.searchParams.set('client_secret', config.twitch.clientSecret);
  url.searchParams.set('code', code);
  url.searchParams.set('grant_type', 'authorization_code');
  url.searchParams.set('redirect_uri', getRedirectUri(config));

  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to exchange auth code (${res.status}): ${text}`);
  }
  const json = await res.json();
  const tokenData = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000
  };
  await saveToken(tokenData);
  return tokenData;
}

export async function refreshUserToken(config) {
  const saved = await loadToken();
  if (!saved?.refresh_token) throw new Error('No refresh token stored');

  const url = new URL('https://id.twitch.tv/oauth2/token');
  url.searchParams.set('client_id', config.twitch.clientId);
  url.searchParams.set('client_secret', config.twitch.clientSecret);
  url.searchParams.set('refresh_token', saved.refresh_token);
  url.searchParams.set('grant_type', 'refresh_token');

  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to refresh token (${res.status}): ${text}`);
  }
  const json = await res.json();
  const tokenData = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000
  };
  await saveToken(tokenData);
  return tokenData;
}

export async function getUserAccessToken(config) {
  const saved = await loadToken();
  if (!saved) return null;
  // If token expires within 5 minutes, refresh it
  if (saved.expires_at && saved.expires_at - Date.now() < 5 * 60 * 1000) {
    console.log('[auth] token near expiry, refreshing...');
    const refreshed = await refreshUserToken(config);
    return refreshed.access_token;
  }
  return saved.access_token;
}
