const { db, ensureUser } = require('./db');

const QUEST_POOL = [
  { id: 'messages_25', type: 'messages', title: 'محادثات اليوم', description: 'أرسل 25 رسالة في السيرفر.', target: 25, reward: 25 },
  { id: 'messages_60', type: 'messages', title: 'متحدث نشيط', description: 'أرسل 60 رسالة في السيرفر.', target: 60, reward: 45 },
  { id: 'reactions_10', type: 'reactions', title: 'تفاعل مستمر', description: 'أضف 10 تفاعلات على الرسائل.', target: 10, reward: 20 },
  { id: 'voice_20', type: 'voice_minutes', title: 'جلسة صوتية', description: 'اقضِ 20 دقيقة في قناة صوتية.', target: 20, reward: 30 },
  { id: 'events_1', type: 'events', title: 'مشاركة في فعالية', description: 'شارك في فعالية واحدة ينظمها السيرفر.', target: 1, reward: 50 },
  { id: 'commands_5', type: 'commands', title: 'مستكشف الأوامر', description: 'استخدم 5 أوامر للبوت اليوم.', target: 5, reward: 20 }
];

function todayKey() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TIMEZONE || 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function generateDailyQuests(guildId) {
  const date = todayKey();
  const exists = db.prepare('SELECT COUNT(*) AS c FROM daily_quests WHERE guild_id = ? AND quest_date = ?').get(guildId, date).c;
  if (exists) return db.prepare('SELECT * FROM daily_quests WHERE guild_id = ? AND quest_date = ? ORDER BY rowid').all(guildId, date);

  const shuffled = [...QUEST_POOL].sort(() => Math.random() - 0.5).slice(0, 4);
  const insert = db.prepare(`INSERT INTO daily_quests (guild_id, quest_date, quest_id, type, title, description, target, reward_points) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const tx = db.transaction(() => shuffled.forEach(q => insert.run(guildId, date, q.id, q.type, q.title, q.description, q.target, q.reward)));
  tx();
  return db.prepare('SELECT * FROM daily_quests WHERE guild_id = ? AND quest_date = ? ORDER BY rowid').all(guildId, date);
}

function completedSet(guildId, userId, date) {
  return new Set(db.prepare('SELECT quest_id FROM completions WHERE guild_id = ? AND quest_date = ? AND user_id = ?').all(guildId, date, userId).map(x => x.quest_id));
}

function progress(guildId, userId, type, amount = 1) {
  ensureUser(guildId, userId);
  const date = todayKey();
  generateDailyQuests(guildId);
  const rows = db.prepare(`SELECT * FROM daily_quests WHERE guild_id = ? AND quest_date = ? AND type = ?`).all(guildId, date, type);
  const completed = completedSet(guildId, userId, date);
  const newlyCompleted = [];
  const update = db.prepare('UPDATE daily_quests SET progress = MIN(target, progress + ?) WHERE guild_id = ? AND quest_date = ? AND quest_id = ?');
  const insertCompletion = db.prepare('INSERT OR IGNORE INTO completions (guild_id, quest_date, quest_id, user_id, completed_at) VALUES (?, ?, ?, ?, ?)');

  for (const q of rows) {
    if (completed.has(q.quest_id)) continue;
    update.run(amount, guildId, date, q.quest_id);
    const updated = db.prepare('SELECT progress, target FROM daily_quests WHERE guild_id = ? AND quest_date = ? AND quest_id = ?').get(guildId, date, q.quest_id);
    if (updated.progress >= updated.target) {
      const result = insertCompletion.run(guildId, date, q.quest_id, userId, Date.now());
      if (result.changes) newlyCompleted.push(q);
    }
  }
  return newlyCompleted;
}

function completeEventQuest(guildId, userId) {
  return progress(guildId, userId, 'events', 1);
}

function awardCompletion(guildId, userId, completedQuests) {
  if (!completedQuests.length) return null;
  ensureUser(guildId, userId);
  const points = completedQuests.reduce((sum, q) => sum + q.reward_points, 0);
  db.prepare('UPDATE users SET total_completed = total_completed + ? WHERE guild_id = ? AND user_id = ?').run(completedQuests.length, guildId, userId);

  const date = todayKey();
  const dayCount = db.prepare('SELECT COUNT(*) AS c FROM completions WHERE guild_id = ? AND quest_date = ? AND user_id = ?').get(guildId, date, userId).c;
  if (dayCount >= 4) {
    const user = db.prepare('SELECT last_active_day, streak, best_streak FROM users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
    let streak = user.streak;
    if (user.last_active_day === date) streak = Math.max(1, streak);
    else streak += 1;
    db.prepare('UPDATE users SET last_active_day = ?, streak = ?, best_streak = MAX(best_streak, ?) WHERE guild_id = ? AND user_id = ?').run(date, streak, streak, guildId, userId);
  }
  return points;
}

function dailyStatus(guildId, userId) {
  ensureUser(guildId, userId);
  const date = todayKey();
  const quests = generateDailyQuests(guildId);
  const done = completedSet(guildId, userId, date);
  const user = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  return { date, quests, done, user };
}

function leaderboard(guildId, limit = 10) {
  return db.prepare(`SELECT user_id, total_completed, streak, best_streak FROM users WHERE guild_id = ? ORDER BY total_completed DESC, best_streak DESC LIMIT ?`).all(guildId, limit);
}

module.exports = { todayKey, generateDailyQuests, progress, completeEventQuest, awardCompletion, dailyStatus, leaderboard };
