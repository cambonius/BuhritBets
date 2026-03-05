/* ============================================================
   BuhritBets — Client-Side SPA
   ============================================================ */

// ── State ────────────────────────────────────────────────
let currentUser = null;
let streamerStatus = { isLive: false, lastLiveAt: null, connected: false };
let emoteMap = {}; // name -> { url_1x, url_2x, url_4x }

const $ = (sel) => document.querySelector(sel);
const $app = () => $('#app');

// ── API helpers ──────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Request failed');
  return json;
}

// ── Toast notifications ──────────────────────────────────
function toast(message, type = 'info') {
  const container = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// ── Modal ────────────────────────────────────────────────
function openModal(html) {
  $('#modalContent').innerHTML = html;
  $('#modalOverlay').classList.remove('hidden');
}
function closeModal(e) {
  if (e && e.target !== $('#modalOverlay')) return;
  $('#modalOverlay').classList.add('hidden');
}
window.closeModal = closeModal;

// ── Formatting helpers ───────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    + '  ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function fmtDateFull(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    + '  ' + d.toLocaleTimeString();
}
function fmtUTC(iso) {
  if (!iso) return '';
  return 'UTC: ' + new Date(iso).toISOString();
}
function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// ── Emote rendering ──────────────────────────────────────
async function loadEmotes() {
  try {
    const data = await api('/api/emotes');
    emoteMap = {};
    for (const e of (data.emotes || [])) {
      emoteMap[e.name] = e;
    }
    console.log(`[emotes] loaded ${Object.keys(emoteMap).length} emotes`);
  } catch { /* ignore */ }
}

/**
 * Replace :emoteName: patterns in already-escaped HTML with inline emote images.
 * Also replaces bare emote names (e.g. buhritWholesome) when they match exactly.
 */
function emoteify(html) {
  if (!html || !Object.keys(emoteMap).length) return html;
  // Replace :emoteName: syntax
  html = html.replace(/:([a-zA-Z0-9_]+):/g, (match, name) => {
    const e = emoteMap[name];
    if (!e) return match;
    return `<img class="emote" src="${e.url_1x}" srcset="${e.url_2x} 2x, ${e.url_4x} 4x" alt="${name}" title=":${name}:">`;
  });
  return html;
}

/**
 * Walk all text nodes inside a container and replace :emoteName: with <img> tags.
 * This runs after every page render so ALL :emote: patterns get processed automatically.
 */
function applyEmotes(container) {
  if (!container || !Object.keys(emoteMap).length) return;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const node of textNodes) {
    if (/:([a-zA-Z0-9_]+):/.test(node.textContent)) {
      const replaced = emoteify(esc(node.textContent));
      // Only swap if emoteify actually produced an <img>
      if (replaced !== esc(node.textContent)) {
        const span = document.createElement('span');
        span.innerHTML = replaced;
        node.parentNode.replaceChild(span, node);
      }
    }
  }
}
function conditionText(cond) {
  if (cond === 'BEFORE') return 'BEFORE';
  if (cond === 'AFTER') return 'AFTER';
  return 'AT (±5 min)';
}
function badgeClass(status, winnerId) {
  if (status === 'open') return 'badge-open';
  if (status === 'matched') return 'badge-matched';
  if (status === 'canceled') return 'badge-canceled';
  if (status === 'settled') return winnerId === currentUser?.id ? 'badge-settled' : 'badge-lost';
  return 'badge-open';
}
function badgeLabel(status, winnerId) {
  if (status === 'settled') return winnerId === currentUser?.id ? 'WON' : 'LOST';
  return status.toUpperCase();
}
function tz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; }
}

// ── Router ───────────────────────────────────────────────
function getHash() {
  return location.hash.slice(1) || '/';
}

const routes = {
  '/': pageLanding,
  '/signup': pageSignup,
  '/login': pageLogin,
  '/dashboard': pageDashboard,
  '/bets/create': pageCreateBet,
  '/profile': pageProfile,
  '/status': pageStatus,
  '/leaderboard': pageLeaderboard,
};

async function router() {
  const hash = getHash();

  // Dynamic routes: /bets/:id
  const betMatch = hash.match(/^\/bets\/(\d+)$/);
  if (betMatch) {
    await pageBetDetail(betMatch[1]);
  } else {
    const handler = routes[hash];
    if (handler) await handler();
    else await pageLanding();
  }
  // Post-render: convert all :emoteName: text nodes into inline emote images
  applyEmotes($app());
}

