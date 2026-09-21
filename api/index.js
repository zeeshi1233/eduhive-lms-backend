const express = require("express")
const dotenv = require("dotenv")

dotenv.config()

const connectDB = require("../config/db")

const authRoutes = require("../routes/auth")
const adminRoutes = require("../routes/admin")
const teacherRoutes = require("../routes/teacher")
const studentRoutes = require("../routes/student")
const meetingRoutes = require("../routes/meeting")
const webhookRoutes = require("../routes/webhook")
const { verifyToken } = require("../middleware/auth")
const { listSessionsForCurrentUser } = require("../controllers/adminController")

const errorHandler = require("../middleware/errorHandler")

const app = express()

// ===================================================
// CORS - Must be the VERY FIRST middleware
// ===================================================
app.use((req, res, next) => {
  const origin = req.headers.origin || "*"

  res.setHeader("Access-Control-Allow-Origin", origin)
  res.setHeader("Access-Control-Allow-Credentials", "true")
  res.setHeader("Vary", "Origin")
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  )
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, Origin"
  )
  // Prevent browser from caching preflight responses
  // This stops "cache poisoning" where a failed preflight blocks all future requests
  res.setHeader("Access-Control-Max-Age", "0")

  // Respond immediately to preflight OPTIONS - before any other middleware
  if (req.method === "OPTIONS") {
    res.statusCode = 200
    res.end()
    return
  }

  next()
})

app.use(express.json({ limit: "50mb" }))
app.use(express.urlencoded({ extended: true }))

// ===================================================
// DB Connection - serverless safe
// ===================================================
let isDbConnected = false

const init = async () => {
  if (!isDbConnected) {
    await connectDB()
    isDbConnected = true
  }
}

app.use(async (req, res, next) => {
  try {
    await init()
    next()
  } catch (err) {
    console.error("DB Connection Error:", err)
    next(err)
  }
})

// ===================================================
// Routes
// ===================================================
app.use("/api/auth", authRoutes)
app.use("/api/admin", adminRoutes)
app.use("/api/teacher", teacherRoutes)
app.use("/api/student", studentRoutes)
app.use("/api", meetingRoutes)
app.use("/api/webhooks", webhookRoutes)
app.get("/api/sessions", verifyToken, listSessionsForCurrentUser)

// Health check
app.get("/api/health", (req, res) => {
  res.status(200).json({ message: "Server running dYs?" })
})

// Error handler
app.use(errorHandler)

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" })
})

// Local dev only
const PORT = process.env.PORT || 5000

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`dYs? Local server running on http://localhost:${PORT}`)
  })
}

module.exports = app
