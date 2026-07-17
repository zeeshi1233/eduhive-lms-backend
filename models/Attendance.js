const mongoose = require("mongoose")

const attendanceSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
    },
    present: {
      type: Boolean,
      default: false,
    },
    markedAt: Date,
  },
  { timestamps: true },
)

module.exports = mongoose.model("Attendance", attendanceSchema)
