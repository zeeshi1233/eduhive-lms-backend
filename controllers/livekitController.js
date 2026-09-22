const { AccessToken } = require("livekit-server-sdk")
const mongoose = require("mongoose")
const StudentCourse = require("../models/StudentCourse")
const Student = require("../models/Student")
const { fetchFormattedSessionById } = require("../utils/sessionHelpers")
const {
  classroomPath,
  getParticipantName,
  loadSessionForClassroom,
  teacherCheckIn,
  teacherCheckOut,
  markStudentPresent,
  markStudentLeft,
  isClassLive,
} = require("../utils/classroom")

async function assertSessionAccess(user, session) {
  if (user.role === "admin") return true

  if (user.role === "teacher") {
    if (String(session.instructor) !== String(user.profileId)) {
      const error = new Error("You are not assigned to this class")
      error.statusCode = 403
      error.code = "NOT_ASSIGNED"
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
      error.code = "NOT_ENROLLED"
      throw error
    }
    return true
  }

  const error = new Error("Access denied")
  error.statusCode = 403
  throw error
}

async function issueClassroomToken(req, res) {
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

    const { participantName, sessionId } = req.body || {}
    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: "Valid sessionId is required" })
    }

    const session = await loadSessionForClassroom(sessionId)
    await assertSessionAccess(req.user, session)

    if (session.status === "Cancelled") {
      return res.status(400).json({
        message: "This class was cancelled",
        code: "CLASS_CANCELLED",
      })
    }

    if (req.user.role === "teacher") {
      await teacherCheckIn(session)
    } else if (req.user.role === "student") {
      if (!isClassLive(session)) {
        const waiting = !session.teacherAttendance?.checkInTime
        return res.status(403).json({
          message: waiting
            ? "Waiting for instructor to start the class"
            : "This class has already ended",
          code: waiting ? "WAITING_FOR_TEACHER" : "CLASS_ENDED",
          teacherCheckedIn: Boolean(session.teacherAttendance?.checkInTime),
          teacherCheckedOut: Boolean(session.teacherAttendance?.checkOutTime),
        })
      }
      await markStudentPresent(session, req.user.profileId)
    } else if (session.teacherAttendance?.checkOutTime) {
      return res.status(400).json({
        message: "This class has already ended",
        code: "CLASS_ENDED",
      })
    }

    const displayName = await getParticipantName(req.user, participantName)
    const identity = `${req.user.role || "user"}-${req.user.profileId || req.user.id}`
    const roomName = session.roomName

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name: displayName,
      ttl: "6h",
      metadata: JSON.stringify({
        role: req.user.role,
        profileId: req.user.profileId,
        sessionId: String(session._id),
      }),
    })

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: true,
    })

    const token = await at.toJwt()
    const formatted = await fetchFormattedSessionById(session._id)

    res.status(200).json({
      token,
      roomName,
      classroomPath: classroomPath(session._id),
      participantName: displayName,
      identity,
      role: req.user.role,
      url: livekitUrl,
      livekitUrl,
      teacherCheckedIn: Boolean(session.teacherAttendance?.checkInTime),
      teacherCheckInTime: session.teacherAttendance?.checkInTime || null,
      teacherCheckOutTime: session.teacherAttendance?.checkOutTime || null,
      session: formatted,
    })
  } catch (error) {
    const status = error.statusCode || 500
    res.status(status).json({
      message: error.message || "Failed to join classroom",
      code: error.code,
    })
  }
}

exports.getRoomToken = issueClassroomToken
exports.joinClassroom = issueClassroomToken

exports.leaveClassroom = async (req, res) => {
  try {
    const { sessionId } = req.body || {}
    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: "Valid sessionId is required" })
    }

    const session = await loadSessionForClassroom(sessionId)
    await assertSessionAccess(req.user, session)

    if (req.user.role === "teacher") {
      await teacherCheckOut(session)
    } else if (req.user.role === "student") {
      await markStudentLeft(session, req.user.profileId)
    }

    const formatted = await fetchFormattedSessionById(session._id)

    res.status(200).json({
      message:
        req.user.role === "teacher"
          ? "Class ended. Instructor checked out."
          : "Left classroom",
      session: formatted,
      teacherCheckInTime: session.teacherAttendance?.checkInTime || null,
      teacherCheckOutTime: session.teacherAttendance?.checkOutTime || null,
    })
  } catch (error) {
    const status = error.statusCode || 500
    res.status(status).json({
      message: error.message || "Failed to leave classroom",
      code: error.code,
    })
  }
}

exports.getClassroom = async (req, res) => {
  try {
    const { sessionId } = req.params
    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: "Valid sessionId is required" })
    }

    const session = await loadSessionForClassroom(sessionId)
    await assertSessionAccess(req.user, session)

    const formatted = await fetchFormattedSessionById(session._id)

    res.status(200).json({
      session: formatted,
      roomName: formatted.roomName,
      classroomPath: formatted.classroomPath,
      isLive: formatted.isLive,
      canStudentJoin: formatted.canStudentJoin,
      teacherAttendance: formatted.teacherAttendance,
    })
  } catch (error) {
    const status = error.statusCode || 500
    res.status(status).json({
      message: error.message || "Failed to fetch classroom",
      code: error.code,
    })
  }
}
