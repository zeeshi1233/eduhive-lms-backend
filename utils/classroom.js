const Session = require("../models/Session")
const Teacher = require("../models/Teacher")
const Student = require("../models/Student")
const Admin = require("../models/Admin")

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

async function teacherCheckOut(session) {
  if (!session.teacherAttendance?.checkInTime) {
    const error = new Error("Class has not started yet")
    error.statusCode = 400
    error.code = "NOT_STARTED"
    throw error
  }

  if (!session.teacherAttendance.checkOutTime) {
    session.set("teacherAttendance.checkOutTime", new Date())
    session.status = "conducted"
    await session.save()
  }

  return session
}

async function markStudentPresent(session, studentId) {
  if (!studentId) return session
  if (!Array.isArray(session.studentAttendance)) session.studentAttendance = []

  const existing = session.studentAttendance.find(
    (record) => String(record.student) === String(studentId)
  )

  if (existing) {
    existing.present = true
    existing.markedAt = new Date()
  } else {
    session.studentAttendance.push({
      student: studentId,
      present: true,
      markedAt: new Date(),
    })
  }

  await session.save()
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
  getParticipantName,
  loadSessionForClassroom,
}
