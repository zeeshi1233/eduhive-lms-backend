const mongoose = require("mongoose")

const StudentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
    },

    gender: {
      type: String,
      enum: ["male", "female", "other"],
    },

    dateOfBirth: {
      type: Date,
      required: true,
    },

    address: {
      type: String,
      required: true,
    },

    guardianName: {
      type: String,
      required: true,
    },

    guardianPhone: {
      type: String,
      required: true,
    },

    batchTiming: {
      type: String,
      default: "Mon-Fri | 7-9 PM",
    },

    feePlan: {
      type: String,
      enum: ["monthly", "quarterly", "yearly"],
      required: true,
    },

    totalFees: {
      type: Number,
      required: true,
    },

    feePaid: {
      type: Number,
      default: 0,
    },

    profileImage: String,

    admissionDate: {
      type: Date,
      required: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    assignedTeachers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Teacher",
      },
    ],
  },
  { timestamps: true }
)

StudentSchema.index({ assignedTeachers: 1 })

module.exports = mongoose.model("Student", StudentSchema)
