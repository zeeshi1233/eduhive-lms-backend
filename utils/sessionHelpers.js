const mongoose = require("mongoose")
const Session = require("../models/Session")
const StudentCourse = require("../models/StudentCourse")
const Student = require("../models/Student")
const {
  classroomPath,
  classroomRoomName,
  getTeacherAttendanceStatus,
  isClassLive,
} = require("./classroom")

const ALLOWED_DURATIONS = ["45 mins", "60 mins", "90 mins", "120 mins"]
const ALLOWED_TYPES = ["Regular Class", "Extra Class"]
const SESSION_STATUSES = [
  "Scheduled",
  "pending",
  "ongoing",
  "conducted",
  "not_conducted",
  "Cancelled",
  "completed",
]
const COURSE_POPULATE = "title board code serialNumber description isActive"
const INSTRUCTOR_POPULATE = "name"

const STATUS_ALIASES = {
  pending: "Scheduled",
  completed: "conducted",
  "not conducted": "not_conducted",
  cancelled: "Cancelled",
}

function parseDurationMinutes(duration) {
  const minutes = parseInt(duration, 10)
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 60
}

function computeEndTime(startTime, duration) {
  const start = new Date(startTime)
  if (Number.isNaN(start.getTime())) return null
  return new Date(start.getTime() + parseDurationMinutes(duration) * 60 * 1000)
}

function normalizeStatus(status) {
  if (status == null || status === "") return ""
  const trimmed = String(status).trim()
  const alias = STATUS_ALIASES[trimmed.toLowerCase()]
  return alias || trimmed
}

function isAllowedStatus(status) {
  return SESSION_STATUSES.includes(status)
}

function generateCourseCode(title, board) {
  const compact = (str) =>
    String(str || "")
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toUpperCase()

  const t = compact(title)
  const b = compact(board)
  if (t && b) return `${t}-${b}`.slice(0, 48)
  return t || b || `CRS-${Date.now().toString().slice(-6)}`
}

function formatCourse(course) {
  if (!course) return course
  if (typeof course !== "object") return { _id: course, title: "", board: "", code: "" }

  // Unpopulated ObjectId — do not treat as a course document
  if (course instanceof mongoose.Types.ObjectId || course._bsontype === "ObjectId") {
    return { _id: course, title: "", board: "", code: "" }
  }

  const obj = course.toObject ? course.toObject() : { ...course }
  const code = obj.code || obj.serialNumber || ""
  const title = obj.title || obj.name || obj.courseTitle || obj.courseName || ""
  return {
    _id: obj._id,
    title,
    board: obj.board || "",
    code,
    serialNumber: obj.serialNumber || code,
    description: obj.description || "",
    isActive: obj.isActive,
  }
}

function formatInstructor(instructor) {
  if (!instructor) return instructor
  if (typeof instructor !== "object") return instructor
  const obj = instructor.toObject ? instructor.toObject() : { ...instructor }
  return {
    _id: obj._id,
    name: obj.name,
  }
}

function formatSession(session) {
  if (!session) return session
  const obj = session.toObject ? session.toObject() : { ...session }
  const course = formatCourse(obj.course)
  const instructor = formatInstructor(obj.instructor || obj.teacher)
  const teacher = formatInstructor(obj.teacher || obj.instructor)
  const duration = ALLOWED_DURATIONS.includes(obj.duration) ? obj.duration : obj.duration || "60 mins"
  const endTime = obj.endTime || computeEndTime(obj.startTime, duration)

  const roomName = obj.roomName || classroomRoomName(obj._id)
  const joinPath = classroomPath(obj._id)
  const attendance = obj.teacherAttendance || {}
  const teacherAttendanceStatus = getTeacherAttendanceStatus(obj)

  return {
    ...obj,
    courseId: course?._id || obj.course,
    teacherId: teacher?._id || instructor?._id || obj.teacher || obj.instructor,
    course,
    courseTitle:
      (course && typeof course === "object" && (course.title || course.code)) ||
      obj.title ||
      "",
    instructor,
    teacher,
    instructor,
    link: obj.link || obj.meetingLink || joinPath,
    duration,
    type: obj.type || "Regular Class",
    status: obj.status || "Scheduled",
    notConductedReason: obj.notConductedReason || "",
    roomName,
    classroomPath: joinPath,
    joinUrl: joinPath,
    meetingLink: joinPath,
    description: obj.description || "",
    topic: obj.topic || "",
    endTime,
    isLive: isClassLive(obj),
    canStudentJoin: teacherAttendanceStatus === "checked-in",
    teacherAttendance: {
      checkInTime: attendance.checkInTime || null,
      checkOutTime: attendance.checkOutTime || null,
      status: teacherAttendanceStatus,
    },
  }
}

async function fetchFormattedSessions(filter = {}) {
  const sessions = await Session.find(filter)
    .populate("course", COURSE_POPULATE)
    .populate("instructor", INSTRUCTOR_POPULATE)
    .populate("teacher", INSTRUCTOR_POPULATE)
    .sort({ startTime: 1 })

  return sessions.map(formatSession)
}

async function fetchFormattedSessionById(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null
  const session = await Session.findById(id)
    .populate("course", COURSE_POPULATE)
    .populate("instructor", INSTRUCTOR_POPULATE)
  return session ? formatSession(session) : null
}

async function studentSessionFilter(studentId) {
  if (!studentId || !mongoose.Types.ObjectId.isValid(studentId)) return null

  const enrollments = await StudentCourse.find({
    studentId,
    status: { $in: ["active", "completed"] },
  }).select("courseId")

  const enrolledCourseIds = enrollments
    .map((e) => e.courseId)
    .filter(Boolean)

  if (!enrolledCourseIds.length) return null
  return { course: { $in: enrolledCourseIds } }
}

module.exports = {
  ALLOWED_DURATIONS,
  ALLOWED_TYPES,
  SESSION_STATUSES,
  COURSE_POPULATE,
  INSTRUCTOR_POPULATE,
  parseDurationMinutes,
  computeEndTime,
  normalizeStatus,
  isAllowedStatus,
  generateCourseCode,
  formatCourse,
  formatSession,
  fetchFormattedSessions,
  fetchFormattedSessionById,
  studentSessionFilter,
}
