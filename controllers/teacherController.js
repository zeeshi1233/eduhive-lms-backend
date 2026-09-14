const Course = require("../models/Course")
const Teacher = require("../models/Teacher")
const Assignment = require("../models/Assignment")
const Session = require("../models/Session")
const { fetchFormattedSessions, fetchFormattedSessionById } = require("../utils/sessionHelpers")
const { teacherCheckIn, teacherCheckOut } = require("../utils/classroom")
const Attendance = require("../models/Attendance")
const Transaction = require("../models/Transaction")
const StudentCourse = require("../models/StudentCourse")

// =========================
// Get Assigned Courses
// =========================
exports.getAssignedCourses = async (req, res) => {
  try {
    const teacherId = req.user.profileId

    const teacher = await Teacher.findById(teacherId).populate("assignedCourses")

    if (!teacher) {
      return res.status(404).json({ message: "Teacher not found" })
    }

    // Har course ke liye students aur sessions bhi attach karo
    const courseIds = (teacher.assignedCourses || []).map((c) => c._id)

    const [enrollments, sessions, assignments] = await Promise.all([
      StudentCourse.find({ courseId: { $in: courseIds } }).populate(
        "studentId",
        "name"
      ),
      Session.find({ course: { $in: courseIds } }),
      Assignment.find({ course: { $in: courseIds } }),
    ])

    const enrollMap = {}
    enrollments.forEach((e) => {
      if (!enrollMap[String(e.courseId)]) enrollMap[String(e.courseId)] = []
      enrollMap[String(e.courseId)].push(e.studentId)
    })

    const sessionMap = {}
    sessions.forEach((s) => {
      if (!sessionMap[String(s.course)]) sessionMap[String(s.course)] = []
      sessionMap[String(s.course)].push(s)
    })

    const assignmentMap = {}
    assignments.forEach((a) => {
      if (!assignmentMap[String(a.course)]) assignmentMap[String(a.course)] = []
      assignmentMap[String(a.course)].push(a)
    })

    const courses = (teacher.assignedCourses || []).map((course) => ({
      ...course.toObject(),
      students: enrollMap[String(course._id)] || [],
      sessions: sessionMap[String(course._id)] || [],
      assignments: assignmentMap[String(course._id)] || [],
    }))

    res.status(200).json({ courses })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch courses", error: error.message })
  }
}

// =========================
// Teacher Dashboard Stats
// =========================
exports.getTeacherDashboardStats = async (req, res) => {
  try {
    const teacherId = req.user.profileId
    const teacher = await Teacher.findById(teacherId).select("assignedCourses")
    const assignedIds = teacher?.assignedCourses || []

    const courses = await Course.find({
      $or: [{ instructor: teacherId }, { _id: { $in: assignedIds } }],
    }).select("_id title")
    const courseIds = courses.map((c) => c._id)

    const [enrollments, sessions] = await Promise.all([
      StudentCourse.find({
        courseId: { $in: courseIds },
        status: { $ne: "dropped" },
      })
        .populate("studentId", "name")
        .populate("courseId", "title")
        .sort({ enrolledAt: -1 }),
      Session.find({ instructor: teacherId }).select(
        "startTime endTime status duration teacherAttendance type title"
      ),
    ])

    const uniqueStudentIds = new Set(
      enrollments.map((e) => String(e.studentId?._id || e.studentId)).filter((id) => id !== "undefined")
    )
    const now = new Date()
    const endedStatuses = ["conducted", "completed", "Cancelled", "not_conducted"]

    const upcomingClasses = sessions.filter((s) => {
      const start = new Date(s.startTime)
      return start > now && !endedStatuses.includes(s.status)
    }).length

    const conductedClasses = sessions.filter(
      (s) => s.status === "conducted" || s.status === "completed"
    ).length

    const liveClasses = sessions.filter((s) => {
      const checkedIn = Boolean(s.teacherAttendance?.checkInTime)
      const checkedOut = Boolean(s.teacherAttendance?.checkOutTime)
      return s.status === "ongoing" || (checkedIn && !checkedOut)
    }).length

    let totalHoursTaught = 0
    sessions.forEach((session) => {
      const conducted =
        session.status === "conducted" ||
        session.status === "completed" ||
        Boolean(session.teacherAttendance?.checkOutTime)
      if (!conducted) return
      const start = new Date(session.startTime)
      const end = session.endTime
        ? new Date(session.endTime)
        : new Date(start.getTime() + (parseInt(session.duration, 10) || 60) * 60 * 1000)
      const hours = (end - start) / (1000 * 60 * 60)
      if (hours > 0 && hours <= 8) totalHoursTaught += hours
    })

    const monthlySessions = []
    for (let i = 5; i >= 0; i -= 1) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
      const count = sessions.filter((s) => {
        const t = new Date(s.startTime)
        return t >= start && t < end
      }).length
      monthlySessions.push({
        month: start.toLocaleString("en-US", { month: "short" }),
        year: start.getFullYear(),
        count,
      })
    }

    const recentEnrollments = enrollments.slice(0, 8).map((e) => ({
      studentName: e.studentId?.name || "Student",
      courseTitle: e.courseId?.title || "Course",
      enrolledAt: e.enrolledAt || e.createdAt,
    }))

    res.status(200).json({
      totalStudents: uniqueStudentIds.size,
      upcomingClasses,
      conductedClasses,
      liveClasses,
      totalSessions: sessions.length,
      totalHoursTaught: Number(totalHoursTaught.toFixed(2)),
      monthlySessions,
      recentEnrollments,
    })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch dashboard stats", error: error.message })
  }
}

