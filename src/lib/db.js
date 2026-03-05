import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = path.resolve(process.cwd(), 'data', 'buhritbets.db');

let _db;
export function getDb() {
  if (!_db) {
    _db = new Database(dbPath);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initSchema(_db);
  }
  return _db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      email TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 1000,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL REFERENCES users(id),
      opponent_id INTEGER REFERENCES users(id),
      condition TEXT NOT NULL CHECK (condition IN ('BEFORE','AT','AFTER')),
      target_time TEXT NOT NULL,
      stake INTEGER NOT NULL CHECK (stake >= 50),
      note TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','matched','settled','canceled')),
      winner_id INTEGER REFERENCES users(id),
      actual_live_time TEXT,
      settled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      amount INTEGER NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      bet_id INTEGER REFERENCES bets(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_bets_status ON bets(status);
    CREATE INDEX IF NOT EXISTS idx_bets_creator ON bets(creator_id);
    CREATE INDEX IF NOT EXISTS idx_bets_opponent ON bets(opponent_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
  `);
}

// ── User helpers ─────────────────────────────────────────

export function createUser({ username, email, passwordHash }) {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)'
  );
  const info = stmt.run(username, email, passwordHash);
  return getUserById(info.lastInsertRowid);
}

export function getUserById(id) {
  return getDb().prepare('SELECT id, username, email, points, created_at FROM users WHERE id = ?').get(id);
}

export function getUserByLogin(login) {
  return getDb().prepare(
    'SELECT * FROM users WHERE username = ? OR email = ?'
  ).get(login, login);
}

// ── Points helpers ───────────────────────────────────────

export function adjustPoints(userId, amount, type, description, betId = null) {
  const db = getDb();
  db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(amount, userId);
  db.prepare(
    'INSERT INTO transactions (user_id, amount, type, description, bet_id) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, amount, type, description, betId);
}

export function getUserTransactions(userId, limit = 50) {
  return getDb().prepare(
    'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, limit);
}

// ── Bet helpers ──────────────────────────────────────────

export function createBet({ creatorId, condition, targetTime, stake, note }) {
  const db = getDb();
  const user = getUserById(creatorId);
  if (!user || user.points < stake) throw new Error('Insufficient points');

  const create = db.transaction(() => {
    const info = db.prepare(
      'INSERT INTO bets (creator_id, condition, target_time, stake, note) VALUES (?, ?, ?, ?, ?)'
    ).run(creatorId, condition, targetTime, stake, note || null);

    adjustPoints(creatorId, -stake, 'bet_placed', `Placed bet #${info.lastInsertRowid}`, info.lastInsertRowid);
    return info.lastInsertRowid;
  });

  const betId = create();
  return getBetById(betId);
}

export function matchBet(betId, opponentId) {
  const db = getDb();
  const bet = getBetById(betId);
  if (!bet) throw new Error('Bet not found');
  if (bet.status !== 'open') throw new Error('Bet is not open');
  if (bet.creator_id === opponentId) throw new Error('Cannot match your own bet');

  const opp = getUserById(opponentId);
  if (!opp || opp.points < bet.stake) throw new Error('Insufficient points');

  const doMatch = db.transaction(() => {
    db.prepare('UPDATE bets SET opponent_id = ?, status = ? WHERE id = ?')
      .run(opponentId, 'matched', betId);
    adjustPoints(opponentId, -bet.stake, 'bet_matched', `Matched bet #${betId}`, betId);
  });
  doMatch();
  return getBetById(betId);
}

export function cancelBet(betId, userId) {
  const db = getDb();
  const bet = getBetById(betId);
  if (!bet) throw new Error('Bet not found');
  if (bet.creator_id !== userId) throw new Error('Not your bet');
  if (bet.status !== 'open') throw new Error('Can only cancel open bets');

  const doCancel = db.transaction(() => {
    db.prepare('UPDATE bets SET status = ? WHERE id = ?').run('canceled', betId);
    adjustPoints(userId, bet.stake, 'bet_canceled', `Canceled bet #${betId}`, betId);
  });
  doCancel();
  return getBetById(betId);
}

export function getBetById(id) {
  return getDb().prepare(`
    SELECT b.*,
      c.username AS creator_username,
      o.username AS opponent_username,
      w.username AS winner_username
    FROM bets b
    LEFT JOIN users c ON c.id = b.creator_id
    LEFT JOIN users o ON o.id = b.opponent_id
    LEFT JOIN users w ON w.id = b.winner_id
    WHERE b.id = ?
  `).get(id);
}

export function listBets({ status, userId, limit = 50, offset = 0 }) {
  const db = getDb();
  let where = [];
  let params = [];

  if (status) { where.push('b.status = ?'); params.push(status); }
  if (userId) { where.push('(b.creator_id = ? OR b.opponent_id = ?)'); params.push(userId, userId); }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  params.push(limit, offset);

  return db.prepare(`
    SELECT b.*,
      c.username AS creator_username,
      o.username AS opponent_username,
      w.username AS winner_username
    FROM bets b
    LEFT JOIN users c ON c.id = b.creator_id
    LEFT JOIN users o ON o.id = b.opponent_id
    LEFT JOIN users w ON w.id = b.winner_id
    ${whereClause}
    ORDER BY b.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params);
}

export function getRecentActivity(limit = 20) {
  return getDb().prepare(`
    SELECT t.*, u.username, b.condition, b.target_time, b.stake AS bet_stake
    FROM transactions t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN bets b ON b.id = t.bet_id
    ORDER BY t.created_at DESC
    LIMIT ?
  `).all(limit);
}

/**
 * Settle all matched bets based on actual go-live time.
 * Called when stream.online fires.
 */
export function settleBets(actualLiveTimeIso) {
  const db = getDb();
  const liveTime = new Date(actualLiveTimeIso);
  const matched = db.prepare("SELECT * FROM bets WHERE status = 'matched'").all();

  const AT_WINDOW_MS = 5 * 60 * 1000; // ±5 minutes

  const doSettle = db.transaction(() => {
    for (const bet of matched) {
      const target = new Date(bet.target_time);
      const diffMs = liveTime.getTime() - target.getTime();
      let conditionMet = false;

      if (bet.condition === 'BEFORE') conditionMet = diffMs < 0;
      else if (bet.condition === 'AFTER') conditionMet = diffMs > 0;
      else if (bet.condition === 'AT') conditionMet = Math.abs(diffMs) <= AT_WINDOW_MS;

      const winnerId = conditionMet ? bet.creator_id : bet.opponent_id;
      const loserId = conditionMet ? bet.opponent_id : bet.creator_id;
      const payout = bet.stake * 2;

      db.prepare(`
        UPDATE bets SET status = 'settled', winner_id = ?, actual_live_time = ?, settled_at = datetime('now')
        WHERE id = ?
      `).run(winnerId, actualLiveTimeIso, bet.id);

      adjustPoints(winnerId, payout, 'bet_won', `Won bet #${bet.id}`, bet.id);

      console.log(`[bets] settled bet #${bet.id}: winner=${winnerId} (${conditionMet ? 'creator' : 'opponent'}), payout=${payout}`);
    }
  });

  const count = matched.length;
  if (count > 0) {
    doSettle();
    console.log(`[bets] settled ${count} bets at live time ${actualLiveTimeIso}`);
  }
  return count;
}

export function getLeaderboard(limit = 20) {
  return getDb().prepare(`
    SELECT id, username, points, created_at FROM users ORDER BY points DESC LIMIT ?
  `).all(limit);
}
