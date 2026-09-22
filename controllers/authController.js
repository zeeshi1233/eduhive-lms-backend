const mongoose = require("mongoose")
const Auth = require("../models/Auth")
const Teacher = require("../models/Teacher")
const Student = require("../models/Student")
const Admin = require("../models/Admin")
const { generateToken } = require("../utils/tokenGenerator")
const { buildTeacherPayload } = require("../utils/teacherPayload")
const { syncTeacherCourseAssignments } = require("../utils/courseAssignment")

// =========================
// REGISTER (ADMIN ONLY)
// =========================
exports.register = async (req, res) => {
  try {
    const { role, email, password } = req.body

    if (!["teacher", "student"].includes(role)) {
      return res.status(400).json({ message: "Invalid role. Must be 'teacher' or 'student'" })
    }

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" })
    }

    // Check if email already exists in Auth
    const existingAuth = await Auth.findOne({ email })
    if (existingAuth) {
      return res.status(400).json({ message: "Email already registered" })
    }

    // -------- TEACHER --------
    if (role === "teacher") {
      const payload = buildTeacherPayload(req.body)
      if (req.file) {
        payload.profileImage = req.file.path
      }

      const teacher = new Teacher(payload)
      await teacher.save()

      // Create Auth record
      const auth = new Auth({
        email,
        password,
        role: "teacher",
        refId: teacher._id,
        refModel: "Teacher",
      })
      await auth.save()

      if (payload.assignedCourses && payload.assignedCourses.length) {
        await syncTeacherCourseAssignments(teacher._id, [], payload.assignedCourses)
      }

      return res.status(201).json({
        message: "Teacher created successfully",
        teacher: {
          id: teacher._id,
          name: teacher.name,
          email,
        },
      })
    }

    // -------- STUDENT --------
    if (role === "student") {
      const {
        email: _email,
        password: _password,
        role: _role,
        enrolledCourses: _enrolledCourses,
        "enrolledCourses[]": _enrolledCoursesArr,
        ...rawStudent
      } = req.body

      const studentData = { ...rawStudent }

      if (req.file) {
        studentData.profileImage = req.file.path
      }

      // Normalize enums / required legacy fields so FormData registration succeeds
      if (studentData.gender) {
        studentData.gender = String(studentData.gender).trim().toLowerCase()
      }
      if (!studentData.address) studentData.address = "N/A"
      if (!studentData.dateOfBirth) studentData.dateOfBirth = new Date("2000-01-01")
      if (!studentData.feePlan) studentData.feePlan = "monthly"
      if (studentData.totalFees === undefined || studentData.totalFees === "") {
        studentData.totalFees = 0
      } else {
        studentData.totalFees = Number(studentData.totalFees) || 0
      }
      if (studentData.admissionDate) {
        studentData.admissionDate = new Date(studentData.admissionDate)
      }

      const student = new Student(studentData)
      await student.save()

      const auth = new Auth({
        email,
        password,
        role: "student",
        refId: student._id,
        refModel: "Student",
      })
      await auth.save()

      return res.status(201).json({
        message: "Student created successfully",
        student: {
          id: student._id,
          name: student.name,
          email,
        },
      })
    }
  } catch (error) {
    res.status(500).json({
      message: "Registration failed",
      error: error.message,
    })
  }
}

// =========================
// TEACHER LOGIN
// =========================
exports.loginTeacher = async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" })
    }

    const auth = await Auth.findOne({ email, role: "teacher" }).select("+password")
    if (!auth) {
      return res.status(401).json({ message: "Invalid email or password" })
    }

    const isMatch = await auth.comparePassword(password)
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" })
    }

    const teacher = await Teacher.findById(auth.refId)
    if (!teacher) {
      return res.status(404).json({ message: "Teacher profile not found" })
    }

    const token = generateToken(auth._id, "teacher", teacher._id)

    res.status(200).json({
      message: "Teacher login successful",
      token,
      user: {
        id: auth._id,
        profileId: teacher._id,
        name: teacher.name,
        email: auth.email,
        role: "teacher",
        profileImage: teacher.profileImage,
      },
    })
  } catch (error) {
    res.status(500).json({ message: "Login failed", error: error.message })
  }
}

// =========================
// STUDENT LOGIN
// =========================
exports.loginStudent = async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" })
    }

    const auth = await Auth.findOne({ email, role: "student" }).select("+password")
    if (!auth) {
      return res.status(401).json({ message: "Invalid email or password" })
    }

    const isMatch = await auth.comparePassword(password)
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" })
    }

    const student = await Student.findById(auth.refId)
    if (!student) {
      return res.status(404).json({ message: "Student profile not found" })
    }

    const token = generateToken(auth._id, "student", student._id)

    res.status(200).json({
      message: "Student login successful",
      token,
      user: {
        id: auth._id,
        profileId: student._id,
        name: student.name,
        email: auth.email,
        role: "student",
        profileImage: student.profileImage,
      },
    })
  } catch (error) {
    res.status(500).json({ message: "Login failed", error: error.message })
  }
}

// =========================
// CURRENT USER (via JWT)
// =========================
exports.getCurrentUser = async (req, res) => {
  try {
    const { id, role } = req.user

    // Auth record fetch karo
    const auth = await Auth.findById(id)
    if (!auth) {
      return res.status(404).json({ message: "Auth record not found" })
    }

    let profile

    if (role === "teacher") {
      profile = await Teacher.findById(auth.refId)
        .populate("assignedCourses", "title description duration price courseImage")
    }

    if (role === "student") {
      profile = await Student.findById(auth.refId)
    }

    if (role === "admin") {
      profile = await Admin.findById(auth.refId)
    }

    if (!profile) {
      return res.status(404).json({ message: "User profile not found" })
    }

    res.status(200).json({
      user: {
        id: auth._id,
        profileId: profile._id,
        email: auth.email,
        role: auth.role,
        isActive: auth.isActive,
        ...profile.toObject(),
      },
    })
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch user",
      error: error.message,
    })
  }
}
