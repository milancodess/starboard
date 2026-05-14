require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActivityType,
  Collection,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags,
  SlashCommandBuilder,
  ChannelType,
  AttachmentBuilder,
} = require("discord.js");
const mongoose = require("mongoose");
const Starboard = require("./models/Starboard");
const FreeGame = require("./models/FreeGame");
const config = require("./config");
const metaDownloader = require("metadownloader");
const { getEpicFreeGames } = require("./epic");

const META_MAX_DOWNLOAD_BYTES =
  (parseInt(process.env.META_MAX_DOWNLOAD_MB, 10) || 25) * 1024 * 1024;

const LOG_COLORS = {
  success: "\x1b[32m",
  error: "\x1b[31m",
  info: "\x1b[37m",
  reset: "\x1b[0m",
};

function logWithColor(method, color, args) {
  const [first = "", ...rest] = args;
  method(`${color}${first}`, ...rest, LOG_COLORS.reset);
}

const logger = {
  success: (...args) => logWithColor(console.log, LOG_COLORS.success, args),
  error: (...args) => logWithColor(console.error, LOG_COLORS.error, args),
  info: (...args) => logWithColor(console.log, LOG_COLORS.info, args),
};

// Create bot client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Cache for cooldowns
const cooldowns = new Collection();

const slashCommands = [
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("View starboard statistics"),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show starboard bot help"),
  new SlashCommandBuilder()
    .setName("copy")
    .setDescription("Copy messages from another channel into this channel")
    .addChannelOption((option) =>
      option
        .setName("source")
        .setDescription("The channel to copy messages from")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription("Optional number of messages to copy")
        .setMinValue(1)
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("meta")
    .setDescription("Download an Instagram or Facebook video")
    .addStringOption((option) =>
      option
        .setName("url")
        .setDescription("Instagram or Facebook video URL")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("games")
    .setDescription("Show current free games on Epic Games Store"),
].map((command) => command.toJSON());

// MongoDB Connection
async function connectMongoDB() {
  try {
    await mongoose.connect(config.MONGODB_URI);
    logger.success("MongoDB connected successfully");
  } catch (error) {
    logger.error("MongoDB connection error:", error);
    process.exit(1);
  }
}

// Get count for a specific emoji
function getEmojiCount(message, emojiName, excludeBot = true) {
  const reaction = message.reactions.cache.find(
    (r) => r.emoji.toString() === emojiName,
  );
  if (!reaction) return 0;

  let count = reaction.count;
  if (excludeBot && reaction.users.cache.has(client.user.id)) {
    count--;
  }
  return count;
}

// Get all reactions breakdown
function getAllReactions(message, excludeBot = true) {
  const breakdown = {};

  for (const reaction of message.reactions.cache.values()) {
    let count = reaction.count;
    if (excludeBot && reaction.users.cache.has(client.user.id)) {
      count--;
    }

    if (count > 0) {
      breakdown[reaction.emoji.toString()] = count;
    }
  }

  return breakdown;
}

// Check if user is reacting to their own message
function isSelfReact(reaction, user) {
  return reaction.message.author.id === user.id;
}

function getMessageContent(message) {
  let content = "";

  if (message.content && message.content.trim()) {
    content = message.content;
  }

  if (message.attachments.size > 0) {
    for (const attachment of message.attachments.values()) {
      if (
        !attachment.contentType ||
        (!attachment.contentType.startsWith("image/") &&
          !attachment.contentType.startsWith("video/"))
      ) {
        content += `\nAttachment: ${attachment.name}`;
      }
    }
  }

  if (message.stickers.size > 0) {
    content += `\n**Sticker**: ${message.stickers.first().name || "Sticker"}`;
  }

  return content || null;
}

// Get image/GIF URL from message
function getImageUrl(message) {
  // Check attachments first
  for (const attachment of message.attachments.values()) {
    if (attachment.contentType && attachment.contentType.startsWith("image/")) {
      return attachment.url;
    }
  }

  // Check embeds for images
  for (const embed of message.embeds) {
    if (embed.image && embed.image.url) {
      return embed.image.url;
    }
    if (embed.thumbnail && embed.thumbnail.url) {
      return embed.thumbnail.url;
    }
    if (embed.video && embed.video.url) {
      return embed.video.url;
    }
  }

  return null;
}

// Check if message contains GIF
function isGif(message) {
  for (const attachment of message.attachments.values()) {
    if (attachment.contentType === "image/gif") {
      return true;
    }
  }
  return false;
}

function createStarboardEmbed(message, triggerEmoji, triggerCount) {
  let content = getMessageContent(message);

  if (content && content.length > 2000) {
    content = content.substring(0, 1997) + "...";
  }

  const embed = new EmbedBuilder()
    .setColor(config.COLORS.STARBOARD)
    .setTimestamp(message.createdAt)
    .setAuthor({
      name: message.author.displayName,
      iconURL: message.author.avatarURL() || message.author.defaultAvatarURL,
    });

  if (content) {
    embed.setDescription(content);
  }

  const imageUrl = getImageUrl(message);
  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  embed.addFields({
    name: `${triggerEmoji} Reactions`,
    value: `${triggerCount} reactions`,
    inline: false,
  });

  return embed;
}

function createJumpButton(message) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Jump to Message")
      .setStyle(ButtonStyle.Link)
      .setURL(message.url),
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveChannelArgument(message, channelArg) {
  if (!channelArg) return null;

  const channelId = channelArg.replace(/[<#>]/g, "");
  return message.guild.channels.cache.get(channelId) || null;
}

function userCanCopyMessages(member) {
  return member.permissions.has(PermissionFlagsBits.ManageGuild);
}

function botCanCopyMessages(sourceChannel, destinationChannel) {
  const sourcePermissions = sourceChannel.permissionsFor(client.user);
  const destinationPermissions = destinationChannel.permissionsFor(client.user);

  return (
    sourcePermissions?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
    ]) &&
    destinationPermissions?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.AttachFiles,
    ])
  );
}

