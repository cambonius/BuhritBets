import { Router } from 'express';
import { requireAuth } from './authRoutes.js';
import {
  createBet, matchBet, cancelBet, getBetById,
  listBets, getRecentActivity, getUserTransactions,
  getLeaderboard, getUserById
} from './db.js';

const router = Router();

// ── Create bet ───────────────────────────────────────────
router.post('/api/bets', requireAuth, (req, res) => {
  try {
    const { condition, targetTime, stake, note } = req.body;
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
router.post('/api/bets/:id/match', requireAuth, (req, res) => {
  try {
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

export default router;
