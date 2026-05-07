const mongoose = require("mongoose");

const starboardSchema = new mongoose.Schema({
  originalMessageId: {
    type: String,
    required: true,
    unique: true,
  },
  starboardMessageId: {
    type: String,
    required: true,
  },
  originalChannelId: {
    type: String,
    required: true,
  },
  guildId: {
    type: String,
    required: true,
  },
  triggerEmoji: {
    type: String,
    required: true,
  },
  reactionCount: {
    type: Number,
    default: 0,
  },
  allReactions: {
    type: Map,
    of: Number,
    default: {},
  },
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
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

starboardSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("Starboard", starboardSchema);
