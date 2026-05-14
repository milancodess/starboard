const mongoose = require("mongoose");

const freeGameSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  effectiveDate: {
    type: String,
    required: true,
  },
  announcedAt: {
    type: Date,
    default: Date.now,
  },
});

freeGameSchema.index({ title: 1, effectiveDate: 1 }, { unique: true });

module.exports = mongoose.model("FreeGame", freeGameSchema);
