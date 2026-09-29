const Session = require("../models/Session");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");
const Admin = require("../models/Admin");

const MIN_CONDUCTED_RATIO = 0.5; // at least 50% of scheduled duration
const MIN_CONDUCTED_MINUTES = 15;

function classroomPath(sessionId) {
  return `/classroom/${sessionId}`;
}

function classroomRoomName(sessionId) {
  return `eduhive-class-${sessionId}`;
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

/**
 * Accurately calculate active duration spent strictly within the scheduled session window.
 * 
 * Rules:
 * 1. Only count active time spent *within* the valid window of the scheduled session [sessionStart, sessionEnd]
 *    (early check-ins before sessionStart are clipped to sessionStart, checkouts after sessionEnd are clipped to sessionEnd).
 * 2. Sum up the actual time elapsed between each valid check-in and check-out pair during that class.
 * 3. Overlapping or duplicate intervals are merged so time is never double-counted.
 * 4. Idle intervals outside or between check-in/out pairs are excluded.
 * 5. Total duration cannot exceed scheduled duration.
 */
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
    } else {
      outMs = Math.min(nowMs, endMs);
    }
    if (Number.isNaN(outMs)) continue;

    // Clip strictly to scheduled session window
    const effectiveIn = Math.max(inMs, startMs);
    const effectiveOut = Math.min(outMs, endMs);

    if (effectiveOut > effectiveIn) {
      validSegments.push([effectiveIn, effectiveOut]);
    }
  }

  if (validSegments.length === 0) {
    return { durationMinutes: 0, durationFormatted: "0 mins" };
  }

  // Sort segments by start time
  validSegments.sort((a, b) => a[0] - b[0]);

  // Merge overlapping or contiguous segments
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

  // Sum merged durations
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
    durationFormatted = `${hours} hr${hours > 1 ? "s" : ""} ${minutes} mins`;
  } else if (hours > 0) {
    durationFormatted = `${hours} hr${hours > 1 ? "s" : ""}`;
  } else {
    durationFormatted = `${minutes} mins`;
  }

  return { durationMinutes, durationFormatted };
}

function ensureRoomFields(session) {
  const id = session._id;
  if (!session.roomName) session.roomName = classroomRoomName(id);
  session.meetingLink = classroomPath(id);
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

  // Open an interval if no unclosed interval exists
  const openInterval = session.teacherAttendance.intervals.find((inv) => !inv.checkOutTime);
  if (!openInterval) {
    session.teacherAttendance.intervals.push({
      checkInTime: now,
    });
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

  const minRequired = Math.max(MIN_CONDUCTED_MINUTES, scheduledMins * MIN_CONDUCTED_RATIO);

  if (dur.durationMinutes >= minRequired) {
    return { status: "conducted", notConductedReason: "" };
  }

  return {
    status: "not_conducted",
    notConductedReason: session.notConductedReason || "Others",
  };
}

async function teacherCheckOut(session) {
  if (!session.teacherAttendance?.checkInTime) {
    const error = new Error("Class has not started yet");
    error.statusCode = 400;
    error.code = "NOT_STARTED";
    throw error;
  }

  const checkOutTime = new Date();
  session.set("teacherAttendance.checkOutTime", checkOutTime);

  if (!Array.isArray(session.teacherAttendance.intervals)) {
    session.teacherAttendance.intervals = [];
    if (session.teacherAttendance.checkInTime) {
      session.teacherAttendance.intervals.push({
        checkInTime: session.teacherAttendance.checkInTime,
        checkOutTime,
      });
    }
  } else {
    const openInterval = session.teacherAttendance.intervals.find((inv) => !inv.checkOutTime);
    if (openInterval) {
      openInterval.checkOutTime = checkOutTime;
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

  // Auto-resolve status
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

  // Auto check-out all students currently in class
  if (Array.isArray(session.studentAttendance)) {
    for (const rec of session.studentAttendance) {
      if (rec.present && !rec.leftAt) {
        rec.leftAt = checkOutTime;
        rec.markedAt = checkOutTime;

        if (!Array.isArray(rec.intervals)) {
          rec.intervals = [];
          if (rec.joinedAt) {
            rec.intervals.push({
              checkInTime: rec.joinedAt,
              checkOutTime,
            });
          }
        } else {
          const openStudentInv = rec.intervals.find((inv) => !inv.checkOutTime);
          if (openStudentInv) {
            openStudentInv.checkOutTime = checkOutTime;
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
      intervals: [{ checkInTime: now }],
    };
    session.studentAttendance.push(existing);
  } else {
    existing.present = true;
    existing.markedAt = now;
    if (!existing.joinedAt) existing.joinedAt = now;
    existing.leftAt = undefined;

    if (!Array.isArray(existing.intervals)) {
      existing.intervals = [];
      if (existing.joinedAt) {
        existing.intervals.push({ checkInTime: existing.joinedAt });
      }
    }

    const openInterval = existing.intervals.find((inv) => !inv.checkOutTime);
    if (!openInterval) {
      existing.intervals.push({ checkInTime: now });
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

    if (!Array.isArray(existing.intervals)) {
      existing.intervals = [];
      if (existing.joinedAt) {
        existing.intervals.push({
          checkInTime: existing.joinedAt,
          checkOutTime: leftTime,
        });
      }
    } else {
      const openInterval = existing.intervals.find((inv) => !inv.checkOutTime);
      if (openInterval) {
        openInterval.checkOutTime = leftTime;
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
  getParticipantName,
  loadSessionForClassroom,
  resolveAutoStatus,
  parseDurationMinutes,
  MIN_CONDUCTED_MINUTES,
  MIN_CONDUCTED_RATIO,
};
