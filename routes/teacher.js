const express = require("express");
const {
  getAssignedCourses,
  createAssignment,
  getAssignments,
  gradeSubmission,
  markTeacherAttendance,
  getTeacherStudentsProgress,
  getAssignmentById,
  getAllSessions,
  getTeacherSessionTransactions,
  deleteAssignment,
  updateAssignment,
  getTeacherDashboardStats,
} = require("../controllers/teacherController");
const { verifyToken, authorize } = require("../middleware/auth");


const {
  validateAssignmentInput,
  handleValidationErrors,
} = require("../middleware/validation");

const { upload } = require("../utils/cloudinary");

const router = express.Router();

// Protect all teacher routes
router.use(verifyToken, authorize("teacher"));

// Courses
router.get("/courses", getAssignedCourses);

// Assignments
router.post(
  "/assignments",
  upload.single("attachment"),
  validateAssignmentInput,
  handleValidationErrors,
  createAssignment,
);
router.get("/assignments", getAssignments);
router.get("/assignments/:courseId", getAssignmentById);
router.put("/assignments/grade", gradeSubmission);
router.put(
  "/assignments/:assignmentId",
  upload.single("attachment"),
  updateAssignment,
);

router.delete("/assignments/:assignmentId", deleteAssignment);

// get std Progress
router.get("/get-students-progress", getTeacherStudentsProgress);

// Transactions
router.get("/session-transactions", getTeacherSessionTransactions);

router.get("/dashboard-stats", getTeacherDashboardStats);

router.get("/sessions", getAllSessions);
router.post("/teacher-attendance", markTeacherAttendance);
module.exports = router;
