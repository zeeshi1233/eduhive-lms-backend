const mongoose = require("mongoose");

const attendanceIntervalSchema = new mongoose.Schema(
  {
    checkInTime: {
      type: Date,
      required: true,
    },
    checkOutTime: {
      type: Date,
    },
    durationMinutes: {
      type: Number,
      default: 0,
    },
  },
  { _id: true }
);

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
    intervals: [attendanceIntervalSchema],
    durationMinutes: {
      type: Number,
      default: 0,
    },
    durationFormatted: {
      type: String,
      default: "",
    },
    markedAt: Date,
  },
  { timestamps: true }
);

attendanceSchema.index({ student: 1, session: 1 });
attendanceSchema.index({ course: 1, student: 1 });

module.exports = mongoose.model("Attendance", attendanceSchema);
