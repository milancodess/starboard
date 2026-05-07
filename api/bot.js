require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActivityType,
  Collection,
} = require("discord.js");
const mongoose = require("mongoose");
const Starboard = require("../models/Starboard");
const config = require("../config");

let client = null;
let isReady = false;

const cooldowns = new Collection();

async function connectMongoDB() {
  try {
    await mongoose.connect(config.MONGODB_URI);
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    throw error;
  }
}

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
        attachment.contentType &&
        (attachment.contentType.startsWith("image/") ||
          attachment.contentType.startsWith("video/"))
      ) {
        if (!content) {
          content = content || "*Image/GIF attached*";
        }
      } else {
        content += `\n📎 ${attachment.name}`;
      }
    }
  }
  if (message.embeds.length > 0) {
    for (const embed of message.embeds) {
      if (embed.image || embed.thumbnail || embed.video) {
        if (!content) {
          content = content || "*Embedded media attached*";
        }
      }
    }
  }
  if (message.stickers.size > 0) {
    content += `\n🖼️ **Sticker**: ${message.stickers.first().name || "Sticker"}`;
  }
  return content || "*No text content*";
}

function getImageUrl(message) {
  for (const attachment of message.attachments.values()) {
    if (attachment.contentType && attachment.contentType.startsWith("image/")) {
      return attachment.url;
    }
  }
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

function isGif(message) {
  for (const attachment of message.attachments.values()) {
    if (attachment.contentType === "image/gif") {
      return true;
    }
  }
  return false;
}

function createStarboardEmbed(message, triggerEmoji, triggerCount, allReactions) {
  let content = getMessageContent(message);
  if (content.length > 2000) {
    content = content.substring(0, 1997) + "...";
  }
  const embed = new EmbedBuilder()
    .setDescription(content)
    .setColor(config.COLORS.STARBOARD)
    .setTimestamp(message.createdAt)
    .setAuthor({
      name: message.author.displayName,
      iconURL: message.author.avatarURL() || message.author.defaultAvatarURL,
    })
    .setFooter({
      text: `⭐ Starred Message | Message ID: ${message.id}`,
      iconURL: client.user.avatarURL(),
    });
  const imageUrl = getImageUrl(message);
  if (imageUrl) {
    embed.setImage(imageUrl);
  }
  embed.addFields({
    name: `${triggerEmoji} Reactions`,
    value: `${triggerCount} reactions`,
    inline: false,
  });
  embed.addFields({
    name: "",
    value: `[Jump to Message](${message.url})`,
    inline: false,
  });
  return embed;
}

function checkThreshold(reactions) {
  for (const count of Object.values(reactions)) {
    if (count >= config.REACTION_THRESHOLD) {
      return true;
    }
  }
  return false;
}

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

async function sendToStarboard(message, triggerEmoji, triggerCount, allReactions) {
  const starboardChannel = client.channels.cache.get(config.STARBOARD_CHANNEL_ID);
  if (!starboardChannel) {
    console.error(`Starboard channel ${config.STARBOARD_CHANNEL_ID} not found!`);
    return false;
  }
  const existingEntry = await Starboard.findOne({ originalMessageId: message.id });
  if (existingEntry) {
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
      const starboardMessage = await starboardChannel.messages.fetch(existingEntry.starboardMessageId);
      const embed = createStarboardEmbed(message, existingEntry.triggerEmoji, existingEntry.reactionCount, allReactions);
      await starboardMessage.edit({ embeds: [embed] });
      console.log(`Updated starboard message for ${message.id} (${triggerEmoji}: ${triggerCount} reactions)`);
      return true;
    } catch (error) {
      if (error.code === 10008) {
        console.log(`Starboard message not found, removing from database and resending`);
        await Starboard.deleteOne({ originalMessageId: message.id });
        return await sendToStarboard(message, triggerEmoji, triggerCount, allReactions);
      } else {
        console.error(`Error updating starboard:`, error);
        return false;
      }
    }
  } else {
    try {
      const embed = createStarboardEmbed(message, triggerEmoji, triggerCount, allReactions);
      const starboardMessage = await starboardChannel.send({ embeds: [embed] });
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
      console.log(`Sent new starboard message for ${message.id} (${triggerEmoji}: ${triggerCount} reactions)`);
      return true;
    } catch (error) {
      console.error(`Error sending to starboard:`, error);
      return false;
    }
  }
}

async function processReactionChange(reaction, user, isAdd) {
  if (user.id === client.user.id) return;
  if (reaction.message.channel.id === config.STARBOARD_CHANNEL_ID) return;
  if (!config.ALLOW_SELF_REACT && isSelfReact(reaction, user)) return;
  if (!config.ALLOW_BOT_MESSAGES && reaction.message.author.bot) return;
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error("Error fetching reaction:", error);
      return;
    }
  }
  const allReactions = getAllReactions(reaction.message);
  const hasReachedThreshold = checkThreshold(allReactions);
  if (hasReachedThreshold) {
    const { emoji: triggerEmoji, count: triggerCount } = getTriggerEmoji(allReactions);
    if (triggerEmoji) {
      await sendToStarboard(reaction.message, triggerEmoji, triggerCount, allReactions);
    }
  } else if (config.REMOVE_ON_THRESHOLD_DROP) {
    const existingEntry = await Starboard.findOne({ originalMessageId: reaction.message.id });
    if (existingEntry) {
      const triggerCount = getEmojiCount(reaction.message, existingEntry.triggerEmoji);
      if (triggerCount < config.REACTION_THRESHOLD) {
        try {
          const starboardChannel = client.channels.cache.get(config.STARBOARD_CHANNEL_ID);
          const starboardMessage = await starboardChannel.messages.fetch(existingEntry.starboardMessageId);
          await starboardMessage.delete();
          await Starboard.deleteOne({ originalMessageId: reaction.message.id });
          console.log(`Removed starboard message for ${reaction.message.id} (dropped below threshold)`);
        } catch (error) {
          console.error(`Error removing starboard message:`, error);
        }
      }
    }
  }
}

