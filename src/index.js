require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');
const { db, ensureUser } = require('./db');
const {
  dailyStatus,
  leaderboard,
  profile,
  progress,
  completeEventQuest,
  awardCompletion,
  listAchievements,
  consumeMysteryBox,
  recordMessageEligibility,
  evaluateAchievements
} = require('./quests');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const QUEST_INFO_COMMANDS = new Set([
  'quests',
  'quests-top',
  'quest-profile',
  'quest-streak',
  'achievements',
  'mystery-box',
  'quest-event'
]);

const commands = [
  new SlashCommandBuilder().setName('quests').setDescription('عرض مهامك اليومية وتقدمك.'),
  new SlashCommandBuilder().setName('quests-top').setDescription('عرض ترتيب أكثر الأعضاء إنجازاً للمهام.'),
  new SlashCommandBuilder().setName('quest-profile').setDescription('عرض إحصائياتك في نظام المهام.'),
  new SlashCommandBuilder().setName('quest-streak').setDescription('عرض سلسلة إنجاز المهام الخاصة بك.'),
  new SlashCommandBuilder().setName('achievements').setDescription('عرض إنجازاتك المفتوحة والمقفلة.'),
  new SlashCommandBuilder().setName('mystery-box').setDescription('فتح Mystery Box من الصناديق التي حصلت عليها.'),
  new SlashCommandBuilder()
    .setName('quest-event')
    .setDescription('تسجيل مشاركة عضو في فعالية.')
    .addUserOption(option => option.setName('user').setDescription('العضو المشارك في الفعالية.').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
];

function numberEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function roleRewardEntries(guild, member) {
  const ids = (process.env.MYSTERY_BOX_ROLE_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  const rawWeights = (process.env.MYSTERY_BOX_ROLE_WEIGHTS || '').split(',').map(value => Number.parseFloat(value.trim()));
  return ids.map((id, index) => {
    const role = guild.roles.cache.get(id);
    const weight = Number.isFinite(rawWeights[index]) && rawWeights[index] > 0 ? rawWeights[index] : 1;
    return { role, weight };
  }).filter(entry => entry.role && entry.role.editable && !member.roles.cache.has(entry.role.id));
}

function weightedRandom(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = Math.random() * total;
  for (const entry of entries) {
    cursor -= entry.weight;
    if (cursor < 0) return entry.role;
  }
  return entries[entries.length - 1].role;
}

function chooseMysteryRole(guild, member) {
  const entries = roleRewardEntries(guild, member);
  return entries.length ? weightedRandom(entries) : null;
}

function progressBar(progressValue, target, size = 10) {
  const ratio = target > 0 ? Math.min(progressValue / target, 1) : 0;
  const filled = Math.round(ratio * size);
  return `${'█'.repeat(filled)}${'░'.repeat(size - filled)} ${Math.min(progressValue, target)}/${target}`;
}

async function sendLog(guild, content) {
  const channelId = process.env.LOG_CHANNEL_ID;
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return;
  await channel.send({ content }).catch(() => {});
}

async function sendAchievementNotice(user, guild, achievements) {
  if (!achievements.length) return;
  const lines = achievements.map(achievement => `${achievement.icon} **${achievement.name}** — ${achievement.description}`).join('\n');
  await user.send({ content: `🏅 **إنجاز جديد!**\n\n${lines}` }).catch(() => {});
  await sendLog(guild, `🏅 <@${user.id}> فتح ${achievements.length} إنجاز جديد: ${achievements.map(item => item.name).join('، ')}.`);
}

async function processCompletion({ guild, user, completed, replyChannel, publicNotice = false }) {
  if (!completed.length) return null;
  const result = awardCompletion(guild.id, user.id, completed);
  const questNames = completed.map(quest => `**${quest.title}**`).join('، ');

  const summary = [
    '🎉 **تم إكمال مهمة!**',
    `✅ ${questNames}`,
    `⭐ حصلت على **${result.points} نقطة**.`,
    `🔥 سلسلة المهام: **${result.streak} يوم**.`
  ];
  if (result.boxAwarded) summary.push('🎁 أكملت جميع مهام اليوم وحصلت على **Mystery Box** جديد! استخدم `/mystery-box` لفتحه.');

  if (publicNotice && replyChannel?.isTextBased()) {
    await replyChannel.send({ content: summary.join('\n'), allowedMentions: { users: [user.id], repliedUser: false } }).catch(() => {});
  } else {
    await user.send({ content: summary.join('\n') }).catch(() => {});
  }

  if (result.boxAwarded) await sendLog(guild, `🎁 <@${user.id}> حصل على Mystery Box بعد إكمال جميع مهام اليوم.`);
  await sendAchievementNotice(user, guild, result.achievements);
  return result;
}

function startVoiceSession(guildId, userId) {
  const now = Date.now();
  db.prepare(`INSERT INTO voice_sessions (guild_id, user_id, started_at, last_flushed_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id,user_id) DO NOTHING`).run(guildId, userId, now, now);
}

async function flushVoiceSession(guild, userId, remove = false) {
  const row = db.prepare('SELECT started_at, last_flushed_at FROM voice_sessions WHERE guild_id = ? AND user_id = ?').get(guild.id, userId);
  if (!row) return;
  const now = Date.now();
  const elapsed = now - row.last_flushed_at;
  const minutes = Math.floor(elapsed / 60000);
  if (minutes > 0) {
    const completed = progress(guild.id, userId, 'voice_minutes', minutes);
    db.prepare('UPDATE voice_sessions SET last_flushed_at = ? WHERE guild_id = ? AND user_id = ?')
      .run(now - (elapsed % 60000), guild.id, userId);
    if (completed.length) {
      const member = guild.members.cache.get(userId);
      if (member) await processCompletion({ guild, user: member.user, completed, publicNotice: false });
    }
  }
  if (remove) db.prepare('DELETE FROM voice_sessions WHERE guild_id = ? AND user_id = ?').run(guild.id, userId);
}

async function flushAllVoiceSessions() {
  const rows = db.prepare('SELECT guild_id, user_id FROM voice_sessions').all();
  for (const row of rows) {
    const guild = client.guilds.cache.get(row.guild_id);
    if (guild) await flushVoiceSession(guild, row.user_id, false);
  }
}

function boxTicketText(guild) {
  const channelId = process.env.TICKET_CHANNEL_ID;
  const channel = channelId ? guild.channels.cache.get(channelId) : null;
  return channel
    ? `📩 يرجى فتح تذكرة لاستلام المكافأة داخل ${channel}.`
    : '📩 يرجى فتح تذكرة داخل السيرفر لاستلام المكافأة.';
}

client.once('ready', async () => {
  await client.application.commands.set(commands.map(command => command.toJSON()), process.env.GUILD_ID || undefined);
  db.prepare('DELETE FROM voice_sessions').run();
  for (const guild of client.guilds.cache.values()) {
    for (const state of guild.voiceStates.cache.values()) {
      if (state.channelId && !state.member?.user.bot) startVoiceSession(guild.id, state.id);
    }
  }
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📌 Registered ${commands.length} slash commands.`);
});

client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;
  if (!recordMessageEligibility(message.guild.id, message.author.id, message.content)) return;

  const completed = [
    ...progress(message.guild.id, message.author.id, 'messages', 1),
    ...progress(message.guild.id, message.author.id, 'unique_channels', 1, { channelId: message.channelId })
  ];
  if (completed.length) {
    await processCompletion({ guild: message.guild, user: message.author, completed, replyChannel: message.channel, publicNotice: true });
  }
});

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot || !reaction.message.guild) return;
  if (reaction.message.partial) await reaction.message.fetch().catch(() => {});
  const guild = reaction.message.guild;
  const completed = progress(guild.id, user.id, 'reactions', 1);
  if (completed.length) await processCompletion({ guild, user, completed, publicNotice: false });
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;
  const guild = newState.guild;

  if (!oldState.channelId && newState.channelId) {
    startVoiceSession(guild.id, member.id);
    return;
  }
  if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
    await flushVoiceSession(guild, member.id, false);
    startVoiceSession(guild.id, member.id);
    return;
  }
  if (oldState.channelId && !newState.channelId) await flushVoiceSession(guild, member.id, true);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) {
    await interaction.reply({ content: 'هذا الأمر متاح داخل السيرفرات فقط.', ephemeral: true });
    return;
  }

  ensureUser(interaction.guildId, interaction.user.id);

  if (!QUEST_INFO_COMMANDS.has(interaction.commandName)) {
    const completed = progress(interaction.guildId, interaction.user.id, 'commands', 1);
    if (completed.length) await processCompletion({ guild: interaction.guild, user: interaction.user, completed, publicNotice: false });
  }

  if (interaction.commandName === 'quests') {
    const status = dailyStatus(interaction.guildId, interaction.user.id);
    const lines = status.quests.map(quest => {
      const done = status.done.has(quest.quest_id);
      return `${done ? '✅' : '▫️'} **${quest.title}** — ${quest.description}\n${progressBar(quest.progress, quest.target)} · ⭐ **${quest.reward_points}**`;
    });
    await interaction.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('📋 المهام اليومية')
        .setDescription(lines.join('\n\n'))
        .setColor(0x5865F2)
        .setFooter({ text: `التاريخ: ${status.date} • المكتمل: ${status.done.size}/${status.quests.length}` })
    ] });
    return;
  }

  if (interaction.commandName === 'quests-top') {
    const rows = leaderboard(interaction.guildId, 10);
    const lines = rows.length
      ? rows.map((row, index) => `**${index + 1}.** <@${row.user_id}> — ⭐ **${row.total_points}** نقطة · ✅ ${row.total_completed} مهمة · 🔥 ${row.streak} يوم`).join('\n')
      : 'لا توجد بيانات بعد.';
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🏆 ترتيب المهام').setDescription(lines).setColor(0xF1C40F)] });
    return;
  }

  if (interaction.commandName === 'quest-profile') {
    const data = profile(interaction.guildId, interaction.user.id);
    const achievements = listAchievements(interaction.guildId, interaction.user.id);
    const unlocked = achievements.filter(item => item.unlocked).length;
    await interaction.reply({ embeds: [
      new EmbedBuilder()
        .setTitle(`📊 إحصائيات ${interaction.user.username}`)
        .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
        .setDescription([
          `⭐ **النقاط:** ${data.total_points}`,
          `✅ **المهام المكتملة:** ${data.total_completed}`,
          `🔥 **السلسلة الحالية:** ${data.streak} يوم`,
          `🏅 **أفضل سلسلة:** ${data.best_streak} يوم`,
          `🎁 **الصناديق المتاحة:** ${data.boxes_balance}`,
          `📦 **الصناديق المفتوحة:** ${data.boxes_opened}`,
          `🏅 **الإنجازات:** ${unlocked}/${achievements.length}`
        ].join('\n'))
        .setColor(0x5865F2)
    ] });
    return;
  }

  if (interaction.commandName === 'quest-streak') {
    const data = profile(interaction.guildId, interaction.user.id);
    await interaction.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('🏆 Quest Streak')
        .setDescription(`🔥 السلسلة الحالية: **${data.streak} يوم**\n🏅 أعلى سلسلة: **${data.best_streak} يوم**\n✅ إجمالي المهام المكتملة: **${data.total_completed}**`)
        .setColor(0x57F287)
    ] });
    return;
  }

  if (interaction.commandName === 'achievements') {
    const achievements = listAchievements(interaction.guildId, interaction.user.id);
    const lines = achievements.map(achievement => `${achievement.unlocked ? '✅' : '🔒'} ${achievement.icon} **${achievement.name}** — ${achievement.description}`);
    const count = achievements.filter(item => item.unlocked).length;
    await interaction.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('🏅 Achievements')
        .setDescription(lines.join('\n'))
        .setFooter({ text: `الإنجازات المفتوحة: ${count}/${achievements.length}` })
        .setColor(0xEB459E)
    ] });
    return;
  }

  if (interaction.commandName === 'quest-event') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: 'لا تملك الصلاحية لاستخدام هذا الأمر.', ephemeral: true });
      return;
    }
    const target = interaction.options.getUser('user', true);
    const completed = completeEventQuest(interaction.guildId, target.id);
    const result = completed.length ? await processCompletion({ guild: interaction.guild, user: target, completed, publicNotice: false }) : null;
    await interaction.reply({
      content: result
        ? `✅ تم تسجيل مشاركة <@${target.id}> في الفعالية وحصل على **${result.points} نقطة**.`
        : `✅ تم تسجيل التقدم لـ <@${target.id}>.`
    });
    return;
  }

  if (interaction.commandName === 'mystery-box') {
    const data = profile(interaction.guildId, interaction.user.id);
    if (data.boxes_balance <= 0) {
      await interaction.reply({ content: '🎁 لا تملك أي Mystery Box حالياً. أكمل جميع مهام اليوم للحصول على صندوق جديد.', ephemeral: true });
      return;
    }

    const role = chooseMysteryRole(interaction.guild, interaction.member);
    if (!role) {
      await interaction.reply({ content: '⚠️ لا توجد رتبة صالحة حالياً يمكن منحها من قائمة Mystery Box. تأكد من إعداد الرتب ومن صلاحيات البوت.', ephemeral: true });
      return;
    }

    if (!consumeMysteryBox(interaction.guildId, interaction.user.id)) {
      await interaction.reply({ content: 'تعذر حجز الصندوق، حاول مرة أخرى.', ephemeral: true });
      return;
    }

    await interaction.reply({ content: '🎁 جارٍ فتح **Mystery Box**...' });
    await new Promise(resolve => setTimeout(resolve, 1500));

    try {
      await interaction.member.roles.add(role, 'Mystery Box reward');
    } catch {
      db.prepare('UPDATE users SET boxes_opened = MAX(0, boxes_opened - 1) WHERE guild_id = ? AND user_id = ?').run(interaction.guildId, interaction.user.id);
      await interaction.editReply({ content: '❌ تعذر منح الرتبة. تأكد أن رتبة البوت أعلى من الرتبة المحددة وأنه يملك صلاحية Manage Roles.' });
      return;
    }

    const achievements = evaluateAchievements(interaction.guildId, interaction.user.id);
    await sendAchievementNotice(interaction.user, interaction.guild, achievements);
    await interaction.user.send({ content: `🎁 **تم فتح Mystery Box بنجاح!**\n\n🎉 حصلت على الرتبة: **${role.name}**\n\n${boxTicketText(interaction.guild)}` }).catch(() => {});
    await sendLog(interaction.guild, `🎁 <@${interaction.user.id}> فتح Mystery Box وحصل على رتبة **${role.name}**.`);
    await interaction.editReply({ content: `🎁 **مبروك!** حصلت على رتبة **${role.name}** من Mystery Box.\n📩 أرسلت لك تعليمات استلام المكافأة في الخاص.` });
  }
});

setInterval(() => {
  flushAllVoiceSessions().catch(console.error);
}, numberEnv('VOICE_FLUSH_INTERVAL_SECONDS', 60) * 1000).unref();

process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN is missing.');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
