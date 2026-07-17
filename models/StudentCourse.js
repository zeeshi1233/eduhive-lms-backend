const mongoose = require("mongoose")

const StudentCourseSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },

    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },

    status: {
      type: String,
      enum: ["active", "completed", "dropped"],
      default: "active",
    },

    enrolledAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
)

// Compound unique index — ek student ek course me sirf ek baar enroll ho sakta hai
StudentCourseSchema.index({ courseId: 1, studentId: 1 }, { unique: true })

// Fast lookup indexes
StudentCourseSchema.index({ studentId: 1 })
StudentCourseSchema.index({ courseId: 1 })

module.exports = mongoose.model("StudentCourse", StudentCourseSchema)
