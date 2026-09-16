require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');
const { db, ensureUser } = require('./db');
const { dailyStatus, leaderboard, progress, completeEventQuest, awardCompletion, listAchievements, evaluateAchievements } = require('./quests');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildVoiceStates]
});

const commands = [
  new SlashCommandBuilder().setName('quests').setDescription('عرض مهامك اليومية وتقدمك.'),
  new SlashCommandBuilder().setName('quests-top').setDescription('عرض ترتيب أكثر الأعضاء إنجازاً للمهام.'),
  new SlashCommandBuilder().setName('quest-streak').setDescription('عرض سلسلة إنجاز المهام الخاصة بك.'),
  new SlashCommandBuilder().setName('achievements').setDescription('عرض إنجازاتك التي فتحتها.'),
  new SlashCommandBuilder().setName('mystery-box').setDescription('فتح الصندوق الغامض والحصول على مكافأة عشوائية.'),
  new SlashCommandBuilder().setName('event-complete').setDescription('تسجيل مشاركة عضو في فعالية.')
    .addUserOption(o => o.setName('user').setDescription('العضو الذي شارك في الفعالية.').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
];

function rewardRoles() {
  return (process.env.MYSTERY_BOX_ROLE_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
}

function progressBar(current, target) {
  const size = 10;
  const filled = Math.round(Math.min(current / target, 1) * size);
  return `${'█'.repeat(filled)}${'░'.repeat(size - filled)} ${Math.min(current, target)}/${target}`;
}

async function notifyAchievements(user, achievements) {
  if (!achievements.length) return;
  const text = achievements.map(a => `🏅 **${a.name}** — ${a.description}`).join('\n');
  await user.send(`🎉 **إنجاز جديد!**\n\n${text}`).catch(() => {});
}

async function registerProgress(guildId, userId, type, amount = 1, userForDm = null) {
  const completed = progress(guildId, userId, type, amount);
  if (!completed.length) return;
  const result = awardCompletion(guildId, userId, completed);
  if (result.achievements.length && userForDm) await notifyAchievements(userForDm, result.achievements);
}

client.once('ready', async () => {
  await client.application.commands.set(commands.map(c => c.toJSON()), process.env.GUILD_ID || undefined);
  console.log(`✅ تم تسجيل الدخول باسم ${client.user.tag}`);
});

client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;
  await registerProgress(message.guild.id, message.author.id, 'messages', 1, message.author);
});

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot || !reaction.message.guild) return;
  await registerProgress(reaction.message.guild.id, user.id, 'reactions', 1, user);
});

