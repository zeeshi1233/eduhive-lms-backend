const Session = require("../models/Session")
const Teacher = require("../models/Teacher")
const Student = require("../models/Student")
const Admin = require("../models/Admin")

const MIN_CONDUCTED_RATIO = 0.5 // at least 50% of scheduled duration
const MIN_CONDUCTED_MINUTES = 15

function classroomPath(sessionId) {
  return `/classroom/${sessionId}`
}

function classroomRoomName(sessionId) {
  return `eduhive-class-${sessionId}`
}

function getTeacherAttendanceStatus(session) {
  const attendance = session?.teacherAttendance || {}
  if (attendance.checkOutTime) return "checked-out"
  if (attendance.checkInTime) return "checked-in"
  return "not_started"
}

function isClassLive(session) {
  return getTeacherAttendanceStatus(session) === "checked-in"
}

function parseDurationMinutes(duration) {
  const minutes = parseInt(duration, 10)
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 60
}

function ensureRoomFields(session) {
  const id = session._id
  if (!session.roomName) session.roomName = classroomRoomName(id)
  session.meetingLink = classroomPath(id)
  return session
}

async function persistRoomFields(session) {
  ensureRoomFields(session)
  await session.save()
  return session
}

async function teacherCheckIn(session) {
  if (session.status === "Cancelled") {
    const error = new Error("This class was cancelled")
    error.statusCode = 400
    error.code = "CLASS_CANCELLED"
    throw error
  }

  if (session.teacherAttendance?.checkOutTime) {
    const error = new Error("This class has already ended")
    error.statusCode = 400
    error.code = "CLASS_ENDED"
    throw error
  }

  if (!session.teacherAttendance?.checkInTime) {
    session.set("teacherAttendance.checkInTime", new Date())
    session.status = "ongoing"
    await session.save()
  }

  return session
}

function resolveAutoStatus(session, checkOutTime) {
  const checkIn = session.teacherAttendance?.checkInTime
    ? new Date(session.teacherAttendance.checkInTime)
    : null
  if (!checkIn || Number.isNaN(checkIn.getTime())) {
    return { status: "not_conducted", notConductedReason: "Teacher Not Present" }
  }

  const elapsedMs = Math.max(0, new Date(checkOutTime).getTime() - checkIn.getTime())
  const elapsedMins = elapsedMs / 60000
  const scheduledMins = parseDurationMinutes(session.duration)
  const minRequired = Math.max(MIN_CONDUCTED_MINUTES, scheduledMins * MIN_CONDUCTED_RATIO)

  if (elapsedMins >= minRequired) {
    return { status: "conducted", notConductedReason: "" }
  }

  return {
    status: "not_conducted",
    notConductedReason: session.notConductedReason || "Others",
  }
}

async function teacherCheckOut(session) {
  if (!session.teacherAttendance?.checkInTime) {
    const error = new Error("Class has not started yet")
    error.statusCode = 400
    error.code = "NOT_STARTED"
    throw error
  }

  if (!session.teacherAttendance.checkOutTime) {
    const checkOutTime = new Date()
    session.set("teacherAttendance.checkOutTime", checkOutTime)

    // Calculate teacher duration
    const checkIn = new Date(session.teacherAttendance.checkInTime)
    if (!Number.isNaN(checkIn.getTime())) {
      const ms = Math.max(0, checkOutTime.getTime() - checkIn.getTime())
      const mins = Math.round(ms / 60000)
      const h = Math.floor(mins / 60)
      const m = mins % 60
      session.set("teacherAttendance.durationMinutes", mins)
      session.set("teacherAttendance.durationFormatted", h > 0 ? `${h} hr${h > 1 ? "s" : ""} ${m} mins` : `${m} mins`)
    }

    // Only auto-resolve if still live/scheduled — preserve manual conducted/not_conducted
    const current = String(session.status || "").toLowerCase()
    if (current === "ongoing" || current === "scheduled" || current === "pending") {
      const resolved = resolveAutoStatus(session, checkOutTime)
      session.status = resolved.status
      if (resolved.status === "not_conducted") {
        session.notConductedReason = resolved.notConductedReason || "Others"
      } else {
        session.notConductedReason = undefined
      }
    }

    // Auto check-out all students currently in class
    if (Array.isArray(session.studentAttendance)) {
      session.studentAttendance.forEach((rec) => {
        if (rec.present && !rec.leftAt) {
          rec.leftAt = checkOutTime
          rec.markedAt = checkOutTime
          if (rec.joinedAt) {
            const ms = Math.max(0, checkOutTime.getTime() - new Date(rec.joinedAt).getTime())
            const mins = Math.round(ms / 60000)
            const h = Math.floor(mins / 60)
            const m = mins % 60
            rec.durationMinutes = mins
            rec.durationFormatted = h > 0 ? `${h} hr${h > 1 ? "s" : ""} ${m} mins` : `${m} mins`
          }
        }
      })
    }

    await session.save()
  }

  return session
}

async function markStudentPresent(session, studentId) {
  if (!studentId) return session
  if (!Array.isArray(session.studentAttendance)) session.studentAttendance = []

  const now = new Date()
  const existing = session.studentAttendance.find(
    (record) => String(record.student) === String(studentId)
  )

  if (existing) {
    existing.present = true
    existing.markedAt = now
    if (!existing.joinedAt) existing.joinedAt = now
    existing.leftAt = undefined
  } else {
    session.studentAttendance.push({
      student: studentId,
      present: true,
      joinedAt: now,
      markedAt: now,
    })
  }

  await session.save()
  return session
}

async function markStudentLeft(session, studentId) {
  if (!studentId) return session
  if (!Array.isArray(session.studentAttendance)) return session

  const existing = session.studentAttendance.find(
    (record) => String(record.student?._id || record.student) === String(studentId)
  )
  if (existing) {
    const leftTime = new Date()
    existing.leftAt = leftTime
    existing.markedAt = leftTime
    if (existing.joinedAt) {
      const ms = Math.max(0, leftTime.getTime() - new Date(existing.joinedAt).getTime())
      const mins = Math.round(ms / 60000)
      const h = Math.floor(mins / 60)
      const m = mins % 60
      existing.durationMinutes = mins
      existing.durationFormatted = h > 0 ? `${h} hr${h > 1 ? "s" : ""} ${m} mins` : `${m} mins`
    }
    await session.save()
  }
  return session
}

async function getParticipantName(user, fallback) {
  if (fallback) return fallback

  if (user?.role === "teacher") {
    const teacher = await Teacher.findById(user.profileId).select("name")
    return teacher?.name || "Instructor"
  }
  if (user?.role === "student") {
    const student = await Student.findById(user.profileId).select("name")
    return student?.name || "Student"
  }
  if (user?.role === "admin") {
    const admin = await Admin.findById(user.profileId).select("name")
    return admin?.name || "Admin"
  }
  return "Participant"
}

async function loadSessionForClassroom(sessionId) {
  const session = await Session.findById(sessionId)
  if (!session) {
    const error = new Error("Scheduled class not found")
    error.statusCode = 404
    error.code = "SESSION_NOT_FOUND"
    throw error
  }
  return persistRoomFields(session)
}

module.exports = {
  classroomPath,
  classroomRoomName,
  getTeacherAttendanceStatus,
  isClassLive,
  ensureRoomFields,
  persistRoomFields,
  teacherCheckIn,
  teacherCheckOut,
  markStudentPresent,
  markStudentLeft,
  getParticipantName,
  loadSessionForClassroom,
  resolveAutoStatus,
  MIN_CONDUCTED_MINUTES,
  MIN_CONDUCTED_RATIO,
}
