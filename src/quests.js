const { db, ensureUser } = require('./db');

const QUEST_POOL = [
  { id: 'messages_25', type: 'messages', title: 'محادثات اليوم', description: 'أرسل 25 رسالة في السيرفر.', target: 25, reward: 25 },
  { id: 'messages_60', type: 'messages', title: 'متحدث نشيط', description: 'أرسل 60 رسالة في السيرفر.', target: 60, reward: 45 },
  { id: 'reactions_10', type: 'reactions', title: 'تفاعل مستمر', description: 'أضف 10 تفاعلات على الرسائل.', target: 10, reward: 20 },
  { id: 'voice_20', type: 'voice_minutes', title: 'جلسة صوتية', description: 'اقضِ 20 دقيقة في قناة صوتية.', target: 20, reward: 30 },
  { id: 'events_1', type: 'events', title: 'مشاركة في فعالية', description: 'شارك في فعالية واحدة ينظمها السيرفر.', target: 1, reward: 50 },
  { id: 'commands_5', type: 'commands', title: 'مستكشف الأوامر', description: 'استخدم 5 أوامر للبوت اليوم.', target: 5, reward: 20 }
];

const ACHIEVEMENTS = [
  { id: 'first_quest', name: 'البداية', description: 'أكمل أول مهمة.' },
  { id: 'ten_quests', name: 'متقدم', description: 'أكمل 10 مهام.' },
  { id: 'fifty_quests', name: 'محترف المهام', description: 'أكمل 50 مهمة.' },
  { id: 'hundred_quests', name: 'أسطورة المهام', description: 'أكمل 100 مهمة.' },
  { id: 'streak_7', name: 'سلسلة الأسبوع', description: 'حافظ على سلسلة لمدة 7 أيام.' },
  { id: 'streak_30', name: 'سلسلة الشهر', description: 'حافظ على سلسلة لمدة 30 يوماً.' },
  { id: 'first_box', name: 'الحظ الأول', description: 'افتح أول Mystery Box.' },
  { id: 'all_daily', name: 'يوم كامل', description: 'أكمل جميع مهام اليوم.' }
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
  const insert = db.prepare('INSERT INTO daily_quests (guild_id, quest_date, quest_id, type, title, description, target, reward_points) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  db.transaction(() => shuffled.forEach(q => insert.run(guildId, date, q.id, q.type, q.title, q.description, q.target, q.reward)))();
  return db.prepare('SELECT * FROM daily_quests WHERE guild_id = ? AND quest_date = ? ORDER BY rowid').all(guildId, date);
}

function getProgress(guildId, userId, date, questId) {
  return db.prepare('SELECT progress FROM user_quest_progress WHERE guild_id = ? AND quest_date = ? AND quest_id = ? AND user_id = ?').get(guildId, date, questId, userId)?.progress || 0;
}

function completedSet(guildId, userId, date) {
  return new Set(db.prepare('SELECT quest_id FROM completions WHERE guild_id = ? AND quest_date = ? AND user_id = ?').all(guildId, date, userId).map(x => x.quest_id));
}

function progress(guildId, userId, type, amount = 1) {
  ensureUser(guildId, userId);
  const date = todayKey();
  const rows = generateDailyQuests(guildId).filter(q => q.type === type);
  const completed = completedSet(guildId, userId, date);
  const newlyCompleted = [];
  const upsertProgress = db.prepare(`INSERT INTO user_quest_progress (guild_id, quest_date, quest_id, user_id, progress)
    VALUES (?, ?, ?, ?, MIN(?, ?))
    ON CONFLICT(guild_id, quest_date, quest_id, user_id) DO UPDATE SET progress = MIN(?, progress + ?)`);
  const insertCompletion = db.prepare('INSERT OR IGNORE INTO completions (guild_id, quest_date, quest_id, user_id, completed_at) VALUES (?, ?, ?, ?, ?)');

  for (const q of rows) {
    if (completed.has(q.quest_id)) continue;
    const current = getProgress(guildId, userId, date, q.quest_id);
    const next = Math.min(q.target, current + amount);
    if (current === 0) upsertProgress.run(guildId, date, q.quest_id, userId, next, q.target, next, amount);
    else upsertProgress.run(guildId, date, q.quest_id, userId, next, q.target, next, amount);
    if (next >= q.target && insertCompletion.run(guildId, date, q.quest_id, userId, Date.now()).changes) newlyCompleted.push(q);
  }
  return newlyCompleted;
}

function completeEventQuest(guildId, userId) {
  return progress(guildId, userId, 'events', 1);
}

function unlockAchievement(guildId, userId, achievementId) {
  return db.prepare('INSERT OR IGNORE INTO achievements (guild_id, user_id, achievement_id, unlocked_at) VALUES (?, ?, ?, ?)').run(guildId, userId, achievementId, Date.now()).changes > 0;
}

function evaluateAchievements(guildId, userId) {
  const user = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  const unlocked = [];
  const rules = [
    ['first_quest', user.total_completed >= 1],
    ['ten_quests', user.total_completed >= 10],
    ['fifty_quests', user.total_completed >= 50],
    ['hundred_quests', user.total_completed >= 100],
    ['streak_7', user.best_streak >= 7],
    ['streak_30', user.best_streak >= 30],
    ['first_box', user.boxes_opened >= 1]
  ];
  for (const [id, ok] of rules) if (ok && unlockAchievement(guildId, userId, id)) unlocked.push(ACHIEVEMENTS.find(a => a.id === id));
  const date = todayKey();
  const totalToday = generateDailyQuests(guildId).length;
  const doneToday = db.prepare('SELECT COUNT(*) AS c FROM completions WHERE guild_id = ? AND quest_date = ? AND user_id = ?').get(guildId, date, userId).c;
  if (totalToday > 0 && doneToday >= totalToday && unlockAchievement(guildId, userId, 'all_daily')) unlocked.push(ACHIEVEMENTS.find(a => a.id === 'all_daily'));
  return unlocked.filter(Boolean);
}

function awardCompletion(guildId, userId, completedQuests) {
  if (!completedQuests.length) return { points: 0, achievements: [] };
  ensureUser(guildId, userId);
  const points = completedQuests.reduce((sum, q) => sum + q.reward_points, 0);
  db.prepare('UPDATE users SET total_completed = total_completed + ?, total_points = total_points + ? WHERE guild_id = ? AND user_id = ?').run(completedQuests.length, points, guildId, userId);

  const date = todayKey();
  const user = db.prepare('SELECT last_active_day, streak, best_streak FROM users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  let streak = user.streak;
  if (user.last_active_day !== date) {
    const previous = new Date(`${date}T00:00:00`);
    previous.setDate(previous.getDate() - 1);
    const expected = previous.toISOString().slice(0, 10);
    streak = user.last_active_day === expected ? user.streak + 1 : 1;
  }
  db.prepare('UPDATE users SET last_active_day = ?, streak = ?, best_streak = MAX(best_streak, ?) WHERE guild_id = ? AND user_id = ?').run(date, streak, streak, guildId, userId);
  return { points, achievements: evaluateAchievements(guildId, userId) };
}

function dailyStatus(guildId, userId) {
  ensureUser(guildId, userId);
  const date = todayKey();
  const quests = generateDailyQuests(guildId).map(q => ({ ...q, progress: getProgress(guildId, userId, date, q.quest_id) }));
  const done = completedSet(guildId, userId, date);
  const user = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  return { date, quests, done, user };
}

function leaderboard(guildId, limit = 10) {
  return db.prepare('SELECT user_id, total_completed, total_points, streak, best_streak FROM users WHERE guild_id = ? ORDER BY total_points DESC, total_completed DESC, best_streak DESC LIMIT ?').all(guildId, limit);
}

function listAchievements(guildId, userId) {
  const unlocked = new Set(db.prepare('SELECT achievement_id FROM achievements WHERE guild_id = ? AND user_id = ?').all(guildId, userId).map(x => x.achievement_id));
  return ACHIEVEMENTS.map(a => ({ ...a, unlocked: unlocked.has(a.id) }));
}

module.exports = { todayKey, generateDailyQuests, progress, completeEventQuest, awardCompletion, dailyStatus, leaderboard, listAchievements, evaluateAchievements, ACHIEVEMENTS };
