const express = require("express");
const {
  joinClassroom,
  leaveClassroom,
  getClassroom,
  syncAttendance,
  getGoogleAuthUrl,
  googleOAuthCallback
} = require("../controllers/googleMeetController");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

router.post("/classroom/join", verifyToken, joinClassroom);
router.post("/classroom/leave", verifyToken, leaveClassroom);
router.get("/classroom/:sessionId", verifyToken, getClassroom);
router.post("/classroom/:sessionId/sync-attendance", verifyToken, syncAttendance);

// Google OAuth routes
router.get("/google/auth", getGoogleAuthUrl);
router.get("/google/callback", googleOAuthCallback);

module.exports = router;
