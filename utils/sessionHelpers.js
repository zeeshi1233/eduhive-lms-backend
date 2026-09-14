const mongoose = require("mongoose")
const Session = require("../models/Session")
const StudentCourse = require("../models/StudentCourse")

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
  if (typeof course !== "object") return course
  const obj = course.toObject ? course.toObject() : { ...course }
  const code = obj.code || obj.serialNumber || ""
  return {
    _id: obj._id,
    title: obj.title,
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
  const instructor = formatInstructor(obj.instructor)
  const duration = ALLOWED_DURATIONS.includes(obj.duration) ? obj.duration : obj.duration || "60 mins"
  const endTime = obj.endTime || computeEndTime(obj.startTime, duration)

  return {
    ...obj,
    courseId: course?._id || obj.course,
    teacherId: instructor?._id || obj.instructor,
    course,
    instructor,
    teacher: instructor,
    duration,
    type: obj.type || "Regular Class",
    status: obj.status || "Scheduled",
    meetingLink: obj.meetingLink || "",
    description: obj.description || "",
    topic: obj.topic || "",
    endTime,
  }
}

async function fetchFormattedSessions(filter = {}) {
  const sessions = await Session.find(filter)
    .populate("course", COURSE_POPULATE)
    .populate("instructor", INSTRUCTOR_POPULATE)
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
  const enrollments = await StudentCourse.find({
    studentId,
    status: { $ne: "dropped" },
  }).select("courseId")

  const enrolledCourseIds = enrollments.map((e) => e.courseId)
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
