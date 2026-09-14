const Course = require("../models/Course")
const Student = require("../models/Student")
const StudentCourse = require("../models/StudentCourse")
const Assignment = require("../models/Assignment")
const Attendance = require("../models/Attendance")
const Complaint = require("../models/Complaint")
const Payment = require("../models/Payment")
const Transaction = require("../models/Transaction")
const Session = require("../models/Session")
const { fetchFormattedSessions, studentSessionFilter } = require("../utils/sessionHelpers")

// =========================
// Get Enrolled Courses
// =========================
exports.getEnrolledCourses = async (req, res) => {
  try {
    // Auth ID se Student profileId nikalo
    const studentId = req.user.profileId

    const enrollments = await StudentCourse.find({ studentId })
      .populate({
        path: "courseId",
        populate: { path: "instructor", select: "name" },
      })

    const courses = enrollments.map((e) => ({
      ...e.courseId?.toObject(),
      enrollmentId: e._id,
      status: e.status,
      enrolledAt: e.enrolledAt,
    }))

    res.status(200).json({ courses })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch courses", error: error.message })
  }
}

// =========================
// Enroll in Course (Student)
// =========================
exports.enrollCourse = async (req, res) => {
  try {
    const { courseId } = req.body
    const studentId = req.user.profileId

    const course = await Course.findById(courseId)
    if (!course) {
      return res.status(404).json({ message: "Course not found" })
    }

    // Already enrolled check
    const existing = await StudentCourse.findOne({ studentId, courseId })
    if (existing) {
      return res.status(400).json({ message: "Already enrolled in this course" })
    }

    // Create enrollment record
    const enrollment = await StudentCourse.create({
      studentId,
      courseId,
      status: "active",
    })

    // Create payment record
    const payment = new Payment({
      user: studentId,
      course: courseId,
      amount: course.price,
      status: course.price > 0 ? "pending" : "completed",
    })
    await payment.save()

    res.status(200).json({
      message: "Enrolled successfully",
      enrollment,
      payment,
    })
  } catch (error) {
    res.status(500).json({ message: "Failed to enroll", error: error.message })
  }
}

// =========================
// Get Course Details
// =========================
exports.getCourseDetails = async (req, res) => {
  try {
    const { courseId } = req.params

    const course = await Course.findById(courseId)
      .populate("instructor", "name")
      .populate("assignments")

    if (!course) {
      return res.status(404).json({ message: "Course not found" })
    }

    // Sessions bhi fetch karo (course.sessions[] ab nahi hai)
    const sessions = await Session.find({ course: courseId }).sort({ startTime: -1 })

    res.status(200).json({ course: { ...course.toObject(), sessions } })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch course details", error: error.message })
  }
}

// =========================
// Submit Assignment
// =========================
exports.submitAssignment = async (req, res) => {
  try {
    const { assignmentId } = req.body
    const studentId = req.user.profileId
    const submissionUrl = req.file?.path || null

    const assignment = await Assignment.findById(assignmentId)
    if (!assignment) {
      return res.status(404).json({ message: "Assignment not found" })
    }

    const existingSubmission = assignment.submissions.find(
      (sub) => sub.student.toString() === studentId.toString()
    )

    if (existingSubmission) {
      existingSubmission.submissionUrl = submissionUrl
      existingSubmission.submittedAt = new Date()
    } else {
      assignment.submissions.push({
        student: studentId,
        submissionUrl,
        submittedAt: new Date(),
      })
    }

    await assignment.save()

    res.status(200).json({
      message: "Assignment submitted successfully",
      assignment,
    })
  } catch (error) {
    res.status(500).json({ message: "Failed to submit assignment", error: error.message })
  }
}

