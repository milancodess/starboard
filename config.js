module.exports = {
  STARBOARD_CHANNEL_ID:
    process.env.STARBOARD_CHANNEL_ID || "1501917633111523399",
  REACTION_THRESHOLD: parseInt(process.env.REACTION_THRESHOLD, 10) || 4,
  PREFIX: process.env.PREFIX || "!",
  MONGODB_URI: process.env.MONGODB_URI,
  GAMES_CHANNEL_ID: process.env.GAMES_CHANNEL_ID || "1504374287245512734",
  ALLOW_BOT_MESSAGES: process.env.ALLOW_BOT_MESSAGES === "true",
  ALLOW_SELF_REACT: process.env.ALLOW_SELF_REACT === "true",
  REMOVE_ON_THRESHOLD_DROP: process.env.REMOVE_ON_THRESHOLD_DROP === "true",
  COLORS: {
    STARBOARD: parseInt(process.env.COLOR_STARBOARD, 16) || 0xffd700,
    ERROR: parseInt(process.env.COLOR_ERROR, 16) || 0xff0000,
    SUCCESS: parseInt(process.env.COLOR_SUCCESS, 16) || 0x00ff00,
    INFO: parseInt(process.env.COLOR_INFO, 16) || 0x0099ff,
  },
};
