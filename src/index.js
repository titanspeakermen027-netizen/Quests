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
  ButtonStyle
} = require('discord.js');
const { db, ensureUser } = require('./db');
const { dailyStatus, leaderboard, progress, completeEventQuest, awardCompletion } = require('./quests');

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

const commands = [
  new SlashCommandBuilder().setName('quests').setDescription('عرض مهامك اليومية وتقدمك.'),
  new SlashCommandBuilder().setName('quests-top').setDescription('عرض ترتيب أكثر الأعضاء إنجازاً للمهام.'),
  new SlashCommandBuilder().setName('quest-streak').setDescription('عرض سلسلة إنجاز المهام الخاصة بك.'),
  new SlashCommandBuilder().setName('achievements').setDescription('عرض إنجازاتك التي فتحتها.'),
  new SlashCommandBuilder().setName('mystery-box').setDescription('فتح الصندوق الغامض والحصول على مكافأة عشوائية.'),
  new SlashCommandBuilder().setName('event-complete').setDescription('تسجيل مشاركتك في فعالية.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
];

function pointsForRole() {
  return (process.env.MYSTERY_BOX_ROLE_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
}

function fmtProgress(q, done) {
  const barSize = 10;
  const ratio = done ? 1 : Math.min(q.progress / q.target, 1);
  const filled = Math.round(ratio * barSize);
  return `${'█'.repeat(filled)}${'░'.repeat(barSize - filled)} ${Math.min(q.progress, q.target)}/${q.target}`;
}

async function sendCompletions(interaction, completed) {
  if (!completed.length) return;
  const points = awardCompletion(interaction.guildId, interaction.user.id, completed);
  const names = completed.map(q => `**${q.title}**`).join('، ');
  await interaction.followUp({
    content: `🎉 أحسنت! أكملت ${names}.\n⭐ حصلت على **${points} نقطة** مقابل هذه الإنجازات.`,
    ephemeral: true
  });
}

async function handleProgress(message, type, amount = 1) {
  if (!message.guild || message.author.bot) return;
  const completed = progress(message.guild.id, message.author.id, type, amount);
  if (!completed.length) return;
  const points = awardCompletion(message.guild.id, message.author.id, completed);
  const text = completed.map(q => q.title).join('، ');
  await message.reply({ content: `🎉 **إنجاز مكتمل!**\n${text}\n⭐ حصلت على **${points} نقطة**.`, allowedMentions: { repliedUser: false } }).catch(() => {});
}

client.once('ready', async () => {
  await client.application.commands.set(commands.map(c => c.toJSON()), process.env.GUILD_ID || undefined);
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📌 Registered ${commands.length} slash commands.`);
});

client.on('messageCreate', async message => {
  await handleProgress(message, 'messages', 1);
});

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot || !reaction.message.guild) return;
  const completed = progress(reaction.message.guild.id, user.id, 'reactions', 1);
  if (completed.length) awardCompletion(reaction.message.guild.id, user.id, completed);
});

client.on('voiceStateUpdate', (oldState, newState) => {
  if (newState.member?.user.bot) return;
  if (!oldState.channelId && newState.channelId) {
    newState.member.__questsVoiceStarted = Date.now();
  }
  if (oldState.channelId && !newState.channelId && oldState.member?.__questsVoiceStarted) {
    const mins = Math.floor((Date.now() - oldState.member.__questsVoiceStarted) / 60000);
    if (mins > 0) {
      const completed = progress(oldState.guild.id, oldState.member.id, 'voice_minutes', mins);
      if (completed.length) awardCompletion(oldState.guild.id, oldState.member.id, completed);
    }
    delete oldState.member.__questsVoiceStarted;
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return interaction.reply({ content: 'هذا الأمر متاح داخل السيرفرات فقط.', ephemeral: true });

  ensureUser(interaction.guildId, interaction.user.id);

  if (interaction.commandName === 'quests') {
    const s = dailyStatus(interaction.guildId, interaction.user.id);
    const lines = s.quests.map(q => `${s.done.has(q.quest_id) ? '✅' : '▫️'} **${q.title}** — ${q.description}\n${fmtProgress(q, s.done.has(q.quest_id))} · ⭐ ${q.reward_points}`);
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle('📋 مهامك اليومية').setDescription(lines.join('\n\n')).setColor(0x5865F2).setFooter({ text: `اليوم: ${s.date} • أكملت ${s.done.size}/${s.quests.length}` })] });
  }

  if (interaction.commandName === 'quests-top') {
    const rows = leaderboard(interaction.guildId, 10);
    const lines = rows.length ? rows.map((r, i) => `**${i + 1}.** <@${r.user_id}> — 🏆 ${r.total_completed} مهمة · 🔥 ${r.streak} يوم`).join('\n') : 'لا توجد بيانات بعد.';
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🏆 ترتيب المهام').setDescription(lines).setColor(0xF1C40F)] });
  }

  if (interaction.commandName === 'quest-streak') {
    const u = db.prepare('SELECT streak, best_streak, total_completed FROM users WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, interaction.user.id);
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🏆 Quest Streak').setDescription(`🔥 السلسلة الحالية: **${u.streak} يوم**\n🏅 أعلى سلسلة: **${u.best_streak} يوم**\n✅ إجمالي المهام المكتملة: **${u.total_completed}**`).setColor(0x57F287)] });
  }

  if (interaction.commandName === 'achievements') {
    const count = db.prepare('SELECT COUNT(*) AS c FROM achievements WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, interaction.user.id).c;
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🏅 Achievements').setDescription(`لديك حالياً **${count}** إنجازات مفتوحة.\n\nسيتم توسيع هذا النظام ليشمل إنجازات مثل إكمال 7 أيام متتالية، إكمال جميع مهام اليوم، وفتح صناديق متعددة.`).setColor(0xEB459E)] });
  }

  if (interaction.commandName === 'event-complete') {
    const target = interaction.options.getUser('user');
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'لا تملك الصلاحية لاستخدام هذا الأمر.', ephemeral: true });
    const completed = completeEventQuest(interaction.guildId, target?.id || interaction.user.id);
    const points = awardCompletion(interaction.guildId, target?.id || interaction.user.id, completed);
    return interaction.reply({ content: completed.length ? `✅ تم تسجيل مشاركة <@${target?.id || interaction.user.id}> في الفعالية وحصل على **${points} نقطة**.` : 'تم تسجيل التقدم في مهمة الفعالية.' });
  }

  if (interaction.commandName === 'mystery-box') {
    const roles = pointsForRole();
    if (!roles.length) return interaction.reply({ content: 'لم يتم إعداد رتب الصندوق الغامض بعد. اطلب من إدارة السيرفر إعداد MYSTERY_BOX_ROLE_IDS.', ephemeral: true });
    const now = Date.now();
    const existing = db.prepare('SELECT last_opened_at FROM mystery_boxes WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, interaction.user.id);
    const cooldown = Number(process.env.MYSTERY_BOX_COOLDOWN_HOURS || 24) * 60 * 60 * 1000;
    if (existing?.last_opened_at && now - existing.last_opened_at < cooldown) {
      const remaining = cooldown - (now - existing.last_opened_at);
      const hours = Math.floor(remaining / 3600000);
      const mins = Math.ceil((remaining % 3600000) / 60000);
      return interaction.reply({ content: `⏳ يمكنك فتح **Mystery Box** مرة أخرى بعد **${hours} ساعة و${mins} دقيقة**.`, ephemeral: true });
    }

    const roleId = roles[Math.floor(Math.random() * roles.length)];
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) return interaction.reply({ content: 'إحدى الرتب المحددة للصندوق الغامض غير موجودة في هذا السيرفر.', ephemeral: true });
    try {
      await interaction.member.roles.add(role, 'Mystery Box reward');
    } catch {
      return interaction.reply({ content: 'تعذر منحك الرتبة. تأكد أن رتبة البوت أعلى من الرتبة المحددة.', ephemeral: true });
    }

    db.prepare(`INSERT INTO mystery_boxes (guild_id, user_id, last_opened_at) VALUES (?, ?, ?) ON CONFLICT(guild_id,user_id) DO UPDATE SET last_opened_at=excluded.last_opened_at`).run(interaction.guildId, interaction.user.id, now);
    db.prepare('UPDATE users SET boxes_opened = boxes_opened + 1 WHERE guild_id = ? AND user_id = ?').run(interaction.guildId, interaction.user.id);

    const ticketChannel = process.env.TICKET_CHANNEL_ID ? interaction.guild.channels.cache.get(process.env.TICKET_CHANNEL_ID) : null;
    const dm = `🎁 **لقد حصلت على Mystery Box!**\n\n🎉 المكافأة التي حصلت عليها: ${role}\n\n📩 لإتمام استلام المكافأة، افتح تذكرة في السيرفر${ticketChannel ? ` داخل ${ticketChannel}` : ''}.`;
    await interaction.user.send({ content: dm }).catch(() => {});
    return interaction.reply({ content: `🎁 مبروك! حصلت على **${role.name}** من Mystery Box.\n📩 أرسلت لك تفاصيل استلام المكافأة في الخاص.`, ephemeral: true });
  }
});

process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

client.login(process.env.DISCORD_TOKEN);
