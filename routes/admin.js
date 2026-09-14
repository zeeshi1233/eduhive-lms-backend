const express = require("express")
const {
  getDashboardStats,
  getTeachers,
  updateTeacher,
  deleteTeacher,
  getStudents,
  updateStudent,
  deleteStudent,
  createCourse,
  getCourses,
  updateCourse,
  deleteCourse,
  assignTeacherToCourse,
  getTransactions,
  getPayroll,
  processTeacherPayment,
  adminLogin,
  getRevenueSummary,
  getRevenueDetails,
  getTeacherPayrollById,
  getSessionsByTeacherForPayroll,
  payTeacherSalaryBySession,
  createSession,
  getAllSessions,
  enrollStudentInCourse,
  updateEnrollmentStatus,
  getCourseById,
  updateSession,
} = require("../controllers/adminController")
const { verifyToken, authorize } = require("../middleware/auth")
const {
  validateCourseInput,
  validateTeacherUpdateInput,
  handleValidationErrors,
  validateLoginInput,
} = require("../middleware/validation")
const { upload } = require("../utils/cloudinary")

const router = express.Router()

// --------------------
// Admin Login (public)
// --------------------
router.post("/login", validateLoginInput, handleValidationErrors, adminLogin)

// Protect all admin routes below
router.use(verifyToken, authorize("admin"))

// --------------------
// Dashboard
// --------------------
router.get("/dashboard", getDashboardStats)

// --------------------
// Teachers
// --------------------
router.get("/teachers", getTeachers)
router.put(
  "/teachers/:id",
  upload.single("profileImage"),
  validateTeacherUpdateInput,
  handleValidationErrors,
  updateTeacher
)
router.delete("/teachers/:id", deleteTeacher)

// --------------------
// Students
// --------------------
router.get("/students", getStudents)
router.put("/students/:id", updateStudent)
router.delete("/students/:id", deleteStudent)

// --------------------
// Courses
// --------------------
router.post("/courses", upload.single("courseImage"), validateCourseInput, handleValidationErrors, createCourse)
router.get("/courses", getCourses)
router.get("/courses/:id", getCourseById)
router.put("/courses/:id", upload.single("courseImage"), updateCourse)
router.delete("/courses/:id", deleteCourse)
router.post("/courses/assign-teacher", assignTeacherToCourse)

// --------------------
// Enrollments (StudentCourse)
// --------------------
router.post("/enrollments", enrollStudentInCourse)
router.put("/enrollments/:enrollmentId", updateEnrollmentStatus)

// --------------------
// Transactions
// --------------------
router.get("/transactions", getTransactions)
router.get("/revenue", getRevenueSummary)
router.get("/revenue-details", getRevenueDetails)
router.get("/teacher-payrol/:teacherId", getTeacherPayrollById)

// --------------------
// Payroll
// --------------------
router.get("/payroll", getPayroll)
router.post("/payroll/process", processTeacherPayment)

// --------------------
// Sessions
// --------------------
router.get("/teachers/:teacherId/sessions", getSessionsByTeacherForPayroll)
router.post("/teachers/pay-salary", payTeacherSalaryBySession)
router.post("/sessions", createSession)
router.get("/sessions", getAllSessions)
router.put("/sessions/:id", updateSession)
router.patch("/sessions/:id", updateSession)

module.exports = router
