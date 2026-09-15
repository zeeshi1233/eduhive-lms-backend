const Teacher = require("../models/Teacher")
const Student = require("../models/Student")
const Course = require("../models/Course")
const Transaction = require("../models/Transaction")
const Admin = require("../models/Admin")
const Auth = require("../models/Auth")
const StudentCourse = require("../models/StudentCourse")
const { generateToken } = require("../utils/tokenGenerator")
const { buildTeacherPayload } = require("../utils/teacherPayload")
const { syncTeacherCourseAssignments } = require("../utils/courseAssignment")
const { default: mongoose } = require("mongoose")
const Session = require("../models/Session")
const {
  ALLOWED_DURATIONS,
  ALLOWED_TYPES,
  computeEndTime,
  normalizeStatus,
  isAllowedStatus,
  generateCourseCode,
  fetchFormattedSessions,
  fetchFormattedSessionById,
  studentSessionFilter,
} = require("../utils/sessionHelpers")

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// =========================
// Admin Login
// =========================
exports.adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body

    const auth = await Auth.findOne({ email, role: "admin" }).select("+password")
    if (!auth) {
      return res.status(401).json({ message: "Invalid email or password" })
    }

    const isPasswordValid = await auth.comparePassword(password)
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid email or password" })
    }

    const admin = await Admin.findById(auth.refId)

    const token = generateToken(auth._id, "admin", admin?._id)

    res.status(200).json({
      message: "Admin login successful",
      token,
      admin: {
        id: auth._id,
        profileId: admin?._id,
        name: admin?.name,
        email: auth.email,
        role: "admin",
      },
    })
  } catch (error) {
    res.status(500).json({ message: "Admin login failed", error: error.message })
  }
}

// =========================
// Dashboard Stats
// =========================
exports.getDashboardStats = async (req, res) => {
  try {
    const totalStudents = await Student.countDocuments()
    const totalTeachers = await Teacher.countDocuments()
    const totalCourses = await Course.countDocuments()

    const totalRevenue = await Transaction.aggregate([
      { $match: { type: "payment", status: "completed" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])

    const recentTransactions = await Transaction.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("user", "name email")
      .populate("course", "title")

    res.status(200).json({
      stats: {
        totalStudents,
        totalTeachers,
        totalCourses,
        totalRevenue: totalRevenue[0]?.total || 0,
      },
      recentTransactions,
    })
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch dashboard stats",
      error: error.message,
    })
  }
}

// =========================
// Teachers
// =========================
exports.getTeachers = async (req, res) => {
  try {
    const teachers = await Teacher.find().populate(
      "assignedCourses",
      "title description duration price courseImage"
    )

    // Auth se email bhi attach karo
    const teacherIds = teachers.map((t) => t._id)
    const authRecords = await Auth.find({ refId: { $in: teacherIds }, role: "teacher" }).select(
      "email refId isActive"
    )

    const authMap = {}
    authRecords.forEach((a) => {
      authMap[String(a.refId)] = a
    })

    const result = teachers.map((teacher) => {
      const authData = authMap[String(teacher._id)] || {}
      return {
        ...teacher.toObject(),
        email: authData.email || null,
        isActive: authData.isActive ?? teacher.isActive,
      }
    })

    res.status(200).json({ teachers: result })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch teachers", error: error.message })
  }
}

exports.updateTeacher = async (req, res) => {
  try {
    const { id } = req.params
    const teacher = await Teacher.findById(id)
    if (!teacher) return res.status(404).json({ message: "Teacher not found" })

    const previousAssignedCourses = teacher.assignedCourses || []
    const payload = buildTeacherPayload(req.body)
    if (req.file) {
      payload.profileImage = req.file.path
    }

    Object.assign(teacher, payload)
    await teacher.save()

    if (payload.assignedCourses !== undefined) {
      await syncTeacherCourseAssignments(
        teacher._id,
        previousAssignedCourses,
        payload.assignedCourses
      )
    }

    // Email update karo agar diya gaya ho
    if (req.body.email) {
      await Auth.findOneAndUpdate(
        { refId: id, role: "teacher" },
        { email: req.body.email }
      )
    }

    const updatedTeacher = await Teacher.findById(id).populate(
      "assignedCourses",
      "title description duration price courseImage"
    )

    res.status(200).json({ message: "Teacher updated successfully", teacher: updatedTeacher })
  } catch (error) {
    res.status(500).json({ message: "Failed to update teacher", error: error.message })
  }
}

