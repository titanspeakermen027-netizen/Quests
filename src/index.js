require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType
} = require('discord.js');

const { db, ensureUser, getSetting } = require('./db');
const {
  dailyStatus,
  weeklyStatus,
  seasonalStatus,
  leaderboard,
  profile,
  progress,
  awardCompletion,
  grantPoints,
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
  eventParticipantCount,
  activeEvent,
  seasonInfo,
  isSeasonActive,
  generateDailyQuests,
  levelXp,
  helpData
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

const NON_PROGRESS_COMMANDS = new Set([
  'help',
  'quests',
  'quests-weekly',
  'quests-season',
  'quests-top',
  'quest-profile',
  'quest-streak',
  'achievements',
  'mystery-box',
  'quest-event',
  'quest-settings'
]);

const boxLocks = new Set();

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function currentLocalHour() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TIMEZONE || 'Africa/Casablanca',
    hour: '2-digit',
    hour12: false
  });
  return Number(formatter.format(new Date()));
}

function localDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TIMEZONE || 'Africa/Casablanca',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function progressBar(value, target, size = 12) {
  const ratio = target > 0 ? Math.min(value / target, 1) : 0;
  const filled = Math.round(ratio * size);
  return `${'█'.repeat(filled)}${'░'.repeat(size - filled)} ${Math.min(value, target)}/${target}`;
}

