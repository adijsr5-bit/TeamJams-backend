const mongoose = require('mongoose');

const EventSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  date: { type: Date, required: true },
  location: { type: String, required: true },
  organizer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  organizerName: { type: String },
  volunteersRequired: { type: Number, required: true },
  volunteersJoined: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  attendedVolunteers: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    hours: { type: Number, default: 0 }
  }],
  imageUrl: { type: String },
  status: { type: String, enum: ['upcoming', 'ongoing', 'completed'], default: 'upcoming' }
}, { timestamps: true });

module.exports = mongoose.model('Event', EventSchema);