exports.deleteTeacher = async (req, res) => {
  try {
    const { id } = req.params
    await Teacher.findByIdAndDelete(id)
    // Auth record bhi delete karo
    await Auth.findOneAndDelete({ refId: id, role: "teacher" })
    res.status(200).json({ message: "Teacher deleted successfully" })
  } catch (error) {
    res.status(500).json({ message: "Failed to delete teacher", error: error.message })
  }
}

// =========================
// Students
// =========================
exports.getStudents = async (req, res) => {
  try {
    const students = await Student.find()

    // Auth se emails attach karo
    const studentIds = students.map((s) => s._id)
    const authRecords = await Auth.find({ refId: { $in: studentIds }, role: "student" }).select(
      "email refId isActive"
    )

    const authMap = {}
    authRecords.forEach((a) => {
      authMap[String(a.refId)] = a
    })

    // StudentCourse se enrolled courses info attach karo
    const enrollments = await StudentCourse.find({
      studentId: { $in: studentIds },
    }).populate("courseId", "title")

    const enrollMap = {}
    enrollments.forEach((e) => {
      if (!enrollMap[String(e.studentId)]) enrollMap[String(e.studentId)] = []
      enrollMap[String(e.studentId)].push(e)
    })

    const result = students.map((student) => {
      const authData = authMap[String(student._id)] || {}
      return {
        ...student.toObject(),
        email: authData.email || null,
        isActive: authData.isActive ?? student.isActive,
        enrolledCourses: (enrollMap[String(student._id)] || []).map((e) => ({
          course: e.courseId,
          status: e.status,
          enrolledAt: e.enrolledAt,
        })),
      }
    })

    res.status(200).json({ students: result })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch students", error: error.message })
  }
}

exports.updateStudent = async (req, res) => {
  try {
    const { id } = req.params

    const { email, password, role, ...studentData } = req.body

    const student = await Student.findByIdAndUpdate(id, studentData, {
      new: true,
    })
    if (!student) return res.status(404).json({ message: "Student not found" })

    // Email update karo agar diya gaya ho
    if (email) {
      await Auth.findOneAndUpdate({ refId: id, role: "student" }, { email })
    }

    res.status(200).json({ message: "Student updated successfully", student })
  } catch (error) {
    res.status(500).json({ message: "Failed to update student", error: error.message })
  }
}

exports.deleteStudent = async (req, res) => {
  try {
    const { id } = req.params
    await Student.findByIdAndDelete(id)
    // Auth record bhi delete karo
    await Auth.findOneAndDelete({ refId: id, role: "student" })
    // StudentCourse records bhi delete karo
    await StudentCourse.deleteMany({ studentId: id })
    res.status(200).json({ message: "Student deleted successfully" })
  } catch (error) {
    res.status(500).json({ message: "Failed to delete student", error: error.message })
  }
}

// =========================
// Courses
// =========================
exports.createCourse = async (req, res) => {
  try {
    const {
      serialNumber,
      title,
      description,
      feePKR,
      feeUSD,
      perHourFee,
      board,
      otherBoard,
      code,
      courseCode,
    } = req.body
    const courseImage = req.file?.path || null
    const resolvedBoard = board === "Other" ? otherBoard : board
    const resolvedCode =
      code || courseCode || serialNumber || generateCourseCode(title, resolvedBoard)

    if (title && resolvedBoard) {
      const duplicate = await Course.findOne({
        title: new RegExp(`^${escapeRegex(title)}$`, "i"),
        board: new RegExp(`^${escapeRegex(resolvedBoard)}$`, "i"),
      })
      if (duplicate) {
        return res.status(409).json({
          message: "A course with this title and board already exists",
        })
      }
    }

    const codeTaken = await Course.findOne({
      $or: [{ code: resolvedCode }, { serialNumber: resolvedCode }],
    })
    if (codeTaken) {
      return res.status(409).json({ message: "Course code must be unique" })
    }

    const newCourse = new Course({
      serialNumber: serialNumber || resolvedCode,
      code: resolvedCode,
      title,
      description,
      feePKR,
      feeUSD,
      perHourFee,
      board: resolvedBoard,
      otherBoard,
      courseImage,
    })
    await newCourse.save()

    res.status(201).json({ message: "Course created successfully", course: newCourse })
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Course code must be unique" })
    }
    res.status(500).json({ message: "Failed to create course", error: error.message })
  }
}

