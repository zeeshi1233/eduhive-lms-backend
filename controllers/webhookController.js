const Session = require("../models/Session");
const Student = require("../models/Student");
const Teacher = require("../models/Teacher");
const Auth = require("../models/Auth");
const Attendance = require("../models/Attendance");
const {
  calculateAccurateDuration,
  parseDurationMinutes,
  markStudentPresent,
  markStudentLeft,
  teacherCheckIn,
  teacherCheckOut,
} = require("../utils/classroom");

/**
 * Resolve LMS user (teacher/student) from a Google participant email.
 */
async function resolveUserByEmail(email) {
  if (!email) return null;
  const normalized = String(email).trim().toLowerCase();

  const auth = await Auth.findOne({ email: normalized }).select("role refId refModel email");
  if (auth) {
    return {
      role: auth.role,
      profileId: auth.refId,
      email: auth.email,
      source: "auth",
    };
  }

  const teacher = await Teacher.findOne({ googleEmail: normalized }).select("_id");
  if (teacher) {
    return {
      role: "teacher",
      profileId: teacher._id,
      email: normalized,
      source: "teacher.googleEmail",
    };
  }

  // Legacy: some installs may store email on student profile
  const student = await Student.findOne({
    $or: [{ email: normalized }, { googleEmail: normalized }],
  }).select("_id");
  if (student) {
    return {
      role: "student",
      profileId: student._id,
      email: normalized,
      source: "student",
    };
  }

  return null;
}

function extractParticipantEmail(payload) {
  return (
    payload?.participant?.signedinUser?.user ||
    payload?.participantSession?.participant?.signedinUser?.user ||
    payload?.participant?.email ||
    payload?.email ||
    null
  );
}

function extractSpaceName(payload) {
  return (
    payload?.space?.name ||
    payload?.conferenceRecord?.space ||
    payload?.conferenceRecord?.space?.name ||
    payload?.spaceName ||
    null
  );
}

function extractConferenceId(payload) {
  const fromSpace = extractSpaceName(payload);
  if (fromSpace && String(fromSpace).includes("/")) {
    return String(fromSpace).split("/").pop();
  }
  return (
    payload?.conferenceRecord?.conferenceId ||
    payload?.conferenceData?.conferenceId ||
    null
  );
}

async function findSessionForMeetEvent(payload) {
  const spaceName = extractSpaceName(payload);
  const conferenceId = extractConferenceId(payload);

  if (spaceName) {
    const bySpace = await Session.findOne({ googleMeetSpace: spaceName });
    if (bySpace) return bySpace;
  }

  if (conferenceId) {
    const byConference = await Session.findOne({
      $or: [
        { googleMeetSpace: `spaces/${conferenceId}` },
        { googleMeetSpace: conferenceId },
        { googleCalendarEventId: conferenceId },
      ],
    });
    if (byConference) return byConference;
  }

  // Fallback: active/ongoing session in the last few hours with a Meet link
  const recent = await Session.findOne({
    googleMeetLink: { $exists: true, $ne: "" },
    status: { $in: ["Scheduled", "pending", "ongoing"] },
    startTime: { $lte: new Date(Date.now() + 30 * 60 * 1000) },
    endTime: { $gte: new Date(Date.now() - 30 * 60 * 1000) },
  }).sort({ startTime: -1 });

  return recent;
}

/**
 * POST /api/webhooks/google-meet
 * Receives Google Cloud Pub/Sub push notifications for Meet events.
 * Matches participant email → LMS Auth/Teacher/Student and logs check-in/out.
 */