// =========================
// Get Student Assignments
// =========================
exports.getStudentAssignments = async (req, res) => {
  try {
    const studentId = req.user.profileId

    // Enrolled course IDs nikalo
    const enrollments = await StudentCourse.find({ studentId }).select("courseId")
    const enrolledCourseIds = enrollments.map((e) => e.courseId)

    if (!enrolledCourseIds.length) {
      return res.status(200).json({ success: true, count: 0, assignments: [] })
    }

    const assignments = await Assignment.find({
      course: { $in: enrolledCourseIds },
    })
      .populate("course", "title")
      .sort({ dueDate: -1 })

    const formattedAssignments = assignments.map((assignment) => {
      const submission = assignment.submissions.find(
        (sub) => sub.student.toString() === studentId.toString()
      )

      return {
        _id: assignment._id,
        title: assignment.title,
        description: assignment.description,
        instructions: assignment.instructions,
        course: assignment.course,
        totalMarks: assignment.totalMarks,
        dueDate: assignment.dueDate,
        attachments: assignment.attachmentUrl,
        createdAt: assignment.createdAt,
        updatedAt: assignment.updatedAt,
        submitted: Boolean(submission),
        submissionUrl: submission?.submissionUrl || null,
        submittedAt: submission?.submittedAt || null,
        marksObtained: submission?.marksObtained ?? null,
        feedback: submission?.feedback || null,
      }
    })

    res.status(200).json({
      success: true,
      count: formattedAssignments.length,
      assignments: formattedAssignments,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch assignments",
      error: error.message,
    })
  }
}

// =========================
// Get Attendance Report
// =========================
exports.getAttendanceReport = async (req, res) => {
  try {
    const { courseId } = req.params
    const studentId = req.user.profileId

    const attendance = await Attendance.find({
      student: studentId,
      course: courseId,
    }).populate("session", "title startTime")

    const totalSessions = attendance.length
    const presentDays = attendance.filter((a) => a.present).length
    const attendancePercentage =
      totalSessions > 0 ? ((presentDays / totalSessions) * 100).toFixed(2) : 0

    res.status(200).json({
      course: courseId,
      attendance,
      summary: {
        totalSessions,
        presentDays,
        absentDays: totalSessions - presentDays,
        attendancePercentage,
      },
    })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch attendance", error: error.message })
  }
}

// =========================
// Submit Complaint
// =========================
exports.submitComplaint = async (req, res) => {
  try {
    const { subject, description, courseId } = req.body
    const studentId = req.user.profileId
    const attachmentUrl = req.file?.path || null

    const newComplaint = new Complaint({
      student: studentId,
      course: courseId,
      subject,
      description,
      attachmentUrl,
    })

    await newComplaint.save()

    res.status(201).json({
      message: "Complaint submitted successfully",
      complaint: newComplaint,
    })
  } catch (error) {
    res.status(500).json({ message: "Failed to submit complaint", error: error.message })
  }
}

// =========================
// Get Payment History
// =========================
exports.getPaymentHistory = async (req, res) => {
  try {
    const studentId = req.user.profileId

    const payments = await Payment.find({ user: studentId })
      .populate("course", "title price")
      .sort({ createdAt: -1 })

    res.status(200).json({ payments })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch payment history", error: error.message })
  }
}

// =========================
// Get Completed Courses
// =========================
exports.getCompletedCourses = async (req, res) => {
  try {
    const studentId = req.user.profileId

    const completedEnrollments = await StudentCourse.find({
      studentId,
      status: "completed",
    }).populate({
      path: "courseId",
      populate: { path: "instructor", select: "name" },
    })

    const courses = completedEnrollments.map((e) => e.courseId)

    res.status(200).json({ courses })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch completed courses", error: error.message })
  }
}

