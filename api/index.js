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

// Dynamic CORS & Preflight Middleware
app.use((req, res, next) => {
  const origin = req.headers.origin

  if (origin) {
    if (
      allowedOrigins.includes(origin) ||
      origin.endsWith(".vercel.app") ||
      process.env.NODE_ENV !== "production"
    ) {
      res.setHeader("Access-Control-Allow-Origin", origin)
    } else {
      res.setHeader("Access-Control-Allow-Origin", origin)
    }
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
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, Access-Control-Allow-Origin"
  )

  // Respond immediately to preflight OPTIONS requests
  if (req.method === "OPTIONS") {
    return res.status(200).end()
  }

  next()
})

const corsOptions = {
  origin: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Accept",
    "Authorization"
  ],
  credentials: true,
  optionsSuccessStatus: 200,
}

app.use(cors(corsOptions))
app.use(express.json({ limit: "50mb" }))
app.use(express.urlencoded({ extended: true }))

// 🔥 Connect DB BEFORE routes (serverless-safe)
let isDbConnected = false

const init = async () => {
  if (!isDbConnected) {
    await connectDB()
    isDbConnected = true
    console.log("MongoDB connected ✅")
  }
}

app.use(async (req, res, next) => {
  try {
    await init()
    next()
  } catch (err) {
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

app.listen(PORT, () => {
  console.log(`🚀 Local server running on http://localhost:${PORT}`)
})



module.exports = app
