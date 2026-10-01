const Teacher = require("../models/Teacher");
const {
  getGoogleOAuthClient,
  getTeacherGoogleAuthUrl,
  getAdminGoogleAuthUrl,
  syncGoogleMeetAttendance,
} = require("../utils/googleMeet");

function frontendBaseUrl() {
  return (
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    "https://eduhive-lms.vercel.app"
  );
}

function redirectToFrontend(res, pathWithQuery) {
  const base = frontendBaseUrl().replace(/\/$/, "");
  return res.redirect(`${base}${pathWithQuery.startsWith("/") ? "" : "/"}${pathWithQuery}`);
}

// Teacher-level: generate Google OAuth URL
exports.teacherGoogleAuthUrl = (req, res) => {
  try {
    if (req.user?.role !== "teacher" && req.user?.role !== "admin") {
      return res.status(403).json({ message: "Only teachers/admins can connect Google" });
    }
    const teacherId =
      req.user?.role === "teacher"
        ? req.user.profileId
        : req.query.teacherId || req.user?.profileId;

    if (!teacherId) {
      return res.status(400).json({ message: "teacherId is required" });
    }

    const authUrl = getTeacherGoogleAuthUrl(String(teacherId));
    res.status(200).json({ authUrl });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to create Google auth URL" });
  }
};

// Teacher-level callback (legacy path) — same logic as unified /api/google/callback
exports.teacherGoogleConnect = async (req, res) => {
  return exports.googleOAuthCallback(req, res);
};

async function saveTeacherGoogleTokens(teacherId, tokens, googleEmail) {
  const update = {
    googleConnected: true,
    googleEmail: googleEmail || "",
  };
  if (tokens.refresh_token) update.googleRefreshToken = tokens.refresh_token;
  if (tokens.access_token) update.googleAccessToken = tokens.access_token;
  if (tokens.expiry_date) update.googleTokenExpiry = new Date(tokens.expiry_date);

  return Teacher.findByIdAndUpdate(teacherId, update, { new: true }).select(
    "name googleEmail googleConnected googleTokenExpiry"
  );
}

exports.disconnectTeacherGoogle = async (req, res) => {
  try {
    const teacherId =
      req.user?.role === "teacher"
        ? req.user.profileId
        : req.body?.teacherId || req.query.teacherId;

    if (!teacherId) {
      return res.status(400).json({ message: "teacherId is required" });
    }

    if (
      req.user?.role === "teacher" &&
      String(req.user.profileId) !== String(teacherId)
    ) {
      return res.status(403).json({ message: "Cannot disconnect another teacher" });
    }

    await Teacher.findByIdAndUpdate(teacherId, {
      googleAccessToken: "",
      googleRefreshToken: "",
      googleTokenExpiry: null,
      googleEmail: "",
      googleConnected: false,
    });

    res.status(200).json({ message: "Google account disconnected" });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to disconnect Google" });
  }
};

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
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
  recordHeartbeat,
  isSessionExpired,
  isClassLive,
} = require("../utils/classroom");

