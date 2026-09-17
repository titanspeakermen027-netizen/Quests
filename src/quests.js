const crypto = require('node:crypto');
const { db, ensureUser } = require('./db');

const QUEST_POOL = [
  { id: 'messages_25', type: 'messages', title: 'محادثات اليوم', description: 'أرسل 25 رسالة مفيدة في السيرفر.', target: 25, reward: 25 },
  { id: 'messages_50', type: 'messages', title: 'متحدث نشيط', description: 'أرسل 50 رسالة مفيدة في السيرفر.', target: 50, reward: 45 },
  { id: 'messages_100', type: 'messages', title: 'حضور قوي', description: 'أرسل 100 رسالة مفيدة في السيرفر.', target: 100, reward: 80 },
  { id: 'reactions_8', type: 'reactions', title: 'روح التفاعل', description: 'أضف 8 تفاعلات على رسائل الأعضاء.', target: 8, reward: 20 },
  { id: 'reactions_20', type: 'reactions', title: 'متفاعل دائم', description: 'أضف 20 تفاعلاً على رسائل الأعضاء.', target: 20, reward: 45 },
  { id: 'voice_20', type: 'voice_minutes', title: 'جلسة صوتية', description: 'اقضِ 20 دقيقة في القنوات الصوتية.', target: 20, reward: 30 },
  { id: 'voice_45', type: 'voice_minutes', title: 'رفيق الجلسات', description: 'اقضِ 45 دقيقة في القنوات الصوتية.', target: 45, reward: 60 },
  { id: 'events_1', type: 'events', title: 'مشاركة في فعالية', description: 'شارك في فعالية واحدة ينظمها السيرفر.', target: 1, reward: 50 },
  { id: 'commands_5', type: 'commands', title: 'مستكشف البوت', description: 'استخدم 5 أوامر تفاعلية للبوت اليوم.', target: 5, reward: 20 },
  { id: 'unique_channels_3', type: 'unique_channels', title: 'جولة في السيرفر', description: 'تفاعل في 3 قنوات مختلفة اليوم.', target: 3, reward: 35 },
  { id: 'unique_channels_5', type: 'unique_channels', title: 'موجود في كل مكان', description: 'تفاعل في 5 قنوات مختلفة اليوم.', target: 5, reward: 55 },
  { id: 'messages_reactions', type: 'reactions', title: 'تفاعل مضاعف', description: 'أضف 12 تفاعلاً على رسائل الأعضاء.', target: 12, reward: 32 }
];

const ACHIEVEMENTS = [
  { id: 'first_quest', icon: '🌟', name: 'البداية', description: 'أكمل أول مهمة.' },
  { id: 'ten_quests', icon: '🎯', name: 'متقدم', description: 'أكمل 10 مهام.' },
  { id: 'fifty_quests', icon: '🏅', name: 'محترف المهام', description: 'أكمل 50 مهمة.' },
  { id: 'hundred_quests', icon: '👑', name: 'أسطورة المهام', description: 'أكمل 100 مهمة.' },
  { id: 'streak_7', icon: '🔥', name: 'أسبوع متواصل', description: 'حافظ على سلسلة لمدة 7 أيام.' },
  { id: 'streak_30', icon: '💎', name: 'سلسلة الشهر', description: 'حافظ على سلسلة لمدة 30 يوماً.' },
  { id: 'first_box', icon: '🎁', name: 'الحظ الأول', description: 'افتح أول Mystery Box.' },
  { id: 'boxes_5', icon: '📦', name: 'جامع الصناديق', description: 'افتح 5 Mystery Boxes.' },
  { id: 'all_daily', icon: '✅', name: 'يوم كامل', description: 'أكمل جميع مهام اليوم.' },
  { id: 'points_250', icon: '⭐', name: 'رصيد جيد', description: 'اجمع 250 نقطة.' },
  { id: 'points_1000', icon: '🏆', name: 'نجم المهام', description: 'اجمع 1000 نقطة.' },
  { id: 'perfect_week', icon: '🌈', name: 'أسبوع مثالي', description: 'أكمل جميع مهام اليوم لمدة 7 أيام مختلفة.' }
];

