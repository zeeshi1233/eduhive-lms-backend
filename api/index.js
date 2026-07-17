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

const corsOptions = {
  origin: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 200,
}

// Middleware
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

// 404
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" })
})

const PORT = process.env.PORT || 5000

app.listen(PORT, () => {
  console.log(`🚀 Local server running on http://localhost:${PORT}`)
})

// Error handler
app.use(errorHandler)



module.exports = app
