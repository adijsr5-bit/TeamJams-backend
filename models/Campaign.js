const mongoose = require('mongoose');

const CampaignSchema = new mongoose.Schema({
  title: { type: String, default: 'Dimna Lake Restoration Fund' },
  goal: { type: Number, default: 50000 },
  spent: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Campaign', CampaignSchema);