exports.getCourses = async (req, res) => {
  try {
    const courses = await Course.find().populate("instructor", "name email")

    // Har course ke liye StudentCourse se enrolled students count nikalo
    const courseIds = courses.map((c) => c._id)
    const enrollments = await StudentCourse.find({ courseId: { $in: courseIds } })
      .populate("studentId", "name")

    const enrollMap = {}
    enrollments.forEach((e) => {
      if (!enrollMap[String(e.courseId)]) enrollMap[String(e.courseId)] = []
      enrollMap[String(e.courseId)].push(e.studentId)
    })

    const result = courses.map((course) => {
      const obj = course.toObject()
      const resolvedCode = obj.code || obj.serialNumber || ""
      return {
        ...obj,
        code: resolvedCode,
        courseCode: resolvedCode,
        students: enrollMap[String(course._id)] || [],
        studentCount: (enrollMap[String(course._id)] || []).length,
      }
    })

    res.status(200).json({ courses: result })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch courses", error: error.message })
  }
}

exports.getCourseById = async (req, res) => {
  try {
    const { id } = req.params
    let course = mongoose.Types.ObjectId.isValid(id) ? await Course.findById(id).populate("instructor", "name email") : null

    if (!course) {
      course = await Course.findOne({
        $or: [{ code: id }, { serialNumber: id }],
      }).populate("instructor", "name email")
    }

    if (!course) return res.status(404).json({ message: "Course not found" })

    const enrollments = await StudentCourse.find({ courseId: course._id }).populate("studentId", "name")
    const students = enrollments.map((e) => e.studentId)
    const obj = course.toObject()
    const resolvedCode = obj.code || obj.serialNumber || ""

    res.status(200).json({
      course: {
        ...obj,
        code: resolvedCode,
        courseCode: resolvedCode,
        students,
        studentCount: students.length,
      },
    })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch course", error: error.message })
  }
}

exports.updateCourse = async (req, res) => {
  try {
    const { id } = req.params
    const course = await Course.findById(id)
    if (!course) return res.status(404).json({ message: "Course not found" })

    const {
      serialNumber,
      title,
      description,
      feePKR,
      feeUSD,
      perHourFee,
      board,
      otherBoard,
      code,
      courseCode,
      isActive,
    } = req.body

    const nextTitle = title ?? course.title
    const resolvedBoard =
      board === "Other" ? otherBoard : board !== undefined ? board : course.board
    const resolvedCode =
      code || courseCode || serialNumber || course.code || course.serialNumber

    if (nextTitle && resolvedBoard) {
      const duplicate = await Course.findOne({
        _id: { $ne: course._id },
        title: new RegExp(`^${escapeRegex(nextTitle)}$`, "i"),
        board: new RegExp(`^${escapeRegex(resolvedBoard)}$`, "i"),
      })
      if (duplicate) {
        return res.status(409).json({
          message: "A course with this title and board already exists",
        })
      }
    }

    if (resolvedCode) {
      const codeTaken = await Course.findOne({
        _id: { $ne: course._id },
        $or: [{ code: resolvedCode }, { serialNumber: resolvedCode }],
      })
      if (codeTaken) {
        return res.status(409).json({ message: "Course code must be unique" })
      }
    }

    if (title !== undefined) course.title = title
    if (description !== undefined) course.description = description
    if (feePKR !== undefined) course.feePKR = feePKR
    if (feeUSD !== undefined) course.feeUSD = feeUSD
    if (perHourFee !== undefined) course.perHourFee = perHourFee
    if (resolvedBoard !== undefined) course.board = resolvedBoard
    if (otherBoard !== undefined) course.otherBoard = otherBoard
    if (isActive !== undefined) course.isActive = isActive
    if (req.file?.path) course.courseImage = req.file.path
    if (resolvedCode) {
      course.code = resolvedCode
      course.serialNumber = serialNumber || course.serialNumber || resolvedCode
    }

    await course.save()

    res.status(200).json({ message: "Course updated successfully", course })
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Course code must be unique" })
    }
    res.status(500).json({ message: "Failed to update course", error: error.message })
  }
}

