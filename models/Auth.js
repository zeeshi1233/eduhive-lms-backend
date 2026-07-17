const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")

const AuthSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
      select: false,
    },

    role: {
      type: String,
      enum: ["admin", "teacher", "student"],
      required: true,
    },

    // Reference to the actual profile document
    refId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "refModel",
    },

    refModel: {
      type: String,
      required: true,
      enum: ["Admin", "Teacher", "Student"],
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
)

// 🔐 Hash password before saving
AuthSchema.pre("save", async function () {
  if (!this.isModified("password")) return
  this.password = await bcrypt.hash(this.password, 10)
})

// 🔑 Compare entered password with hashed
AuthSchema.methods.comparePassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password)
}

module.exports = mongoose.model("Auth", AuthSchema)
