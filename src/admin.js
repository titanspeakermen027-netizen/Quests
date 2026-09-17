require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType
} = require('discord.js');

const { db, getSetting, setSetting } = require('./db');
const {
  getLevelRewards,
  addLevelReward,
  removeLevelReward,
  levelXp
} = require('./quests');

// This client provides a Discord-only administration surface. It runs in the
// same Node process as the main client so Mystery Box changes take effect
// immediately without editing .env or restarting the bot.
const adminClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

function guildOnly(interaction) {
  return interaction.guild && interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
}

function parseMysteryRewards(guildId) {
  const raw = getSetting(guildId, 'mystery_box_rewards', '[]');
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item => item && typeof item.role_id === 'string' && Number(item.weight) > 0);
  } catch {
    return [];
  }
}

function syncMysteryEnv(guildId) {
  const rewards = parseMysteryRewards(guildId);
  process.env.MYSTERY_BOX_ROLE_IDS = rewards.map(item => item.role_id).join(',');
  process.env.MYSTERY_BOX_ROLE_WEIGHTS = rewards.map(item => String(item.weight)).join(',');
  return rewards;
}

function seedMysteryRewards(guildId) {
  const existing = parseMysteryRewards(guildId);
  if (existing.length) {
    syncMysteryEnv(guildId);
    return existing;
  }

  const ids = (process.env.MYSTERY_BOX_ROLE_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
  const weights = (process.env.MYSTERY_BOX_ROLE_WEIGHTS || '').split(',').map(x => Number(x));
  const seeded = ids.map((role_id, index) => ({ role_id, weight: Number.isFinite(weights[index]) && weights[index] > 0 ? weights[index] : 1 }));
  if (seeded.length) setSetting(guildId, 'mystery_box_rewards', JSON.stringify(seeded));
  return syncMysteryEnv(guildId);
}

function commandData() {
  return new SlashCommandBuilder()
    .setName('quests-admin')
    .setDescription('إدارة جميع إعدادات Quests من Discord.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub.setName('view').setDescription('عرض الإعدادات الحالية.'))
    .addSubcommand(sub => sub.setName('mystery-role-add').setDescription('إضافة رتبة إلى جوائز Mystery Box.')
      .addRoleOption(o => o.setName('role').setDescription('الرتبة.').setRequired(true))
      .addNumberOption(o => o.setName('weight').setDescription('احتمال نسبي، مثل 60.').setRequired(true).setMinValue(0.01).setMaxValue(100000)))
    .addSubcommand(sub => sub.setName('mystery-role-remove').setDescription('حذف رتبة من جوائز Mystery Box.')
      .addRoleOption(o => o.setName('role').setDescription('الرتبة.').setRequired(true)))
    .addSubcommand(sub => sub.setName('mystery-roles').setDescription('عرض رتب Mystery Box واحتمالاتها.'))
    .addSubcommand(sub => sub.setName('level-role-add').setDescription('تعيين رتبة كمكافأة لمستوى.')
      .addIntegerOption(o => o.setName('level').setDescription('المستوى.').setRequired(true).setMinValue(2).setMaxValue(1000))
      .addRoleOption(o => o.setName('role').setDescription('الرتبة.').setRequired(true)))
    .addSubcommand(sub => sub.setName('level-role-remove').setDescription('حذف مكافأة رتبة من مستوى.')
      .addIntegerOption(o => o.setName('level').setDescription('المستوى.').setRequired(true).setMinValue(2).setMaxValue(1000)))
    .addSubcommand(sub => sub.setName('level-roles').setDescription('عرض مكافآت المستويات.'))
    .addSubcommand(sub => sub.setName('daily-count').setDescription('تحديد عدد المهام اليومية.')
      .addIntegerOption(o => o.setName('count').setDescription('من 3 إلى 8.').setRequired(true).setMinValue(3).setMaxValue(8)))
    .addSubcommand(sub => sub.setName('weekly-count').setDescription('تحديد عدد المهام الأسبوعية.')
      .addIntegerOption(o => o.setName('count').setDescription('من 2 إلى 7.').setRequired(true).setMinValue(2).setMaxValue(7)))
    .addSubcommand(sub => sub.setName('level-xp').setDescription('تحديد XP المطلوب لكل مستوى.')
      .addIntegerOption(o => o.setName('xp').setDescription('من 100 إلى 100000.').setRequired(true).setMinValue(100).setMaxValue(100000)))
    .addSubcommand(sub => sub.setName('daily-hour').setDescription('تحديد ساعة إعلان المهام اليومية بتوقيت البوت.')
      .addIntegerOption(o => o.setName('hour').setDescription('0 إلى 23.').setRequired(true).setMinValue(0).setMaxValue(23)))
    .addSubcommand(sub => sub.setName('message-cooldown').setDescription('تحديد مهلة احتساب الرسائل بالثواني.')
      .addIntegerOption(o => o.setName('seconds').setDescription('0 إلى 300.').setRequired(true).setMinValue(0).setMaxValue(300)))
    .addSubcommand(sub => sub.setName('announcement').setDescription('تحديد قناة إعلانات المهام.')
      .addChannelOption(o => o.setName('channel').setDescription('قناة نصية.').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(sub => sub.setName('log').setDescription('تحديد قناة السجلات.')
      .addChannelOption(o => o.setName('channel').setDescription('قناة نصية.').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(sub => sub.setName('ticket').setDescription('تحديد قناة تذاكر المكافآت.')
      .addChannelOption(o => o.setName('channel').setDescription('قناة نصية.').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(sub => sub.setName('event-reward').setDescription('تحديد المكافأة الافتراضية للفعاليات.')
      .addIntegerOption(o => o.setName('points').setDescription('النقاط.').setRequired(true).setMinValue(1).setMaxValue(10000)))
    .addSubcommand(sub => sub.setName('season').setDescription('تحديد الموسم.')
      .addStringOption(o => o.setName('name').setDescription('اسم الموسم.').setRequired(true))
      .addStringOption(o => o.setName('start').setDescription('YYYY-MM-DD.').setRequired(true))
      .addStringOption(o => o.setName('end').setDescription('YYYY-MM-DD.').setRequired(true)));
}

adminClient.once('ready', async () => {
  for (const guild of adminClient.guilds.cache.values()) seedMysteryRewards(guild.id);
  await adminClient.application.commands.set([commandData().toJSON()], process.env.GUILD_ID || undefined);
  console.log(`🛠️ Quests admin controls ready as ${adminClient.user.tag}`);
});

adminClient.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'quests-admin') return;

  if (!guildOnly(interaction)) {
    await interaction.reply({ content: 'هذا الأمر متاح لإدارة السيرفر فقط، وتحتاج إلى صلاحية إدارة السيرفر.', ephemeral: true });
    return;
  }

  const guildId = interaction.guildId;
  seedMysteryRewards(guildId);
  const sub = interaction.options.getSubcommand();

  if (sub === 'view') {
    const rewards = parseMysteryRewards(guildId);
    const levelRewards = getLevelRewards(guildId);
    const lines = [
      `📋 المهام اليومية: **${getSetting(guildId, 'daily_quest_count', process.env.DAILY_QUEST_COUNT || '5')}**`,
      `📅 المهام الأسبوعية: **${getSetting(guildId, 'weekly_quest_count', process.env.WEEKLY_QUEST_COUNT || '4')}**`,
      `✨ XP لكل مستوى: **${levelXp(guildId)}**`,
      `⏰ ساعة الإعلان: **${getSetting(guildId, 'daily_announcement_hour', process.env.DAILY_QUEST_HOUR || '0')}:00**`,
      `💬 مهلة الرسائل: **${getSetting(guildId, 'message_progress_cooldown_seconds', process.env.MESSAGE_PROGRESS_COOLDOWN_SECONDS || '8')} ثانية**`,
      `🎁 رتب Mystery Box: **${rewards.length}**`,
      `🎚️ مكافآت المستويات: **${levelRewards.length}**`,
      `🎉 مكافأة الفعالية الافتراضية: **${getSetting(guildId, 'event_default_reward', process.env.EVENT_DEFAULT_REWARD || '50')} نقطة**`
    ];
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('⚙️ إعدادات Quests').setDescription(lines.join('\n')).setColor(0x5865F2)], ephemeral: true });
    return;
  }

  if (sub === 'mystery-roles') {
    const rewards = parseMysteryRewards(guildId);
    const total = rewards.reduce((sum, item) => sum + Number(item.weight), 0);
    const guild = interaction.guild;
    const lines = rewards.length
      ? rewards.map((item, index) => {
          const role = guild.roles.cache.get(item.role_id);
          const pct = total > 0 ? (Number(item.weight) / total) * 100 : 0;
          return `**${index + 1}.** ${role || `<@&${item.role_id}>`} — وزن **${item.weight}** · احتمال تقريبي **${pct.toFixed(2)}%**`;
        }).join('\n')
      : 'لا توجد رتب مضافة حالياً.';
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎁 Mystery Box — الرتب').setDescription(lines).setFooter({ text: 'الاحتمال يُحسب من مجموع الأوزان.' }).setColor(0xF1C40F)], ephemeral: true });
    return;
  }

  if (sub === 'mystery-role-add') {
    const role = interaction.options.getRole('role', true);
    const weight = interaction.options.getNumber('weight', true);
    const botHighest = interaction.guild.members.me?.roles.highest?.position || 0;
    if (role.managed || role.position >= botHighest) {
      await interaction.reply({ content: 'لا يمكن استخدام هذه الرتبة. يجب أن تكون قابلة للإدارة وأقل من أعلى رتبة للبوت.', ephemeral: true });
      return;
    }
    const rewards = parseMysteryRewards(guildId).filter(item => item.role_id !== role.id);
    rewards.push({ role_id: role.id, weight });
    setSetting(guildId, 'mystery_box_rewards', JSON.stringify(rewards));
    syncMysteryEnv(guildId);
    await interaction.reply({ content: `✅ تمت إضافة ${role} إلى Mystery Box بوزن **${weight}**.`, ephemeral: true });
    return;
  }

  if (sub === 'mystery-role-remove') {
    const role = interaction.options.getRole('role', true);
    const rewards = parseMysteryRewards(guildId);
    const next = rewards.filter(item => item.role_id !== role.id);
    if (next.length === rewards.length) {
      await interaction.reply({ content: 'هذه الرتبة غير موجودة في Mystery Box.', ephemeral: true });
      return;
    }
    setSetting(guildId, 'mystery_box_rewards', JSON.stringify(next));
    syncMysteryEnv(guildId);
    await interaction.reply({ content: `✅ تمت إزالة ${role} من جوائز Mystery Box.`, ephemeral: true });
    return;
  }

  if (sub === 'level-roles') {
    const rewards = getLevelRewards(guildId);
    const lines = rewards.length ? rewards.map(item => `🎚️ المستوى **${item.level}** → <@&${item.role_id}>`).join('\n') : 'لا توجد مكافآت مستويات حالياً.';
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎚️ مكافآت المستويات').setDescription(lines).setColor(0x57F287)], ephemeral: true });
    return;
  }

  if (sub === 'level-role-add') {
    const level = interaction.options.getInteger('level', true);
    const role = interaction.options.getRole('role', true);
    const botHighest = interaction.guild.members.me?.roles.highest?.position || 0;
    if (role.managed || role.position >= botHighest) {
      await interaction.reply({ content: 'لا يمكن استخدام هذه الرتبة؛ يجب أن تكون أقل من أعلى رتبة للبوت.', ephemeral: true });
      return;
    }
    addLevelReward(guildId, level, role.id);
    await interaction.reply({ content: `✅ المستوى **${level}** أصبح يمنح ${role}.`, ephemeral: true });
    return;
  }

  if (sub === 'level-role-remove') {
    const level = interaction.options.getInteger('level', true);
    const removed = removeLevelReward(guildId, level);
    await interaction.reply({ content: removed ? `✅ تم حذف مكافأة المستوى **${level}**.` : 'لا توجد مكافأة لهذا المستوى.', ephemeral: true });
    return;
  }

  const settings = {
    'daily-count': ['daily_quest_count', interaction.options.getInteger('count', true)],
    'weekly-count': ['weekly_quest_count', interaction.options.getInteger('count', true)],
    'level-xp': ['level_xp', interaction.options.getInteger('xp', true)],
    'daily-hour': ['daily_announcement_hour', interaction.options.getInteger('hour', true)],
    'message-cooldown': ['message_progress_cooldown_seconds', interaction.options.getInteger('seconds', true)],
    'event-reward': ['event_default_reward', interaction.options.getInteger('points', true)]
  };

  if (settings[sub]) {
    const [key, value] = settings[sub];
    setSetting(guildId, key, value);
    if (key === 'message_progress_cooldown_seconds') process.env.MESSAGE_PROGRESS_COOLDOWN_SECONDS = String(value);
    if (key === 'daily_announcement_hour') process.env.DAILY_QUEST_HOUR = String(value);
    if (key === 'event_default_reward') process.env.EVENT_DEFAULT_REWARD = String(value);
    await interaction.reply({ content: `✅ تم تحديث الإعداد **${key}** إلى **${value}**.`, ephemeral: true });
    return;
  }

  if (sub === 'announcement' || sub === 'log' || sub === 'ticket') {
    const channel = interaction.options.getChannel('channel', true);
    const key = sub === 'announcement' ? 'announcement_channel_id' : sub === 'log' ? 'log_channel_id' : 'ticket_channel_id';
    setSetting(guildId, key, channel.id);
    await interaction.reply({ content: `✅ تم تحديد ${channel} كقناة للإعداد **${key}**.`, ephemeral: true });
    return;
  }

  if (sub === 'season') {
    const name = interaction.options.getString('name', true).trim().slice(0, 100);
    const start = interaction.options.getString('start', true).trim();
    const end = interaction.options.getString('end', true).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
      await interaction.reply({ content: 'التاريخ غير صالح. استخدم YYYY-MM-DD وتأكد أن البداية تسبق النهاية.', ephemeral: true });
      return;
    }
    setSetting(guildId, 'season_name', name);
    setSetting(guildId, 'season_start', start);
    setSetting(guildId, 'season_end', end);
    await interaction.reply({ content: `✅ تم إعداد الموسم **${name}** من **${start}** إلى **${end}**.`, ephemeral: true });
  }
});

if (process.env.DISCORD_TOKEN) {
  adminClient.login(process.env.DISCORD_TOKEN).catch(error => console.error('Quests admin login error:', error));
}

module.exports = { adminClient };