exports.deleteCourse = async (req, res) => {
  try {
    const { id } = req.params
    await Course.findByIdAndDelete(id)
    // Is course ki sari enrollments bhi delete karo
    await StudentCourse.deleteMany({ courseId: id })
    res.status(200).json({ message: "Course deleted successfully" })
  } catch (error) {
    res.status(500).json({ message: "Failed to delete course", error: error.message })
  }
}

// Assign teacher to course
exports.assignTeacherToCourse = async (req, res) => {
  try {
    const { courseId, teacherId } = req.body
    const teacher = await Teacher.findById(teacherId)
    if (!teacher) return res.status(404).json({ message: "Teacher not found" })

    const previousAssignedCourses = teacher.assignedCourses || []
    const targetCourseIds = Array.from(
      new Set([...previousAssignedCourses.map(String), String(courseId)])
    )

    teacher.assignedCourses = targetCourseIds
    await teacher.save()

    await syncTeacherCourseAssignments(teacher._id, previousAssignedCourses, targetCourseIds)

    const course = await Course.findById(courseId).populate("instructor", "name")
    const updatedTeacher = await Teacher.findById(teacherId).populate(
      "assignedCourses",
      "title description duration price courseImage"
    )

    res.status(200).json({
      message: "Teacher assigned to course successfully",
      course,
      teacher: updatedTeacher,
    })
  } catch (error) {
    res.status(500).json({ message: "Failed to assign teacher", error: error.message })
  }
}

// =========================
// Transactions & Payroll
// =========================
exports.getTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find()
      .populate("user", "name email")
      .populate("course", "title price")
      .sort({ createdAt: -1 })

    res.status(200).json({ transactions })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch transactions", error: error.message })
  }
}

exports.getPayroll = async (req, res) => {
  try {
    const payroll = await Transaction.find({ type: "payroll" })
      .populate("user", "name email")
      .sort({ createdAt: -1 })
    res.status(200).json({ payroll })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch payroll", error: error.message })
  }
}

exports.processTeacherPayment = async (req, res) => {
  try {
    const { teacherId, amount, description } = req.body
    const newPayment = new Transaction({
      user: teacherId,
      amount,
      type: "payroll",
      status: "completed",
      description,
    })
    await newPayment.save()
    res.status(201).json({
      message: "Teacher payment processed successfully",
      payment: newPayment,
    })
  } catch (error) {
    res.status(500).json({ message: "Failed to process payment", error: error.message })
  }
}

