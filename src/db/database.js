const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'bot.db');

let db = null;

function getDb() {
  if (!db) {
    initializeDatabase();
  }

  return db;
}

function initializeDatabase() {
  if (db) return db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jid TEXT NOT NULL UNIQUE,
      label TEXT,
      added_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS viewed (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_jid TEXT NOT NULL,
      viewed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_viewed_sender_jid
      ON viewed(sender_jid);

    CREATE INDEX IF NOT EXISTS idx_viewed_viewed_at
      ON viewed(viewed_at);
  `);

  return db;
}

function logView({ senderJid, viewedAt }) {
  return getDb()
    .prepare(`
      INSERT INTO viewed (sender_jid, viewed_at)
      VALUES (@senderJid, @viewedAt)
    `)
    .run({ senderJid, viewedAt });
}

function getStats() {
  const database = getDb();
  const totals = database
    .prepare(`
      SELECT
        COUNT(*) AS total_views,
        COUNT(DISTINCT sender_jid) AS unique_senders,
        MIN(viewed_at) AS first_viewed_at,
        MAX(viewed_at) AS last_viewed_at
      FROM viewed
    `)
    .get();

  const bySender = database
    .prepare(`
      SELECT sender_jid, COUNT(*) AS views, MAX(viewed_at) AS last_viewed_at
      FROM viewed
      GROUP BY sender_jid
      ORDER BY views DESC, last_viewed_at DESC
    `)
    .all();

  return {
    ...totals,
    bySender
  };
}

function addTarget(jid, label = null) {
  return getDb()
    .prepare(`
      INSERT INTO targets (jid, label)
      VALUES (@jid, @label)
      ON CONFLICT(jid) DO UPDATE SET
        label = excluded.label
    `)
    .run({ jid, label });
}

function removeTarget(jid) {
  return getDb()
    .prepare('DELETE FROM targets WHERE jid = ?')
    .run(jid);
}

function listTargets() {
  return getDb()
    .prepare('SELECT id, jid, label, added_at FROM targets ORDER BY added_at ASC, id ASC')
    .all();
}

function closeDatabase() {
  if (!db) return;

  db.close();
  db = null;
}

module.exports = {
  addTarget,
  closeDatabase,
  getStats,
  initializeDatabase,
  listTargets,
  logView,
  removeTarget
};
