require("dotenv").config()
const mongoose = require("mongoose")
const Admin = require("../models/Admin")
const Auth = require("../models/Auth")

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI)
    console.log("MongoDB Connected")
  } catch (error) {
    console.error("DB Error:", error.message)
    process.exit(1)
  }
}

// test


const seedAdmin = async () => {
  try {
    await connectDB()

    const ADMIN_EMAIL = "admin@gmail.com"

    // Check if admin Auth record already exists
    const existingAuth = await Auth.findOne({ email: ADMIN_EMAIL, role: "admin" })

    if (existingAuth) {
      console.log("⚠️ Admin already exists")
      process.exit(0)
    }

    // Create Admin profile
    const admin = await Admin.create({
      name: "Admin",
    })

    // Create Auth record
    await Auth.create({
      email: ADMIN_EMAIL,
      password: "Admin@123",
      role: "admin",
      refId: admin._id,
      refModel: "Admin",
    })

    console.log("✅ Admin created successfully")
    console.log("Email: admin@gmail.com")
    console.log("Password: Admin@123")

    process.exit(0)
  } catch (error) {
    console.error("❌ Seeding error:", error)
    process.exit(1)
  }
}

seedAdmin()
