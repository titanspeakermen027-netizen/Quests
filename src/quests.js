const crypto = require('node:crypto');
const { db, ensureUser, getSetting, setSetting } = require('./db');

const DAILY_QUEST_POOL = [
  { id: 'd_messages_25', type: 'messages', title: 'محادثات اليوم', description: 'أرسل 25 رسالة مفيدة في السيرفر.', target: 25, reward: 25 },
  { id: 'd_messages_50', type: 'messages', title: 'متحدث نشيط', description: 'أرسل 50 رسالة مفيدة في السيرفر.', target: 50, reward: 45 },
  { id: 'd_messages_100', type: 'messages', title: 'حضور قوي', description: 'أرسل 100 رسالة مفيدة في السيرفر.', target: 100, reward: 80 },
  { id: 'd_reactions_8', type: 'reactions', title: 'روح التفاعل', description: 'أضف 8 تفاعلات على رسائل الأعضاء.', target: 8, reward: 20 },
  { id: 'd_reactions_15', type: 'reactions', title: 'متفاعل دائم', description: 'أضف 15 تفاعلاً على رسائل الأعضاء.', target: 15, reward: 34 },
  { id: 'd_voice_20', type: 'voice_minutes', title: 'جلسة صوتية', description: 'اقضِ 20 دقيقة في القنوات الصوتية.', target: 20, reward: 30 },
  { id: 'd_voice_45', type: 'voice_minutes', title: 'رفيق الجلسات', description: 'اقضِ 45 دقيقة في القنوات الصوتية.', target: 45, reward: 60 },
  { id: 'd_events_1', type: 'events', title: 'مشاركة في فعالية', description: 'شارك في فعالية واحدة ينظمها السيرفر.', target: 1, reward: 50 },
  { id: 'd_commands_5', type: 'commands', title: 'مستكشف البوت', description: 'استخدم 5 أوامر تفاعلية للبوت اليوم.', target: 5, reward: 20 },
  { id: 'd_unique_channels_3', type: 'unique_channels', title: 'جولة في السيرفر', description: 'تفاعل في 3 قنوات مختلفة اليوم.', target: 3, reward: 35 },
  { id: 'd_unique_channels_5', type: 'unique_channels', title: 'موجود في كل مكان', description: 'تفاعل في 5 قنوات مختلفة اليوم.', target: 5, reward: 55 }
];

const WEEKLY_QUEST_POOL = [
  { id: 'w_messages_250', type: 'messages', title: 'نشاط الأسبوع', description: 'أرسل 250 رسالة مفيدة خلال الأسبوع.', target: 250, reward: 120 },
  { id: 'w_messages_600', type: 'messages', title: 'صوت المجتمع', description: 'أرسل 600 رسالة مفيدة خلال الأسبوع.', target: 600, reward: 250 },
  { id: 'w_reactions_40', type: 'reactions', title: 'تفاعل أسبوعي', description: 'أضف 40 تفاعلاً خلال الأسبوع.', target: 40, reward: 90 },
  { id: 'w_voice_180', type: 'voice_minutes', title: 'وقت المجتمع', description: 'اقضِ 180 دقيقة في القنوات الصوتية خلال الأسبوع.', target: 180, reward: 180 },
  { id: 'w_events_3', type: 'events', title: 'فعاليات الأسبوع', description: 'شارك في 3 فعاليات خلال الأسبوع.', target: 3, reward: 220 },
  { id: 'w_commands_20', type: 'commands', title: 'مستخدم متفاعل', description: 'استخدم 20 أمراً خلال الأسبوع.', target: 20, reward: 80 },
  { id: 'w_channels_10', type: 'unique_channels', title: 'متواجد في المجتمع', description: 'تفاعل في 10 قنوات مختلفة خلال الأسبوع.', target: 10, reward: 140 }
];

