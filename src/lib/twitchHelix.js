async function helixFetch({ config, token, path, query }) {
  const url = new URL(`https://api.twitch.tv/helix/${path}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (Array.isArray(v)) {
      for (const vv of v) url.searchParams.append(k, vv);
    } else if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url, {
    headers: {
      'Client-Id': config.twitch.clientId,
      Authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Helix ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function helixGetUsers({ config, token, ids = [], logins = [] }) {
  const json = await helixFetch({
    config,
    token,
    path: 'users',
    query: {
      id: ids,
      login: logins
    }
  });
  return json.data || [];
}

export async function helixGetStreams({ config, token, userLogins = [], userIds = [] }) {
  const query = {};
  if (userLogins.length) query.user_login = userLogins;
  if (userIds.length) query.user_id = userIds;
  const json = await helixFetch({ config, token, path: 'streams', query });
  return json.data || [];
}

export async function helixCreateEventSubSubscription({ config, token, body }) {
  const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      'Client-Id': config.twitch.clientId,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const details = json ? JSON.stringify(json) : await res.text();
    throw new Error(`EventSub subscription failed (${res.status}): ${details}`);
  }
  return json;
}

export async function helixGetModerators({ config, token, broadcasterId }) {
  let all = [];
  let cursor = null;
  do {
    const query = { broadcaster_id: broadcasterId, first: '100' };
    if (cursor) query.after = cursor;
    const json = await helixFetch({ config, token, path: 'moderation/moderators', query });
    all = all.concat(json.data || []);
    cursor = json.pagination?.cursor;
  } while (cursor);
  return all;
}

export async function helixGetChannelVips({ config, token, broadcasterId }) {
  let all = [];
  let cursor = null;
  do {
    const query = { broadcaster_id: broadcasterId, first: '100' };
    if (cursor) query.after = cursor;
    const json = await helixFetch({ config, token, path: 'channels/vips', query });
    all = all.concat(json.data || []);
    cursor = json.pagination?.cursor;
  } while (cursor);
  return all;
}
