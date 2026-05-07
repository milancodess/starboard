const mongoose = require("mongoose");

const starboardSchema = new mongoose.Schema({
  // Original message ID
  originalMessageId: {
    type: String,
    required: true,
    unique: true,
  },
  // Starboard message ID
  starboardMessageId: {
    type: String,
    required: true,
  },
  // Channel ID where original message was sent
  originalChannelId: {
    type: String,
    required: true,
  },
  // Guild ID
  guildId: {
    type: String,
    required: true,
  },
  // The emoji that triggered the starboard
  triggerEmoji: {
    type: String,
    required: true,
  },
  // Current count for that specific emoji
  reactionCount: {
    type: Number,
    default: 0,
  },
  // All reactions on the message (for display)
  allReactions: {
    type: Map,
    of: Number,
    default: {},
  },
  // Author of the original message
  authorId: {
    type: String,
    required: true,
  },
  authorName: {
    type: String,
    required: true,
  },
  authorAvatar: {
    type: String,
    default: null,
  },
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update the updatedAt timestamp on save
starboardSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("Starboard", starboardSchema);