// =========================
// Get Progress Report
// =========================
exports.getProgressReport = async (req, res) => {
  try {
    const { courseId } = req.params
    const studentId = req.user.profileId

    const assignments = await Assignment.find({ course: courseId })

    const progressData = {
      totalAssignments: assignments.length,
      submittedAssignments: 0,
      totalMarksObtained: 0,
      totalMaxMarks: 0,
    }

    assignments.forEach((assignment) => {
      const submission = assignment.submissions.find(
        (sub) => sub.student.toString() === studentId.toString()
      )

      if (submission) {
        progressData.submittedAssignments++
        if (submission.marksObtained) {
          progressData.totalMarksObtained += submission.marksObtained
        }
      }

      progressData.totalMaxMarks += assignment.maxMarks || 0
    })

    progressData.percentage =
      progressData.totalMaxMarks > 0
        ? ((progressData.totalMarksObtained / progressData.totalMaxMarks) * 100).toFixed(2)
        : 0

    res.status(200).json({ progressData })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch progress", error: error.message })
  }
}

// =========================
// Student Dashboard Stats
// =========================
exports.getStudentDashboardStats = async (req, res) => {
  try {
    const studentId = req.user.profileId

    // Total Enrolled Courses via StudentCourse
    const totalCourses = await StudentCourse.countDocuments({ studentId })

    // Completed Courses
    const completedCourses = await StudentCourse.countDocuments({
      studentId,
      status: "completed",
    })

    // Attendance
    const attendanceRecords = await Attendance.find({ student: studentId })
    const totalSessions = attendanceRecords.length
    const presentSessions = attendanceRecords.filter((a) => a.present).length
    const attendancePercentage =
      totalSessions > 0 ? ((presentSessions / totalSessions) * 100).toFixed(2) : 0

    // Assignments
    const enrollments = await StudentCourse.find({ studentId }).select("courseId")
    const enrolledCourseIds = enrollments.map((e) => e.courseId)
    const assignments = await Assignment.find({ course: { $in: enrolledCourseIds } })
    let submittedAssignments = 0
    assignments.forEach((assignment) => {
      const submission = assignment.submissions.find(
        (sub) => sub.student.toString() === studentId.toString()
      )
      if (submission) submittedAssignments++
    })

    res.status(200).json({
      stats: {
        totalCourses,
        completedCourses,
        attendance: {
          present: presentSessions,
          total: totalSessions,
          percentage: attendancePercentage,
        },
        assignments: {
          submitted: submittedAssignments,
          total: assignments.length,
        },
      },
    })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch dashboard stats", error: error.message })
  }
}

// =========================
// Get Student Sessions
// =========================
exports.getStudentSessions = async (req, res) => {
  try {
    const studentId = req.user.profileId

    const filter = await studentSessionFilter(studentId)
    if (!filter) {
      return res.status(200).json({ success: true, count: 0, sessions: [] })
    }

    const sessions = await fetchFormattedSessions(filter)

    res.status(200).json({
      success: true,
      count: sessions.length,
      sessions,
    })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch student sessions", error: error.message })
  }
}

// =========================
// Mark Student Attendance
// =========================
exports.markStudentAttendance = async (req, res) => {
  try {
    const { sessionId, attendanceData } = req.body
    // attendanceData = [{ studentId, present }]

    const session = await Session.findById(sessionId)
    if (!session) {
      return res.status(404).json({ message: "Session not found" })
    }

    if (!session.teacherAttendance?.checkInTime) {
      return res.status(400).json({ message: "Teacher has not checked in yet" })
    }
    if (session.teacherAttendance?.checkOutTime) {
      return res.status(400).json({ message: "This class has already ended" })
    }

    for (const record of attendanceData) {
      const existingIndex = session.studentAttendance.findIndex(
        (a) => a.student.toString() === record.studentId
      )

      if (existingIndex !== -1) {
        session.studentAttendance[existingIndex].present = record.present
        session.studentAttendance[existingIndex].markedAt = new Date()
      } else {
        session.studentAttendance.push({
          student: record.studentId,
          present: record.present,
          markedAt: new Date(),
        })
      }
    }

    await session.save()

    res.status(200).json({
      message: "Student attendance marked successfully",
      studentAttendance: session.studentAttendance,
    })
  } catch (error) {
    res.status(500).json({ message: "Failed to mark student attendance", error: error.message })
  }
}