exports.getRevenueSummary = async (req, res) => {
  try {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const totalRevenue = await Transaction.aggregate([
      { $match: { type: "payment", status: "completed" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])

    const pendingFees = await Transaction.aggregate([
      { $match: { type: "payment", status: "pending" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])

    const collectedToday = await Transaction.aggregate([
      {
        $match: {
          type: "payment",
          status: "completed",
          createdAt: { $gte: todayStart },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])

    res.status(200).json({
      totalRevenue: totalRevenue[0]?.total || 0,
      pendingFees: pendingFees[0]?.total || 0,
      collectedToday: collectedToday[0]?.total || 0,
    })
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch revenue summary",
      error: error.message,
    })
  }
}

exports.getRevenueDetails = async (req, res) => {
  try {
    const transactions = await Transaction.find({ type: "payment" })
      .populate("user", "name")
      .populate("course", "title price")
      .sort({ createdAt: -1 })

    const revenueDetails = transactions.map((tx, index) => ({
      sl: index + 1,
      studentName: tx.user?.name,
      courseName: tx.course?.title,
      feePaid: tx.status === "completed" ? tx.amount : 0,
      feePending: tx.status === "pending" ? tx.amount : 0,
      status: tx.status,
    }))

    res.status(200).json({ revenueDetails })
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch revenue details",
      error: error.message,
    })
  }
}

exports.getTeacherPayrollById = async (req, res) => {
  try {
    const { teacherId } = req.params

    if (!mongoose.Types.ObjectId.isValid(teacherId)) {
      return res.status(400).json({ message: "Invalid teacher ID" })
    }

    const teacher = await Teacher.findById(teacherId).select("name totalSalary")

    if (!teacher) {
      return res.status(404).json({ message: "Teacher not found" })
    }

    const authRecord = await Auth.findOne({ refId: teacherId, role: "teacher" }).select("email")

    const payrollAgg = await Transaction.aggregate([
      {
        $match: {
          user: new mongoose.Types.ObjectId(teacherId),
          type: "payroll",
          status: "completed",
        },
      },
      {
        $group: {
          _id: null,
          totalPaid: { $sum: "$amount" },
          lastPayment: { $max: "$createdAt" },
        },
      },
    ])

    const paid = payrollAgg[0]?.totalPaid || 0
    const lastPayment = payrollAgg[0]?.lastPayment || null
    const totalSalary = teacher.totalSalary || 0
    const pending = Math.max(totalSalary - paid, 0)

    const payrollHistory = await Transaction.find({
      user: teacherId,
      type: "payroll",
    }).sort({ createdAt: -1 })

    res.status(200).json({
      teacher: {
        id: teacher._id,
        name: teacher.name,
        email: authRecord?.email || null,
        totalSalary,
        paid,
        pending,
        lastPayment,
      },
      payrollHistory,
    })
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch teacher payroll",
      error: error.message,
    })
  }
}

// =========================
// Sessions (Admin View)
// =========================
exports.getSessionsByTeacherForPayroll = async (req, res) => {
  try {
    const { teacherId } = req.params

    if (!mongoose.Types.ObjectId.isValid(teacherId)) {
      return res.status(400).json({ message: "Invalid teacher ID" })
    }

    const teacher = await Teacher.findById(teacherId).select("name")
    if (!teacher) {
      return res.status(404).json({ message: "Teacher not found" })
    }

    const authRecord = await Auth.findOne({ refId: teacherId, role: "teacher" }).select("email")

    const sessions = await Session.find({ instructor: teacherId })
      .populate("course", "title")
      .sort({ startTime: -1 })

    let totalSalary = 0
    let paidSalary = 0

    const formattedSessions = sessions.map((s, index) => {
      totalSalary += s.perClassFee || 0
      if (s.isPaid) paidSalary += s.perClassFee || 0

      return {
        sl: index + 1,
        sessionId: s._id,
        title: s.title,
        course: s.course?.title,
        date: s.startTime,
        perClassFee: s.perClassFee,
        isPaid: s.isPaid,
        paidAt: s.paidAt,
      }
    })

    res.status(200).json({
      teacher: {
        id: teacher._id,
        name: teacher.name,
        email: authRecord?.email || null,
      },
      summary: {
        totalSalary,
        paidSalary,
        pendingSalary: totalSalary - paidSalary,
      },
      sessions: formattedSessions,
    })
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch sessions",
      error: error.message,
    })
  }
}

exports.payTeacherSalaryBySession = async (req, res) => {
  try {
    const { teacherId, sessionId } = req.body

    if (!teacherId || !sessionId) {
      return res.status(400).json({ message: "Teacher ID & session ID required" })
    }

    const session = await Session.findOne({
      _id: sessionId,
      instructor: teacherId,
      isPaid: false,
    })

    if (!session) {
      return res.status(400).json({ message: "No unpaid session found" })
    }

    session.isPaid = true
    session.paidAt = new Date()
    await session.save()

    const transaction = await Transaction.create({
      user: teacherId,
      amount: session.perClassFee,
      type: "payroll",
      status: "completed",
      description: `Salary payment for session ${session._id}`,
    })

    res.status(201).json({
      message: "Salary paid successfully",
      totalPaid: session.perClassFee,
      transaction,
    })
  } catch (error) {
    res.status(500).json({
      message: "Failed to pay salary",
      error: error.message,
    })
  }
}