function createCopiedMessagePayload(originalMessage) {
  const parts = [];

  if (originalMessage.content) {
    parts.push(originalMessage.content);
  }

  if (originalMessage.stickers.size > 0) {
    for (const sticker of originalMessage.stickers.values()) {
      parts.push(`Sticker: ${sticker.name || "Sticker"}`);
    }
  }

  const files = [];
  for (const attachment of originalMessage.attachments.values()) {
    files.push({
      attachment: attachment.url,
      name: attachment.name || undefined,
    });
  }

  const body = parts.join("\n").trim();

  return {
    content: body.length > 2000 ? `${body.slice(0, 1997)}...` : body,
    files,
    allowedMentions: { parse: [] },
    flags: MessageFlags.SuppressEmbeds,
  };
}

async function fetchChannelMessages(channel, limit = null) {
  const messages = [];
  let before;

  while (!limit || messages.length < limit) {
    const remaining = limit ? limit - messages.length : 100;
    const batchSize = Math.min(100, remaining);
    const options = { limit: batchSize };

    if (before) {
      options.before = before;
    }

    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;

    messages.push(...batch.values());
    before = batch.last().id;

    if (batch.size < batchSize) break;
  }

  return messages.reverse();
}

async function copyChannelMessages({
  member,
  sourceChannel,
  destinationChannel,
  requestedLimit,
  reply,
  editReply,
}) {
  if (!userCanCopyMessages(member)) {
    await reply({
      content: "You need the **Manage Server** permission to copy channels.",
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (!sourceChannel || !sourceChannel.isTextBased()) {
    await reply({
      content:
        "Please choose a text channel to copy from. Example: `!copy #source-channel` or `/copy source:#source-channel`",
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (sourceChannel.id === destinationChannel.id) {
    await reply({
      content:
        "Choose a different destination channel, then run the command there.",
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (!botCanCopyMessages(sourceChannel, destinationChannel)) {
    await reply({
      content:
        "I need permission to view/read the source channel and send messages with attachments in this channel.",
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (
    requestedLimit !== null &&
    (!Number.isInteger(requestedLimit) || requestedLimit < 1)
  ) {
    await reply({
      content: "The optional limit must be a positive number.",
      allowedMentions: { parse: [] },
    });
    return;
  }

  const statusMessage = await reply({
    content: `Copying messages from ${sourceChannel} into this channel...`,
    allowedMentions: { parse: [] },
  });

  try {
    const messages = await fetchChannelMessages(sourceChannel, requestedLimit);
    let copiedCount = 0;
    let skippedCount = 0;

    for (const originalMessage of messages) {
      if (
        originalMessage.system ||
        originalMessage.author.id === client.user.id
      ) {
        skippedCount++;
        continue;
      }

      const payload = createCopiedMessagePayload(originalMessage);
      if (!payload.content && payload.files.length === 0) {
        skippedCount++;
        continue;
      }

      await destinationChannel.send(payload);
      copiedCount++;

      if (copiedCount % 25 === 0) {
        await editReply(
          statusMessage,
          `Copying messages from ${sourceChannel}... ${copiedCount}/${messages.length} copied.`,
        );
      }

      await sleep(750);
    }

    await editReply(
      statusMessage,
      `Done copying from ${sourceChannel}. Copied ${copiedCount} message(s), skipped ${skippedCount}.`,
    );
  } catch (error) {
    logger.error("Error copying channel messages:", error);
    await editReply(
      statusMessage,
      "Something went wrong while copying messages. Check my channel permissions and try again.",
    );
  }
}

async function copyChannelMessagesFromMessage(message, args) {
  const requestedLimit = args[1] ? parseInt(args[1], 10) : null;

  await copyChannelMessages({
    member: message.member,
    sourceChannel: resolveChannelArgument(message, args[0]),
    destinationChannel: message.channel,
    requestedLimit,
    reply: (payload) => message.reply(payload),
    editReply: (statusMessage, content) => statusMessage.edit(content),
  });
}

async function copyChannelMessagesFromInteraction(interaction) {
  await interaction.deferReply({ ephemeral: true });

  await copyChannelMessages({
    member: interaction.member,
    sourceChannel: interaction.options.getChannel("source"),
    destinationChannel: interaction.channel,
    requestedLimit: interaction.options.getInteger("limit"),
    reply: (payload) => interaction.editReply(payload),
    editReply: (_statusMessage, content) => interaction.editReply(content),
  });
}

function isSupportedMetaUrl(input) {
  try {
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    return (
      hostname === "instagram.com" ||
      hostname.endsWith(".instagram.com") ||
      hostname === "facebook.com" ||
      hostname.endsWith(".facebook.com") ||
      hostname === "fb.watch"
    );
  } catch (error) {
    return false;
  }
}

function isHttpUrl(input) {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (error) {
    return false;
  }
}

function getMetaDownloadItems(result) {
  const items = Array.isArray(result?.data) ? result.data : [];
  return items.filter((item) => item?.url && isHttpUrl(item.url));
}

function getExtensionFromContentType(contentType) {
  if (contentType.includes("video/mp4")) return "mp4";
  if (contentType.includes("video/webm")) return "webm";
  if (contentType.includes("image/jpeg")) return "jpg";
  if (contentType.includes("image/png")) return "png";
  if (contentType.includes("image/webp")) return "webp";
  return "mp4";
}

function looksLikeVideoUrl(mediaUrl) {
  try {
    const pathname = new URL(mediaUrl).pathname.toLowerCase();
    return /\.(mp4|mov|m4v|webm)(\?|$)/.test(pathname);
  } catch (error) {
    return false;
  }
}

async function fetchMediaAttachment(mediaUrl) {
  const response = await fetch(mediaUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}`);
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (contentLength > META_MAX_DOWNLOAD_BYTES) {
    throw new Error("Media is larger than the configured upload limit");
  }

  const contentType = response.headers.get("content-type") || "video/mp4";
  const isVideo =
    contentType.startsWith("video/") ||
    contentType.includes("application/octet-stream") ||
    looksLikeVideoUrl(mediaUrl);
  if (!isVideo) {
    throw new Error("Downloader returned a non-video file");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Downloader response did not include a readable body");
  }

  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.length;
    if (totalBytes > META_MAX_DOWNLOAD_BYTES) {
      throw new Error("Media is larger than the configured upload limit");
    }

    chunks.push(Buffer.from(value));
  }

  const extension = getExtensionFromContentType(contentType);
  const attachment = new AttachmentBuilder(Buffer.concat(chunks, totalBytes), {
    name: `meta-download.${extension}`,
  });

  return { attachment, totalBytes };
}

async function fetchFirstVideoAttachment(items) {
  let lastError;

  for (const item of items) {
    try {
      return await fetchMediaAttachment(item.url);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("No downloadable video found");
}

async function getMetaDownloadPayload(url) {
  if (!url || !isSupportedMetaUrl(url)) {
    return {
      content:
        "Please provide a valid Instagram or Facebook video URL. Example: `!meta https://www.instagram.com/reel/...`",
      allowedMentions: { parse: [] },
    };
  }

  const result = await metaDownloader(url);
  const items = getMetaDownloadItems(result);

  if (!result?.status || items.length === 0) {
    return {
      content:
        "I could not find a downloadable video for that URL. Check that the post is public and try again.",
      allowedMentions: { parse: [] },
    };
  }

  const { attachment } = await fetchFirstVideoAttachment(items);

  return {
    content: "Downloaded video:",
    files: [attachment],
    allowedMentions: { parse: [] },
  };
}

async function downloadMetaFromMessage(message, args) {
  const url = args[0];
  const statusMessage = await message.reply({
    content: "Downloading video...",
    allowedMentions: { parse: [] },
  });

  try {
    const payload = await getMetaDownloadPayload(url);
    await statusMessage.edit(payload);
    logger.success(`Downloaded meta video for ${message.author.id}`);
  } catch (error) {
    logger.error("Error downloading meta video:", error);
    await statusMessage.edit({
      content:
        "Something went wrong while downloading the video. It may be private, expired, or too large to upload.",
      allowedMentions: { parse: [] },
    });
  }
}

async function downloadMetaFromInteraction(interaction) {
  await interaction.deferReply();

  try {
    const payload = await getMetaDownloadPayload(
      interaction.options.getString("url"),
    );
    await interaction.editReply(payload);
    logger.success(`Downloaded meta video for ${interaction.user.id}`);
  } catch (error) {
    logger.error("Error downloading meta video:", error);
    await interaction.editReply({
      content:
        "Something went wrong while downloading the video. It may be private, expired, or too large to upload.",
      allowedMentions: { parse: [] },
    });
  }
}

// Check if any emoji has reached threshold
function checkThreshold(reactions) {
  for (const count of Object.values(reactions)) {
    if (count >= config.REACTION_THRESHOLD) {
      return true;
    }
  }
  return false;
}

// Get emoji that crossed threshold (highest count)
function getTriggerEmoji(reactions) {
  let triggerEmoji = null;
  let highestCount = 0;

  for (const [emoji, count] of Object.entries(reactions)) {
    if (count >= config.REACTION_THRESHOLD && count > highestCount) {
      highestCount = count;
      triggerEmoji = emoji;
    }
  }

  return { emoji: triggerEmoji, count: highestCount };
}

// Send or update message in starboard
async function sendToStarboard(
  message,
  triggerEmoji,
  triggerCount,
  allReactions,
) {
  // Get starboard channel
  const starboardChannel = client.channels.cache.get(
    config.STARBOARD_CHANNEL_ID,
  );
  if (!starboardChannel) {
    logger.error(`Starboard channel ${config.STARBOARD_CHANNEL_ID} not found!`);
    return false;
  }

  // Check if message is already in starboard
  const existingEntry = await Starboard.findOne({
    originalMessageId: message.id,
  });

  if (existingEntry) {
    // If different emoji triggered the update, update the trigger
    if (
      existingEntry.triggerEmoji !== triggerEmoji &&
      triggerCount > existingEntry.reactionCount
    ) {
      existingEntry.triggerEmoji = triggerEmoji;
      existingEntry.reactionCount = triggerCount;
    } else if (triggerCount > existingEntry.reactionCount) {
      existingEntry.reactionCount = triggerCount;
    }

    existingEntry.allReactions = allReactions;
    await existingEntry.save();

    try {
      // Fetch the existing starboard message
      const starboardMessage = await starboardChannel.messages.fetch(
        existingEntry.starboardMessageId,
      );

      const embed = createStarboardEmbed(
        message,
        existingEntry.triggerEmoji,
        existingEntry.reactionCount,
      );
      const row = createJumpButton(message);

      await starboardMessage.edit({ embeds: [embed], components: [row] });

      logger.success(
        `Updated starboard message for ${message.id} (${triggerCount} reactions)`,
      );
      return true;
    } catch (error) {
      if (error.code === 10008) {
        // Unknown Message
        logger.info(
          "Starboard message not found, removing from database and resending",
        );
        await Starboard.deleteOne({ originalMessageId: message.id });
        return await sendToStarboard(
          message,
          triggerEmoji,
          triggerCount,
          allReactions,
        );
      } else {
        logger.error("Error updating starboard:", error);
        return false;
      }
    }
  } else {
    // Send new starboard message
    try {
      const embed = createStarboardEmbed(message, triggerEmoji, triggerCount);
      const row = createJumpButton(message);

      const starboardMessage = await starboardChannel.send({
        embeds: [embed],
        components: [row],
      });

      // Save to database
      const starboardEntry = new Starboard({
        originalMessageId: message.id,
        starboardMessageId: starboardMessage.id,
        originalChannelId: message.channel.id,
        guildId: message.guild.id,
        triggerEmoji: triggerEmoji,
        reactionCount: triggerCount,
        allReactions: allReactions,
        authorId: message.author.id,
        authorName: message.author.displayName,
        authorAvatar: message.author.avatarURL(),
      });

      await starboardEntry.save();

      logger.success(
        `Sent new starboard message for ${message.id} (${triggerCount} reactions)`,
      );
      return true;
    } catch (error) {
      logger.error("Error sending to starboard:", error);
      return false;
    }
  }
}

// Process reaction changes
async function processReactionChange(reaction, user, isAdd) {
  // Ignore bot's own reactions
  if (user.id === client.user.id) return;

  // Ignore reactions in the starboard channel itself
  if (reaction.message.channel.id === config.STARBOARD_CHANNEL_ID) return;

  // Check self-react setting
  if (!config.ALLOW_SELF_REACT && isSelfReact(reaction, user)) return;

  // Check bot messages setting
  if (!config.ALLOW_BOT_MESSAGES && reaction.message.author.bot) return;

  // Fetch partial if needed
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      logger.error("Error fetching reaction:", error);
      return;
    }
  }

  // Get all reactions on the message
  const allReactions = getAllReactions(reaction.message);

  // Check if any emoji has reached threshold
  const hasReachedThreshold = checkThreshold(allReactions);

  if (hasReachedThreshold) {
    // Get the emoji that triggered (the one with highest count above threshold)
    const { emoji: triggerEmoji, count: triggerCount } =
      getTriggerEmoji(allReactions);
    if (triggerEmoji) {
      await sendToStarboard(
        reaction.message,
        triggerEmoji,
        triggerCount,
        allReactions,
      );
    }
  } else if (config.REMOVE_ON_THRESHOLD_DROP) {
    // Check if message is in starboard and should be removed
    const existingEntry = await Starboard.findOne({
      originalMessageId: reaction.message.id,
    });
    if (existingEntry) {
      // Check if the trigger emoji dropped below threshold
      const triggerCount = getEmojiCount(
        reaction.message,
        existingEntry.triggerEmoji,
      );
      if (triggerCount < config.REACTION_THRESHOLD) {
        // Remove from starboard
        try {
          const starboardChannel = client.channels.cache.get(
            config.STARBOARD_CHANNEL_ID,
          );
          const starboardMessage = await starboardChannel.messages.fetch(
            existingEntry.starboardMessageId,
          );
          await starboardMessage.delete();
          await Starboard.deleteOne({ originalMessageId: reaction.message.id });
          logger.success(
            `Removed starboard message for ${reaction.message.id} (dropped below threshold)`,
          );
        } catch (error) {
          logger.error("Error removing starboard message:", error);
        }
      }
    }
  }
}

// Event: Bot ready
client.once("clientReady", async () => {
  logger.info(`Logged in as ${client.user.tag}`);
  logger.info(
    `Monitoring for ANY emoji with ${config.REACTION_THRESHOLD}+ reactions`,
  );
  logger.info(`Starboard channel: ${config.STARBOARD_CHANNEL_ID}`);

  await connectMongoDB();

  await client.application.commands.set(slashCommands);
  logger.success("Slash commands registered");

  autoCheckGames();
  setInterval(autoCheckGames, 30 * 60 * 1000);

  // Set bot status
  client.user.setPresence({
    activities: [
      {
        name: `${config.REACTION_THRESHOLD}+ on any emoji`,
        type: ActivityType.Watching,
      },
    ],
    status: "online",
  });
});

// Event: Reaction added
client.on("messageReactionAdd", async (reaction, user) => {
  await processReactionChange(reaction, user, true);
});

// Event: Reaction removed
client.on("messageReactionRemove", async (reaction, user) => {
  await processReactionChange(reaction, user, false);
});

// Event: Message deleted (clean up database)
client.on("messageDelete", async (message) => {
  if (!message.guild) return;

  const existingEntry = await Starboard.findOne({
    originalMessageId: message.id,
  });
  if (existingEntry) {
    try {
      const starboardChannel = client.channels.cache.get(
        config.STARBOARD_CHANNEL_ID,
      );
      if (starboardChannel) {
        const starboardMessage = await starboardChannel.messages.fetch(
          existingEntry.starboardMessageId,
        );
        await starboardMessage.delete();
      }
    } catch (error) {
      // Message might already be deleted
    }

    await Starboard.deleteOne({ originalMessageId: message.id });
    logger.success(`Removed starboard entry for deleted message ${message.id}`);
  }
});

// Command: Help
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.content.startsWith(config.PREFIX)) return;

  const args = message.content.slice(config.PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === "starboard" || command === "sb") {
    if (args[0] === "copy") {
      await copyChannelMessagesFromMessage(message, args.slice(1));
    } else if (args[0] === "meta") {
      await downloadMetaFromMessage(message, args.slice(1));
    } else if (args[0] === "stats") {
      const totalStarred = await Starboard.countDocuments({
        guildId: message.guild.id,
      });

      const embed = new EmbedBuilder()
        .setTitle("Starboard Statistics")
        .setColor(config.COLORS.INFO)
        .addFields(
          {
            name: "Threshold",
            value: `${config.REACTION_THRESHOLD}+ reactions on ANY emoji`,
            inline: false,
          },
          { name: "Messages Starred", value: `${totalStarred}`, inline: true },
          {
            name: "Starboard Channel",
            value: `<#${config.STARBOARD_CHANNEL_ID}>`,
            inline: true,
          },
          {
            name: "Features",
            value:
              "- Any emoji triggers\n- Auto-updates on more reactions\n- Images & GIFs supported\n- Clean, simple format",
            inline: false,
          },
        )
        .setTimestamp()
        .setFooter({
          text: `Requested by ${message.author.displayName}`,
          iconURL: message.author.avatarURL(),
        });

      await message.reply({ embeds: [embed] });
    } else if (args[0] === "help") {
      const embed = new EmbedBuilder()
        .setTitle("Starboard Bot Help")
        .setDescription(
          "This bot automatically posts messages to the starboard when **ANY single emoji** reaches 4 or more reactions.",
        )
        .setColor(config.COLORS.INFO)
        .addFields(
          {
            name: "How it works",
            value:
              "- When any emoji on a message gets 4+ reactions, it gets posted to the starboard\n- If reactions increase, the starboard message updates\n- Each message only appears once with the emoji that triggered it\n- **Images and GIFs are fully supported!**",
            inline: false,
          },
          {
            name: "Commands",
            value:
              "`!starboard stats` - View bot statistics\n`!starboard help` - Show this help message\n`!starboard copy #channel [limit]` - Copy messages from a channel into the channel where you run the command\n`!starboard meta <url>` - Download an Instagram or Facebook video",
            inline: false,
          },
          {
            name: "Settings",
            value: `- Threshold: **${config.REACTION_THRESHOLD}+** reactions\n- Starboard channel: <#${config.STARBOARD_CHANNEL_ID}>\n- Any emoji works`,
            inline: false,
          },
        )
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } else {
      const embed = new EmbedBuilder()
        .setDescription(
          "**Starboard Bot Commands:**\n`!starboard stats` - View statistics\n`!starboard help` - Show help\n`!starboard copy #channel [limit]` - Copy messages into the current channel\n`!starboard meta <url>` - Download an Instagram or Facebook video",
        )
        .setColor(config.COLORS.INFO);

      await message.reply({ embeds: [embed] });
    }
  }
});

async function createStatsEmbed(guild, user) {
  const totalStarred = await Starboard.countDocuments({
    guildId: guild.id,
  });

  return new EmbedBuilder()
    .setTitle("Starboard Statistics")
    .setColor(config.COLORS.INFO)
    .addFields(
      {
        name: "Threshold",
        value: `${config.REACTION_THRESHOLD}+ reactions on ANY emoji`,
        inline: false,
      },
      { name: "Messages Starred", value: `${totalStarred}`, inline: true },
      {
        name: "Starboard Channel",
        value: `<#${config.STARBOARD_CHANNEL_ID}>`,
        inline: true,
      },
      {
        name: "Features",
        value:
          "- Any emoji triggers\n- Auto-updates on more reactions\n- Images & GIFs supported\n- Clean, simple format",
        inline: false,
      },
    )
    .setTimestamp()
    .setFooter({
      text: `Requested by ${user.displayName}`,
      iconURL: user.avatarURL(),
    });
}

function createHelpEmbed() {
  return new EmbedBuilder()
    .setTitle("Starboard Bot Help")
    .setDescription(
      `This bot automatically posts messages to the starboard when **ANY single emoji** reaches ${config.REACTION_THRESHOLD} or more reactions.`,
    )
    .setColor(config.COLORS.INFO)
    .addFields(
      {
        name: "How it works",
        value:
          "- When any emoji on a message reaches the threshold, it gets posted to the starboard\n- If reactions increase, the starboard message updates\n- Each message only appears once with the emoji that triggered it\n- Images and GIFs are fully supported",
        inline: false,
      },
      {
        name: "Commands",
        value:
          "`!stats` or `/stats` - View bot statistics\n`!help` or `/help` - Show this help message\n`!copy #channel [limit]` or `/copy source:#channel limit:10` - Copy messages from a channel into the channel where you run the command\n`!meta <url>` or `/meta url:<url>` - Download an Instagram or Facebook video",
        inline: false,
      },
      {
        name: "Settings",
        value: `- Threshold: **${config.REACTION_THRESHOLD}+** reactions\n- Starboard channel: <#${config.STARBOARD_CHANNEL_ID}>\n- Any emoji works`,
        inline: false,
      },
    )
    .setTimestamp();
}

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.content.startsWith(config.PREFIX)) return;

  const args = message.content.slice(config.PREFIX.length).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  if (command === "copy") {
    await copyChannelMessagesFromMessage(message, args);
  } else if (command === "meta") {
    await downloadMetaFromMessage(message, args);
  } else if (command === "stats") {
    await message.reply({
      embeds: [await createStatsEmbed(message.guild, message.author)],
    });
  } else if (command === "help") {
    await message.reply({ embeds: [createHelpEmbed()] });
  } else if (command === "games") {
    const statusMsg = await message.reply({ content: "Fetching Epic Games free games..." });
    try {
      const result = await getEpicFreeGames();
      if (!result || result.freeGames.length === 0) {
        await statusMsg.edit({ content: "No free games available at the moment." });
        return;
      }
      const role = await ensureGamesRole(message.guild);
      const roleText = result.isDropped ? `${role}\n` : "";
      await statusMsg.edit({
        content: roleText,
        embeds: [buildEpicEmbed(result)],
        allowedMentions: { roles: role ? [role.id] : [] },
      });
    } catch (error) {
      logger.error("Error in !games command:", error);
      await statusMsg.edit({ content: "Something went wrong fetching Epic Games data." });
    }
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return;

  if (interaction.commandName === "copy") {
    await copyChannelMessagesFromInteraction(interaction);
  } else if (interaction.commandName === "meta") {
    await downloadMetaFromInteraction(interaction);
  } else if (interaction.commandName === "stats") {
    await interaction.reply({
      embeds: [await createStatsEmbed(interaction.guild, interaction.user)],
      ephemeral: true,
    });
  } else if (interaction.commandName === "help") {
    await interaction.reply({ embeds: [createHelpEmbed()], ephemeral: true });
  } else if (interaction.commandName === "games") {
    await interaction.deferReply();
    try {
      const result = await getEpicFreeGames();
      if (!result || result.freeGames.length === 0) {
        await interaction.editReply({ content: "No free games available at the moment." });
        return;
      }
      const role = await ensureGamesRole(interaction.guild);
      const roleText = result.isDropped ? `${role}\n` : "";
      await interaction.editReply({
        content: roleText,
        embeds: [buildEpicEmbed(result)],
        allowedMentions: { roles: role ? [role.id] : [] },
      });
    } catch (error) {
      logger.error("Error in /games command:", error);
      await interaction.editReply({ content: "Something went wrong fetching Epic Games data." });
    }
  }
});

async function getNewGameDrops(games) {
  const newGames = [];
  for (const game of games) {
    const exists = await FreeGame.findOne({ title: game.title, effectiveDate: game.effectiveDate });
    if (!exists) newGames.push(game);
  }
  return newGames;
}

async function saveAnnouncedGames(games) {
  for (const game of games) {
    await FreeGame.findOneAndUpdate(
      { title: game.title, effectiveDate: game.effectiveDate },
      { title: game.title, effectiveDate: game.effectiveDate, announcedAt: new Date() },
      { upsert: true },
    );
  }
}

async function autoCheckGames() {
  try {
    const result = await getEpicFreeGames();
    if (!result) return;
    const newDrops = await getNewGameDrops(result.freeGames);
    if (newDrops.length === 0) return;
    const channelId = config.GAMES_CHANNEL_ID;
    const channel = client.channels.cache.get(channelId);
    if (!channel) return;
    const guild = channel.guild;
    const role = await ensureGamesRole(guild);
    await saveAnnouncedGames(newDrops);
    await channel.send({
      content: `${role}`,
      embeds: [buildEpicEmbed(result)],
      allowedMentions: { roles: [role.id] },
    });
    logger.success(`Auto-announced ${newDrops.length} new free game(s)`);
  } catch (error) {
    logger.error("Auto-check games error:", error);
  }
}

function formatNepaliTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleString("en-US", {
    timeZone: "Asia/Katmandu",
    dateStyle: "long",
    timeStyle: "short",
    hourCycle: "h23",
  });
}

function buildEpicEmbed(result) {
  const { freeGames, onSaleGames } = result;
  const embed = new EmbedBuilder()
    .setTitle("Epic Games Store - Free Games")
    .setColor(config.COLORS.INFO)
    .setURL("https://store.epicgames.com/")
    .setTimestamp();

  freeGames.forEach((game) => {
    let value = "";
    if (game.isFree) {
      if (
        game.originalPrice &&
        game.originalPrice !== "N/A" &&
        game.originalPrice !== "0"
      ) {
        value += `~~${game.originalPrice}~~ **Free**\n`;
      } else {
        value += "**Free**\n";
      }
    }
    const effectiveDate = new Date(game.effectiveDate);
    const now = Date.now();
    if (effectiveDate > now) {
      value += `Drops: ${formatNepaliTime(game.effectiveDate)} (Nepali Time)\n`;
    } else {
      value += `Available since: ${formatNepaliTime(game.effectiveDate)}\n`;
    }
    if (game.slug) {
      value += `[View on Epic](https://store.epicgames.com/p/${game.slug})`;
    }
    embed.addFields({ name: game.title, value, inline: false });
  });

  if (freeGames[0]?.thumbnail) {
    embed.setThumbnail(freeGames[0].thumbnail);
  }

  embed.setFooter({
    text: `${freeGames.length} free game${freeGames.length > 1 ? "s" : ""} available`,
  });
  return embed;
}

async function ensureGamesRole(guild) {
  let role = guild.roles.cache.find((r) => r.name === "Games");
  if (!role) {
    role = await guild.roles.create({
      name: "Games",
      color: config.COLORS.INFO,
      mentionable: true,
      reason: "Role for free games notifications",
    });
  }
  return role;
}

// HTTP health check server for Render
const http = require("http");
const server = http.createServer(async (req, res) => {
  if (req.url === "/api/epic-games" && req.method === "GET") {
    try {
      const result = await getEpicFreeGames();
      if (!result) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to fetch Epic Games data" }));
        return;
      }
      if (result.isDropped) {
        const newDrops = await getNewGameDrops(result.freeGames);
        if (newDrops.length > 0) {
          const channel = client.channels.cache.get(config.GAMES_CHANNEL_ID);
          if (channel) {
            const guild = channel.guild;
            const role = await ensureGamesRole(guild);
            await saveAnnouncedGames(newDrops);
            await channel.send({
              content: `${role}`,
              embeds: [buildEpicEmbed(result)],
              allowedMentions: { roles: [role.id] },
            });
          }
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      status: "online",
      bot: client.user?.tag || "connecting",
      guilds: client.guilds?.cache?.size || 0,
    }),
  );
});
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  logger.info(`Health check server running on port ${PORT}`);
});

// Handle errors
client.on("error", (error) => {
  logger.error("Discord client error:", error);
});

process.on("unhandledRejection", (error) => {
  logger.error("Unhandled promise rejection:", error);
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down...");
  client.destroy();
  server.close();
  process.exit(0);
});

// Login to Discord
const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  logger.error("Please set your Discord bot token in the .env file");
  process.exit(1);
}

client.login(TOKEN);
