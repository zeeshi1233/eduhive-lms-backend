const express = require("express");
const {
  getEnrolledCourses,
  enrollCourse,
  getCourseDetails,
  submitAssignment,
  getAttendanceReport,
  submitComplaint,
  getPaymentHistory,
  getCompletedCourses,
  getProgressReport,
  getStudentDashboardStats,
  getStudentSessions,
  markStudentAttendance,
  getStudentAssignments,
} = require("../controllers/studentController");
const { verifyToken, authorize } = require("../middleware/auth");
const { upload } = require("../utils/cloudinary");

const router = express.Router();

// Protect all student routes
router.use(verifyToken, authorize("student"));

// Courses
router.get("/courses", getEnrolledCourses);
router.post("/courses/enroll", enrollCourse);
router.get("/courses/:courseId", getCourseDetails);

// Assignments
router.post(
  "/assignments/submit",
  upload.single("submission"),
  submitAssignment,
);

// Attendance
router.get("/assignments", getStudentAssignments);
router.get("/attendance/:courseId", getAttendanceReport);

// Complaints
router.post("/complaints", upload.single("attachment"), submitComplaint);

// Payments
router.get("/payments", getPaymentHistory);

// Completed Courses
router.get("/completed-courses", getCompletedCourses);

// Progress
router.get("/progress/:courseId", getProgressReport);

router.get("/dashboard-stats", getStudentDashboardStats);
// routes/sessionRoutes.js
router.get("/students-sessions", getStudentSessions);
router.post("/student-attendance", markStudentAttendance);

module.exports = router;
