const mongoose = require("mongoose")

const assignmentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    description: String,
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    dueDate: Date,
    maxMarks: {
      type: Number,
      default: 100,
    },
    attachmentUrl: String,
    submissions: [
      {
        student: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Student",
        },
        submissionUrl: String,
        marksObtained: Number,
        submittedAt: Date,
        feedback: String,
      },
    ],
  },
  { timestamps: true },
)

module.exports = mongoose.model("Assignment", assignmentSchema)
