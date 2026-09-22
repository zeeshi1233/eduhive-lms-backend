
const Teacher = require("../models/Teacher");

// Teacher-level: generate Google OAuth URL
exports.teacherGoogleAuthUrl = (req, res) => {
  const { getTeacherGoogleAuthUrl } = require("../utils/googleMeet");
  const teacherId = req.user?.profileId || req.query.teacherId;
  const authUrl = getTeacherGoogleAuthUrl(teacherId);
  res.status(200).json({ authUrl });
};

// Teacher-level: handle OAuth callback — saves teacher's refresh token to DB
exports.teacherGoogleConnect = async (req, res) => {
  try {
    const { code, state: teacherId } = req.query;
    if (!code || !teacherId) {
      return res.status(400).json({ message: "Missing code or teacher state" });
    }

    const { getGoogleOAuthClient } = require("../utils/googleMeet");
    const oauth2Client = getGoogleOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      return res.status(400).json({
        message: "No refresh_token received. Please ensure you are granting offline access.",
      });
    }

    // Get teacher's email from Google
    oauth2Client.setCredentials(tokens);
    const oauth2 = require("googleapis").google.oauth2({ version: "v2", auth: oauth2Client });
    const me = await oauth2.userinfo.get();
    const googleEmail = me.data.email || "";

    await Teacher.findByIdAndUpdate(teacherId, {
      googleRefreshToken: tokens.refresh_token,
      googleEmail,
      googleConnected: true,
    });

    res.status(200).json({
      message: `Google account connected! Teacher is now the host for all their sessions. (Google Email: ${googleEmail})`,
      googleEmail,
    });
  } catch (error) {
    console.error("Teacher Google connect error:", error);
    res.status(500).json({ message: "Failed to connect Google account", error: error.message });
  }
};
const mongoose = require("mongoose");
const StudentCourse = require("../models/StudentCourse");
const Student = require("../models/Student");
const { fetchFormattedSessionById } = require("../utils/sessionHelpers");
const {
  classroomPath,
  getParticipantName,
  loadSessionForClassroom,
  teacherCheckIn,
  teacherCheckOut,
  markStudentPresent,
  markStudentLeft,
  isClassLive,
} = require("../utils/classroom");
const { getGoogleOAuthClient, syncGoogleMeetAttendance } = require("../utils/googleMeet");

async function assertSessionAccess(user, session) {
  if (user.role === "admin") return true;

  if (user.role === "teacher") {
    if (String(session.instructor) !== String(user.profileId)) {
      const error = new Error("You are not assigned to this class");
      error.statusCode = 403;
      error.code = "NOT_ASSIGNED";
      throw error;
    }
    return true;
  }

  if (user.role === "student") {
    const student = await Student.findById(user.profileId).select("assignedTeachers");
    if (!student) {
      const error = new Error("Student profile not found");
      error.statusCode = 404;
      error.code = "STUDENT_NOT_FOUND";
      throw error;
    }

    const sessionTeacherId = String(session.teacher || session.instructor || "");
    const assignedTeachers = (student.assignedTeachers || []).map((t) =>
      String(t && t._id ? t._id : t)
    );

    if (!sessionTeacherId || !assignedTeachers.includes(sessionTeacherId)) {
      const error = new Error("You are not assigned to this teacher's class");
      error.statusCode = 403;
      error.code = "NOT_ASSIGNED";
      throw error;
    }

    const enrolled = await StudentCourse.findOne({
      studentId: user.profileId,
      courseId: session.course,
      status: { $ne: "dropped" },
    });
    if (!enrolled) {
      const error = new Error("You are not enrolled in this class");
      error.statusCode = 403;
      error.code = "NOT_ENROLLED";
      throw error;
    }
    return true;
  }

  const error = new Error("Access denied");
  error.statusCode = 403;
  throw error;
}

