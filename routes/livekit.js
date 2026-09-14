const express = require("express")
const { getRoomToken } = require("../controllers/livekitController")
const { verifyToken } = require("../middleware/auth")

const router = express.Router()

router.post("/get-room-token", verifyToken, getRoomToken)

module.exports = router
