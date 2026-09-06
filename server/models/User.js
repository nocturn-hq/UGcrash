const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({
  phone: { 
    type: String, 
    required: true, 
    unique: true, 
    trim: true,
    validate: {
      // Allows both local (0710421283) and international (+254710421283) formats
      validator: (v) => /^(\+?[1-9]\d{1,14}|0\d{9})$/.test(v),
      message: "Invalid phone number format"
    }
  },
  password: { 
    type: String, 
    required: true,
    minlength: [6, "Password must be at least 6 characters"]
  },
  name: { type: String, trim: true, default: "Player" },
  balance: { type: Number, default: 0, min: 0 }
}, { timestamps: true });

// 🔒 Hash password before saving
userSchema.pre("save", async function(next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// 🔑 Method to compare login password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// 📈 Index for fast lookup (unique is already an index, but explicit never hurts)
userSchema.index({ phone: 1 });

module.exports = mongoose.model("User", userSchema);