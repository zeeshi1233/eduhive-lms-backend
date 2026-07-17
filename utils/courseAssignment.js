const Teacher = require("../models/Teacher")
const Course = require("../models/Course")

const normalizeIds = (value) => {
  if (!value) return []
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return []
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean)
      } catch (error) {
        // fallback to comma split
      }
    }
    return trimmed.split(",").map((item) => String(item).trim()).filter(Boolean)
  }
  return [String(value).trim()].filter(Boolean)
}

// Teacher-Course assignment sync
// - Removed courses se instructor unset karo
// - Added courses me instructor set karo
// - Dusre teachers se course pull karo (ek course ka ek hi teacher)
// NOTE: Course.students[] ab exist nahi karta — StudentCourse model use karo
const syncTeacherCourseAssignments = async (
  teacherId,
  previousCourseIds = [],
  newCourseIds = []
) => {
  const previous = normalizeIds(previousCourseIds)
  const desired = normalizeIds(newCourseIds)

  const added = desired.filter((id) => !previous.includes(id))
  const removed = previous.filter((id) => !desired.includes(id))

  if (removed.length) {
    await Course.updateMany(
      { _id: { $in: removed }, instructor: teacherId },
      { $unset: { instructor: "" } }
    )
  }

  if (added.length) {
    await Course.updateMany({ _id: { $in: added } }, { $set: { instructor: teacherId } })

    // Dusre teachers se yeh courses pull karo
    await Teacher.updateMany(
      { _id: { $ne: teacherId }, assignedCourses: { $in: added } },
      { $pull: { assignedCourses: { $in: added } } }
    )
  }

  return { added, removed }
}

module.exports = { syncTeacherCourseAssignments }
