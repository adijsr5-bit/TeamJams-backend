const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const Razorpay = require('razorpay');
const crypto = require('crypto');

// Load env vars
dotenv.config({ override: true });

const app = express();
app.use(cors());
app.use(express.json());
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Models
const User = require('./models/User');
const Event = require('./models/Event');
const Report = require('./models/Report');
const Donation = require('./models/Donation');
const Campaign = require('./models/Campaign');
const { protect, admin } = require('./middleware/auth');

// Setup Uploads Directory
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Upload Route
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const imageUrl = `http://localhost:5000/uploads/${req.file.filename}`;
  res.json({ imageUrl });
});


console.log("Using MONGO_URI:", process.env.MONGO_URI);

// Connect DB
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/teamjams')
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.log('MongoDB Connection Error:', err));

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'dummy_key_id',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'dummy_key_secret',
});

// ================= ROUTES ================= //

// --- Auth Routes ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role, phoneNumber } = req.body;
    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ message: 'User already exists' });
    
    const user = await User.create({ name, email, password, role: role || 'user', phoneNumber });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'fallback_secret', { expiresIn: '30d' });
    res.status(201).json({ _id: user._id, name: user.name, email: user.email, role: user.role, token });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (user && (await user.matchPassword(password))) {
      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'fallback_secret', { expiresIn: '30d' });
      res.json({ _id: user._id, name: user.name, email: user.email, role: user.role, token });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Event Routes ---
app.get('/api/events', async (req, res) => {
  try {
    const events = await Event.find({})
      .populate('organizer', 'name')
      .populate('volunteersJoined', 'name email avatarUrl')
      .populate('attendedVolunteers.user', 'name');
    res.json(events);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/events', protect, admin, async (req, res) => {
  try {
    const event = new Event({
      title: req.body.title,
      description: req.body.description,
      date: req.body.date,
      location: req.body.location,
      organizer: req.user._id,
      organizerName: req.user.name,
      volunteersRequired: req.body.volunteersRequired,
      imageUrl: req.body.imageUrl
    });
    const createdEvent = await event.save();
    res.status(201).json(createdEvent);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/events/:id/join', protect, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });
    
    if (event.volunteersJoined.includes(req.user._id)) {
      return res.status(400).json({ message: 'Already joined' });
    }
    
    event.volunteersJoined.push(req.user._id);
    await event.save();
    
    // Update user stats
    req.user.events.push(event._id);
    await req.user.save();
    
    res.json({ message: 'Joined successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/events/:id/attendance', protect, admin, async (req, res) => {
  try {
    const { userId, hours } = req.body;
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });
    
    // Check if already credited
    const alreadyCredited = event.attendedVolunteers.find(v => v.user.toString() === userId);
    if (alreadyCredited) {
      return res.status(400).json({ message: 'User already credited for this event' });
    }
    
    // Update event
    event.attendedVolunteers.push({ user: userId, hours: Number(hours) });
    await event.save();
    
    // Update user
    const volunteer = await User.findById(userId);
    if (volunteer) {
      volunteer.hoursContributed += Number(hours);
      volunteer.drivesJoined += 1;
      await volunteer.save();
    }
    
    res.json({ message: 'Attendance credited successfully', event });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete('/api/events/:id', protect, admin, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });
    
    await event.deleteOne();
    res.json({ message: 'Event removed' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Report Routes ---
app.post('/api/reports', protect, async (req, res) => {
  try {
    const { locationDetails, description, imageUrl } = req.body;
    const report = await Report.create({
      reporter: req.user._id,
      locationDetails,
      description,
      imageUrl
    });
    res.status(201).json(report);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/reports', protect, admin, async (req, res) => {
  try {
    const reports = await Report.find({}).populate('reporter', 'name');
    res.json(reports);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/reports/:id', protect, admin, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ message: 'Report not found' });
    
    report.status = req.body.status || report.status;
    const updatedReport = await report.save();
    res.json(updatedReport);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Campaign Routes ---
app.get('/api/campaigns/active', async (req, res) => {
  try {
    let campaign = await Campaign.findOne({ isActive: true });
    if (!campaign) {
      campaign = await Campaign.create({});
    }
    
    const donations = await Donation.find({ status: 'successful' });
    const raised = donations.reduce((sum, d) => sum + d.amount, 0);
    
    // Calculate unique donors based on donor ID or donorName fallback
    const uniqueDonors = new Set(donations.map(d => d.donor ? d.donor.toString() : d.donorName)).size;
    
    res.json({
      _id: campaign._id,
      title: campaign.title,
      goal: campaign.goal,
      spent: campaign.spent,
      raised: raised,
      donorsCount: uniqueDonors || donations.length
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/campaigns/:id', protect, admin, async (req, res) => {
  try {
    const campaign = await Campaign.findByIdAndUpdate(
      req.params.id, 
      { title: req.body.title, goal: req.body.goal, spent: req.body.spent },
      { new: true }
    );
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Donation Routes (Razorpay Integration) ---
app.post('/api/donations/order', protect, async (req, res) => {
  try {
    const { amount } = req.body;
    
    const options = {
      amount: amount * 100, // Razorpay works in minimum currency unit (paise)
      currency: "INR",
      receipt: "receipt_order_" + Date.now(),
    };
    
    const order = await razorpay.orders.create(options);
    if (!order) return res.status(500).json({ message: "Error creating order" });
    
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/donations/verify', protect, async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, amount } = req.body;
    
    const sign = razorpayOrderId + "|" + razorpayPaymentId;
    const expectedSign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || 'dummy_key_secret')
      .update(sign.toString())
      .digest("hex");

    if (razorpaySignature === expectedSign || process.env.RAZORPAY_KEY_SECRET === undefined) {
      // Create donation record
      const donation = await Donation.create({
        donor: req.user._id,
        donorName: req.user.name,
        amount: amount,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
        status: 'successful'
      });
      res.status(201).json({ message: "Payment verified successfully", donation });
    } else {
      res.status(400).json({ message: "Invalid signature sent!" });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Profile Routes ---
app.get('/api/users/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('events');
    if (user) {
      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        hoursContributed: user.hoursContributed,
        drivesJoined: user.drivesJoined,
        events: user.events,
        avatarUrl: user.avatarUrl
      });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/users/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    user.name = req.body.name || user.name;
    if (req.body.avatarUrl) {
      user.avatarUrl = req.body.avatarUrl;
    }
    
    if (req.body.password) {
      user.password = req.body.password;
    }
    
    const updatedUser = await user.save();
    res.json({
      _id: updatedUser._id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
      avatarUrl: updatedUser.avatarUrl
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/users/leaderboard', async (req, res) => {
  try {
    const topUsers = await User.find({ role: { $ne: 'admin' } })
      .sort({ hoursContributed: -1, drivesJoined: -1 })
      .limit(10)
      .select('name hoursContributed drivesJoined avatarUrl');
      
    // Add default avatars and badges for presentation since we don't store them yet
    const formattedUsers = topUsers.map((u, idx) => {
      let badge = "Community Member";
      if (idx === 0) badge = "City Guardian";
      else if (idx === 1) badge = "Eco Warrior";
      else if (idx === 2) badge = "Green Hero";
      
      return {
        _id: u._id,
        name: u.name,
        hours: u.hoursContributed,
        drives: u.drivesJoined,
        badge,
        img: u.avatarUrl || `https://i.pravatar.cc/150?img=${(idx * 4 + 11) % 70}` // deterministic random avatar
      };
    });
    
    res.json(formattedUsers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
