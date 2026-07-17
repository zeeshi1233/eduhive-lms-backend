const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },

    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },

    instructor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      required: true,
    },

    // 📅 Date & Time
    startTime: {
      type: Date,
      required: true,
    },

    endTime: {
      type: Date,
      required: true,
    },

    topic: String,

    meetingLink: {
      type: String,
      required: true,
    },

    // 📌 SESSION STATUS
    status: {
      type: String,
      enum: ["pending", "ongoing", "conducted"],
      default: "pending",
    },

    // 👨‍🏫 Teacher Attendance
    teacherAttendance: {
      checkInTime: Date,
      checkOutTime: Date,
    },

    // 👨‍🎓 Student Attendance
    studentAttendance: [
      {
        student: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Student",
          required: true,
        },
        present: Boolean,
        markedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    isPaid: {
      type: Boolean,
      default: false,
    },
    paidAt: Date,
  },
  { timestamps: true },
);

module.exports = mongoose.model("Session", sessionSchema);
