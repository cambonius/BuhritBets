import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createOrUpdateTwitchUser, getUserById, updateUserAvatar } from './db.js';
import { config } from './config.js';
import { isBroadcaster } from './broadcasters.js';

const router = Router();

// ── Avatar upload setup ──────────────────────────────────
const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const uploadsDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `avatar-${req.session.userId}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  }
});
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only image files (jpg, png, gif, webp) are allowed.'));
  }
});

// ── Twitch OAuth Login ───────────────────────────────────
function getUserRedirectUri() {
  return `${config.http.baseUrl}/api/auth/twitch/callback`;
}

router.get('/api/auth/twitch', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const url = new URL('https://id.twitch.tv/oauth2/authorize');
  url.searchParams.set('client_id', config.twitch.clientId);
  url.searchParams.set('redirect_uri', getUserRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'user:read:email');
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

router.get('/api/auth/twitch/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.status(400).send('Missing code from Twitch.');
    if (!state || state !== req.session.oauthState) {
      return res.status(403).send('Invalid OAuth state.');
    }
    delete req.session.oauthState;

    // Exchange code for access token
    const tokenUrl = new URL('https://id.twitch.tv/oauth2/token');
    tokenUrl.searchParams.set('client_id', config.twitch.clientId);
    tokenUrl.searchParams.set('client_secret', config.twitch.clientSecret);
    tokenUrl.searchParams.set('code', code);
    tokenUrl.searchParams.set('grant_type', 'authorization_code');
    tokenUrl.searchParams.set('redirect_uri', getUserRedirectUri());

    const tokenRes = await fetch(tokenUrl, { method: 'POST' });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      throw new Error(`Token exchange failed (${tokenRes.status}): ${text}`);
    }
    const tokenData = await tokenRes.json();

    // Fetch Twitch user profile
    const userRes = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Client-Id': config.twitch.clientId,
        Authorization: `Bearer ${tokenData.access_token}`
      }
    });
    if (!userRes.ok) throw new Error('Failed to fetch Twitch user info.');
    const userData = await userRes.json();
    const twitchUser = userData.data?.[0];
    if (!twitchUser) throw new Error('No Twitch user data returned.');

    // Create or update local user
    const user = createOrUpdateTwitchUser({
      twitchId: twitchUser.id,
      username: twitchUser.display_name,
      email: twitchUser.email || null,
      avatarUrl: twitchUser.profile_image_url || null
    });

    req.session.userId = user.id;
    res.redirect('/#/dashboard');
  } catch (e) {
    console.error('[auth] Twitch callback error:', e?.message || e);
    res.redirect('/#/login?error=' + encodeURIComponent(e?.message || 'Login failed'));
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
router.get('/api/auth/me', async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = getUserById(req.session.userId);
  if (!user) return res.json({ user: null });
  const is_broadcaster = await isBroadcaster(user.twitch_id);
  res.json({ user: { ...user, is_broadcaster } });
});

// ── Avatar upload ────────────────────────────────────────
router.post('/api/auth/avatar', (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in.' });
  next();
}, avatarUpload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const avatarPath = `/uploads/${req.file.filename}`;
  const user = updateUserAvatar(req.session.userId, avatarPath);
  res.json({ ok: true, user });
}, (err, req, res, next) => {
  res.status(400).json({ error: err?.message || 'Upload failed.' });
});

// ── Auth middleware for protected routes ──────────────────
export function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in.' });
  next();
}

export default router;