function roleRewardEntries(guild, member) {
  const ids = (process.env.MYSTERY_BOX_ROLE_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
  const weights = (process.env.MYSTERY_BOX_ROLE_WEIGHTS || '')
    .split(',')
    .map(value => Number.parseFloat(value.trim()));

  return ids.map((id, index) => {
    const role = guild.roles.cache.get(id);
    const weight = Number.isFinite(weights[index]) && weights[index] > 0 ? weights[index] : 1;
    return { role, weight };
  }).filter(item => item.role && item.role.editable && !member.roles.cache.has(item.role.id));
}

function weightedRandom(entries) {
  const total = entries.reduce((sum, item) => sum + item.weight, 0);
  let cursor = Math.random() * total;
  for (const item of entries) {
    cursor -= item.weight;
    if (cursor < 0) return item.role;
  }
  return entries.at(-1)?.role || null;
}

function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

async function sendLog(guild, content) {
  const channelId = getSetting(guild.id, 'log_channel_id', process.env.LOG_CHANNEL_ID || '');
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (channel?.isTextBased()) await channel.send({ content }).catch(() => {});
}

async function sendAchievementNotice(user, guild, achievements) {
  if (!achievements.length) return;
  const lines = achievements
    .map(item => `${item.icon} **${item.name}** — ${item.description}`)
    .join('\n');

  await user.send({ content: `🏅 **إنجاز جديد!**\n\n${lines}` }).catch(() => {});
  await sendLog(
    guild,
    `🏅 <@${user.id}> فتح ${achievements.length} إنجاز جديد: ${achievements.map(item => item.name).join('، ')}.`
  );
}

async function applyLevelRewards(guild, userId, result) {
  if (!result?.levelRewards?.length || result.newLevel <= result.oldLevel) return;

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;

  for (const reward of result.levelRewards) {
    const role = guild.roles.cache.get(reward.role_id);
    if (!role || !role.editable || member.roles.cache.has(role.id)) continue;
    await member.roles.add(role, `Quests level ${reward.level} reward`).catch(() => {});
    await sendLog(guild, `🚀 <@${userId}> وصل إلى المستوى **${reward.level}** وحصل على رتبة ${role}.`);
  }

  await member.user.send({
    content: `🚀 تهانينا! وصلت إلى **المستوى ${result.newLevel}** في نظام المهام.`
  }).catch(() => {});
}

async function processCompletion({ guild, user, completed, publicNotice = false, channel = null }) {
  if (!completed?.length) return null;

  const result = awardCompletion(guild.id, user.id, completed);
  const questNames = completed.map(quest => `**${quest.title}**`).join('، ');
  const summary = [
    '🎉 **تم إكمال مهمة!**',
    `✅ ${questNames}`,
    `⭐ حصلت على **${result.points} نقطة**.`,
    `🔥 سلسلة المهام: **${result.streak} يوم**.`
  ];

  if (result.boxAwarded) {
    summary.push('🎁 أكملت جميع مهام اليوم وحصلت على **Mystery Box** جديد! استخدم `/mystery-box` لفتحه.');
    await sendLog(guild, `🎁 <@${user.id}> حصل على Mystery Box جديد بعد إكمال جميع مهام اليوم.`);
  }

  if (publicNotice && channel?.isTextBased()) {
    await channel.send({
      content: summary.join('\n'),
      allowedMentions: { users: [user.id], repliedUser: false }
    }).catch(() => {});
  } else {
    await user.send({ content: summary.join('\n') }).catch(() => {});
  }

  await applyLevelRewards(guild, user.id, result);
  await sendAchievementNotice(user, guild, result.achievements);
  return result;
}

function startVoiceSession(guildId, userId) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO voice_sessions (guild_id, user_id, started_at, last_flushed_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO NOTHING
  `).run(guildId, userId, now, now);
}

async function flushVoiceSession(guild, userId, remove = false) {
  const row = db.prepare(
    'SELECT last_flushed_at FROM voice_sessions WHERE guild_id = ? AND user_id = ?'
  ).get(guild.id, userId);
  if (!row) return;

  const now = Date.now();
  const elapsed = now - row.last_flushed_at;
  const minutes = Math.floor(elapsed / 60000);

  if (minutes > 0) {
    const completed = progress(guild.id, userId, 'voice_minutes', minutes);
    db.prepare(
      'UPDATE voice_sessions SET last_flushed_at = ? WHERE guild_id = ? AND user_id = ?'
    ).run(now - (elapsed % 60000), guild.id, userId);

    if (completed.length) {
      const user = await client.users.fetch(userId).catch(() => null);
      if (user) await processCompletion({ guild, user, completed, publicNotice: false });
    }
  }

  if (remove) {
    db.prepare(
      'DELETE FROM voice_sessions WHERE guild_id = ? AND user_id = ?'
    ).run(guild.id, userId);
  }
}

async function flushAllVoiceSessions() {
  const rows = db.prepare('SELECT guild_id, user_id FROM voice_sessions').all();
  for (const row of rows) {
    const guild = client.guilds.cache.get(row.guild_id);
    if (guild) await flushVoiceSession(guild, row.user_id, false);
  }
}

function eventEmbed(event, participants) {
  return new EmbedBuilder()
    .setTitle(`🎉 ${event.title}`)
    .setDescription(event.description)
    .addFields(
      { name: '🎁 المكافأة', value: `⭐ ${event.reward_points} نقطة`, inline: true },
      { name: '👥 المشاركون', value: `**${participants}** عضو`, inline: true },
      { name: '⏰ ينتهي', value: `<t:${Math.floor(event.ends_at / 1000)}:R>`, inline: true }
    )
    .setColor(0x57F287)
    .setFooter({ text: 'اضغط على «أشارك» لتسجيل مشاركتك والحصول على مكافأة الفعالية.' });
}

function eventComponents(eventId, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`quest:event:join:${eventId}`)
        .setLabel('أشارك')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`quest:event:info:${eventId}`)
        .setLabel('المشاركون')
        .setEmoji('👥')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`quest:event:end:${eventId}`)
        .setLabel('إنهاء الفعالية')
        .setEmoji('⏹️')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled)
    )
  ];
}

async function updateEventPanel(guild, event, disabled = false) {
  if (!event?.message_id) return;
  const channel = guild.channels.cache.get(event.channel_id);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(event.message_id).catch(() => null);
  if (!message) return;
  const embed = eventEmbed(event, eventParticipantCount(guild.id, event.event_id));
  if (disabled) embed.setColor(0x95A5A6).setFooter({ text: 'انتهت هذه الفعالية.' });
  await message.edit({ embeds: [embed], components: eventComponents(event.event_id, disabled) }).catch(() => {});
}

async function publishDailyAnnouncement(guild) {
  const configuredHour = Number.parseInt(
    getSetting(guild.id, 'daily_announcement_hour', process.env.DAILY_QUEST_HOUR || '0'),
    10
  );
  const hour = Number.isInteger(configuredHour) ? configuredHour : 0;
  if (currentLocalHour() !== hour) return;

  const today = localDateKey();
  if (getSetting(guild.id, 'last_daily_announcement', '') === today) return;

  const channelId = getSetting(
    guild.id,
    'announcement_channel_id',
    process.env.ANNOUNCEMENT_CHANNEL_ID || ''
  );
  const channel = channelId ? guild.channels.cache.get(channelId) : null;
  if (!channel?.isTextBased()) return;

  const quests = generateDailyQuests(guild.id, today);
  const lines = quests.map(q => `▫️ **${q.title}** — ${q.description} · ⭐ ${q.reward_points}`).join('\n');

  const sent = await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle('📋 المهام اليومية الجديدة')
        .setDescription(`بدأ يوم جديد في نظام Quests!\n\n${lines}\n\n🎁 أكمل جميع المهام لتحصل على Mystery Box.`)
        .setColor(0x5865F2)
    ]
  }).catch(() => null);

  if (sent) setGuildSetting(guild.id, 'last_daily_announcement', today);
}

const commands = [
  new SlashCommandBuilder().setName('help').setDescription('عرض مساعدة البوت وجميع أوامره.'),
  new SlashCommandBuilder().setName('quests').setDescription('عرض مهام اليوم والتقدم والمكافآت.'),
  new SlashCommandBuilder().setName('quests-weekly').setDescription('عرض المهام الأسبوعية والتقدم.'),
  new SlashCommandBuilder().setName('quests-season').setDescription('عرض مهام الموسم ونقاطك الموسمية.'),
  new SlashCommandBuilder()
    .setName('quests-top')
    .setDescription('عرض ترتيب الأعضاء.')
    .addStringOption(option => option
      .setName('scope')
      .setDescription('نوع الترتيب المطلوب.')
      .setRequired(false)
      .addChoices(
        { name: 'عام', value: 'all' },
        { name: 'أسبوعي', value: 'weekly' },
        { name: 'موسمي', value: 'seasonal' }
      )),
  new SlashCommandBuilder().setName('quest-profile').setDescription('عرض ملفك وإحصائياتك في نظام المهام.'),
  new SlashCommandBuilder().setName('quest-streak').setDescription('عرض سلسلة إنجاز المهام.'),
  new SlashCommandBuilder().setName('achievements').setDescription('عرض الإنجازات المفتوحة والمقفلة.'),
  new SlashCommandBuilder().setName('mystery-box').setDescription('فتح Mystery Box حصلت عليه.'),
  new SlashCommandBuilder()
    .setName('quest-event')
    .setDescription('إنشاء وإدارة فعالية تفاعلية.')
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('إنشاء فعالية جديدة بالأزرار.')
      .addStringOption(opt => opt.setName('title').setDescription('عنوان الفعالية.').setRequired(true))
      .addStringOption(opt => opt.setName('description').setDescription('وصف الفعالية.').setRequired(true))
      .addIntegerOption(opt => opt.setName('minutes').setDescription('مدة الفعالية بالدقائق.').setRequired(true).setMinValue(1).setMaxValue(10080))
      .addIntegerOption(opt => opt.setName('reward').setDescription('نقاط المشاركة.').setRequired(false).setMinValue(1).setMaxValue(10000)))
    .addSubcommand(sub => sub
      .setName('end')
      .setDescription('إنهاء الفعالية الحالية.')
      .addStringOption(opt => opt.setName('event_id').setDescription('معرف الفعالية.').setRequired(false)))
    .addSubcommand(sub => sub.setName('info').setDescription('عرض معلومات الفعالية الحالية.')),
  new SlashCommandBuilder()
    .setName('quest-settings')
    .setDescription('إدارة إعدادات نظام Quests.')
    .addSubcommand(sub => sub.setName('view').setDescription('عرض الإعدادات الحالية.'))
    .addSubcommand(sub => sub.setName('daily-count').setDescription('تحديد عدد المهام اليومية.')
      .addIntegerOption(opt => opt.setName('count').setDescription('من 3 إلى 8.').setRequired(true).setMinValue(3).setMaxValue(8)))
    .addSubcommand(sub => sub.setName('weekly-count').setDescription('تحديد عدد المهام الأسبوعية.')
      .addIntegerOption(opt => opt.setName('count').setDescription('من 2 إلى 7.').setRequired(true).setMinValue(2).setMaxValue(7)))
    .addSubcommand(sub => sub.setName('level-xp').setDescription('تحديد XP المطلوب لكل مستوى.')
      .addIntegerOption(opt => opt.setName('xp').setDescription('بين 100 و100000.').setRequired(true).setMinValue(100).setMaxValue(100000)))
    .addSubcommand(sub => sub.setName('announcement').setDescription('تحديد قناة إعلان المهام اليومية.')
      .addChannelOption(opt => opt.setName('channel').setDescription('قناة نصية.').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(sub => sub.setName('log').setDescription('تحديد قناة السجلات.')
      .addChannelOption(opt => opt.setName('channel').setDescription('قناة نصية.').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(sub => sub.setName('ticket').setDescription('تحديد قناة تذاكر مكافآت الصناديق.')
      .addChannelOption(opt => opt.setName('channel').setDescription('قناة نصية.').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(sub => sub.setName('season').setDescription('إعداد الموسم.')
      .addStringOption(opt => opt.setName('name').setDescription('اسم الموسم.').setRequired(true))
      .addStringOption(opt => opt.setName('start').setDescription('YYYY-MM-DD.').setRequired(true))
      .addStringOption(opt => opt.setName('end').setDescription('YYYY-MM-DD.').setRequired(true)))
    .addSubcommand(sub => sub.setName('level-role-add').setDescription('إضافة رتبة كمكافأة لمستوى.')
      .addIntegerOption(opt => opt.setName('level').setDescription('المستوى.').setRequired(true).setMinValue(2).setMaxValue(1000))
      .addRoleOption(opt => opt.setName('role').setDescription('الرتبة.').setRequired(true)))
    .addSubcommand(sub => sub.setName('level-role-remove').setDescription('حذف مكافأة رتبة من مستوى.')
      .addIntegerOption(opt => opt.setName('level').setDescription('المستوى.').setRequired(true).setMinValue(2).setMaxValue(1000)))
];

client.once('ready', async () => {
  await client.application.commands.set(
    commands.map(command => command.toJSON()),
    process.env.GUILD_ID || undefined
  );

  db.prepare('DELETE FROM voice_sessions').run();
  for (const guild of client.guilds.cache.values()) {
    for (const state of guild.voiceStates.cache.values()) {
      if (state.channelId && !state.member?.user.bot) startVoiceSession(guild.id, state.id);
    }
  }

  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📌 Registered ${commands.length} slash commands.`);

  setInterval(async () => {
    try {
      expireEvents();
      await flushAllVoiceSessions();
      for (const guild of client.guilds.cache.values()) {
        await publishDailyAnnouncement(guild);
      }
    } catch (error) {
      console.error('Scheduler error:', error);
    }
  }, 60000);
});

