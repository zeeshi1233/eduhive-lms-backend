const Session = require("../models/Session");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");
const Admin = require("../models/Admin");

const MIN_CONDUCTED_RATIO = 0.5;
const MIN_CONDUCTED_MINUTES = 15;

function classroomPath(sessionId) {
  return "/classroom/" + sessionId;
}

function classroomRoomName(sessionId) {
  return "eduhive-class-" + sessionId;
}

function parseDurationMinutes(duration) {
  const minutes = parseInt(duration, 10);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 60;
}

function getEffectiveEndTime(session) {
  if (session?.endTime && !Number.isNaN(new Date(session.endTime).getTime())) {
    return new Date(session.endTime);
  }
  if (session?.startTime && !Number.isNaN(new Date(session.startTime).getTime())) {
    const mins = parseDurationMinutes(session.duration);
    return new Date(new Date(session.startTime).getTime() + mins * 60 * 1000);
  }
  return null;
}

function isSessionExpired(session) {
  const endTime = getEffectiveEndTime(session);
  if (!endTime) return false;
  return Date.now() > endTime.getTime();
}

function getTeacherAttendanceStatus(session) {
  const attendance = session?.teacherAttendance || {};
  if (attendance.checkOutTime) return "checked-out";
  if (attendance.checkInTime) return "checked-in";
  return "not_started";
}

function isClassLive(session) {
  return getTeacherAttendanceStatus(session) === "checked-in";
}

function calculateAccurateDuration(intervals, sessionStartTime, sessionEndTime, scheduledMinutes = 60) {
  if (!Array.isArray(intervals) || intervals.length === 0) {
    return { durationMinutes: 0, durationFormatted: "0 mins" };
  }

  const startMs = sessionStartTime ? new Date(sessionStartTime).getTime() : NaN;
  let endMs = sessionEndTime ? new Date(sessionEndTime).getTime() : NaN;
  if (Number.isNaN(endMs) && !Number.isNaN(startMs)) {
    endMs = startMs + scheduledMinutes * 60 * 1000;
  }
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    return { durationMinutes: 0, durationFormatted: "0 mins" };
  }

  const validSegments = [];
  const nowMs = Date.now();

  for (const interval of intervals) {
    if (!interval) continue;
    const checkIn = interval.checkInTime || interval.joinedAt;
    if (!checkIn) continue;
    const inMs = new Date(checkIn).getTime();
    if (Number.isNaN(inMs)) continue;

    const checkOut = interval.checkOutTime || interval.leftAt;
    let outMs;
    if (checkOut) {
      outMs = new Date(checkOut).getTime();
    } else if (interval.lastHeartbeat) {
      outMs = Math.min(new Date(interval.lastHeartbeat).getTime(), endMs);
    } else {
      outMs = Math.min(nowMs, endMs);
    }
    if (Number.isNaN(outMs)) continue;

    const effectiveIn = Math.max(inMs, startMs);
    const effectiveOut = Math.min(outMs, endMs);

    if (effectiveOut > effectiveIn) {
      validSegments.push([effectiveIn, effectiveOut]);
    }
  }

  if (validSegments.length === 0) {
    return { durationMinutes: 0, durationFormatted: "0 mins" };
  }

  validSegments.sort((a, b) => a[0] - b[0]);

  const mergedSegments = [];
  for (const seg of validSegments) {
    if (mergedSegments.length === 0) {
      mergedSegments.push(seg);
    } else {
      const prev = mergedSegments[mergedSegments.length - 1];
      if (seg[0] <= prev[1]) {
        prev[1] = Math.max(prev[1], seg[1]);
      } else {
        mergedSegments.push(seg);
      }
    }
  }

  let totalMs = 0;
  for (const [s, e] of mergedSegments) {
    totalMs += (e - s);
  }

  const rawMinutes = Math.round(totalMs / 60000);
  const durationMinutes = Math.min(scheduledMinutes, Math.max(0, rawMinutes));

  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  let durationFormatted = "";
  if (hours > 0 && minutes > 0) {
    durationFormatted = hours + " hr" + (hours > 1 ? "s" : "") + " " + minutes + " mins";
  } else if (hours > 0) {
    durationFormatted = hours + " hr" + (hours > 1 ? "s" : "");
  } else {
    durationFormatted = minutes + " mins";
  }

  return { durationMinutes, durationFormatted };
}