const SEASONAL_QUEST_POOL = [
  { id: 's_messages_1000', type: 'messages', title: 'حضور الموسم', description: 'أرسل 1000 رسالة مفيدة خلال الموسم.', target: 1000, reward: 500 },
  { id: 's_messages_2500', type: 'messages', title: 'صوت بارز', description: 'أرسل 2500 رسالة مفيدة خلال الموسم.', target: 2500, reward: 900 },
  { id: 's_reactions_150', type: 'reactions', title: 'قوة التفاعل', description: 'أضف 150 تفاعلاً خلال الموسم.', target: 150, reward: 400 },
  { id: 's_voice_1000', type: 'voice_minutes', title: 'رفيق المجتمع', description: 'اقضِ 1000 دقيقة في القنوات الصوتية خلال الموسم.', target: 1000, reward: 700 },
  { id: 's_events_10', type: 'events', title: 'صديق الفعاليات', description: 'شارك في 10 فعاليات خلال الموسم.', target: 10, reward: 850 },
  { id: 's_commands_100', type: 'commands', title: 'مستكشف محترف', description: 'استخدم 100 أمر خلال الموسم.', target: 100, reward: 350 },
  { id: 's_channels_25', type: 'unique_channels', title: 'أينما كان المجتمع', description: 'تفاعل في 25 قناة مختلفة خلال الموسم.', target: 25, reward: 600 }
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
  { id: 'perfect_week', icon: '🌈', name: 'أسبوع مثالي', description: 'أكمل جميع مهام اليوم لمدة 7 أيام مختلفة.' },
  { id: 'level_10', icon: '🚀', name: 'المستوى 10', description: 'صل إلى المستوى 10.' },
  { id: 'level_25', icon: '💫', name: 'النخبة', description: 'صل إلى المستوى 25.' }
];

function timezone() {
  return process.env.TIMEZONE || 'Africa/Casablanca';
}

function getLocalDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  return Object.fromEntries(parts.map(item => [item.type, item.value]));
}