async function assertSessionAccess(user, session) {
  if (user.role === "admin") return true;

  if (user.role === "teacher") {
    const instructorId = String(session.instructor?._id || session.instructor || "");
    const teacherId = String(session.teacher?._id || session.teacher || "");
    const currentTeacherId = String(user.profileId || user.id || "");
    if (instructorId !== currentTeacherId && teacherId !== currentTeacherId) {
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
    const sessionId = req.params.sessionId || req.body?.sessionId;
    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: "Valid sessionId is required" });
    }

    const session = await loadSessionForClassroom(sessionId);
    await assertSessionAccess(req.user, session);

    if (isSessionExpired(session)) {
      return res.status(400).json({
        message: "This session has expired.",
        code: "SESSION_EXPIRED",
      });
    }

    if (session.status === "Cancelled") {
      return res.status(400).json({ message: "This class was cancelled", code: "CLASS_CANCELLED" });
    }

    if (req.user.role === "teacher") {
      await teacherCheckIn(session);
    } else if (req.user.role === "student") {
      if (session.teacherAttendance?.checkOutTime || session.status === "completed" || session.status === "conducted") {
        return res.status(400).json({ message: "This class has already ended", code: "CLASS_ENDED" });
      }
      await markStudentPresent(session, req.user.profileId);
    } else if (session.teacherAttendance?.checkOutTime) {
      return res.status(400).json({ message: "This class has already ended", code: "CLASS_ENDED" });
    }

    const displayName = await getParticipantName(req.user, req.body?.participantName);
    const formatted = await fetchFormattedSessionById(session._id);

    const actualMeetUrl =
      session.googleMeetLink ||
      (session.meetingLink && session.meetingLink.startsWith("http") ? session.meetingLink : null) ||
      (session.link && session.link.startsWith("http") ? session.link : null) ||
      session.googleMeetLink;

    res.status(200).json({
      googleMeetLink: actualMeetUrl,
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

exports.joinSessionRedirect = async (req, res) => {
  const sessionId = req.params.sessionId;
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

  if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
    return res.status(400).send("Invalid session identifier");
  }

  const token =
    req.query.token ||
    (req.headers.authorization && req.headers.authorization.split(" ")[1]) ||
    req.cookies?.token;

  if (!token) {
    return res.redirect(
      frontendUrl +
        "/?error=login_required&redirect=" +
        encodeURIComponent("/classroom/" + sessionId + "?autoLaunch=true")
    );
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = {
      id: decoded.id,
      role: decoded.role,
      profileId: decoded.profileId,
    };

    const session = await loadSessionForClassroom(sessionId);

    if (isSessionExpired(session)) {
      return res.redirect(frontendUrl + "/classroom/" + sessionId + "?error=expired");
    }

    if (session.status === "Cancelled") {
      return res.redirect(frontendUrl + "/classroom/" + sessionId + "?error=cancelled");
    }

    try {
      await assertSessionAccess(user, session);
    } catch (accessErr) {
      console.warn("[Redirect Join] Access denied for user " + user.id + ": " + accessErr.message);
      return res.redirect(
        frontendUrl + "/classroom/" + sessionId + "?error=" + encodeURIComponent(accessErr.message)
      );
    }

    if (user.role === "teacher") {
      await teacherCheckIn(session);
    } else if (user.role === "student") {
      if (session.teacherAttendance?.checkOutTime || session.status === "completed" || session.status === "conducted") {
        return res.redirect(frontendUrl + "/classroom/" + sessionId + "?error=ended");
      }
      await markStudentPresent(session, user.profileId);
    }

    const targetMeetingUrl =
      session.meetingUrl ||
      session.googleMeetLink ||
      (session.meetingLink && session.meetingLink.startsWith("http") ? session.meetingLink : null) ||
      (session.link && session.link.startsWith("http") ? session.link : null);

    // Automatic Redirect: Immediately redirect to actual meeting URL (Google Meet / Zoom)
    if (targetMeetingUrl) {
      return res.redirect(targetMeetingUrl);
    }

    // Fallback if no external video meeting link is set on the session
    return res.redirect(
      frontendUrl + "/classroom/" + sessionId + "?token=" + encodeURIComponent(token)
    );
  } catch (err) {
    console.error("[Redirect Join Error]:", err.message);
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      return res.redirect(
        frontendUrl + "/login?error=InvalidToken&redirect=" + encodeURIComponent("/api/sessions/join/" + sessionId)
      );
    }
    return res.redirect(frontendUrl + "/classroom/" + sessionId + "?error=" + encodeURIComponent(err.message));
  }
};

exports.sessionHeartbeat = async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: "Valid sessionId is required" });
    }

    const session = await loadSessionForClassroom(sessionId);
    if (isSessionExpired(session)) {
      return res.status(400).json({ message: "Session expired", code: "SESSION_EXPIRED" });
    }

    if (session.status === "Cancelled") {
      return res.status(400).json({ message: "Session cancelled", code: "CLASS_CANCELLED" });
    }

    const result = await recordHeartbeat(session, req.user);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message || "Heartbeat recording failed" });
  }
};

exports.getTrackedSessionLink = async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: "Valid sessionId is required" });
    }

    const session = await loadSessionForClassroom(sessionId);
    await assertSessionAccess(req.user, session);

    const apiBase = process.env.API_URL || process.env.BACKEND_URL || "";
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

    const token = req.headers.authorization?.split(" ")[1] || "";
    const generalRedirectUrl = apiBase + "/api/sessions/join/" + session._id;
    const personalRedirectUrl = token ? (generalRedirectUrl + "?token=" + token) : generalRedirectUrl;
    const directMeetingLink = session.googleMeetLink || session.meetingLink || "";

    res.status(200).json({
      sessionId: session._id,
      trackedLink: generalRedirectUrl,
      personalTrackedLink: personalRedirectUrl,
      classroomUrl: frontendUrl + "/classroom/" + session._id,
      googleMeetLink: directMeetingLink,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message || "Failed to generate link" });
  }
};