// =========================
// Create Assignment
// =========================
exports.createAssignment = async (req, res) => {
  try {
    const { title, description, courseId, dueDate, maxMarks } = req.body
    const attachmentUrl = req.file?.path || null

    const newAssignment = new Assignment({
      title,
      description,
      course: courseId,
      dueDate,
      maxMarks,
      attachmentUrl,
    })

    await newAssignment.save()

    // Add assignment to course
    await Course.findByIdAndUpdate(courseId, {
      $push: { assignments: newAssignment._id },
    })

    res.status(201).json({
      message: "Assignment created successfully",
      assignment: newAssignment,
    })
  } catch (error) {
    res.status(500).json({ message: "Failed to create assignment", error: error.message })
  }
}

// =========================
// Update Assignment
// =========================
exports.updateAssignment = async (req, res) => {
  try {
    const { assignmentId } = req.params
    const { title, description, dueDate, maxMarks } = req.body
    const attachmentUrl = req.file?.path

    const assignment = await Assignment.findById(assignmentId)
    if (!assignment) {
      return res.status(404).json({ message: "Assignment not found" })
    }

    assignment.title = title ?? assignment.title
    assignment.description = description ?? assignment.description
    assignment.dueDate = dueDate ?? assignment.dueDate
    assignment.maxMarks = maxMarks ?? assignment.maxMarks
    if (attachmentUrl) assignment.attachmentUrl = attachmentUrl

    await assignment.save()

    res.status(200).json({ message: "Assignment updated successfully", assignment })
  } catch (error) {
    res.status(500).json({ message: "Failed to update assignment", error: error.message })
  }
}

// =========================
// Delete Assignment
// =========================
exports.deleteAssignment = async (req, res) => {
  try {
    const { assignmentId } = req.params

    const assignment = await Assignment.findById(assignmentId)
    if (!assignment) {
      return res.status(404).json({ message: "Assignment not found" })
    }

    await Course.findByIdAndUpdate(assignment.course, {
      $pull: { assignments: assignment._id },
    })

    await assignment.deleteOne()

    res.status(200).json({ message: "Assignment deleted successfully" })
  } catch (error) {
    res.status(500).json({ message: "Failed to delete assignment", error: error.message })
  }
}

// =========================
// Get All Assignments
// =========================
exports.getAssignments = async (req, res) => {
  try {
    const assignments = await Assignment.find()
      .populate("course", "title description price instructor")
      .populate("submissions.student", "name")

    res.status(200).json({ assignments })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch assignments", error: error.message })
  }
}

// =========================
// Get Assignments by Course
// =========================
exports.getAssignmentById = async (req, res) => {
  try {
    const { courseId } = req.params

    const assignments = await Assignment.find({ course: courseId })
      .populate("course", "title description price instructor")
      .populate("submissions.student", "name")

    res.status(200).json({ assignments })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch assignments", error: error.message })
  }
}

// =========================
// Grade Assignment Submission
// =========================
exports.gradeSubmission = async (req, res) => {
  try {
    const { assignmentId, submissionIndex, marksObtained, feedback } = req.body

    const assignment = await Assignment.findById(assignmentId)

    if (!assignment || !assignment.submissions[submissionIndex]) {
      return res.status(404).json({ message: "Submission not found" })
    }

    assignment.submissions[submissionIndex].marksObtained = marksObtained
    assignment.submissions[submissionIndex].feedback = feedback

    await assignment.save()

    res.status(200).json({ message: "Assignment graded successfully", assignment })
  } catch (error) {
    res.status(500).json({ message: "Failed to grade assignment", error: error.message })
  }
}

