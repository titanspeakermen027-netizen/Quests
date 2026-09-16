const Database = require('better-sqlite3');

const db = new Database(process.env.DB_PATH || './quests.sqlite');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  completed_today INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  last_active_day TEXT,
  total_completed INTEGER NOT NULL DEFAULT 0,
  boxes_opened INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS daily_quests (
  guild_id TEXT NOT NULL,
  quest_date TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  target INTEGER NOT NULL,
  reward_points INTEGER NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, quest_date, quest_id)
);

CREATE TABLE IF NOT EXISTS completions (
  guild_id TEXT NOT NULL,
  quest_date TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, quest_date, quest_id, user_id)
);

CREATE TABLE IF NOT EXISTS achievements (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  achievement_id TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS mystery_boxes (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_opened_at INTEGER,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS settings (
  guild_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (guild_id, key)
);
`);

function ensureUser(guildId, userId) {
  db.prepare(`INSERT OR IGNORE INTO users (guild_id, user_id, created_at) VALUES (?, ?, ?)`).run(guildId, userId, Date.now());
}

module.exports = { db, ensureUser };
