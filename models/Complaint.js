const mongoose = require("mongoose")

const complaintSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
    },
    subject: String,
    description: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["open", "in-progress", "resolved"],
      default: "open",
    },
    attachmentUrl: String,
    response: String,
    respondedAt: Date,
  },
  { timestamps: true },
)

module.exports = mongoose.model("Complaint", complaintSchema)