function timezone() {
  return process.env.TIMEZONE || 'Africa/Casablanca';
}

function todayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone(), year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function previousDayKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function dailyQuestCount() {
  const count = Number.parseInt(process.env.DAILY_QUEST_COUNT || '5', 10);
  return Number.isFinite(count) ? Math.max(3, Math.min(8, count)) : 5;
}

function generateDailyQuests(guildId, date = todayKey()) {
  const exists = db.prepare('SELECT COUNT(*) AS count FROM daily_quests WHERE guild_id = ? AND quest_date = ?').get(guildId, date).count;
  if (exists) return db.prepare('SELECT * FROM daily_quests WHERE guild_id = ? AND quest_date = ? ORDER BY rowid').all(guildId, date);

  const shuffled = [...QUEST_POOL].sort(() => Math.random() - 0.5);
  const selected = [];
  const usedTypes = new Set();
  for (const quest of shuffled) {
    if (selected.length >= dailyQuestCount()) break;
    if (usedTypes.has(quest.type) && quest.type !== 'messages') continue;
    selected.push(quest);
    usedTypes.add(quest.type);
  }
  for (const quest of shuffled) {
    if (selected.length >= dailyQuestCount()) break;
    if (!selected.some(item => item.id === quest.id)) selected.push(quest);
  }

  const insert = db.prepare(`INSERT OR IGNORE INTO daily_quests
    (guild_id, quest_date, quest_id, type, title, description, target, reward_points)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    for (const quest of selected) insert.run(guildId, date, quest.id, quest.type, quest.title, quest.description, quest.target, quest.reward);
  })();
  return db.prepare('SELECT * FROM daily_quests WHERE guild_id = ? AND quest_date = ? ORDER BY rowid').all(guildId, date);
}

function getProgress(guildId, userId, date, questId) {
  return db.prepare('SELECT progress FROM user_quest_progress WHERE guild_id = ? AND quest_date = ? AND quest_id = ? AND user_id = ?')
    .get(guildId, date, questId, userId)?.progress || 0;
}

function completedSet(guildId, userId, date) {
  return new Set(
    db.prepare('SELECT quest_id FROM completions WHERE guild_id = ? AND quest_date = ? AND user_id = ?')
      .all(guildId, date, userId).map(row => row.quest_id)
  );
}

function recordMessageEligibility(guildId, userId, content) {
  const now = Date.now();
  const cooldown = Math.max(0, Number.parseInt(process.env.MESSAGE_PROGRESS_COOLDOWN_SECONDS || '8', 10)) * 1000;
  const clean = String(content || '').trim();
  if (clean.length < 3) return false;
  const hash = crypto.createHash('sha256').update(clean.toLowerCase()).digest('hex');
  const previous = db.prepare('SELECT last_message_at, last_message_hash FROM activity_guard WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  if (previous?.last_message_hash === hash) return false;
  if (previous?.last_message_at && now - previous.last_message_at < cooldown) return false;
  db.prepare(`INSERT INTO activity_guard (guild_id, user_id, last_message_at, last_message_hash)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET last_message_at=excluded.last_message_at, last_message_hash=excluded.last_message_hash`)
    .run(guildId, userId, now, hash);
  return true;
}

function recordChannel(guildId, userId, date, channelId) {
  return db.prepare('INSERT OR IGNORE INTO daily_channel_hits (guild_id, user_id, quest_date, channel_id) VALUES (?, ?, ?, ?)')
    .run(guildId, userId, date, channelId).changes > 0;
}

function progress(guildId, userId, type, amount = 1, meta = {}) {
  ensureUser(guildId, userId);
  const date = todayKey();
  const quests = generateDailyQuests(guildId, date).filter(quest => quest.type === type);
  if (!quests.length) return [];

  if (type === 'unique_channels' && meta.channelId) {
    if (!recordChannel(guildId, userId, date, meta.channelId)) return [];
    amount = 1;
  }

  const completed = completedSet(guildId, userId, date);
  const newlyCompleted = [];
  const upsertProgress = db.prepare(`INSERT INTO user_quest_progress
    (guild_id, quest_date, quest_id, user_id, progress) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, quest_date, quest_id, user_id)
    DO UPDATE SET progress = MIN((SELECT target FROM daily_quests WHERE guild_id = excluded.guild_id AND quest_date = excluded.quest_date AND quest_id = excluded.quest_id), user_quest_progress.progress + excluded.progress)`);
  const insertCompletion = db.prepare('INSERT OR IGNORE INTO completions (guild_id, quest_date, quest_id, user_id, completed_at) VALUES (?, ?, ?, ?, ?)');

  for (const quest of quests) {
    if (completed.has(quest.id)) continue;
    const current = getProgress(guildId, userId, date, quest.id);
    const next = Math.min(quest.target, current + Math.max(1, amount));
    upsertProgress.run(guildId, date, quest.id, userId, Math.max(1, next));
    if (next >= quest.target && insertCompletion.run(guildId, date, quest.id, userId, Date.now()).changes) newlyCompleted.push(quest);
  }
  return newlyCompleted;
}

function completeEventQuest(guildId, userId) {
  return progress(guildId, userId, 'events', 1);
}

function unlockAchievement(guildId, userId, achievementId) {
  return db.prepare('INSERT OR IGNORE INTO achievements (guild_id, user_id, achievement_id, unlocked_at) VALUES (?, ?, ?, ?)')
    .run(guildId, userId, achievementId, Date.now()).changes > 0;
}

function evaluateAchievements(guildId, userId) {
  const user = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  if (!user) return [];
  const unlocked = [];
  const rules = [
    ['first_quest', user.total_completed >= 1],
    ['ten_quests', user.total_completed >= 10],
    ['fifty_quests', user.total_completed >= 50],
    ['hundred_quests', user.total_completed >= 100],
    ['streak_7', user.best_streak >= 7],
    ['streak_30', user.best_streak >= 30],
    ['first_box', user.boxes_opened >= 1],
    ['boxes_5', user.boxes_opened >= 5],
    ['points_250', user.total_points >= 250],
    ['points_1000', user.total_points >= 1000]
  ];
  for (const [id, ok] of rules) {
    if (ok && unlockAchievement(guildId, userId, id)) unlocked.push(ACHIEVEMENTS.find(item => item.id === id));
  }

  const date = todayKey();
  const totalToday = generateDailyQuests(guildId, date).length;
  const doneToday = db.prepare('SELECT COUNT(*) AS count FROM completions WHERE guild_id = ? AND quest_date = ? AND user_id = ?')
    .get(guildId, date, userId).count;
  if (totalToday > 0 && doneToday >= totalToday && unlockAchievement(guildId, userId, 'all_daily')) {
    unlocked.push(ACHIEVEMENTS.find(item => item.id === 'all_daily'));
  }

  const perfectDays = db.prepare(`SELECT COUNT(*) AS count FROM daily_rewards WHERE guild_id = ? AND user_id = ? AND box_awarded = 1`)
    .get(guildId, userId).count;
  if (perfectDays >= 7 && unlockAchievement(guildId, userId, 'perfect_week')) {
    unlocked.push(ACHIEVEMENTS.find(item => item.id === 'perfect_week'));
  }
  return unlocked.filter(Boolean);
}

function applyDailyStreak(guildId, userId, date) {
  const user = db.prepare('SELECT last_active_day, streak, best_streak FROM users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  let streak = user.streak;
  if (user.last_active_day !== date) streak = user.last_active_day === previousDayKey(date) ? user.streak + 1 : 1;
  db.prepare('UPDATE users SET last_active_day = ?, streak = ?, best_streak = MAX(best_streak, ?) WHERE guild_id = ? AND user_id = ?')
    .run(date, streak, streak, guildId, userId);
  return streak;
}

function awardCompletion(guildId, userId, completedQuests) {
  if (!completedQuests.length) return { points: 0, achievements: [], boxAwarded: false, streak: null };
  ensureUser(guildId, userId);
  const points = completedQuests.reduce((sum, quest) => sum + quest.reward_points, 0);
  db.prepare('UPDATE users SET total_completed = total_completed + ?, total_points = total_points + ? WHERE guild_id = ? AND user_id = ?')
    .run(completedQuests.length, points, guildId, userId);

  const date = todayKey();
  const streak = applyDailyStreak(guildId, userId, date);
  const totalToday = generateDailyQuests(guildId, date).length;
  const doneToday = db.prepare('SELECT COUNT(*) AS count FROM completions WHERE guild_id = ? AND quest_date = ? AND user_id = ?')
    .get(guildId, date, userId).count;
  let boxAwarded = false;
  if (doneToday >= totalToday && totalToday > 0) {
    const result = db.prepare('INSERT OR IGNORE INTO daily_rewards (guild_id, user_id, quest_date, box_awarded) VALUES (?, ?, ?, 1)')
      .run(guildId, userId, date);
    if (result.changes) {
      db.prepare('UPDATE users SET boxes_earned = boxes_earned + 1 WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
      boxAwarded = true;
    }
  }
  return { points, achievements: evaluateAchievements(guildId, userId), boxAwarded, streak };
}

function dailyStatus(guildId, userId) {
  ensureUser(guildId, userId);
  const date = todayKey();
  const quests = generateDailyQuests(guildId, date).map(quest => ({ ...quest, progress: getProgress(guildId, userId, date, quest.quest_id) }));
  const done = completedSet(guildId, userId, date);
  const user = db.prepare('SELECT *, MAX(boxes_earned - boxes_opened, 0) AS boxes_balance FROM users WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId);
  return { date, quests, done, user };
}

function profile(guildId, userId) {
  ensureUser(guildId, userId);
  return db.prepare('SELECT *, MAX(boxes_earned - boxes_opened, 0) AS boxes_balance FROM users WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId);
}

function leaderboard(guildId, limit = 10) {
  return db.prepare(`SELECT user_id, total_completed, total_points, streak, best_streak, boxes_opened
    FROM users WHERE guild_id = ?
    ORDER BY total_points DESC, total_completed DESC, best_streak DESC LIMIT ?`).all(guildId, limit);
}

function listAchievements(guildId, userId) {
  ensureUser(guildId, userId);
  const unlocked = new Set(db.prepare('SELECT achievement_id FROM achievements WHERE guild_id = ? AND user_id = ?')
    .all(guildId, userId).map(row => row.achievement_id));
  return ACHIEVEMENTS.map(achievement => ({ ...achievement, unlocked: unlocked.has(achievement.id) }));
}

function consumeMysteryBox(guildId, userId) {
  ensureUser(guildId, userId);
  const user = profile(guildId, userId);
  if (user.boxes_balance <= 0) return false;
  db.prepare('UPDATE users SET boxes_opened = boxes_opened + 1 WHERE guild_id = ? AND user_id = ? AND boxes_opened < boxes_earned')
    .run(guildId, userId);
  return true;
}

module.exports = {
  todayKey,
  generateDailyQuests,
  progress,
  completeEventQuest,
  awardCompletion,
  dailyStatus,
  profile,
  leaderboard,
  listAchievements,
  evaluateAchievements,
  consumeMysteryBox,
  recordMessageEligibility,
  ACHIEVEMENTS,
  getProgress
};