function ensureRoomFields(session) {
  const id = session._id;
  if (!session.roomName) session.roomName = classroomRoomName(id);
  if (!session.meetingLink) {
    session.meetingLink = classroomPath(id);
  }
  return session;
}

async function persistRoomFields(session) {
  ensureRoomFields(session);
  await session.save();
  return session;
}

async function teacherCheckIn(session) {
  if (isSessionExpired(session)) {
    const error = new Error("This session has expired.");
    error.statusCode = 400;
    error.code = "SESSION_EXPIRED";
    throw error;
  }

  if (session.status === "Cancelled") {
    const error = new Error("This class was cancelled");
    error.statusCode = 400;
    error.code = "CLASS_CANCELLED";
    throw error;
  }

  const now = new Date();

  if (!session.teacherAttendance) {
    session.teacherAttendance = { intervals: [] };
  }
  if (!Array.isArray(session.teacherAttendance.intervals)) {
    session.teacherAttendance.intervals = [];
  }

  if (!session.teacherAttendance.checkInTime) {
    session.set("teacherAttendance.checkInTime", now);
  }
  session.set("teacherAttendance.lastHeartbeat", now);

  let openInterval = session.teacherAttendance.intervals.find((inv) => !inv.checkOutTime);
  if (!openInterval) {
    openInterval = {
      checkInTime: now,
      lastHeartbeat: now,
    };
    session.teacherAttendance.intervals.push(openInterval);
  } else {
    openInterval.lastHeartbeat = now;
  }

  session.set("teacherAttendance.checkOutTime", null);
  session.status = "ongoing";
  session.isActive = true;

  await session.save();
  return session;
}

function resolveAutoStatus(session, checkOutTime) {
  const checkIn = session.teacherAttendance?.checkInTime
    ? new Date(session.teacherAttendance.checkInTime)
    : null;
  if (!checkIn || Number.isNaN(checkIn.getTime())) {
    return { status: "not_conducted", notConductedReason: "Teacher Not Present" };
  }

  const scheduledMins = parseDurationMinutes(session.duration);
  const dur = calculateAccurateDuration(
    session.teacherAttendance?.intervals || [{ checkInTime: checkIn, checkOutTime }],
    session.startTime,
    session.endTime,
    scheduledMins
  );

  const studentsPresent = (session.studentAttendance || []).some((s) => s.present);
  if (!studentsPresent) {
    return { status: "not_conducted", notConductedReason: "Student Not Present" };
  }

  const requiredMinutes = Math.min(
    scheduledMins * MIN_CONDUCTED_RATIO,
    MIN_CONDUCTED_MINUTES
  );
  if (dur.durationMinutes < requiredMinutes) {
    return { status: "not_conducted", notConductedReason: "Others" };
  }

  return { status: "conducted" };
}

