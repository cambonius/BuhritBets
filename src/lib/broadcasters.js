import { config } from './config.js';
import { getAppAccessToken, getUserAccessToken } from './twitchAuth.js';
import { helixGetUsers, helixGetModerators, helixGetChannelVips } from './twitchHelix.js';
import { getBroadcasterSettings, getUserById } from './db.js';

// ── Resolved broadcaster IDs (cached after first resolution) ──
let resolvedBroadcasterIds = null;

export async function getResolvedBroadcasterIds() {
  if (resolvedBroadcasterIds) return resolvedBroadcasterIds;

  const ids = [...(config.broadcasters.ids || [])];
  const logins = config.broadcasters.logins || [];

  if (logins.length) {
    try {
      const token = await getAppAccessToken(config);
      const users = await helixGetUsers({ config, token, logins });
      for (const u of users) {
        if (!ids.includes(u.id)) ids.push(u.id);
      }
    } catch (e) {
      console.error('[broadcasters] Failed to resolve logins:', e?.message);
    }
  }

  resolvedBroadcasterIds = ids;
  return ids;
}

export async function isBroadcaster(twitchId) {
  if (!twitchId) return false;
  const ids = await getResolvedBroadcasterIds();
  return ids.includes(twitchId);
}

// ── Mod / VIP cache ──────────────────────────────────────
const modCache = new Map();
const vipCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getCachedMods(broadcasterId) {
  const cached = modCache.get(broadcasterId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return cached.ids;

  try {
    const token = await getUserAccessToken(config);
    if (!token) return cached?.ids || new Set();
    const mods = await helixGetModerators({ config, token, broadcasterId });
    const ids = new Set(mods.map(m => m.user_id));
    modCache.set(broadcasterId, { ids, fetchedAt: Date.now() });
    return ids;
  } catch (e) {
    console.error('[broadcasters] Failed to fetch mods:', e?.message);
    return cached?.ids || new Set();
  }
}

async function getCachedVips(broadcasterId) {
  const cached = vipCache.get(broadcasterId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return cached.ids;

  try {
    const token = await getUserAccessToken(config);
    if (!token) return cached?.ids || new Set();
    const vips = await helixGetChannelVips({ config, token, broadcasterId });
    const ids = new Set(vips.map(v => v.user_id));
    vipCache.set(broadcasterId, { ids, fetchedAt: Date.now() });
    return ids;
  } catch (e) {
    console.error('[broadcasters] Failed to fetch VIPs:', e?.message);
    return cached?.ids || new Set();
  }
}

// ── Bet eligibility check ────────────────────────────────
export async function canUserBet(userId) {
  const user = getUserById(userId);
  if (!user?.twitch_id) return { allowed: true };

  const broadcasterIds = await getResolvedBroadcasterIds();

  // Streamers cannot bet on their own streams
  if (broadcasterIds.includes(user.twitch_id)) {
    return { allowed: false, reason: 'Streamers cannot place bets on their own streams.' };
  }

  // Check mod/VIP restrictions for each broadcaster
  for (const bid of broadcasterIds) {
    const settings = getBroadcasterSettings(bid);

    if (!settings.allow_mod_bets) {
      const mods = await getCachedMods(bid);
      if (mods.has(user.twitch_id)) {
        return { allowed: false, reason: 'Moderators are not allowed to place bets.' };
      }
    }

    if (!settings.allow_vip_bets) {
      const vips = await getCachedVips(bid);
      if (vips.has(user.twitch_id)) {
        return { allowed: false, reason: 'VIPs are not allowed to place bets.' };
      }
    }
  }

  return { allowed: true };
}
