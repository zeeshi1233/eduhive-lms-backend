const mongoose = require("mongoose")

const courseSchema = new mongoose.Schema(
  {
    serialNumber: {
      type: String,
      required: true,
      unique: true,
    },
    code: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
    },
    description: String,
    feePKR: {
      type: Number,
      default: 0,
    },
    feeUSD: {
      type: Number,
      default: 0,
    },
    perHourFee: {
      type: Number,
      default: 0,
    },
    board: String,
    otherBoard: String,
    duration: Number, // in hours
    price: {
      type: Number,
      default: 0,
    },
    courseImage: String,

    // students[] aur sessions[] ab yahan nahi hain
    // Students -> StudentCourse model me
    // Sessions -> Session model me (course ref ke saath query hoti hai)

    instructor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      default: null,
    },
    assignments: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Assignment",
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    totalRevenue: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
)

const withCourseCode = (_doc, ret) => {
  ret.code = ret.code || ret.serialNumber || ""
  ret.courseCode = ret.code
  return ret
}

courseSchema.set("toJSON", { virtuals: true, transform: withCourseCode })
courseSchema.set("toObject", { virtuals: true, transform: withCourseCode })
courseSchema.index({ title: 1, board: 1 })

module.exports = mongoose.model("Course", courseSchema)
