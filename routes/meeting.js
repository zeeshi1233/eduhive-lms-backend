const express = require("express");
const {
  joinClassroom,
  joinSessionRedirect,
  leaveClassroom,
  sessionHeartbeat,
  getTrackedSessionLink,
  getClassroom,
  syncAttendance,
  getGoogleAuthUrl,
  googleOAuthCallback,
  teacherGoogleAuthUrl,
  teacherGoogleConnect,
} = require("../controllers/googleMeetController");
const { exportSessionsExcel } = require("../controllers/adminController");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

// Export sessions to Excel (.xlsx) — must precede :sessionId
router.get("/sessions/export", verifyToken, exportSessionsExcel);

// Session join/leave/heartbeat endpoints
router.post("/sessions/:sessionId/join", verifyToken, joinClassroom);
router.get("/sessions/:sessionId/join", joinSessionRedirect);
router.get("/sessions/join/:sessionId", joinSessionRedirect);
router.post("/sessions/:sessionId/leave", verifyToken, leaveClassroom);
router.post("/sessions/:sessionId/heartbeat", verifyToken, sessionHeartbeat);
router.get("/sessions/:sessionId/tracked-link", verifyToken, getTrackedSessionLink);

// Legacy/Classroom aliases
router.post("/classroom/join", verifyToken, joinClassroom);
router.post("/classroom/leave", verifyToken, leaveClassroom);
router.post("/classroom/:sessionId/heartbeat", verifyToken, sessionHeartbeat);
router.get("/classroom/:sessionId", verifyToken, getClassroom);
router.post("/classroom/:sessionId/sync-attendance", verifyToken, syncAttendance);

// Google OAuth routes (Admin)
router.get("/google/auth", getGoogleAuthUrl);
router.get("/google/callback", googleOAuthCallback);

// Google OAuth routes (Teacher — become Host)
router.get("/teacher/google/auth", verifyToken, teacherGoogleAuthUrl);
router.get("/teacher/google/callback", teacherGoogleConnect);

module.exports = router;