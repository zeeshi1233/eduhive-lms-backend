const mongoose = require("mongoose")

const TeacherSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    gender: { type: String, enum: ["male", "female", "other"] },
    address: String,

    qualification: { type: String, required: true },
    specialization: { type: String, default: "" },

    experienceYears: { type: Number, default: 0 },

    assignedCourses: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Course",
        },
      ],
      default: [],
    },

    boards: {
      type: [String],
      default: [],
    },

    level: {
      type: String,
      enum: ["O Level", "A Level"],
      default: "O Level",
    },

    oLevelHourPay: { type: Number, default: 0 },
    availability: String,
    profileImage: String,
    joiningDate: { type: Date, required: true },

    isActive: { type: Boolean, default: true },
    
    // Google Workspace OAuth — stored so teacher becomes the Host
    googleRefreshToken: { type: String, default: "" },
    googleEmail: { type: String, default: "" },
    googleConnected: { type: Boolean, default: false },
  },
  { timestamps: true }
)

module.exports = mongoose.model("Teacher", TeacherSchema)
