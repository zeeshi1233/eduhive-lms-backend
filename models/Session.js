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
    lastHeartbeat: {
      type: Date,
    },
  },
  { _id: true }
);

const sessionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
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

    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
    },

    startTime: {
      type: Date,
      required: true,
    },

    endTime: {
      type: Date,
    },

    duration: {
      type: String,
      enum: ["45 mins", "60 mins", "90 mins", "120 mins"],
      default: "60 mins",
    },

    type: {
      type: String,
      enum: ["Regular Class", "Extra Class"],
      default: "Regular Class",
    },

    topic: {
      type: String,
      default: "",
    },

    description: {
      type: String,
      default: "",
    },

    meetingLink: {
      type: String,
      default: "",
    },

    link: {
      type: String,
      default: "",
    },

    roomName: {
      type: String,
      default: "",
    },
    
    googleMeetSpace: {
      type: String,
      default: "",
    },

    googleCalendarEventId: {
      type: String,
      default: "",
    },

    googleMeetLink: {
      type: String,
      default: "",
    },

    status: {
      type: String,
      enum: [
        "Scheduled",
        "pending",
        "ongoing",
        "conducted",
        "not_conducted",
        "Cancelled",
        "completed",
      ],
      default: "Scheduled",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    notConductedReason: {
      type: String,
      enum: ["Teacher Not Present", "Student Not Present", "Others"],
      default: undefined,
    },

    teacherAttendance: {
      checkInTime: Date,
      checkOutTime: Date,
      lastHeartbeat: Date,
      durationMinutes: {
        type: Number,
        default: 0,
      },
      durationFormatted: {
        type: String,
        default: "",
      },
      intervals: [attendanceIntervalSchema],
    },

    studentAttendance: [
      {
        student: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Student",
          required: true,
        },
        present: {
          type: Boolean,
          default: false,
        },
        joinedAt: Date,
        leftAt: Date,
        lastHeartbeat: Date,
        durationMinutes: {
          type: Number,
          default: 0,
        },
        durationFormatted: {
          type: String,
          default: "",
        },
        intervals: [attendanceIntervalSchema],
        markedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    perClassFee: {
      type: Number,
      default: 0,
    },

    isPaid: {
      type: Boolean,
      default: false,
    },
    paidAt: Date,
  },
  { timestamps: true }
);

sessionSchema.pre("validate", function () {
  if (!this.duration) this.duration = "60 mins";
  if (!this.type) this.type = "Regular Class";
  if (!this.status) this.status = "Scheduled";
  if (!this.teacher && this.instructor) this.teacher = this.instructor;
  if (!this.instructor && this.teacher) this.instructor = this.teacher;
  if (!this.link && this.meetingLink) this.link = this.meetingLink;
  if (!this.meetingLink && this.link) this.meetingLink = this.link;

  if (this.startTime) {
    const minutes = parseInt(this.duration, 10) || 60;
    if (!this.endTime) {
      this.endTime = new Date(this.startTime.getTime() + minutes * 60 * 1000);
    }
  }

  if (this.endTime && Date.now() > this.endTime.getTime()) {
    if (this.status !== "ongoing") {
      this.isActive = false;
    }
  }
});

sessionSchema.methods.isExpired = function () {
  const end = this.endTime
    ? new Date(this.endTime).getTime()
    : this.startTime
    ? new Date(this.startTime).getTime() + (parseInt(this.duration, 10) || 60) * 60000
    : null;
  if (!end) return false;
  return Date.now() > end;
};

sessionSchema.index({ course: 1, startTime: 1 });
sessionSchema.index({ instructor: 1, startTime: 1 });
sessionSchema.index({ teacher: 1, startTime: 1 });
sessionSchema.index({ course: 1, teacher: 1 });
sessionSchema.index({ status: 1, startTime: 1 });

module.exports = mongoose.model("Session", sessionSchema);