function todayKey(date = new Date()) {
  const parts = getLocalDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseDateKey(key) {
  const [year, month, day] = String(key).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function previousDayKey(dateKey) {
  const date = parseDateKey(dateKey);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function weekKey(date = new Date()) {
  const value = parseDateKey(todayKey(date));
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((value - yearStart) / 86400000) + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function numberSetting(guildId, key, envName, fallback, min, max) {
  const raw = getSetting(guildId, key, process.env[envName]);
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function dailyQuestCount(guildId) {
  return numberSetting(guildId, 'daily_quest_count', 'DAILY_QUEST_COUNT', 5, 3, 8);
}

function weeklyQuestCount(guildId) {
  return numberSetting(guildId, 'weekly_quest_count', 'WEEKLY_QUEST_COUNT', 4, 2, 7);
}

function levelXp(guildId) {
  return numberSetting(guildId, 'level_xp', 'LEVEL_XP', 1000, 100, 100000);
}

function xpFromPoints(points) {
  return Math.max(0, points) * 10;
}

function levelFromPoints(guildId, points) {
  return Math.floor(xpFromPoints(points) / levelXp(guildId)) + 1;
}

function generateQuestSet(tableName, guildId, periodKey, pool, count, periodColumn) {
  const exists = db.prepare(
    `SELECT COUNT(*) AS count FROM ${tableName}
     WHERE guild_id = ? AND ${periodColumn} = ?`
  ).get(guildId, periodKey).count;

  if (exists) {
    return db.prepare(
      `SELECT * FROM ${tableName}
       WHERE guild_id = ? AND ${periodColumn} = ? ORDER BY rowid`
    ).all(guildId, periodKey);
  }

  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const selected = [];
  const usedTypes = new Set();

  for (const quest of shuffled) {
    if (selected.length >= count) break;
    if (usedTypes.has(quest.type)) continue;
    selected.push(quest);
    usedTypes.add(quest.type);
  }

  for (const quest of shuffled) {
    if (selected.length >= count) break;
    if (!selected.some(item => item.id === quest.id)) selected.push(quest);
  }

  const insert = db.prepare(
    `INSERT OR IGNORE INTO ${tableName}
     (guild_id, ${periodColumn}, quest_id, type, title, description, target, reward_points)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  db.transaction(() => {
    for (const quest of selected) {
      insert.run(guildId, periodKey, quest.id, quest.type, quest.title, quest.description, quest.target, quest.reward);
    }
  })();

  return db.prepare(
    `SELECT * FROM ${tableName}
     WHERE guild_id = ? AND ${periodColumn} = ? ORDER BY rowid`
  ).all(guildId, periodKey);
}

function generateDailyQuests(guildId, date = todayKey()) {
  return generateQuestSet('daily_quests', guildId, date, DAILY_QUEST_POOL, dailyQuestCount(guildId), 'quest_date');
}

function generateWeeklyQuests(guildId, key = weekKey()) {
  return generateQuestSet('weekly_quests', guildId, key, WEEKLY_QUEST_POOL, weeklyQuestCount(guildId), 'week_key');
}

function defaultSeasonDates() {
  const today = todayKey();
  const [year, month] = today.split('-').map(Number);
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start, end, name: `الموسم ${year}-${String(month).padStart(2, '0')}` };
}

function seasonInfo(guildId) {
  const defaults = defaultSeasonDates();
  const start = getSetting(guildId, 'season_start', process.env.SEASON_START || defaults.start);
  const end = getSetting(guildId, 'season_end', process.env.SEASON_END || defaults.end);
  const name = getSetting(guildId, 'season_name', process.env.SEASON_NAME || defaults.name);
  const seasonId = `${start}_${end}`;

  db.prepare(`
    INSERT OR IGNORE INTO seasons (guild_id, season_id, name, start_date, end_date)
    VALUES (?, ?, ?, ?, ?)
  `).run(guildId, seasonId, name, start, end);

  return { seasonId, name, startDate: start, endDate: end };
}

function isSeasonActive(info, date = todayKey()) {
  return date >= info.startDate && date <= info.endDate;
}

function generateSeasonalQuests(guildId, info = seasonInfo(guildId)) {
  return generateQuestSet(
    'seasonal_quests',
    guildId,
    info.seasonId,
    SEASONAL_QUEST_POOL,
    SEASONAL_QUEST_POOL.length,
    'season_id'
  );
}

function progressTable(scope) {
  return scope === 'daily' ? 'user_quest_progress'
    : scope === 'weekly' ? 'user_weekly_progress'
      : 'user_seasonal_progress';
}

function completionTable(scope) {
  return scope === 'daily' ? 'completions'
    : scope === 'weekly' ? 'weekly_completions'
      : 'seasonal_completions';
}

function periodColumn(scope) {
  return scope === 'daily' ? 'quest_date'
    : scope === 'weekly' ? 'week_key'
      : 'season_id';
}

function getProgressForScope(scope, guildId, userId, periodKey, questId) {
  const table = progressTable(scope);
  const column = periodColumn(scope);
  return db.prepare(
    `SELECT progress FROM ${table}
     WHERE guild_id = ? AND ${column} = ? AND quest_id = ? AND user_id = ?`
  ).get(guildId, periodKey, questId, userId)?.progress || 0;
}

function getCompletedSet(scope, guildId, userId, periodKey) {
  const table = completionTable(scope);
  const column = periodColumn(scope);
  return new Set(
    db.prepare(
      `SELECT quest_id FROM ${table}
       WHERE guild_id = ? AND ${column} = ? AND user_id = ?`
    ).all(guildId, periodKey, userId).map(row => row.quest_id)
  );
}

function uniqueChannelWasNew(scope, guildId, userId, periodKey, channelId) {
  const table = scope === 'daily' ? 'daily_channel_hits'
    : scope === 'weekly' ? 'weekly_channel_hits'
      : 'seasonal_channel_hits';
  const column = periodColumn(scope);
  return db.prepare(
    `INSERT OR IGNORE INTO ${table}
     (guild_id, user_id, ${column}, channel_id) VALUES (?, ?, ?, ?)`
  ).run(guildId, userId, periodKey, channelId).changes > 0;
}

function incrementQuestScope(scope, guildId, userId, quests, periodKey, amount, meta) {
  if (!quests.length) return [];

  if (meta.trackUniqueChannel) {
    if (!meta.channelId) return [];
    if (!uniqueChannelWasNew(scope, guildId, userId, periodKey, meta.channelId)) return [];
    amount = 1;
  }

  const table = progressTable(scope);
  const column = periodColumn(scope);
  const completeTable = completionTable(scope);
  const completed = getCompletedSet(scope, guildId, userId, periodKey);
  const newlyCompleted = [];

  const upsert = db.prepare(
    `INSERT INTO ${table}
     (guild_id, ${column}, quest_id, user_id, progress)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(guild_id, ${column}, quest_id, user_id)
     DO UPDATE SET progress = excluded.progress`
  );

  const markCompleted = db.prepare(
    `INSERT OR IGNORE INTO ${completeTable}
     (guild_id, ${column}, quest_id, user_id, completed_at)
     VALUES (?, ?, ?, ?, ?)`
  );

  for (const quest of quests) {
    if (completed.has(quest.quest_id)) continue;
    const current = getProgressForScope(scope, guildId, userId, periodKey, quest.quest_id);
    const next = Math.min(quest.target, current + Math.max(1, amount));
    upsert.run(guildId, periodKey, quest.quest_id, userId, next);

    if (next >= quest.target && markCompleted.run(guildId, periodKey, quest.quest_id, userId, Date.now()).changes) {
      newlyCompleted.push({ ...quest, scope, periodKey });
    }
  }

  return newlyCompleted;
}

function recordMessageEligibility(guildId, userId, content) {
  const now = Date.now();
  const cooldownMs = Math.max(
    0,
    Number.parseInt(process.env.MESSAGE_PROGRESS_COOLDOWN_SECONDS || '8', 10)
  ) * 1000;
  const clean = String(content || '').trim().replace(/\s+/g, ' ');
  if (clean.length < 3) return false;

  const hash = crypto.createHash('sha256').update(clean.toLowerCase()).digest('hex');
  const previous = db.prepare(
    'SELECT last_message_at, last_message_hash FROM activity_guard WHERE guild_id = ? AND user_id = ?'
  ).get(guildId, userId);

  if (previous?.last_message_hash === hash) return false;
  if (previous?.last_message_at && now - previous.last_message_at < cooldownMs) return false;

  db.prepare(`
    INSERT INTO activity_guard (guild_id, user_id, last_message_at, last_message_hash)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id)
    DO UPDATE SET last_message_at = excluded.last_message_at, last_message_hash = excluded.last_message_hash
  `).run(guildId, userId, now, hash);

  return true;
}

function progress(guildId, userId, type, amount = 1, meta = {}) {
  ensureUser(guildId, userId);
  const date = todayKey();
  const week = weekKey();
  const season = seasonInfo(guildId);
  const completed = [];

  completed.push(...incrementQuestScope(
    'daily', guildId, userId,
    generateDailyQuests(guildId, date).filter(item => item.type === type),
    date, amount, { ...meta, trackUniqueChannel: type === 'unique_channels' }
  ));

  completed.push(...incrementQuestScope(
    'weekly', guildId, userId,
    generateWeeklyQuests(guildId, week).filter(item => item.type === type),
    week, amount, { ...meta, trackUniqueChannel: type === 'unique_channels' }
  ));

  if (isSeasonActive(season, date)) {
    completed.push(...incrementQuestScope(
      'seasonal', guildId, userId,
      generateSeasonalQuests(guildId, season).filter(item => item.type === type),
      season.seasonId, amount, { ...meta, trackUniqueChannel: type === 'unique_channels' }
    ));
  }

  return completed;
}

function completeEventQuest(guildId, userId) {
  return progress(guildId, userId, 'events', 1);
}

function unlockAchievement(guildId, userId, achievementId) {
  return db.prepare(
    `INSERT OR IGNORE INTO achievements
     (guild_id, user_id, achievement_id, unlocked_at)
     VALUES (?, ?, ?, ?)`
  ).run(guildId, userId, achievementId, Date.now()).changes > 0;
}

function evaluateAchievements(guildId, userId) {
  const user = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  if (!user) return [];

  const checks = [
    ['first_quest', user.total_completed >= 1],
    ['ten_quests', user.total_completed >= 10],
    ['fifty_quests', user.total_completed >= 50],
    ['hundred_quests', user.total_completed >= 100],
    ['streak_7', user.best_streak >= 7],
    ['streak_30', user.best_streak >= 30],
    ['first_box', user.boxes_opened >= 1],
    ['boxes_5', user.boxes_opened >= 5],
    ['points_250', user.total_points >= 250],
    ['points_1000', user.total_points >= 1000],
    ['level_10', levelFromPoints(guildId, user.total_points) >= 10],
    ['level_25', levelFromPoints(guildId, user.total_points) >= 25]
  ];

  const unlocked = [];
  for (const [id, condition] of checks) {
    if (condition && unlockAchievement(guildId, userId, id)) {
      unlocked.push(ACHIEVEMENTS.find(item => item.id === id));
    }
  }

  const date = todayKey();
  const totalDaily = generateDailyQuests(guildId, date).length;
  const completedDaily = db.prepare(
    `SELECT COUNT(*) AS count FROM completions
     WHERE guild_id = ? AND quest_date = ? AND user_id = ?`
  ).get(guildId, date, userId).count;

  if (totalDaily > 0 && completedDaily >= totalDaily && unlockAchievement(guildId, userId, 'all_daily')) {
    unlocked.push(ACHIEVEMENTS.find(item => item.id === 'all_daily'));
  }

  const perfectDays = db.prepare(
    `SELECT COUNT(*) AS count FROM daily_rewards
     WHERE guild_id = ? AND user_id = ? AND box_awarded = 1`
  ).get(guildId, userId).count;

  if (perfectDays >= 7 && unlockAchievement(guildId, userId, 'perfect_week')) {
    unlocked.push(ACHIEVEMENTS.find(item => item.id === 'perfect_week'));
  }

  return unlocked.filter(Boolean);
}

function applyDailyStreak(guildId, userId, date) {
  const user = db.prepare(
    'SELECT last_active_day, streak, best_streak FROM users WHERE guild_id = ? AND user_id = ?'
  ).get(guildId, userId);

  let streak = user.streak;
  if (user.last_active_day !== date) {
    streak = user.last_active_day === previousDayKey(date) ? user.streak + 1 : 1;
  }

  db.prepare(
    `UPDATE users SET last_active_day = ?, streak = ?, best_streak = MAX(best_streak, ?)
     WHERE guild_id = ? AND user_id = ?`
  ).run(date, streak, streak, guildId, userId);

  return streak;
}

function logPoints(guildId, userId, points, source, periodType, periodKey) {
  if (points <= 0) return;
  db.prepare(
    `INSERT INTO point_ledger
     (guild_id, user_id, points, source, period_type, period_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(guildId, userId, points, source, periodType, periodKey, Date.now());
}

function availableLevelRewards(guildId, oldLevel, newLevel) {
  if (newLevel <= oldLevel) return [];
  return db.prepare(
    `SELECT level, role_id FROM level_rewards
     WHERE guild_id = ? AND level > ? AND level <= ? ORDER BY level ASC`
  ).all(guildId, oldLevel, newLevel);
}

function logCurrentPeriods(guildId, userId, points, source) {
  logPoints(guildId, userId, points, source, 'weekly', weekKey());
  const season = seasonInfo(guildId);
  if (isSeasonActive(season)) {
    logPoints(guildId, userId, points, source, 'seasonal', season.seasonId);
  }
}

function grantPoints(guildId, userId, points, source = 'bonus', options = {}) {
  if (!Number.isFinite(points) || points <= 0) {
    return { points: 0, oldLevel: null, newLevel: null, levelRewards: [], achievements: [] };
  }

  ensureUser(guildId, userId);
  const before = profile(guildId, userId);
  const oldLevel = before.level;

  db.prepare(
    'UPDATE users SET total_points = total_points + ? WHERE guild_id = ? AND user_id = ?'
  ).run(points, guildId, userId);

  const after = profile(guildId, userId);
  const newLevel = levelFromPoints(guildId, after.total_points);

  logPoints(guildId, userId, points, source, options.periodType || null, options.periodKey || null);
  if (options.logCurrentPeriods !== false) logCurrentPeriods(guildId, userId, points, source);

  return {
    points,
    oldLevel,
    newLevel,
    levelRewards: availableLevelRewards(guildId, oldLevel, newLevel),
    achievements: evaluateAchievements(guildId, userId)
  };
}

function awardCompletion(guildId, userId, completedQuests) {
  if (!completedQuests.length) {
    const current = profile(guildId, userId);
    return {
      points: 0,
      achievements: [],
      boxAwarded: false,
      streak: current.streak,
      oldLevel: current.level,
      newLevel: current.level,
      levelRewards: []
    };
  }

  ensureUser(guildId, userId);
  const totalPoints = completedQuests.reduce((sum, quest) => sum + quest.reward_points, 0);
  const before = profile(guildId, userId);
  const oldLevel = before.level;

  db.transaction(() => {
    db.prepare(
      `UPDATE users SET total_completed = total_completed + ?, total_points = total_points + ?
       WHERE guild_id = ? AND user_id = ?`
    ).run(completedQuests.length, totalPoints, guildId, userId);

    for (const quest of completedQuests) {
      const source = `${quest.scope}:${quest.quest_id}`;
      logPoints(guildId, userId, quest.reward_points, source, quest.scope, quest.periodKey);
      logCurrentPeriods(guildId, userId, quest.reward_points, source);
    }
  })();

  const date = todayKey();
  const hasDailyCompletion = completedQuests.some(quest => quest.scope === 'daily');
  const streak = hasDailyCompletion ? applyDailyStreak(guildId, userId, date) : before.streak;

  const dailyTotal = generateDailyQuests(guildId, date).length;
  const dailyDone = db.prepare(
    `SELECT COUNT(*) AS count FROM completions
     WHERE guild_id = ? AND quest_date = ? AND user_id = ?`
  ).get(guildId, date, userId).count;

  let boxAwarded = false;
  if (dailyTotal > 0 && dailyDone >= dailyTotal) {
    const result = db.prepare(
      `INSERT OR IGNORE INTO daily_rewards (guild_id, user_id, quest_date, box_awarded)
       VALUES (?, ?, ?, 1)`
    ).run(guildId, userId, date);

    if (result.changes) {
      db.prepare(
        'UPDATE users SET boxes_earned = boxes_earned + 1 WHERE guild_id = ? AND user_id = ?'
      ).run(guildId, userId);
      boxAwarded = true;
    }
  }

  const after = profile(guildId, userId);
  return {
    points: totalPoints,
    achievements: evaluateAchievements(guildId, userId),
    boxAwarded,
    streak,
    oldLevel,
    newLevel: after.level,
    levelRewards: availableLevelRewards(guildId, oldLevel, after.level)
  };
}

function dailyStatus(guildId, userId) {
  ensureUser(guildId, userId);
  const date = todayKey();
  const quests = generateDailyQuests(guildId, date).map(quest => ({
    ...quest,
    progress: getProgressForScope('daily', guildId, userId, date, quest.quest_id)
  }));
  return { date, quests, done: getCompletedSet('daily', guildId, userId, date), user: profile(guildId, userId) };
}

function weeklyStatus(guildId, userId) {
  ensureUser(guildId, userId);
  const key = weekKey();
  const quests = generateWeeklyQuests(guildId, key).map(quest => ({
    ...quest,
    progress: getProgressForScope('weekly', guildId, userId, key, quest.quest_id)
  }));
  return { key, quests, done: getCompletedSet('weekly', guildId, userId, key) };
}

function seasonalStatus(guildId, userId) {
  ensureUser(guildId, userId);
  const info = seasonInfo(guildId);
  if (!isSeasonActive(info)) return { active: false, info, quests: [], done: new Set(), points: 0 };

  const quests = generateSeasonalQuests(guildId, info).map(quest => ({
    ...quest,
    progress: getProgressForScope('seasonal', guildId, userId, info.seasonId, quest.quest_id)
  }));
  const points = db.prepare(
    `SELECT COALESCE(SUM(points), 0) AS points FROM point_ledger
     WHERE guild_id = ? AND user_id = ? AND period_type = 'seasonal' AND period_key = ?`
  ).get(guildId, userId, info.seasonId).points;

  return {
    active: true,
    info,
    quests,
    done: getCompletedSet('seasonal', guildId, userId, info.seasonId),
    points
  };
}

function profile(guildId, userId) {
  ensureUser(guildId, userId);
  const user = db.prepare(
    `SELECT *, MAX(boxes_earned - boxes_opened, 0) AS boxes_balance
     FROM users WHERE guild_id = ? AND user_id = ?`
  ).get(guildId, userId);

  user.xp = xpFromPoints(user.total_points);
  user.level = levelFromPoints(guildId, user.total_points);
  user.levelXp = levelXp(guildId);
  user.levelProgressXp = user.xp % user.levelXp;
  user.levelProgressPercent = Math.floor((user.levelProgressXp / user.levelXp) * 100);
  return user;
}

function leaderboard(guildId, scope = 'all', limit = 10) {
  if (scope === 'weekly') {
    return db.prepare(
      `SELECT user_id, SUM(points) AS points
       FROM point_ledger
       WHERE guild_id = ? AND period_type = 'weekly' AND period_key = ?
       GROUP BY user_id ORDER BY points DESC LIMIT ?`
    ).all(guildId, weekKey(), limit);
  }

  if (scope === 'seasonal') {
    const info = seasonInfo(guildId);
    if (!isSeasonActive(info)) return [];
    return db.prepare(
      `SELECT user_id, SUM(points) AS points
       FROM point_ledger
       WHERE guild_id = ? AND period_type = 'seasonal' AND period_key = ?
       GROUP BY user_id ORDER BY points DESC LIMIT ?`
    ).all(guildId, info.seasonId, limit);
  }

  return db.prepare(
    `SELECT user_id, total_completed, total_points, streak, best_streak, boxes_opened
     FROM users WHERE guild_id = ?
     ORDER BY total_points DESC, total_completed DESC, best_streak DESC LIMIT ?`
  ).all(guildId, limit);
}

function listAchievements(guildId, userId) {
  ensureUser(guildId, userId);
  const unlocked = new Set(
    db.prepare('SELECT achievement_id FROM achievements WHERE guild_id = ? AND user_id = ?')
      .all(guildId, userId).map(row => row.achievement_id)
  );
  return ACHIEVEMENTS.map(item => ({ ...item, unlocked: unlocked.has(item.id) }));
}

function consumeMysteryBox(guildId, userId) {
  ensureUser(guildId, userId);
  const user = profile(guildId, userId);
  if (user.boxes_balance <= 0) return false;

  const result = db.prepare(
    `UPDATE users SET boxes_opened = boxes_opened + 1
     WHERE guild_id = ? AND user_id = ? AND boxes_opened < boxes_earned`
  ).run(guildId, userId);

  if (!result.changes) return false;
  evaluateAchievements(guildId, userId);
  return true;
}

function setGuildSetting(guildId, key, value) {
  setSetting(guildId, key, value);
  return getSetting(guildId, key);
}

function getLevelRewards(guildId) {
  return db.prepare(
    'SELECT level, role_id FROM level_rewards WHERE guild_id = ? ORDER BY level ASC'
  ).all(guildId);
}

function addLevelReward(guildId, level, roleId) {
  db.prepare(
    `INSERT INTO level_rewards (guild_id, level, role_id)
     VALUES (?, ?, ?)
     ON CONFLICT(guild_id, level) DO UPDATE SET role_id = excluded.role_id`
  ).run(guildId, level, roleId);
}

function removeLevelReward(guildId, level) {
  return db.prepare(
    'DELETE FROM level_rewards WHERE guild_id = ? AND level = ?'
  ).run(guildId, level).changes > 0;
}

function eventStatus(guildId, eventId) {
  return db.prepare(
    'SELECT * FROM events WHERE guild_id = ? AND event_id = ?'
  ).get(guildId, eventId);
}

function createEvent(guildId, data) {
  const active = db.prepare(
    `SELECT * FROM events
     WHERE guild_id = ? AND status = 'active' AND ends_at > ? LIMIT 1`
  ).get(guildId, Date.now());
  if (active) return { error: 'active_event', event: active };

  const eventId = crypto.randomBytes(8).toString('hex');
  db.prepare(
    `INSERT INTO events
     (guild_id, event_id, title, description, channel_id, reward_points, starts_at, ends_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`
  ).run(
    guildId,
    eventId,
    data.title,
    data.description,
    data.channelId,
    data.rewardPoints,
    Date.now(),
    data.endsAt
  );

  return { event: eventStatus(guildId, eventId) };
}

function attachEventMessage(guildId, eventId, messageId) {
  db.prepare(
    'UPDATE events SET message_id = ? WHERE guild_id = ? AND event_id = ?'
  ).run(messageId, guildId, eventId);
}

function finishEvent(guildId, eventId, status = 'ended') {
  return db.prepare(
    `UPDATE events SET status = ?
     WHERE guild_id = ? AND event_id = ? AND status = 'active'`
  ).run(status, guildId, eventId).changes > 0;
}

function expireEvents() {
  db.prepare(
    `UPDATE events SET status = 'ended'
     WHERE status = 'active' AND ends_at <= ?`
  ).run(Date.now());
}

function joinEvent(guildId, eventId, userId) {
  const event = eventStatus(guildId, eventId);
  if (!event || event.status !== 'active' || Date.now() > event.ends_at) {
    return { ok: false, reason: 'ended' };
  }

  ensureUser(guildId, userId);
  const inserted = db.prepare(
    `INSERT OR IGNORE INTO event_participants
     (guild_id, event_id, user_id, joined_at)
     VALUES (?, ?, ?, ?)`
  ).run(guildId, eventId, userId, Date.now()).changes > 0;

  if (!inserted) return { ok: false, reason: 'already_joined', event };
  return { ok: true, event, completed: completeEventQuest(guildId, userId) };
}

function eventParticipantCount(guildId, eventId) {
  return db.prepare(
    'SELECT COUNT(*) AS count FROM event_participants WHERE guild_id = ? AND event_id = ?'
  ).get(guildId, eventId).count;
}

function activeEvent(guildId) {
  return db.prepare(
    `SELECT * FROM events
     WHERE guild_id = ? AND status = 'active' AND ends_at > ?
     ORDER BY starts_at DESC LIMIT 1`
  ).get(guildId, Date.now()) || null;
}

function helpData() {
  return {
    basics: [
      ['/help', 'عرض مساعدة البوت وجميع أنظمته وأوامره.'],
      ['/quests', 'عرض المهام اليومية والتقدم والمكافآت.'],
      ['/quests-weekly', 'عرض المهام الأسبوعية.'],
      ['/quests-season', 'عرض مهام الموسم ونقاطك الموسمية.']
    ],
    progression: [
      ['/quest-profile', 'عرض XP والمستوى والنقاط والصناديق والإنجازات.'],
      ['/quest-streak', 'عرض السلسلة الحالية وأفضل سلسلة.'],
      ['/achievements', 'عرض الإنجازات المفتوحة والمقفلة.'],
      ['/quests-top', 'عرض الترتيب العام أو الأسبوعي أو الموسمي.'],
      ['/mystery-box', 'فتح صندوق حصلت عليه بعد إكمال يوم كامل.']
    ],
    events: [
      ['/quest-event', 'إنشاء وإدارة فعالية تفاعلية بالأزرار.']
    ],
    admin: [
      ['/quest-settings', 'إدارة عدد المهام والمستويات والموسم والقنوات والمكافآت.']
    ]
  };
}

module.exports = {
  todayKey,
  weekKey,
  seasonInfo,
  isSeasonActive,
  generateDailyQuests,
  generateWeeklyQuests,
  generateSeasonalQuests,
  progress,
  completeEventQuest,
  awardCompletion,
  grantPoints,
  dailyStatus,
  weeklyStatus,
  seasonalStatus,
  profile,
  leaderboard,
  listAchievements,
  consumeMysteryBox,
  recordMessageEligibility,
  evaluateAchievements,
  setGuildSetting,
  getLevelRewards,
  addLevelReward,
  removeLevelReward,
  createEvent,
  attachEventMessage,
  finishEvent,
  expireEvents,
  joinEvent,
  eventStatus,
  eventParticipantCount,
  activeEvent,
  levelFromPoints,
  levelXp,
  helpData,
  ACHIEVEMENTS
};
