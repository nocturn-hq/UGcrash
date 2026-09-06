const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    reference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0, // absolute value (sign derived from type)
    },
    type: {
      type: String,
      required: true,
      enum: ["deposit", "withdrawal", "bet", "win", "refund"],
    },
    status: {
      type: String,
      default: "pending",
      enum: ["pending", "success", "failed", "refunded"],
    },
    roundId: {
      type: Number, // ✅ matches RoundEngine.roundId (integer)
      default: null,
    },
  },
  { timestamps: true }
);

// Indexes for performance
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ reference: 1 }, { unique: true }); // already unique, but explicit

module.exports = mongoose.model("Transaction", transactionSchema);