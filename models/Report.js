const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  locationDetails: { type: String, required: true },
  description: { type: String },
  imageUrl: { type: String, required: true },
  status: { type: String, enum: ['pending', 'approved', 'resolved'], default: 'pending' },
  eventCreated: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' }
}, { timestamps: true });

module.exports = mongoose.model('Report', ReportSchema);
