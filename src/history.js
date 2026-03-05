// Fetches all of Buhrito's past broadcasts from the last month using the Helix API.
// Usage: node src/history.js

import { config } from './lib/config.js';
import { getAppAccessToken } from './lib/twitchAuth.js';
import { helixGetUsers } from './lib/twitchHelix.js';
import { ensureDataDir } from './lib/storage.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const ONE_MONTH_AGO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

async function fetchVideos({ config, token, userId, cursor }) {
  const url = new URL('https://api.twitch.tv/helix/videos');
  url.searchParams.set('user_id', userId);
  url.searchParams.set('type', 'archive');   // past broadcasts only
  url.searchParams.set('first', '100');
  if (cursor) url.searchParams.set('after', cursor);

  const res = await fetch(url, {
    headers: {
      'Client-Id': config.twitch.clientId,
      Authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Helix /videos failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function main() {
  await ensureDataDir();

  const token = await getAppAccessToken(config);

  // Resolve broadcaster
  const login = 'buhrito';
  const users = await helixGetUsers({ config, token, logins: [login] });
  if (!users.length) {
    console.error(`Could not find Twitch user: ${login}`);
    process.exit(1);
  }
  const user = users[0];
  console.log(`User: ${user.display_name} (ID ${user.id})\n`);

  // Paginate through VODs
  const allVods = [];
  let cursor = null;
  let done = false;

  while (!done) {
    const json = await fetchVideos({ config, token, userId: user.id, cursor });
    const videos = json.data || [];

    for (const v of videos) {
      const createdAt = new Date(v.created_at);
      if (createdAt < ONE_MONTH_AGO) {
        done = true;
        break;
      }
      allVods.push({
        title: v.title,
        went_live_at: v.created_at,
        duration: v.duration,
        url: v.url,
        view_count: v.view_count
      });
    }

    cursor = json.pagination?.cursor;
    if (!cursor || videos.length === 0) break;
  }

  if (allVods.length === 0) {
    console.log('No past broadcasts found in the last 30 days.');
    console.log('(Buhrito may not have VODs enabled, or hasn\'t streamed recently.)');
    return;
  }

  // Sort oldest first
  allVods.sort((a, b) => new Date(a.went_live_at) - new Date(b.went_live_at));

  // Print to console
  console.log(`=== Past broadcasts (last 30 days): ${allVods.length} ===\n`);
  for (const v of allVods) {
    const d = new Date(v.went_live_at);
    const dateStr = d.toLocaleDateString('en-US', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
    });
    const timeStr = d.toLocaleTimeString('en-US');
    console.log(`  ${dateStr}  ${timeStr}  (${v.duration})`);
    console.log(`    "${v.title}"`);
    console.log(`    ${v.url}\n`);
  }

  // Save to data/history.json
  const outPath = path.resolve(process.cwd(), 'data', 'history.json');
  await fs.writeFile(outPath, JSON.stringify({ user: user.display_name, fetched_at: new Date().toISOString(), broadcasts: allVods }, null, 2), 'utf8');
  console.log(`Saved to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
