const jwt = require("jsonwebtoken")

// Verify JWT token
exports.verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1]

  if (!token) {
    return res.status(401).json({ message: "No token provided" })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // id = Auth document _id
    // profileId = Teacher/Student/Admin profile _id
    req.user = {
      id: decoded.id,
      role: decoded.role,
      profileId: decoded.profileId,
    }

    next()
  } catch (error) {
    return res.status(401).json({ message: "Invalid token" })
  }
}

// Check user role
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Access denied. Insufficient permissions." })
    }
    next()
  }
}
