/**
 * walletStore.js - Database-driven wallet service
 * Uses Mongoose atomic updates to ensure race-condition-free balance changes
 */
const User = require("../models/User");
const Transaction = require("../models/Transaction");

module.exports = {
  /**
   * Get current balance for a user
   * @param {string} userId - MongoDB ObjectId of the user
   * @returns {Promise<number>} - Current balance or 0 if user not found
   */
  async getBalance(userId) {
    try {
      const user = await User.findById(userId).select('balance');
      return user ? user.balance : 0;
    } catch (err) {
      console.error("GetBalance DB error:", err.message);
      return 0; // Fallback to 0 on DB error (safe default)
    }
  },

  /**
   * Deduct funds from a user's balance (atomic, race-condition-free)
   * @param {string} userId - MongoDB ObjectId
   * @param {number} amount - Positive number to deduct
   * @param {string} reference - Unique transaction reference (for logging)
   * @param {string} roundId - Optional round ID for bet transactions
   * @returns {Promise<{success: boolean, newBalance?: number, message?: string}>}
   */
  async deduct(userId, amount, reference, roundId = null) {
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return { success: false, message: "Invalid deduction amount" };
    }

    try {
      // 🔥 Atomic update: only deduct if balance >= amount
      const user = await User.findOneAndUpdate(
        { _id: userId, balance: { $gte: numAmount } },
        { $inc: { balance: -numAmount } },
        { new: true, runValidators: true }
      );

      if (!user) {
        // Check if user exists to differentiate "not found" vs "insufficient"
        const exists = await User.findById(userId);
        if (!exists) return { success: false, message: "User not found" };
        return { success: false, message: "Insufficient funds" };
      }

      // Log the transaction in the database
      await Transaction.create({
        reference,
        userId,
        amount: numAmount,
        type: 'bet', // or 'withdrawal'
        status: 'success',
        roundId
      });

      return { success: true, newBalance: user.balance };
    } catch (err) {
      console.error("Deduct DB error:", err.message);
      return { success: false, message: "Database error during deduction" };
    }
  },

  /**
   * Add funds to a user's balance (atomic)
   * @param {string} userId - MongoDB ObjectId
   * @param {number} amount - Positive number to add
   * @param {string} reference - Unique transaction reference
   * @param {string} type - 'deposit' or 'win'
   * @param {string} roundId - Optional round ID for win transactions
   * @returns {Promise<{success: boolean, newBalance?: number, message?: string}>}
   */
  async add(userId, amount, reference, type = 'deposit', roundId = null) {
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return { success: false, message: "Invalid addition amount" };
    }

    try {
      const user = await User.findByIdAndUpdate(
        userId,
        { $inc: { balance: numAmount } },
        { new: true, runValidators: true }
      );

      if (!user) {
        return { success: false, message: "User not found" };
      }

      // Log the transaction
      await Transaction.create({
        reference,
        userId,
        amount: numAmount,
        type,
        status: 'success',
        roundId
      });

      return { success: true, newBalance: user.balance };
    } catch (err) {
      console.error("Add DB error:", err.message);
      return { success: false, message: "Database error during addition" };
    }
  }
};