exports.joinClassroom = async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: "Valid sessionId is required" });
    }

    const session = await loadSessionForClassroom(sessionId);
    await assertSessionAccess(req.user, session);

    if (session.status === "Cancelled") {
      return res.status(400).json({ message: "This class was cancelled", code: "CLASS_CANCELLED" });
    }

    if (req.user.role === "teacher") {
      await teacherCheckIn(session);
    } else if (req.user.role === "student") {
      // Connect directly to the video room without waiting for host to admit
      if (session.teacherAttendance?.checkOutTime || session.status === "completed" || session.status === "conducted") {
        return res.status(400).json({ message: "This class has already ended", code: "CLASS_ENDED" });
      }
      await markStudentPresent(session, req.user.profileId);
    } else if (session.teacherAttendance?.checkOutTime) {
      return res.status(400).json({ message: "This class has already ended", code: "CLASS_ENDED" });
    }

    const displayName = await getParticipantName(req.user, req.body.participantName);
    const formatted = await fetchFormattedSessionById(session._id);

    res.status(200).json({
      googleMeetLink: session.googleMeetLink,
      googleMeetSpace: session.googleMeetSpace,
      roomName: session.roomName,
      classroomPath: classroomPath(session._id),
      participantName: displayName,
      role: req.user.role,
      teacherCheckedIn: Boolean(session.teacherAttendance?.checkInTime),
      teacherCheckInTime: session.teacherAttendance?.checkInTime || null,
      teacherCheckOutTime: session.teacherAttendance?.checkOutTime || null,
      session: formatted,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message || "Failed to join classroom", code: error.code });
  }
};

exports.leaveClassroom = async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: "Valid sessionId is required" });
    }

    const session = await loadSessionForClassroom(sessionId);
    await assertSessionAccess(req.user, session);

    if (req.user.role === "teacher") {
      await teacherCheckOut(session);
    } else if (req.user.role === "student") {
      await markStudentLeft(session, req.user.profileId);
    }

    const formatted = await fetchFormattedSessionById(session._id);
    res.status(200).json({
      message: req.user.role === "teacher" ? "Class ended. Instructor checked out." : "Left classroom",
      session: formatted,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message || "Failed to leave classroom", code: error.code });
  }
};

exports.getClassroom = async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: "Valid sessionId is required" });
    }

    const session = await loadSessionForClassroom(sessionId);
    await assertSessionAccess(req.user, session);

    const formatted = await fetchFormattedSessionById(session._id);
    res.status(200).json({
      session: formatted,
      googleMeetLink: session.googleMeetLink,
      roomName: formatted.roomName,
      classroomPath: formatted.classroomPath,
      isLive: formatted.isLive,
      canStudentJoin: formatted.canStudentJoin,
      teacherAttendance: formatted.teacherAttendance,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message || "Failed to fetch classroom", code: error.code });
  }
};

exports.syncAttendance = async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: "Valid sessionId is required" });
    }

    const session = await loadSessionForClassroom(sessionId);
    if (!session.googleMeetSpace) {
      return res.status(400).json({ message: "No Google Meet space attached to this session" });
    }

    const result = await syncGoogleMeetAttendance(session.googleMeetSpace);
    if (!result.success) {
      return res.status(200).json({ message: result.message });
    }

    // Process attendanceData against enrolled students (using email matching if available, or just keeping the raw list for now)
    // For a strict LMS, you'd match the Google Meet email to the Student's email
    // Here we can simply store the raw sync data in the session or map it.
    
    // For simplicity, we just return the data to the frontend so it can be viewed.
    // Or we could map it to `session.studentAttendance` if emails matched.
    
    res.status(200).json({
      message: "Attendance synced from Google Meet",
      attendanceData: result.attendanceData
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to sync attendance" });
  }
};

// Google OAuth endpoints
exports.getGoogleAuthUrl = (req, res) => {
  const oauth2Client = getGoogleOAuthClient();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/meetings.space.created',
      'https://www.googleapis.com/auth/meetings.space.readonly',
      'https://www.googleapis.com/auth/calendar.events'
    ],
    prompt: 'consent'
  });
  res.status(200).json({ authUrl });
};

exports.googleOAuthCallback = async (req, res) => {
  try {
    const { code } = req.query;
    const oauth2Client = getGoogleOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    
    // Return the refresh token so admin can save it in .env
    res.status(200).json({
      message: "OAuth successful! Copy the refresh token below and add it to your .env as GOOGLE_REFRESH_TOKEN",
      refreshToken: tokens.refresh_token
    });
  } catch (error) {
    res.status(500).json({ message: "Google OAuth failed", error: error.message });
  }
};