async function startBot() {
  if (client) return;

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
  });

  client.once("ready", async () => {
    console.log(`Logged in as ${client.user.tag}`);
    console.log(`Monitoring for ANY emoji with ${config.REACTION_THRESHOLD}+ reactions`);
    console.log(`Starboard channel: ${config.STARBOARD_CHANNEL_ID}`);
    await connectMongoDB();
    client.user.setPresence({
      activities: [{ name: `${config.REACTION_THRESHOLD}+ on any emoji`, type: ActivityType.Watching }],
      status: "online",
    });
    isReady = true;
  });

  client.on("messageReactionAdd", async (reaction, user) => {
    await processReactionChange(reaction, user, true);
  });

  client.on("messageReactionRemove", async (reaction, user) => {
    await processReactionChange(reaction, user, false);
  });

  client.on("messageDelete", async (message) => {
    if (!message.guild) return;
    const existingEntry = await Starboard.findOne({ originalMessageId: message.id });
    if (existingEntry) {
      try {
        const starboardChannel = client.channels.cache.get(config.STARBOARD_CHANNEL_ID);
        if (starboardChannel) {
          const starboardMessage = await starboardChannel.messages.fetch(existingEntry.starboardMessageId);
          await starboardMessage.delete();
        }
      } catch (error) {}
      await Starboard.deleteOne({ originalMessageId: message.id });
      console.log(`Removed starboard entry for deleted message ${message.id}`);
    }
  });

  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(config.PREFIX)) return;
    const args = message.content.slice(config.PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    if (command === "starboard" || command === "sb") {
      if (args[0] === "stats") {
        const totalStarred = await Starboard.countDocuments({ guildId: message.guild.id });
        const embed = new EmbedBuilder()
          .setTitle("⭐ Starboard Statistics")
          .setColor(config.COLORS.INFO)
          .addFields(
            { name: "Threshold", value: `${config.REACTION_THRESHOLD}+ reactions on ANY emoji`, inline: false },
            { name: "Messages Starred", value: `${totalStarred}`, inline: true },
            { name: "Starboard Channel", value: `<#${config.STARBOARD_CHANNEL_ID}>`, inline: true },
            { name: "Features", value: "• Any emoji triggers\n• Auto-updates on more reactions\n• Images & GIFs supported\n• Clean, simple format", inline: false },
          )
          .setTimestamp()
          .setFooter({ text: `Requested by ${message.author.displayName}`, iconURL: message.author.avatarURL() });
        await message.reply({ embeds: [embed] });
      } else if (args[0] === "help") {
        const embed = new EmbedBuilder()
          .setTitle("⭐ Starboard Bot Help")
          .setDescription("This bot automatically posts messages to the starboard when **ANY single emoji** reaches 4 or more reactions.")
          .setColor(config.COLORS.INFO)
          .addFields(
            { name: "How it works", value: "• When any emoji on a message gets 4+ reactions, it gets posted to the starboard\n• If reactions increase, the starboard message updates\n• Each message only appears once (with the emoji that triggered it)\n• **Images and GIFs are fully supported!**", inline: false },
            { name: "Commands", value: "`!starboard stats` - View bot statistics\n`!starboard help` - Show this help message", inline: false },
            { name: "Settings", value: `• Threshold: **${config.REACTION_THRESHOLD}+** reactions\n• Starboard channel: <#${config.STARBOARD_CHANNEL_ID}>\n• Any emoji works: 😂 ❤️ 👍 🎉 etc.`, inline: false },
          )
          .setTimestamp();
        await message.reply({ embeds: [embed] });
      } else {
        const embed = new EmbedBuilder()
          .setDescription("⭐ **Starboard Bot Commands:**\n`!starboard stats` - View statistics\n`!starboard help` - Show help")
          .setColor(config.COLORS.INFO);
        await message.reply({ embeds: [embed] });
      }
    }
  });

  client.on("error", (error) => {
    console.error("Discord client error:", error);
  });

  const TOKEN = process.env.DISCORD_TOKEN;
  if (!TOKEN) {
    throw new Error("DISCORD_TOKEN not set");
  }

  await client.login(TOKEN);
}

module.exports = async (req, res) => {
  if (!client) {
    try {
      await startBot();
    } catch (error) {
      console.error("Failed to start bot:", error);
      return res.status(500).json({ status: "error", message: error.message });
    }
  }

  res.json({
    status: isReady ? "online" : "connecting",
    bot: client.user ? client.user.tag : null,
    uptime: client.uptime || null,
    guilds: client.guilds?.cache?.size || 0,
  });
};
