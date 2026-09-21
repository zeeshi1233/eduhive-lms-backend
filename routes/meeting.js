const express = require("express");
const {
  joinClassroom,
  leaveClassroom,
  getClassroom,
  syncAttendance,
  getGoogleAuthUrl,
  googleOAuthCallback,
  teacherGoogleAuthUrl,
  teacherGoogleConnect,
} = require("../controllers/googleMeetController");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

router.post("/classroom/join", verifyToken, joinClassroom);
router.post("/classroom/leave", verifyToken, leaveClassroom);
router.get("/classroom/:sessionId", verifyToken, getClassroom);
router.post("/classroom/:sessionId/sync-attendance", verifyToken, syncAttendance);

// Google OAuth routes (Admin)
router.get("/google/auth", getGoogleAuthUrl);
router.get("/google/callback", googleOAuthCallback);

// Google OAuth routes (Teacher — become Host)
router.get("/teacher/google/auth", verifyToken, teacherGoogleAuthUrl);
router.get("/teacher/google/callback", teacherGoogleConnect);

module.exports = router;
