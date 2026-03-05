import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { createUser, getUserByLogin, getUserById } from './db.js';

const router = Router();

// ── Register ─────────────────────────────────────────────
router.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required.' });
    }
    if (username.length < 3 || username.length > 20 || !/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3–20 characters, letters, numbers, and underscores only.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = createUser({ username, email, passwordHash });
    req.session.userId = user.id;
    res.json({ ok: true, user });
  } catch (e) {
    if (e?.message?.includes('UNIQUE constraint')) {
      const msg = e.message.includes('username') ? 'Username already taken.' : 'Email already registered.';
      return res.status(409).json({ error: msg });
    }
    console.error('[auth] register error:', e);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

// ── Login ────────────────────────────────────────────────
router.post('/api/auth/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) {
      return res.status(400).json({ error: 'Username/email and password are required.' });
    }
    const user = getUserByLogin(login);
    if (!user) return res.status(401).json({ error: 'Invalid username or password.' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid username or password.' });

    req.session.userId = user.id;
    const { password_hash, ...safe } = user;
    res.json({ ok: true, user: safe });
  } catch (e) {
    console.error('[auth] login error:', e);
    res.status(500).json({ error: 'Login failed.' });
  }
});

// ── Logout ───────────────────────────────────────────────
router.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// ── Current user ─────────────────────────────────────────
router.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = getUserById(req.session.userId);
  res.json({ user: user || null });
});

// ── Auth middleware for protected routes ──────────────────
export function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in.' });
  next();
}

export default router;