client.on('voiceStateUpdate', (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;
  if (!oldState.channelId && newState.channelId) member.__questsVoiceStarted = Date.now();
  if (oldState.channelId && !newState.channelId && member.__questsVoiceStarted) {
    const minutes = Math.floor((Date.now() - member.__questsVoiceStarted) / 60000);
    if (minutes > 0) registerProgress(oldState.guild.id, member.id, 'voice_minutes', minutes, member.user);
    delete member.__questsVoiceStarted;
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;
  ensureUser(interaction.guildId, interaction.user.id);

  // Every command interaction contributes to command-based daily quests.
  await registerProgress(interaction.guildId, interaction.user.id, 'commands', 1, interaction.user);

  try {
    if (interaction.commandName === 'quests') {
      const s = dailyStatus(interaction.guildId, interaction.user.id);
      const lines = s.quests.map(q => `${s.done.has(q.quest_id) ? '✅' : '▫️'} **${q.title}**\n${q.description}\n${progressBar(q.progress, q.target)} · ⭐ ${q.reward_points}`);
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle('📋 مهامك اليومية').setDescription(lines.join('\n\n')).setColor(0x5865F2).setFooter({ text: `اليوم: ${s.date} • المكتمل: ${s.done.size}/${s.quests.length}` })] });
    }

    if (interaction.commandName === 'quests-top') {
      const rows = leaderboard(interaction.guildId, 10);
      const lines = rows.length ? rows.map((r, i) => `**${i + 1}.** <@${r.user_id}> — 🏆 ${r.total_completed} مهمة · ⭐ ${r.total_points} نقطة · 🔥 ${r.streak} يوم`).join('\n') : 'لا توجد بيانات حتى الآن.';
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🏆 Quest Leaderboard').setDescription(lines).setColor(0xF1C40F)] });
    }

    if (interaction.commandName === 'quest-streak') {
      const u = db.prepare('SELECT streak, best_streak, total_completed, total_points FROM users WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, interaction.user.id);
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🏆 Quest Streak').setDescription(`🔥 السلسلة الحالية: **${u.streak} يوم**\n🏅 أعلى سلسلة: **${u.best_streak} يوم**\n✅ إجمالي المهام: **${u.total_completed}**\n⭐ إجمالي النقاط: **${u.total_points}**`).setColor(0x57F287)] });
    }

    if (interaction.commandName === 'achievements') {
      const items = listAchievements(interaction.guildId, interaction.user.id);
      const text = items.map(a => `${a.unlocked ? '✅' : '🔒'} **${a.name}** — ${a.description}`).join('\n');
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🏅 Achievements').setDescription(text).setColor(0xEB459E)] });
    }

    if (interaction.commandName === 'event-complete') {
      const target = interaction.options.getUser('user', true);
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'لا تملك الصلاحية لاستخدام هذا الأمر.', ephemeral: true });
      const completed = completeEventQuest(interaction.guildId, target.id);
      const result = awardCompletion(interaction.guildId, target.id, completed);
      if (completed.length) await notifyAchievements(target, result.achievements);
      return interaction.reply({ content: completed.length ? `✅ تم تسجيل مشاركة <@${target.id}> في الفعالية وحصل على **${result.points} نقطة**.` : `✅ تم تسجيل المشاركة لـ <@${target.id}> في مهمة الفعالية.` });
    }

    if (interaction.commandName === 'mystery-box') {
      const roles = rewardRoles();
      if (!roles.length) return interaction.reply({ content: 'لم يتم إعداد رتب الصندوق الغامض بعد. اضبط MYSTERY_BOX_ROLE_IDS في ملف البيئة.', ephemeral: true });
      const now = Date.now();
      const old = db.prepare('SELECT last_opened_at FROM mystery_boxes WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, interaction.user.id);
      const cooldown = Number(process.env.MYSTERY_BOX_COOLDOWN_HOURS || 24) * 3600000;
      if (old?.last_opened_at && now - old.last_opened_at < cooldown) {
        const minutes = Math.ceil((cooldown - (now - old.last_opened_at)) / 60000);
        return interaction.reply({ content: `⏳ يمكنك فتح Mystery Box مرة أخرى بعد **${Math.floor(minutes / 60)} ساعة و${minutes % 60} دقيقة**.`, ephemeral: true });
      }
      const role = interaction.guild.roles.cache.get(roles[Math.floor(Math.random() * roles.length)]);
      if (!role) return interaction.reply({ content: 'إحدى رتب المكافآت المحددة غير موجودة في هذا السيرفر.', ephemeral: true });
      try { await interaction.member.roles.add(role, 'Mystery Box reward'); }
      catch { return interaction.reply({ content: 'تعذر منح الرتبة. تأكد أن رتبة البوت أعلى من رتبة المكافأة.', ephemeral: true }); }

      db.prepare('INSERT INTO mystery_boxes (guild_id,user_id,last_opened_at) VALUES (?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET last_opened_at=excluded.last_opened_at').run(interaction.guildId, interaction.user.id, now);
      db.prepare('UPDATE users SET boxes_opened = boxes_opened + 1 WHERE guild_id = ? AND user_id = ?').run(interaction.guildId, interaction.user.id);
      const achievements = evaluateAchievements(interaction.guildId, interaction.user.id);
      await notifyAchievements(interaction.user, achievements);

      const ticketChannel = process.env.TICKET_CHANNEL_ID ? interaction.guild.channels.cache.get(process.env.TICKET_CHANNEL_ID) : null;
      await interaction.user.send(`🎁 **لقد حصلت على Mystery Box!**\n\n🎉 المكافأة: ${role}\n\n📩 لإتمام استلام المكافأة، افتح تذكرة${ticketChannel ? ` في ${ticketChannel}` : ' في قسم التذاكر في السيرفر'}.`).catch(() => {});
      return interaction.reply({ content: `🎁 مبروك! حصلت على **${role.name}** من Mystery Box.\n📩 أرسلت لك التعليمات في الخاص.`, ephemeral: true });
    }
  } catch (error) {
    console.error(error);
    if (!interaction.replied) await interaction.reply({ content: 'حدث خطأ غير متوقع أثناء تنفيذ العملية.', ephemeral: true }).catch(() => {});
  }
});

process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);
client.login(process.env.DISCORD_TOKEN);