async function teacherCheckOut(session) {
  const checkOutTime = new Date();

  if (!session.teacherAttendance) {
    session.teacherAttendance = { intervals: [] };
  }
  if (!Array.isArray(session.teacherAttendance.intervals)) {
    session.teacherAttendance.intervals = [];
  }

  session.set("teacherAttendance.checkOutTime", checkOutTime);
  session.set("teacherAttendance.lastHeartbeat", checkOutTime);

  if (session.teacherAttendance.intervals.length === 0) {
    if (session.teacherAttendance.checkInTime) {
      session.teacherAttendance.intervals.push({
        checkInTime: session.teacherAttendance.checkInTime,
        checkOutTime,
        lastHeartbeat: checkOutTime,
      });
    }
  } else {
    const openInterval = session.teacherAttendance.intervals.find((inv) => !inv.checkOutTime);
    if (openInterval) {
      openInterval.checkOutTime = checkOutTime;
      openInterval.lastHeartbeat = checkOutTime;
    }
  }

  const scheduledMins = parseDurationMinutes(session.duration);
  const teacherDur = calculateAccurateDuration(
    session.teacherAttendance.intervals,
    session.startTime,
    session.endTime,
    scheduledMins
  );
  session.set("teacherAttendance.durationMinutes", teacherDur.durationMinutes);
  session.set("teacherAttendance.durationFormatted", teacherDur.durationFormatted);

  const current = String(session.status || "").toLowerCase();
  if (current === "ongoing" || current === "scheduled" || current === "pending") {
    const resolved = resolveAutoStatus(session, checkOutTime);
    session.status = resolved.status;
    if (resolved.status === "not_conducted") {
      session.notConductedReason = resolved.notConductedReason || "Others";
    } else {
      session.notConductedReason = undefined;
    }
  }

  if (Array.isArray(session.studentAttendance)) {
    for (const rec of session.studentAttendance) {
      if (rec.present && !rec.leftAt) {
        let studentLeaveTime = checkOutTime;
        if (rec.lastHeartbeat) {
          const hbDiff = checkOutTime.getTime() - new Date(rec.lastHeartbeat).getTime();
          if (hbDiff > 120000) {
            studentLeaveTime = new Date(rec.lastHeartbeat);
          }
        }

        rec.leftAt = studentLeaveTime;
        rec.markedAt = checkOutTime;

        if (!Array.isArray(rec.intervals)) {
          rec.intervals = [];
          if (rec.joinedAt) {
            rec.intervals.push({
              checkInTime: rec.joinedAt,
              checkOutTime: studentLeaveTime,
              lastHeartbeat: studentLeaveTime,
            });
          }
        } else {
          const openStudentInv = rec.intervals.find((inv) => !inv.checkOutTime);
          if (openStudentInv) {
            openStudentInv.checkOutTime = studentLeaveTime;
            openStudentInv.lastHeartbeat = studentLeaveTime;
          }
        }

        const studentDur = calculateAccurateDuration(
          rec.intervals,
          session.startTime,
          session.endTime,
          scheduledMins
        );
        rec.durationMinutes = studentDur.durationMinutes;
        rec.durationFormatted = studentDur.durationFormatted;

        try {
          const Attendance = require("../models/Attendance");
          await Attendance.findOneAndUpdate(
            { student: rec.student, session: session._id },
            {
              student: rec.student,
              session: session._id,
              course: session.course,
              present: true,
              intervals: rec.intervals,
              durationMinutes: studentDur.durationMinutes,
              durationFormatted: studentDur.durationFormatted,
              lastHeartbeat: studentLeaveTime,
              markedAt: checkOutTime,
            },
            { upsert: true }
          );
        } catch (e) {
          console.error("Error updating Attendance record:", e.message);
        }
      }
    }
  }

  await session.save();
  return session;
}

