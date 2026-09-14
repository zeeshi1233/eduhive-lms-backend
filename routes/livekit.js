const express = require("express")
const {
  getRoomToken,
  joinClassroom,
  leaveClassroom,
  getClassroom,
} = require("../controllers/livekitController")
const { verifyToken } = require("../middleware/auth")

const router = express.Router()

router.post("/get-room-token", verifyToken, getRoomToken)
router.post("/classroom/join", verifyToken, joinClassroom)
router.post("/classroom/leave", verifyToken, leaveClassroom)
router.get("/classroom/:sessionId", verifyToken, getClassroom)

module.exports = router
