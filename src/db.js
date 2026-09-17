const Database = require('better-sqlite3');

const db = new Database(process.env.DB_PATH || './quests.sqlite');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  last_active_day TEXT,
  total_completed INTEGER NOT NULL DEFAULT 0,
  total_points INTEGER NOT NULL DEFAULT 0,
  boxes_earned INTEGER NOT NULL DEFAULT 0,
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
  PRIMARY KEY (guild_id, quest_date, quest_id)
);

CREATE TABLE IF NOT EXISTS user_quest_progress (
  guild_id TEXT NOT NULL,
  quest_date TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, quest_date, quest_id, user_id)
);

CREATE TABLE IF NOT EXISTS completions (
  guild_id TEXT NOT NULL,
  quest_date TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, quest_date, quest_id, user_id)
);

CREATE TABLE IF NOT EXISTS weekly_quests (
  guild_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  target INTEGER NOT NULL,
  reward_points INTEGER NOT NULL,
  PRIMARY KEY (guild_id, week_key, quest_id)
);

CREATE TABLE IF NOT EXISTS user_weekly_progress (
  guild_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, week_key, quest_id, user_id)
);

CREATE TABLE IF NOT EXISTS weekly_completions (
  guild_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, week_key, quest_id, user_id)
);

CREATE TABLE IF NOT EXISTS seasons (
  guild_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  PRIMARY KEY (guild_id, season_id)
);

CREATE TABLE IF NOT EXISTS seasonal_quests (
  guild_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  target INTEGER NOT NULL,
  reward_points INTEGER NOT NULL,
  PRIMARY KEY (guild_id, season_id, quest_id)
);

CREATE TABLE IF NOT EXISTS user_seasonal_progress (
  guild_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, season_id, quest_id, user_id)
);

CREATE TABLE IF NOT EXISTS seasonal_completions (
  guild_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, season_id, quest_id, user_id)
);

CREATE TABLE IF NOT EXISTS achievements (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  achievement_id TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS daily_rewards (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  quest_date TEXT NOT NULL,
  box_awarded INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, quest_date)
);

CREATE TABLE IF NOT EXISTS activity_guard (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_message_at INTEGER,
  last_message_hash TEXT,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS daily_channel_hits (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  quest_date TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id, quest_date, channel_id)
);

CREATE TABLE IF NOT EXISTS weekly_channel_hits (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id, week_key, channel_id)
);

CREATE TABLE IF NOT EXISTS seasonal_channel_hits (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id, season_id, channel_id)
);

CREATE TABLE IF NOT EXISTS voice_sessions (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_flushed_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS point_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  points INTEGER NOT NULL,
  source TEXT NOT NULL,
  period_type TEXT,
  period_key TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS level_rewards (
  guild_id TEXT NOT NULL,
  level INTEGER NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, level)
);

CREATE TABLE IF NOT EXISTS events (
  guild_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  reward_points INTEGER NOT NULL DEFAULT 25,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  PRIMARY KEY (guild_id, event_id)
);

CREATE TABLE IF NOT EXISTS event_participants (
  guild_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, event_id, user_id)
);

CREATE TABLE IF NOT EXISTS settings (
  guild_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (guild_id, key)
);

CREATE TABLE IF NOT EXISTS mystery_boxes (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_opened_at INTEGER,
  PRIMARY KEY (guild_id, user_id)
);
`);

function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(row => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumnIfMissing('users', 'boxes_earned', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('users', 'boxes_opened', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('users', 'total_points', 'INTEGER NOT NULL DEFAULT 0');

function ensureUser(guildId, userId) {
  db.prepare(
    'INSERT OR IGNORE INTO users (guild_id, user_id, created_at) VALUES (?, ?, ?)'
  ).run(guildId, userId, Date.now());
}

function getSetting(guildId, key, fallback = null) {
  return db.prepare(
    'SELECT value FROM settings WHERE guild_id = ? AND key = ?'
  ).get(guildId, key)?.value ?? fallback;
}

function setSetting(guildId, key, value) {
  db.prepare(`
    INSERT INTO settings (guild_id, key, value)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
  `).run(guildId, String(key), String(value));
}

module.exports = { db, ensureUser, getSetting, setSetting };

// Load Discord-only administration controls after database exports exist.
// It runs in the same process so configuration changes immediately affect the
// main Quests client without requiring .env edits.
if (process.env.DISCORD_TOKEN) {
  setImmediate(() => require('./admin'));
}
