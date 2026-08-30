const express = require("express")
const cors = require("cors")
const dotenv = require("dotenv")

dotenv.config()

const connectDB = require("../config/db")

const authRoutes = require("../routes/auth")
const adminRoutes = require("../routes/admin")
const teacherRoutes = require("../routes/teacher")
const studentRoutes = require("../routes/student")

const errorHandler = require("../middleware/errorHandler")

const app = express()

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5000",
  "https://eduhive-lms.vercel.app",
  "https://eduhive-lms-backend.vercel.app",
]

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith(".vercel.app")) {
      callback(null, true)
    } else {
      callback(null, true)
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "X-CSRF-Token",
    "X-Requested-With",
    "Accept",
    "Accept-Version",
    "Content-Length",
    "Content-MD5",
    "Content-Type",
    "Date",
    "X-Api-Version",
    "Authorization",
    "Origin"
  ],
  optionsSuccessStatus: 200,
}

// 1. Dynamic CORS middleware
app.use(cors(corsOptions))

// 2. Explicit OPTIONS preflight handling for all routes
app.options("*", cors(corsOptions))

// Fallback headers middleware for extra safety
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin)
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*")
  }
  res.setHeader("Access-Control-Allow-Credentials", "true")
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  )
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, Origin"
  )

  if (req.method === "OPTIONS") {
    return res.status(200).end()
  }

  next()
})

app.use(express.json({ limit: "50mb" }))
app.use(express.urlencoded({ extended: true }))

// Connect DB (serverless safe)
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

// Routes
app.use("/api/auth", authRoutes)
app.use("/api/admin", adminRoutes)
app.use("/api/teacher", teacherRoutes)
app.use("/api/student", studentRoutes)

// Health check
app.get("/api/health", (req, res) => {
  res.status(200).json({ message: "Server running 🚀" })
})

// Error handler (must be placed before 404 handler)
app.use(errorHandler)

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" })
})

const PORT = process.env.PORT || 5000

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`🚀 Local server running on http://localhost:${PORT}`)
  })
}

module.exports = app
