require('dotenv').config();

const { Client, GatewayIntentBits, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const { db, getSetting, setSetting } = require('./db');
const { getLevelRewards, addLevelReward, removeLevelReward, levelXp } = require('./quests');

const adminClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

function guildOnly(interaction) {
  return interaction.guild && interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
}

function parseMysteryRewards(guildId) {
  try {
    const parsed = JSON.parse(getSetting(guildId, 'mystery_box_rewards', '[]'));
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.role_id === 'string' && Number(item.weight) > 0) : [];
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
  if (existing.length) return syncMysteryEnv(guildId);
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
    .addSubcommand(s => s.setName('view').setDescription('عرض الإعدادات الحالية.'))
    .addSubcommand(s => s.setName('mystery-role-add').setDescription('إضافة رتبة إلى جوائز Mystery Box.')
      .addRoleOption(o => o.setName('role').setDescription('الرتبة.').setRequired(true))
      .addNumberOption(o => o.setName('weight').setDescription('الوزن النسبي.').setRequired(true).setMinValue(0.01).setMaxValue(100000)))
    .addSubcommand(s => s.setName('mystery-role-remove').setDescription('حذف رتبة من جوائز Mystery Box.')
      .addRoleOption(o => o.setName('role').setDescription('الرتبة.').setRequired(true)))
    .addSubcommand(s => s.setName('mystery-roles').setDescription('عرض رتب Mystery Box وأوزانها.'))
    .addSubcommand(s => s.setName('level-role-add').setDescription('تعيين رتبة كمكافأة لمستوى.')
      .addIntegerOption(o => o.setName('level').setDescription('المستوى.').setRequired(true).setMinValue(2).setMaxValue(1000))
      .addRoleOption(o => o.setName('role').setDescription('الرتبة.').setRequired(true)))
    .addSubcommand(s => s.setName('level-role-remove').setDescription('حذف مكافأة رتبة من مستوى.')
      .addIntegerOption(o => o.setName('level').setDescription('المستوى.').setRequired(true).setMinValue(2).setMaxValue(1000)))
    .addSubcommand(s => s.setName('level-roles').setDescription('عرض مكافآت المستويات.'))
    .addSubcommand(s => s.setName('daily-count').setDescription('تحديد عدد المهام اليومية.')
      .addIntegerOption(o => o.setName('count').setDescription('من 3 إلى 8.').setRequired(true).setMinValue(3).setMaxValue(8)))
    .addSubcommand(s => s.setName('weekly-count').setDescription('تحديد عدد المهام الأسبوعية.')
      .addIntegerOption(o => o.setName('count').setDescription('من 2 إلى 7.').setRequired(true).setMinValue(2).setMaxValue(7)))
    .addSubcommand(s => s.setName('level-xp').setDescription('تحديد XP المطلوب لكل مستوى.')
      .addIntegerOption(o => o.setName('xp').setDescription('من 100 إلى 100000.').setRequired(true).setMinValue(100).setMaxValue(100000)))
    .addSubcommand(s => s.setName('daily-hour').setDescription('تحديد ساعة إعلان المهام اليومية.')
      .addIntegerOption(o => o.setName('hour').setDescription('من 0 إلى 23.').setRequired(true).setMinValue(0).setMaxValue(23)))
    .addSubcommand(s => s.setName('message-cooldown').setDescription('تحديد مهلة احتساب الرسائل.')
      .addIntegerOption(o => o.setName('seconds').setDescription('من 0 إلى 300.').setRequired(true).setMinValue(0).setMaxValue(300)))
    .addSubcommand(s => s.setName('announcement').setDescription('تحديد قناة إعلانات المهام.')
      .addChannelOption(o => o.setName('channel').setDescription('القناة.').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName('log').setDescription('تحديد قناة السجلات.')
      .addChannelOption(o => o.setName('channel').setDescription('القناة.').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName('ticket').setDescription('تحديد قناة تذاكر المكافآت.')
      .addChannelOption(o => o.setName('channel').setDescription('القناة.').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName('event-reward').setDescription('تحديد المكافأة الافتراضية للفعاليات.')
      .addIntegerOption(o => o.setName('points').setDescription('النقاط.').setRequired(true).setMinValue(1).setMaxValue(10000)))
    .addSubcommand(s => s.setName('season').setDescription('تحديد الموسم.')
      .addStringOption(o => o.setName('name').setDescription('اسم الموسم.').setRequired(true))
      .addStringOption(o => o.setName('start').setDescription('YYYY-MM-DD.').setRequired(true))
      .addStringOption(o => o.setName('end').setDescription('YYYY-MM-DD.').setRequired(true)));
}

adminClient.once('ready', async () => {
  for (const guild of adminClient.guilds.cache.values()) seedMysteryRewards(guild.id);
  const commands = adminClient.application.commands;
  const guildId = process.env.GUILD_ID || null;
  const existing = await commands.fetch(guildId || undefined).catch(() => null);
  const command = existing?.find(c => c.name === 'quests-admin');
  if (command) await command.edit(commandData().toJSON()).catch(() => {});
  else await commands.create(commandData().toJSON(), guildId || undefined).catch(error => console.error('Quests admin command registration error:', error));
  console.log(`🛠️ Quests admin controls ready as ${adminClient.user.tag}`);
});

adminClient.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'quests-admin') return;
  if (!guildOnly(interaction)) return interaction.reply({ content: 'هذا الأمر متاح لإدارة السيرفر فقط، وتحتاج إلى صلاحية إدارة السيرفر.', ephemeral: true });

  const guildId = interaction.guildId;
  seedMysteryRewards(guildId);
  const sub = interaction.options.getSubcommand();

  if (sub === 'view') {
    const rewards = parseMysteryRewards(guildId);
    const lines = [
      `📋 المهام اليومية: **${getSetting(guildId, 'daily_quest_count', process.env.DAILY_QUEST_COUNT || '5')}**`,
      `📅 المهام الأسبوعية: **${getSetting(guildId, 'weekly_quest_count', process.env.WEEKLY_QUEST_COUNT || '4')}**`,
      `✨ XP لكل مستوى: **${levelXp(guildId)}**`,
      `⏰ ساعة الإعلان: **${getSetting(guildId, 'daily_announcement_hour', process.env.DAILY_QUEST_HOUR || '0')}:00**`,
      `💬 مهلة الرسائل: **${getSetting(guildId, 'message_progress_cooldown_seconds', process.env.MESSAGE_PROGRESS_COOLDOWN_SECONDS || '8')} ثانية**`,
      `🎁 رتب Mystery Box: **${rewards.length}**`,
      `🎚️ مكافآت المستويات: **${getLevelRewards(guildId).length}**`,
      `🎉 مكافأة الفعالية الافتراضية: **${getSetting(guildId, 'event_default_reward', process.env.EVENT_DEFAULT_REWARD || '50')} نقطة**`
    ];
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle('⚙️ إعدادات Quests').setDescription(lines.join('\n')).setColor(0x5865F2)], ephemeral: true });
  }

  if (sub === 'mystery-roles') {
    const rewards = parseMysteryRewards(guildId);
    const total = rewards.reduce((sum, item) => sum + Number(item.weight), 0);
    const lines = rewards.length ? rewards.map((item, i) => {
      const role = interaction.guild.roles.cache.get(item.role_id);
      const pct = total ? (Number(item.weight) / total) * 100 : 0;
      return `**${i + 1}.** ${role || `<@&${item.role_id}>`} — وزن **${item.weight}** · **${pct.toFixed(2)}%**`;
    }).join('\n') : 'لا توجد رتب مضافة حالياً.';
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎁 Mystery Box — الرتب').setDescription(lines).setFooter({ text: 'الاحتمال محسوب من مجموع الأوزان.' }).setColor(0xF1C40F)], ephemeral: true });
  }

  if (sub === 'mystery-role-add') {
    const role = interaction.options.getRole('role', true);
    const weight = interaction.options.getNumber('weight', true);
    const botHighest = interaction.guild.members.me?.roles.highest?.position || 0;
    if (role.managed || role.position >= botHighest) return interaction.reply({ content: 'لا يمكن استخدام هذه الرتبة؛ يجب أن تكون قابلة للإدارة وأقل من أعلى رتبة للبوت.', ephemeral: true });
    const rewards = parseMysteryRewards(guildId).filter(item => item.role_id !== role.id);
    rewards.push({ role_id: role.id, weight });
    setSetting(guildId, 'mystery_box_rewards', JSON.stringify(rewards));
    syncMysteryEnv(guildId);
    return interaction.reply({ content: `✅ تمت إضافة ${role} إلى Mystery Box بوزن **${weight}**.`, ephemeral: true });
  }

  if (sub === 'mystery-role-remove') {
    const role = interaction.options.getRole('role', true);
    const rewards = parseMysteryRewards(guildId);
    const next = rewards.filter(item => item.role_id !== role.id);
    if (next.length === rewards.length) return interaction.reply({ content: 'هذه الرتبة غير موجودة في Mystery Box.', ephemeral: true });
    setSetting(guildId, 'mystery_box_rewards', JSON.stringify(next));
    syncMysteryEnv(guildId);
    return interaction.reply({ content: `✅ تمت إزالة ${role} من جوائز Mystery Box.`, ephemeral: true });
  }

  if (sub === 'level-roles') {
    const rewards = getLevelRewards(guildId);
    const lines = rewards.length ? rewards.map(item => `🎚️ المستوى **${item.level}** → <@&${item.role_id}>`).join('\n') : 'لا توجد مكافآت مستويات حالياً.';
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎚️ مكافآت المستويات').setDescription(lines).setColor(0x57F287)], ephemeral: true });
  }

  if (sub === 'level-role-add') {
    const level = interaction.options.getInteger('level', true);
    const role = interaction.options.getRole('role', true);
    const botHighest = interaction.guild.members.me?.roles.highest?.position || 0;
    if (role.managed || role.position >= botHighest) return interaction.reply({ content: 'لا يمكن استخدام هذه الرتبة؛ يجب أن تكون أقل من أعلى رتبة للبوت.', ephemeral: true });
    addLevelReward(guildId, level, role.id);
    return interaction.reply({ content: `✅ المستوى **${level}** أصبح يمنح ${role}.`, ephemeral: true });
  }

  if (sub === 'level-role-remove') {
    const level = interaction.options.getInteger('level', true);
    const removed = removeLevelReward(guildId, level);
    return interaction.reply({ content: removed ? `✅ تم حذف مكافأة المستوى **${level}**.` : 'لا توجد مكافأة لهذا المستوى.', ephemeral: true });
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
    return interaction.reply({ content: `✅ تم تحديث الإعداد **${key}** إلى **${value}**.`, ephemeral: true });
  }

  if (sub === 'announcement' || sub === 'log' || sub === 'ticket') {
    const channel = interaction.options.getChannel('channel', true);
    const key = sub === 'announcement' ? 'announcement_channel_id' : sub === 'log' ? 'log_channel_id' : 'ticket_channel_id';
    setSetting(guildId, key, channel.id);
    return interaction.reply({ content: `✅ تم تحديد ${channel} كقناة للإعداد **${key}**.`, ephemeral: true });
  }

  if (sub === 'season') {
    const name = interaction.options.getString('name', true).trim().slice(0, 100);
    const start = interaction.options.getString('start', true).trim();
    const end = interaction.options.getString('end', true).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) return interaction.reply({ content: 'التاريخ غير صالح. استخدم YYYY-MM-DD وتأكد أن البداية تسبق النهاية.', ephemeral: true });
    setSetting(guildId, 'season_name', name);
    setSetting(guildId, 'season_start', start);
    setSetting(guildId, 'season_end', end);
    return interaction.reply({ content: `✅ تم إعداد الموسم **${name}** من **${start}** إلى **${end}**.`, ephemeral: true });
  }
});

if (process.env.DISCORD_TOKEN) adminClient.login(process.env.DISCORD_TOKEN).catch(error => console.error('Quests admin login error:', error));

module.exports = { adminClient };
