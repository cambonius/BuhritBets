import { Router } from 'express';
import { requireAuth } from './authRoutes.js';
import {
  createBet, matchBet, cancelBet, getBetById,
  listBets, getRecentActivity, getUserTransactions,
  getLeaderboard, getUserById, getBroadcasterSettings, upsertBroadcasterSettings
} from './db.js';
import { canUserBet, isBroadcaster, getResolvedBroadcasterIds } from './broadcasters.js';

const router = Router();

// ── Create bet ───────────────────────────────────────────
router.post('/api/bets', requireAuth, async (req, res) => {
  try {
    const check = await canUserBet(req.session.userId);
    if (!check.allowed) return res.status(403).json({ error: check.reason });

    const { condition, targetTime, stake, note, title } = req.body;
    if (!condition || !targetTime || !stake) {
      return res.status(400).json({ error: 'Condition, targetTime, and stake are required.' });
    }
    if (!['BEFORE', 'AT', 'AFTER'].includes(condition)) {
      return res.status(400).json({ error: 'Condition must be BEFORE, AT, or AFTER.' });
    }
    if (Number(stake) < 50) {
      return res.status(400).json({ error: 'Minimum bet is 50 points.' });
    }
    const target = new Date(targetTime);
    if (isNaN(target.getTime()) || target.getTime() < Date.now()) {
      return res.status(400).json({ error: 'Target time must be a valid future time.' });
    }

    const bet = createBet({
      creatorId: req.session.userId,
      title: title ? String(title).slice(0, 60) : null,
      condition,
      targetTime: target.toISOString(),
      stake: Number(stake),
      note: note ? String(note).slice(0, 80) : null
    });
    res.json({ ok: true, bet });
  } catch (e) {
    res.status(400).json({ error: e?.message || 'Failed to create bet.' });
  }
});

// ── Match bet ────────────────────────────────────────────
router.post('/api/bets/:id/match', requireAuth, async (req, res) => {
  try {
    const check = await canUserBet(req.session.userId);
    if (!check.allowed) return res.status(403).json({ error: check.reason });

    const bet = matchBet(Number(req.params.id), req.session.userId);
    res.json({ ok: true, bet });
  } catch (e) {
    res.status(400).json({ error: e?.message || 'Failed to match bet.' });
  }
});

// ── Cancel bet ───────────────────────────────────────────
router.post('/api/bets/:id/cancel', requireAuth, (req, res) => {
  try {
    const bet = cancelBet(Number(req.params.id), req.session.userId);
    res.json({ ok: true, bet });
  } catch (e) {
    res.status(400).json({ error: e?.message || 'Failed to cancel bet.' });
  }
});

// ── Get single bet ───────────────────────────────────────
router.get('/api/bets/:id', (req, res) => {
  const bet = getBetById(Number(req.params.id));
  if (!bet) return res.status(404).json({ error: 'Bet not found.' });
  res.json({ bet });
});

// ── List bets ────────────────────────────────────────────
router.get('/api/bets', (req, res) => {
  const { status, mine, limit, offset } = req.query;
  const opts = {
    status: status || undefined,
    userId: mine === '1' ? req.session?.userId : undefined,
    limit: Math.min(100, Number(limit) || 50),
    offset: Number(offset) || 0
  };
  const bets = listBets(opts);
  res.json({ bets });
});

// ── Recent activity feed ─────────────────────────────────
router.get('/api/activity', (req, res) => {
  const activity = getRecentActivity(Number(req.query.limit) || 20);
  res.json({ activity });
});

// ── User profile ─────────────────────────────────────────
router.get('/api/users/:id', (req, res) => {
  const user = getUserById(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user });
});

// ── User transactions ────────────────────────────────────
router.get('/api/users/:id/transactions', (req, res) => {
  const txns = getUserTransactions(Number(req.params.id), Number(req.query.limit) || 50);
  res.json({ transactions: txns });
});

// ── My transactions (shortcut) ───────────────────────────
router.get('/api/me/transactions', requireAuth, (req, res) => {
  const txns = getUserTransactions(req.session.userId, Number(req.query.limit) || 50);
  res.json({ transactions: txns });
});

// ── Leaderboard ──────────────────────────────────────────
router.get('/api/leaderboard', (req, res) => {
  const leaders = getLeaderboard(Number(req.query.limit) || 20);
  res.json({ leaderboard: leaders });
});

// ── Broadcaster settings ─────────────────────────────────
router.get('/api/broadcaster/settings', requireAuth, async (req, res) => {
  try {
    const user = getUserById(req.session.userId);
    if (!user?.twitch_id || !(await isBroadcaster(user.twitch_id))) {
      return res.status(403).json({ error: 'Only broadcasters can access settings.' });
    }
    const settings = getBroadcasterSettings(user.twitch_id);
    res.json({ settings: { allow_mod_bets: !!settings.allow_mod_bets, allow_vip_bets: !!settings.allow_vip_bets } });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load settings.' });
  }
});

router.put('/api/broadcaster/settings', requireAuth, async (req, res) => {
  try {
    const user = getUserById(req.session.userId);
    if (!user?.twitch_id || !(await isBroadcaster(user.twitch_id))) {
      return res.status(403).json({ error: 'Only broadcasters can change settings.' });
    }
    const { allow_mod_bets, allow_vip_bets } = req.body;
    const settings = upsertBroadcasterSettings(user.twitch_id, {
      allowModBets: allow_mod_bets,
      allowVipBets: allow_vip_bets
    });
    res.json({ ok: true, settings: { allow_mod_bets: !!settings.allow_mod_bets, allow_vip_bets: !!settings.allow_vip_bets } });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update settings.' });
  }
});

export default router;