client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;
  if (!recordMessageEligibility(message.guild.id, message.author.id, message.content)) return;

  const completed = [
    ...progress(message.guild.id, message.author.id, 'messages', 1),
    ...progress(message.guild.id, message.author.id, 'unique_channels', 1, { channelId: message.channelId })
  ];

  if (completed.length) {
    await processCompletion({
      guild: message.guild,
      user: message.author,
      completed,
      publicNotice: false
    });
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

  if (oldState.channelId && !newState.channelId) {
    await flushVoiceSession(guild, member.id, true);
  }
});

client.on('interactionCreate', async interaction => {
  if (interaction.isButton()) {
    const parts = interaction.customId.split(':');
    if (parts[0] !== 'quest' || parts[1] !== 'event') return;

    const action = parts[2];
    const eventId = parts.slice(3).join(':');
    const event = db.prepare(
      'SELECT * FROM events WHERE guild_id = ? AND event_id = ?'
    ).get(interaction.guildId, eventId);

    if (!event) {
      await interaction.reply({ content: 'هذه الفعالية غير موجودة.', ephemeral: true });
      return;
    }

    if (action === 'join') {
      const result = joinEvent(interaction.guildId, eventId, interaction.user.id);
      if (!result.ok) {
        const messages = {
          ended: 'انتهت هذه الفعالية أو لم تعد متاحة للمشاركة.',
          already_joined: 'لقد شاركت بالفعل في هذه الفعالية.'
        };
        await interaction.reply({ content: messages[result.reason] || 'تعذر تسجيل المشاركة.', ephemeral: true });
        return;
      }

      const completionResult = result.completed?.length
        ? await processCompletion({ guild: interaction.guild, user: interaction.user, completed: result.completed, publicNotice: false })
        : null;

      const rewardResult = grantPoints(
        interaction.guildId,
        interaction.user.id,
        event.reward_points,
        `event:${eventId}`
      );
      await applyLevelRewards(interaction.guild, interaction.user.id, rewardResult);
      await sendAchievementNotice(interaction.user, interaction.guild, rewardResult.achievements);

      await updateEventPanel(
        interaction.guild,
        db.prepare('SELECT * FROM events WHERE guild_id = ? AND event_id = ?').get(interaction.guildId, eventId),
        false
      );

      await interaction.reply({
        content: `✅ تم تسجيل مشاركتك في **${event.title}**.\n⭐ حصلت على **${event.reward_points} نقطة** كمكافأة مشاركة${completionResult?.points ? `، بالإضافة إلى **${completionResult.points} نقطة** من المهام.` : '.'}`,
        ephemeral: true
      });
      return;
    }

    if (action === 'info') {
      await interaction.reply({
        embeds: [eventEmbed(event, eventParticipantCount(interaction.guildId, eventId))],
        ephemeral: true
      });
      return;
    }

    if (action === 'end') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: 'لا تملك الصلاحية لإنهاء الفعالية.', ephemeral: true });
        return;
      }

      if (!finishEvent(interaction.guildId, eventId, 'ended')) {
        await interaction.reply({ content: 'هذه الفعالية منتهية بالفعل.', ephemeral: true });
        return;
      }

      const endedEvent = db.prepare(
        'SELECT * FROM events WHERE guild_id = ? AND event_id = ?'
      ).get(interaction.guildId, eventId);
      await updateEventPanel(interaction.guild, endedEvent, true);
      await interaction.reply({ content: `⏹️ تم إنهاء فعالية **${event.title}**.` });
      await sendLog(interaction.guild, `⏹️ تم إنهاء فعالية **${event.title}**.`);
      return;
    }
  }

  if (!interaction.isChatInputCommand()) return;

  if (!interaction.guild) {
    await interaction.reply({ content: 'هذا الأمر متاح داخل السيرفرات فقط.', ephemeral: true });
    return;
  }

  ensureUser(interaction.guildId, interaction.user.id);

  if (!NON_PROGRESS_COMMANDS.has(interaction.commandName)) {
    const completed = progress(interaction.guildId, interaction.user.id, 'commands', 1);
    if (completed.length) {
      await processCompletion({ guild: interaction.guild, user: interaction.user, completed, publicNotice: false });
    }
  }

  if (interaction.commandName === 'help') {
    const data = helpData();
    const showAdmin = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
    const embed = new EmbedBuilder()
      .setTitle('❓ مساعدة Quests')
      .setDescription('نظام تفاعل للمجتمع يعتمد على المهام اليومية والأسبوعية والموسمية، XP، المستويات، السلاسل، الإنجازات، الفعاليات والصناديق الغامضة.')
      .addFields(
        { name: '📋 الأساسيات', value: data.basics.map(item => `**${item[0]}** — ${item[1]}`).join('\n') },
        { name: '📈 التقدم', value: data.progression.map(item => `**${item[0]}** — ${item[1]}`).join('\n') },
        { name: '🎉 الفعاليات', value: data.events.map(item => `**${item[0]}** — ${item[1]}`).join('\n') }
      )
      .setColor(0x5865F2)
      .setFooter({ text: 'استخدم /help في أي وقت لعرض المساعدة.' });

    if (showAdmin) embed.addFields({ name: '🛠️ الإدارة', value: data.admin.map(item => `**${item[0]}** — ${item[1]}`).join('\n') });
    await interaction.reply({ embeds: [embed] });
    return;
  }

  if (interaction.commandName === 'quests') {
    const status = dailyStatus(interaction.guildId, interaction.user.id);
    const lines = status.quests.map(quest => {
      const done = status.done.has(quest.quest_id);
      return `${done ? '✅' : '▫️'} **${quest.title}**\n${quest.description}\n${progressBar(quest.progress, quest.target)} · ⭐ **${quest.reward_points}**`;
    });

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('📋 المهام اليومية')
        .setDescription(lines.join('\n\n'))
        .setColor(0x5865F2)
        .setFooter({ text: `التاريخ: ${status.date} • المكتمل: ${status.done.size}/${status.quests.length}` })]
    });
    return;
  }

  if (interaction.commandName === 'quests-weekly') {
    const status = weeklyStatus(interaction.guildId, interaction.user.id);
    const lines = status.quests.map(quest => {
      const done = status.done.has(quest.quest_id);
      return `${done ? '✅' : '▫️'} **${quest.title}**\n${quest.description}\n${progressBar(quest.progress, quest.target)} · ⭐ **${quest.reward_points}**`;
    });

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('📅 المهام الأسبوعية')
        .setDescription(lines.join('\n\n'))
        .setColor(0x3498DB)
        .setFooter({ text: `الأسبوع: ${status.key} • المكتمل: ${status.done.size}/${status.quests.length}` })]
    });
    return;
  }

  if (interaction.commandName === 'quests-season') {
    const status = seasonalStatus(interaction.guildId, interaction.user.id);
    if (!status.active) {
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('🌟 الموسم')
          .setDescription(`لا يوجد موسم نشط حالياً.\n\nالموسم المهيأ: **${status.info.name}**\n📅 ${status.info.startDate} → ${status.info.endDate}`)
          .setColor(0x95A5A6)]
      });
      return;
    }

    const lines = status.quests.map(quest => {
      const done = status.done.has(quest.quest_id);
      return `${done ? '✅' : '▫️'} **${quest.title}**\n${quest.description}\n${progressBar(quest.progress, quest.target)} · ⭐ **${quest.reward_points}**`;
    });

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle(`🌟 ${status.info.name}`)
        .setDescription(lines.join('\n\n'))
        .addFields({ name: '⭐ نقاط الموسم', value: `**${status.points}** نقطة` })
        .setColor(0x9B59B6)
        .setFooter({ text: `${status.info.startDate} → ${status.info.endDate}` })]
    });
    return;
  }

  if (interaction.commandName === 'quests-top') {
    const scope = interaction.options.getString('scope') || 'all';
    const rows = leaderboard(interaction.guildId, scope, 10);
    if (!rows.length) {
      await interaction.reply({ content: 'لا توجد بيانات كافية لهذا الترتيب بعد.', ephemeral: true });
      return;
    }

    const lines = scope === 'all'
      ? rows.map((row, index) => `**${index + 1}.** <@${row.user_id}> — ⭐ **${row.total_points}** نقطة · ✅ ${row.total_completed} مهمة · 🔥 ${row.streak} يوم`).join('\n')
      : rows.map((row, index) => `**${index + 1}.** <@${row.user_id}> — ⭐ **${row.points}** نقطة`).join('\n');

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle(scope === 'weekly' ? '🏆 الترتيب الأسبوعي' : scope === 'seasonal' ? '🏆 الترتيب الموسمي' : '🏆 الترتيب العام')
        .setDescription(lines)
        .setColor(0xF1C40F)]
    });
    return;
  }

  if (interaction.commandName === 'quest-profile') {
    const data = profile(interaction.guildId, interaction.user.id);
    const achievements = listAchievements(interaction.guildId, interaction.user.id);
    const unlocked = achievements.filter(item => item.unlocked).length;

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle(`📊 ملف ${interaction.user.username}`)
        .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
        .setDescription([
          `🎚️ **المستوى:** ${data.level}`,
          `✨ **XP:** ${data.xp}`,
          `📈 **تقدم المستوى:** ${data.levelProgressXp}/${data.levelXp} (${data.levelProgressPercent}%)`,
          `⭐ **النقاط:** ${data.total_points}`,
          `✅ **المهام المكتملة:** ${data.total_completed}`,
          `🔥 **السلسلة الحالية:** ${data.streak} يوم`,
          `🏅 **أفضل سلسلة:** ${data.best_streak} يوم`,
          `🎁 **الصناديق المتاحة:** ${data.boxes_balance}`,
          `📦 **الصناديق المفتوحة:** ${data.boxes_opened}`,
          `🏅 **الإنجازات:** ${unlocked}/${achievements.length}`
        ].join('\n'))
        .setColor(0x5865F2)]
    });
    return;
  }

  if (interaction.commandName === 'quest-streak') {
    const data = profile(interaction.guildId, interaction.user.id);
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('🏆 Quest Streak')
        .setDescription(`🔥 السلسلة الحالية: **${data.streak} يوم**\n🏅 أعلى سلسلة: **${data.best_streak} يوم**\n✅ إجمالي المهام المكتملة: **${data.total_completed}**`)
        .setColor(0x57F287)]
    });
    return;
  }

  if (interaction.commandName === 'achievements') {
    const achievements = listAchievements(interaction.guildId, interaction.user.id);
    const unlocked = achievements.filter(item => item.unlocked).length;
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('🏅 Achievements')
        .setDescription(achievements.map(item => `${item.unlocked ? '✅' : '🔒'} ${item.icon} **${item.name}** — ${item.description}`).join('\n'))
        .setFooter({ text: `الإنجازات المفتوحة: ${unlocked}/${achievements.length}` })
        .setColor(0xEB459E)]
    });
    return;
  }

  if (interaction.commandName === 'mystery-box') {
    const lockId = `${interaction.guildId}:${interaction.user.id}`;
    if (boxLocks.has(lockId)) {
      await interaction.reply({ content: 'جارٍ معالجة صندوقك الحالي، حاول مرة أخرى بعد لحظات.', ephemeral: true });
      return;
    }
    boxLocks.add(lockId);

    try {
      const data = profile(interaction.guildId, interaction.user.id);
      if (data.boxes_balance <= 0) {
        await interaction.reply({ content: 'لا تملك أي Mystery Box حالياً. أكمل جميع مهام اليوم لتحصل على صندوق جديد.', ephemeral: true });
        return;
      }

      const role = weightedRandom(roleRewardEntries(interaction.guild, interaction.member));
      if (!role) {
        await interaction.reply({ content: 'لا توجد حالياً رتبة صالحة لمكافأة Mystery Box. تأكد من إعداد الرتب وصلاحيات البوت.', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      await interaction.member.roles.add(role, 'Mystery Box reward');

      if (!consumeMysteryBox(interaction.guildId, interaction.user.id)) {
        await interaction.member.roles.remove(role, 'Mystery Box rollback').catch(() => {});
        await interaction.editReply('تعذر استهلاك الصندوق، لذلك تمت إعادة المكافأة. حاول مرة أخرى.');
        return;
      }

      const achievements = evaluateAchievements(interaction.guildId, interaction.user.id);
      await sendAchievementNotice(interaction.user, interaction.guild, achievements);
      const ticketId = getSetting(interaction.guildId, 'ticket_channel_id', process.env.TICKET_CHANNEL_ID || '');
      const ticket = ticketId ? interaction.guild.channels.cache.get(ticketId) : null;

      await interaction.user.send({
        content: [
          '🎁 **لقد فتحت Mystery Box!**',
          '',
          `🎉 المكافأة التي حصلت عليها: **${role.name}**`,
          ticket ? `📩 يرجى فتح تذكرة داخل ${ticket} لإتمام استلام المكافأة.` : '📩 يرجى فتح تذكرة داخل السيرفر لإتمام استلام المكافأة.'
        ].join('\n')
      }).catch(() => {});

      await sendLog(interaction.guild, `🎁 <@${interaction.user.id}> فتح Mystery Box وحصل على ${role}.`);
      await interaction.editReply(`🎁 مبروك! حصلت على رتبة **${role.name}**.\n📩 أرسلت لك تعليمات استلام المكافأة في الخاص.`);
    } catch (error) {
      console.error('Mystery Box error:', error);
      if (interaction.deferred || interaction.replied) await interaction.editReply('حدث خطأ أثناء فتح Mystery Box.').catch(() => {});
      else await interaction.reply({ content: 'حدث خطأ أثناء فتح Mystery Box.', ephemeral: true }).catch(() => {});
    } finally {
      boxLocks.delete(lockId);
    }
    return;
  }

  if (interaction.commandName === 'quest-event') {
    const subcommand = interaction.options.getSubcommand();
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
    if (subcommand !== 'info' && !isAdmin) {
      await interaction.reply({ content: 'لا تملك الصلاحية لإدارة الفعاليات.', ephemeral: true });
      return;
    }

    if (subcommand === 'create') {
      const title = interaction.options.getString('title', true).trim().slice(0, 100);
      const description = interaction.options.getString('description', true).trim().slice(0, 1000);
      const minutes = interaction.options.getInteger('minutes', true);
      const reward = interaction.options.getInteger('reward') || positiveInteger(process.env.EVENT_DEFAULT_REWARD, 50);

      const created = createEvent(interaction.guildId, {
        title,
        description,
        channelId: interaction.channelId,
        rewardPoints: reward,
        endsAt: Date.now() + (minutes * 60000)
      });

      if (created.error === 'active_event') {
        await interaction.reply({ content: `هناك فعالية نشطة بالفعل: **${created.event.title}**.`, ephemeral: true });
        return;
      }
      if (created.error) {
        await interaction.reply({ content: 'تعذر إنشاء الفعالية.', ephemeral: true });
        return;
      }

      const event = created.event;
      const panel = await interaction.channel.send({
        embeds: [eventEmbed(event, 0)],
        components: eventComponents(event.event_id)
      });
      attachEventMessage(interaction.guildId, event.event_id, panel.id);

      await interaction.reply({ content: `✅ تم إنشاء فعالية **${event.title}** في هذه القناة.`, ephemeral: true });
      await sendLog(interaction.guild, `🎉 تم إنشاء فعالية **${event.title}** لمدة ${minutes} دقيقة.`);
      return;
    }

    if (subcommand === 'end') {
      const eventId = interaction.options.getString('event_id') || activeEvent(interaction.guildId)?.event_id;
      if (!eventId) {
        await interaction.reply({ content: 'لا توجد فعالية نشطة حالياً.', ephemeral: true });
        return;
      }

      const event = db.prepare('SELECT * FROM events WHERE guild_id = ? AND event_id = ?').get(interaction.guildId, eventId);
      if (!event || !finishEvent(interaction.guildId, eventId, 'ended')) {
        await interaction.reply({ content: 'تعذر إنهاء الفعالية أو أنها منتهية بالفعل.', ephemeral: true });
        return;
      }

      const endedEvent = db.prepare('SELECT * FROM events WHERE guild_id = ? AND event_id = ?').get(interaction.guildId, eventId);
      await updateEventPanel(interaction.guild, endedEvent, true);
      await interaction.reply({ content: `⏹️ تم إنهاء فعالية **${event.title}**.` });
      await sendLog(interaction.guild, `⏹️ تم إنهاء فعالية **${event.title}**.`);
      return;
    }

    if (subcommand === 'info') {
      const event = activeEvent(interaction.guildId);
      if (!event) {
        await interaction.reply({ content: 'لا توجد فعالية نشطة حالياً.', ephemeral: true });
        return;
      }
      await interaction.reply({ embeds: [eventEmbed(event, eventParticipantCount(interaction.guildId, event.event_id))], ephemeral: true });
      return;
    }
  }

  if (interaction.commandName === 'quest-settings') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: 'لا تملك الصلاحية لإدارة إعدادات Quests.', ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'view') {
      const season = seasonInfo(interaction.guildId);
      const rewards = getLevelRewards(interaction.guildId);
      const dailyCount = getSetting(interaction.guildId, 'daily_quest_count', process.env.DAILY_QUEST_COUNT || '5');
      const weeklyCount = getSetting(interaction.guildId, 'weekly_quest_count', process.env.WEEKLY_QUEST_COUNT || '4');
      const announcement = getSetting(interaction.guildId, 'announcement_channel_id', process.env.ANNOUNCEMENT_CHANNEL_ID || 'غير محدد');
      const log = getSetting(interaction.guildId, 'log_channel_id', process.env.LOG_CHANNEL_ID || 'غير محدد');
      const ticket = getSetting(interaction.guildId, 'ticket_channel_id', process.env.TICKET_CHANNEL_ID || 'غير محدد');

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('⚙️ إعدادات Quests')
          .setDescription([
            `📋 المهام اليومية: **${dailyCount}**`,
            `📅 المهام الأسبوعية: **${weeklyCount}**`,
            `✨ XP لكل مستوى: **${levelXp(interaction.guildId)}**`,
            `📢 قناة الإعلانات: ${announcement === 'غير محدد' ? 'غير محددة' : `<#${announcement}>`}`,
            `📝 قناة السجلات: ${log === 'غير محدد' ? 'غير محددة' : `<#${log}>`}`,
            `🎫 قناة التذاكر: ${ticket === 'غير محدد' ? 'غير محددة' : `<#${ticket}>`}`,
            `🌟 الموسم: **${season.name}**`,
            `📅 مدة الموسم: **${season.startDate} → ${season.endDate}**`,
            `🎚️ مكافآت المستويات: **${rewards.length}**`
          ].join('\n'))
          .setColor(0x2F3136)],
        ephemeral: true
      });
      return;
    }

    if (sub === 'daily-count') {
      const count = interaction.options.getInteger('count', true);
      setGuildSetting(interaction.guildId, 'daily_quest_count', count);
      await interaction.reply({ content: `✅ تم ضبط عدد المهام اليومية على **${count}**. سيظهر العدد الجديد مع الدورة اليومية التالية.`, ephemeral: true });
      return;
    }

    if (sub === 'weekly-count') {
      const count = interaction.options.getInteger('count', true);
      setGuildSetting(interaction.guildId, 'weekly_quest_count', count);
      await interaction.reply({ content: `✅ تم ضبط عدد المهام الأسبوعية على **${count}**.`, ephemeral: true });
      return;
    }

    if (sub === 'level-xp') {
      const xp = interaction.options.getInteger('xp', true);
      setGuildSetting(interaction.guildId, 'level_xp', xp);
      await interaction.reply({ content: `✅ تم ضبط XP المطلوب لكل مستوى على **${xp}**.`, ephemeral: true });
      return;
    }

    if (sub === 'announcement') {
      const channel = interaction.options.getChannel('channel', true);
      setGuildSetting(interaction.guildId, 'announcement_channel_id', channel.id);
      await interaction.reply({ content: `✅ تم تحديد قناة الإعلانات: ${channel}.`, ephemeral: true });
      return;
    }

    if (sub === 'log') {
      const channel = interaction.options.getChannel('channel', true);
      setGuildSetting(interaction.guildId, 'log_channel_id', channel.id);
      await interaction.reply({ content: `✅ تم تحديد قناة السجلات: ${channel}.`, ephemeral: true });
      return;
    }

    if (sub === 'ticket') {
      const channel = interaction.options.getChannel('channel', true);
      setGuildSetting(interaction.guildId, 'ticket_channel_id', channel.id);
      await interaction.reply({ content: `✅ تم تحديد قناة التذاكر: ${channel}.`, ephemeral: true });
      return;
    }

    if (sub === 'season') {
      const name = interaction.options.getString('name', true).trim().slice(0, 100);
      const start = interaction.options.getString('start', true).trim();
      const end = interaction.options.getString('end', true).trim();

      if (!validDateKey(start) || !validDateKey(end) || start > end) {
        await interaction.reply({ content: 'التواريخ غير صالحة. استخدم الصيغة `YYYY-MM-DD` وتأكد أن البداية تسبق النهاية.', ephemeral: true });
        return;
      }

      setGuildSetting(interaction.guildId, 'season_name', name);
      setGuildSetting(interaction.guildId, 'season_start', start);
      setGuildSetting(interaction.guildId, 'season_end', end);
      await interaction.reply({ content: `✅ تم إعداد الموسم **${name}** من **${start}** إلى **${end}**.`, ephemeral: true });
      return;
    }

    if (sub === 'level-role-add') {
      const level = interaction.options.getInteger('level', true);
      const role = interaction.options.getRole('role', true);
      const botHighest = interaction.guild.members.me?.roles.highest?.position || 0;

      if (role.managed || role.position >= botHighest) {
        await interaction.reply({ content: 'لا يمكن استخدام هذه الرتبة؛ يجب أن تكون قابلة للإدارة وأقل من أعلى رتبة للبوت.', ephemeral: true });
        return;
      }

      addLevelReward(interaction.guildId, level, role.id);
      await interaction.reply({ content: `✅ عند الوصول إلى المستوى **${level}** سيحصل العضو على ${role}.`, ephemeral: true });
      return;
    }

    if (sub === 'level-role-remove') {
      const level = interaction.options.getInteger('level', true);
      const removed = removeLevelReward(interaction.guildId, level);
      await interaction.reply({ content: removed ? `✅ تم حذف مكافأة المستوى **${level}**.` : `لا توجد مكافأة مسجلة للمستوى **${level}**.`, ephemeral: true });
    }
  }
});

process.on('unhandledRejection', error => console.error('Unhandled rejection:', error));
process.on('uncaughtException', error => console.error('Uncaught exception:', error));

client.login(process.env.DISCORD_TOKEN);