exports.createSession = async (req, res) => {
  try {
    const {
      title,
      courseId,
      teacherId,
      startTime,
      endTime,
      topic,
      type,
      duration,
      description,
      status,
    } = req.body

    if (!title || !courseId || !teacherId || !startTime) {
      return res.status(400).json({
        message: "title, courseId, teacherId and startTime are required",
      })
    }

    if (!mongoose.Types.ObjectId.isValid(courseId) || !mongoose.Types.ObjectId.isValid(teacherId)) {
      return res.status(400).json({ message: "Valid courseId and teacherId are required" })
    }

    const parsedStart = new Date(startTime)
    if (Number.isNaN(parsedStart.getTime())) {
      return res.status(400).json({ message: "Invalid startTime" })
    }

    if (duration && !ALLOWED_DURATIONS.includes(duration)) {
      return res.status(400).json({
        message: `duration must be one of: ${ALLOWED_DURATIONS.join(", ")}`,
      })
    }

    if (type && !ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({
        message: "type must be Regular Class or Extra Class",
      })
    }

    const resolvedDuration = duration || "60 mins"
    const resolvedEndTime = endTime ? new Date(endTime) : computeEndTime(parsedStart, resolvedDuration)
    if (!resolvedEndTime || Number.isNaN(new Date(resolvedEndTime).getTime())) {
      return res.status(400).json({ message: "Unable to determine endTime from startTime and duration" })
    }

    const resolvedStatus = normalizeStatus(status || "Scheduled")
    if (!isAllowedStatus(resolvedStatus)) {
      return res.status(400).json({ message: "Invalid status" })
    }

    const [course, teacher] = await Promise.all([
      Course.findById(courseId),
      Teacher.findById(teacherId),
    ])
    if (!course) return res.status(404).json({ message: "Course not found" })
    if (!teacher) return res.status(404).json({ message: "Teacher not found" })

    const newSession = new Session({
      title,
      course: courseId,
      instructor: teacherId,
      startTime: parsedStart,
      endTime: resolvedEndTime,
      topic: topic || "",
      type: type || "Regular Class",
      duration: resolvedDuration,
      description: description || "",
      status: resolvedStatus,
    })

    await newSession.save()
    newSession.roomName = `eduhive-class-${newSession._id}`
    newSession.meetingLink = `/classroom/${newSession._id}`
    await newSession.save()
    const session = await fetchFormattedSessionById(newSession._id)

    res.status(201).json({
      message: "Session created",
      session,
    })
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: error.message })
    }
    res.status(500).json({
      message: "Failed to create session",
      error: error.message,
    })
  }
}

exports.getAllSessions = async (req, res) => {
  try {
    const { teacherId, courseId } = req.query

    const filter = {}
    if (teacherId) filter.instructor = teacherId
    if (courseId) filter.course = courseId

    const sessions = await fetchFormattedSessions(filter)

    res.status(200).json({
      success: true,
      count: sessions.length,
      sessions,
    })
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch sessions",
      error: error.message,
    })
  }
}