// =========================
// Mark Teacher Attendance
// =========================
exports.markTeacherAttendance = async (req, res) => {
  try {
    const { sessionId, action } = req.body
    const teacherId = req.user.profileId

    const session = await Session.findById(sessionId)
    if (!session) {
      return res.status(404).json({ message: "Session not found" })
    }

    if (session.instructor.toString() !== teacherId) {
      return res.status(403).json({ message: "Not authorized" })
    }

    // CHECK-IN — teacher starts the class
    if (action === "checkin") {
      await teacherCheckIn(session)
      const formatted = await fetchFormattedSessionById(session._id)
      return res.status(200).json({
        message: "Instructor checked in. Class is live.",
        status: session.status,
        checkInTime: session.teacherAttendance.checkInTime,
        session: formatted,
      })
    }

    // CHECK-OUT — teacher ends the class
    if (action === "checkout") {
      await teacherCheckOut(session)
      const formatted = await fetchFormattedSessionById(session._id)
      return res.status(200).json({
        message: "Instructor checked out. Class ended.",
        status: session.status,
        checkInTime: session.teacherAttendance.checkInTime,
        checkOutTime: session.teacherAttendance.checkOutTime,
        session: formatted,
      })
    }

    return res.status(400).json({ message: "Invalid action" })
  } catch (error) {
    const status = error.statusCode || 500
    res.status(status).json({
      message: error.message || "Failed to update session status",
      code: error.code,
    })
  }
}

// =========================
// Get Teacher Students Progress
// =========================
exports.getTeacherStudentsProgress = async (req, res) => {
  try {
    const teacherId = req.user.profileId

    const courses = await Course.find({ instructor: teacherId })

    if (!courses.length) {
      return res.status(404).json({ message: "No courses found for this teacher" })
    }

    const progressData = await Promise.all(
      courses.map(async (course) => {
        // Students via StudentCourse
        const enrollments = await StudentCourse.find({ courseId: course._id }).populate(
          "studentId",
          "name"
        )

        const assignments = await Assignment.find({ course: course._id })

        const studentsProgress = await Promise.all(
          enrollments.map(async (enrollment) => {
            const student = enrollment.studentId
            if (!student) return null

            const attendance = await Attendance.find({
              student: student._id,
              course: course._id,
            })

            let totalMarks = 0
            let maxMarks = 0

            assignments.forEach((assignment) => {
              const submission = assignment.submissions.find(
                (sub) => sub.student.toString() === student._id.toString()
              )

              if (submission && submission.marksObtained !== undefined) {
                totalMarks += submission.marksObtained
                maxMarks += assignment.maxMarks || 0
              }
            })

            return {
              studentId: student._id,
              name: student.name,
              attendance: {
                present: attendance.filter((a) => a.present).length,
                total: attendance.length,
              },
              scores: {
                obtained: totalMarks,
                maximum: maxMarks,
                percentage:
                  maxMarks > 0 ? ((totalMarks / maxMarks) * 100).toFixed(2) : 0,
              },
            }
          })
        )

        return {
          courseId: course._id,
          courseTitle: course.title,
          students: studentsProgress.filter(Boolean),
        }
      })
    )

    res.status(200).json({ teacherId, progressData })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch students progress", error: error.message })
  }
}

// =========================
// Get Teacher Session Transactions
// =========================
exports.getTeacherSessionTransactions = async (req, res) => {
  try {
    const teacherId = req.user.profileId

    const sessions = await Session.find({ instructor: teacherId }).populate("course", "title")

    const sessionData = await Promise.all(
      sessions.map(async (session) => {
        const transaction = await Transaction.findOne({
          user: teacherId,
          type: "payroll",
          description: { $regex: String(session._id) },
        })

        return {
          sessionId: session._id,
          course: session.course?.title || "Unknown",
          perClassFee: session.perClassFee,
          isPaid: session.isPaid,
          paidAt: session.paidAt || null,
          transaction: transaction
            ? {
                id: transaction._id,
                amount: transaction.amount,
                status: transaction.status,
                description: transaction.description,
              }
            : null,
        }
      })
    )

    res.status(200).json({ sessions: sessionData })
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch session transactions",
      error: error.message,
    })
  }
}

// =========================
// Get All Sessions (Teacher)
// =========================
exports.getAllSessions = async (req, res) => {
  try {
    const teacherId = req.user.profileId
    const { courseId } = req.query

    const filter = { instructor: teacherId }
    if (courseId) filter.course = courseId

    const sessions = await fetchFormattedSessions(filter)

    res.status(200).json({
      success: true,
      count: sessions.length,
      sessions,
    })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch sessions", error: error.message })
  }
}
