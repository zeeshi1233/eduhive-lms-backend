const jwt = require("jsonwebtoken")

// authId = Auth document ka _id
// role = 'admin' | 'teacher' | 'student'
// profileId = Teacher/Student/Admin document ka _id
exports.generateToken = (authId, role, profileId) => {
  return jwt.sign(
    { id: authId, role, profileId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || "7d" }
  )
}