exports.updateSession = async (req, res) => {
  try {
    const { id } = req.params
    const { status, type, notConductedReason } = req.body

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid session id" })
    }

    const updates = {}

    if (status !== undefined && status !== null && status !== "") {
      const resolvedStatus = normalizeStatus(status)
      if (!isAllowedStatus(resolvedStatus)) {
        return res.status(400).json({
          message: "status must be Scheduled, conducted, not_conducted or Cancelled",
        })
      }
      updates.status = resolvedStatus
    }

    if (type !== undefined && type !== null && type !== "") {
      const allowedTypes = ["Regular Class", "Extra Class"]
      const resolvedType = String(type).toLowerCase().includes("extra")
        ? "Extra Class"
        : "Regular Class"
      if (!allowedTypes.includes(resolvedType)) {
        return res.status(400).json({ message: "type must be Regular Class or Extra Class" })
      }
      updates.type = resolvedType
    }

    if (notConductedReason !== undefined) {
      const allowedReasons = ["Teacher Not Present", "Student Not Present", "Others"]
      const reason = String(notConductedReason || "").trim()
      if (reason && !allowedReasons.includes(reason)) {
        return res.status(400).json({
          message:
            "notConductedReason must be Teacher Not Present, Student Not Present, or Others",
        })
      }
      if (reason) updates.notConductedReason = reason
      else updates.$unset = { ...(updates.$unset || {}), notConductedReason: 1 }
    }

    if (updates.status && updates.status !== "not_conducted") {
      updates.$unset = { ...(updates.$unset || {}), notConductedReason: 1 }
      delete updates.notConductedReason
    }

    if (updates.status === "not_conducted" && !updates.notConductedReason) {
      updates.notConductedReason = "Others"
      if (updates.$unset) delete updates.$unset.notConductedReason
    }

    if (!Object.keys(updates).filter((k) => k !== "$unset").length && !updates.$unset) {
      return res.status(400).json({
        message: "Provide status, type, and/or notConductedReason to update",
      })
    }

    const unset = updates.$unset
    delete updates.$unset

    const updateQuery = {}
    if (Object.keys(updates).length) updateQuery.$set = updates
    if (unset) updateQuery.$unset = unset

    const updated = await Session.findByIdAndUpdate(id, updateQuery, {
      new: true,
      runValidators: true,
    })

    if (!updated) {
      return res.status(404).json({ message: "Session not found" })
    }

    const session = await fetchFormattedSessionById(updated._id)

    res.status(200).json({
      message: "Session updated",
      session,
    })
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: error.message })
    }
    res.status(500).json({
      message: "Failed to update session",
      error: error.message,
    })
  }
}

exports.listSessionsForCurrentUser = async (req, res) => {
  try {
    const { teacherId, courseId } = req.query
    const filter = {}
    const role = req.user.role

    if (role === "admin") {
      // Admin can see all sessions; optional query filters still apply
      if (teacherId) filter.instructor = teacherId
    } else if (role === "teacher") {
      // Only sessions assigned to this teacher
      filter.instructor = req.user.profileId
    } else if (role === "student") {
      // Only sessions for courses this student is enrolled in
      const studentFilter = await studentSessionFilter(req.user.profileId)
      if (!studentFilter) {
        return res.status(200).json({ success: true, count: 0, sessions: [] })
      }
      Object.assign(filter, studentFilter)
    } else {
      return res.status(403).json({ message: "Access denied" })
    }

    if (courseId) filter.course = courseId

    const sessions = await fetchFormattedSessions(filter)

    res.status(200).json({
      success: true,
      count: sessions.length,
      sessions,
    })
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch sessions",
      error: error.message,
    })
  }
}

// =========================
// Enroll Student in Course (Admin)
// =========================
exports.enrollStudentInCourse = async (req, res) => {
  try {
    const { studentId, courseId, status } = req.body

    const student = await Student.findById(studentId)
    if (!student) return res.status(404).json({ message: "Student not found" })

    const course = await Course.findById(courseId)
    if (!course) return res.status(404).json({ message: "Course not found" })

    // Check already enrolled
    const existing = await StudentCourse.findOne({ studentId, courseId })
    if (existing) {
      return res.status(400).json({ message: "Student already enrolled in this course" })
    }

    const enrollment = await StudentCourse.create({
      studentId,
      courseId,
      status: status || "active",
    })

    res.status(201).json({
      message: "Student enrolled successfully",
      enrollment,
    })
  } catch (error) {
    res.status(500).json({ message: "Failed to enroll student", error: error.message })
  }
}

// =========================
// Update Enrollment Status (Admin)
// =========================
exports.updateEnrollmentStatus = async (req, res) => {
  try {
    const { enrollmentId } = req.params
    const { status } = req.body

    const enrollment = await StudentCourse.findByIdAndUpdate(
      enrollmentId,
      { status },
      { new: true }
    )
      .populate("studentId", "name")
      .populate("courseId", "title")

    if (!enrollment) {
      return res.status(404).json({ message: "Enrollment not found" })
    }

    res.status(200).json({ message: "Enrollment status updated", enrollment })
  } catch (error) {
    res.status(500).json({ message: "Failed to update enrollment", error: error.message })
  }
}
