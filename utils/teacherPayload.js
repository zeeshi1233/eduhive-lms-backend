const mongoose = require("mongoose")

const normalizeList = (value) => {
  if (Array.isArray(value)) return value.filter((item) => item !== undefined && item !== null && String(item).trim() !== "").map(String)
  if (!value && value !== 0) return []

  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return []
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) return parsed.map(String)
      } catch (error) {
        // fall through to comma split
      }
    }
    return trimmed.split(",").map((item) => item.trim()).filter(Boolean)
  }

  return [String(value)]
}

const normalizeObjectIdArray = (value) => {
  const ids = normalizeList(value)
  return ids.map((id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id))
}

const buildTeacherPayload = (data) => {
  const payload = {}

  const allowedFields = [
    "name",
    "email",
    "password",
    "phone",
    "gender",
    "address",
    "qualification",
    "specialization",
    "experienceYears",
    "assignedCourses",
    "boards",
    "level",
    "oLevelHourPay",
    "availability",
    "joiningDate",
    "profileImage",
  ]

  allowedFields.forEach((field) => {
    if (data[field] !== undefined) {
      payload[field] = data[field]
    }
  })

  if (payload.assignedCourses !== undefined) {
    payload.assignedCourses = normalizeObjectIdArray(payload.assignedCourses)
  }

  if (payload.boards !== undefined) {
    payload.boards = normalizeList(payload.boards)
  }

  if (payload.experienceYears !== undefined) {
    const value = Number(payload.experienceYears)
    payload.experienceYears = Number.isNaN(value) ? undefined : value
  }

  if (payload.oLevelHourPay !== undefined) {
    const value = Number(payload.oLevelHourPay)
    payload.oLevelHourPay = Number.isNaN(value) ? undefined : value
  }

  if (payload.joiningDate !== undefined) {
    const parsedDate = new Date(payload.joiningDate)
    if (!Number.isNaN(parsedDate.getTime())) {
      payload.joiningDate = parsedDate
    } else {
      delete payload.joiningDate
    }
  }

  if (payload.profileImage === "" || payload.profileImage === null) {
    delete payload.profileImage
  }

  return payload
}

module.exports = { buildTeacherPayload }