function route(e, path) {
  if (e) e.preventDefault();
  location.hash = '#' + path;
}
window.route = route;

window.addEventListener('hashchange', router);

// ── Nav rendering ────────────────────────────────────────
function renderNav() {
  const nav = $('#navLinks');
  if (currentUser) {
    nav.innerHTML = `
      <a href="#/dashboard" onclick="route(event, '/dashboard')">Dashboard</a>
      <a href="#/leaderboard" onclick="route(event, '/leaderboard')">Leaderboard</a>
      <span class="nav-points">🪙 ${currentUser.points.toLocaleString()}</span>
      <button onclick="route(event, '/profile')">${esc(currentUser.username)}</button>
      <button onclick="doLogout()">Log Out</button>
    `;
  } else {
    nav.innerHTML = `
      <a href="#/status" onclick="route(event, '/status')">Status</a>
      <button class="btn btn-secondary btn-sm" onclick="route(event, '/login')">Log In</button>
      <button class="btn btn-primary btn-sm" onclick="route(event, '/signup')">Sign Up</button>
    `;
  }
}

// ── Auth actions ─────────────────────────────────────────
async function doLogout() {
  await api('/api/auth/logout', { method: 'POST' });
  currentUser = null;
  renderNav();
  route(null, '/');
  toast('Logged out');
}
window.doLogout = doLogout;

async function refreshUser() {
  try {
    const data = await api('/api/auth/me');
    currentUser = data.user;
  } catch { currentUser = null; }
  renderNav();
}

async function refreshStatus() {
  try {
    streamerStatus = await api('/api/streamer-status');
  } catch { /* ignore */ }
}

