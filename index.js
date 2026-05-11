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
} = require("discord.js");
const mongoose = require("mongoose");
const Starboard = require("./models/Starboard");
const config = require("./config");

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

// MongoDB Connection
async function connectMongoDB() {
  try {
    await mongoose.connect(config.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ MongoDB connected successfully");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
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
        content += `\n📎 ${attachment.name}`;
      }
    }
  }

  if (message.stickers.size > 0) {
    content += `\n🖼️ **Sticker**: ${message.stickers.first().name || "Sticker"}`;
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

function userCanCopyMessages(message) {
  return message.member.permissions.has(PermissionFlagsBits.ManageGuild);
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

async function copyChannelMessages(commandMessage, args) {
  if (!userCanCopyMessages(commandMessage)) {
    await commandMessage.reply({
      content: "You need the **Manage Server** permission to copy channels.",
      allowedMentions: { parse: [] },
    });
    return;
  }

  const sourceChannel = resolveChannelArgument(commandMessage, args[1]);
  const destinationChannel = commandMessage.channel;

  if (!sourceChannel || !sourceChannel.isTextBased()) {
    await commandMessage.reply({
      content:
        "Please choose a text channel to copy from. Example: `!starboard copy #source-channel`",
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (sourceChannel.id === destinationChannel.id) {
    await commandMessage.reply({
      content:
        "Choose a different destination channel, then run the command there.",
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (!botCanCopyMessages(sourceChannel, destinationChannel)) {
    await commandMessage.reply({
      content:
        "I need permission to view/read the source channel and send messages with attachments in this channel.",
      allowedMentions: { parse: [] },
    });
    return;
  }

  const requestedLimit = args[2] ? parseInt(args[2], 10) : null;
  if (args[2] && (!Number.isInteger(requestedLimit) || requestedLimit < 1)) {
    await commandMessage.reply({
      content: "The optional limit must be a positive number.",
      allowedMentions: { parse: [] },
    });
    return;
  }

  const statusMessage = await commandMessage.reply({
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
        await statusMessage.edit(
          `Copying messages from ${sourceChannel}... ${copiedCount}/${messages.length} copied.`,
        );
      }

      await sleep(750);
    }

    await statusMessage.edit(
      `Done copying from ${sourceChannel}. Copied ${copiedCount} message(s), skipped ${skippedCount}.`,
    );
  } catch (error) {
    console.error("Error copying channel messages:", error);
    await statusMessage.edit(
      "Something went wrong while copying messages. Check my channel permissions and try again.",
    );
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
    console.error(
      `❌ Starboard channel ${config.STARBOARD_CHANNEL_ID} not found!`,
    );
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

      console.log(
        `✅ Updated starboard message for ${message.id} (${triggerEmoji}: ${triggerCount} reactions)`,
      );
      return true;
    } catch (error) {
      if (error.code === 10008) {
        // Unknown Message
        console.log(
          `⚠️ Starboard message not found, removing from database and resending`,
        );
        await Starboard.deleteOne({ originalMessageId: message.id });
        return await sendToStarboard(
          message,
          triggerEmoji,
          triggerCount,
          allReactions,
        );
      } else {
        console.error(`Error updating starboard:`, error);
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

      console.log(
        `✨ Sent new starboard message for ${message.id} (${triggerEmoji}: ${triggerCount} reactions)`,
      );
      return true;
    } catch (error) {
      console.error(`Error sending to starboard:`, error);
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
      console.error("Error fetching reaction:", error);
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
          console.log(
            `🗑️ Removed starboard message for ${reaction.message.id} (dropped below threshold)`,
          );
        } catch (error) {
          console.error(`Error removing starboard message:`, error);
        }
      }
    }
  }
}

// Event: Bot ready
client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log(
    `📊 Monitoring for ANY emoji with ${config.REACTION_THRESHOLD}+ reactions`,
  );
  console.log(`⭐ Starboard channel: ${config.STARBOARD_CHANNEL_ID}`);

  await connectMongoDB();

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
    console.log(`🗑️ Removed starboard entry for deleted message ${message.id}`);
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
      await copyChannelMessages(message, args);
    } else if (args[0] === "stats") {
      const totalStarred = await Starboard.countDocuments({
        guildId: message.guild.id,
      });

      const embed = new EmbedBuilder()
        .setTitle("⭐ Starboard Statistics")
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
            value: `• Any emoji triggers\n• Auto-updates on more reactions\n• Images & GIFs supported\n• Clean, simple format`,
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
        .setTitle("⭐ Starboard Bot Help")
        .setDescription(
          "This bot automatically posts messages to the starboard when **ANY single emoji** reaches 4 or more reactions.",
        )
        .setColor(config.COLORS.INFO)
        .addFields(
          {
            name: "📋 How it works",
            value:
              "• When any emoji on a message gets 4+ reactions, it gets posted to the starboard\n• If reactions increase, the starboard message updates\n• Each message only appears once (with the emoji that triggered it)\n• **Images and GIFs are fully supported!**",
            inline: false,
          },
          {
            name: "🎮 Commands",
            value:
              "`!starboard stats` - View bot statistics\n`!starboard help` - Show this help message\n`!starboard copy #channel [limit]` - Copy messages from a channel into the channel where you run the command",
            inline: false,
          },
          {
            name: "⚙️ Settings",
            value: `• Threshold: **${config.REACTION_THRESHOLD}+** reactions\n• Starboard channel: <#${config.STARBOARD_CHANNEL_ID}>\n• Any emoji works: 😂 ❤️ 👍 🎉 etc.`,
            inline: false,
          },
        )
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } else {
      const embed = new EmbedBuilder()
        .setDescription(
          "⭐ **Starboard Bot Commands:**\n`!starboard stats` - View statistics\n`!starboard help` - Show help\n`!starboard copy #channel [limit]` - Copy messages into the current channel",
        )
        .setColor(config.COLORS.INFO);

      await message.reply({ embeds: [embed] });
    }
  }
});

// HTTP health check server for Render
const http = require("http");
const server = http.createServer((req, res) => {
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
  console.log(`🌐 Health check server running on port ${PORT}`);
});

// Handle errors
client.on("error", (error) => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down...");
  client.destroy();
  server.close();
  process.exit(0);
});

// Login to Discord
const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error("❌ Please set your Discord bot token in the .env file");
  process.exit(1);
}

client.login(TOKEN);
