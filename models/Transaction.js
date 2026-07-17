const mongoose = require("mongoose")

const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
    },
    amount: {
      type: Number,
      required: true,
    },
    type: {
      type: String,
      enum: ["payment", "refund", "payroll"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
    },
    paymentMethod: String,
    transactionId: String,
    description: String,
  },
  { timestamps: true },
)

module.exports = mongoose.model("Transaction", transactionSchema)