// ── Status Banner Component ──────────────────────────────
function statusBannerHTML() {
  const live = streamerStatus.isLive;
  const lastTime = streamerStatus.lastLiveAt;
  return `
    <div class="status-banner ${live ? 'is-live' : ''}">
      <div class="flex items-center gap-sm">
        <span class="live-dot ${live ? 'live' : 'offline'}"></span>
        <strong>Buhrito is ${live ? 'LIVE' : 'OFFLINE'}</strong>
      </div>
      <div class="t-caption">
        ${lastTime ? `Last live: ${fmtDate(lastTime)} · ${timeAgo(lastTime)}` : 'No live events recorded yet'}
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════
// PAGES
// ═══════════════════════════════════════════════════════════

// ── Landing (logged out) ─────────────────────────────────
function pageLanding() {
  if (currentUser) return route(null, '/dashboard');
  $app().innerHTML = `
    <div class="hero">
      <h1 class="t-display">Bet on the stream.<br>Win the points.</h1>
      <p class="hero-sub t-body">Predict when Buhrito goes live. Challenge other viewers. All for bragging rights (and holding our favorite streamer accountable :buhritWholesome:).</p>
      <div class="hero-cta">
        <button class="btn btn-primary" onclick="route(event, '/signup')">Sign Up — It's Free</button>
        <button class="btn btn-secondary" onclick="route(event, '/login')">Log In</button>
      </div>
      <p class="hero-note">Everyone starts with 1,000 points. No real money.</p>
    </div>

    <div class="container mt-lg">
      ${statusBannerHTML()}
    </div>

    <div class="container mt-xl">
      <div class="how-grid">
        <div class="card how-card">
          <div class="how-icon">🎯</div>
          <div class="how-title">Pick a time</div>
          <div class="how-desc">Choose when you think Buhrito will go live.</div>
        </div>
        <div class="card how-card">
          <div class="how-icon">⚡</div>
          <div class="how-title">Set your condition</div>
          <div class="how-desc">Before, At, or After — your call.</div>
        </div>
        <div class="card how-card">
          <div class="how-icon">🏆</div>
          <div class="how-title">Win points</div>
          <div class="how-desc">If you're right, you win your opponent's stake.</div>
        </div>
      </div>
    </div>

    <footer class="footer">BuhritBets · Not affiliated with Twitch · Points only, no real money.</footer>
  `;
}

// ── Sign Up ──────────────────────────────────────────────
function pageSignup() {
  $app().innerHTML = `
    <div class="page container-xs">
      <div class="auth-card flex flex-col gap-lg">
        <h1 class="t-h1 text-center">Create your account</h1>
        <form id="signupForm" class="flex flex-col gap-md">
          <div class="form-group">
            <label class="form-label" for="su-user">Username</label>
            <input class="form-input" id="su-user" type="text" placeholder="3–20 chars, letters & numbers" required minlength="3" maxlength="20" autocomplete="username">
          </div>
          <div class="form-group">
            <label class="form-label" for="su-email">Email</label>
            <input class="form-input" id="su-email" type="email" placeholder="you@example.com" required autocomplete="email">
          </div>
          <div class="form-group">
            <label class="form-label" for="su-pass">Password</label>
            <input class="form-input" id="su-pass" type="password" placeholder="At least 8 characters" required minlength="8" autocomplete="new-password">
          </div>
          <div class="form-group">
            <label class="form-label" for="su-pass2">Confirm Password</label>
            <input class="form-input" id="su-pass2" type="password" placeholder="Repeat password" required minlength="8" autocomplete="new-password">
          </div>
          <div class="form-error hidden" id="su-error"></div>
          <button class="btn btn-primary btn-full" type="submit">Create Account</button>
        </form>
        <p class="t-caption text-center">Already have an account? <a href="#/login" onclick="route(event, '/login')">Log in</a></p>
      </div>
    </div>
  `;
  $('#signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#su-error');
    errEl.classList.add('hidden');
    const pass = $('#su-pass').value;
    const pass2 = $('#su-pass2').value;
    if (pass !== pass2) { errEl.textContent = 'Passwords don\'t match.'; errEl.classList.remove('hidden'); return; }
    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username: $('#su-user').value, email: $('#su-email').value, password: pass })
      });
      currentUser = data.user;
      renderNav();
      route(null, '/dashboard');
      toast('Welcome to BuhritBets! You start with 🪙 1,000 points.', 'success');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });
}

// ── Log In ───────────────────────────────────────────────
function pageLogin() {
  $app().innerHTML = `
    <div class="page container-xs">
      <div class="auth-card flex flex-col gap-lg">
        <h1 class="t-h1 text-center">Welcome back</h1>
        <form id="loginForm" class="flex flex-col gap-md">
          <div class="form-group">
            <label class="form-label" for="li-login">Username or Email</label>
            <input class="form-input" id="li-login" type="text" required autocomplete="username">
          </div>
          <div class="form-group">
            <label class="form-label" for="li-pass">Password</label>
            <input class="form-input" id="li-pass" type="password" required autocomplete="current-password">
          </div>
          <div class="form-error hidden" id="li-error"></div>
          <button class="btn btn-primary btn-full" type="submit">Log In</button>
        </form>
        <p class="t-caption text-center"><a href="#" onclick="event.preventDefault(); toast('Password reset coming soon.', 'info')">Forgot password?</a></p>
        <p class="t-caption text-center">Don't have an account? <a href="#/signup" onclick="route(event, '/signup')">Sign up</a></p>
      </div>
    </div>
  `;
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#li-error');
    errEl.classList.add('hidden');
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ login: $('#li-login').value, password: $('#li-pass').value })
      });
      currentUser = data.user;
      renderNav();
      route(null, '/dashboard');
      toast('Welcome back!', 'success');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });
}

// ── Dashboard ────────────────────────────────────────────
async function pageDashboard() {
  if (!currentUser) return route(null, '/login');
  await refreshUser();
  await refreshStatus();

  $app().innerHTML = `
    <div class="page container">
      ${statusBannerHTML()}

      <div class="flex items-center justify-between mt-lg" style="flex-wrap:wrap;gap:12px">
        <div class="t-h2 t-mono" style="color:var(--status-warning)">🪙 ${currentUser.points.toLocaleString()} points</div>
        <button class="btn btn-primary" onclick="route(event, '/bets/create')">Create Bet</button>
      </div>

      <div class="tab-row mt-lg" id="dashTabs">
        <button class="tab-pill active" data-tab="open">Open Bets</button>
        <button class="tab-pill" data-tab="mine">My Bets</button>
        <button class="tab-pill" data-tab="matched">Awaiting Result</button>
        <button class="tab-pill" data-tab="settled">Recently Settled</button>
      </div>

      <div id="betList" class="flex flex-col gap-sm mt-md">
        <div class="empty-state"><div class="empty-icon">⏳</div>Loading bets…</div>
      </div>

      <div class="mt-xl">
        <h2 class="t-h2 mb-md">Recent Activity</h2>
        <div class="card" id="activityFeed">
          <div class="empty-state"><div class="empty-icon">📡</div>Loading…</div>
        </div>
      </div>
    </div>
    <footer class="footer">BuhritBets · Not affiliated with Twitch · Points only, no real money.</footer>
  `;

  // Tab switching
  let currentTab = 'open';
  document.querySelectorAll('#dashTabs .tab-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#dashTabs .tab-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTab = btn.dataset.tab;
      loadBets();
    });
  });

  async function loadBets() {
    const listEl = $('#betList');
    let url = '/api/bets?limit=50';
    if (currentTab === 'open') url += '&status=open';
    else if (currentTab === 'mine') url += '&mine=1';
    else if (currentTab === 'matched') url += '&status=matched';
    else if (currentTab === 'settled') url += '&status=settled';

    try {
      const data = await api(url);
      const bets = data.bets || [];
      if (!bets.length) {
        listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">🎲</div>No bets here yet.${currentTab === 'open' ? ' Create the first one!' : ''}</div>`;
        return;
      }
      listEl.innerHTML = bets.map(b => betCardHTML(b)).join('');
      attachBetActions();
    } catch (err) {
      listEl.innerHTML = `<div class="empty-state">Failed to load bets.</div>`;
    }
  }

  async function loadActivity() {
    const feedEl = $('#activityFeed');
    try {
      const data = await api('/api/activity?limit=15');
      const items = data.activity || [];
      if (!items.length) {
        feedEl.innerHTML = `<div class="empty-state"><div class="empty-icon">📡</div>No recent activity yet. Create the first bet!</div>`;
        return;
      }
      feedEl.innerHTML = items.map(a => {
        const icon = a.type === 'bet_placed' ? '🎯' : a.type === 'bet_matched' ? '🤝' : a.type === 'bet_won' ? '✅' : a.type === 'bet_canceled' ? '⚪' : '🔵';
        return `<div class="feed-item">
          <span class="feed-icon">${icon}</span>
          <div>
            <div class="feed-text"><strong>@${esc(a.username)}</strong> ${emoteify(esc(a.description))}</div>
            <div class="feed-time">${timeAgo(a.created_at)}</div>
          </div>
        </div>`;
      }).join('');
    } catch {
      feedEl.innerHTML = `<div class="empty-state">Failed to load activity.</div>`;
    }
  }

  loadBets();
  loadActivity();
}

