const express = require("express")
const { register, getCurrentUser, loginTeacher, loginStudent } = require("../controllers/authController")
const {
  getGoogleAuthUrl,
  googleOAuthCallback,
  teacherGoogleAuthUrl,
  disconnectTeacherGoogle,
} = require("../controllers/googleMeetController")
const { verifyToken } = require("../middleware/auth")
const { validateLoginInput, validateRegisterInput, handleValidationErrors } = require("../middleware/validation")
const { upload } = require("../utils/cloudinary")

const router = express.Router()

// ADMIN creates Teacher / Student
router.post(
  "/register",
  verifyToken,
  upload.single("profileImage"),
  validateRegisterInput,
  handleValidationErrors,
  register
)


// Teacher / Student login
router.post("/teacher-login", validateLoginInput, handleValidationErrors, loginTeacher)
router.post("/student-login", validateLoginInput, handleValidationErrors, loginStudent)

// Current logged-in user
router.get("/me", verifyToken, getCurrentUser)

// Google OAuth aliases (also available under /api/google/* and /api/teacher/google/*)
router.get("/google", getGoogleAuthUrl)
router.get("/google/callback", googleOAuthCallback)
router.get("/google/teacher", verifyToken, teacherGoogleAuthUrl)
router.post("/google/disconnect", verifyToken, disconnectTeacherGoogle)

module.exports = router
