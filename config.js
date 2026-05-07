module.exports = {
  // Starboard settings
  STARBOARD_CHANNEL_ID: "1501917633111523399",
  REACTION_THRESHOLD: 4, // Individual emoji must reach 4

  // Bot settings
  PREFIX: "!",

  // MongoDB settings
  MONGODB_URI: process.env.MONGODB_URI,
  // Features
  ALLOW_BOT_MESSAGES: false, // Whether to allow bot messages to be starred
  ALLOW_SELF_REACT: false, // Whether users can react to their own messages
  REMOVE_ON_THRESHOLD_DROP: false, // Whether to remove from starboard if reactions drop below threshold

  // Embed colors
  COLORS: {
    STARBOARD: 0xffd700, // Gold color for starboard
    ERROR: 0xff0000, // Red
    SUCCESS: 0x00ff00, // Green
    INFO: 0x0099ff, // Blue
  },
};