exports.leaveClassroom = async (req, res) => {
  try {
    const sessionId = req.params.sessionId || req.body?.sessionId;
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
    const sessionId = req.params.sessionId;
    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: "Valid sessionId is required" });
    }

    const session = await loadSessionForClassroom(sessionId);
    await assertSessionAccess(req.user, session);

    const actualMeetUrl =
      session.googleMeetLink ||
      (session.meetingLink && session.meetingLink.startsWith("http") ? session.meetingLink : null) ||
      (session.link && session.link.startsWith("http") ? session.link : null);

    const formatted = await fetchFormattedSessionById(session._id);
    res.status(200).json({
      session: formatted,
      googleMeetLink: actualMeetUrl,
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
    const sessionId = req.params.sessionId;
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

    res.status(200).json({
      message: "Attendance synced from Google Meet",
      attendanceData: result.attendanceData,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to sync attendance" });
  }
};

exports.getGoogleAuthUrl = (req, res) => {
  try {
    const authUrl = getAdminGoogleAuthUrl();
    res.status(200).json({ authUrl });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to create Google auth URL" });
  }
};

/**
 * Unified OAuth callback for admin + teacher.
 * Google Console redirect URI must point here:
 *   /api/google/callback
 * Teacher flow uses state=`teacher:<teacherId>`.
 */
exports.googleOAuthCallback = async (req, res) => {
  const wantsJson = String(req.query.format || "").toLowerCase() === "json";

  try {
    const { code, state = "" } = req.query;
    if (!code) {
      if (wantsJson) return res.status(400).json({ message: "Missing OAuth code" });
      return redirectToFrontend(res, "/teacher-profile?google=error&reason=missing_code");
    }

    const oauth2Client = getGoogleOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = require("googleapis").google.oauth2({
      version: "v2",
      auth: oauth2Client,
    });
    const me = await oauth2.userinfo.get();
    const googleEmail = me.data?.email || "";

    const stateStr = String(state || "");
    const isTeacherFlow =
      stateStr.startsWith("teacher:") || mongoose.Types.ObjectId.isValid(stateStr);

    if (isTeacherFlow) {
      const teacherId = stateStr.startsWith("teacher:")
        ? stateStr.slice("teacher:".length)
        : stateStr;

      if (!tokens.refresh_token) {
        // Sometimes Google omits refresh_token on re-consent; keep prior token if present
        const existing = await Teacher.findById(teacherId).select("+googleRefreshToken");
        if (!existing?.googleRefreshToken) {
          if (wantsJson) {
            return res.status(400).json({
              message:
                "No refresh_token received. Revoke app access in Google Account and reconnect with consent.",
            });
          }
          return redirectToFrontend(
            res,
            "/teacher-profile?google=error&reason=no_refresh_token"
          );
        }
        tokens.refresh_token = existing.googleRefreshToken;
      }

      const teacher = await saveTeacherGoogleTokens(teacherId, tokens, googleEmail);
      if (wantsJson) {
        return res.status(200).json({
          message: "Google account connected! Teacher is now the host for their sessions.",
          googleEmail,
          teacher,
        });
      }
      return redirectToFrontend(
        res,
        `/teacher-profile?google=connected&email=${encodeURIComponent(googleEmail)}`
      );
    }

    // Admin / env refresh-token flow
    if (tokens.refresh_token) {
      process.env.GOOGLE_REFRESH_TOKEN = tokens.refresh_token;
    }

    if (wantsJson) {
      return res.status(200).json({
        message:
          "OAuth successful! Copy the refresh token below and add it to your .env as GOOGLE_REFRESH_TOKEN",
        refreshToken: tokens.refresh_token || null,
        googleEmail,
      });
    }

    return redirectToFrontend(
      res,
      `/admin-profile?google=connected&email=${encodeURIComponent(googleEmail)}&hasRefresh=${Boolean(
        tokens.refresh_token
      )}`
    );
  } catch (error) {
    console.error("Google OAuth callback error:", error);
    if (wantsJson) {
      return res
        .status(500)
        .json({ message: "Google OAuth failed", error: error.message });
    }
    return redirectToFrontend(
      res,
      `/teacher-profile?google=error&reason=${encodeURIComponent(error.message || "oauth_failed")}`
    );
  }
};