async function markStudentPresent(session, studentId) {
  if (!studentId) return session;

  if (isSessionExpired(session)) {
    const error = new Error("This session has expired.");
    error.statusCode = 400;
    error.code = "SESSION_EXPIRED";
    throw error;
  }

  if (!Array.isArray(session.studentAttendance)) session.studentAttendance = [];

  const now = new Date();
  let existing = session.studentAttendance.find(
    (record) => String(record.student?._id || record.student) === String(studentId)
  );

  if (!existing) {
    existing = {
      student: studentId,
      present: true,
      joinedAt: now,
      markedAt: now,
      lastHeartbeat: now,
      intervals: [{ checkInTime: now, lastHeartbeat: now }],
    };
    session.studentAttendance.push(existing);
  } else {
    existing.present = true;
    existing.markedAt = now;
    existing.lastHeartbeat = now;
    if (!existing.joinedAt) existing.joinedAt = now;
    existing.leftAt = undefined;

    if (!Array.isArray(existing.intervals)) {
      existing.intervals = [];
      if (existing.joinedAt) {
        existing.intervals.push({ checkInTime: existing.joinedAt, lastHeartbeat: now });
      }
    }

    const openInterval = existing.intervals.find((inv) => !inv.checkOutTime);
    if (!openInterval) {
      existing.intervals.push({ checkInTime: now, lastHeartbeat: now });
    } else {
      openInterval.lastHeartbeat = now;
    }
  }

  const scheduledMins = parseDurationMinutes(session.duration);
  const dur = calculateAccurateDuration(
    existing.intervals,
    session.startTime,
    session.endTime,
    scheduledMins
  );
  existing.durationMinutes = dur.durationMinutes;
  existing.durationFormatted = dur.durationFormatted;

  try {
    const Attendance = require("../models/Attendance");
    await Attendance.findOneAndUpdate(
      { student: studentId, session: session._id },
      {
        student: studentId,
        session: session._id,
        course: session.course,
        present: true,
        intervals: existing.intervals,
        durationMinutes: dur.durationMinutes,
        durationFormatted: dur.durationFormatted,
        lastHeartbeat: now,
        markedAt: now,
      },
      { upsert: true }
    );
  } catch (e) {
    console.error("Error upserting Attendance record:", e.message);
  }

  await session.save();
  return session;
}

async function markStudentLeft(session, studentId) {
  if (!studentId) return session;
  if (!Array.isArray(session.studentAttendance)) return session;

  const existing = session.studentAttendance.find(
    (record) => String(record.student?._id || record.student) === String(studentId)
  );
  if (existing) {
    const leftTime = new Date();
    existing.leftAt = leftTime;
    existing.markedAt = leftTime;
    existing.lastHeartbeat = leftTime;

    if (!Array.isArray(existing.intervals)) {
      existing.intervals = [];
      if (existing.joinedAt) {
        existing.intervals.push({
          checkInTime: existing.joinedAt,
          checkOutTime: leftTime,
          lastHeartbeat: leftTime,
        });
      }
    } else {
      const openInterval = existing.intervals.find((inv) => !inv.checkOutTime);
      if (openInterval) {
        openInterval.checkOutTime = leftTime;
        openInterval.lastHeartbeat = leftTime;
      }
    }

    const scheduledMins = parseDurationMinutes(session.duration);
    const dur = calculateAccurateDuration(
      existing.intervals,
      session.startTime,
      session.endTime,
      scheduledMins
    );
    existing.durationMinutes = dur.durationMinutes;
    existing.durationFormatted = dur.durationFormatted;

    try {
      const Attendance = require("../models/Attendance");
      await Attendance.findOneAndUpdate(
        { student: studentId, session: session._id },
        {
          intervals: existing.intervals,
          durationMinutes: dur.durationMinutes,
          durationFormatted: dur.durationFormatted,
          lastHeartbeat: leftTime,
          markedAt: leftTime,
        },
        { upsert: true }
      );
    } catch (e) {
      console.error("Error updating Attendance record on leave:", e.message);
    }

    await session.save();
  }
  return session;
}