exports.handleGoogleMeetWebhook = async (req, res) => {
  // Always ACK quickly so Pub/Sub does not retry storms
  res.status(200).json({ received: true });

  try {
    const token = req.query.token;
    if (process.env.GOOGLE_PUBSUB_TOKEN && token !== process.env.GOOGLE_PUBSUB_TOKEN) {
      console.warn("[Webhook] Invalid Pub/Sub token — request rejected silently.");
      return;
    }

    const message = req.body?.message;
    if (!message?.data) {
      console.log("[Webhook] No Pub/Sub message data found.");
      return;
    }

    const rawPayload = Buffer.from(message.data, "base64").toString("utf8");
    let payload;
    try {
      payload = JSON.parse(rawPayload);
    } catch (e) {
      console.error("[Webhook] Failed to parse Pub/Sub payload:", rawPayload);
      return;
    }

    const eventType = payload.type || payload["@type"] || payload.eventType || "";
    console.log(
      "[Webhook] Google Meet event received:",
      eventType,
      JSON.stringify(payload).slice(0, 300)
    );

    const isJoin =
      eventType.includes("participant.v2.joined") ||
      eventType.includes("participantSession.started") ||
      eventType.includes("conference.participant.joined") ||
      /joined/i.test(eventType);

    const isLeave =
      eventType.includes("participant.v2.left") ||
      eventType.includes("participantSession.ended") ||
      eventType.includes("conference.participant.left") ||
      /left|ended/i.test(eventType);

    if (!isJoin && !isLeave) {
      console.log("[Webhook] Ignoring non join/leave event:", eventType);
      return;
    }

    const participantEmail = extractParticipantEmail(payload);
    const session = await findSessionForMeetEvent(payload);
    if (!session) {
      console.warn("[Webhook] No matching LMS session for Meet event.");
      return;
    }

    const user = await resolveUserByEmail(participantEmail);
    if (!user) {
      console.warn(
        `[Webhook] No LMS user matched for email: ${participantEmail || "(none)"}`
      );
      return;
    }

    const eventTime = new Date(
      payload.participantSession?.endTime ||
        payload.participantSession?.startTime ||
        payload.participant?.endTime ||
        payload.participant?.startTime ||
        Date.now()
    );

    if (isJoin) {
      if (user.role === "teacher") {
        const instructorId = String(session.instructor || session.teacher || "");
        if (instructorId === String(user.profileId)) {
          await teacherCheckIn(session);
          console.log(`[Webhook] Teacher check-in for session ${session._id}`);
        }
      } else if (user.role === "student") {
        await markStudentPresent(session, user.profileId);
        console.log(
          `[Webhook] Student ${user.profileId} check-in for session ${session._id}`
        );
      }
      return;
    }

    if (isLeave) {
      const scheduledMins = parseDurationMinutes(session.duration);

      if (user.role === "teacher") {
        const instructorId = String(session.instructor || session.teacher || "");
        if (instructorId === String(user.profileId)) {
          await teacherCheckOut(session);
          console.log(
            `[Webhook] Teacher check-out for session ${session._id} at ${eventTime.toISOString()}`
          );
        }
        return;
      }

      if (user.role === "student") {
        await markStudentLeft(session, user.profileId);

        // Ensure Attendance mirror is up to date with clipped duration
        const refreshed = await Session.findById(session._id);
        const record = (refreshed?.studentAttendance || []).find(
          (r) => String(r.student) === String(user.profileId)
        );
        if (record) {
          const studentDur = calculateAccurateDuration(
            record.intervals || [],
            refreshed.startTime,
            refreshed.endTime,
            scheduledMins
          );
          try {
            await Attendance.findOneAndUpdate(
              { student: user.profileId, session: refreshed._id },
              {
                intervals: record.intervals || [],
                durationMinutes: studentDur.durationMinutes,
                durationFormatted: studentDur.durationFormatted,
                markedAt: eventTime,
              },
              { upsert: true }
            );
          } catch (e) {
            console.error("[Webhook] Attendance mirror update failed:", e.message);
          }
        }

        console.log(
          `[Webhook] Student ${user.profileId} check-out for session ${session._id}`
        );
      }
    }
  } catch (err) {
    console.error("[Webhook] Error processing Google Meet event:", err.message);
  }
};