function betCardHTML(b) {
  const isMine = currentUser && (b.creator_id === currentUser.id || b.opponent_id === currentUser.id);
  const canMatch = currentUser && b.status === 'open' && b.creator_id !== currentUser.id;
  const canCancel = currentUser && b.status === 'open' && b.creator_id === currentUser.id;

  return `
    <div class="card card-hoverable" onclick="route(event, '/bets/${b.id}')">
      <div class="bet-card">
        <span class="badge ${badgeClass(b.status, b.winner_id)}">${badgeLabel(b.status, b.winner_id)}</span>
        <div class="bet-info">
          <div class="bet-condition">${conditionText(b.condition)} ${fmtDate(b.target_time)}</div>
          <div class="bet-meta">@${esc(b.creator_username)} · Stake: 🪙 ${b.stake}${b.opponent_username ? ` · vs @${esc(b.opponent_username)}` : ''}</div>
          ${b.note ? `<div class="bet-note">${emoteify(esc(b.note))}</div>` : ''}
        </div>
        <div class="bet-actions" onclick="event.stopPropagation()">
          ${canMatch ? `<button class="btn btn-primary btn-sm" data-match="${b.id}">Match Bet</button>` : ''}
          ${canCancel ? `<button class="btn btn-danger btn-sm" data-cancel="${b.id}">Cancel</button>` : ''}
          ${!canMatch && !canCancel ? `<button class="btn btn-ghost btn-sm" onclick="route(event, '/bets/${b.id}')">View</button>` : ''}
        </div>
      </div>
    </div>
  `;
}

