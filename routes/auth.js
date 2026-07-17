const express = require("express")
const { register, getCurrentUser, loginTeacher, loginStudent } = require("../controllers/authController")
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

module.exports = router