async function recordHeartbeat(session, user) {
  if (!session || !user) return { success: false, message: "Missing session or user" };

  const now = new Date();
  const scheduledMins = parseDurationMinutes(session.duration);

  if (user.role === "teacher") {
    if (!session.teacherAttendance) session.teacherAttendance = { intervals: [] };
    if (!Array.isArray(session.teacherAttendance.intervals)) session.teacherAttendance.intervals = [];

    if (!session.teacherAttendance.checkInTime) {
      session.set("teacherAttendance.checkInTime", now);
    }
    session.set("teacherAttendance.lastHeartbeat", now);

    let openInterval = session.teacherAttendance.intervals.find((inv) => !inv.checkOutTime);
    if (!openInterval) {
      openInterval = { checkInTime: now, lastHeartbeat: now };
      session.teacherAttendance.intervals.push(openInterval);
    } else {
      openInterval.lastHeartbeat = now;
    }

    const dur = calculateAccurateDuration(
      session.teacherAttendance.intervals,
      session.startTime,
      session.endTime,
      scheduledMins
    );
    session.set("teacherAttendance.durationMinutes", dur.durationMinutes);
    session.set("teacherAttendance.durationFormatted", dur.durationFormatted);

    if (session.status !== "ongoing" && session.status !== "conducted" && session.status !== "completed") {
      session.status = "ongoing";
      session.isActive = true;
    }

    await session.save();
    return {
      success: true,
      role: "teacher",
      durationMinutes: dur.durationMinutes,
      durationFormatted: dur.durationFormatted,
      isLive: true,
    };
  }

  if (user.role === "student") {
    if (!Array.isArray(session.studentAttendance)) session.studentAttendance = [];

    let existing = session.studentAttendance.find(
      (r) => String(r.student?._id || r.student) === String(user.profileId)
    );

    if (!existing) {
      existing = {
        student: user.profileId,
        present: true,
        joinedAt: now,
        lastHeartbeat: now,
        intervals: [{ checkInTime: now, lastHeartbeat: now }],
      };
      session.studentAttendance.push(existing);
    } else {
      existing.present = true;
      existing.lastHeartbeat = now;
      if (!existing.joinedAt) existing.joinedAt = now;
      existing.leftAt = undefined;

      if (!Array.isArray(existing.intervals)) existing.intervals = [];
      let openInterval = existing.intervals.find((inv) => !inv.checkOutTime);
      if (!openInterval) {
        openInterval = { checkInTime: now, lastHeartbeat: now };
        existing.intervals.push(openInterval);
      } else {
        openInterval.lastHeartbeat = now;
      }
    }

    const dur = calculateAccurateDuration(
      existing.intervals,
      session.startTime,
      session.endTime,
      scheduledMins
    );
    existing.durationMinutes = dur.durationMinutes;
    existing.durationFormatted = dur.durationFormatted;

    try {
      const Attendance = require("../models/Attendance");
      await Attendance.findOneAndUpdate(
        { student: user.profileId, session: session._id },
        {
          student: user.profileId,
          session: session._id,
          course: session.course,
          present: true,
          intervals: existing.intervals,
          durationMinutes: dur.durationMinutes,
          durationFormatted: dur.durationFormatted,
          lastHeartbeat: now,
          markedAt: now,
        },
        { upsert: true }
      );
    } catch (e) {
      console.error("Heartbeat attendance update error:", e.message);
    }

    await session.save();
    return {
      success: true,
      role: "student",
      durationMinutes: dur.durationMinutes,
      durationFormatted: dur.durationFormatted,
      isLive: isClassLive(session),
    };
  }

  return { success: true };
}

async function getParticipantName(user, fallback) {
  if (fallback) return fallback;

  if (user?.role === "teacher") {
    const teacher = await Teacher.findById(user.profileId).select("name");
    return teacher?.name || "Instructor";
  }
  if (user?.role === "student") {
    const student = await Student.findById(user.profileId).select("name");
    return student?.name || "Student";
  }
  if (user?.role === "admin") {
    const admin = await Admin.findById(user.profileId).select("name");
    return admin?.name || "Admin";
  }
  return "Participant";
}

async function loadSessionForClassroom(sessionId) {
  const session = await Session.findById(sessionId);
  if (!session) {
    const error = new Error("Scheduled class not found");
    error.statusCode = 404;
    error.code = "SESSION_NOT_FOUND";
    throw error;
  }
  return persistRoomFields(session);
}

module.exports = {
  classroomPath,
  classroomRoomName,
  getTeacherAttendanceStatus,
  isClassLive,
  isSessionExpired,
  getEffectiveEndTime,
  calculateAccurateDuration,
  ensureRoomFields,
  persistRoomFields,
  teacherCheckIn,
  teacherCheckOut,
  markStudentPresent,
  markStudentLeft,
  recordHeartbeat,
  getParticipantName,
  loadSessionForClassroom,
  resolveAutoStatus,
  parseDurationMinutes,
  MIN_CONDUCTED_MINUTES,
  MIN_CONDUCTED_RATIO,
};