function attachBetActions() {
  document.querySelectorAll('[data-match]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.match;
      try {
        await api(`/api/bets/${id}/match`, { method: 'POST' });
        toast('Bet matched! Good luck!', 'success');
        await refreshUser();
        renderNav();
        pageDashboard();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
  document.querySelectorAll('[data-cancel]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.cancel;
      try {
        await api(`/api/bets/${id}/cancel`, { method: 'POST' });
        toast('Bet canceled. Points refunded.', 'info');
        await refreshUser();
        renderNav();
        pageDashboard();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

// ── Create Bet ───────────────────────────────────────────
function pageCreateBet() {
  if (!currentUser) return route(null, '/login');

  // Default datetime: 2 hours from now, rounded to nearest 15 min
  const def = new Date(Date.now() + 2 * 60 * 60 * 1000);
  def.setMinutes(Math.round(def.getMinutes() / 15) * 15, 0, 0);
  const defStr = new Date(def.getTime() - def.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  $app().innerHTML = `
    <div class="page container-sm">
      <div class="card card-padded">
        <div class="flex items-center justify-between mb-md">
          <h1 class="t-h1">Place your bet</h1>
          <button class="btn btn-ghost" onclick="history.back()">✕</button>
        </div>

        <form id="createBetForm" class="flex flex-col gap-lg">
          <!-- Time -->
          <div class="form-group">
            <label class="form-label">When will Buhrito go live?</label>
            <input class="form-input" type="datetime-local" id="cb-time" value="${defStr}" required>
            <div class="form-helper">${tz()} · <span id="cb-utc">${fmtUTC(def.toISOString())}</span></div>
          </div>

          <!-- Condition -->
          <div class="form-group">
            <label class="form-label">Your prediction</label>
            <div class="condition-group" id="cb-conds">
              <button type="button" class="condition-btn" data-cond="BEFORE">
                <span class="cond-label">BEFORE</span>
                <span class="cond-help">Goes live before this time</span>
              </button>
              <button type="button" class="condition-btn" data-cond="AT">
                <span class="cond-label">AT</span>
                <span class="cond-help">Within ±5 min of this time</span>
              </button>
              <button type="button" class="condition-btn" data-cond="AFTER">
                <span class="cond-label">AFTER</span>
                <span class="cond-help">Goes live after this time</span>
              </button>
            </div>
            <div class="form-error hidden" id="cb-cond-err">Pick a condition.</div>
          </div>

          <!-- Stake -->
          <div class="form-group">
            <label class="form-label">Stake</label>
            <div class="flex items-center gap-sm">
              <span style="color:var(--status-warning)">🪙</span>
              <input class="form-input w-full" type="number" id="cb-stake" min="50" max="${currentUser.points}" step="1" placeholder="50" required>
            </div>
            <div class="form-helper">Your balance: 🪙 ${currentUser.points.toLocaleString()}</div>
            <div class="chip-row mt-sm" id="cb-chips">
              <button type="button" class="chip" data-val="50">50</button>
              <button type="button" class="chip" data-val="100">100</button>
              <button type="button" class="chip" data-val="250">250</button>
              <button type="button" class="chip" data-val="500">500</button>
              <button type="button" class="chip" data-val="${currentUser.points}">All In</button>
            </div>
            <div class="form-error hidden" id="cb-stake-err"></div>
          </div>

          <!-- Note -->
          <div class="form-group">
            <label class="form-label">Trash talk <span class="t-caption">(optional)</span></label>
            <input class="form-input" type="text" id="cb-note" maxlength="80" placeholder="Talk your talk…">
            <div class="form-helper text-right"><span id="cb-notecount">0</span> / 80</div>
          </div>

          <!-- Payout Summary -->
          <div class="payout-card" id="cb-payout">
            <div class="t-caption mb-sm">Payout Summary</div>
            <div>Your stake: <strong class="t-mono">🪙 <span id="cb-sum-stake">0</span></strong></div>
            <div>Payout if you win: <strong class="t-mono" style="color:var(--status-success)">🪙 <span id="cb-sum-payout">0</span></strong></div>
            <div class="t-caption mt-sm">Winner takes all (your stake + opponent's matching stake).</div>
          </div>

          <div class="form-error hidden" id="cb-error"></div>
          <button class="btn btn-primary btn-full" type="submit" id="cb-submit" disabled>Place Bet</button>
          <button type="button" class="btn btn-ghost text-center" onclick="history.back()">Cancel</button>
        </form>
      </div>
    </div>
  `;

  let selectedCond = null;

  // Condition buttons
  document.querySelectorAll('#cb-conds .condition-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#cb-conds .condition-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedCond = btn.dataset.cond;
      $('#cb-cond-err').classList.add('hidden');
      validate();
    });
  });

  // Stake chips
  document.querySelectorAll('#cb-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $('#cb-stake').value = chip.dataset.val;
      document.querySelectorAll('#cb-chips .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      updatePayout();
      validate();
    });
  });

  // Live updates
  $('#cb-stake').addEventListener('input', () => { updatePayout(); validate(); });
  $('#cb-note').addEventListener('input', () => { $('#cb-notecount').textContent = $('#cb-note').value.length; });
  $('#cb-time').addEventListener('input', () => {
    const val = $('#cb-time').value;
    if (val) {
      const d = new Date(val);
      $('#cb-utc').textContent = fmtUTC(d.toISOString());
    }
    validate();
  });

  function updatePayout() {
    const s = Number($('#cb-stake').value) || 0;
    $('#cb-sum-stake').textContent = s.toLocaleString();
    $('#cb-sum-payout').textContent = (s * 2).toLocaleString();
  }

  function validate() {
    const time = new Date($('#cb-time').value);
    const stake = Number($('#cb-stake').value);
    const valid = selectedCond && !isNaN(time.getTime()) && time.getTime() > Date.now() && stake >= 50 && stake <= currentUser.points;
    $('#cb-submit').disabled = !valid;
    return valid;
  }

  // Submit
  $('#createBetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validate()) return;
    const errEl = $('#cb-error');
    errEl.classList.add('hidden');
    try {
      const data = await api('/api/bets', {
        method: 'POST',
        body: JSON.stringify({
          condition: selectedCond,
          targetTime: new Date($('#cb-time').value).toISOString(),
          stake: Number($('#cb-stake').value),
          note: $('#cb-note').value || null
        })
      });
      await refreshUser();
      renderNav();
      toast('Bet placed!', 'success');
      route(null, `/bets/${data.bet.id}`);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });

  updatePayout();
}

// ── Bet Detail ───────────────────────────────────────────
async function pageBetDetail(id) {
  $app().innerHTML = `<div class="page container-sm"><div class="empty-state"><div class="empty-icon">⏳</div>Loading bet…</div></div>`;

  try {
    const data = await api(`/api/bets/${id}`);
    const b = data.bet;
    if (!b) throw new Error('Bet not found');

    const isSettled = b.status === 'settled';
    const isCreator = currentUser && b.creator_id === currentUser.id;
    const isOpponent = currentUser && b.opponent_id === currentUser.id;
    const iWon = isSettled && b.winner_id === currentUser?.id;
    const canMatch = currentUser && b.status === 'open' && !isCreator;
    const canCancel = isCreator && b.status === 'open';

    $app().innerHTML = `
      <div class="page container-sm">
        <div class="card card-padded">
          <div class="flex items-center gap-md mb-md" style="flex-wrap:wrap">
            <span class="badge ${badgeClass(b.status, b.winner_id)}" style="font-size:0.857rem;padding:6px 14px;">
              ${badgeLabel(b.status, b.winner_id)}
            </span>
            <h1 class="t-h1">${conditionText(b.condition)} ${fmtDate(b.target_time)}</h1>
          </div>
          <div class="t-caption mb-md">${fmtUTC(b.target_time)} · Created ${fmtDateFull(b.created_at)}</div>

          <!-- Participants -->
          <div class="flex flex-col gap-sm mt-lg">
            <h2 class="t-h3">Participants</h2>
            <div class="card">
              <div class="flex items-center justify-between">
                <div>
                  <div class="t-body"><strong>Creator:</strong> @${esc(b.creator_username)}</div>
                  <div class="t-caption">Condition: ${conditionText(b.condition)} · Stake: 🪙 ${b.stake}</div>
                </div>
                ${isSettled ? `<div class="txn-amount ${b.winner_id === b.creator_id ? 'positive' : 'negative'}">${b.winner_id === b.creator_id ? '+' : '-'}${b.stake}</div>` : ''}
              </div>
            </div>
            <div class="card">
              ${b.opponent_username ? `
                <div class="flex items-center justify-between">
                  <div>
                    <div class="t-body"><strong>Opponent:</strong> @${esc(b.opponent_username)}</div>
                    <div class="t-caption">Condition: NOT ${conditionText(b.condition)} · Stake: 🪙 ${b.stake}</div>
                  </div>
                  ${isSettled ? `<div class="txn-amount ${b.winner_id === b.opponent_id ? 'positive' : 'negative'}">${b.winner_id === b.opponent_id ? '+' : '-'}${b.stake}</div>` : ''}
                </div>
              ` : `
                <div class="t-body t-secondary">Waiting for an opponent to match…</div>
              `}
            </div>
          </div>

          ${b.note ? `<div class="card mt-md" style="background:var(--bg-surface-raised)"><em class="t-caption">${emoteify(esc(b.note))}</em></div>` : ''}

          ${isSettled ? `
            <div class="card mt-lg settlement-card ${iWon ? '' : 'lost'}">
              <div class="t-h3 mb-sm">${iWon ? '🎉 You won!' : '😢 You lost'}</div>
              <div class="t-body"><strong>Buhrito went live at:</strong> <span class="t-mono">${fmtDateFull(b.actual_live_time)}</span></div>
              <div class="t-caption mt-sm">${fmtUTC(b.actual_live_time)}</div>
              <div class="t-body mt-sm">Condition "${conditionText(b.condition)}" → <strong>${b.winner_id === b.creator_id ? 'MET ✓' : 'NOT MET ✗'}</strong></div>
            </div>
          ` : ''}

          <div class="flex gap-sm mt-lg" style="flex-wrap:wrap">
            ${canMatch ? `<button class="btn btn-primary" id="bd-match">Match This Bet — 🪙 ${b.stake}</button>` : ''}
            ${canCancel ? `<button class="btn btn-danger" id="bd-cancel">Cancel Bet</button>` : ''}
            <button class="btn btn-secondary" onclick="route(event, '/dashboard')">Back to Dashboard</button>
          </div>
        </div>
      </div>
    `;

    if (canMatch) {
      $('#bd-match').addEventListener('click', async () => {
        try {
          await api(`/api/bets/${id}/match`, { method: 'POST' });
          toast('Bet matched! Good luck!', 'success');
          await refreshUser(); renderNav();
          pageBetDetail(id);
        } catch (err) { toast(err.message, 'error'); }
      });
    }
    if (canCancel) {
      $('#bd-cancel').addEventListener('click', async () => {
        try {
          await api(`/api/bets/${id}/cancel`, { method: 'POST' });
          toast('Bet canceled. Points refunded.', 'info');
          await refreshUser(); renderNav();
          pageBetDetail(id);
        } catch (err) { toast(err.message, 'error'); }
      });
    }
  } catch (err) {
    $app().innerHTML = `<div class="page container-sm"><div class="empty-state"><div class="empty-icon">❌</div>${esc(err.message)}</div></div>`;
  }
}

// ── Profile / Wallet ─────────────────────────────────────
async function pageProfile() {
  if (!currentUser) return route(null, '/login');
  await refreshUser();

  $app().innerHTML = `
    <div class="page container-sm">
      <!-- Profile Card -->
      <div class="card card-padded flex items-center gap-lg" style="flex-wrap:wrap">
        <div class="avatar">${currentUser.username.charAt(0).toUpperCase()}</div>
        <div>
          <h1 class="t-h1">@${esc(currentUser.username)}</h1>
          <div class="t-caption">Member since ${fmtDate(currentUser.created_at)}</div>
          <div class="t-h2 t-mono mt-sm" style="color:var(--status-warning)">🪙 ${currentUser.points.toLocaleString()} points</div>
        </div>
      </div>

      <!-- Transactions -->
      <h2 class="t-h2 mt-xl mb-md">Point History</h2>
      <div class="card" id="txnList">
        <div class="empty-state"><div class="empty-icon">⏳</div>Loading…</div>
      </div>

      <!-- My Bets -->
      <h2 class="t-h2 mt-xl mb-md">My Bets</h2>
      <div id="myBetsList" class="flex flex-col gap-sm">
        <div class="empty-state"><div class="empty-icon">⏳</div>Loading…</div>
      </div>
    </div>
  `;

  // Load transactions
  try {
    const data = await api('/api/me/transactions?limit=50');
    const txns = data.transactions || [];
    if (!txns.length) {
      $('#txnList').innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div>No transactions yet. Place your first bet!</div>`;
    } else {
      $('#txnList').innerHTML = txns.map(t => `
        <div class="txn-row">
          <div>
            <div class="t-body">${emoteify(esc(t.description))}</div>
            <div class="t-caption">${fmtDateFull(t.created_at)}</div>
          </div>
          <div class="txn-amount ${t.amount >= 0 ? 'positive' : 'negative'}">${t.amount >= 0 ? '+' : ''}${t.amount.toLocaleString()}</div>
        </div>
      `).join('');
    }
  } catch { $('#txnList').innerHTML = '<div class="empty-state">Failed to load.</div>'; }

  // Load my bets
  try {
    const data = await api('/api/bets?mine=1&limit=50');
    const bets = data.bets || [];
    if (!bets.length) {
      $('#myBetsList').innerHTML = `<div class="empty-state"><div class="empty-icon">🎲</div>No bets yet.</div>`;
    } else {
      $('#myBetsList').innerHTML = bets.map(b => betCardHTML(b)).join('');
      attachBetActions();
    }
  } catch { $('#myBetsList').innerHTML = '<div class="empty-state">Failed to load.</div>'; }
}

// ── System Status ────────────────────────────────────────
async function pageStatus() {
  await refreshStatus();

  let eventsHTML = '<div class="empty-state">Loading…</div>';
  try {
    const data = await api('/events?limit=20');
    const events = data.events || [];
    if (events.length) {
      eventsHTML = events.reverse().map(ev => {
        const isOnline = ev.subscription_type === 'stream.online';
        const eventTime = ev.event?.started_at || ev.received_at;
        return `<div class="feed-item">
          <span class="feed-icon">${isOnline ? '🔴' : '⚫'}</span>
          <div>
            <div class="feed-text">${isOnline ? 'stream.online' : 'stream.offline'}</div>
            <div class="feed-time">${fmtDateFull(eventTime)} · ${timeAgo(eventTime)}</div>
          </div>
        </div>`;
      }).join('');
    } else {
      eventsHTML = '<div class="empty-state"><div class="empty-icon">📡</div>No events detected yet.</div>';
    }
  } catch {
    eventsHTML = '<div class="empty-state">Failed to load events.</div>';
  }

  let healthHTML = '';
  try {
    const h = await api('/health');
    const es = h.eventSub || {};
    healthHTML = `
      <div class="flex items-center gap-sm">
        <span class="live-dot ${es.connected ? 'connected' : 'offline'}"></span>
        <span>EventSub: ${es.connected ? 'Connected ✓' : 'Disconnected ✗'}</span>
      </div>
      <div class="t-caption mt-sm">System started: ${fmtDateFull(h.startedAt)}</div>
    `;
  } catch {
    healthHTML = '<div class="t-caption">Could not reach server.</div>';
  }

  $app().innerHTML = `
    <div class="page container-sm">
      <h1 class="t-h1 mb-lg">System Status</h1>

      <div class="card card-padded">
        ${statusBannerHTML()}
        <div class="mt-md">${healthHTML}</div>
      </div>

      <h2 class="t-h2 mt-xl mb-md">Recent Detection Log</h2>
      <div class="card card-padded">${eventsHTML}</div>

      <div class="t-caption mt-lg text-center">Events are detected via Twitch EventSub and recorded automatically.</div>
    </div>
    <footer class="footer">BuhritBets · Not affiliated with Twitch · Points only, no real money.</footer>
  `;
}

// ── Leaderboard ──────────────────────────────────────────
async function pageLeaderboard() {
  $app().innerHTML = `<div class="page container-sm"><div class="empty-state"><div class="empty-icon">⏳</div>Loading leaderboard…</div></div>`;

  try {
    const data = await api('/api/leaderboard?limit=20');
    const leaders = data.leaderboard || [];

    $app().innerHTML = `
      <div class="page container-sm">
        <h1 class="t-h1 mb-lg">Leaderboard</h1>
        ${leaders.length ? `
          <div class="flex flex-col gap-sm">
            ${leaders.map((u, i) => `
              <div class="card">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-md">
                    <div class="t-h2" style="color:var(--text-muted);width:32px;text-align:right">#${i + 1}</div>
                    <div class="avatar" style="width:40px;height:40px;font-size:1rem">${u.username.charAt(0).toUpperCase()}</div>
                    <div>
                      <div class="t-body"><strong>@${esc(u.username)}</strong></div>
                      <div class="t-caption">Joined ${fmtDate(u.created_at)}</div>
                    </div>
                  </div>
                  <div class="t-mono" style="color:var(--status-warning);font-size:1.1rem">🪙 ${u.points.toLocaleString()}</div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : '<div class="empty-state"><div class="empty-icon">👤</div>No users yet. Be the first to sign up!</div>'}
      </div>
    `;
  } catch {
    $app().innerHTML = `<div class="page container-sm"><div class="empty-state">Failed to load leaderboard.</div></div>`;
  }
}

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
(async function boot() {
  await loadEmotes();
  await refreshUser();
  await refreshStatus();
  router();

  // Refresh status every 30s
  setInterval(async () => {
    await refreshStatus();
    await refreshUser();
    renderNav();
  }, 30_000);
})();
