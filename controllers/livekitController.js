const { AccessToken } = require("livekit-server-sdk")
const mongoose = require("mongoose")
const Session = require("../models/Session")
const StudentCourse = require("../models/StudentCourse")

function sanitizeRoomName(name) {
  return String(name || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64)
}

function buildRoomName(sessionId, roomName) {
  if (sessionId && mongoose.Types.ObjectId.isValid(sessionId)) {
    return `eduhive-class-${sessionId}`
  }
  return sanitizeRoomName(roomName) || "eduhive-classroom"
}

async function assertSessionAccess(user, sessionId) {
  if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) return true

  const session = await Session.findById(sessionId).select("course instructor")
  if (!session) {
    const error = new Error("Scheduled class not found")
    error.statusCode = 404
    throw error
  }

  if (user.role === "admin") return true

  if (user.role === "teacher") {
    if (String(session.instructor) !== String(user.profileId)) {
      const error = new Error("You are not assigned to this class")
      error.statusCode = 403
      throw error
    }
    return true
  }

  if (user.role === "student") {
    const enrolled = await StudentCourse.findOne({
      studentId: user.profileId,
      courseId: session.course,
      status: { $ne: "dropped" },
    })
    if (!enrolled) {
      const error = new Error("You are not enrolled in this class")
      error.statusCode = 403
      throw error
    }
    return true
  }

  const error = new Error("Access denied")
  error.statusCode = 403
  throw error
}

exports.getRoomToken = async (req, res) => {
  try {
    const apiKey = process.env.LIVEKIT_API_KEY
    const apiSecret = process.env.LIVEKIT_API_SECRET
    const livekitUrl = process.env.LIVEKIT_URL

    if (!apiKey || !apiSecret || !livekitUrl) {
      return res.status(500).json({
        message:
          "LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.",
      })
    }

    const { roomName, participantName, sessionId } = req.body || {}
    const resolvedRoom = buildRoomName(sessionId, roomName)

    if (!resolvedRoom) {
      return res.status(400).json({
        message: "roomName or sessionId is required",
      })
    }

    await assertSessionAccess(req.user, sessionId)

    const displayName =
      participantName ||
      req.user.name ||
      `${req.user.role || "user"}-${String(req.user.profileId || req.user.id).slice(-6)}`

    const identity = `${req.user.role || "user"}-${req.user.profileId || req.user.id}`
    const canPublish = true

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name: displayName,
      ttl: "6h",
      metadata: JSON.stringify({
        role: req.user.role,
        profileId: req.user.profileId,
      }),
    })

    at.addGrant({
      roomJoin: true,
      room: resolvedRoom,
      canPublish,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: true,
    })

    const token = await at.toJwt()

    res.status(200).json({
      token,
      roomName: resolvedRoom,
      participantName: displayName,
      identity,
      url: livekitUrl,
      livekitUrl,
    })
  } catch (error) {
    const status = error.statusCode || 500
    res.status(status).json({
      message: error.message || "Failed to generate LiveKit token",
    })
  }
}
